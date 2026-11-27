"""全市场扫描：宽度、行业强弱、融资、AI 链条分环节（研究层，OBSERVATION，不产生动作）

回答两个问题，全部用可复算的公开数据：
  甲 我们持有的方向和它周围，数据在变好还是变坏
  乙 钱从哪里出来、往哪里去：哪些行业和环节已经站稳、哪些还在创新低

用法：python3 scripts/market-scan.py [--last 2026-11-19] [--prev 2026-11-18] [--save]
  --last      行情截止日（只用已收盘的交易日；缺省取创业板指日 K 的最新一日）
  --prev      对比日（缺省取截止日的前一个交易日）；两天用同一批股票、同一份 K 线重算
  --anchors   区间起点，逗号分隔（缺省 2026-10-09,2026-11-03,2026-11-13）
  --min-cap   个股入样的总市值下限，亿元（缺省 100）
  --cache     缓存目录（缺省 /tmp/market-scan）；行业成份、K 线、融资按日缓存，可断点续跑
  --refresh   忽略缓存重新抓取
  --no-global 不输出美股、港股与 A 股指数对照表
  --save      读数写入 战略组合2026-2030/数据/全市场扫描/<截止日>.json

输出只有百分比、比值、只数、天数和日期，不含价格与金额，不含账户数据。

数据源：新浪行情中心（申万二级行业成份、总市值）；腾讯日 K（newfqkline、usfqkline、hkfqkline，前复权）；
       东方财富数据中心（RPTA_WEB_RZRQ_GGMX 个股融资、RPTA_RZRQ_LSHJ 全市场融资，T+1 发布）。

口径：
  站上 N 日线   收盘价高于最近 N 个交易日收盘均值
  20 日线向上   今天的 20 日均值高于 5 个交易日前的 20 日均值
  60 日新低     收盘价不高于最近 60 个交易日（含当日）的最低收盘价
  安静天数      距最近一次收盘创 60 日新低已过去的交易日数
  大跌日        首个区间起点以来创业板指单日跌幅不小于 2% 的交易日；大跌日平均是个股在这些天的平均涨跌
  量比          近 5 日日均成交额 / 此前 20 日日均成交额
  状态          强：站上 20 日与 60 日线、20 日线向上、安静不少于 10 天；偏强：站上 60 日线；
                反弹：站上 20 日线、未站上 60 日线；弱：20 日线下方且安静不足 5 天；其余为偏弱
  行业、环节的涨跌按总市值加权；融资按成份股融资余额合计
"""
import argparse
import collections
import datetime
import json
import os
import re
import statistics
import sys
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

CHAIN = {
    '光模块、光器件': ['sz300308', 'sz300502', 'sz300394', 'sh688498', 'sz002281'],
    'PCB、覆铜板': ['sz002463', 'sz002916', 'sh600183', 'sz300476'],
    '服务器、整机': ['sh601138', 'sz000977', 'sh603019', 'sz000938'],
    '液冷、电源': ['sz002837', 'sz002851', 'sz002335', 'sz301018'],
    '国产 AI 芯片设计': ['sh688256', 'sh688041', 'sh688802', 'sh688795', 'sh688047'],
    '晶圆代工': ['sh688981', 'sh688347', 'sh688249'],
    '半导体设备': ['sz002371', 'sh688012', 'sh688072', 'sh688120', 'sh688082', 'sz300604'],
    '半导体材料': ['sh688126', 'sz300666', 'sh688019', 'sz300054', 'sz002409'],
    '先进封装、测试': ['sh688820', 'sh600584', 'sz002156', 'sh688372'],
    '存储': ['sh603986', 'sh688008', 'sh688525', 'sz301308', 'sz001309', 'sz301666'],
    '运营商、算力租赁': ['sh600941', 'sh601728', 'sh600050', 'sz300442'],
    'AI 软件、应用': ['sh688111', 'sz002230', 'sz300033', 'sh600588', 'sh601360'],
    'AI 制药、创新药': ['sh603259', 'sh600276', 'sh688235', 'sz300347', 'sz300759', 'sz002821'],
    '机器人': ['sz300124', 'sz002050', 'sh601689', 'sh688017', 'sz002472', 'sh601100', 'sz002747'],
    '商业航天、卫星': ['sh600118', 'sh601698', 'sh600879', 'sz001270', 'sz300762'],
    '新能源（持仓对照）': ['sz300750'],
}
A_INDEX = {'sz399006': '创业板指', 'sh000688': '科创50', 'sh000300': '沪深300', 'sh000001': '上证指数',
           'sh000905': '中证500', 'sh000852': '中证1000', 'sh000922': '中证红利'}
