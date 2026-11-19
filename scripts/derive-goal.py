"""《战略书》第三节的推导：停手线、股票上限、目标（研究层，OBSERVATION，不产生动作）

回答三个问题，全部用可复算的公开数据：
  甲 创业板指历史上回撤达到现在这个深度之后，又跌了多少、几年后在哪里
  乙 我们的持仓跟着指数跌多少（贝塔、最差 60 日）
  丙 不同股票上限下，上面几种跌法让总资产亏多少、会不会碰到停手线；到期日按指数历史分位能到多少

用法：PORTFOLIO=<账本路径> python3 scripts/derive-goal.py --cut 2026-11-18 [--stop 0.20] [--end 2030-12-31] [--save]
  不给 PORTFOLIO 只算甲。账本只用来算占比，输出不含金额。
数据源：腾讯日 K（指数与个股收盘价）；新浪日 K（第二源，逐日核对创业板指收盘价）。
"""
import datetime
import json
import os
import statistics
import sys
import time
import urllib.request


def arg(name, default):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default


CUT, STOP, END = arg('--cut', None), float(arg('--stop', '0.20')), arg('--end', '2030-12-31')
INDEX, CAPS, CASH_YIELD = 'sz399006', (0.30, 0.50, 0.70), 0.015
SAVE_DIR = os.path.join(os.path.dirname(__file__), '..', '战略组合2026-2030', '数据', '目标推导')


def get(url, referer):
    last = None
    for i in range(4):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0', 'Referer': referer})
            return urllib.request.urlopen(req, timeout=25).read()
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(2 * (i + 1))
    raise last


def kline(symbol, start=''):
    out = {}
    for a, b in ((start, '2018-08-16'), ('', '')) if start else (('', ''),):
        d = json.loads(get(f'https://web.ifzq.gtimg.cn/appstock/app/newfqkline/get?param={symbol},day,{a},{b},2000,qfq', 'https://gu.qq.com/'))
        rows = d['data'][symbol].get('qfqday') or d['data'][symbol].get('day')
        out.update({r[0]: float(r[2]) for r in rows})
    return {d: c for d, c in sorted(out.items()) if CUT is None or d <= CUT}


def pct(v, digits=0):
    return f'{v * 100:+.{digits}f}%'


def quantile(xs, p):
    return sorted(xs)[int(len(xs) * p)]


idx = kline(INDEX, '2010-06-01')
sina = json.loads(get(f'https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol={INDEX}&scale=240&ma=no&datalen=5000', 'https://finance.sina.com.cn/'))
second = {r['day']: float(r['close']) for r in sina}
mismatch = [d for d in idx if d in second and abs(idx[d] / second[d] - 1) > 0.001]
days, close = list(idx), list(idx.values())
n, last = len(days), days[-1]
horizon_years = (datetime.date.fromisoformat(END) - datetime.date.fromisoformat(last)).days / 365.25
H = round(horizon_years * 243)
dd = [close[i] / max(close[max(0, i - 500):i + 1]) - 1 for i in range(n)]
peak_i = max(range(max(0, n - 500), n), key=lambda i: close[i])
depth = -int(-dd[-1] * 20) / 20

episodes, prev_end = [], -10 ** 9
for i in range(n):
    if dd[i] <= depth and i - prev_end > 300:
        j, low = i, i
        while j < n and dd[j] < -0.15:
            low = low if close[low] <= close[j] else j
            j += 1
        top = max(range(max(0, i - 500), i + 1), key=lambda t: close[t])
        episodes.append({'peak': days[top], 'hit': days[i], 'trough': days[low], 'more': close[low] / close[i] - 1,
                         'peak_to_trough': close[low] / close[top] - 1,
                         'at_end': close[i + H] / close[i] - 1 if i + H < n else None})
        prev_end = j
past = [e for e in episodes if e['hit'] < days[peak_i]]
forward = [close[i + H] / close[i] - 1 for i in range(n - H) if dd[i] <= depth]
q25, q50, q75 = quantile(forward, 0.25), statistics.median(forward), quantile(forward, 0.75)

fetched = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=8))).strftime('%Y-%m-%d %H:%M')
print(f'取数 {fetched}（北京时间）　行情截至 {last}　到期日 {END}（{horizon_years:.1f} 年，{H} 个交易日）')
print(f'第二源核对（新浪，创业板指 {sum(1 for d in idx if d in second)} 个交易日收盘价）：' + ('全部一致' if not mismatch else f'{len(mismatch)} 日不一致'))
print(f'\n### 甲　创业板指：现在自高点（{days[peak_i]}）回撤 {pct(dd[-1], 1)}，按达到 {pct(depth)} 取历史样本\n')
print(f'| 高点 | 回撤达到 {pct(depth)} 的日子 | 之后又跌 | 谷底 | 高点到谷底 | {horizon_years:.1f} 年后 |')
print('|---|---|---|---|---|---|')
for e in episodes:
    print(f"| {e['peak']} | {e['hit']} | {pct(e['more'])} | {e['trough']} | {pct(e['peak_to_trough'])} | {'未到期' if e['at_end'] is None else pct(e['at_end'])} |")
