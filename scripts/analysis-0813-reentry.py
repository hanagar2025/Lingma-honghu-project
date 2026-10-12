#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""① 再入场四条件的具体触发价  ② "下一轮中际"的历史画像实证"""
import json, urllib.request, ssl

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE


def bars(code, num=900):
    url = (f"https://ifzq.gtimg.cn/appstock/app/fqkline/get?"
           f"param={code},day,,,{num},qfq")
    d = json.loads(urllib.request.urlopen(url, timeout=25, context=ctx)
                   .read().decode('utf-8'))['data'][code]
    k = d.get('qfqday') or d.get('day')
    return [{'d': r[0], 'o': float(r[1]), 'c': float(r[2]),
             'h': float(r[3]), 'l': float(r[4]), 'v': float(r[5])} for r in k]


def sma(b, n, i):
    s = b[max(0, i - n + 1):i + 1]
    return sum(x['c'] for x in s) / len(s)


NAMES = {'sz300308': '中际旭创', 'sz300502': '新易盛', 'sh688008': '澜起科技',
         'sh603986': '兆易创新', 'sz300394': '天孚通信', 'sz300620': '光库科技',
         'sh688313': '仕佳光子', 'sh688498': '源杰科技'}
B = {c: bars(c) for c in NAMES}
IDX = bars('sz399006')
IX = {x['d']: x['c'] for x in IDX}

print("=" * 100)
print("【一】再入场四条件的具体触发价（条件①趋势修复：站上MA20 → 再修复MA60）")
print("=" * 100)
print(f"{'标的':8s}{'现价':>10s}{'MA20':>10s}{'需涨':>8s}{'MA60':>10s}{'需涨':>8s}"
      f"{'60日峰':>10s}{'距峰':>8s}")
for c in ('sz300308', 'sz300502', 'sh688008', 'sh603986'):
    b = B[c]
    n = len(b) - 1
    px, m20, m60 = b[-1]['c'], sma(b, 20, n), sma(b, 60, n)
    hi = max(x['c'] for x in b[-60:])
    print(f"{NAMES[c]:8s}{px:10.2f}{m20:10.2f}{(m20/px-1)*100:+7.1f}%"
          f"{m60:10.2f}{(m60/px-1)*100:+7.1f}%{hi:10.2f}{(px/hi-1)*100:+7.1f}%")

print()
print("=" * 100)
print("【二】中际旭创上一轮主升浪之前，它自己长什么样？（寻找'下一轮中际'的位置画像）")
print("=" * 100)
b = B['sz300308']
# 找出历史上的主升浪：以60日涨幅>80%定义为主升段，回溯其起点前的状态
runs = []
i = 60
while i < len(b) - 1:
    r60 = b[i]['c'] / b[i - 60]['c'] - 1
    if r60 > 0.8:
        runs.append((i - 60, i, r60))
        i += 60
    else:
        i += 1
print(f"识别到 {len(runs)} 段60日涨幅>80%的主升段：")
for s, e, r in runs:
    print(f"\n  主升段 {b[s]['d']} ({b[s]['c']:.2f}) → {b[e]['d']} ({b[e]['c']:.2f})  "
          f"60日 {r*100:+.1f}%")
    # 起点前一日的状态画像
    j = s
    px = b[j]['c']
    m20, m60, m120 = sma(b, 20, j), sma(b, 60, j), sma(b, 120, j)
    hi250 = max(x['c'] for x in b[max(0, j - 250):j + 1])
    v20 = sum(x['v'] for x in b[j - 19:j + 1]) / 20
    v60 = sum(x['v'] for x in b[j - 59:j + 1]) / 60
    r10 = px / b[j - 10]['c'] - 1
    r60p = px / b[j - 60]['c'] - 1
    ixr60 = (IX.get(b[j]['d'], 0) / IX.get(b[j - 60]['d'], 1) - 1) if b[j]['d'] in IX and b[j-60]['d'] in IX else float('nan')
    print(f"    起点当日画像：距MA20 {(px/m20-1)*100:+6.1f}%  距MA60 {(px/m60-1)*100:+6.1f}%  "
          f"距MA120 {(px/m120-1)*100:+6.1f}%")
    print(f"                  距250日高点 {(px/hi250-1)*100:+6.1f}%  "
          f"前10日涨幅 {r10*100:+6.1f}%  前60日涨幅 {r60p*100:+6.1f}%  "
          f"前60日超额 {(r60p-ixr60)*100:+6.1f}pct")
    print(f"                  量20/60 {v20/v60:5.2f}")

print()
print("=" * 100)
print("【三】把同一画像口径套到今天的候选上（起飞前 vs 今天）")
print("=" * 100)
print(f"{'标的':8s}{'距MA20':>9s}{'距MA60':>9s}{'距MA120':>9s}{'距250日高':>10s}"
      f"{'前10日':>9s}{'前60日':>9s}{'60日超额':>10s}{'量20/60':>9s}")
for c in ('sz300308', 'sz300502', 'sz300394', 'sz300620', 'sh688313', 'sh688498'):
    b2 = B[c]
    j = len(b2) - 1
    px = b2[j]['c']
    m20, m60 = sma(b2, 20, j), sma(b2, 60, j)
    m120 = sma(b2, 120, j)
    hi250 = max(x['c'] for x in b2[max(0, j - 250):j + 1])
    v20 = sum(x['v'] for x in b2[j - 19:j + 1]) / 20
    v60 = sum(x['v'] for x in b2[j - 59:j + 1]) / 60
    r10 = px / b2[j - 10]['c'] - 1
    r60 = px / b2[j - 60]['c'] - 1
    ixr = IX[b2[j]['d']] / IX[b2[j - 60]['d']] - 1
    print(f"{NAMES[c]:8s}{(px/m20-1)*100:+8.1f}%{(px/m60-1)*100:+8.1f}%"
          f"{(px/m120-1)*100:+8.1f}%{(px/hi250-1)*100:+9.1f}%"
          f"{r10*100:+8.1f}%{r60*100:+8.1f}%{(r60-ixr)*100:+9.1f}pct{v20/v60:9.2f}")
