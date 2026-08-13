#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""绿灯闸门的代价核算：若要求"绿灯才可建仓"，在中际旭创三段主升浪中会拿到什么价格？
镜像 backend/src/services/msr/promotion.ts 的判定口径。"""
import json, urllib.request, ssl

ctx = ssl.create_default_context(); ctx.check_hostname = False; ctx.verify_mode = ssl.CERT_NONE


def bars(code, num=900):
    url = f"https://ifzq.gtimg.cn/appstock/app/fqkline/get?param={code},day,,,{num},qfq"
    d = json.loads(urllib.request.urlopen(url, timeout=25, context=ctx).read().decode())['data'][code]
    k = d.get('qfqday') or d.get('day')
    return [{'d': r[0], 'o': float(r[1]), 'c': float(r[2]), 'h': float(r[3]),
             'l': float(r[4]), 'v': float(r[5])} for r in k]


def sma(b, n, i):
    s = b[max(0, i - n + 1):i + 1]
    return sum(x['c'] for x in s) / len(s)


def ret_at(b, i, n):
    return b[i]['c'] / b[i - n]['c'] - 1 if i - n >= 0 else None


def updown_ratio(b, i, w=20):
    seg = b[max(0, i - w + 1):i + 1]
    up = [seg[j]['v'] for j in range(1, len(seg)) if seg[j]['c'] > seg[j - 1]['c']]
    dn = [seg[j]['v'] for j in range(1, len(seg)) if seg[j]['c'] < seg[j - 1]['c']]
    if not up or not dn:
        return None
    return (sum(up) / len(up)) / (sum(dn) / len(dn))


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


def window_color(b, ix, i):
    """返回 (color, redFlags, greenCount)。ix 为基准指数收盘序列 dict[date]=close"""
    if i < 121:
        return None, [], 0
    px = b[i]['c']
    ma20, ma60 = sma(b, 20, i), sma(b, 60, i)
    d20, d60 = px / ma20 - 1, px / ma60 - 1
    r10, r20 = ret_at(b, i, 10), ret_at(b, i, 20)
    v20 = sum(x['v'] for x in b[i - 19:i + 1]) / 20
    vspike = b[i]['v'] / v20 if v20 else None
    shadow = px / b[i]['h'] - 1 if b[i]['h'] else 0
    e10 = e20 = None
    if b[i]['d'] in ix and b[i - 10]['d'] in ix:
        e10 = r10 - (ix[b[i]['d']] / ix[b[i - 10]['d']] - 1)
    if b[i]['d'] in ix and b[i - 20]['d'] in ix:
        e20 = r20 - (ix[b[i]['d']] / ix[b[i - 20]['d']] - 1)
    red = []
    if d20 > 0.15: red.append(f"距MA20+{d20*100:.1f}%")
    if r10 is not None and r10 > 0.30: red.append(f"10日+{r10*100:.1f}%")
    if vspike is not None and vspike > 2.5: red.append(f"爆量{vspike:.1f}x")
    if shadow < -0.04: red.append(f"长上影{shadow*100:.1f}%")
    if e10 is not None and e10 > 0.25: red.append(f"10日超额+{e10*100:.1f}pct")
    g = 0
    if abs(d20) <= 0.08: g += 1
    if abs(d60) <= 0.10: g += 1
    udr = updown_ratio(b, i)
    if udr is not None and udr >= 1: g += 1
    if e20 is not None and e20 > 0 and (e10 is None or e10 <= 0.25): g += 1
    pb = pullbacks(b, i)
    if len(pb) >= 2 and abs(pb[-1]) < abs(pb[-2]): g += 1
    color = 'RED' if red else ('GREEN' if g >= 3 else 'YELLOW')
    return color, red, g


B = bars('sz300308')
IDX = {x['d']: x['c'] for x in bars('sz399006')}
DATES = {x['d']: i for i, x in enumerate(B)}

RUNS = [('2025-04-07', '2025-07-04'), ('2025-07-04', '2025-09-26'), ('2026-02-04', '2026-05-13')]

print("=" * 104)
print("绿灯闸门代价核算 —— 中际旭创三段主升浪（口径镜像 promotion.ts）")
print("=" * 104)

for s, e in RUNS:
    si, ei = DATES[s], DATES[e]
    ps, pe = B[si]['c'], B[ei]['c']
    print(f"\n■ 主升段 {s}({ps:.2f}) → {e}({pe:.2f})  理论涨幅 {(pe/ps-1)*100:+.1f}%")
    c0, r0, g0 = window_color(B, IDX, si)
    print(f"  起点当日窗口判定：{c0}" + (f"  红灯项: {', '.join(r0)}" if r0 else f"  绿灯项{g0}/3"))
    # 起点后第一个绿灯日
    first = None
    greens = []
    for i in range(si, ei + 1):
        c, _, _ = window_color(B, IDX, i)
        if c == 'GREEN':
            greens.append(i)
            if first is None:
                first = i
    if first is None:
        print(f"  ⚠ 全段 {ei-si+1} 个交易日内 **无任何绿灯日** → 该段完全错过，代价 = 全部 {(pe/ps-1)*100:+.1f}%")
    else:
        fp = B[first]['c']
        print(f"  首个绿灯日 {B[first]['d']} 价格 {fp:.2f}（距起点{(fp/ps-1)*100:+.1f}%）"
              f" → 绿灯进入可获 {(pe/fp-1)*100:+.1f}%，放弃 {(pe/ps-1)*100 - (pe/fp-1)*100:+.1f}pct")
        print(f"  全段绿灯日 {len(greens)}/{ei-si+1} 个（{len(greens)/(ei-si+1)*100:.0f}%）")

print("\n" + "=" * 104)
print("全样本窗口分布（近500个交易日）")
print("=" * 104)
cnt = {'GREEN': 0, 'YELLOW': 0, 'RED': 0}
for i in range(max(121, len(B) - 500), len(B)):
    c, _, _ = window_color(B, IDX, i)
    if c: cnt[c] += 1
tot = sum(cnt.values())
for k in ('GREEN', 'YELLOW', 'RED'):
    print(f"  {k:6s} {cnt[k]:4d} 日  {cnt[k]/tot*100:5.1f}%")
print(f"\n  结论：绿灯日仅占 {cnt['GREEN']/tot*100:.1f}%，闸门确实稀缺 —— 这是它的成本，也是它的作用。")