US = {'.IXIC': '纳指', '.INX': '标普500', 'SOXX': '费城半导体ETF', 'NVDA': '英伟达', 'AMD': 'AMD', 'AVGO': '博通',
      'MU': '美光', 'TSM': '台积电ADR', 'ASML': 'ASML', 'AMAT': '应用材料', 'MSFT': '微软', 'GOOGL': '谷歌',
      'META': 'Meta', 'AMZN': '亚马逊', 'ORCL': '甲骨文', 'COHR': 'Coherent', 'LITE': 'Lumentum', 'ANET': 'Arista',
      'VRT': 'Vertiv', 'IGV': '软件ETF', 'XLU': '公用事业ETF', 'XLE': '能源ETF', 'XLF': '金融ETF', 'XLV': '医疗ETF',
      'IWM': '罗素2000ETF', 'GLD': '黄金ETF', 'TLT': '20年美债ETF', 'KWEB': '中概互联ETF'}
HK = {'hkHSI': '恒生指数', 'hkHSTECH': '恒生科技', 'hk00981': '中芯国际H', 'hk01347': '华虹半导体H',
      'hk00700': '腾讯', 'hk09988': '阿里巴巴'}
SINA = 'https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.'
EM = 'https://datacenter-web.eastmoney.com/api/data/v1/get?'
KLINE = 'https://web.ifzq.gtimg.cn/appstock/app/{}/get?param={},day,,,{},qfq'
SAVE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '战略组合2026-2030', '数据', '全市场扫描')

ap = argparse.ArgumentParser(add_help=True, description='全市场扫描（只输出百分比）')
ap.add_argument('--last')
ap.add_argument('--prev')
ap.add_argument('--anchors', default='2026-10-09,2026-11-03,2026-11-13')
ap.add_argument('--min-cap', type=float, default=100.0)
ap.add_argument('--cache', default='/tmp/market-scan')
ap.add_argument('--refresh', action='store_true')
ap.add_argument('--no-global', action='store_true')
ap.add_argument('--save', action='store_true')
ARGS = ap.parse_args()
ANCHORS = [a.strip() for a in ARGS.anchors.split(',') if a.strip()]
os.makedirs(ARGS.cache, exist_ok=True)


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def get(url, referer, tries=5, wait=1.5):
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120', 'Referer': referer})
            return urllib.request.urlopen(req, timeout=25).read()
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(wait * (i + 1))
    raise last


def cached(name, build, fresh=lambda x: True):
    path = os.path.join(ARGS.cache, name)
    if not ARGS.refresh and os.path.exists(path):
        data = json.load(open(path, encoding='utf-8'))
        if fresh(data):
            return data
    data = build()
    json.dump(data, open(path, 'w', encoding='utf-8'), ensure_ascii=False)
    return data


def kline(sym, api='newfqkline', n=130):
    """返回 [[日期, 收盘, 成交额]]；取不到返回 None。"""
    try:
        d = json.loads(get(KLINE.format(api, sym, n), 'https://gu.qq.com/', tries=4))['data'][sym]
        rows = d.get('qfqday') or d.get('day')
        return [[r[0], float(r[2]), float(r[8]) if len(r) > 8 and r[8] else 0.0] for r in rows]
    except Exception:  # noqa: BLE001
        return None


