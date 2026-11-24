"""AI 主线全链地图：按环节给出资金、量能、趋势、业绩的读数和排序，判定重心是否切换（研究层，OBSERVATION，不产生动作）

每日：python3 scripts/ai-mainline-map.py [--last 2026-11-24] [--save]
  资金：主力净流入 5 日、20 日累计占同期成交额（东方财富 fflow 日线）；融资余额 5 日、20 日变化（东方财富两融明细）
  量能：5 日均成交额 / 20 日均成交额；趋势：收盘相对 20 日、60 日均线；业绩：最近一期报告的营收、归母净利同比
  环节汇总：资金按成交额加权（主力）与余额合计（融资），趋势取等权均值，业绩取中位数
  资金排序：主力 5 日、主力 20 日、融资 5 日、融资 20 日四项各自排名，取平均名次
  切换判定 S1–S5（阈值见 SWITCH，读之前几天保存的 json 计连续天数）
历史：python3 scripts/ai-mainline-map.py --history [--save]
  按三轮行情，找各环节价格启动日与融资启动日，给出先后和间隔。主力资金日线只有约 120 个交易日，不进历史
输出只有比例和指数，不含金额。
"""
import datetime
import glob
import json
import os
import statistics
import sys
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

LAYERS = [
    ('上游：芯片与制造', {
        '芯片设计': ['688256', '688041', '688802', '688795', '688047'],
        '晶圆代工': ['688981', '688347', '688249'],
        '半导体设备': ['002371', '688012', '688072', '688120', '688082', '300604'],
        '半导体材料': ['688126', '300666', '688019', '300054', '002409'],
        '存储': ['603986', '688008', '688525', '301308', '001309', '301666'],
        '先进封装': ['688820', '600584', '002156', '688372'],
    }),
    ('中游：算力硬件', {
        '服务器、算力': ['601138', '000977', '603019', '000938', '300442'],
        '光模块': ['300308', '300502', '300394', '688498', '002281'],
        'PCB': ['002463', '002916', '600183', '300476'],
        '液冷、电源': ['002837', '002851', '002335', '301018'],
        '运营商': ['600941', '601728', '600050'],
    }),
    ('下游：应用', {
        '软件、应用': ['688111', '002230', '300033', '600588', '601360'],
        '机器人': ['300124', '002050', '601689', '688017', '002472', '601100', '002747'],
        '商业航天、星上算力': ['600118', '601698', '600879', '001270', '300762', '688568'],
        'AI 医疗、制药': ['603259', '600276', '688235', '300347', '300759', '300253', '603108'],
    }),
]
SEGMENTS = {k: v for _, d in LAYERS for k, v in d.items()}
# 重心切换：候选环节同时满足以下全部条件，且连续 DAYS 个交易日，判定“接力确认”；现重心任两项转负且连续 DAYS 日，判定“重心退潮”
SWITCH = {'rank_top': 3, 'main5': 0.0, 'main20': 0.0, 'margin5': 0.0, 'above20': 0.6, 'days': 3, 's2_above20': 0.4, 's5_days': 5}
# 地图第五节：S1 光模块或 PCB 接力；S2 代工或设备退潮（主力 5 日、主力 20 日、融资 5 日任两项为负连续 3 日，或站上 20 日线 <40%）；
# S3 存储接力；S4 下游接力；S5 全链退潮（连续 5 日没有任何环节 20 日主力为正）
S1_SEGS, S2_SEGS, S3_SEGS = ['光模块', 'PCB'], ['晶圆代工', '半导体设备'], ['存储']
S4_SEGS = ['软件、应用', '机器人', '商业航天、星上算力', 'AI 医疗、制药']
ROUNDS = [('2023 年 AI 第一轮', '2023-01-03', '2023-08-31'), ('2024-09 政策行情', '2024-09-02', '2025-03-31'),
          ('2025 海外算力行情', '2025-04-08', '2025-09-30'), ('2025-10 起国产链与存储行情', '2025-10-09', '2026-06-25')]
SAVE_DIR = os.path.join(os.path.dirname(__file__), '..', '战略组合2026-2030', '数据', 'AI主线')


def arg(name, default=None):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default


LAST = arg('--last')


def get(url, referer):
    last = None
    for i in range(5):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0', 'Referer': referer})
            return json.loads(urllib.request.urlopen(req, timeout=20).read())
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(1.5 * (i + 1))
    raise last


def secid(c):
    return ('1.' if c[0] in '69' else '0.') + c


