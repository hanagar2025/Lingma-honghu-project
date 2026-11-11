"""主线核心个股：风险与机会读数（研究层，OBSERVATION，不产生动作）

每只股票回答四个问题，全部用可复算的公开数据：
  甲 盈利在加速还是减速：三季报单季营收、归母、扣非的同比与环比，存货、应收、经营现金流
  乙 价格里已经包含多少悲观预期：滚动市盈率、相对高点日的估值压缩、距高点跌幅
  丙 被迫卖出的人卖完了没有：融资余额变化、融资余额占流通市值、是否刚创 60 日新低
  丁 资金注意力：成交额占两市比例的分位、相对创业板指的强弱

用法：python3 scripts/scan-risk-opportunity.py --cut 2026-11-10 [--save]
  --cut  行情截止日（只用已收盘的交易日）
  --save 读数写入 战略组合2026-2030/数据/风险与机会/<截止日>.json
数据源：腾讯日 K（行情、成交额、总市值）；东方财富数据中心（融资、业绩报表、利润表、资产负债表、现金流量表）；
       新浪财务报表（第二源，逐只核对累计营收与归母净利润）。
"""
import datetime
import json
import os
import sys
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor

POOLS = {
    '光通信': {'300308': '中际旭创', '300502': '新易盛', '300394': '天孚通信', '300620': '光库科技',
            '002281': '光迅科技', '688313': '仕佳光子', '688498': '源杰科技'},
    '半导体设备': {'002371': '北方华创', '688012': '中微公司', '688072': '拓荆科技', '688120': '华海清科',
              '300567': '精测电子', '688361': '中科飞测', '688003': '天准科技'},
    'PCB': {'002463': '沪电股份', '002916': '深南电路', '600183': '生益科技', '002384': '东山精密'},
    'CPU/系统': {'688041': '海光信息', '603019': '中科曙光', '688256': '寒武纪'},
    'AI电力': {'000400': '许继电气', '600312': '平高电气', '002028': '思源电气', '002851': '麦格米特',
             '300870': '欧陆通', '002837': '英维克'},
}
INDEX = ['sh000001', 'sz399106', 'sz399006']
EM = 'https://datacenter-web.eastmoney.com/api/data/v1/get?reportName={}&columns=ALL&filter={}&sortColumns={}&sortTypes=-1&pageSize=500&pageNumber=1'
SAVE_DIR = os.path.join(os.path.dirname(__file__), '..', '战略组合2026-2030', '数据', '风险与机会')
CUT = sys.argv[sys.argv.index('--cut') + 1] if '--cut' in sys.argv else None
CODES = [c for p in POOLS.values() for c in p]


def sym(c):
    return ('sh' if c[0] in '69' else 'sz') + c


def get(url, referer):
    last = None
    for i in range(4):
        try:
            req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0', 'Referer': referer})
            return urllib.request.urlopen(req, timeout=25).read()
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(1.5 * (i + 1))
    raise last


def kline(s):
    d = json.loads(get(f'https://web.ifzq.gtimg.cn/appstock/app/newfqkline/get?param={s},day,,,800,qfq', 'https://gu.qq.com/'))
    rows = d['data'][s].get('qfqday') or d['data'][s].get('day')
    return {r[0]: (float(r[2]), float(r[8]) * 1e4) for r in rows if len(r) > 8 and (CUT is None or r[0] <= CUT)}


def margin(code):
    f = urllib.parse.quote(f'(SCODE="{code}")')
    rows = json.loads(get(EM.format('RPTA_WEB_RZRQ_GGMX', f, 'DATE').replace('pageSize=500', 'pageSize=140'), 'https://data.eastmoney.com/'))['result']['data']
    return [r for r in rows if CUT is None or r['DATE'][:10] <= CUT]


def em_table(report, date_key):
    f = urllib.parse.quote('(SECURITY_CODE in (' + ','.join(f'"{c}"' for c in CODES) + f"))({date_key}>='2025-03-31')")
    rows = json.loads(get(EM.format(report, f, date_key), 'https://data.eastmoney.com/'))['result']['data']
    out = {}
    for r in rows:
        out.setdefault(r['SECURITY_CODE'], {})[r[date_key][:10]] = r
    return out


