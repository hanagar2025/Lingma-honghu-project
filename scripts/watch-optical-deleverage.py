"""光模块去杠杆三信号：纯数据核验记录（研究层，OBSERVATION，不产生动作）

委员会 10/28 定义：三个信号同时出现，才可讨论"去杠杆接近尾声"；只出现一项不构成结论。
本脚本只记录读数，不判定。比较阈值按参数登记（PARAMS_VERSION）执行，未裁定的一律不生效。
即使三信号全部出现，也不打开买入权限：账户核验、融资监控、交易权限是三道独立闸门。

  信号一 融资降速：个股融资余额 5 日 / 20 日变化率（绝对值）、全市场同期变化率、两者倍数；
         日度分列融资买入、偿还、净买入（原始字段 RZJME）与余额变化，残差单列
  信号二 下跌日缩量：光模块池下跌日成交额 / 前 20 日均量，对照恐慌日 10/22
  信号三 相对强度：光模块池（等权）相对创业板指的 5 日、20 日收益差（辅助：相对其他 AI 硬件）

用法：python3 scripts/watch-optical-deleverage.py [--save]
  --save 把原始字段与读数写入 战略组合2026-2030/数据/光模块去杠杆/<最新交易日>.json
数据源与资金哨兵 R-01 相同：腾讯日 K（newfqkline）、东方财富 RPTA_WEB_RZRQ_GGMX / RPTA_RZRQ_LSHJ
"""
import datetime
import json
import os
import sys
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

PARAMS_VERSION = 'v0（参数未裁定，阈值不生效）'
OPTICAL = ['300308', '300502', '300394', '300620', '002281', '688313', '688498']
OTHERS = {
    '半导体设备': ['002371', '688012', '688072', '688120', '300567', '688361', '688003'],
    'PCB': ['002463', '002916', '600183', '002384'],
    'CPU/系统': ['688041', '603019', '688256'],
}
MARGIN = {'300308': '中际旭创', '300502': '新易盛'}
PANIC_DAY = '2026-10-22'
SHOW_DAYS = 10
SAVE_DIR = os.path.join(os.path.dirname(__file__), '..', '战略组合2026-2030', '数据', '光模块去杠杆')

KLINE_URL = 'https://web.ifzq.gtimg.cn/appstock/app/newfqkline/get?param={},day,,,120,qfq'
EM_URL = 'https://datacenter-web.eastmoney.com/api/data/v1/get?reportName={}&columns=ALL&filter={}&sortColumns={}&sortTypes=-1&pageSize={}&pageNumber=1'


def sym(c):
    return ('sh' if c[0] in '69' else 'sz') + c


def get(url, headers):
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0', **headers})
    return json.loads(urllib.request.urlopen(req, timeout=20).read())


def kline(s):
    d = get(KLINE_URL.format(s), {'Referer': 'https://gu.qq.com/'})
    rows = d['data'][s].get('qfqday') or d['data'][s].get('day')
    return {r[0]: (float(r[2]), float(r[8]) * 1e4) for r in rows if len(r) > 8}


def stock_margin(code):
    f = urllib.parse.quote(f'(SCODE="{code}")')
    rows = get(EM_URL.format('RPTA_WEB_RZRQ_GGMX', f, 'DATE', 40), {})['result']['data']
    return [{**r, 'DATE': r['DATE'][:10]} for r in rows]


def market_margin():
    f = urllib.parse.quote("(DIM_DATE>='2026-08-01')")
    rows = get(EM_URL.format('RPTA_RZRQ_LSHJ', f, 'DIM_DATE', 80), {})['result']['data']
    return [{**r, 'DATE': r['DIM_DATE'][:10]} for r in rows]


def rate(rows, k):
    return rows[0]['RZYE'] / rows[k]['RZYE'] - 1 if len(rows) > k else None


fetched_at = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=8))).strftime('%Y-%m-%d %H:%M')
syms = ['sz399006'] + [sym(c) for c in OPTICAL] + [sym(c) for v in OTHERS.values() for c in v]
with ThreadPoolExecutor(12) as ex:
    K = dict(zip(syms, ex.map(kline, syms)))
dates = sorted(K['sz399006'])
last = dates[-1]
missing = [f'{s} 缺 {last} 日 K' for s in syms if last not in K[s]]

MM = market_margin()
SM = {code: stock_margin(code) for code in MARGIN}
margin_date = MM[0]['DATE']
if margin_date < last:
    missing.append(f'融资数据截至 {margin_date}，晚于行情 {last}（T+1 发布），{last} 的融资读数缺失')

record = {
    'params_version': PARAMS_VERSION, 'fetched_at_utc8': fetched_at,
    'price_cutoff': last, 'margin_cutoff': margin_date, 'missing': missing,
    'sources': {'kline': KLINE_URL.format('<代码>'), 'stock_margin': 'RPTA_WEB_RZRQ_GGMX', 'market_margin': 'RPTA_RZRQ_LSHJ'},
    'definitions': {
        '融资余额变化': 'RZYE(t) − RZYE(t−1)',
        '融资净买入': 'RZJME，原始字段；负值为净偿还',
        '买入−偿还': 'RZMRE − RZCHE',
        '残差': '融资余额变化 − 融资净买入；非零说明余额还受其他调整影响，两者不混用',
        '量比': '光模块池当日成交额 / 前 20 个交易日均值',
        '相对创业板': '光模块池等权收益 − 创业板指收益',
    },
    'signal1': {}, 'signal2': {}, 'signal3': {},
    'raw': {'market_margin': MM[:25], **{f'margin_{c}': SM[c][:25] for c in SM}},
}

