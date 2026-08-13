#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""委员会五问计分 + 轮动方向体检。只用收盘/成交口径。"""
import json, urllib.request, ssl

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE


def bars(code, num=140):
    url = (f"https://ifzq.gtimg.cn/appstock/app/fqkline/get?"
           f"param={code},day,,,{num},qfq")
    d = json.loads(urllib.request.urlopen(url, timeout=20, context=ctx)
                   .read().decode('utf-8'))['data'][code]
    k = d.get('qfqday') or d.get('day')
    return [{'d': r[0], 'o': float(r[1]), 'c': float(r[2]),
             'h': float(r[3]), 'l': float(r[4]), 'v': float(r[5])} for r in k]


NAMES = {'sz300308': '中际旭创', 'sz300502': '新易盛', 'sz300394': '天孚通信',
         'sh688498': '源杰科技', 'sh688313': '仕佳光子', 'sz300620': '光库科技',
         'sz002281': '光迅科技'}
LEAD = ['sz300308', 'sz300502']
TIER2 = ['sz300394', 'sh688498', 'sh688313', 'sz300620', 'sz002281']

B = {c: bars(c) for c in NAMES}
IDX = bars('sz399006')

print("=" * 96)
print("【Q1】回落是否缩量？—— 上涨日 vs 下跌日成交量（8/03–8/13，10个交易日）")
print("=" * 96)
for c in LEAD + TIER2:
    b = [x for x in B[c] if x['d'] >= '2026-08-03']
    up = [x['v'] for i, x in enumerate(b) if i > 0 and x['c'] > b[i - 1]['c']]
    dn = [x['v'] for i, x in enumerate(b) if i > 0 and x['c'] < b[i - 1]['c']]
    au, ad = sum(up) / max(len(up), 1), sum(dn) / max(len(dn), 1)
    all_ = B[c]
    v5 = sum(x['v'] for x in all_[-5:]) / 5
    v20 = sum(x['v'] for x in all_[-20:]) / 20
    v60 = sum(x['v'] for x in all_[-60:]) / 60
    flag = "下跌日放量(派发特征)" if ad > au else "上涨日放量(健康)"
    print(f"{NAMES[c]:6s} 上涨日均量{au:10.0f}({len(up)}日) 下跌日均量{ad:10.0f}({len(dn)}日) "
          f"比值{ad/au:5.2f} → {flag:18s} | 量5/20 {v5/v20:.2f} 量20/60 {v20/v60:.2f}")

print()
print("=" * 96)
print("【Q2】第二次冲高是否突破第一次高点？（8/4为第一高峰，8/13为最新冲高）")
print("=" * 96)
for c in LEAD + TIER2:
    b = {x['d']: x for x in B[c]}
    seg = [x for x in B[c] if '2026-08-03' <= x['d'] <= '2026-08-07']
    p1 = max(seg, key=lambda x: x['h'])
    last = B[c][-1]
    dh = (last['h'] / p1['h'] - 1) * 100
    dc = (last['c'] / p1['c'] - 1) * 100
    verdict = "突破 ✓" if dh > 0 and dc > 0 else ("等高未破 ~" if dh > -1 else "低高点 ✗")
    print(f"{NAMES[c]:6s} 首峰{p1['d']} 高{p1['h']:9.2f} 收{p1['c']:9.2f} | "
          f"8/13 高{last['h']:9.2f} 收{last['c']:9.2f} | "
          f"高点差{dh:+7.2f}% 收盘差{dc:+7.2f}% → {verdict}")

print()
print("=" * 96)
print("【Q3】龙头相对指数（创业板指）是否重新走强？")
print("=" * 96)


def ret(b, n):
    return (b[-1]['c'] / b[-1 - n]['c'] - 1) * 100


for n in (3, 5, 10, 20):
    ix = ret(IDX, n)
    line = f"近{n:2d}日 创业板指{ix:+7.2f}% | "
    for c in LEAD + TIER2:
        line += f"{NAMES[c]}{ret(B[c], n) - ix:+7.2f}pct  "
    print(line)

print()
print("=" * 96)
print("【Q4】资金强弱代理：成交额（亿元）5日均 / 20日均。注：非主力净流入口径")
print("=" * 96)
for c in LEAD + TIER2:
    b = B[c]
    amt = [x['v'] * 100 * x['c'] / 1e8 for x in b]
    print(f"{NAMES[c]:6s} 5日均{sum(amt[-5:])/5:8.1f}亿 20日均{sum(amt[-20:])/20:8.1f}亿 "
          f"60日均{sum(amt[-60:])/60:8.1f}亿 | 5/20={sum(amt[-5:])/5/(sum(amt[-20:])/20):.2f} "
          f"20/60={sum(amt[-20:])/20/(sum(amt[-60:])/60):.2f}")

print()
print("=" * 96)
print("【轮动方向体检】卖出端 vs 买入端的位置对比（这是决定性的一张表）")
print("=" * 96)
print(f"{'标的':8s}{'现价':>10s}{'距60日峰':>10s}{'10日涨幅':>10s}{'距MA20':>9s}{'距MA60':>9s}"
      f"{'今日收距高':>11s}{'角色':>8s}")
for c in LEAD + TIER2:
    b = B[c]
    last = b[-1]
    hi60 = max(x['c'] for x in b[-60:])
    ma20 = sum(x['c'] for x in b[-20:]) / 20
    ma60 = sum(x['c'] for x in b[-60:]) / 60
    role = "卖出端" if c in LEAD else "买入端"
    print(f"{NAMES[c]:8s}{last['c']:10.2f}{(last['c']/hi60-1)*100:9.1f}%"
          f"{ret(b,10):9.1f}%{(last['c']/ma20-1)*100:8.1f}%{(last['c']/ma60-1)*100:8.1f}%"
          f"{(last['c']/last['h']-1)*100:10.2f}%{role:>8s}")