def sina_income(code):
    url = f'https://quotes.sina.cn/cn/api/openapi.php/CompanyFinanceService.getFinanceReport2022?paperCode={sym(code)}&source=lrb&type=0&page=1&num=8'
    try:
        rl = json.loads(get(url, 'https://finance.sina.com.cn'))['result']['data']['report_list']
    except Exception:  # noqa: BLE001
        return None
    out = {}
    for d, rep in rl.items():
        it = {i['item_title']: i['item_value'] for i in rep['data']}
        np_ = next((it[k] for k in it if k.startswith('归属于母公司') and '净利润' in k and it[k]), None)
        out[f'{d[:4]}-{d[4:6]}-{d[6:]}'] = (float(it.get('营业总收入') or it.get('营业收入') or 0), float(np_ or 0))
    return out


with ThreadPoolExecutor(10) as ex:
    syms = INDEX + [sym(c) for c in CODES]
    K = dict(zip(syms, ex.map(kline, syms)))
with ThreadPoolExecutor(6) as ex:
    M = dict(zip(CODES, ex.map(margin, CODES)))
with ThreadPoolExecutor(4) as ex:
    S = dict(zip(CODES, ex.map(sina_income, CODES)))
F = em_table('RPT_LICO_FN_CPD', 'REPORTDATE')
I = em_table('RPT_DMSK_FN_INCOME', 'REPORT_DATE')
B = em_table('RPT_DMSK_FN_BALANCE', 'REPORT_DATE')
C = em_table('RPT_DMSK_FN_CASHFLOW', 'REPORT_DATE')
quote = get('https://qt.gtimg.cn/q=' + ','.join(sym(c) for c in CODES), 'https://gu.qq.com/').decode('gbk')
Q = {f[2]: (float(f[3]), float(f[45])) for f in (line.split('~') for line in quote.split(';')) if len(f) > 45}

dates = sorted(set(K['sh000001']) & set(K['sz399106']))
last = dates[-1]
mkt = {d: K['sh000001'][d][1] + K['sz399106'][d][1] for d in dates}


def val(X, c, d, k):
    r = X.get(c, {}).get(d)
    return r.get(k) if r else None


def single(X, c, k, year, q):
    ends = {1: '03-31', 2: '06-30', 3: '09-30'}
    cur = val(X, c, f'{year}-{ends[q]}', k)
    if cur is None or q == 1:
        return cur
    prev = val(X, c, f'{year}-{ends[q - 1]}', k)
    return None if prev is None else cur - prev


def growth(a, b):
    return None if a is None or b is None or b <= 0 else a / b - 1


def ttm(X, c, k, ytd_date, prev_date):
    fy, ytd, prev = val(X, c, '2025-12-31', k), val(X, c, ytd_date, k), val(X, c, prev_date, k)
    return None if None in (fy, ytd, prev) else fy + ytd - prev


def ret(s, k):
    ds = [d for d in dates if d in K[s]]
    return K[s][ds[-1]][0] / K[s][ds[-1 - k]][0] - 1