def fetch_members():
    """申万二级行业 → 成份股（代码、名称、总市值亿元）。新浪限流时自动放慢，按行业断点续抓。"""
    raw = get(SINA + 'getHQNodes', 'https://vip.stock.finance.sina.com.cn/mkt/').decode('gbk', 'ignore')
    nodes = [(json.loads('"' + a + '"'), b) for a, b in re.findall(r'\["([^"]+)","","(sw2_\d+)"\]', raw)]
    part_path = os.path.join(ARGS.cache, 'members.part.json')
    out = json.load(open(part_path, encoding='utf-8')) if os.path.exists(part_path) and not ARGS.refresh else {}
    for i, (name, node) in enumerate(nodes):
        if node in out:
            continue
        rows, p = [], 1
        while True:
            u = SINA + f'getHQNodeData?page={p}&num=80&sort=mktcap&asc=0&node={node}'
            r = json.loads(get(u, 'https://vip.stock.finance.sina.com.cn/mkt/', tries=6, wait=5).decode('gbk', 'ignore') or '[]') or []
            rows += [[x['symbol'], x['name'], round(float(x['mktcap'] or 0) / 1e4, 2)] for x in r]
            time.sleep(0.5)
            if len(r) < 80:
                break
            p += 1
        out[node] = {'name': name, 'rows': rows}
        json.dump(out, open(part_path, 'w', encoding='utf-8'), ensure_ascii=False)
        if i % 20 == 0:
            log(f'行业成份 {i + 1}/{len(nodes)}')
    os.remove(part_path)
    return {'fetched': datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%d'), 'nodes': out}


def em_pages(report, columns, flt, sort, max_pages=99):
    rows, p = [], 1
    while True:
        q = urllib.parse.urlencode(dict(reportName=report, columns=columns, filter=flt, pageSize=500, pageNumber=p, sortColumns=sort, sortTypes=-1))
        r = json.loads(get(EM + q, 'https://data.eastmoney.com/'))
        if not r.get('result'):
            break
        rows += r['result']['data']
        if p >= min(r['result']['pages'], max_pages):
            break
        p += 1
        time.sleep(0.2)
    return rows


def margin_day(d):
    """某日全部个股融资余额 {代码: 余额}；只在本机缓存，用来算变化率，不输出金额。"""
    def build():
        rows = em_pages('RPTA_WEB_RZRQ_GGMX', 'SCODE,RZYE', f"(DATE='{d}')", 'SCODE')
        return {x['SCODE']: x['RZYE'] for x in rows if x.get('RZYE')}
    return cached(f'margin-{d}.json', build, fresh=lambda x: len(x) > 1000)


def metrics(rows, last, bad):
    rows = [r for r in rows if r[0] <= last]
    if len(rows) < 70 or rows[-1][0] != last:
        return None
    D = [r[0] for r in rows]
    C = [r[1] for r in rows]
    A = [r[2] for r in rows]
    ix = {d: i for i, d in enumerate(D)}

    def since(d0):
        i = max((i for i, d in enumerate(D) if d <= d0), default=None)
        return C[-1] / C[i] - 1 if i is not None else None

    ma20, ma60, ma20p = sum(C[-20:]) / 20, sum(C[-60:]) / 60, sum(C[-25:-5]) / 20
    quiet = 0
    for i in range(len(C) - 1, 59, -1):
        if C[i] <= min(C[i - 59:i + 1]):
            break
        quiet += 1
    hi5 = any(C[i] >= max(C[max(0, i - 59):i + 1]) for i in range(len(C) - 5, len(C)))
    dc = [C[ix[d]] / C[ix[d] - 1] - 1 for d in bad if d in ix and ix[d] > 0]
    base = sum(A[-25:-5])
    m = dict(r1=C[-1] / C[-2] - 1, a20=C[-1] > ma20, a60=C[-1] > ma60, up=ma20 > ma20p, h60=hi5, quiet=quiet,
             d60=C[-1] / ma60 - 1, dc=sum(dc) / len(dc) if dc else None,
             amt=(sum(A[-5:]) / 5) / (base / 20) if base else None)
    for a in ANCHORS:
        m['r' + a] = since(a)
    return m


def state(m):
    if m['a20'] and m['a60'] and m['up'] and m['quiet'] >= 10:
        return '强'
    if m['quiet'] < 5 and not m['a20']:
        return '弱'
    if m['a20'] and not m['a60']:
        return '反弹'
    if m['a60']:
        return '偏强'
    return '偏弱'


def P(x, nd=0):
    return '—' if x is None else f'{x * 100:+.{nd}f}%'


def S(x):
    return '—' if x is None else f'{x * 100:.0f}%'


def short(d):
    return f'{int(d[5:7])}/{int(d[8:10])}'


# ── 取数 ────────────────────────────────────────────────────────────────
cy = kline('sz399006')
if not cy:
    sys.exit('创业板指日 K 取不到，停止')
DAYS = [r[0] for r in cy]
LAST = ARGS.last or DAYS[-1]
if LAST not in DAYS:
    sys.exit(f'{LAST} 不是交易日或行情尚未更新（最新 {DAYS[-1]}）')
PREV = ARGS.prev or DAYS[DAYS.index(LAST) - 1]
log(f'截止日 {LAST}，对比日 {PREV}')

MEM = cached('members.json', fetch_members, fresh=lambda x: x.get('fetched', '') >= LAST)
stocks, code2ind = {}, {}
for v in MEM['nodes'].values():
    for s, n, cap in v['rows']:
        code2ind[s[2:]] = v['name']
        if s[:2] in ('sh', 'sz') and 'ST' not in n:
            stocks[s] = dict(n=n.replace(' ', ''), ind=v['name'], cap=cap)
chain_syms = [s for L in CHAIN.values() for s in L]
want = sorted({s for s, v in stocks.items() if v['cap'] >= ARGS.min_cap} | {s for s in chain_syms if s in stocks})
log(f'全部 {len(stocks)} 只，入样 {len(want)} 只（总市值不低于 {ARGS.min_cap:.0f} 亿元，加链条个股）')


def fetch_k():
    out = {}
    todo = want + list(A_INDEX)
    for rnd in range(3):
        todo = [s for s in todo if s not in out]
        if not todo:
            break
        with ThreadPoolExecutor(12 if rnd == 0 else 4) as ex:
            for i, (s, rows) in enumerate(zip(todo, ex.map(kline, todo))):
                if rows:
                    out[s] = rows
                if i % 400 == 0:
                    log(f'日 K 第 {rnd + 1} 轮 {i}/{len(todo)}')
    return {'last': LAST, 'k': out}


KD = cached(f'k-{LAST}.json', fetch_k, fresh=lambda x: x.get('last') == LAST and len(x['k']) > 0.9 * len(want))
K = KD['k']
cyc = {r[0]: r[1] for r in K['sz399006']}
cd = sorted(cyc)


def bad_days(last):
    return [d for i, d in enumerate(cd) if i > 0 and ANCHORS[0] <= d <= last and cyc[d] / cyc[cd[i - 1]] - 1 <= -0.02]


tot = em_pages('RPTA_RZRQ_LSHJ', 'DIM_DATE,RZYE,RZMRE,RZCHE', '', 'DIM_DATE', max_pages=1)
TOT = {r['DIM_DATE'][:10]: r for r in tot}
mdays = sorted(TOT)
M_LAST = max(d for d in mdays if d <= LAST)
M_PREV = mdays[mdays.index(M_LAST) - 1]
m_anchor = {a: max(d for d in mdays if d <= a) for a in ANCHORS}
MG = {d: margin_day(d) for d in sorted(set(list(m_anchor.values()) + [M_LAST, M_PREV]))}
log(f'融资截至 {M_LAST}')


def run(last):
    bad = bad_days(last)
    R = {}
    for s in want:
        if s in K:
            m = metrics(K[s], last, bad)
            if m:
                R[s] = {**stocks[s], **m}
    return R


R1, R0 = run(LAST), run(PREV)
UNI = [s for s in R1 if s in R0 and R1[s]['cap'] >= ARGS.min_cap]


def breadth(R):
    n = len(UNI)
    f = lambda cond: sum(1 for s in UNI if cond(R[s])) / n  # noqa: E731
    out = {'站上 20 日线': f(lambda v: v['a20']), '站上 60 日线': f(lambda v: v['a60']), '20 日线向上': f(lambda v: v['up']),
           '近 5 日创过 60 日新高': f(lambda v: v['h60']), '近 5 日创过 60 日新低': f(lambda v: v['quiet'] < 5),
           '近 10 日创过 60 日新低': f(lambda v: v['quiet'] < 10), '当日上涨': f(lambda v: v['r1'] > 0)}
    med = {'当日涨跌中位数': statistics.median(R[s]['r1'] for s in UNI)}
    for a in ANCHORS:
        med[f'{short(a)} 以来涨跌中位数'] = statistics.median(R[s]['r' + a] for s in UNI if R[s]['r' + a] is not None)
    return out, med


def mg_chg(codes, d0, d1):
    a = sum(MG[d0].get(c, 0) for c in codes)
    b = sum(MG[d1].get(c, 0) for c in codes)
    return b / a - 1 if a and b else None


def group(R, syms, codes):
    L = [R[s] for s in syms if s in R]
    if not L:
        return None
    w = sum(v['cap'] for v in L)
    cw = lambda k: (sum(v[k] * v['cap'] for v in L if v[k] is not None) / w) if w else None  # noqa: E731
    g = dict(n=len(L), r1=cw('r1'), dc=cw('dc'), a20=sum(v['a20'] for v in L) / len(L), a60=sum(v['a60'] for v in L) / len(L),
             h60=sum(v['h60'] for v in L) / len(L), low5=sum(v['quiet'] < 5 for v in L) / len(L),
             amt=statistics.median([v['amt'] for v in L if v['amt']] or [0]),
             mg1=mg_chg(codes, M_PREV, M_LAST))
    for a in ANCHORS:
        g['r' + a] = cw('r' + a)
        g['mg' + a] = mg_chg(codes, m_anchor[a], M_LAST)
    return g


# ── 输出 ────────────────────────────────────────────────────────────────
OUT = {'last': LAST, 'prev': PREV, 'margin_last': M_LAST, 'anchors': ANCHORS, 'min_cap_yi': ARGS.min_cap, 'sample': len(UNI),
       'members_fetched': MEM['fetched'], 'sources': {'members': SINA + 'getHQNodeData', 'kline': KLINE.format('newfqkline', '<代码>', 130),
                                                      'stock_margin': 'RPTA_WEB_RZRQ_GGMX', 'market_margin': 'RPTA_RZRQ_LSHJ'}}
print(f'# 全市场扫描　行情截至 {LAST}　融资截至 {M_LAST}（T+1）　对比日 {PREV}')
print(f'\n样本：总市值不低于 {ARGS.min_cap:.0f} 亿元、非 ST、两天都有完整日 K 的沪深个股 {len(UNI)} 只（行业成份抓取日 {MEM["fetched"]}，UTC）。只有读数，不含买卖结论。')

b1, md1 = breadth(R1)
b0, md0 = breadth(R0)
print('\n## 一、全市场宽度\n')
print(f'| 指标 | {short(PREV)} | {short(LAST)} | 变化 |\n|---|---|---|---|')
for k in b1:
    print(f'| {k} | {S(b0[k])} | {S(b1[k])} | {(b1[k] - b0[k]) * 100:+.0f}pp |')
for k in md1:
    print(f'| {k} | {P(md0[k], 1)} | {P(md1[k], 1)} | {(md1[k] - md0[k]) * 100:+.1f}pp |')
OUT['breadth'] = {'last': {**b1, **md1}, 'prev': {**b0, **md0}}

print('\n## 二、A 股指数\n')
print('| 指数 | 当日 | ' + ' | '.join(f'{short(a)} 以来' for a in ANCHORS) + ' | 20 日线 | 60 日线 | 距 60 日线 | 安静天数 |\n|---|' + '---|' * (len(ANCHORS) + 5))
OUT['index'] = {}
for s, n in A_INDEX.items():
    m = metrics(K[s], LAST, []) if s in K else None
    if not m:
        print(f'| {n} | 无数据 |')
        continue
    OUT['index'][n] = m
    print(f"| {n} | {P(m['r1'], 2)} | " + ' | '.join(P(m['r' + a], 1) for a in ANCHORS) + f" | {'上' if m['a20'] else '下'} | {'上' if m['a60'] else '下'} | {P(m['d60'], 1)} | {m['quiet']} |")

print(f'\n## 三、全市场融资余额（截至 {M_LAST}）\n')
ry = lambda d: TOT[d]['RZYE']  # noqa: E731
i1 = mdays.index(M_LAST)
streak = 0
while i1 - streak > 0 and ry(mdays[i1 - streak]) < ry(mdays[i1 - streak - 1]):
    streak += 1
mrow = {'1 日': ry(M_LAST) / ry(M_PREV) - 1, '5 日': ry(M_LAST) / ry(mdays[i1 - 5]) - 1, '20 日': ry(M_LAST) / ry(mdays[i1 - 20]) - 1}
for a in ANCHORS:
    mrow[f'{short(m_anchor[a])} 以来'] = ry(M_LAST) / ry(m_anchor[a]) - 1
lo60 = min(mdays[max(0, i1 - 59):i1 + 1], key=ry)
print('| ' + ' | '.join(mrow) + ' | 连续下降天数 | 近 60 日最低出现在 |\n|' + '---|' * (len(mrow) + 2))
print('| ' + ' | '.join(P(v, 2) for v in mrow.values()) + f' | {streak} | {short(lo60)} |')
buy = [TOT[d]['RZMRE'] for d in mdays[max(0, i1 - 24):i1 + 1]]
rank = sorted(buy).index(TOT[M_LAST]['RZMRE']) + 1
print(f'\n{short(M_LAST)} 融资买入额在近 {len(buy)} 个交易日里由低到高排第 {rank}。')
OUT['margin_total'] = {**mrow, 'down_streak': streak, 'low60_date': lo60, 'buy_rank_from_low_25d': rank}

print('\n## 四、申万二级行业（成份不少于 4 只；按首个区间起点以来涨跌排序）\n')
ind_syms, ind_codes = collections.defaultdict(list), collections.defaultdict(list)
for s in UNI:
    ind_syms[R1[s]['ind']].append(s)
for c, name in code2ind.items():
    ind_codes[name].append(c)
rows = []
for name, syms in ind_syms.items():
    if len(syms) < 4:
        continue
    g1, g0 = group(R1, syms, ind_codes[name]), group(R0, syms, ind_codes[name])
    rows.append({'name': name, **g1, 'a60_prev': g0['a60'], 'a20_prev': g0['a20']})
rows.sort(key=lambda r: -r['r' + ANCHORS[0]])
hdr = ['行业', '只数', '当日'] + [f'{short(a)} 以来' for a in ANCHORS] + ['大跌日平均', '20 线上', f'60 线上（{short(PREV)}→{short(LAST)}）', '近 5 日新高', '近 5 日新低', '量比',
                                                                     f'融资 {short(m_anchor[ANCHORS[0]])} 起', f'融资 {short(m_anchor[ANCHORS[-1]])} 起', '融资 1 日']
print('| ' + ' | '.join(hdr) + ' |\n|' + '---|' * len(hdr))
for r in rows:
    print(f"| {r['name']} | {r['n']} | {P(r['r1'], 1)} | " + ' | '.join(P(r['r' + a]) for a in ANCHORS)
          + f" | {P(r['dc'], 1)} | {S(r['a20'])} | {S(r['a60_prev'])}→{S(r['a60'])} | {S(r['h60'])} | {S(r['low5'])} | {r['amt']:.2f} | "
          + f"{P(r['mg' + ANCHORS[0]])} | {P(r['mg' + ANCHORS[-1]])} | {P(r['mg1'], 1)} |")
OUT['industries'] = rows

print('\n## 五、AI 链条分环节\n')
hdr = ['环节', '当日'] + [f'{short(a)} 以来' for a in ANCHORS] + ['大跌日平均', f'站上 60 日线（{short(PREV)}→{short(LAST)}）', f'融资 {short(m_anchor[ANCHORS[0]])} 起', f'融资 {short(m_anchor[ANCHORS[-1]])} 起', '融资 1 日']
print('| ' + ' | '.join(hdr) + ' |\n|' + '---|' * len(hdr))
OUT['chain'] = {}
detail = []
for link, syms in CHAIN.items():
    codes = [s[2:] for s in syms]
    g1, g0 = group(R1, syms, codes), group(R0, syms, codes)
    if not g1:
        continue
    n60 = lambda R: sum(1 for s in syms if s in R and R[s]['a60'])  # noqa: E731
    print(f"| {link} | {P(g1['r1'], 1)} | " + ' | '.join(P(g1['r' + a]) for a in ANCHORS)
          + f" | {P(g1['dc'], 1)} | {n60(R0)}/{g0['n'] if g0 else 0}→{n60(R1)}/{g1['n']} | {P(g1['mg' + ANCHORS[0]])} | {P(g1['mg' + ANCHORS[-1]])} | {P(g1['mg1'], 1)} |")
    OUT['chain'][link] = {'group': g1, 'stocks': {}}
    for s in syms:
        if s not in R1:
            detail.append(f'| {link} | {stocks.get(s, {}).get("n", s)} | 日 K 不足 70 日或缺当日 |')
            continue
        m = R1[s]
        st1, st0 = state(m), state(R0[s]) if s in R0 else '—'
        mg = {a: mg_chg([s[2:]], m_anchor[a], M_LAST) for a in ANCHORS}
        mg1 = mg_chg([s[2:]], M_PREV, M_LAST)
        OUT['chain'][link]['stocks'][m['n']] = {**{k: v for k, v in m.items() if k not in ('cap', 'n', 'ind')}, 'state': st1, 'state_prev': st0,
                                                'mg1': mg1, **{'mg' + a: v for a, v in mg.items()}}
        detail.append(f"| {link} | {m['n']} | {st1 if st1 == st0 else st0 + '→' + st1} | {P(m['r1'], 1)} | " + ' | '.join(P(m['r' + a]) for a in ANCHORS)
                      + f" | {P(m['d60'], 1)} | {m['quiet']} | {P(m['dc'], 1)} | " + ' | '.join(P(mg[a]) for a in ANCHORS) + f" | {P(mg1, 1)} |")
hdr = ['环节', '个股', '状态', '当日'] + [f'{short(a)} 以来' for a in ANCHORS] + ['距 60 日线', '安静天数', '大跌日平均'] + [f'融资 {short(m_anchor[a])} 起' for a in ANCHORS] + ['融资 1 日']
print('\n| ' + ' | '.join(hdr) + ' |\n|' + '---|' * len(hdr))
print('\n'.join(detail))

if not ARGS.no_global:
    def us_k(sym):
        for c in ['us' + sym] + ['us' + sym + x for x in ('.OQ', '.N', '.AM', '.PS')]:
            rows = kline(c, 'usfqkline')
            # 后缀不对时腾讯会返回多年前的旧序列接上最新一日，按日期连续性剔除
            if rows and len(rows) > 70 and (datetime.date.fromisoformat(rows[-1][0]) - datetime.date.fromisoformat(rows[-70][0])).days < 130:
                return rows
        return None

    with ThreadPoolExecutor(8) as ex:
        GK = dict(zip(US, ex.map(us_k, US)))
        GK.update(zip(HK, ex.map(lambda s: kline(s, 'hkfqkline'), HK)))
    print('\n## 六、美股与港股对照（各自最新收盘日）\n')
    print('| 标的 | 最新日 | 当日 | ' + ' | '.join(f'{short(a)} 以来' for a in ANCHORS) + ' | 20 日线 | 60 日线 | 距 60 日线 | 安静天数 |\n|---|' + '---|' * (len(ANCHORS) + 6))
    OUT['global'] = {}
    for s, n in {**US, **HK}.items():
        rows = GK.get(s)
        m = metrics(rows, rows[-1][0], []) if rows else None
        if not m:
            print(f'| {n} | 无数据 |')
            continue
        OUT['global'][n] = {'date': rows[-1][0], **m}
        print(f"| {n} | {short(rows[-1][0])} | {P(m['r1'], 1)} | " + ' | '.join(P(m['r' + a]) for a in ANCHORS)
              + f" | {'上' if m['a20'] else '下'} | {'上' if m['a60'] else '下'} | {P(m['d60'], 1)} | {m['quiet']} |")

if ARGS.save:
    def rnd(x):
        if isinstance(x, float):
            return round(x, 4)
        if isinstance(x, dict):
            return {k: rnd(v) for k, v in x.items() if k != 'cap'}
        if isinstance(x, list):
            return [rnd(v) for v in x]
        return x
    os.makedirs(SAVE_DIR, exist_ok=True)
    path = os.path.join(SAVE_DIR, f'{LAST}.json')
    json.dump(rnd(OUT), open(path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    log('已保存', os.path.relpath(path))
