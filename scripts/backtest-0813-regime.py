#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""分期检验：红灯溢价在"转折期"是否存活？并给出考虑重叠窗口后的有效样本与显著性。

动因：全样本回测显示红灯日前瞻超额高于绿灯日（动量效应），直接否证了价格窗口闸门。
但闸门是为"转折"设计的，若样本期以单边上涨为主，该否证可能只反映样本缺少目标情形。
本脚本按行情状态分期重算。
"""
import json, urllib.request, ssl, statistics as st, math

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
            if c > peak: peak = trough = c
            elif c < peak * 0.96: rising, trough = False, c
        else:
            trough = min(trough, c)
            if c > trough * 1.04:
                depths.append(trough / peak - 1); rising, peak, trough = True, c, c
    return depths


def window_color(b, ixmap, i):
    if i < 121: return None
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
    if (d20 > 0.15) or (r10 is not None and r10 > 0.30) or \
       (vspike is not None and vspike > 2.5) or (shadow < -0.04) or \
       (e10 is not None and e10 > 0.25):
        return 'RED'
    g = 0
    if abs(d20) <= 0.08: g += 1
    if abs(d60) <= 0.10: g += 1
    if (udv(b, i) or 0) >= 1: g += 1
    if e20 is not None and e20 > 0 and (e10 is None or e10 <= 0.25): g += 1
    pb = pullbacks(b, i)
    if len(pb) >= 2 and abs(pb[-1]) < abs(pb[-2]): g += 1
    return 'GREEN' if g >= 3 else 'YELLOW'


def fwd_excess(b, ixmap, i, n):
    if i + n >= len(b): return None
    if b[i]['d'] not in ixmap or b[i + n]['d'] not in ixmap: return None
    return (b[i + n]['c'] / b[i]['c'] - 1) - (ixmap[b[i + n]['d']] / ixmap[b[i]['d']] - 1)


print("加载数据...")
IXB = bars(BENCH)
IXMAP = {x['d']: x['c'] for x in IXB}
DATA = {}
for c in POOL:
    try:
        b = bars(c)
        if len(b) >= 200: DATA[c] = b
    except Exception:
        pass
print(f"有效标的 {len(DATA)}，基准区间 {IXB[0]['d']} ~ {IXB[-1]['d']}\n")

# 用基准自身状态定义行情：收盘 vs MA60（上行期/下行期）
IXI = {x['d']: i for i, x in enumerate(IXB)}


def bench_regime(date):
    i = IXI.get(date)
    if i is None or i < 60: return None
    return 'UP' if IXB[i]['c'] >= sma(IXB, 60, i) else 'DOWN'


HOR = [10, 20]
res = {}   # (regime, color, h) -> list
for c, b in DATA.items():
    for i in range(121, len(b) - 1):
        col = window_color(b, IXMAP, i)
        reg = bench_regime(b[i]['d'])
        if not col or not reg: continue
        for h in HOR:
            fe = fwd_excess(b, IXMAP, i, h)
            if fe is None: continue
            res.setdefault((reg, col, h), []).append(fe)
            res.setdefault((reg, 'ALL', h), []).append(fe)


def eff_t(v, h):
    """重叠窗口的有效样本近似为 n/h；据此计算 t 值"""
    if len(v) < 5: return None, None
    m, sd = st.mean(v), st.pstdev(v)
    n_eff = max(1, len(v) / h)
    se = sd / math.sqrt(n_eff)
    return m, (m / se if se else None)


print("=" * 112)
print("一、按基准行情状态分期：绿灯 vs 红灯（前瞻超额均值 %，括号为重叠修正后 t 值）")
print("=" * 112)
print(f"{'行情':6s}{'期限':>5s}{'  绿灯':>20s}{'  黄灯':>20s}{'  红灯':>20s}{'  绿减红':>12s}{'  闸门':>10s}")
for reg in ('UP', 'DOWN'):
    for h in HOR:
        cells = {}
        for col in ('GREEN', 'YELLOW', 'RED'):
            v = res.get((reg, col, h), [])
            m, t = eff_t(v, h)
            cells[col] = (m, t, len(v))
        if cells['GREEN'][0] is None or cells['RED'][0] is None: continue
        diff = (cells['GREEN'][0] - cells['RED'][0]) * 100
        def f(col):
            m, t, n = cells[col]
            return f"{m*100:+6.2f}%(t{t:+.1f},n{n})" if m is not None else "  NA  "
        verdict = '✓有效' if diff > 0 else '✗被证伪'
        print(f"{reg:6s}{h:5d}{f('GREEN'):>20s}{f('YELLOW'):>20s}{f('RED'):>20s}{diff:+11.2f}pct{verdict:>10s}")
    print()

print("=" * 112)
print("二、2026年6月20日以来（本轮回撤期）单独检验")
print("=" * 112)
CUT = '2026-06-20'
sub = {}
for c, b in DATA.items():
    for i in range(121, len(b) - 1):
        if b[i]['d'] < CUT: continue
        col = window_color(b, IXMAP, i)
        if not col: continue
        for h in HOR:
            fe = fwd_excess(b, IXMAP, i, h)
            if fe is None: continue
            sub.setdefault((col, h), []).append(fe)
for h in HOR:
    g, r, y = sub.get(('GREEN', h), []), sub.get(('RED', h), []), sub.get(('YELLOW', h), [])
    if not g or not r: continue
    mg, tg = eff_t(g, h); mr, tr = eff_t(r, h); my, _ = eff_t(y, h)
    print(f"  {h:2d}日: 绿灯 {mg*100:+6.2f}%(n={len(g)})  黄灯 {my*100:+6.2f}%  "
          f"红灯 {mr*100:+6.2f}%(n={len(r)})  → 绿减红 {(mg-mr)*100:+6.2f}pct  "
          f"{'✓有效' if mg > mr else '✗被证伪'}")

print()
print("=" * 112)
print("三、极端红灯（10日涨幅 > 30%）的前瞻表现 —— 追高的直接代价")
print("=" * 112)
ext = {}
for c, b in DATA.items():
    for i in range(121, len(b) - 1):
        r10 = r_at(b, i, 10)
        if r10 is None: continue
        key = 'SPIKE30' if r10 > 0.30 else ('SPIKE50' if r10 > 0.50 else None)
        for h in HOR + [60]:
            fe = fwd_excess(b, IXMAP, i, h)
            if fe is None: continue
            if r10 > 0.50: ext.setdefault(('SPIKE50', h), []).append(fe)
            if r10 > 0.30: ext.setdefault(('SPIKE30', h), []).append(fe)
            ext.setdefault(('ALL', h), []).append(fe)
for h in HOR + [60]:
    a = ext.get(('ALL', h), []); s3 = ext.get(('SPIKE30', h), []); s5 = ext.get(('SPIKE50', h), [])
    if not a: continue
    ma, _ = eff_t(a, h)
    line = f"  {h:2d}日: 全样本 {ma*100:+6.2f}%"
    if s3:
        m3, t3 = eff_t(s3, h); line += f"  |  10日涨>30% {m3*100:+6.2f}%(t{t3:+.1f},n{len(s3)})"
    if s5:
        m5, t5 = eff_t(s5, h); line += f"  |  10日涨>50% {m5*100:+6.2f}%(t{t5:+.1f},n{len(s5)})"
    print(line)