records, mismatches = {}, []
for pool, members in POOLS.items():
    for c, name in members.items():
        s = sym(c)
        ds = [d for d in dates if d in K[s]]
        close = K[s][ds[-1]][0]
        high_d = max(ds[-250:], key=lambda d: K[s][d][0])
        low_d = min(ds[-60:], key=lambda d: K[s][d][0])
        shares = [sum(K[s][d][1] for d in dates[i - 20:i] if d in K[s]) / sum(mkt[d] for d in dates[i - 20:i])
                  for i in range(len(dates) - 500, len(dates) + 1)]
        m = M[c]
        ratio = [(r['DATE'][:10], r['RZYE'] / r['SZ']) for r in m if r['SZ']]
        peak = max(m[:130], key=lambda r: r['RZYE'])
        price, mcap = Q[c]
        mc = mcap * close / price
        ttm_now = ttm(F, c, 'PARENT_NETPROFIT', '2026-09-30', '2025-09-30')
        ttm_high = ttm(F, c, 'PARENT_NETPROFIT', '2026-03-31', '2025-03-31')
        dttm = ttm(I, c, 'DEDUCT_PARENT_NETPROFIT', '2026-09-30', '2025-09-30')
        pe = mc * 1e8 / ttm_now if ttm_now and ttm_now > 0 else None
        pe_high = mc * K[s][high_d][0] / close * 1e8 / ttm_high if ttm_high and ttm_high > 0 else None
        r3, r3p, r2 = (single(F, c, 'TOTAL_OPERATE_INCOME', y, q) for y, q in ((2026, 3), (2025, 3), (2026, 2)))
        n3, n3p, n2 = (single(F, c, 'PARENT_NETPROFIT', y, q) for y, q in ((2026, 3), (2025, 3), (2026, 2)))
        d3, d3p, d2 = (single(I, c, 'DEDUCT_PARENT_NETPROFIT', y, q) for y, q in ((2026, 3), (2025, 3), (2026, 2)))
        cfo, np_ytd = val(C, c, '2026-09-30', 'NETCASH_OPERATE'), val(F, c, '2026-09-30', 'PARENT_NETPROFIT')
        for d in ('2026-09-30', '2026-06-30', '2025-09-30', '2025-06-30'):
            e, sn = F.get(c, {}).get(d), (S[c] or {}).get(d)
            if not e or not sn:
                mismatches.append(f'{name} {d} 缺第二源')
            elif any(abs(a - b) > max(1e4, abs(b) * 1e-4) for a, b in ((e['TOTAL_OPERATE_INCOME'], sn[0]), (e['PARENT_NETPROFIT'], sn[1]))):
                mismatches.append(f'{name} {d} 两源不一致')
        records[c] = {
            'pool': pool, 'name': name, 'close': close,
            'ret5': ret(s, 5), 'ret20': ret(s, 20), 'ret60': ret(s, 60),
            'from_high': close / K[s][high_d][0] - 1, 'high_date': high_d,
            'from_low60': close / K[s][low_d][0] - 1, 'low_date': low_d, 'new_low_5d': low_d >= ds[-5],
            'rel_chinext_5': ret(s, 5) - ret('sz399006', 5), 'rel_chinext_20': ret(s, 20) - ret('sz399006', 20),
            'turnover_share_pct': sum(1 for x in shares if x <= shares[-1]) / len(shares) * 100,
            'margin_date': m[0]['DATE'][:10], 'margin_chg5': m[0]['RZYE'] / m[5]['RZYE'] - 1,
            'margin_chg20': m[0]['RZYE'] / m[20]['RZYE'] - 1, 'margin_from_peak': m[0]['RZYE'] / peak['RZYE'] - 1,
            'margin_to_float': ratio[0][1], 'margin_to_float_high': max(x[1] for x in ratio),
            'notice_date': (val(F, c, '2026-09-30', 'NOTICE_DATE') or '')[:10],
            'q3_rev': r3, 'q3_rev_yoy': growth(r3, r3p), 'q3_rev_qoq': growth(r3, r2),
            'q3_np': n3, 'q3_np_yoy': growth(n3, n3p), 'q3_np_qoq': growth(n3, n2),
            'q3_deduct': d3, 'q3_deduct_yoy': growth(d3, d3p), 'q3_deduct_qoq': growth(d3, d2),
            'deduct_to_np': d3 / n3 if d3 is not None and n3 and n3 > 0 else None,
            'gross_margin_ytd': val(F, c, '2026-09-30', 'XSMLL'), 'gross_margin_ytd_prev': val(F, c, '2025-09-30', 'XSMLL'),
            'inventory_qoq': growth(val(B, c, '2026-09-30', 'INVENTORY'), val(B, c, '2026-06-30', 'INVENTORY')),
            'receivable_qoq': growth(val(B, c, '2026-09-30', 'ACCOUNTS_RECE'), val(B, c, '2026-06-30', 'ACCOUNTS_RECE')),
            'cfo_to_np': cfo / np_ytd if cfo is not None and np_ytd and np_ytd > 0 else None,
            'mcap_yi': mc, 'pe_ttm': pe, 'pe_ttm_at_high': pe_high,
            'pe_deduct_ttm': mc * 1e8 / dttm if dttm and dttm > 0 else None,
            'pe_q3_annualized': mc * 1e8 / (n3 * 4) if n3 and n3 > 0 else None,
        }