def em_kline(c, lmt):
    d = get(f'https://push2his.eastmoney.com/api/qt/stock/kline/get?secid={secid(c)}&klt=101&fqt=1&lmt={lmt}&end=20500101'
            f'&fields1=f1,f3&fields2=f51,f53,f57', 'https://quote.eastmoney.com/')['data']
    rows = [k.split(',') for k in d['klines']]
    return d['name'], [(r[0], float(r[1]), float(r[2])) for r in rows if LAST is None or r[0] <= LAST]


def em_flow(c):
    d = get(f'https://push2his.eastmoney.com/api/qt/stock/fflow/daykline/get?lmt=0&klt=101&secid={secid(c)}&fields1=f1&fields2=f51,f52',
            'https://quote.eastmoney.com/')['data']
    return {k.split(',')[0]: float(k.split(',')[1]) for k in (d or {}).get('klines') or []}


def em_report(name, columns, flt, sort, size=500, pages=1):
    out = []
    for p in range(1, pages + 1):
        q = urllib.parse.urlencode({'reportName': name, 'columns': columns, 'filter': flt, 'pageSize': size, 'pageNumber': p,
                                    'sortColumns': sort, 'sortTypes': -1, 'source': 'WEB', 'client': 'WEB'})
        r = get('https://datacenter-web.eastmoney.com/api/data/v1/get?' + q, 'https://data.eastmoney.com/').get('result') or {}
        out += r.get('data') or []
        if p >= (r.get('pages') or 0):
            break
    return out


def margin(c, pages=1):
    rows = em_report('RPTA_WEB_RZRQ_GGMX', 'DATE,RZYE', f'(SCODE="{c}")', 'DATE', 500, pages)
    return {r['DATE'][:10]: r['RZYE'] for r in rows if LAST is None or r['DATE'][:10] <= LAST}


def pct(v, d=1):
    return '—' if v is None else f'{v * 100:+.{d}f}%'


