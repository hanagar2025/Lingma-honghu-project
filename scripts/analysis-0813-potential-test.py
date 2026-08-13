#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""委员会五问实测：蓄能 vs 派发。数据源腾讯行情，仅用收盘口径。"""
import json, urllib.request, ssl, sys

ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

POOL = {
    'sz300308': '中际旭创', 'sz300502': '新易盛', 'sz300394': '天孚通信',
    'sh688498': '源杰科技', 'sh688313': '仕佳光子', 'sz300620': '光库科技',
    'sz002281': '光迅科技', 'sz002384': '东山精密', 'sh600183': '生益科技',
    'sh688008': '澜起科技', 'sh603986': '兆易创新', 'sh688041': '海光信息',
    'sz002371': '北方华创', 'sh688012': '中微公司', 'sz002463': '沪电股份',
}
IDX = {'sh000688': '科创50', 'sz399006': '创业板指', 'sh000001': '上证指数'}


def bars(code, num=140):
    url = (f"https://ifzq.gtimg.cn/appstock/app/fqkline/get?"
           f"param={code},day,,,{num},qfq")
    raw = urllib.request.urlopen(url, timeout=20, context=ctx).read().decode('utf-8')
    d = json.loads(raw)['data'][code]
    k = d.get('qfqday') or d.get('day')
    # [date, open, close, high, low, volume]
    return [{'d': r[0], 'o': float(r[1]), 'c': float(r[2]),
             'h': float(r[3]), 'l': float(r[4]), 'v': float(r[5])} for r in k]


def ma(b, n, i=-1):
    seg = [x['c'] for x in b][:len(b) + (i + 1) if i != -1 else len(b)][-n:]
    return sum(seg) / len(seg) if seg else float('nan')


def report(code, name):
    try:
        b = bars(code)
    except Exception as e:
        return {'name': name, 'err': str(e)}
    last = b[-1]
    hi60 = max(x['c'] for x in b[-60:])
    hi60d = [x['d'] for x in b[-60:] if x['c'] == hi60][0]
    v5 = sum(x['v'] for x in b[-5:]) / 5
    v20 = sum(x['v'] for x in b[-20:]) / 20
    v60 = sum(x['v'] for x in b[-60:]) / 60
    return {
        'name': name, 'code': code, 'date': last['d'],
        'close': last['c'], 'open': last['o'], 'high': last['h'], 'low': last['l'],
        'fade': (last['c'] / last['h'] - 1) * 100,      # 收盘距当日最高
        'chg': (last['c'] / b[-2]['c'] - 1) * 100,
        'hi60': hi60, 'hi60d': hi60d,
        'from_hi': (last['c'] / hi60 - 1) * 100,
        'ma5': ma(b, 5), 'ma10': ma(b, 10), 'ma20': ma(b, 20), 'ma60': ma(b, 60),
        'v5_20': v5 / v20, 'v20_60': v20 / v60,
        'r5': (last['c'] / b[-6]['c'] - 1) * 100,
        'r10': (last['c'] / b[-11]['c'] - 1) * 100,
        'r20': (last['c'] / b[-21]['c'] - 1) * 100,
        'bars': b,
    }


def main():
    out = {}
    for c, n in list(POOL.items()) + list(IDX.items()):
        out[c] = report(c, n)
        r = out[c]
        if 'err' in r:
            print(f"ERR {n}: {r['err']}", file=sys.stderr)
            continue
        print(f"{n:6s} {r['date']} 收{r['close']:9.2f} "
              f"日涨{r['chg']:+6.2f}% 距当日高{r['fade']:+6.2f}% | "
              f"60日峰{r['hi60']:9.2f}({r['hi60d']}) 距峰{r['from_hi']:+7.2f}% | "
              f"MA20 {r['ma20']:9.2f} MA60 {r['ma60']:9.2f} | "
              f"量5/20 {r['v5_20']:.2f} 20/60 {r['v20_60']:.2f} | "
              f"5日{r['r5']:+6.2f}% 10日{r['r10']:+6.2f}% 20日{r['r20']:+6.2f}%")

    # 逐日明细：8/4 起的每日收盘与量，用于判断回落是否缩量、二次冲高是否破前高
    print("\n=== 中际/新易盛/天孚 逐日（8月以来） ===")
    for c in ('sz300308', 'sz300502', 'sz300394'):
        r = out[c]
        print(f"\n-- {r['name']}")
        for x in r['bars']:
            if x['d'] >= '2026-07-29':
                print(f"   {x['d']} 开{x['o']:9.2f} 高{x['h']:9.2f} "
                      f"低{x['l']:9.2f} 收{x['c']:9.2f} 量{x['v']:12.0f} "
                      f"收距高{(x['c']/x['h']-1)*100:+6.2f}%")

    with open('/tmp/pool.json', 'w') as f:
        json.dump({k: {kk: vv for kk, vv in v.items() if kk != 'bars'}
                   for k, v in out.items()}, f, ensure_ascii=False, indent=1)


main()
