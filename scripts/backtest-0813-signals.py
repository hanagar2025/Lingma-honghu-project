#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
信号回测：TPO 退出信号与 MSR 入场信号（价格/成交可计算部分）的历史表现。

诚实边界声明（必须与结果同行）：
  1. 只回测机械可计算的四项：资金、相对强度、趋势、价格窗口。
     产业证据(S1)、盈利验证(S2)、PE历史分位 全部是时点人工字段，无法历史重建，
     故本回测检验的是【择时引擎】，不是整套体系。真实体系比本回测更严格（S1/S2会再过滤一层）。
  2. 无未来函数：第 i 日的所有指标只用 <= i 的数据，前瞻收益从第 i 日收盘起算。
  3. 唯一有意义的数字是【相对无条件基准的超额】—— 上涨市里任何信号都好看。
  4. 未计交易成本、涨跌停无法成交、流动性冲击。实际结果会更差。
"""
import json, urllib.request, ssl, statistics as st

ctx = ssl.create_default_context(); ctx.check_hostname = False; ctx.verify_mode = ssl.CERT_NONE

POOL = {
    'sz300308': '中际旭创', 'sz300502': '新易盛', 'sz300394': '天孚通信',
    'sh688498': '源杰科技', 'sh688313': '仕佳光子', 'sz300620': '光库科技',
    'sz002281': '光迅科技', 'sz002384': '东山精密', 'sh600183': '生益科技',
    'sh688008': '澜起科技', 'sh603986': '兆易创新', 'sh688041': '海光信息',
    'sz002371': '北方华创', 'sh688012': '中微公司', 'sz002463': '沪电股份',
    'sz002916': '深南电路', 'sh603019': '中科曙光', 'sh688072': '拓荆科技',
    'sh688120': '华海清科', 'sz300567': '精测电子', 'sh688361': '中科飞测',
    'sz000400': '许继电气', 'sh600312': '平高电气', 'sz002028': '思源电气',
    'sz002851': '麦格米特', 'sz300870': '欧陆通', 'sz002837': '英维克',
}
BENCH = 'sz399006'
HORIZONS = [5, 10, 20, 60]


def bars(code, num=900):
    url = f"https://ifzq.gtimg.cn/appstock/app/fqkline/get?param={code},day,,,{num},qfq"
    d = json.loads(urllib.request.urlopen(url, timeout=25, context=ctx).read().decode())['data'][code]
    k = d.get('qfqday') or d.get('day')
    return [{'d': r[0], 'o': float(r[1]), 'c': float(r[2]), 'h': float(r[3]),
             'l': float(r[4]), 'v': float(r[5])} for r in k]


def sma(b, n, i):
    s = b[max(0, i - n + 1):i + 1]
    return sum(x['c'] for x in s) / len(s)


def r_at(b, i, n):
    return b[i]['c'] / b[i - n]['c'] - 1 if i - n >= 0 else None


def amt_ratio(b, i, s_n, l_n):
    if i + 1 < l_n:
        return None
    a = [x['c'] * x['v'] for x in b[:i + 1]]
    sh = sum(a[-s_n:]) / s_n
    lo = sum(a[-l_n:]) / l_n
    return sh / lo if lo else None


def udv(b, i, w=20):
    seg = b[max(0, i - w + 1):i + 1]
    up = [seg[j]['v'] for j in range(1, len(seg)) if seg[j]['c'] > seg[j - 1]['c']]
    dn = [seg[j]['v'] for j in range(1, len(seg)) if seg[j]['c'] < seg[j - 1]['c']]
    return (sum(up) / len(up)) / (sum(dn) / len(dn)) if up and dn else None


def pullbacks(b, i, w=60):
    seg = b[max(0, i - w + 1):i + 1]
    if len(seg) < 10:
        return []
    depths, peak, trough, rising = [], seg[0]['c'], seg[0]['c'], True
    for j in range(1, len(seg)):
        c = seg[j]['c']
        if rising:
            if c > peak:
                peak = trough = c
            elif c < peak * 0.96:
                rising, trough = False, c
        else:
            trough = min(trough, c)
            if c > trough * 1.04:
                depths.append(trough / peak - 1)
                rising, peak, trough = True, c, c
    return depths


def capital_score(b, i):
    a2060, u = amt_ratio(b, i, 20, 60), udv(b, i)
    if a2060 is None or u is None:
        return None
    s = 2 if a2060 >= 1.3 else 1.5 if a2060 >= 1.1 else 1 if a2060 >= 0.9 else 0
    s += 2 if u >= 1.3 else 1 if u >= 1.0 else 0
    pb = pullbacks(b, i)
    if len(pb) >= 2 and abs(pb[-1]) < abs(pb[-2]):
        s += 1
    return min(5, s)


def trend_score(b, i):
    if i < 65:
        return None
    ma20, ma60 = sma(b, 20, i), sma(b, 60, i)
    ma20p, ma60p = sma(b, 20, i - 5), sma(b, 60, i - 5)
    px = b[i]['c']
    s = 0
    sl20, sl60 = ma20 / ma20p - 1, ma60 / ma60p - 1
    s += 1.5 if sl20 > 0.01 else 1 if sl20 > -0.01 else 0
    s += 1.5 if sl60 > 0.005 else 1 if sl60 > -0.005 else 0
    if px > ma20: s += 1
    if px > ma60: s += 1
    d20 = px / ma20 - 1
    if d20 > 0.25: s -= 2
    elif d20 > 0.15: s -= 1
    return max(0, min(5, s))


def window_color(b, ixmap, i):
    if i < 121:
        return None
    px = b[i]['c']
    ma20, ma60 = sma(b, 20, i), sma(b, 60, i)
    d20, d60 = px / ma20 - 1, px / ma60 - 1
    r10, r20 = r_at(b, i, 10), r_at(b, i, 20)
    v20 = sum(x['v'] for x in b[i - 19:i + 1]) / 20
    vspike = b[i]['v'] / v20 if v20 else None
    shadow = px / b[i]['h'] - 1 if b[i]['h'] else 0
    e10 = e20 = None
    if b[i]['d'] in ixmap and b[i - 10]['d'] in ixmap:
        e10 = r10 - (ixmap[b[i]['d']] / ixmap[b[i - 10]['d']] - 1)
    if b[i]['d'] in ixmap and b[i - 20]['d'] in ixmap:
        e20 = r20 - (ixmap[b[i]['d']] / ixmap[b[i - 20]['d']] - 1)
    red = (d20 > 0.15) or (r10 is not None and r10 > 0.30) or \
          (vspike is not None and vspike > 2.5) or (shadow < -0.04) or \
          (e10 is not None and e10 > 0.25)
    if red:
        return 'RED'
    g = 0
    if abs(d20) <= 0.08: g += 1
    if abs(d60) <= 0.10: g += 1
    if (udv(b, i) or 0) >= 1: g += 1
    if e20 is not None and e20 > 0 and (e10 is None or e10 <= 0.25): g += 1
    pb = pullbacks(b, i)
    if len(pb) >= 2 and abs(pb[-1]) < abs(pb[-2]): g += 1
    return 'GREEN' if g >= 3 else 'YELLOW'


def excess(b, ixmap, i, n):
    r = r_at(b, i, n)
    if r is None or b[i]['d'] not in ixmap or b[i - n]['d'] not in ixmap:
        return None
    return r - (ixmap[b[i]['d']] / ixmap[b[i - n]['d']] - 1)


def fwd(b, i, n):
    return b[i + n]['c'] / b[i]['c'] - 1 if i + n < len(b) else None


def fwd_excess(b, ixmap, i, n):
    f = fwd(b, i, n)
    if f is None or b[i]['d'] not in ixmap or b[i + n]['d'] not in ixmap:
        return None
    return f - (ixmap[b[i + n]['d']] / ixmap[b[i]['d']] - 1)


# ---------------- 数据加载 ----------------
print("加载数据...")
DATA, IXB = {}, bars(BENCH)
IXMAP = {x['d']: x['c'] for x in IXB}
for c, n in POOL.items():
    try:
        b = bars(c)
        if len(b) >= 200:
            DATA[c] = b
    except Exception as e:
        print(f"  跳过 {n}: {e}")
print(f"有效标的 {len(DATA)}/{len(POOL)}，基准 {IXB[0]['d']} ~ {IXB[-1]['d']}\n")

# ---------------- 信号采集 ----------------
buckets = {k: {h: [] for h in HORIZONS} for k in
           ('BASELINE', 'MSR_ENTRY', 'GREEN', 'YELLOW', 'RED', 'TPO_EXIT')}

for c, b in DATA.items():
    for i in range(121, len(b) - 1):
        cs, ts = capital_score(b, i), trend_score(b, i)
        if cs is None or ts is None:
            continue
        col = window_color(b, IXMAP, i)
        e20 = excess(b, IXMAP, i, 20)
        ma60 = sma(b, 60, i)
        fe = {h: fwd_excess(b, IXMAP, i, h) for h in HORIZONS}

        for h in HORIZONS:
            if fe[h] is not None:
                buckets['BASELINE'][h].append(fe[h])
                if col:
                    buckets[col][h].append(fe[h])
        # MSR 入场代理：绿灯 + 资金>=3 + 趋势>=3 + 20日超额>0
        if col == 'GREEN' and cs >= 3 and ts >= 3 and e20 is not None and e20 > 0:
            for h in HORIZONS:
                if fe[h] is not None:
                    buckets['MSR_ENTRY'][h].append(fe[h])
        # TPO 退出代理：20日超额<0 且 收盘<MA60
        if e20 is not None and e20 < 0 and b[i]['c'] < ma60:
            for h in HORIZONS:
                if fe[h] is not None:
                    buckets['TPO_EXIT'][h].append(fe[h])


def stats(v):
    if not v:
        return None
    win = [x for x in v if x > 0]
    los = [x for x in v if x <= 0]
    aw = st.mean(win) if win else 0.0
    al = st.mean(los) if los else 0.0
    pf = (sum(win) / abs(sum(los))) if los and sum(los) != 0 else float('inf')
    return dict(n=len(v), mean=st.mean(v), med=st.median(v),
                wr=len(win) / len(v), aw=aw, al=al, pf=pf,
                p10=sorted(v)[int(len(v) * 0.1)], p90=sorted(v)[int(len(v) * 0.9)])


print("=" * 118)
print("一、信号前瞻【超额】收益（对创业板指），单位 %。核心比较对象是 BASELINE 行")
print("=" * 118)
print(f"{'信号':12s}{'期限':>5s}{'样本':>7s}{'均值':>8s}{'中位':>8s}{'胜率':>8s}"
      f"{'均盈':>8s}{'均亏':>8s}{'盈亏比':>8s}{'P10':>8s}{'P90':>8s}{'vs基准':>9s}")
for key in ('BASELINE', 'MSR_ENTRY', 'GREEN', 'YELLOW', 'RED', 'TPO_EXIT'):
    for h in HORIZONS:
        s = stats(buckets[key][h])
        bl = stats(buckets['BASELINE'][h])
        if not s:
            continue
        edge = (s['mean'] - bl['mean']) * 100
        print(f"{key:12s}{h:5d}{s['n']:7d}{s['mean']*100:+8.2f}{s['med']*100:+8.2f}"
              f"{s['wr']*100:7.1f}%{s['aw']*100:+8.2f}{s['al']*100:+8.2f}"
              f"{s['pf']:8.2f}{s['p10']*100:+8.1f}{s['p90']*100:+8.1f}"
              f"{edge:+9.2f}")
    print()

print("=" * 118)
print("二、价格窗口闸门的直接证伪测试：绿灯 vs 红灯的前瞻超额是否真的有差")
print("=" * 118)
for h in HORIZONS:
    g, r, y = stats(buckets['GREEN'][h]), stats(buckets['RED'][h]), stats(buckets['YELLOW'][h])
    if not (g and r):
        continue
    print(f"  {h:2d}日: 绿灯 {g['mean']*100:+6.2f}% (n={g['n']}, 胜率{g['wr']*100:.1f}%)  "
          f"黄灯 {y['mean']*100:+6.2f}%  红灯 {r['mean']*100:+6.2f}% (n={r['n']}, 胜率{r['wr']*100:.1f}%)  "
          f"→ 绿减红 {(g['mean']-r['mean'])*100:+6.2f}pct  "
          f"{'✓闸门有效' if g['mean'] > r['mean'] else '✗闸门被证伪'}")

print()
print("=" * 118)
print("三、若按 MSR 入场信号等权持有N日（组合层面），累计与最大回撤")
print("=" * 118)
# 按日期聚合：每个信号日等权买入，持有h日，日频合成组合净值
from collections import defaultdict
for h in (10, 20):
    daily = defaultdict(list)
    for c, b in DATA.items():
        for i in range(121, len(b) - h):
            cs, ts = capital_score(b, i), trend_score(b, i)
            if cs is None or ts is None:
                continue
            if window_color(b, IXMAP, i) == 'GREEN' and cs >= 3 and ts >= 3:
                e20 = excess(b, IXMAP, i, 20)
                if e20 is None or e20 <= 0:
                    continue
                # 把该笔持仓的每日收益摊到持仓期
                for k in range(h):
                    d = b[i + k]['d']
                    daily[d].append(b[i + k + 1]['c'] / b[i + k]['c'] - 1)
    dates = sorted(daily)
    nav, peak, mdd = 1.0, 1.0, 0.0
    for d in dates:
        nav *= (1 + st.mean(daily[d]))
        peak = max(peak, nav)
        mdd = min(mdd, nav / peak - 1)
    # 同期基准
    if dates:
        b0 = IXMAP.get(dates[0]); b1 = IXMAP.get(dates[-1])
        bn = (b1 / b0 - 1) * 100 if b0 and b1 else float('nan')
        print(f"  持有{h:2d}日: 覆盖 {dates[0]} ~ {dates[-1]}（{len(dates)}个交易日有持仓）"
              f"  累计 {(nav-1)*100:+.1f}%  最大回撤 {mdd*100:.1f}%  同期创业板指 {bn:+.1f}%")

print()
print("=" * 118)
print("四、TPO 退出信号：不执行的代价（信号后持有 vs 换成指数）")
print("=" * 118)
for h in HORIZONS:
    s = stats(buckets['TPO_EXIT'][h])
    bl = stats(buckets['BASELINE'][h])
    if s:
        print(f"  {h:2d}日: 退出信号后继续持有的超额均值 {s['mean']*100:+6.2f}% "
              f"(n={s['n']}, 胜率{s['wr']*100:.1f}%)  基准 {bl['mean']*100:+6.2f}%  "
              f"→ 不执行的平均代价 {(s['mean']-bl['mean'])*100:+6.2f}pct")
