#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""决定性检验：MSR 入场信号相对无条件基准的优势，是否可与噪声区分？

方法：按【日期区块】自助抽样（block bootstrap）。
  - 以日期为抽样单位、区块长度 = 前瞻期限，同时保留横截面相关性与时间自相关。
  - 直接对「信号组均值 - 同日基准组均值」做分布估计，得到经验置信区间与 p 值。
  - 这样可消除"重叠窗口把 n 虚增几十倍"造成的假显著。

同时量化选股域的事后偏差：27 只标的是 2026 年 8 月回看挑出的 AI/半导体赢家，
基准（同域等权）本身相对指数就有巨额超额；须把它与信号贡献分离。
"""
import json, urllib.request, ssl, statistics as st, random, math
from collections import defaultdict

ctx = ssl.create_default_context(); ctx.check_hostname = False; ctx.verify_mode = ssl.CERT_NONE
random.seed(20260813)

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
    if i + 1 < l_n: return None
    a = [x['c'] * x['v'] for x in b[:i + 1]]
    lo = sum(a[-l_n:]) / l_n
    return (sum(a[-s_n:]) / s_n) / lo if lo else None


def udv(b, i, w=20):
    seg = b[max(0, i - w + 1):i + 1]
    up = [seg[j]['v'] for j in range(1, len(seg)) if seg[j]['c'] > seg[j - 1]['c']]
    dn = [seg[j]['v'] for j in range(1, len(seg)) if seg[j]['c'] < seg[j - 1]['c']]
    return (sum(up) / len(up)) / (sum(dn) / len(dn)) if up and dn else None


def pullbacks(b, i, w=60):
    seg = b[max(0, i - w + 1):i + 1]
    if len(seg) < 10: return []
    depths, peak, trough, rising = [], seg[0]['c'], seg[0]['c'], True
    for j in range(1, len(seg)):
        c = seg[j]['c']
        if rising:
            if c > peak: peak = trough = c
            elif c < peak * 0.96: rising, trough = False, c
        else:
            trough = min(trough, c)
            if c > trough * 1.04:
                depths.append(trough / peak - 1); rising, peak, trough = True, c, c
    return depths


def capital_score(b, i):
    a, u = amt_ratio(b, i, 20, 60), udv(b, i)
    if a is None or u is None: return None
    s = 2 if a >= 1.3 else 1.5 if a >= 1.1 else 1 if a >= 0.9 else 0
    s += 2 if u >= 1.3 else 1 if u >= 1.0 else 0
    pb = pullbacks(b, i)
    if len(pb) >= 2 and abs(pb[-1]) < abs(pb[-2]): s += 1
    return min(5, s)


def trend_score(b, i):
    if i < 65: return None
    ma20, ma60 = sma(b, 20, i), sma(b, 60, i)
    sl20 = ma20 / sma(b, 20, i - 5) - 1
    sl60 = ma60 / sma(b, 60, i - 5) - 1
    px, s = b[i]['c'], 0
    s += 1.5 if sl20 > 0.01 else 1 if sl20 > -0.01 else 0
    s += 1.5 if sl60 > 0.005 else 1 if sl60 > -0.005 else 0
    if px > ma20: s += 1
    if px > ma60: s += 1
    d = px / ma20 - 1
    if d > 0.25: s -= 2
    elif d > 0.15: s -= 1
    return max(0, min(5, s))


def window_color(b, ixmap, i):
    if i < 121: return None
    px = b[i]['c']
    ma20, ma60 = sma(b, 20, i), sma(b, 60, i)
    d20, d60 = px / ma20 - 1, px / ma60 - 1
    r10, r20 = r_at(b, i, 10), r_at(b, i, 20)
    v20 = sum(x['v'] for x in b[i - 19:i + 1]) / 20
    vs = b[i]['v'] / v20 if v20 else None
    sh = px / b[i]['h'] - 1 if b[i]['h'] else 0
    e10 = e20 = None
    if b[i]['d'] in ixmap and b[i - 10]['d'] in ixmap:
        e10 = r10 - (ixmap[b[i]['d']] / ixmap[b[i - 10]['d']] - 1)
    if b[i]['d'] in ixmap and b[i - 20]['d'] in ixmap:
        e20 = r20 - (ixmap[b[i]['d']] / ixmap[b[i - 20]['d']] - 1)
    if (d20 > 0.15) or (r10 is not None and r10 > 0.30) or \
       (vs is not None and vs > 2.5) or (sh < -0.04) or (e10 is not None and e10 > 0.25):
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
    if r is None or b[i]['d'] not in ixmap or b[i - n]['d'] not in ixmap: return None
    return r - (ixmap[b[i]['d']] / ixmap[b[i - n]['d']] - 1)


def fwd_excess(b, ixmap, i, n):
    if i + n >= len(b): return None
    if b[i]['d'] not in ixmap or b[i + n]['d'] not in ixmap: return None
    return (b[i + n]['c'] / b[i]['c'] - 1) - (ixmap[b[i + n]['d']] / ixmap[b[i]['d']] - 1)


print("加载数据...")
IXB = bars(BENCH); IXMAP = {x['d']: x['c'] for x in IXB}
DATA = {}
for c in POOL:
    try:
        b = bars(c)
        if len(b) >= 200: DATA[c] = b
    except Exception:
        pass
print(f"有效标的 {len(DATA)}，区间 {IXB[0]['d']} ~ {IXB[-1]['d']}\n")

H = 20
# 按日期归集：signal[date] = [该日发出信号的标的前瞻超额], base[date] = [该日全部标的前瞻超额]
sig, base, red, green = defaultdict(list), defaultdict(list), defaultdict(list), defaultdict(list)
for c, b in DATA.items():
    for i in range(121, len(b) - 1):
        fe = fwd_excess(b, IXMAP, i, H)
        if fe is None: continue
        d = b[i]['d']
        base[d].append(fe)
        col = window_color(b, IXMAP, i)
        cs, ts = capital_score(b, i), trend_score(b, i)
        if col == 'GREEN': green[d].append(fe)
        if col == 'RED': red[d].append(fe)
        if col == 'GREEN' and cs is not None and ts is not None and cs >= 3 and ts >= 3:
            e20 = excess(b, IXMAP, i, 20)
            if e20 is not None and e20 > 0: sig[d].append(fe)

dates = sorted(base)
print(f"信号日 {len(sig)} 天，累计信号 {sum(len(v) for v in sig.values())} 次；"
      f"全样本 {len(dates)} 天，{sum(len(v) for v in base.values())} 个观测\n")


def block_bootstrap(a_map, b_map, dates, block=20, iters=3000):
    """返回 (点估计差, 置信区间, 单边p值)：a组均值 - b组均值"""
    def diff(ds):
        av = [x for d in ds for x in a_map.get(d, [])]
        bv = [x for d in ds for x in b_map.get(d, [])]
        if not av or not bv: return None
        return st.mean(av) - st.mean(bv)
    point = diff(dates)
    nblocks = max(1, len(dates) // block)
    out = []
    for _ in range(iters):
        ds = []
        for _ in range(nblocks):
            s = random.randrange(0, max(1, len(dates) - block))
            ds.extend(dates[s:s + block])
        v = diff(ds)
        if v is not None: out.append(v)
    out.sort()
    lo, hi = out[int(len(out) * 0.025)], out[int(len(out) * 0.975)]
    p = sum(1 for x in out if x <= 0) / len(out)
    return point, lo, hi, p


print("=" * 100)
print(f"一、MSR 入场信号 vs 无条件基准（同域全样本），{H}日前瞻超额之差")
print("=" * 100)
pt, lo, hi, p = block_bootstrap(sig, base, dates)
print(f"  点估计   : {pt*100:+.2f} pct")
print(f"  95%区间  : [{lo*100:+.2f}, {hi*100:+.2f}] pct")
print(f"  P(差<=0) : {p:.3f}")
print(f"  结论     : {'优势可与噪声区分（区间不含0）' if lo > 0 else '★ 优势无法与噪声区分（区间跨0）'}")

print()
print("=" * 100)
print("二、绿灯 vs 红灯（闸门的核心主张）")
print("=" * 100)
pt2, lo2, hi2, p2 = block_bootstrap(green, red, dates)
print(f"  点估计   : {pt2*100:+.2f} pct （正=绿灯更优，闸门成立）")
print(f"  95%区间  : [{lo2*100:+.2f}, {hi2*100:+.2f}] pct")
print(f"  P(差<=0) : {p2:.3f}")
print(f"  结论     : {'闸门成立' if lo2 > 0 else ('★ 闸门方向相反且显著' if hi2 < 0 else '★ 闸门无证据支持（区间跨0）')}")

print()
print("=" * 100)
print("三、选股域的事后偏差量化：同域等权 vs 创业板指")
print("=" * 100)
allv = [x for d in dates for x in base[d]]
print(f"  27只标的 {H}日前瞻超额均值 : {st.mean(allv)*100:+.2f} pct  （n={len(allv)}）")
print(f"  年化约                    : {st.mean(allv)*(250/H)*100:+.0f} pct")
print("  → 这不是模型能力，是 2026年8月回看挑出赢家所致的事后偏差。")
print("  → 任何叠加在此域上的择时信号都会显得很好；唯一有意义的读数是上表一的『差』。")

print()
print("=" * 100)
print("四、把组合累计收益按来源拆解（持有20日、等权）")
print("=" * 100)
daily_sig, daily_base = defaultdict(list), defaultdict(list)
for c, b in DATA.items():
    for i in range(121, len(b) - H - 1):
        col = window_color(b, IXMAP, i)
        cs, ts = capital_score(b, i), trend_score(b, i)
        ok = (col == 'GREEN' and cs is not None and ts is not None and cs >= 3 and ts >= 3)
        if ok:
            e20 = excess(b, IXMAP, i, 20)
            ok = e20 is not None and e20 > 0
        for k in range(H):
            d = b[i + k]['d']
            ret = b[i + k + 1]['c'] / b[i + k]['c'] - 1
            daily_base[d].append(ret)
            if ok: daily_sig[d].append(ret)


def nav_of(m):
    ds = sorted(m)
    nav, peak, mdd = 1.0, 1.0, 0.0
    for d in ds:
        nav *= (1 + st.mean(m[d])); peak = max(peak, nav); mdd = min(mdd, nav / peak - 1)
    return ds, nav, mdd


ds1, nav1, mdd1 = nav_of(daily_sig)
ds2, nav2, mdd2 = nav_of(daily_base)
common = sorted(set(ds1) & set(ds2))
if common:
    b0, b1 = IXMAP.get(common[0]), IXMAP.get(common[-1])
    bench = (b1 / b0 - 1) * 100 if b0 and b1 else float('nan')
    print(f"  区间 {common[0]} ~ {common[-1]}")
    print(f"  A 创业板指（真基准）          : {bench:+8.1f}%")
    print(f"  B 27只等权、始终满仓（选股域） : {(nav2-1)*100:+8.1f}%   最大回撤 {mdd2*100:6.1f}%")
    print(f"  C MSR信号择时（本模型）        : {(nav1-1)*100:+8.1f}%   最大回撤 {mdd1*100:6.1f}%")
    print(f"  → 选股域贡献 (B-A) : {(nav2-1)*100-bench:+8.1f} pct  ← 事后偏差，不可复制")
    print(f"  → 择时贡献   (C-B) : {(nav1-1)*100-(nav2-1)*100:+8.1f} pct  ← 模型真实增量")