print(f'光模块去杠杆三信号　纯数据核验记录　参数 {PARAMS_VERSION}')
print(f'取数 {fetched_at}（北京时间）　行情截至 {last}　融资截至 {margin_date}')
print('缺失项：' + ('；'.join(missing) if missing else '无'))

m5, m20 = rate(MM, 5), rate(MM, 20)
print(f'\n信号一　融资降速（全市场 {margin_date}：5 日 {m5 * 100:+.2f}%，20 日 {m20 * 100:+.2f}%）')
for code, name in MARGIN.items():
    rows = SM[code]
    c5, c20 = rate(rows, 5), rate(rows, 20)
    s1 = {'date': rows[0]['DATE'], 'rate5': c5, 'rate20': c20, 'market_rate5': m5, 'market_rate20': m20,
          'multiple5': c5 / m5 if m5 else None, 'multiple20': c20 / m20 if m20 else None, 'daily': []}
    print(f'  {name}：5 日 {c5 * 100:+.2f}%（全市场 {s1["multiple5"]:.1f} 倍），20 日 {c20 * 100:+.2f}%（{s1["multiple20"]:.1f} 倍）')
    print('    日期        余额(亿)  余额变化  融资买入  偿还   净买入(RZJME)  买入−偿还  残差(亿)')
    for i in range(min(SHOW_DAYS, len(rows) - 1)):
        r, p = rows[i], rows[i + 1]
        d_ye = r['RZYE'] - p['RZYE']
        net = r['RZJME'] if r['RZJME'] is not None else None
        diff = (r['RZMRE'] or 0) - (r['RZCHE'] or 0)
        resid = d_ye - net if net is not None else None
        s1['daily'].append({'date': r['DATE'], 'RZYE': r['RZYE'], 'dRZYE': d_ye, 'RZMRE': r['RZMRE'],
                            'RZCHE': r['RZCHE'], 'RZJME': net, 'buy_minus_repay': diff, 'residual': resid})
        fmt = lambda v: f'{v / 1e8:+8.2f}' if v is not None else '     缺'
        print(f'    {r["DATE"]}  {r["RZYE"] / 1e8:8.1f}  {fmt(d_ye)}  {r["RZMRE"] / 1e8:7.1f}  {r["RZCHE"] / 1e8:5.1f}'
              f'  {fmt(net)}       {fmt(diff)}  {fmt(resid)}')
    record['signal1'][code] = s1


def ret(codes, d, p):
    rs = [K[sym(c)][d][0] / K[sym(c)][p][0] - 1 for c in codes if d in K[sym(c)] and p in K[sym(c)]]
    return sum(rs) / len(rs)


def pool_amt(codes, d):
    return sum(K[sym(c)][d][1] for c in codes if d in K[sym(c)])


def vol_ratio(i):
    return pool_amt(OPTICAL, dates[i]) / (sum(pool_amt(OPTICAL, x) for x in dates[i - 20:i]) / 20)


panic_i = dates.index(PANIC_DAY)
panic_ratio = vol_ratio(panic_i)
record['signal2'] = {'panic_day': PANIC_DAY, 'panic_ratio': panic_ratio, 'daily': []}
print(f'\n信号二　下跌日缩量（恐慌日 {PANIC_DAY} 量比 {panic_ratio:.2f}；只列恐慌日之后）')
print('  日期        光池涨跌  量比   相对恐慌日量比')
for i in range(panic_i + 1, len(dates)):
    d = dates[i]
    o = ret(OPTICAL, d, dates[i - 1])
    vr = vol_ratio(i)
    record['signal2']['daily'].append({'date': d, 'pool_ret': o, 'vol_ratio': vr, 'down_day': o < 0})
    tag = f'{vr / panic_ratio:.2f}' if o < 0 else '（上涨日）'
    print(f'  {d}  {o * 100:+6.1f}%  {vr:5.2f}   {tag}')

print('\n信号三　相对强度（光模块池等权 − 创业板指；辅助列：− 其他 AI 硬件三池均值）')
for k in (5, 20):
    d, p = last, dates[-1 - k]
    o = ret(OPTICAL, d, p)
    cyb = K['sz399006'][d][0] / K['sz399006'][p][0] - 1
    oth = sum(ret(v, d, p) for v in OTHERS.values()) / len(OTHERS)
    record['signal3'][f'{k}d'] = {'pool': o, 'chinext': cyb, 'excess_chinext': o - cyb, 'excess_other_ai': o - oth}
    print(f'  {k:2d} 日：光池 {o * 100:+.1f}%，创业板 {cyb * 100:+.1f}%，差 {(o - cyb) * 100:+.1f}pp；相对其他 AI 硬件 {(o - oth) * 100:+.1f}pp')

print('\n本记录只有读数，不含买入或减持结论。阈值未裁定，三信号均不判定为"已出现"。')

if '--save' in sys.argv:
    os.makedirs(SAVE_DIR, exist_ok=True)
    path = os.path.join(SAVE_DIR, f'{last}.json')
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(record, f, ensure_ascii=False, indent=1)
    print(f'已保存 {os.path.relpath(path)}')
