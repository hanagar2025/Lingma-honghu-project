"""光模块去杠杆三信号观察（研究层，OBSERVATION，不产生动作）

委员会 10/28 定义：三个信号同时出现，才可讨论"去杠杆接近尾声"；
只出现其中一项不构成结论。本脚本只列读数，不判定。
所有比较参数均未经委员会裁定，输出中标为「待裁定」，不生效。

  信号一 融资降速收窄：中际旭创、新易盛融资余额 5 日变化 / 全市场 5 日变化；融资买入与偿还分列
  信号二 下跌日缩量：光模块池下跌日的成交额 / 20 日均，对照恐慌日（10/22）
  信号三 相对强度恢复：光模块池（等权）相对创业板指、相对其他 AI 硬件池的逐日超额

用法：python3 scripts/watch-optical-deleverage.py [天数，默认 10]
数据源与资金哨兵 R-01 相同：腾讯日 K（newfqkline）、东方财富 RPTA_WEB_RZRQ_GGMX / RPTA_RZRQ_LSHJ
"""
import json
import sys
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

OPTICAL = ['300308', '300502', '300394', '300620', '002281', '688313', '688498']
OTHERS = {
    '半导体设备': ['002371', '688012', '688072', '688120', '300567', '688361', '688003'],
    'PCB': ['002463', '002916', '600183', '002384'],
    'CPU/系统': ['688041', '603019', '688256'],
}
MARGIN = {'300308': '中际旭创', '300502': '新易盛'}
PANIC_DAY = '2026-10-22'
DAYS = int(sys.argv[1]) if len(sys.argv) > 1 else 10


def sym(c):
    return ('sh' if c[0] in '69' else 'sz') + c


def get(url, headers):
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0', **headers})
    return json.loads(urllib.request.urlopen(req, timeout=20).read())


def kline(s):
    d = get(f'https://web.ifzq.gtimg.cn/appstock/app/newfqkline/get?param={s},day,,,120,qfq',
            {'Referer': 'https://gu.qq.com/'})
    rows = d['data'][s].get('qfqday') or d['data'][s].get('day')
    return {r[0]: (float(r[2]), float(r[8]) * 1e4) for r in rows if len(r) > 8}


def margin(code):
    f = urllib.parse.quote(f'(SCODE="{code}")')
    d = get('https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPTA_WEB_RZRQ_GGMX'
            f'&columns=DATE,RZYE,RZMRE,RZCHE&filter={f}&sortColumns=DATE&sortTypes=-1&pageSize=40&pageNumber=1', {})
    return [(x['DATE'][:10], x['RZYE'], x['RZMRE'] or 0, x['RZCHE'] or 0) for x in d['result']['data']]


def market_margin():
    f = urllib.parse.quote("(DIM_DATE>='2026-08-01')")
    d = get('https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPTA_RZRQ_LSHJ'
            f'&columns=DIM_DATE,RZYE&filter={f}&sortColumns=DIM_DATE&sortTypes=-1&pageSize=80&pageNumber=1', {})
    return [(x['DIM_DATE'][:10], x['RZYE']) for x in d['result']['data']]


syms = ['sz399006'] + [sym(c) for c in OPTICAL] + [sym(c) for v in OTHERS.values() for c in v]
with ThreadPoolExecutor(12) as ex:
    K = dict(zip(syms, ex.map(kline, syms)))
dates = sorted(K['sz399006'])


def ret(codes, d, p):
    rs = [K[sym(c)][d][0] / K[sym(c)][p][0] - 1 for c in codes if d in K[sym(c)] and p in K[sym(c)]]
    return sum(rs) / len(rs)


def pool_amt(codes, d):
    return sum(K[sym(c)][d][1] for c in codes if d in K[sym(c)])


print(f'光模块去杠杆三信号观察　最新交易日 {dates[-1]}　（研究层，不产生动作；比较参数全部「待裁定」）\n')

print('信号一　融资降速（融资余额为负债额，不随股价重估；T+1 发布）')
mm = market_margin()
m5 = mm[0][1] / mm[5][1] - 1
print(f'  全市场 {mm[0][0]}：5 日 {m5 * 100:+.1f}%')
for code, name in MARGIN.items():
    rows = margin(code)
    c5 = rows[0][1] / rows[5][1] - 1
    print(f'  {name} {rows[0][0]}：5 日 {c5 * 100:+.1f}%，为全市场的 {c5 / m5:.1f} 倍（「接近全市场」的倍数待裁定）')
    print('    日期        余额(亿)  融资买入(亿)  偿还(亿)  净额(亿)')
    for d, ye, buy, rep in rows[:DAYS]:
        print(f'    {d}  {ye / 1e8:8.1f}  {buy / 1e8:10.1f}  {rep / 1e8:8.1f}  {(buy - rep) / 1e8:+8.1f}')

print(f'\n信号二与信号三　光模块池逐日（等权涨跌；量比 = 池成交额 / 前 20 日均；恐慌日 {PANIC_DAY}）')
panic_i = dates.index(PANIC_DAY)
panic_ratio = pool_amt(OPTICAL, PANIC_DAY) / (sum(pool_amt(OPTICAL, x) for x in dates[panic_i - 20:panic_i]) / 20)
print(f'  恐慌日量比 {panic_ratio:.2f}（「明显低于」的幅度待裁定）')
print('  日期        光池     量比   相对创业板   相对其他AI硬件   下跌日缩量')
for i in range(len(dates) - DAYS, len(dates)):
    d, p = dates[i], dates[i - 1]
    o = ret(OPTICAL, d, p)
    cyb = K['sz399006'][d][0] / K['sz399006'][p][0] - 1
    oth = sum(ret(v, d, p) for v in OTHERS.values()) / len(OTHERS)
    a20 = sum(pool_amt(OPTICAL, x) for x in dates[i - 20:i]) / 20
    vr = pool_amt(OPTICAL, d) / a20
    shrink = ('是' if vr < panic_ratio else '否') if o < 0 and d > PANIC_DAY else '-'
    print(f'  {d}  {o * 100:+5.1f}%  {vr:5.2f}   {(o - cyb) * 100:+6.1f}pp      {(o - oth) * 100:+6.1f}pp        {shrink}')

for k in (5, 10, 20):
    d, p = dates[-1], dates[-1 - k]
    o = ret(OPTICAL, d, p)
    cyb = K['sz399006'][d][0] / K['sz399006'][p][0] - 1
    oth = sum(ret(v, d, p) for v in OTHERS.values()) / len(OTHERS)
    print(f'  {k:2d} 日累计：光池 {o * 100:+.1f}%，相对创业板 {(o - cyb) * 100:+.1f}pp，相对其他 AI 硬件 {(o - oth) * 100:+.1f}pp')
print('\n「维持数个交易日」的天数待裁定。三个信号未同时出现时，不讨论「出清接近尾声」。')