def pct(v, digits=0):
    return '—' if v is None else f'{v * 100:+.{digits}f}%'


def num(v, digits=1):
    return '—' if v is None else f'{v:.{digits}f}'


fetched = datetime.datetime.now(datetime.timezone(datetime.timedelta(hours=8))).strftime('%Y-%m-%d %H:%M')
print(f'取数 {fetched}（北京时间）　行情截至 {last}　融资截至 {records["300308"]["margin_date"]}　财报期 2026 三季报')
print('第二源核对（新浪，27 只 × 4 期累计营收与归母）：' + ('全部一致' if not mismatches else '；'.join(mismatches)))

print('\n### 甲　盈利（三季报单季）\n')
print('| 池 | 股票 | 披露日 | 营收同比 | 营收环比 | 归母同比 | 归母环比 | 扣非环比 | 扣非/归母 | 毛利率（去年同期） | 存货较 6/30 | 应收较 6/30 | 经营现金流/归母 |')
print('|---|---|---|---|---|---|---|---|---|---|---|---|---|')
for r in records.values():
    print(f"| {r['pool']} | {r['name']} | {r['notice_date'][5:]} | {pct(r['q3_rev_yoy'])} | {pct(r['q3_rev_qoq'])} | {pct(r['q3_np_yoy'])} | {pct(r['q3_np_qoq'])} | {pct(r['q3_deduct_qoq'])} | {pct(r['deduct_to_np']).lstrip('+')} | {num(r['gross_margin_ytd'])}（{num(r['gross_margin_ytd_prev'])}） | {pct(r['inventory_qoq'])} | {pct(r['receivable_qoq'])} | {pct(r['cfo_to_np']).lstrip('+')} |")

print('\n### 乙　估值与价格\n')
print('| 池 | 股票 | 收盘 | 距 250 日高点（日期） | 20 日 | 滚动市盈率 | 高点日市盈率 | 扣非滚动市盈率 | 三季度年化市盈率 |')
print('|---|---|---|---|---|---|---|---|---|')
for r in records.values():
    print(f"| {r['pool']} | {r['name']} | {r['close']:.2f} | {pct(r['from_high'])}（{r['high_date']}） | {pct(r['ret20'])} | {num(r['pe_ttm'])} | {num(r['pe_ttm_at_high'])} | {num(r['pe_deduct_ttm'])} | {num(r['pe_q3_annualized'])} |")

print('\n### 丙丁　被迫卖出与资金注意力\n')
print('| 池 | 股票 | 距 60 日低点（日期） | 近 5 日创新低 | 相对创业板 5 日 | 相对创业板 20 日 | 成交占两市分位 | 融资 5 日 | 融资 20 日 | 融资较峰值 | 融资/流通市值（140 日最高） |')
print('|---|---|---|---|---|---|---|---|---|---|---|')
for r in records.values():
    print(f"| {r['pool']} | {r['name']} | {pct(r['from_low60'])}（{r['low_date'][5:]}） | {'是' if r['new_low_5d'] else '否'} | {pct(r['rel_chinext_5'], 1)} | {pct(r['rel_chinext_20'], 1)} | {r['turnover_share_pct']:.0f} | {pct(r['margin_chg5'], 1)} | {pct(r['margin_chg20'], 1)} | {pct(r['margin_from_peak'])} | {r['margin_to_float'] * 100:.1f}%（{r['margin_to_float_high'] * 100:.1f}%） |")

if '--save' in sys.argv:
    os.makedirs(SAVE_DIR, exist_ok=True)
    path = os.path.join(SAVE_DIR, f'{last}.json')
    with open(path, 'w', encoding='utf-8') as f:
        json.dump({'fetched_at_utc8': fetched, 'price_cutoff': last, 'report_period': '2026-09-30',
                   'second_source_mismatches': mismatches, 'records': records}, f, ensure_ascii=False, indent=1)
    print(f'\n已保存 {os.path.relpath(path)}')
