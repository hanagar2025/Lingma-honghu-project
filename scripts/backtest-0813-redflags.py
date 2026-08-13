#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""逐项检验红灯的五个子条件，各自是否有预测力。

动因：实盘扫描中几乎全部标的被标为"红灯·已偏离"，连距MA20仅 -2.1% 的也是，
说明红灯主要由单日K线特征（爆量、长上影）触发，而非真实偏离。
按证据标准条款，应逐项实测而非凭直觉保留。
"""
import json, urllib.request, ssl, statistics as st, random
from collections import defaultdict

ctx = ssl.create_default_context(); ctx.check_hostname = False; ctx.verify_mode = ssl.CERT_NONE
random.seed(20260813)

POOL = ['sz300308', 'sz300502', 'sz300394', 'sh688498', 'sh688313', 'sz300620',
        'sz002281', 'sz002384', 'sh600183', 'sh688008', 'sh603986', 'sh688041',
        'sz002371', 'sh688012', 'sz002463', 'sz002916', 'sh603019', 'sh688072',
        'sh688120', 'sz300567', 'sh688361', 'sz000400', 'sh600312', 'sz002028',
        'sz002851', 'sz300870', 'sz002837']
BENCH = 'sz399006'
H = 20


def bars(code, num=900):
    url = f"https://ifzq.gtimg.cn/appstock/app/fqkline/get?param={code},day,,,{num},qfq"
    d = json.loads(urllib.request.urlopen(url, timeout=25, context=ctx).read().decode())['data'][code]
    k = d.get('qfqday') or d.get('day')
    return [{'d': r[0], 'o': float(r[1]), 'c': float(r[2]), 'h': float(r[3]),
             'l': float(r[4]), 'v': float(r[5])} for r in k]


def sma(b, n, i):
    s = b[max(0, i - n + 1):i + 1]
    return sum(x['c'] for x in s) / len(s)


print("加载数据...")
IXB = bars(BENCH); IXMAP = {x['d']: x['c'] for x in IXB}
DATA = {}
for c in POOL:
    try:
        b = bars(c)
        if len(b) >= 200: DATA[c] = b
    except Exception:
        pass
print(f"有效标的 {len(DATA)}\n")

# flag -> {date: [fwd_excess]}
flag_hits = defaultdict(lambda: defaultdict(list))
base = defaultdict(list)

for c, b in DATA.items():
    for i in range(121, len(b) - H):
        if b[i]['d'] not in IXMAP or b[i + H]['d'] not in IXMAP: continue
        fe = (b[i + H]['c'] / b[i]['c'] - 1) - (IXMAP[b[i + H]['d']] / IXMAP[b[i]['d']] - 1)
        d = b[i]['d']
        base[d].append(fe)

        px = b[i]['c']
        d20 = px / sma(b, 20, i) - 1
        r10 = px / b[i - 10]['c'] - 1
        v20 = sum(x['v'] for x in b[i - 19:i + 1]) / 20
        vspike = b[i]['v'] / v20 if v20 else 0
        shadow = px / b[i]['h'] - 1 if b[i]['h'] else 0
        e10 = r10 - (IXMAP[d] / IXMAP[b[i - 10]['d']] - 1) if b[i - 10]['d'] in IXMAP else None

        if d20 > 0.15: flag_hits['距MA20 > +15%'][d].append(fe)
        if r10 > 0.30: flag_hits['10日涨幅 > +30%'][d].append(fe)
        if vspike > 2.5: flag_hits['当日量 > 20日均量2.5倍'][d].append(fe)
        if shadow < -0.04: flag_hits['长上影（收盘低于最高4%）'][d].append(fe)
        if e10 is not None and e10 > 0.25: flag_hits['10日超额 > +25pct'][d].append(fe)
        # 极端区
        if r10 > 0.50: flag_hits['★10日涨幅 > +50%（深红）'][d].append(fe)
        if e10 is not None and e10 > 0.40: flag_hits['★10日超额 > +40pct（深红）'][d].append(fe)

dates = sorted(base)


def boot(a_map, b_map, block=H, iters=3000):
    def diff(ds):
        av = [x for d in ds for x in a_map.get(d, [])]
        bv = [x for d in ds for x in b_map.get(d, [])]
        if not av or not bv: return None
        return st.mean(av) - st.mean(bv)
    point = diff(dates)
    nb = max(1, len(dates) // block)
    out = []
    for _ in range(iters):
        ds = []
        for _ in range(nb):
            s = random.randrange(0, max(1, len(dates) - block))
            ds.extend(dates[s:s + block])
        v = diff(ds)
        if v is not None: out.append(v)
    out.sort()
    return point, out[int(len(out) * 0.025)], out[int(len(out) * 0.975)]


bl = st.mean([x for d in dates for x in base[d]])
print("=" * 106)
print(f"红灯各子条件的 {H} 日前瞻超额（对创业板指）。无条件基准 = {bl*100:+.2f}%")
print("=" * 106)
print(f"{'子条件':30s}{'命中':>8s}{'均值':>9s}{'胜率':>8s}{'减基准':>10s}{'95%区间':>20s}{'判定':>14s}")
for flag in ['距MA20 > +15%', '10日涨幅 > +30%', '当日量 > 20日均量2.5倍',
             '长上影（收盘低于最高4%）', '10日超额 > +25pct',
             '★10日涨幅 > +50%（深红）', '★10日超额 > +40pct（深红）']:
    m = flag_hits.get(flag)
    if not m: continue
    v = [x for d in m for x in m[d]]
    if len(v) < 30: continue
    pt, lo, hi = boot(m, base)
    wr = sum(1 for x in v if x > 0) / len(v)
    # 判定：作为"警示信号"应显著为负
    if hi < 0: verdict = '✓有警示力'
    elif lo > 0: verdict = '✗反向（更好）'
    else: verdict = '✗无预测力'
    print(f"{flag:30s}{len(v):8d}{st.mean(v)*100:+9.2f}{wr*100:7.1f}%"
          f"{pt*100:+10.2f}{f'[{lo*100:+.1f},{hi*100:+.1f}]':>20s}{verdict:>14s}")

print()
print("说明：红灯设立的初衷是「警示后续表现不佳」，因此该子条件应显著为负（区间上界<0）才算成立。")
print("      区间跨0 = 该条件不携带信息；区间全>0 = 该条件命中后表现反而更好，留着会主动损害收益。")