def daily():
    codes = [c for v in SEGMENTS.values() for c in v]
    with ThreadPoolExecutor(6) as ex:
        K = dict(zip(codes, ex.map(lambda c: em_kline(c, 70), codes)))
        F = dict(zip(codes, ex.map(em_flow, codes)))
        M = dict(zip(codes, ex.map(margin, codes)))
    rep = em_report('RPT_LICO_FN_CPD', 'SECURITY_CODE,REPORTDATE,YSTZ,SJLTZ', '(SECURITY_CODE in ("' + '","'.join(codes) + '"))', 'REPORTDATE', 500, 3)
    earn = {}
    for r in rep:
        earn.setdefault(r['SECURITY_CODE'], r)
    last = max(K[c][1][-1][0] for c in codes)
    stocks = {}
    for c in codes:
        name, rows = K[c]
        if not rows or rows[-1][0] != last:
            continue
        cl, amt = [r[1] for r in rows], [r[2] for r in rows]
        days = [r[0] for r in rows]
        ma20, ma60 = statistics.mean(cl[-20:]), statistics.mean(cl[-60:]) if len(cl) >= 60 else None
        fl = [F[c].get(d) for d in days[-20:]]
        mg = [M[c][d] for d in sorted(M[c])][-21:]
        e = earn.get(c) or {}
        stocks[c] = {
            'name': name, 'd20': cl[-1] / ma20 - 1, 'd60': None if ma60 is None else cl[-1] / ma60 - 1,
            'r5': cl[-1] / cl[-6] - 1, 'r20': cl[-1] / cl[-21] - 1, 'vol': statistics.mean(amt[-5:]) / statistics.mean(amt[-20:]),
            'main5': sum(x for x in fl[-5:] if x) / sum(amt[-5:]) if None not in fl[-5:] else None,
            'main20': sum(x for x in fl if x) / sum(amt[-20:]) if None not in fl else None,
            'main5_raw': sum(x for x in fl[-5:] if x) if None not in fl[-5:] else None, 'main20_raw': sum(x for x in fl if x) if None not in fl else None,
            'amt5': sum(amt[-5:]), 'amt20': sum(amt[-20:]),
            'mg_now': mg[-1] if mg else None, 'mg5': mg[-6] if len(mg) >= 6 else None, 'mg20': mg[0] if len(mg) >= 21 else None,
            'margin5': mg[-1] / mg[-6] - 1 if len(mg) >= 6 else None, 'margin20': mg[-1] / mg[0] - 1 if len(mg) >= 21 else None,
            'margin_date': sorted(M[c])[-1] if M[c] else None,
            'report': (e.get('REPORTDATE') or '')[:10], 'rev_yoy': None if e.get('YSTZ') is None else e['YSTZ'] / 100,
            'np_yoy': None if e.get('SJLTZ') is None else e['SJLTZ'] / 100,
        }
    segs = {}
    for seg, cs in SEGMENTS.items():
        ss = [stocks[c] for c in cs if c in stocks]
        okf = [s for s in ss if s['main20_raw'] is not None]
        okm = [s for s in ss if s['mg20'] and s['mg5']]
        segs[seg] = {
            'n': len(ss), 'main5': sum(s['main5_raw'] for s in okf) / sum(s['amt5'] for s in okf) if okf else None,
            'main20': sum(s['main20_raw'] for s in okf) / sum(s['amt20'] for s in okf) if okf else None,
            'margin5': sum(s['mg_now'] for s in okm) / sum(s['mg5'] for s in okm) - 1 if okm else None,
            'margin20': sum(s['mg_now'] for s in okm) / sum(s['mg20'] for s in okm) - 1 if okm else None,
            'vol': statistics.mean(s['vol'] for s in ss), 'd20': statistics.mean(s['d20'] for s in ss),
            'd60': statistics.mean(s['d60'] for s in ss if s['d60'] is not None),
            'above20': sum(s['d20'] > 0 for s in ss) / len(ss), 'above60': sum((s['d60'] or -1) > 0 for s in ss) / len(ss),
            'r5': statistics.mean(s['r5'] for s in ss), 'r20': statistics.mean(s['r20'] for s in ss),
            'np_yoy': statistics.median([s['np_yoy'] for s in ss if s['np_yoy'] is not None] or [0]),
            'rev_yoy': statistics.median([s['rev_yoy'] for s in ss if s['rev_yoy'] is not None] or [0]),
        }
    keys = ['main5', 'main20', 'margin5', 'margin20']
    for k in keys:
        order = sorted((v[k] for v in segs.values() if v[k] is not None), reverse=True)
        for v in segs.values():
            v['rank_' + k] = order.index(v[k]) + 1 if v[k] is not None else None
    for v in segs.values():
        rs = [v['rank_' + k] for k in keys if v['rank_' + k]]
        v['score'] = statistics.mean(rs) if rs else 99
        pos = [v[k] is not None and v[k] > 0 for k in keys]
        v['flow'] = '累积' if all(pos) else '流出' if not any(pos) else ('偏累积' if sum(pos) >= 3 else '偏流出' if sum(pos) <= 1 else '分歧')
    ranking = sorted(segs, key=lambda s: segs[s]['score'])
    for i, s in enumerate(ranking):
        segs[s]['rank'] = i + 1
    return last, stocks, segs, ranking


def relay(v):
    return (v['rank'] <= SWITCH['rank_top'] and (v['main5'] or -1) > SWITCH['main5'] and (v['main20'] or -1) > SWITCH['main20']
            and (v['margin5'] or -1) > SWITCH['margin5'] and v['above20'] >= SWITCH['above20'])


def ebb(v):
    return sum(1 for k in ('main5', 'main20', 'margin5') if v[k] is not None and v[k] < 0) >= 2


def no_inflow(segs):
    return not any((v['main20'] or 0) > 0 for v in segs.values())


def switch_state(last, segs):
    prev = []
    for p in sorted(glob.glob(os.path.join(SAVE_DIR, '20*.json'))):
        if os.path.basename(p)[:10] < last:
            prev.append(json.load(open(p, encoding='utf-8'))['segments'])
    hist = prev[-(max(SWITCH['days'], SWITCH['s5_days']) - 1):] + [segs]

    def run(pred):
        n = 0
        for day in reversed(hist):
            if not pred(day):
                break
            n += 1
        return n
    streak = {s: run(lambda d, s=s: s in d and relay(d[s])) for s in segs}
    ebb_streak = {s: run(lambda d, s=s: s in d and ebb(d[s])) for s in S2_SEGS}
    s5 = run(no_inflow)
    triggers = {}
    for name, members in (('S1', S1_SEGS), ('S3', S3_SEGS), ('S4', S4_SEGS)):
        hit = [s for s in members if streak[s] >= SWITCH['days']]
        triggers[name] = {'hit': bool(hit), 'segments': hit, 'streak': {s: streak[s] for s in members}}
    hit2 = [s for s in S2_SEGS if ebb_streak[s] >= SWITCH['days'] or segs[s]['above20'] < SWITCH['s2_above20']]
    triggers['S2'] = {'hit': bool(hit2), 'segments': hit2, 'streak': ebb_streak, 'above20': {s: segs[s]['above20'] for s in S2_SEGS}}
    triggers['S5'] = {'hit': s5 >= SWITCH['s5_days'], 'streak': s5}
    return streak, triggers


