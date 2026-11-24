"""《战略书》第三节的轮动回测：半年里按动量集中轮动，到期总资产落在哪里（研究层，OBSERVATION，不产生动作）

打法：每 20 个交易日，在股票池里选站上 20 日与 60 日线、20 日线向上的票，按 60 日涨幅取前 K 只等权，
股票合计占总资产 W；持仓收盘跌破 60 日线，下一交易日卖出；单边费用 0.3%；总资产跌到停手线即全部卖出、到期不再买入。
窗口：2019-01 起每 5 个交易日起步一次，各走 120 个交易日（约半年）。“深跌后起步”= 起步日创业板指在 250 日高点下方 30% 以上。

局限（读数时必须一起看）：
  股票池是按今天眼光挑的 AI 链及相关环节（同 scripts/market-scan.py 的 CHAIN），有幸存者偏差，结果偏乐观
  只用价格动量；融资余额、主力资金没有进入回测
  窗口重叠，“深跌后起步”只来自约 5 段独立行情

用法：python3 scripts/rotation-backtest.py [--cut 2026-11-23] [--save]
数据源：腾讯日 K（前复权收盘价，逐年分段取数）。输出只有比例，不含金额。
"""
import datetime
import json
import os
import statistics
import sys
import time
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
INDEX = 'sz399006'
PATHS = [('A 分散', 0.5, 4), ('B 证据集中轮动', 1.0, 5), ('C 三只重仓', 1.0, 3)]
TARGETS = (1.78, 1.50, 1.25)
STOP, HORIZON, REBALANCE, COST = 0.85, 120, 20, 0.003
SAVE_DIR = os.path.join(os.path.dirname(__file__), '..', '战略组合2026-2030', '数据', '目标推导')


def arg(name, default):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default


CUT = arg('--cut', None)


def get(url):
    last = None
    for i in range(5):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0', 'Referer': 'https://gu.qq.com/'})
            return urllib.request.urlopen(req, timeout=20).read()
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(2 * (i + 1))
    raise last


def kline(sym):
    # 腾讯单次最多返回 640 根，按自然年分段取
    out = {}
    for y in range(2018, datetime.date.today().year + 1):
        d = json.loads(get(f'https://web.ifzq.gtimg.cn/appstock/app/newfqkline/get?param={sym},day,{y}-01-01,{y}-12-31,640,qfq'))['data'][sym]
        out.update({r[0]: float(r[2]) for r in d.get('qfqday') or d.get('day') or []})
    return sym, {k: v for k, v in out.items() if CUT is None or k <= CUT}


with ThreadPoolExecutor(8) as ex:
    K = dict(ex.map(kline, [s for v in CHAIN.values() for s in v] + [INDEX]))
idx = K.pop(INDEX)
dates = sorted(idx)
syms = list(K)
px = {}
for s in syms:
    row, last = [], None
    for d in dates:
        last = K[s].get(d, last)
        row.append(last)
    px[s] = row


def ma(s, i, n):
    xs = px[s][i - n + 1:i + 1]
    return None if len(xs) < n or None in xs else sum(xs) / n


def momentum(s, i):
    p, m20, m60, m20_prev = px[s][i], ma(s, i, 20), ma(s, i, 60), ma(s, i - 5, 20)
    if None in (p, m20, m60, m20_prev) or px[s][i - 60] is None:
        return None
    return p / px[s][i - 60] - 1 if p > m20 and p > m60 and m20 > m20_prev else None


def walk(i0, weight, k):
    cash, vals, low = 1.0, {}, 1.0
    for t in range(i0, min(i0 + HORIZON, len(dates) - 1)):
        for s in vals:
            vals[s] *= px[s][t + 1] / px[s][t]
        nav = cash + sum(vals.values())
        low = min(low, nav)
        if nav <= STOP:
            return cash + sum(vals.values()) * (1 - COST), low, True
        for s in [s for s in vals if (m := ma(s, t + 1, 60)) and px[s][t + 1] < m]:
            cash += vals.pop(s) * (1 - COST)
        if (t - i0) % REBALANCE == 0:
            ranked = sorted((r, s) for s in syms if (r := momentum(s, t + 1)) is not None)[::-1][:k]
            picks = [s for _, s in ranked]
            for s in [s for s in vals if s not in picks]:
                cash += vals.pop(s) * (1 - COST)
            per = (cash + sum(vals.values())) * weight / k
            for s in picks:
                add = min(per - vals.get(s, 0), cash)
                if add > 0:
                    cash -= add
                    vals[s] = vals.get(s, 0) + add * (1 - COST)
    return cash + sum(vals.values()), low, False