print(f'\n回撤不浅于 {pct(depth)} 的交易日共 {len(forward)} 个（只来自 {len([e for e in past if e["at_end"] is not None])} 段行情，样本重叠）。{horizon_years:.1f} 年后：下四分位 {pct(q25)}，中位 {pct(q50)}，上四分位 {pct(q75)}；为负的占 {sum(1 for x in forward if x < 0) / len(forward) * 100:.0f}%。')

record = {'fetched_at_utc8': fetched, 'price_cutoff': last, 'end': END, 'horizon_years': horizon_years, 'stop': STOP,
          'index_drawdown': dd[-1], 'index_peak_date': days[peak_i], 'depth': depth, 'episodes': episodes,
          'forward_quartiles': [q25, q50, q75], 'second_source_mismatch_days': len(mismatch)}

if os.environ.get('PORTFOLIO'):
    pf = json.load(open(os.environ['PORTFOLIO'], encoding='utf-8'))
    px = {p['code']: kline(('sh' if p['code'][0] in '69' else 'sz') + p['code']) for p in pf['positions']}
    value = {p['code']: p['quantity'] * px[p['code']][last] for p in pf['positions']}
    stock = sum(value.values())
    total = stock + pf['cash']
    common = sorted(set(idx).intersection(*[set(v) for v in px.values()]))
    basket = [sum(value[c] / stock * (px[c][common[i]] / px[c][common[i - 1]] - 1) for c in px) for i in range(1, len(common))]
    index = [idx[common[i]] / idx[common[i - 1]] - 1 for i in range(1, len(common))]
    b, x = basket[-250:], index[-250:]
    beta = sum((u - statistics.mean(b)) * (v - statistics.mean(x)) for u, v in zip(b, x)) / sum((v - statistics.mean(x)) ** 2 for v in x)
    nav = [1.0]
    for r in basket:
        nav.append(nav[-1] * (1 + r))
    worst60 = min(nav[i] / nav[i - 60] - 1 for i in range(60, len(nav)))
    exposure, drawdown = stock / total, 1 - total / pf['peakAssets']
    name = {p['code']: p['name'] for p in pf['positions']}
    over = {c: v / total for c, v in value.items() if v / total > 0.12}
    after_cap = exposure - sum(w - 0.12 for w in over.values())
    print(f'\n### 乙　持仓（账本 {pf["asOf"]}，按 {last} 收盘价）\n')
    print(f'- 股票占总资产 {exposure * 100:.1f}%；超过 12% 的：{"、".join(f"{name[c]} {w * 100:.1f}%" for c, w in over.items()) or "无"}；归位后股票占 {after_cap * 100:.1f}%')
    print(f'- 持仓对创业板指的贝塔（近 250 日）{beta:.2f}，相关系数 {statistics.correlation(b, x):.2f}')
    print(f'- 按现在的权重，持仓最差的 60 个交易日 {pct(worst60)}（样本 {common[0]} 起）')
    print(f'- 自待核验峰值回撤 {drawdown * 100:.1f}%；回到峰值总资产要涨 {pct(1 / (1 - drawdown) - 1)}，年化 {pct((1 / (1 - drawdown)) ** (1 / horizon_years) - 1, 1)}')
    cases = [(f"{e['peak'][:4]} 年那次（指数再跌 {pct(close[peak_i] * (1 + e['peak_to_trough']) / close[-1] - 1)}）",
              max(-0.95, (close[peak_i] * (1 + e['peak_to_trough']) / close[-1] - 1) * beta)) for e in past]
    cases.append(('最差 60 日重演', worst60))
    cash_gain = (1 + CASH_YIELD) ** horizon_years - 1
    print(f'\n### 丙　停手线 {pct(-STOP)} 下，不同股票上限的结果（总资产，相对 {last} 收盘）\n')
    print('| 股票上限 | ' + ' | '.join(c[0] for c in cases) + f' | 到期：指数中位 | 到期：指数上四分位 | 回到峰值需要股票部分涨 |')
    print('|---|' + '---|' * (len(cases) + 3))
    table = []
    for cap in CAPS:
        losses = [cap * loss for _, loss in cases]
        ends = [cap * q + (1 - cap) * cash_gain for q in (q50, q75)]
        need = (1 / (1 - drawdown) - (1 - cap) * (1 + cash_gain)) / cap - 1
        table.append({'cap': cap, 'losses': losses, 'ends': ends, 'stock_needed_for_peak': need})
        print(f'| {cap * 100:.0f}% | ' + ' | '.join('触线' if x <= -STOP else pct(x) for x in losses) + f' | {pct(ends[0])} | {pct(ends[1])} | {pct(need)} |')
    print(f'\n到期一栏按指数本身的涨幅算，不假设选股更好；现金按年化 {CASH_YIELD * 100:.1f}% 计。这是历史分位，不是预测。')
    record.update({'ledger_as_of': pf['asOf'], 'exposure': exposure, 'exposure_after_single_cap': after_cap, 'beta_250': beta,
                   'worst_60d': worst60, 'drawdown_from_unverified_peak': drawdown, 'caps': table})

if '--save' in sys.argv:
    os.makedirs(SAVE_DIR, exist_ok=True)
    path = os.path.join(SAVE_DIR, f'{last}.json')
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(record, f, ensure_ascii=False, indent=1)
    print(f'\n已保存 {os.path.relpath(path)}')