def run_daily():
    last, stocks, segs, ranking = daily()
    streak, triggers = switch_state(last, segs)
    fetched = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=8))).strftime('%Y-%m-%d %H:%M')
    mdate = max((s['margin_date'] for s in stocks.values() if s['margin_date']), default='—')
    print(f'取数 {fetched}（北京时间）　行情截至 {last}　融资截至 {mdate}　主力资金截至 {last}\n')
    print('| 名次 | 环节 | 资金 | 主力 5 日 | 主力 20 日 | 融资 5 日 | 融资 20 日 | 量能 5/20 | 相对 20 日线 | 相对 60 日线 | 站上 20 日线 | 5 日涨跌 | 20 日涨跌 | 净利同比中位 | 接力条件连续天数 |')
    print('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|')
    for s in ranking:
        v = segs[s]
        print(f"| {v['rank']} | {s} | {v['flow']} | {pct(v['main5'])} | {pct(v['main20'])} | {pct(v['margin5'])} | {pct(v['margin20'])} | {v['vol']:.2f} | "
              f"{pct(v['d20'], 0)} | {pct(v['d60'], 0)} | {v['above20']:.0%} | {pct(v['r5'], 0)} | {pct(v['r20'], 0)} | {pct(v['np_yoy'], 0)} | {streak[s]} |")
    print(f"\n接力条件：资金排序前 {SWITCH['rank_top']}，主力 5 日与 20 日为正，融资 5 日为正，站上 20 日线的比例不低于 {SWITCH['above20']:.0%}，连续 {SWITCH['days']} 日\n")
    print('| 触发 | 是否触发 | 读数 |')
    print('|---|---|---|')
    label = {'S1': '光模块或 PCB 接力', 'S3': '存储接力', 'S4': '下游接力'}
    for k in ('S1', 'S3', 'S4'):
        t = triggers[k]
        print(f"| {k} {label[k]} | {'是：' + '、'.join(t['segments']) if t['hit'] else '否'} | " + '；'.join(f'{s} 连续 {n} 日' for s, n in t['streak'].items()) + ' |')
    t = triggers['S2']
    print(f"| S2 代工或设备退潮 | {'是：' + '、'.join(t['segments']) if t['hit'] else '否'} | "
          + '；'.join(f"{s} 任两项为负连续 {t['streak'][s]} 日、站上 20 日线 {t['above20'][s]:.0%}" for s in S2_SEGS) + ' |')
    t = triggers['S5']
    print(f"| S5 全链退潮 | {'是' if t['hit'] else '否'} | 没有任何环节 20 日主力为正：连续 {t['streak']} 日（阈值 {SWITCH['s5_days']} 日） |")
    print('\n### 个股\n')
    print('| 环节 | 股票 | 主力 5 日 | 主力 20 日 | 融资 5 日 | 融资 20 日 | 量能 5/20 | 相对 20 日线 | 相对 60 日线 | 报告期 | 营收同比 | 净利同比 |')
    print('|---|---|---|---|---|---|---|---|---|---|---|---|')
    for seg in ranking:
        for c in SEGMENTS[seg]:
            if c in stocks:
                x = stocks[c]
                print(f"| {seg} | {x['name']} | {pct(x['main5'])} | {pct(x['main20'])} | {pct(x['margin5'])} | {pct(x['margin20'])} | {x['vol']:.2f} | "
                      f"{pct(x['d20'], 0)} | {pct(x['d60'], 0)} | {x['report']} | {pct(x['rev_yoy'], 0)} | {pct(x['np_yoy'], 0)} |")
    if '--save' in sys.argv:
        os.makedirs(SAVE_DIR, exist_ok=True)
        slim = {c: {k: v for k, v in x.items() if not k.endswith('_raw') and not k.startswith(('amt', 'mg_', 'mg5', 'mg20'))} for c, x in stocks.items()}
        rec = {'fetched_at_utc8': fetched, 'last': last, 'margin_last': mdate, 'switch_rule': SWITCH, 'ranking': ranking,
               'segments': segs, 'streak': streak, 'triggers': triggers, 'stocks': slim}
        path = os.path.join(SAVE_DIR, f'{last}.json')
        json.dump(rec, open(path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
        print(f'\n已保存 {os.path.relpath(path)}')


def tencent(c):
    sym = ('sh' if c[0] in '69' else 'sz') + c
    out = {}
    for y in range(2022, datetime.date.today().year + 1):
        d = get(f'https://web.ifzq.gtimg.cn/appstock/app/newfqkline/get?param={sym},day,{y}-01-01,{y}-12-31,640,qfq', 'https://gu.qq.com/')['data'][sym]
        out.update({r[0]: float(r[2]) for r in d.get('qfqday') or d.get('day') or []})
    return out


def run_history():
    """价格启动：环节等权指数较此前 60 日低点 +20% 且站上 60 日线的第一天；融资启动：环节融资余额合计 20 日变化首次 ≥ +15% 的那天"""
    codes = [c for v in SEGMENTS.values() for c in v]
    with ThreadPoolExecutor(6) as ex:
        P = dict(zip(codes, ex.map(tencent, codes)))
        M = dict(zip(codes, ex.map(lambda c: margin(c, 6), codes)))
    result = []
    for label, a, b in ROUNDS:
        row = {'round': label, 'start': a, 'end': b, 'segments': {}}
        for seg, cs in SEGMENTS.items():
            days = sorted(set().union(*[set(P[c]) for c in cs]))
            days = [d for d in days if d <= b]
            idx, level = [], 1.0
            for i in range(1, len(days)):
                rs = [P[c][days[i]] / P[c][days[i - 1]] - 1 for c in cs if days[i] in P[c] and days[i - 1] in P[c]]
                level *= 1 + (statistics.mean(rs) if rs else 0)
                idx.append((days[i], level))
            def up(i):
                v = idx[i][1]
                return v >= 1.2 * min(x for _, x in idx[i - 60:i]) and v > statistics.mean(x for _, x in idx[i - 60:i])
            launch = None
            for i in range(61, len(idx)):
                if idx[i][0] >= a and up(i):
                    launch = idx[i][0] if not up(i - 1) or idx[i - 1][0] >= a else '窗口前已启动'
                    break
            mdays = sorted(set().union(*[set(M[c]) for c in cs]))
            tot = {d: sum(M[c][d] for c in cs if d in M[c]) for d in mdays}
            cnt = {d: sum(1 for c in cs if d in M[c]) for d in mdays}
            mlaunch = None
            def mup(i):
                d, d0 = mdays[i], mdays[i - 20]
                return cnt[d] == cnt[d0] and cnt[d] and tot[d] / tot[d0] - 1 >= 0.15
            for i in range(21, len(mdays)):
                if a <= mdays[i] <= b and mup(i):
                    mlaunch = mdays[i] if not mup(i - 1) or mdays[i - 1] >= a else '窗口前已启动'
                    break
            seg_ret = None
            inr = [(d, v) for d, v in idx if a <= d <= b]
            if inr:
                seg_ret = inr[-1][1] / inr[0][1] - 1
            row['segments'][seg] = {'price_launch': launch, 'margin_launch': mlaunch, 'round_return': seg_ret,
                                    'members_with_data': sum(1 for c in cs if any(a <= d <= b for d in P[c]))}
        result.append(row)
        print(f'\n### {label}（{a} 至 {b}）\n')
        print('| 顺序 | 环节 | 价格启动 | 融资启动 | 融资比价格 | 区间涨跌 | 有数据的成份股 |')
        print('|---|---|---|---|---|---|---|')
        order = sorted(row['segments'].items(), key=lambda kv: '0' if kv[1]['price_launch'] == '窗口前已启动' else kv[1]['price_launch'] or '9999')
        for i, (seg, v) in enumerate(order):
            lag = None
            if v['price_launch'] and v['margin_launch'] and '前' not in v['price_launch'] + v['margin_launch']:
                lag = (datetime.date.fromisoformat(v['margin_launch']) - datetime.date.fromisoformat(v['price_launch'])).days
            print(f"| {i + 1 if v['price_launch'] else '—'} | {seg} | {v['price_launch'] or '未启动'} | {v['margin_launch'] or '未启动'} | "
                  f"{'—' if lag is None else f'{lag:+d} 天'} | {pct(v['round_return'], 0)} | {v['members_with_data']}/{len(SEGMENTS[seg])} |")
    if '--save' in sys.argv:
        os.makedirs(SAVE_DIR, exist_ok=True)
        path = os.path.join(SAVE_DIR, '传导顺序-历史.json')
        json.dump(result, open(path, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
        print(f'\n已保存 {os.path.relpath(path)}')


if __name__ == '__main__':
    run_history() if '--history' in sys.argv else run_daily()