def summary(navs):
    ends = [x[0] for x in navs]
    return {**{f'reach_{t:.2f}': sum(e >= t for e in ends) / len(ends) for t in TARGETS},
            'median': statistics.median(ends), 'p5': statistics.quantiles(ends, n=20)[0], 'worst': min(ends),
            'stopped': sum(x[2] for x in navs) / len(navs)}


starts = [i for i in range(260, len(dates) - HORIZON - 1, 5) if dates[i] >= '2019-01-01']
close = [idx[d] for d in dates]
deep = [i for i in starts if close[i] / max(close[i - 250:i + 1]) - 1 <= -0.30]
fetched = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=8))).strftime('%Y-%m-%d %H:%M')
print(f'取数 {fetched}（北京时间）　行情截至 {dates[-1]}　窗口 {len(starts)} 个（{dates[starts[0]]} 至 {dates[starts[-1]]}），深跌后起步 {len(deep)} 个')
print(f'停手线 {STOP:.0%}，到期 {HORIZON} 个交易日，每 {REBALANCE} 日重排，单边费用 {COST:.1%}\n')
print('| 路径 | 股票 / 只数 | 窗口 | 到 178 | 到 150 | 到 125 | 中位 | 5% 分位 | 最坏 | 触发停手 |')
print('|---|---|---|---|---|---|---|---|---|---|')
paths = []
for name, weight, k in PATHS:
    for label, group in (('全部', starts), ('深跌后起步', deep)):
        s = summary([walk(i, weight, k) for i in group])
        paths.append({'path': name, 'weight': weight, 'k': k, 'windows': label, **s})
        print(f"| {name} | {weight:.0%} / {k} | {label} | {s['reach_1.78']:.0%} | {s['reach_1.50']:.0%} | {s['reach_1.25']:.0%} | "
              f"{s['median'] * 100:.0f} | {s['p5'] * 100:.0f} | {s['worst'] * 100:.0f} | {s['stopped']:.0%} |")
best = [max(px[s][i + HORIZON] / px[s][i] for s in syms if px[s][i] and px[s][i + HORIZON]) for i in starts]
index_end = [close[i + HORIZON] / close[i] for i in starts]
print(f'\n事后看，每个窗口里池内涨得最多那一只：中位 {statistics.median(best) - 1:+.0%}，超过 +78% 的窗口占 {sum(b >= 1.78 for b in best) / len(best):.0%}')
print(f'创业板指本身半年涨 78% 以上的窗口占 {sum(x >= 1.78 for x in index_end) / len(index_end):.0%}，中位 {statistics.median(index_end) - 1:+.0%}')

if '--save' in sys.argv:
    os.makedirs(SAVE_DIR, exist_ok=True)
    path = os.path.join(SAVE_DIR, f'{dates[-1]}-轮动回测.json')
    record = {'fetched_at_utc8': fetched, 'price_cutoff': dates[-1], 'windows': len(starts), 'deep_windows': len(deep),
              'stop': STOP, 'horizon_days': HORIZON, 'rebalance_days': REBALANCE, 'cost_one_way': COST, 'paths': paths,
              'hindsight_best_median': statistics.median(best) - 1, 'hindsight_best_reach_178': sum(b >= 1.78 for b in best) / len(best),
              'index_reach_178': sum(x >= 1.78 for x in index_end) / len(index_end), 'index_median': statistics.median(index_end) - 1}
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(record, f, ensure_ascii=False, indent=1)
    print(f'\n已保存 {os.path.relpath(path)}')
