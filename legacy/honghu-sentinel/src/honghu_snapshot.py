#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
鸿鹄 V2 · 每日收盘快照自动脚本
触发：launchd 周一至周五 15:35
数据源：东方财富公开接口（行情K线 + 主力资金流，无需Key）
输出：
  1. 每只股票档案 YAML 更新（price/pnl_pct相关/trend/capital_5d_yi/last_updated）
  2. 40_信号看板/YYYY-MM/YYYY-MM-DD_信号快照.md
  3. 80_Agent_Feed/YYYY-MM-DD_snapshot_agent.json + latest.json 符号链接
  4. 00_首页.md 资金流对照区块整块替换（<!-- CAPITAL:BEGIN/END --> 标记）
  5. 00_Inbox/警报_日期.md（门控触发时）
  6. 98_自动化/logs/日期.log
兼容 Python 3.9，仅用标准库。
"""

import argparse
import datetime as dt
import json
import os
import re
import subprocess
import sys
import time
import traceback
import urllib.request
import urllib.parse
from pathlib import Path

VAULT_DEFAULT = os.environ.get("HONGHU_VAULT", "/Users/muscap/鸿鹄研究库")
STOCK_DIRS = ["20_候选池/AI硬件第一幕", "20_候选池/AI软件第二幕"]
SIGNAL_ROOT = "40_信号看板"
DECISION_ROOT = "50_决策日志"
AGENT_FEED = "80_Agent_Feed"
SHARE_DIR = "99_每日数据包"   # 可分享标准数据包（JSON+MD，供外部AI分析）
RAW_ROOT = "97_原始数据"      # Raw Data 分层归档（永不覆盖）
INBOX_DIR = "00_Inbox"
HOME_FILE = "00_首页.md"
LOG_ROOT = "98_自动化/logs"
CAP_BEGIN = "<!-- CAPITAL:BEGIN -->"
CAP_END = "<!-- CAPITAL:END -->"
HOME_DASHBOARD_BEGIN = "<!-- HOME_DASHBOARD_BEGIN -->"
HOME_DASHBOARD_END = "<!-- HOME_DASHBOARD_END -->"

UA = {
    "User-Agent": ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                   "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"),
    "Accept": "*/*",
    "Accept-Language": "zh-CN,zh;q=0.9",
    "Referer": "https://quote.eastmoney.com/",
}

# 东方财富主机镜像轮换（应对限流；镜像同后端，仅作轻缓解）
EM_QUOTE_HOSTS = ["push2.eastmoney.com", "1.push2.eastmoney.com",
                  "90.push2.eastmoney.com", "29.push2.eastmoney.com"]
EM_FFLOW_HOSTS = ["push2his.eastmoney.com", "1.push2his.eastmoney.com",
                  "90.push2his.eastmoney.com", "29.push2his.eastmoney.com"]

LOG_FILE = None
NAMES_TO_ARCHIVE = {}


# ---------- 工具 ----------

def log(msg):
    ts = dt.datetime.now().strftime("%H:%M:%S")
    line = "[%s] %s" % (ts, msg)
    print(line, flush=True)
    if LOG_FILE:
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(line + "\n")


def ensure_dir(p):
    p.mkdir(parents=True, exist_ok=True)


def http_get_json(url, timeout=12):
    for attempt in (1, 2):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read().decode("utf-8", "ignore"))
        except Exception as e:
            if attempt == 2:
                log("  HTTP失败 %s : %s" % (url[:80], e))
                return None
            time.sleep(2.0)
    return None


def em_get_json(path):
    """东财接口：主机镜像轮换（应对限流）"""
    hosts = EM_QUOTE_HOSTS if "ulist" in path else EM_FFLOW_HOSTS
    for i, host in enumerate(hosts):
        j = http_get_json("https://%s%s" % (host, path), timeout=8)
        if j is not None:
            return j
        if i < len(hosts) - 1:
            time.sleep(2.0)
    return None


def parse_front_matter(md_path):
    try:
        text = md_path.read_text(encoding="utf-8")
    except Exception:
        return {}
    if not text.startswith("---\n"):
        return {}
    end = text.find("\n---", 4)
    if end < 0:
        return {}
    d = {}
    for line in text[4:end].splitlines():
        s = line.strip()
        if not s or s.startswith("#") or ":" not in s:
            continue
        k, v = s.split(":", 1)
        k, v = k.strip(), v.strip().strip('"')
        # code 字段永远保留为字符串（防止 300308 被解析为整数，导致 key 类型不一致）
        if k == "code":
            d[k] = v
            continue
        # 保护股票代码前导零：002371 必须保留为字符串
        if v and len(v) > 1 and v[0] == "0" and v.replace(".", "").isdigit():
            d[k] = v
            continue
        try:
            v = int(v)
        except ValueError:
            try:
                v = float(v)
            except ValueError:
                pass
        d[k] = v
    return d


def update_front_matter(md_path, kv_updates):
    text = md_path.read_text(encoding="utf-8")
    if not text.startswith("---\n"):
        return
    end = text.find("\n---", 4)
    fm, body = text[4:end], text[end:]
    lines = fm.splitlines()
    key_idx = {}
    for i, line in enumerate(lines):
        s = line.strip()
        if ":" in s and not s.startswith("#"):
            key_idx[s.split(":", 1)[0].strip()] = i
    for k, v in kv_updates.items():
        v_str = '"%s"' % v if isinstance(v, str) else str(v)
        if k in key_idx:
            lines[key_idx[k]] = "%s: %s" % (k, v_str)
        else:
            lines.append("%s: %s" % (k, v_str))
    md_path.write_text("---\n" + "\n".join(lines) + body, encoding="utf-8")


# ---------- 数据采集（东方财富公开接口） ----------

def secid_of(code):
    """A股/港股代码 → 东方财富 secid"""
    c = str(code).strip().upper()
    if c.endswith(".HK") or c.endswith("HK"):
        n = c.replace(".HK", "").replace("HK", "").zfill(5)
        return "116." + n
    if c.startswith(("688", "60")):
        return "1." + c
    return "0." + c  # 000/001/002/003/300/301


def ma(vals, n):
    return sum(vals[-n:]) / n if len(vals) >= n else None


def tx_symbol(secid):
    """东方财富secid → 腾讯K线symbol"""
    mkt, code = secid.split(".", 1)
    if mkt == "116":
        return "hk" + code
    return ("sh" if mkt == "1" else "sz") + code


def fetch_kline(secid, n=30):
    """腾讯日K（稳定，A股+港股）→ {rows: [{date,close,amount,pct}]}"""
    sym = tx_symbol(secid)
    api = "hkfqkline" if sym.startswith("hk") else "fqkline"
    url = ("https://web.ifzq.gtimg.cn/appstock/app/%s/get?param=%s,day,,,%d,qfq"
           % (api, sym, n))
    j = http_get_json(url)
    if not j or j.get("code") != 0 or not j.get("data"):
        return None
    node = j["data"].get(sym) or {}
    raw = node.get("qfqday") or node.get("day") or []
    if not raw:
        return None
    rows, prev_close = [], None
    for r in raw:
        try:
            op, close, high, low, vol = float(r[1]), float(r[2]), float(r[3]), float(r[4]), float(r[5])
        except (ValueError, IndexError):
            continue
        pct = ((close / prev_close - 1) * 100) if prev_close else 0.0
        rows.append({"date": r[0], "open": op, "close": close, "high": high, "low": low,
                     "volume": vol, "amount": vol, "pct": round(pct, 2)})
        prev_close = close
    # 取成交额（万元）：qt[37]
    amount_wan = None
    qt = node.get("qt", {})
    if isinstance(qt, dict) and qt.get(sym):
        info = qt[sym]
        if len(info) > 37:
            try:
                amount_wan = float(info[37])
            except (ValueError, TypeError):
                pass
    return {"name": node.get("qt", {}).get(sym, ["", ""])[1] if isinstance(node.get("qt"), dict) else "",
            "rows": rows, "amount_wan": amount_wan}


def fetch_fflow(secid):
    """主力资金流历史（元）→ {d1: 今日净流入亿, d5: 5日合计亿}"""
    url = ("https://push2his.eastmoney.com/api/qt/stock/fflow/daykline/get?lmt=10&klt=101"
           "&secid=%s&fields1=f1,f2,f3,f7&fields2=f51,f52" % secid)
    j = http_get_json(url)
    if not j or not j.get("data") or not j["data"].get("klines"):
        return None
    vals = []
    for line in j["data"]["klines"]:
        p = line.split(",")
        try:
            vals.append(float(p[1]) / 1e8)  # 元 → 亿
        except (ValueError, IndexError):
            continue
    if not vals:
        return None
    return {"d1": vals[-1], "d5": sum(vals[-5:])}


# V1.0 Money Radar: 融资融券余额采集（datacenter-web，不被TLS封锁）
RZRQ_API = "https://datacenter-web.eastmoney.com/api/data/v1/get"


def fetch_margin_balance(code=None, page_size=500):
    """融资融券余额（T+1披露，datacenter-web，不被TLS封锁）

    code 为 None → 拉全市场；传入 '300308' → 单只过滤。
    返回字段单位均为元。
    单只模式返回单个 dict；全市场模式返回 list。
    实测：9/23调用可拿到9/22数据（T-1日），与交易所T+1披露规则一致。

    字段映射（实测2026-09-23）:
      DATE:        交易日期（如 "2026-09-22 00:00:00"）
      SCODE:       6位代码
      SECNAME:     证券名称
      SECUCODE:    带后缀代码
      RZYE:        融资余额
      RZMRE:       融资买入额（当日）
      RZCHE:       融资偿还额（当日）
      RZJME:       融资净买入（= RZMRE - RZCHE，API直接给出）
      RZMRE3D/5D/10D: 融资买入3/5/10日累计
      RZJME3D/5D/10D: 融资净买入3/5/10日累计
      RQYE:        融券余额
      RQYL:        融券余量
      RZYEZB:      融资余额占比(%)
      ZDF:         当日涨跌幅(%)
    """
    params = {
        "reportName": "RPTA_WEB_RZRQ_GGMX",
        "columns": "ALL",
        "pageNumber": "1",
        "pageSize": str(page_size),
        "sortColumns": "DATE",
        "sortTypes": "-1",
    }
    if code:
        # 东财SCODE不带后缀直接filter，已实测可用
        params["filter"] = '(SCODE="%s")' % str(code).strip()

    query = urllib.parse.urlencode(params)
    j = http_get_json("%s?%s" % (RZRQ_API, query), timeout=15)
    if not j or not j.get("success") or not j.get("result"):
        log("  ⚠️ 融资融券API失败: %s" % str(j.get("message") if j else "no response"))
        return None

    rows = j["result"].get("data") or []
    if not rows:
        return None

    def num(x):
        if x is None:
            return None
        if isinstance(x, (int, float)):
            return float(x)
        s = str(x).replace(",", "").strip()
        try:
            return float(s)
        except ValueError:
            return None

    parsed = []
    for r in rows:
        parsed.append({
            "scode": str(r.get("SCODE", "")),
            "sname": str(r.get("SECNAME", "")),
            "secucode": str(r.get("SECUCODE", "")),
            "trade_date": str(r.get("DATE", ""))[:10] if r.get("DATE") else "",
            "rzye": num(r.get("RZYE")),            # 融资余额
            "rzmre": num(r.get("RZMRE")),          # 融资买入额
            "rzche": num(r.get("RZCHE")),          # 融资偿还额
            "rzjme": num(r.get("RZJME")),          # 融资净买入（API直接给出）
            "rzmre_3d": num(r.get("RZMRE3D")),     # 3日累计融资买入
            "rzmre_5d": num(r.get("RZMRE5D")),
            "rzmre_10d": num(r.get("RZMRE10D")),
            "rzjme_3d": num(r.get("RZJME3D")),     # 3日累计融资净买入
            "rzjme_5d": num(r.get("RZJME5D")),
            "rzjme_10d": num(r.get("RZJME10D")),
            "rqye": num(r.get("RQYE")),            # 融券余额
            "rqyl": num(r.get("RQYL")),            # 融券余量
            "rzyezb": num(r.get("RZYEZB")),        # 融资余额占比(%)
            "zdf": num(r.get("ZDF")),              # 当日涨跌幅(%)
            "snapshot_at": dt.date.today().isoformat(),
            "source": "eastmoney_datacenter_rzrq",
        })

    if code:
        # 单只模式：只返回最新一条
        return parsed[0] if parsed else None
    # 全市场模式：需要去重（每只股票只保留最新一条）
    seen = set()
    unique = []
    for p in parsed:
        if p["scode"] not in seen:
            seen.add(p["scode"])
            unique.append(p)
    return unique


def fetch_industry_turnover(market="90+t:1"):
    """行业板块成交额（push2 m:90+t:1=行业 / t:2=概念）

    返回: list[{industry_code, industry_name, turnover_yuan, capital_flow_yuan, ...}]
    push2间歇TLS封锁，host镜像轮换重试3次，仍失败返回None。
    实测：9/23调用push2.eastmoney.com可用，拿到50+板块含f6+f62。
    """
    path = "/api/qt/clist/get?pn=1&pz=200&fs=m:%s&fields=f12,f14,f6,f62" % market
    j = None
    for host in EM_QUOTE_HOSTS:  # 用 push2 主机集群（不是 push2his）
        j = http_get_json("https://%s%s" % (host, path), timeout=8)
        if j and j.get("data") and j["data"].get("diff"):
            break
        time.sleep(2.0)

    if not j or not j.get("data") or not j["data"].get("diff"):
        log("  ⚠️ 行业板块成交额API失败 (market=%s)" % market)
        return None

    def num(x):
        return float(x) if isinstance(x, (int, float)) else None

    # 东财diff有两种形态：list[dict] 或 dict{"0":dict,...}（大结果集时）
    diff = j["data"]["diff"]
    if isinstance(diff, dict):
        rows = list(diff.values())
    elif isinstance(diff, list):
        rows = diff
    else:
        log("  ⚠️ 行业板块diff结构未知: %s" % type(diff).__name__)
        return None

    out = []
    for d in rows:
        if not isinstance(d, dict):
            continue  # 防御脏数据，绝不允许拖垮快照
        out.append({
            "industry_code": str(d.get("f12", "")),
            "industry_name": str(d.get("f14", "")),
            "turnover_yuan": num(d.get("f6")),
            "capital_flow_yuan": num(d.get("f62")),  # 仅参考
            "snapshot_at": dt.date.today().isoformat(),
            "source": "eastmoney_push2_m90",
        })
    return out if out else None


def trend_of(closes):
    m5, m10, m20 = ma(closes, 5), ma(closes, 10), ma(closes, 20)
    if not (m5 and m10 and m20):
        return "数据不足"
    if m5 > m10 > m20:
        return "多头排列"
    if m5 < m10 < m20:
        return "空头排列"
    return "均线纠缠"


def fetch_batch_quotes(codes):
    """批量行情（1请求）：{raw_code: {price, pct, capital_1d_yi, turnover_yuan, name_em}}

    V1.0新增f6（个股成交额，单位：元）作为真实资金数据源，与腾讯qt[37]互为冗余。
    """
    secids = ",".join(secid_of(c) for c in codes)
    path = ("/api/qt/ulist.np/get?fltt=2&secids=%s"
            "&fields=f2,f3,f6,f12,f14,f62" % secids)
    j = em_get_json(path)
    out = {}
    if not j or not j.get("data") or not j["data"].get("diff"):
        return out
    def num(x):
        return x if isinstance(x, (int, float)) else None
    for d in j["data"]["diff"]:
        cap1 = d.get("f62")
        turnover = d.get("f6")
        out[str(d.get("f12", ""))] = {
            "price": num(d.get("f2")),
            "pct_change_daily": num(d.get("f3")),
            "capital_1d_yi": round(cap1 / 1e8, 2) if isinstance(cap1, (int, float)) else None,
            "turnover_yuan": num(turnover),  # V1.0 Money Radar: 东财f6成交额(元)，真实数据
            "name_em": d.get("f14"),
        }
    return out


def fetch_market_diagnostics(codes):
    """批量拿行情+当日主力；逐只补5日资金流与趋势（失败不影响主数据）"""
    results = {}
    batch = fetch_batch_quotes(codes)
    log("批量行情：成功 %d/%d 只" % (len(batch), len(codes)))
    em_fail_streak = 0  # 东财连续失败熔断：≥3次后停止请求，避免加重限流
    for code in codes:
        secid = secid_of(code)
        raw = secid.split(".", 1)[1]
        b = batch.get(raw, {})
        turnover_yuan_em = b.get("turnover_yuan")
        c = {
            "name_em": b.get("name_em"),
            "price": b.get("price"),
            "pct_change_daily": b.get("pct_change_daily"),
            "capital_1d_yi": b.get("capital_1d_yi"),
            "capital_5d_yi": None,
            "trend": "待更新",
            "volume_ratio": None,
            "price_5d_pct": None,
            "price_10d_pct": None,
            "price_20d_pct": None,
            "amount_yi": None,
            # V1.0 Money Radar: 东财f6成交额(亿元) - 与腾讯qt[37]交叉校验
            "turnover_em_yi": round(turnover_yuan_em / 1e8, 2) if isinstance(turnover_yuan_em, (int, float)) else None,
            "snapshot_at": dt.date.today().isoformat(),
            "source": "eastmoney_batch",
        }
        # 逐只增强：5日主力 + 趋势（低频，失败可容忍）
        time.sleep(2.0)
        f = None
        if em_fail_streak < 3:
            f = fetch_fflow(secid)
            em_fail_streak = em_fail_streak + 1 if f is None else 0
            if em_fail_streak == 3:
                log("  ⚠️ 东财资金流连续失败，熔断跳过后续5日资金请求")
        if f:
            c["capital_5d_yi"] = round(f["d5"], 2)
        k = fetch_kline(secid)
        if k and k["rows"]:
            rows = k["rows"]
            closes = [r["close"] for r in rows]
            c["trend"] = trend_of(closes)
            prev_amounts = [r["amount"] for r in rows[-6:-1]]
            if prev_amounts and sum(prev_amounts) > 0 and rows[-1]["amount"]:
                c["volume_ratio"] = round(rows[-1]["amount"] / (sum(prev_amounts) / len(prev_amounts)), 2)
            if len(closes) >= 6:
                c["price_5d_pct"] = round((closes[-1] / closes[-6] - 1) * 100, 2)
            if len(closes) >= 11:
                c["price_10d_pct"] = round((closes[-1] / closes[-11] - 1) * 100, 2)
            if len(closes) >= 21:
                c["price_20d_pct"] = round((closes[-1] / closes[-21] - 1) * 100, 2)
            if k.get("amount_wan"):
                c["amount_yi"] = round(k["amount_wan"] / 10000, 2)
            # 东财行情失败时，用腾讯K线兜底价格/涨跌幅（收盘价与当日涨跌同源可信）
            if not c["price"]:
                c["price"] = rows[-1]["close"]
                c["pct_change_daily"] = rows[-1]["pct"]
                c["source"] = "tencent_kline"
        c1, c5 = c["capital_1d_yi"], c["capital_5d_yi"]
        amt_tx = c.get("amount_yi")
        amt_em = c.get("turnover_em_yi")
        # V1.0 Money Radar: 两个数据源成交额对比，差异>5%告警
        amt_flag = ""
        if isinstance(amt_tx, (int, float)) and isinstance(amt_em, (int, float)) and amt_tx > 0:
            diff_pct = abs(amt_tx - amt_em) / amt_tx * 100
            if diff_pct > 5:
                amt_flag = " ⚠️数据源差异%.1f%%" % diff_pct
        log("  ✓ %s %s | %s %s | 1d %s 5d %s | 成交额 东财%s/腾讯%s%s | %s" % (
            code, c["name_em"], c["price"],
            "%+.2f%%" % c["pct_change_daily"] if isinstance(c["pct_change_daily"], (int, float)) else "—",
            "%.2f亿" % c1 if isinstance(c1, (int, float)) else "—",
            "%.2f亿" % c5 if isinstance(c5, (int, float)) else "—",
            "%.2f亿" % amt_em if isinstance(amt_em, (int, float)) else "—",
            "%.2f亿" % amt_tx if isinstance(amt_tx, (int, float)) else "—",
            amt_flag,
            c["trend"]))
        results[str(code)] = c
    return results


# ---------- Signal 门控 ----------

# 第二曲线作战表：第一曲线基准6只 + PCB五人组
CURVE1_CODES = ["300308", "300502", "688041", "688008", "002371", "688012", "603986"]  # 中际/新易盛/海光/澜起/北方华创/中微/兆易
CURVE1_NAMES = {"300308": "中际旭创", "300502": "新易盛", "688041": "海光信息",
                "688008": "澜起科技", "002371": "北方华创", "688012": "中微公司",
                "603986": "兆易创新"}
PCB5_CODES = ["002463", "002916", "688183", "300476", "600183"]  # 沪电/深南/生益电子/胜宏/生益科技
PCB5_NAMES = {"002463": "沪电股份", "002916": "深南电路", "688183": "生益电子",
              "300476": "胜宏科技", "600183": "生益科技"}
OPT_CODES = ["300308", "300502"]  # 光模块双龙头

# ---------- 主线迁移雷达（左侧观察池）----------
# 三池一雷达：持仓池(8只·TPO) / 主线池(已验证产业地图) / 左侧雷达池(本表·只观察不下注)
# 关键：股票只是雷达的采样点；顺序必须是 产业→板块→环节→龙头→个股，不给个股打分
# earnings_level: 0=未兑现 1=部分兑现 2=兑现中；orders_level: 0=无 1=已公告/送样未进报表 2=批量订单进报表
RADAR_POOLS = [
    {"name": "AI软件/Agent", "priority": 1, "r_stage": 1.5,
     "stage": "第二幕·商业化早期·第一候选迁移方向",
     "fund_score": 55, "earnings_level": 1, "orders_level": 0,
     "earnings_note": "部分兑现（金山订阅/同花顺金融IT）", "orders_note": "无统一产业订单催化",
     "stocks": [
         ("688111", "金山办公", "中军/盈利验证器", "应用-办公"),
         ("300033", "同花顺", "弹性先锋", "应用-金融信息"),
         ("600570", "恒生电子", "中军", "应用-金融IT"),
         ("002230", "科大讯飞", "平台/模型", "平台")]},
    {"name": "具身智能/机器人", "priority": 2, "r_stage": 2.0,
     "stage": "R2送样/小批量·高优先级左侧（资本先于产业⚠️）",
     "fund_score": 25, "earnings_level": 0, "orders_level": 1,
     "earnings_note": "未进报表", "orders_note": "国网2026约8500台·Q3起采购（未交付）；宇树波动+IPO审核收紧=估值重估",
     "stocks": [
         ("300124", "汇川技术", "中军（伺服/控制）", "身体-控制伺服"),
         ("601689", "拓普集团", "执行器/丝杠", "身体-执行器"),
         ("002050", "三花智控", "执行器", "身体-执行器"),
         ("688017", "绿的谐波", "减速器龙头", "身体-减速器"),
         ("002747", "埃斯顿", "本体/伺服", "身体-本体")],
     "chain_gap": "采样点全部在身体层；大脑层（推理芯片/边缘计算/视觉感知）暂无采样点，需补哨兵"},
    {"name": "AI电力", "priority": 3, "r_stage": 2.0,
     "stage": "第一幕纵向延伸·电力瓶颈",
     "fund_score": 60, "earnings_level": 2, "orders_level": 2,
     "earnings_note": "兑现中（电网CapEx/数据中心供电）", "orders_note": "电网投资+数据中心供电订单持续",
     "stocks": [
         ("600406", "国电南瑞", "中军/电网自动化", "电网-自动化"),
         ("002028", "思源电气", "中军/一次设备", "电网-一次设备"),
         ("688676", "金盘科技", "数据中心供电", "电源-变压器"),
         ("002851", "麦格米特", "电源弹性", "电源")]},
    {"name": "AI推理", "priority": 4, "r_stage": 1.0,
     "stage": "R1·训练→推理 workload迁移带来利润再分配",
     "fund_score": 40, "earnings_level": 0, "orders_level": 1,
     "earnings_note": "未兑现", "orders_note": "d-Matrix接入NVLink Fusion等产业信号；推理ASIC放量待验证",
     "stocks": [
         ("688256", "寒武纪", "推理芯片", "大脑-芯片"),
         ("603019", "中科曙光", "服务器中军", "硬件-服务器"),
         ("688521", "芯原股份", "IP/设计服务", "大脑-芯片IP")]},
    {"name": "工业AI", "priority": 5, "r_stage": 1.5,
     "stage": "R1.5·AI进实体世界的核心连接层",
     "fund_score": 45, "earnings_level": 1, "orders_level": 1,
     "earnings_note": "部分兑现（工业软件/IDC存量业务）", "orders_note": "工业现场AI改造订单零散出现",
     "stocks": [
         ("688777", "中控技术", "控制中枢", "应用-工业控制"),
         ("002415", "海康威视", "机器视觉", "感知-视觉"),
         ("600845", "宝信软件", "工业软件/IDC", "应用-软件")]},
]
RADAR_CODES = [s[0] for p in RADAR_POOLS for s in p["stocks"]]  # 19只，数量由产业结构产生
RADAR_NAME = {s[0]: s[1] for p in RADAR_POOLS for s in p["stocks"]}
# 人工产业基线分（迁移距离的"产业/盈利"分量；周度由人更新，机器不臆测）
RADAR_FUND = {p["name"]: p["fund_score"] for p in RADAR_POOLS}
PCB_FUND_SCORE = 65   # PCB：已验证主线，盈利部分兑现
CURVE1_FUND_SCORE = 80  # AI硬件：当前主线，盈利已兑现


def compute_second_curve(curr):
    """计算第二曲线18项作战表数据。curr={code:{price_5d_pct,price_10d_pct,amount_yi,...}}"""
    # 对缺失10D数据的票（PCB五人组未建档 + 第一曲线兜底）临时抓K线
    extra = {}
    need = list(PCB5_CODES) + [c for c in CURVE1_CODES if c not in curr or not curr[c].get("price_10d_pct")]
    for code in need:
        if code in curr and curr[code].get("price_10d_pct") and code in PCB5_CODES and curr[code].get("amount_yi"):
            continue
        if code not in curr or not curr[code].get("price_10d_pct"):
            k = fetch_kline(secid_of(code))
            if k and k["rows"]:
                closes = [r["close"] for r in k["rows"]]
                p5 = round((closes[-1]/closes[-6]-1)*100, 2) if len(closes) >= 6 else None
                p10 = round((closes[-1]/closes[-11]-1)*100, 2) if len(closes) >= 11 else None
                p20 = round((closes[-1]/closes[-21]-1)*100, 2) if len(closes) >= 21 else None
                amt = round(k["amount_wan"]/10000, 2) if k.get("amount_wan") else None
                extra[code] = {"price_5d_pct": p5, "price_10d_pct": p10,
                               "price_20d_pct": p20, "amount_yi": amt}
    merged = {**curr, **extra}
    # 回写curr：PCB5的K线衍生字段供雷达/归档/数据包共享（底层统一采集）
    curr.update(extra)

    # 基准：第一曲线6只等权
    base5 = [merged[k]["price_5d_pct"] for k in CURVE1_CODES if k in merged and merged[k].get("price_5d_pct") is not None]
    base10 = [merged[k]["price_10d_pct"] for k in CURVE1_CODES if k in merged and merged[k].get("price_10d_pct") is not None]
    base_5d = sum(base5)/len(base5) if base5 else 0
    base_10d = sum(base10)/len(base10) if base10 else 0

    def rs(code, n, base):
        v = merged.get(code, {}).get("price_%dd_pct" % n)
        return round(v - base, 2) if v is not None else None

    card = {"date": dt.date.today().isoformat(), "base_5d": round(base_5d, 2), "base_10d": round(base_10d, 2)}
    # 第一曲线RS
    for code in CURVE1_CODES:
        card["rs5_%s" % code] = rs(code, 5, base_5d)
        card["rs10_%s" % code] = rs(code, 10, base_10d)
    # PCB五人组RS
    for code in PCB5_CODES:
        card["rs5_%s" % code] = rs(code, 5, base_5d)
        card["rs10_%s" % code] = rs(code, 10, base_10d)
    # 成交额
    def amt(code):
        return merged.get(code, {}).get("amount_yi")
    c1_amt = sum(amt(k) for k in CURVE1_CODES if amt(k))
    pcb_amt = sum(amt(k) for k in PCB5_CODES if amt(k))
    opt_rs10 = [rs(k, 10, base_10d) for k in OPT_CODES if rs(k, 10, base_10d) is not None]
    pcb_rs10 = [rs(k, 10, base_10d) for k in PCB5_CODES if rs(k, 10, base_10d) is not None]
    opt_rs5 = [rs(k, 5, base_5d) for k in OPT_CODES if rs(k, 5, base_5d) is not None]
    pcb_rs5 = [rs(k, 5, base_5d) for k in PCB5_CODES if rs(k, 5, base_5d) is not None]
    card["curve1_amount_yi"] = round(c1_amt, 2) if c1_amt else None
    card["pcb_amount_yi"] = round(pcb_amt, 2) if pcb_amt else None
    card["pcb_curve1_amount_ratio"] = round(pcb_amt/c1_amt, 3) if c1_amt else None
    card["opt_rs10_avg"] = round(sum(opt_rs10)/len(opt_rs10), 2) if opt_rs10 else None
    card["pcb_rs10_avg"] = round(sum(pcb_rs10)/len(pcb_rs10), 2) if pcb_rs10 else None
    card["pcb_opt_rs10_diff"] = round((sum(pcb_rs10)/len(pcb_rs10)) - (sum(opt_rs10)/len(opt_rs10)), 2) if opt_rs10 and pcb_rs10 else None
    card["opt_rs5_avg"] = round(sum(opt_rs5)/len(opt_rs5), 2) if opt_rs5 else None
    card["pcb_rs5_avg"] = round(sum(pcb_rs5)/len(pcb_rs5), 2) if pcb_rs5 else None
    # Gate2五指标判定（V1.0用100%硬规则；5日后回测是否放宽至80%广度）
    pcb_rs5_vals = [rs(k, 5, base_5d) for k in PCB5_CODES if rs(k, 5, base_5d) is not None]
    pcb_rs10_vals = [rs(k, 10, base_10d) for k in PCB5_CODES if rs(k, 10, base_10d) is not None]
    g2_1 = all(v > 0 for v in pcb_rs5_vals) if pcb_rs5_vals else False
    g2_2 = all(v > 0 for v in pcb_rs10_vals) if pcb_rs10_vals else False
    # 龙头扩散：沪电+深南+生益电子中10DRS>0的数量
    leaders = ["002463", "002916", "688183"]
    g2_4 = sum(1 for k in leaders if (rs(k, 10, base_10d) or 0) > 0) >= 2
    card["gate2"] = {"5d_rs_all_pos": g2_1, "10d_rs_all_pos": g2_2,
                     "5d_rs_breadth": "%d/%d" % (sum(1 for v in pcb_rs5_vals if v > 0), len(pcb_rs5_vals)),
                     "10d_rs_breadth": "%d/%d" % (sum(1 for v in pcb_rs10_vals if v > 0), len(pcb_rs10_vals)),
                     "amount_ratio_trend": "待连续5日", "leader_diffusion_ge2": g2_4,
                     "quality": "待人工"}
    return card


# ---------- 主线迁移雷达（左侧观察池）----------

def fetch_radar_high60():
    """距60日高点（%），0=创新高，≥-3视为'龙头新高附近'。
    覆盖：第一曲线（锚）+ PCB5（第二曲线）+ 雷达19只（采样点）。"""
    out = {}
    for c in dict.fromkeys(CURVE1_CODES + PCB5_CODES + RADAR_CODES):
        try:
            k = fetch_kline(secid_of(c), n=60)
        except Exception:
            k = None
        if k and len(k["rows"]) >= 20:
            closes = [r["close"] for r in k["rows"]]
            out[c] = round((closes[-1] / max(closes) - 1) * 100, 1)
    return out


def _clamp(v, lo=0, hi=100):
    return max(lo, min(hi, v))


def _pct_to_score(p):
    """绝对涨跌%→0-100：0%→50，+10%→90，-10%→10"""
    return None if p is None else _clamp(50 + p * 4)


def _rs_to_score(rs):
    return None if rs is None else _clamp(50 + rs * 4)


def _weighted(parts):
    """加权合成；None分量自动重分配权重（数据缺失不臆造中性值）"""
    avail = [(s, w) for s, w in parts if s is not None]
    if not avail:
        return None
    tw = sum(w for _, w in avail)
    return round(sum(s * w for s, w in avail) / tw, 1)


def _group_metrics(codes, curr, b5, b20, c1_amt, high60, rs_relative=True):
    """一组采样点的产业层指标（不是个股打分）。rs_relative=False时RS分量用绝对涨跌（给锚用）。"""
    v5 = [curr[c]["price_5d_pct"] for c in codes if curr.get(c, {}).get("price_5d_pct") is not None]
    v20 = [curr[c]["price_20d_pct"] for c in codes if curr.get(c, {}).get("price_20d_pct") is not None]
    avg5 = sum(v5) / len(v5) if v5 else None
    avg20 = sum(v20) / len(v20) if v20 else None
    rs5 = round(avg5 - b5, 2) if (avg5 is not None and b5 is not None) else None
    rs20 = round(avg20 - b20, 2) if (avg20 is not None and b20 is not None) else None
    caps = [curr[c].get("capital_1d_yi") for c in codes
            if isinstance(curr.get(c, {}).get("capital_1d_yi"), (int, float))]
    cap_sum = round(sum(caps), 2) if caps else None
    cap_breadth = (sum(1 for v in caps if v > 0) / len(caps)) if caps else None
    amt = sum(curr[c].get("amount_yi") or 0 for c in codes if curr.get(c))
    amt_ratio = round(amt / c1_amt, 3) if c1_amt else None
    sync20 = (sum(1 for v in v20 if v > 0) / len(v20)) if v20 else None   # 中军同步率
    diff5 = (sum(1 for v in v5 if v > 0) / len(v5)) if v5 else None      # 板块扩散率
    nh = [c for c in codes if c in high60 and high60[c] >= -3]
    nh_frac = len(nh) / len(codes) if codes else None                     # 龙头新高率
    return {"avg5": round(avg5, 2) if avg5 is not None else None,
            "avg20": round(avg20, 2) if avg20 is not None else None,
            "rs5": rs5, "rs20": rs20,
            "capital_1d_yi": cap_sum, "capital_breadth": round(cap_breadth, 2) if cap_breadth is not None else None,
            "amount_yi": round(amt, 2) if amt else None, "amount_ratio": amt_ratio,
            "sync20": round(sync20, 2) if sync20 is not None else None,
            "diffuse5": round(diff5, 2) if diff5 is not None else None,
            "near_high": "%d/%d" % (len(nh), len(codes)),
            "near_high_frac": round(nh_frac, 2) if nh_frac is not None else None}


def _state_from_rs(rs20, rs5):
    """状态机：过热/强化/成形/观察/衰退"""
    if rs20 is None:
        return "⏳", "观察"
    if rs20 > 15 and (rs5 or -9) > 5:
        return "🔥", "过热"
    if rs20 > 0 and (rs5 or -9) > 0:
        return "🟢", "强化"
    if rs20 > 0:
        return "🟡", "成形"
    if rs20 > -5:
        return "⚪", "观察"
    return "🔴", "衰退"


def _distance_parts(m, fund_score, is_anchor=False):
    """迁移距离分量（0-100）：RS35% + 资金20% + 成交定价权15% + 广度15% + 产业/盈利15%（人工基线）"""
    rs_blend = None
    if m["rs20"] is not None:
        rs_blend = 0.6 * m["rs20"] + 0.4 * (m["rs5"] if m["rs5"] is not None else m["rs20"])
    rs_score = _pct_to_score(rs_blend) if is_anchor else _rs_to_score(rs_blend)
    money = None
    if m.get("capital_breadth") is not None:
        adj = 10 if (m["capital_1d_yi"] or 0) > 0 else (-10 if (m["capital_1d_yi"] or 0) < 0 else 0)
        money = _clamp(30 + m["capital_breadth"] * 60 + adj)
    pricing = 80 if is_anchor else (_clamp(30 + m["amount_ratio"] * 90) if m.get("amount_ratio") is not None else None)
    breadth = None
    if m.get("sync20") is not None and m.get("near_high_frac") is not None:
        breadth = round((m["sync20"] * 0.6 + m["near_high_frac"] * 0.4) * 100, 1)
    dist = _weighted([(rs_score, .35), (money, .20), (pricing, .15), (breadth, .15), (fund_score, .15)])
    return {"distance": dist, "rs": rs_score, "money": money, "pricing": pricing,
            "breadth": breadth, "fundamental": fund_score}


def _r_lights(pool):
    """产业进度四灯：产业(R阶段) / 资金(运行时填) / RS(运行时填) / 盈利(人工基线)"""
    rs_stage = pool["r_stage"]
    ind = "🟢" if rs_stage >= 3 else ("🟡" if rs_stage >= 1.5 else "⚪")
    earn = {0: "🔴", 1: "🟡", 2: "🟢"}[pool["earnings_level"]]
    order = {0: "⚪", 1: "🟡", 2: "🟢"}[pool["orders_level"]]
    return ind, earn, order


def compute_migration_radar(curr, high60=None):
    """主线迁移雷达引擎。
    回答：钱、强度、产业、盈利正在从哪里往哪里迁？（产业层，不是个股打分层）
    输出：旧主线(AI硬件锚) + PCB + 5条雷达方向的 状态/迁移距离/产业四灯/双向迁移裁决。"""
    high60 = high60 or {}
    bm = _group_metrics(CURVE1_CODES, curr, 0, 0, None, high60)
    b5, b20 = bm["avg5"], bm["avg20"]
    c1_amt = bm["amount_yi"]

    # 条件A：旧主线衰退（必须中周期+短周期/资金同向走弱才算，单日反抽不算）
    old_evidence = []
    if b20 is not None and b20 < 0:
        old_evidence.append("20D %+.2f%%" % b20)
    if b5 is not None and b5 < 0:
        old_evidence.append("5D %+.2f%%" % b5)
    if isinstance(bm["capital_1d_yi"], (int, float)) and bm["capital_1d_yi"] < 0:
        old_evidence.append("主力净流出%.1f亿" % bm["capital_1d_yi"])
    opt5 = [curr[c].get("price_5d_pct") for c in OPT_CODES
            if curr.get(c, {}).get("price_5d_pct") is not None]
    opt_avg5 = sum(opt5) / len(opt5) - b5 if opt5 and b5 is not None else None
    if opt_avg5 is not None and opt_avg5 < 0:
        old_evidence.append("光模块RS5 %+.2f 转弱" % opt_avg5)
    old_weak = bool((b20 is not None and b20 < 0)
                    and (((b5 is not None and b5 < 0))
                         or (isinstance(bm["capital_1d_yi"], (int, float)) and bm["capital_1d_yi"] < 0)))
    anchor_parts = _distance_parts(bm, CURVE1_FUND_SCORE, is_anchor=True)

    # PCB（第二曲线，已验证，无R阶段灯）
    pcb_m = _group_metrics(PCB5_CODES, curr, b5, b20, c1_amt, high60)
    pcb_icon, pcb_state = _state_from_rs(pcb_m["rs20"], pcb_m["rs5"])
    pcb_parts = _distance_parts(pcb_m, PCB_FUND_SCORE)

    pools, entities = [], []
    entities.append({"key": "curve1", "name": "AI硬件（旧主线·锚）", "kind": "anchor",
                     "state": "在位", "icon": "🔵", **bm, **anchor_parts})
    entities.append({"key": "pcb", "name": "PCB（第二曲线）", "kind": "second",
                     "state": pcb_state, "icon": pcb_icon, **pcb_m, **pcb_parts})

    for p in RADAR_POOLS:
        codes = [s[0] for s in p["stocks"]]
        m = _group_metrics(codes, curr, b5, b20, c1_amt, high60)
        icon, state = _state_from_rs(m["rs20"], m["rs5"])
        parts = _distance_parts(m, p["fund_score"])
        ind_l, earn_l, order_l = _r_lights(p)
        # 运行时灯
        cap = m["capital_1d_yi"]
        money_l = ("⚪" if cap is None else
                   ("🟢" if cap > 0 and (m["capital_breadth"] or 0) >= 0.5 else
                    ("🟡" if cap > 0 else "🔴")))
        rs_l = ("🟢" if (m["rs20"] or -9) > 0 and (m["rs5"] or -9) > 0 else
                ("🟡" if (m["rs20"] or -9) > 0 else ("⚪" if (m["rs20"] or -9) > -5 else "🔴")))
        new_strong = bool(state == "强化" and isinstance(cap, (int, float)) and cap > 0)
        # 双向裁决：A旧弱 + B新强 同时成立
        if new_strong and old_weak:
            verdict, candidate, solo = "🟡迁移候选（旧弱+新强同时成立）·进入Gate确认", True, False
        elif new_strong:
            verdict, candidate, solo = "新主线独立走强·旧主线未衰退→不提前迁仓", False, True
        elif state == "强化":
            verdict, candidate, solo = "RS强化但资金未确认", False, False
        else:
            verdict, candidate, solo = "迁移证据不足（%s）" % state, False, False
        # 主线资格：必须R≥3 + 盈利至少部分兑现 + 当前强化；R2送样/小批量不算
        qualified = bool(p["r_stage"] >= 3 and p["earnings_level"] >= 1 and state == "强化")
        stocks = [{"code": c, "name": nm, "role": role, "chain": ch,
                   "price": curr.get(c, {}).get("price"),
                   "pct_1d": curr.get(c, {}).get("pct_change_daily"),
                   "pct_5d": curr.get(c, {}).get("price_5d_pct"),
                   "pct_20d": curr.get(c, {}).get("price_20d_pct"),
                   "capital_1d_yi": curr.get(c, {}).get("capital_1d_yi"),
                   "off_60d_high": high60.get(c)}
                  for c, nm, role, ch in p["stocks"]]
        rec = {"name": p["name"], "priority": p["priority"], "r_stage": p["r_stage"],
               "stage": p["stage"], "icon": icon, "state": state,
               "ind_light": ind_l, "money_light": money_l, "rs_light": rs_l,
               "earn_light": earn_l, "order_light": order_l,
               "earnings_note": p["earnings_note"], "orders_note": p["orders_note"],
               "chain_gap": p.get("chain_gap"),
               "qualified": qualified, "verdict": verdict,
               "migration_candidate": candidate, "solo_strong": solo,
               "stocks": stocks, **m, **parts}
        pools.append(rec)
        entities.append({"key": "radar_%d" % p["priority"], "name": p["name"],
                         "kind": "radar", "icon": icon, "state": state, **m, **parts})

    # 迁移距离自动叙述
    anchor_d = anchor_parts["distance"]
    new_sorted = sorted([e for e in entities if e["kind"] != "anchor"],
                        key=lambda e: e["distance"] or -1, reverse=True)
    top = new_sorted[0] if new_sorted else None
    if top and anchor_d is not None and top["distance"] is not None:
        gap = round(top["distance"] - anchor_d, 1)
        if gap > 10:
            narrative = "赚钱位置已出现向【%s】迁移的距离证据（领先%.1f），仍需资金+订单确认" % (top["name"], gap)
        elif gap > -10:
            narrative = "赚钱位置仍以AI硬件为主，【%s】最接近（差%+.1f），属扩散不是迁移" % (top["name"], gap)
        else:
            narrative = "赚钱位置仍集中在AI硬件；最近的新方向【%s】落后%.1f，迁移距离不足" % (top["name"], abs(gap))
    else:
        narrative = "迁移距离数据不足"

    return {"date": dt.date.today().isoformat(),
            "base_5d": b5, "base_20d": b20,
            "old_line": {"weak": old_weak, "evidence": old_evidence,
                         "distance": anchor_d,
                         "verdict": "🔴 旧主线衰退条件A成立" if old_weak else "🟢 旧主线未衰退（条件A不成立）"},
            "narrative": narrative,
            "entities": entities, "pools": pools,
            "rule": ("顺序：产业→板块→环节→龙头→个股。20D RS差为主轴（迁移按月计），5D看资金试温。"
                     "双向裁决：旧主线衰退(RS↓+资金↓) 与 新主线强化(RS↑+资金↑+龙头↑+中军↑) 同时成立才判迁移候选；"
                     "再经订单/业绩+Gate1/2/3 才释放 Capital Permission。")}


def write_migration_radar_md(vault, date_str, radar):
    """输出主线迁移雷达到 40_信号看板/YYYY-MM/。
    表A 产业状态（10指标→状态，不给买入）→ 迁移距离 → 双向裁决 → 表B 环节拆解。"""
    ym = date_str[:7]
    d = vault / SIGNAL_ROOT / ym
    ensure_dir(d)
    f = d / ("%s_主线迁移雷达.md" % date_str)

    def bar(v):
        if v is None:
            return "—"
        n = int(round(v / 10))
        return "▓" * n + "░" * (10 - n)

    def fnum(v, suf="", signed=False):
        if not isinstance(v, (int, float)):
            return "—"
        return ("%+.2f" % v if signed else "%.2f" % v) + suf

    L = [
        "---",
        "type: \"migration-radar\"",
        "date: \"%s\"" % date_str,
        "related: \"[[第二曲线迁移决策系统]]\"",
        "---",
        "",
        "# 🛰️ 主线迁移雷达 · %s" % date_str,
        "",
        "> **回答的问题**：钱、强度、产业、盈利，正在从哪里往哪里迁移？",
        "> 三池一雷达：持仓池（8只·TPO）｜主线池（已验证产业地图）｜左侧雷达池（只观察不下注）",
        "> 股票只是采样点；顺序必须是 **产业→板块→环节→龙头→个股**，本表不给个股打分。",
        "> 基准（第一曲线7只等权）：5D **%s%%** / 20D **%s%%**" % (fnum(radar.get("base_5d")), fnum(radar.get("base_20d"))),
        "",
        "## ① 迁移距离 · 赚钱位置正在往哪走？",
        "",
        "> **%s**" % radar.get("narrative", ""),
        "",
        "| 方向 | 距离 | RS | 资金 | 成交 | 广度 | 产业 | 状态 |",
        "|------|------|-----|------|------|------|------|------|",
    ]
    for e in radar["entities"]:
        L.append("| %s %s | **%s** %s | %s | %s | %s | %s | %s | %s %s |" % (
            e["icon"], e["name"],
            ("%g" % e["distance"]) if e["distance"] is not None else "—", bar(e["distance"]),
            fnum(e.get("rs")), fnum(e.get("money")), fnum(e.get("pricing")),
            fnum(e.get("breadth")), fnum(e.get("fundamental")),
            e["icon"], e["state"]))
    L += ["",
          "> 距离=机器初算的0-100复合分（RS35/资金20/成交15/广度15/产业15）；**产业分量是人工周度基线，不是机器臆测**；"
          "资金列盘后可能缺失，缺失分量自动降权（不拿中性值充数）。",
          "",
          "## ② 双向迁移裁决",
          "",
          "| 条件 | 判定 |",
          "|------|------|",
          "| A 旧主线衰退（RS↓+资金↓） | %s（证据：%s） |" % (
              radar["old_line"]["verdict"], " · ".join(radar["old_line"]["evidence"]) or "无"),
          "| B 新主线强化（RS↑+资金↑+龙头↑+中军↑） | 分方向见下表 |",
          "",
          "**铁律：A与B同时成立才出现「迁移候选」；新主线独立走强而旧主线未衰退 → 不提前迁仓。**",
          "",
          "| 方向 | 状态 | 资金 | RS20差 | RS5差 | 裁决 |",
          "|------|------|------|--------|-------|------|",
    ]
    for p in radar["pools"]:
        L.append("| %s | %s %s | %s | %s | %s | %s |" % (
            p["name"], p["icon"], p["state"],
            ("%.1f亿" % p["capital_1d_yi"]) if isinstance(p["capital_1d_yi"], (int, float)) else "⚪缺失",
            fnum(p["rs20"], signed=True), fnum(p["rs5"], signed=True), p["verdict"]))

    # 表A：产业状态10指标
    L += ["",
          "## ③ 表A · 产业状态（10指标 → 状态，不是买入）",
          "",
          "| 方向 | RS5差 | RS20差 | 当日主力 | 成交额比 | 龙头新高率 | 中军同步(20D) | 扩散率(5D) | 盈利验证 | 订单验证 | 状态 |",
          "|------|-------|--------|---------|---------|-----------|--------------|-----------|---------|---------|------|"]
    for e in radar["entities"]:
        if e["kind"] == "radar":
            p = next(x for x in radar["pools"] if x["name"] == e["name"])
            earn = "%s %s" % (p["earn_light"], p["earnings_note"])
            order = "%s %s" % (p["order_light"], p["orders_note"])
        elif e["kind"] == "anchor":
            earn, order = "🟢 已兑现", "🟢 持续"
        else:
            earn, order = "🟡 部分兑现", "🟢 AI服务器订单"
        L.append("| %s %s | %s | %s | %s | %s | %s | %s | %s | %s | %s | %s %s |" % (
            e["icon"], e["name"],
            fnum(e["rs5"], signed=True), fnum(e["rs20"], signed=True),
            ("%.1f亿" % e["capital_1d_yi"]) if isinstance(e["capital_1d_yi"], (int, float)) else "—",
            ("%.3f" % e["amount_ratio"]) if isinstance(e["amount_ratio"], (int, float)) else ("1.000(基准)" if e["kind"] == "anchor" else "—"),
            e["near_high"],
            ("%d%%" % round(e["sync20"] * 100)) if isinstance(e["sync20"], (int, float)) else "—",
            ("%d%%" % round(e["diffuse5"] * 100)) if isinstance(e["diffuse5"], (int, float)) else "—",
            earn, order, e["icon"], e["state"]))

    # 产业进度四灯
    L += ["",
          "## ④ 产业进度 · R阶段四灯（进度条，不预测日期）",
          "",
          "| 方向 | R阶段 | 产业 | 资金 | RS | 盈利 | 主线资格 |",
          "|------|-------|------|------|-----|------|---------|"]
    for p in radar["pools"]:
        L.append("| %s | R%s | %s | %s | %s | %s | %s |" % (
            p["name"], p["r_stage"], p["ind_light"], p["money_light"], p["rs_light"], p["earn_light"],
            "🟢 成立" if p["qualified"] else "未成立（需R≥3+盈利兑现+强化）"))

    # 表B：环节拆解
    L += ["",
          "## ⑤ 表B · 产业内部哪个环节先强？（先环节，后个股）",
          "",
          "> 主线即使成形，也不等于整个产业链都能买。观察哪个环节先出现「订单→收入→利润」闭环。",
          ""]
    for p in radar["pools"]:
        L.append("### %s %s · %s" % (p["icon"], p["name"], p["stage"]))
        L += ["",
              "| 环节 | 采样点（角色） | 20D | 5D | 当日主力 | 距60日高 |",
              "|------|---------------|-----|-----|---------|---------|"]
        chains = {}
        for s in p["stocks"]:
            chains.setdefault(s["chain"], []).append(s)
        for chn, ss in chains.items():
            v20 = [x["pct_20d"] for x in ss if isinstance(x.get("pct_20d"), (int, float))]
            v5 = [x["pct_5d"] for x in ss if isinstance(x.get("pct_5d"), (int, float))]
            caps = [x["capital_1d_yi"] for x in ss if isinstance(x.get("capital_1d_yi"), (int, float))]
            offs = [x["off_60d_high"] for x in ss if isinstance(x.get("off_60d_high"), (int, float))]
            members = "<br>".join("%s（%s）" % (x["name"], x["role"]) for x in ss)
            L.append("| **%s** | %s | %s | %s | %s | %s |" % (
                chn, members,
                ("%+.1f%%" % (sum(v20) / len(v20))) if v20 else "—",
                ("%+.1f%%" % (sum(v5) / len(v5))) if v5 else "—",
                ("%.1f亿" % sum(caps)) if caps else "—",
                ("%+.1f%%" % (sum(offs) / len(offs))) if offs else "—"))
        if p.get("chain_gap"):
            L += ["", "⚠️ **环节覆盖缺口**：%s" % p["chain_gap"]]
        L.append("")

    # 规则
    L += [
        "## 判读规则",
        "",
        radar.get("rule", ""),
        "",
        "### 状态机",
        "",
        "| 状态 | 触发 | 含义 |",
        "|------|------|------|",
        "| 🔥 过热 | RS20>+15 且 RS5>+5 | 拥挤，警惕 |",
        "| 🟢 强化 | RS20>0 且 RS5>0 | 中期+短期同步走强（条件B的RS部分） |",
        "| 🟡 成形 | RS20>0，RS5≤0 | 中期已强、短期试温；可能只是跑赢大跌基准 |",
        "| ⚪ 观察 | RS20∈(-5,0] | 未跑赢第一曲线 |",
        "| 🔴 衰退 | RS20≤-5 | 明显跑输 |",
        "",
        "### 迁移确认路径（相对强弱交叉）",
        "",
        "1. RS20差由负转正 → 进入观察",
        "2. RS5差转正 + 资金流入 + 龙头新高 + 中军同步，**且旧主线A衰退** → 🟡迁移候选",
        "3. 订单/业绩确认（周度，人做）+ Gate1/2/3 → Capital Permission（旧主线TPO释放 → 新主线试探仓）",
        "",
        "## 产业进度 R0-R4（机器人及所有第二幕通用）",
        "",
        "R0概念(不投资) → R1样机(观察) → R2送样/小批量(重要·但不兑现) → R3批量订单进报表(主线资格成立) → R4利润兑现(核心投资阶段)",
        "",
        "> 送样、小批量不能算盈利兑现。产业方向真实 ≠ 当前估值真实。",
        "",
    ]
    f.write_text("\n".join(L), encoding="utf-8")
    return f


def write_money_radar_md(vault, date_str, money_radar):
    """V1.0 Money Radar · 三舱资金观察驾驶舱 → 40_信号看板/YYYY-MM/YYYY-MM-DD_MoneyRadar.md

    三舱：持仓舱(8只) + 观察舱(19只) + 市场雷达(如行业层数据可得)
    每只：状态(5态/4态/5态) + 价资同步性(5种组合)
    数据源：成交额占比(东财f6真实) + 融资净买入(datacenter-web真实) + 主力净流入(仅参考)
    """
    ym = date_str[:7]
    d = vault / SIGNAL_ROOT / ym
    ensure_dir(d)
    f = d / ("%s_MoneyRadar.md" % date_str)

    holding = money_radar.get("holding_cabin", [])
    watch = money_radar.get("watch_cabin", [])
    market = money_radar.get("market_radar")
    summary = money_radar.get("summary", {})

    def fmt_amt(v):
        if isinstance(v, (int, float)):
            return "%.2f亿" % v
        return "—"

    def fmt_pct(v):
        if isinstance(v, (int, float)):
            return "%+.2f%%" % v
        return "—"

    # 状态图标
    state_icon = {"积累": "🔵", "趋势": "🟢", "分歧": "🟡", "爆发": "🟠", "衰竭": "🔴",
                  "启动": "🟢", "持续": "🟢", "观察": "⚪"}
    sync_icon = {"有效推动": "✅", "真分歧": "⚠️", "派发嫌疑": "🟠",
                 "抛压减轻": "🟢", "撤离": "🔴", "顶部背离": "🔴",
                 "中性": "⚪", "价升资平": "⚪", "价跌资平": "⚪", "数据不足": "❓"}

    L = [
        "---",
        "type: \"money-radar\"",
        "date: \"%s\"" % date_str,
        "version: \"V1.0\"",
        "related: \"[[主线迁移雷达V1.0_数据字典+触发规则]]\"",
        "---",
        "",
        "# 💰 Money Radar · 三舱资金观察 · %s" % date_str,
        "",
        "> **回答的问题**：钱从哪里来、停在哪里、正在往哪里迁移？",
        "> **数据原则**：只用真实资金数据（成交额占比+融资净买入+ETF份额），拒绝用估算的'主力净流入'冒充真实资金。",
        "> **不直接生成买卖指令**，只产出状态判断与价资同步性诊断，交给持仓引擎和主线迁移引擎作为输入。",
        "",
        "## ① 持仓舱（8 只 · 5 态状态机）",
        "",
        "| # | 代码 | 名称 | 状态 | 价资同步 | 成交额 | 5D涨跌 | 融资净买入 | 5日累计 | 资金来源 |",
        "|---|------|------|------|---------|--------|--------|-----------|---------|---------|",
    ]
    for i, h in enumerate(holding, 1):
        L.append("| %d | %s | %s | %s %s | %s %s | %s | %s | %s | %s | %s |" % (
            i, h["code"], h["name"],
            state_icon.get(h["state"], "⚪"), h["state"],
            sync_icon.get(h["sync_zh"], "❓"), h["sync_zh"],
            fmt_amt(h.get("amount_yi")),
            fmt_pct(h.get("pct_change_daily")),
            fmt_amt(h.get("rzjme_yi")),
            fmt_amt(h.get("rzjme_5d_yi")),
            h.get("capital_source") or "—",  # 资金来源：融资净买入(真实) / 主力净流入(估算·仅参考)
        ))

    L += ["",
          "> 状态枚举: 🔵积累 / 🟢趋势 / 🟡分歧 / 🟠爆发 / 🔴衰竭",
          "> 价资同步性: ✅有效推动(资升+价涨) / ⚠️真分歧(资升+价平，最值得关注) / 🟠派发嫌疑(资升+价跌) / 🟢抛压减轻(资降+价不跌) / 🔴撤离(资降+价跌)",
          "> 资金来源：融资净买入(真实，T+1) > 主力净流入(估算·仅参考)",
          "",
          "## ② 观察舱（左侧观察池 · 4 态状态机）",
          "",
          "| # | 代码 | 名称 | 状态 | 价资同步 | 成交额 | 5D涨跌 |",
          "|---|------|------|------|---------|--------|--------|",
          ]
    for i, w in enumerate(watch, 1):
        L.append("| %d | %s | %s | %s %s | %s %s | %s | %s |" % (
            i, w["code"], w["name"],
            state_icon.get(w["state"], "⚪"), w["state"],
            sync_icon.get(w["sync_zh"], "❓"), w["sync_zh"],
            fmt_amt(w.get("amount_yi")),
            fmt_pct(w.get("pct_change_daily")),
        ))

    L += ["",
          "> 观察舱状态：🟢启动(5D占比上穿20D) / 🟢趋势(行业吸引力倍数>1.2持续5日+) / 🟢持续(>1.5持续10日+) / ⚪观察(状态退化)",
          "> 观察池不自动获得 Capital Permission，需通过 Gate 0→4 验证",
          "",
          "## ③ 市场雷达（行业层 · 5 态状态机）",
          "",
          ]

    if market:
        L += [
            "| # | 行业 | 成交额 | 占比 | 5D变化 | 持续天数 | 状态 |",
            "|---|------|--------|------|--------|---------|------|",
        ]
        for i, m in enumerate(market[:20], 1):
            L.append("| %d | %s | %s | — | — | — | — |" % (
                i, m.get("industry_name", ""),
                fmt_amt(m.get("turnover_yuan", 0) / 1e8 if isinstance(m.get("turnover_yuan"), (int, float)) else None),
            ))
    else:
        L += [
            "> ⚠️ push2 TLS 封锁未取到行业层数据。已自动降级到仅个股层。",
            "> 系统仍能基于持仓舱 + 观察舱两层产出状态判断，仅缺少行业层资金迁移证据。",
            "",
            "**V1.0 已知限制**：行业板块 API 间歇性封锁，需在 push2 不封锁时段（如 16:30 收盘后）重试。",
        ]

    # 汇总
    state_count = summary.get("holding_state_count", {})
    sync_count = summary.get("holding_sync_count", {})
    L += ["",
          "## ④ 汇总",
          "",
          "**持仓舱状态分布**: %s" % (" · ".join("%s×%d" % (k, v) for k, v in state_count.items()) or "—"),
          "**价资同步性分布**: %s" % (" · ".join("%s×%d" % (k, v) for k, v in sync_count.items()) or "—"),
          "**观察舱数量**: %d 只" % summary.get("watch_count", 0),
          "",
          "## ⑤ Capital Permission 资金层证据",
          "",
          "| Gate | 名称 | 资金层证据 | 仓位含义 |",
          "|------|------|-----------|---------|",
          "| Gate 0 | 产业存在 | （产业层，非本雷达职责） | 观察池准入 |",
          "| Gate 1 | 成形（观察） | 5D成交额占比上穿20D + 状态=启动 | 无仓位 |",
          "| Gate 2 | 强化（1-3%试探） | 占比持续≥3日 + 价资同步=有效推动 + 行业吸引力倍数>1.2 | 允许1-3%试探仓 |",
          "| Gate 3 | 兑现（战略仓） | Gate 2持续 + 盈利验证 + 融资余额rzjme_5d为正 | 允许战略仓 |",
          "| Gate 4 | 过热（TPO监控） | 状态=爆发或衰竭 + 拥挤度高位 | 进入TPO监控 |",
          "",
          "> ⚠️ Capital Permission 仍由 Gate 框架控制；Money Radar 只产出 Gate 判定所需的资金层证据。",
          '> ⚠️ 禁止卖弱后立即买强：Risk Permission(可卖) 与 Capital Permission(可买) 需独立生成。',
          "",
          "## ⑥ 模块隔离铁律",
          "",
          "判断顺序（强制）：**M-01外部风险 → A股市场结构 → AI主线 → Portfolio既有Decision**",
          "",
          "任一层未通过则停止向下传递；**不允许跳层合成结论**。",
          "",
          "禁止跨模块串证：",
          "- ❌ 美股宏观风险+A股放量滞涨=AI要撤",
          "- ❌ 主力资金流出+融资余额下降=必须卖",
          "- ❌ Wilson 7100+放量滞涨=TPO触发",
          "",
          "## ⑦ 边界",
          "",
          "- 系统不预测股价、不生成买卖指令",
          "- 资金最集中的地方往往也是最拥挤的地方",
          "- 黑天鹅之前资金有时会先行：融资余额突然下降、ETF被大额赎回 → 这是只盯资金的取舍价值",
          "- V1.0 不含 ETF 份额（V1.1 补）",
          "- 状态机阈值为初定，5个交易日数据后回测校准",
          "",
        ]
    f.write_text("\n".join(L), encoding="utf-8")
    return f


def compute_r15s_shengyi(curr):
    """生益电子(688183) R1.5-S 二次启动三条件自动判定。
    ①收复前一大阴线实体一半 ②放量(量>前日) ③主力转正(f62,盘后不可得标None)
    用腾讯日K最后两根(前日大阴线/今日)。"""
    code = "688183"
    k = fetch_kline(secid_of(code))
    out = {"name": "生益电子", "code": code, "conditions": {}, "passed": None, "note": ""}
    if not k or len(k["rows"]) < 2:
        out["note"] = "K线不足，无法判定"
        return out
    prev, today = k["rows"][-2], k["rows"][-1]
    # 条件①：前日为阴线(收<开)，今日收盘 > 前日实体中点(开+收)/2
    is_bear = prev["close"] < prev["open"]
    midpoint = (prev["open"] + prev["close"]) / 2
    c1 = bool(is_bear and today["close"] > midpoint)
    out["conditions"]["recover_half"] = {
        "pass": c1, "prev_open": prev["open"], "prev_close": prev["close"],
        "midpoint": round(midpoint, 2), "today_close": today["close"]}
    # 条件②：放量（今日成交量 > 前日）
    c2 = bool(today["volume"] > prev["volume"])
    out["conditions"]["volume_up"] = {
        "pass": c2, "prev_vol": int(prev["volume"]), "today_vol": int(today["volume"]),
        "vol_ratio": round(today["volume"] / prev["volume"], 2) if prev["volume"] else None}
    # 条件③：主力转正（f62 盘后清空→无法确认，不臆测）
    cap = curr.get(code, {}).get("capital_1d_yi")
    out["conditions"]["capital_positive"] = {
        "pass": (cap > 0) if isinstance(cap, (int, float)) else None,
        "capital_1d_yi": cap,
        "available": isinstance(cap, (int, float))}
    confirmed = sum(1 for c in out["conditions"].values() if c.get("pass") is True)
    out["confirmed_count"] = confirmed
    out["passed"] = confirmed >= 3
    out["note"] = ("二次启动确认（3/3）" if confirmed >= 3
                   else "%d/3，继续R1.5-S观察器（非确认器）" % confirmed)
    return out


def evaluate_signals(prev, curr, all_stocks):
    hardware = [s for s in all_stocks if "第一幕" in str(s.get("main_line", ""))]
    software = [s for s in all_stocks if "第二幕" in str(s.get("main_line", ""))]

    def cap_pos(lst):
        n = 0
        for s in lst:
            c = curr.get(s["code"], {})
            v = c.get("capital_5d_yi")
            if isinstance(v, (int, float)) and v > 0:
                n += 1
        return n, max(len(lst), 1)

    hw_pos, hw_tot = cap_pos(hardware)
    sw_pos, sw_tot = cap_pos(software)
    S1 = (sw_pos >= max(3, int(sw_tot * 0.75))) and (hw_pos < max(hw_tot * 0.25, 1))

    dragons = {"688111", "300033", "600845", "00268.HK", "600570"}
    hardened = 0
    for code in dragons:
        c = curr.get(code, {})
        v = c.get("capital_1d_yi")
        p = c.get("pct_change_daily")
        if isinstance(v, (int, float)) and v > 0 and isinstance(p, (int, float)) and p > 0:
            hardened += 1
    S2 = hardened >= 2

    sw_disclosed = sum(1 for s in software if s.get("ai_revenue_disclosed"))
    S3 = ("full" if sw_disclosed >= max(3, len(software) - 1)
          else "partial" if sw_disclosed >= 1 else False)

    def avg_pct(lst):
        vals = [curr[s["code"]].get("pct_change_daily") or 0 for s in lst if s["code"] in curr]
        return sum(vals) / len(vals) if vals else 0.0

    S4 = avg_pct(software) > avg_pct(hardware) + 0.01

    signals = {
        "S1_plate_capital": bool(S1),
        "S1_note": "硬件 %d/%d 正向 · 软件 %d/%d 正向" % (hw_pos, hw_tot, sw_pos, sw_tot),
        "S2_dragon_synchronization": S2,
        "S2_note": "%d/5 只中军当日量价同步强化" % hardened,
        "S3_earnings_realization": S3,
        "S3_note": "%d/%d 家软件AI收入单独披露" % (sw_disclosed, max(len(software), 1)),
        "S4_relative_expectation": bool(S4),
        "S4_note": "软件日均涨幅 %.2f%% vs 硬件 %.2f%%" % (avg_pct(software), avg_pct(hardware)),
    }
    sat = sum([signals["S1_plate_capital"], signals["S2_dragon_synchronization"],
               signals["S3_earnings_realization"] == "full",
               signals["S4_relative_expectation"]])
    alerts = []
    if sat >= 3:
        alerts.append({"level": "critical", "target": "Signal升级门",
                       "content": "Signal 1-4 满足 %d/4 项，Capital Permission 升级审查触发" % sat})
    return signals, alerts, sat >= 3, False, sat


# ========== V1.0 Money Radar · 三舱资金观察 ==========

# 持仓舱8只 + 观察舱采样点
HOLDING_CODES_MR = ["300308", "300502", "688041", "688008", "002371", "688012", "603986", "002463"]

# V1.0 名称兜底：东财批量行情对部分代码失败时（name_em=None），从RADAR_POOLS本地映射补齐
NAME_FALLBACK = {}
HOLDING_NAMES_MR = {"300308": "中际旭创", "300502": "新易盛", "688041": "海光信息", "688008": "澜起科技",
                    "002371": "北方华创", "688012": "中微公司", "603986": "兆易创新", "002463": "沪电股份"}
NAME_FALLBACK.update(HOLDING_NAMES_MR)
for _pool in RADAR_POOLS:
    for _code, _name, _role, _tag in _pool.get("stocks", []):
        NAME_FALLBACK[_code] = _name


def compute_price_capital_sync(code, curr, margin_balance=None):
    """V1.0 价资同步性矩阵（5种组合）。

    资金方向判定优先级：
      1) turnover_em_yi 与 5日前东财f6对比（如有历史归档）
      2) capital_1d_yi 符号（仅参考）
      3) rzjme（融资净买入，T+1，最真实）

    价格方向：
      price_5d_pct 符号，|x| < 0.5% 视为平

    返回: {capital_dir, price_dir, state, state_zh, note}
    state: "effective" | "divergence" | "distribution" | "relief" | "evacuation"
    """
    c = curr.get(code, {})
    price_5d_pct = c.get("price_5d_pct")
    capital_1d = c.get("capital_1d_yi")
    amt_em_today = c.get("turnover_em_yi")
    amt_tx_today = c.get("amount_yi")

    # 资金方向判定（按数据字典原则：真实数据优先，估算数据仅参考不投票）
    # 优先级1: 融资净买入（T+1，最真实，datacenter-web RZJME）
    # 优先级2: 无真实数据时退回东财f62主力净流入（仅参考）
    cap_dir = None
    rzjme_dir_note = ""
    if margin_balance and isinstance(margin_balance.get("rzjme"), (int, float)):
        rzjme = margin_balance["rzjme"]
        if abs(rzjme) > 1e6:  # > 100万元
            cap_dir = 1 if rzjme > 0 else -1
            rzjme_dir_note = "融资净买入(真实)"
    if cap_dir is None and isinstance(capital_1d, (int, float)) and abs(capital_1d) > 0.01:
        cap_dir = 1 if capital_1d > 0 else -1
        rzjme_dir_note = "主力净流入(估算·仅参考)"

    if cap_dir is None:
        return {"capital_dir": 0, "price_dir": 0, "state": "unknown",
                "state_zh": "数据不足", "note": "资金方向无可用数据",
                "capital_1d_yi": capital_1d,
                "rzjme_yi": round(margin_balance["rzjme"] / 1e8, 2) if margin_balance and isinstance(margin_balance.get("rzjme"), (int, float)) else None,
                "rzjme_5d_yi": round(margin_balance["rzjme_5d"] / 1e8, 2) if margin_balance and isinstance(margin_balance.get("rzjme_5d"), (int, float)) else None,
                "price_5d_pct": price_5d_pct,
                "capital_source": rzjme_dir_note}

    # 价格方向
    price_dir = 0
    if isinstance(price_5d_pct, (int, float)):
        if abs(price_5d_pct) < 0.5:
            price_dir = 0
        else:
            price_dir = 1 if price_5d_pct > 0 else -1

    # 状态判定矩阵
    matrix = {
        (1, 1): ("effective", "有效推动"),      # 资金升+价涨
        (1, 0): ("divergence", "真分歧"),         # 资金升+价平 → 最值得关注
        (1, -1): ("distribution", "派发嫌疑"),    # 资金升+价跌
        (-1, 0): ("relief", "抛压减轻"),          # 资金降+价不跌
        (-1, -1): ("evacuation", "撤离"),          # 资金降+价跌
        (-1, 1): ("warning", "顶部背离"),         # 资金降+价涨 → 顶部背离预警
        (0, 0): ("neutral", "中性"),
        (0, 1): ("price_only", "价升资平"),
        (0, -1): ("price_only_down", "价跌资平"),
    }
    state, state_zh = matrix.get((cap_dir, price_dir), ("unknown", "未知"))

    note_parts = []
    if isinstance(capital_1d, (int, float)):
        note_parts.append("主力%.2f亿" % capital_1d)
    if margin_balance and isinstance(margin_balance.get("rzjme"), (int, float)):
        note_parts.append("融资净买入%.2f亿" % (margin_balance["rzjme"] / 1e8))
    if isinstance(amt_em_today, (int, float)):
        note_parts.append("成交额%.2f亿" % amt_em_today)
    if isinstance(price_5d_pct, (int, float)):
        note_parts.append("5D涨跌%+.2f%%" % price_5d_pct)

    return {
        "capital_dir": cap_dir, "price_dir": price_dir,
        "state": state, "state_zh": state_zh,
        "note": " | ".join(note_parts) if note_parts else "—",
        "capital_1d_yi": capital_1d,
        "rzjme_yi": round(margin_balance["rzjme"] / 1e8, 2) if margin_balance and isinstance(margin_balance.get("rzjme"), (int, float)) else None,
        "rzjme_5d_yi": round(margin_balance["rzjme_5d"] / 1e8, 2) if margin_balance and isinstance(margin_balance.get("rzjme_5d"), (int, float)) else None,
        "price_5d_pct": price_5d_pct,
        "capital_source": rzjme_dir_note,
    }


def compute_holding_cabin_state(code, curr, margin_balance=None, archive_history=None):
    """持仓舱5态状态机: 积累/趋势/分歧/爆发/衰竭

    archive_history: list[dict]，过去N日的归档数据，每条包含 turnover_em_yi
                    如无归档历史，仅基于当日数据做简化判定。
    """
    c = curr.get(code, {})
    amt_today = c.get("turnover_em_yi") or c.get("amount_yi")

    # 价资同步性
    sync = compute_price_capital_sync(code, curr, margin_balance)

    # 简化版状态判定（无多日历史时）
    if not archive_history or len(archive_history) < 5:
        # 仅基于当日价资同步性
        if sync["state"] == "divergence":
            state = "分歧"
        elif sync["state"] == "evacuation":
            state = "衰竭"
        elif sync["state"] == "effective":
            state = "趋势"  # 简化：价资同步有效即视为趋势
        elif sync["state"] == "distribution":
            state = "分歧"
        elif sync["state"] == "relief":
            state = "积累"  # 抛压减轻=积累期
        else:
            state = "积累"  # 默认
        return {
            "state": state, "sync": sync,
            "amount_yi": amt_today,
            "history_days": 0,
            "note": "V1.0简化判定（无多日归档），需5日数据后切换到完整状态机",
        }

    # 完整版状态判定（5日+历史）
    amts = [h.get(code, {}).get("turnover_em_yi") or h.get(code, {}).get("amount_yi") for h in archive_history]
    amts = [a for a in amts if isinstance(a, (int, float))]
    if len(amts) < 5:
        return {"state": "积累", "sync": sync, "amount_yi": amt_today,
                "history_days": len(amts), "note": "历史不足5日"}

    avg_5d = sum(amts[-5:]) / 5
    avg_20d = sum(amts[-20:]) / 20 if len(amts) >= 20 else avg_5d

    # 状态机规则
    if avg_5d > avg_20d:
        # 资金上行
        if sync["state"] == "divergence":
            state = "分歧"
        elif sync["state"] == "effective":
            # 检查是否突破历史90分位（爆发）
            sorted_amts = sorted(amts)
            p90 = sorted_amts[int(len(sorted_amts) * 0.9) - 1] if len(sorted_amts) >= 10 else None
            if p90 and avg_5d > p90:
                state = "爆发"
            else:
                state = "趋势"
        else:
            state = "趋势"
    else:
        # 资金下行
        if sync["state"] == "evacuation":
            state = "衰竭"
        elif sync["state"] == "relief":
            state = "积累"
        else:
            state = "衰竭"

    return {
        "state": state, "sync": sync, "amount_yi": amt_today,
        "avg_5d_yi": round(avg_5d, 2), "avg_20d_yi": round(avg_20d, 2),
        "history_days": len(amts),
        "note": "V1.0完整状态机判定",
    }


def compute_money_radar(curr, margin_balance=None, archive_history=None):
    """V1.0 Money Radar · 三舱资金观察驾驶舱主入口

    返回: {
        holding_cabin: list[{code, name, state, sync, amount_yi, ...}],  # 持仓舱8只
        watch_cabin: list[...],                                          # 观察舱19只
        market_radar: dict | None,                                      # 市场雷达31行业
        summary: {holding_states, watch_states, ...},
    }
    """
    holding_cabin = []
    for code in HOLDING_CODES_MR:
        if code in curr:
            c = curr[code]
            mb = margin_balance.get(code) if margin_balance else None
            state = compute_holding_cabin_state(code, curr, mb, archive_history)
            holding_cabin.append({
                "code": code,
                "name": c.get("name_em") or NAME_FALLBACK.get(code, code),  # 东财名称缺失时本地兜底
                "state": state["state"],
                "sync_state": state["sync"]["state"],
                "sync_zh": state["sync"]["state_zh"],
                "sync_note": state["sync"]["note"],
                "capital_source": state["sync"].get("capital_source", ""),
                "amount_yi": state.get("amount_yi"),
                "price": c.get("price"),
                "pct_change_daily": c.get("pct_change_daily"),
                "rzjme_yi": state["sync"].get("rzjme_yi"),
                "rzjme_5d_yi": state["sync"].get("rzjme_5d_yi"),
                "history_days": state.get("history_days", 0),
            })

    # 观察舱：从 RADAR_CODES 选取
    watch_cabin = []
    for code in RADAR_CODES:
        if code in curr and code not in HOLDING_CODES_MR:
            c = curr[code]
            mb = margin_balance.get(code) if margin_balance else None
            sync = compute_price_capital_sync(code, curr, mb)
            # 简化观察舱状态：启动/趋势/持续/观察
            w_state = "观察"
            if sync["state"] == "effective":
                w_state = "趋势"
            elif sync["state"] == "divergence":
                w_state = "观察"  # 真分歧需重点观察
            elif sync["state"] == "evacuation":
                w_state = "观察"
            watch_cabin.append({
                "code": code,
                "name": c.get("name_em") or NAME_FALLBACK.get(code, code),  # 东财名称缺失时本地兜底
                "state": w_state,
                "sync_state": sync["state"],
                "sync_zh": sync["state_zh"],
                "sync_note": sync["note"],
                "amount_yi": c.get("turnover_em_yi") or c.get("amount_yi"),
                "price": c.get("price"),
                "pct_change_daily": c.get("pct_change_daily"),
            })

    # 汇总
    state_count = {}
    for h in holding_cabin:
        state_count[h["state"]] = state_count.get(h["state"], 0) + 1

    sync_count = {}
    for h in holding_cabin:
        sync_count[h["sync_zh"]] = sync_count.get(h["sync_zh"], 0) + 1

    return {
        "holding_cabin": holding_cabin,
        "watch_cabin": watch_cabin,
        "market_radar": None,  # 行业层如TLS封锁则为None
        "summary": {
            "holding_state_count": state_count,
            "holding_sync_count": sync_count,
            "watch_count": len(watch_cabin),
            "snapshot_at": dt.date.today().isoformat(),
        },
    }


# ---------- 结构真实性雷达 ----------

# B层结构键（档案frontmatter扁平键，手动财报季录入；缺失=待补，绝不臆测）
STRUCT_KEYS = ["struct_order_trend", "struct_asp_trend", "struct_inventory_trend",
               "struct_utilization_trend", "struct_leadtime_trend"]
# A层阈值（亿/倍）
RADAR_HEAVY_OUT_5D = -10.0
RADAR_HEAVY_OUT_1D = -5.0
RADAR_VOL_SPIKE = 1.5
RADAR_STREAK_TO_TPO = 3  # 🟠连续3日 → 计入TPO C条件


def structure_radar(code, c, fm, prev_radar):
    """价格×资金×量一致性（A层每日自动）+ B层结构确认（手动录入）
    → {code, name, icon, verdict, reason, streak}
    A层单独只出⚪/🟢/🟠；🔴三重背离必须B层确认。"""
    p5 = c.get("price_5d_pct")
    if not isinstance(p5, (int, float)):
        return {"code": code, "icon": "⚪", "verdict": "待补",
                "reason": "无K线数据", "streak": 0}
    c5, c1 = c.get("capital_5d_yi"), c.get("capital_1d_yi")
    vr = c.get("volume_ratio")
    struct_bad = [k.replace("struct_", "").replace("_trend", "")
                  for k in STRUCT_KEYS if fm.get(k) == "恶化"]
    heavy_out = ((isinstance(c5, (int, float)) and c5 <= RADAR_HEAVY_OUT_5D)
                 or (isinstance(c1, (int, float)) and c1 <= RADAR_HEAVY_OUT_1D))
    cap_out = ((isinstance(c5, (int, float)) and c5 < 0)
               or (c5 is None and isinstance(c1, (int, float)) and c1 < 0))
    cap_in = ((isinstance(c5, (int, float)) and c5 >= 1.0)
              or (c5 is None and isinstance(c1, (int, float)) and c1 >= 0.5))  # 微量流入视为中性防噪音
    vol_spike = isinstance(vr, (int, float)) and vr >= RADAR_VOL_SPIKE
    fmt_cap = ("5日%.1f亿" % c5) if isinstance(c5, (int, float)) else \
              (("1日%.1f亿" % c1) if isinstance(c1, (int, float)) else "资金待补")

    if p5 > 0:
        if struct_bad:
            icon, verdict = "🔴", "三重背离"
            reason = "价格↑+B层结构恶化(%s)+%s" % ("/".join(struct_bad), fmt_cap)
        elif heavy_out or (vol_spike and cap_out):
            icon, verdict = "🟠", "价格领先基本面"
            reason = "价格↑但主力流出(%s)%s" % (fmt_cap, "·量比%.1f" % vr if vol_spike else "")
        elif cap_in:
            icon, verdict = "🟢", "结构支撑"
            reason = "价格↑且主力流入(%s)" % fmt_cap
        else:
            icon, verdict = "⚪", "中性"
            reason = "价格↑，资金数据待补"
    else:
        if heavy_out and cap_out:
            icon, verdict = "🟠", "放量下跌"
            reason = "价格↓+主力大幅流出(%s)，TPO C/D输入" % fmt_cap
        elif cap_in:
            icon, verdict = "🟢", "下跌承接"
            reason = "价格↓但主力流入(%s)，错杀候选" % fmt_cap
        else:
            icon, verdict = "⚪", "中性"
            reason = "价格↓，流出温和(%s)" % fmt_cap

    prev = prev_radar.get(code) or {}
    if icon in ("🟠", "🔴") and prev.get("verdict") == verdict:
        streak = int(prev.get("streak") or 0) + 1
    elif icon in ("🟠", "🔴"):
        streak = 1
    else:
        streak = 0
    return {"code": code, "icon": icon, "verdict": verdict, "reason": reason,
            "price_5d_pct": p5, "capital_5d_yi": c5, "volume_ratio": vr, "streak": streak}


# ---------- 输出层 ----------

def write_signal_md(vault, date_str, prev, curr, signals, alerts, sat, stocks_meta, radar):
    out_dir = vault / SIGNAL_ROOT / date_str[:7]
    ensure_dir(out_dir)
    out = out_dir / ("%s_信号快照.md" % date_str)
    marks = {"full": "✅", "partial": "🟡", False: "❌"}
    lines = ["# 信号快照 · %s" % date_str, "",
             "数据源：东方财富（自动采集 %s）" % dt.datetime.now().strftime("%H:%M"), "",
             "**Signal 1-4 门控**", "",
             "| 信号 | 结果 | 判读 |", "|------|------|------|"]
    lines.append("| S1 板块资金 | %s | %s |" % ("✅" if signals["S1_plate_capital"] else "❌", signals["S1_note"]))
    lines.append("| S2 龙头中军 | %s | %s |" % ("✅" if signals["S2_dragon_synchronization"] else "❌", signals["S2_note"]))
    lines.append("| S3 盈利兑现 | %s | %s |" % (marks[signals["S3_earnings_realization"]], signals["S3_note"]))
    lines.append("| S4 相对预期 | %s | %s |" % ("✅" if signals["S4_relative_expectation"] else "❌", signals["S4_note"]))
    lines += ["", "**升级门**：满足 %d/4 → %s" % (sat, "🔴 触发" if sat >= 3 else "❌ 未触发"), "",
              "**12只票收盘数据**", "",
              "| 股票 | 收盘 | 日涨跌 | 当日主力 | 5日主力 | 趋势 | 量比 |", "|------|------|--------|---------|---------|------|------|"]
    for s in stocks_meta:
        c = curr.get(s["code"], {})
        if not c.get("price"):
            lines.append("| [[%s]] | — | — | — | — | %s | — |" % (s["name"], c.get("trend", "—")))
            continue
        p, pct = c["price"], c["pct_change_daily"] or 0
        c1, c5 = c.get("capital_1d_yi"), c.get("capital_5d_yi")
        vr = c.get("volume_ratio")
        lines.append("| [[%s]] | %.2f | %+.2f%% | %s | %s | %s | %s |" % (
            s["name"], p, pct,
            "%.2f亿%s" % (c1, "🟢" if c1 > 0 else "🔴") if isinstance(c1, (int, float)) else "—",
            "%.2f亿%s" % (c5, "🟢" if c5 > 0 else "🔴") if isinstance(c5, (int, float)) else "—",
            c["trend"], "%.2f" % vr if vr else "—"))
    if alerts:
        lines += ["", "## 警报", ""]
        lines += ["- 【%s】%s：%s" % (a["level"], a["target"], a["content"]) for a in alerts]
    lines += ["", "## 结构真实性雷达", "",
              "> A层：价格×资金×量（自动）；🔴需B层结构确认；🟠连续%d日→TPO C条件" % RADAR_STREAK_TO_TPO, "",
              "| 股票 | 5日涨跌 | 5日主力 | 量比 | 雷达 | 依据 |", "|------|---------|---------|------|------|------|"]
    for r in radar:
        p5, c5, vr = r.get("price_5d_pct"), r.get("capital_5d_yi"), r.get("volume_ratio")
        streak_note = "（连续%d日）" % r["streak"] if r.get("streak", 0) > 1 else ""
        lines.append("| [[%s]] | %s | %s | %s | %s %s | %s%s |" % (
            r["name"],
            "%+.1f%%" % p5 if isinstance(p5, (int, float)) else "—",
            "%.1f亿" % c5 if isinstance(c5, (int, float)) else "—",
            "%.2f" % vr if isinstance(vr, (int, float)) else "—",
            r["icon"], r["verdict"], r["reason"], streak_note))
    lines.append("")
    out.write_text("\n".join(lines), encoding="utf-8")
    return out


def write_agent_json(vault, date_str, payload):
    feed = vault / AGENT_FEED
    ensure_dir(feed)
    f = feed / ("%s_snapshot_agent.json" % date_str)
    f.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    latest = feed / "latest.json"
    if latest.exists() or latest.is_symlink():
        latest.unlink()
    latest.symlink_to(f.name)
    return f


def write_inbox_alert(vault, date_str, alerts):
    if not alerts:
        return None
    inbox = vault / INBOX_DIR
    ensure_dir(inbox)
    f = inbox / ("警报_%s.md" % date_str)
    lines = ["# ⚠️ 警报 · %s" % date_str, ""]
    lines += ["- 【%s】%s：%s" % (a["level"].upper(), a["target"], a["content"]) for a in alerts]
    f.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return f


def write_second_curve_md(vault, date_str, sc):
    """输出第二曲线每日作战表到 40_信号看板/YYYY-MM/"""
    ym = date_str[:7]
    d = vault / SIGNAL_ROOT / ym
    ensure_dir(d)
    f = d / ("%s_第二曲线每日作战表.md" % date_str)
    c = sc
    lines = [
        "---",
        "type: \"daily-battle-card\"",
        "date: \"%s\"" % date_str,
        "related: \"[[第二曲线迁移决策系统]]\"",
        "---",
        "",
        "# 📊 第二曲线每日作战表 · %s" % date_str,
        "",
        "> 第一曲线基准（6只等权）5D: **%.2f%%** / 10D: **%.2f%%**" % (c.get("base_5d", 0), c.get("base_10d", 0)),
        "",
        "## 一、第一曲线 RS",
        "",
        "| 股票 | 5D RS | 10D RS |",
        "|------|-------|--------|",
    ]
    names1 = CURVE1_NAMES
    for code in CURVE1_CODES:
        lines.append("| %s | %s | %s |" % (
            names1[code],
            ("%+.2f" % c["rs5_%s" % code]) if c.get("rs5_%s" % code) is not None else "—",
            ("%+.2f" % c["rs10_%s" % code]) if c.get("rs10_%s" % code) is not None else "—"))
    names_pcb = PCB5_NAMES
    lines += ["", "## 二、PCB 五人组 RS", "",
              "| 股票 | 5D RS | 10D RS |", "|------|-------|--------|"]
    for code in PCB5_CODES:
        lines.append("| %s | %s | %s |" % (
            names_pcb[code],
            ("%+.2f" % c["rs5_%s" % code]) if c.get("rs5_%s" % code) is not None else "—",
            ("%+.2f" % c["rs10_%s" % code]) if c.get("rs10_%s" % code) is not None else "—"))
    g2 = c.get("gate2", {})
    g2_score = sum(1 for v in [g2.get("5d_rs_all_pos"), g2.get("10d_rs_all_pos"),
                               g2.get("leader_diffusion_ge2")] if v)
    lines += ["", "## 三、迁移指标", "",
              "| 指标 | 值 |", "|------|-----|",
              "| 第一曲线成交额 | %s 亿 |" % (c.get("curve1_amount_yi") or "—"),
              "| PCB 五人组成交额 | %s 亿 |" % (c.get("pcb_amount_yi") or "—"),
              "| PCB/第一曲线 成交额比 | %s |" % (c.get("pcb_curve1_amount_ratio") or "—"),
              "| 光模块 10D RS 均值 | %s |" % (c.get("opt_rs10_avg") or "—"),
              "| PCB 10D RS 均值 | %s |" % (c.get("pcb_rs10_avg") or "—"),
              "| **PCB-光模块 10D RS 差** | **%s** |" % (c.get("pcb_opt_rs10_diff") or "—"),
              "", "## 四、Gate2 五指标", "",
              "| 指标 | 状态 |", "|------|------|",
              "| ① 5D RS 全部>0 | %s |" % ("✅" if g2.get("5d_rs_all_pos") else "❌"),
              "| ② 10D RS 全部>0 | %s |" % ("✅" if g2.get("10d_rs_all_pos") else "❌"),
              "| ③ 成交额占比连续5日升 | ⏳ 待连续数据 |",
              "| ④ 龙头扩散≥2只 | %s |" % ("✅" if g2.get("leader_diffusion_ge2") else "❌"),
              "| ⑤ 上涨质量 | 🟡 待人工判读 |",
              "| **合计（需≥4）** | **%d/5** |" % g2_score,
              "", "## 五、状态判定", "",
              "市场状态：见 [[第二曲线迁移决策系统#〇、市场五状态]]",
              "Gate2 通过：%s" % ("✅ 可 R2-A" if g2_score >= 4 else "❌ 未达 R2，继续观察"),
              ""]
    f.write_text("\n".join(lines), encoding="utf-8")
    return f


# ---------- 可分享标准数据包（供 ChatGPT/Claude/豆包 分析） ----------

def archive_raw(vault, date_str, curr, margin_balance=None, industry_turnover=None):
    """归档当日原始行情+资金到 97_原始数据/YYYY-MM-DD/raw_market.json（永不覆盖）。
    用途：①任何判断可反查原始数据 ②自己累加5D/10D资金流（替代被TLS封锁的push2his）

    V1.0 Money Radar 扩展:
    - margin_balance: 持仓+观察池每只股票的融资融券余额（T+1披露，datacenter-web）
    - industry_turnover: 50+行业板块成交额（push2间歇TLS封锁，可能为None）
    - market_total_turnover_yi: 全市场当日总成交额（亿元，从个股汇总或行业汇总）
    """
    d = vault / RAW_ROOT / date_str
    ensure_dir(d)
    f = d / "raw_market.json"
    if f.exists():
        return f

    # V1.0 Money Radar: 计算市场总成交额(亿元) → 从东财f6个股汇总
    market_total_yi = None
    if curr:
        amt_sum = sum(c.get("turnover_em_yi") or 0 for c in curr.values() if isinstance(c.get("turnover_em_yi"), (int, float)))
        # 持仓+雷达池只是全市场很小一部分，不能作为分母；标记为样本汇总
        market_total_yi = round(amt_sum, 2) if amt_sum > 0 else None

    payload = {
        "date": date_str,
        "archived_at": dt.datetime.now().isoformat(timespec="seconds"),
        "source": "eastmoney_push2(价格/当日主力f62) + tencent_kline(5D/10D/成交额) + datacenter_web(融资融券T+1)",
        "definition": "capital_1d_yi=东方财富f62主力净流入(亿元，仅参考，不进入状态机)；turnover_em_yi=东财f6成交额(亿元，真实)；amount_yi=腾讯qt[37]成交额(亿元，真实)；price_*d_pct=腾讯前复权日K收盘价区间涨跌幅；rzye/rzmre/rzche/rzjme单位均为元",
        "data": curr,
    }

    # V1.0 Money Radar: 融资融券归档（T+1披露）
    if margin_balance:
        payload["margin_balance"] = margin_balance
        payload["margin_balance_note"] = "T+1披露，datacenter-web RPTA_WEB_RZRQ_GGMX；当日调用拿T-1日数据"

    # V1.0 Money Radar: 行业板块成交额归档（push2可能TLS封锁）
    if industry_turnover:
        payload["industry_turnover"] = industry_turnover
        # 行业汇总作为市场总成交额更准确
        ind_sum = sum(x.get("turnover_yuan") or 0 for x in industry_turnover if isinstance(x.get("turnover_yuan"), (int, float)))
        if ind_sum > 0:
            market_total_yi = round(ind_sum / 1e8, 2)
    else:
        payload["industry_turnover_note"] = "push2 TLS封锁未取到，行业层降级；个股层仍可用"

    payload["market_total_turnover_yi"] = market_total_yi

    f.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return f


def flow_nd_from_archive(vault, code, n=5):
    """从原始归档累加N日主力资金净流入（亿元）。push2his失效后的自有口径。"""
    root = vault / RAW_ROOT
    if not root.exists():
        return None
    days = sorted([p.name for p in root.iterdir() if p.is_dir() and p.name[:4].isdigit()])[-n:]
    vals = []
    for day in days:
        rf = root / day / "raw_market.json"
        try:
            v = json.loads(rf.read_text(encoding="utf-8")).get("data", {}).get(code, {}).get("capital_1d_yi")
            if isinstance(v, (int, float)):
                vals.append(v)
        except Exception:
            pass
    return round(sum(vals), 2) if vals else None


def classify_market_state(sc):
    """五状态机器判定（V1.0 规则版）：集中/扩散/迁移/再集中/退潮。
    扩散期 = 第一曲线(光模块)5D仍强 + 第二曲线10D开始反超 + Gate2未达（未确认迁移）。"""
    g2 = sc.get("gate2", {})
    g2_score = sum(1 for k in ("5d_rs_all_pos", "10d_rs_all_pos", "leader_diffusion_ge2") if g2.get(k))
    opt_rs5 = sc.get("opt_rs5_avg")
    rs10_diff = sc.get("pcb_opt_rs10_diff")
    rs5_diff = None
    if sc.get("pcb_rs5_avg") is not None and sc.get("opt_rs5_avg") is not None:
        rs5_diff = round(sc["pcb_rs5_avg"] - sc["opt_rs5_avg"], 2)
    if g2_score >= 4 and (rs5_diff or -9) > 0 and (rs10_diff or -9) > 0:
        state = "迁移期"
    elif (opt_rs5 or -9) > 0 and (rs10_diff or -9) > 0 and g2_score < 4:
        state = "扩散期"
    elif (opt_rs5 or 9) < 0 and (rs5_diff if rs5_diff is not None else -9) < 0:
        state = "退潮预警"
    else:
        state = "集中期"
    return state, g2_score, rs5_diff


def _stock_row(code, name, curve, curr, sc, vault):
    raw = curr.get(code, {})
    rs5 = sc.get("rs5_%s" % code)
    rs10 = sc.get("rs10_%s" % code)
    cap1 = raw.get("capital_1d_yi")
    cap5 = raw.get("capital_5d_yi") or flow_nd_from_archive(vault, code, 5)
    return {"code": code, "name": name, "curve": curve,
            "price": raw.get("price"),
            "daily_pct": raw.get("pct_change_daily"),
            "pct_5d": raw.get("price_5d_pct"),
            "pct_10d": raw.get("price_10d_pct"),
            "rs5": rs5, "rs10": rs10,
            "amount_yi": raw.get("amount_yi"),
            "capital_1d_yi": cap1, "capital_5d_yi": cap5,
            "trend": raw.get("trend")}


def build_share_packet(vault, date_str, payload, sc, curr):
    state, g2_score, rs5_diff = classify_market_state(sc)
    day_index = "Day0" if date_str == "2026-09-09" else "Day?"
    has_cap = any(isinstance(curr.get(c, {}).get("capital_1d_yi"), (int, float)) for c in CURVE1_CODES)

    first_curve = [_stock_row(c, CURVE1_NAMES[c], "第一曲线-算力", curr, sc, vault) for c in CURVE1_CODES]
    pcb = [_stock_row(c, PCB5_NAMES[c], "第二曲线-PCB/CCL", curr, sc, vault) for c in PCB5_CODES]

    # 持仓风险位（盈亏按成本×现价实时算；"成本损失警戒线"不是机械止损线）
    # 纪律：亏损百分比不是市场状态，不机械卖出；真正触发减仓的是 TPO+个股趋势+相对强度+组合相关性
    portfolio = []
    for p in payload.get("positions", []):
        price = p.get("price")
        cost = p.get("cost")
        live_pnl = None
        if isinstance(price, (int, float)) and isinstance(cost, (int, float)) and cost > 0:
            live_pnl = round((price / cost - 1) * 100, 2)
        rec_pnl = p.get("pnl_pct")
        pnl = live_pnl if live_pnl is not None else rec_pnl
        pos_str = str(p.get("position_pct") or "")
        pos_val = float(pos_str.replace("%", "")) if "%" in pos_str else p.get("position_pct")
        flags, action = [], ""
        name = p["name"]
        if isinstance(pnl, (int, float)):
            # 兆易：仓位极小，不因深亏机械交易
            if name == "兆易创新":
                if pnl <= -30:
                    flags.append("⚠️成本损失警戒(%.1f%%)但仓位仅%s，风险贡献有限" % (pnl, p.get("position_pct")))
                    action = "不因深亏机械卖；小仓位不制造无谓交易"
            # 澜起：弱势+空头排列，190失守且RS/资金恶化才降到~5%
            elif name == "澜起科技":
                if pnl <= -25:
                    flags.append("⚠️成本损失警戒(%.1f%%)+空头排列+10D RS为负" % pnl)
                    action = "不因刚破-25%明天机械砍；190附近失守且RS/资金继续恶化→降至约5%；否则观察"
                elif pnl <= -23:
                    flags.append("🟠接近警戒区(%.1f%%)" % pnl)
            # 海光：21.2%大仓位=组合第一结构性风险，230为观察位
            elif name == "海光信息":
                if pnl <= -24:
                    flags.append("🔴第一风险观察资产：仓位%.1f%%×亏损%.1f%%×5D RS弱" % (pos_val or 0, pnl))
                    action = "235观察；<230进入减仓讨论；<230+RS恶化+AI硬件走弱=主动释放风险；245-250+量价改善=风险解除"
                elif pnl <= -23:
                    flags.append("🟠接近230观察位(%.1f%%)" % pnl)
            else:
                if pnl <= -30:
                    flags.append("⚠️成本损失警戒(%.1f%%)" % pnl)
        portfolio.append({"code": p["code"], "name": name,
                          "position_pct": p.get("position_pct"),
                          "pnl_pct": pnl, "pnl_recorded_pct": rec_pnl,
                          "cost": cost, "price": price, "flags": flags, "action": action})

    g2 = sc.get("gate2", {})
    # 生益电子 R1.5-S 二次启动三条件
    r15s = compute_r15s_shengyi(curr)
    # 反迁移指标（Reverse Migration Score）：PCB上涨是"自己强"还是"光模块休息一天"
    rms = {
        "pcb_rs5_rising": None,  # 需连续数据，9/10起判
        "pcb_turnover_share_rising": None,
        "pcb_capital_rising": None,
        "pcb_leader_sync": g2.get("leader_diffusion_ge2"),
        "verdict": "待9/10起连续数据判定",
        "true_migration_rule": "PCB RS5↑ + 成交额占比↑ + 资金↑ + 核心股同步(非单龙头)，四项同向=真迁移",
        "fake_migration_rule": "PCB涨但成交额占比→/↓、资金→/↓、仅沪电单龙头=强势轮动/反弹，非迁移",
        "note": "0.498成交额比是水平值不是趋势证据；等斜率（连续5日升），不看绝对值",
    }
    packet = {
        "packet_id": "AI_INFRA_PM_%s" % date_str.replace("-", ""),
        "type": "pm_close_review",
        "date": date_str,
        "day_index": day_index,
        "generated_at": dt.datetime.now().isoformat(timespec="seconds"),
        "system": "AI产业链轮动监测系统 V1.1",
        "principle": "不预测涨跌，只识别盈利→资金→相对强度→成交定价权的迁移；不因故事买入，只因Gate逐级通过加仓；不因恐慌卖出，只因TPO逐级确认减仓。机器算数据，人做最终决策。",
        "data_source": {"primary": "东方财富push2(价格/当日主力f62)+腾讯前复权日K(5D/10D/成交额)",
                        "capital_flow": "available(盘中至16:00前)" if has_cap else "unavailable_after_close(盘后f62已清空;5D资金自9/10起由每日归档累加)"},
        "market_state": state,
        "state_precise": "扩散→迁移前置观察期：PCB已获10D相对定价权，尚未获5D短期资金定价权",
        "benchmark": {"curve1_5d_pct": sc.get("base_5d"), "curve1_10d_pct": sc.get("base_10d"),
                      "note": "第一曲线7只等权(中际/新易盛/海光/澜起/北方华创/中微/兆易)为RS基准"},
        "macro": {"nasdaq": None, "sox": None, "nvda": None, "us10y": None, "ashare_tech_turnover": None,
                  "note": "宏观5项V1.0阶段2接入(9/12-14)"},
        "first_curve": first_curve,
        "pcb": pcb,
        "radar_pools": payload.get("radar_pools"),
        "cooling": {"note": "液冷4只(英维克/同飞/高澜/申菱)V1.0阶段3接入", "stage": "R0.5-R1"},
        "power": {"note": "电源4只(科士达/麦格米特/科华/欧陆通)V1.0阶段3接入", "stage": "R0.5"},
        "migration": {
            "curve1_amount_yi": sc.get("curve1_amount_yi"),
            "pcb_amount_yi": sc.get("pcb_amount_yi"),
            "pcb_curve1_amount_ratio": sc.get("pcb_curve1_amount_ratio"),
            "opt_rs5_avg": sc.get("opt_rs5_avg"), "pcb_rs5_avg": sc.get("pcb_rs5_avg"),
            "pcb_opt_rs5_diff": rs5_diff,
            "opt_rs10_avg": sc.get("opt_rs10_avg"), "pcb_rs10_avg": sc.get("pcb_rs10_avg"),
            "pcb_opt_rs10_diff": sc.get("pcb_opt_rs10_diff"),
            "pricing_power_3layer": {
                "L1_relative_10d": "已出现：PCB 10D RS +10.50 vs 光模块 +6.83，差+3.67（价格/相对定价权）",
                "L2_shortterm_5d": "未获得：PCB 5D RS +4.43 vs 光模块 +8.01，差-3.58（短期资金定价权仍在第一曲线）",
                "L3_turnover": "未确认：成交额比0.498是水平值非斜率；待连续5日上升确认成交定价权",
            },
            "healthy_migration": "健康迁移不是光模块暴跌，而是光模块边际减弱(+1/0/-1/-1)同时PCB持续增强(+2/+3/+2/+4)；光模块崩盘反而是市场整体风险",
            "interpretation": "PCB已经获得10D相对定价权，但尚未获得5D短期资金定价权；当前属扩散→迁移前置观察阶段，不是接棒。老主线仍在跑，新主线已提前积累中周期相对强度。",
        },
        "reverse_migration": rms,
        "gate2": {"5d_rs_all_pos": g2.get("5d_rs_all_pos"), "10d_rs_all_pos": g2.get("10d_rs_all_pos"),
                  "5d_rs_breadth": g2.get("5d_rs_breadth"), "10d_rs_breadth": g2.get("10d_rs_breadth"),
                  "breadth_note": "V1.0用100%硬规则；5日后回测是否放宽至≥80%核心股RS>0",
                  "amount_ratio_5d_up": None, "leader_diffusion_ge2": g2.get("leader_diffusion_ge2"),
                  "up_quality": "🟡偏正但不PASS：今日收盘结构不坏(深南+0.21/沪电+2.12/生益+1.56，非冲高回落)，但未同时出现放量上涨+核心同步+尾盘强收",
                  "score": "%d/5" % g2_score, "passed": g2_score >= 4,
                  "r_stage": "R1.5" if g2_score < 4 else "R2",
                  "three_key_confirm": [
                      "①5D RS差反转：当前-3.58，需经-1.5/-0.5/+0.5/+2转正",
                      "②成交额比持续提高：当前0.498，需连续5日斜率向上(0.50→0.53→0.56→0.60→0.64)",
                      "③光模块边际减弱而非暴跌：第一曲线+1/0/-1/-1同时PCB+2/+3/+2/+4=健康迁移",
                  ],
                  "action": ("今日不动钱。Gate2未跃迁(R1.5→R2)就不动钱；跃迁后按‘弱资产释放→最强确认器’执行。"
                             "第一释放源=澜起(8.5%弱资产)，第二=海光(破230确认弱势)；第一买入=深南(中军5D/10D双强)，第二=生益电子(二次启动器，待三条件)。"
                             "沪电~4%哨兵仓不动。") if g2_score < 4 else "Gate2≥4/5：可R2-A 2%试探仓；首选深南，资金从澜起释放"},
        "r15s_shengyi": r15s,
        "stage_table": {"光模块": "R0-R1第一曲线仍强", "PCB": "R1.5最值得观察", "CCL": "R1正在强化",
                        "液冷": "R0.5-R1暂不抢跑", "电源": "R0.5暂不抢跑",
                        "AI整体": "扩散期(尚未迁移)", "Migration": "未触发(等5D RS+资金)", "TPO": "暂无系统性撤退(不降总仓)"},
        "tpo": {"signals_fired": [], "count": 0, "level": "0正常",
                "note": "TPO-1..7独立于Gate,阶段4完整接入;今日无系统性撤退信号，不需主动降总仓"},
        "portfolio": portfolio,
        "portfolio_principle": "‘成本损失警戒线’不是机械止损线：亏损百分比不是市场状态。-30%但逻辑增强/EPS上修/RS转强/资金回流→不机械卖；只亏5%但主线退潮/RS崩/资金流出/基本面恶化→必须卖。执行减仓靠TPO+个股趋势+相对强度+组合相关性。",
        "alerts": payload.get("risk_alerts", []),
        "questions_for_analyst": [
            "状态判定为【扩散→迁移前置观察】是否认同？三层定价权：10D相对已得/5D短期未得/成交待斜率。",
            "Gate2为%s未跃迁，三项关键确认(5D RS差转正/成交额比斜率/光模块边际减弱)还缺哪些？" % ("%d/5" % g2_score),
            "按反迁移规则：若明日PCB涨5%但成交额比下降、RS5仍负、仅沪电涨，应判真迁移还是强势轮动？",
            "持仓三只警戒线标的：澜起(190位)、海光(230位,21.2%大仓)、兆易(2.6%小仓)各自如何按‘非机械止损’处理？",
            "生益电子R1.5-S今日%s(①收复阴线一半 ②放量 ③主力转正盘后不可得)，是否仍为观察器非确认器？" % r15s.get("note", ""),
            "第一笔动钱的释放源(澜起/海光)与买入标的(深南/生益)顺序是否合理？",
        ],
    }
    return packet


def write_share_packet(vault, date_str, packet):
    """输出可分享数据包：JSON(机器)+MD(人类/外部AI)+latest软链"""
    d = vault / SHARE_DIR
    ensure_dir(d)
    stamp = date_str.replace("-", "")
    jf = d / ("AI_INFRA_PM_%s.json" % stamp)
    jf.write_text(json.dumps(packet, ensure_ascii=False, indent=2), encoding="utf-8")

    md = _render_packet_md(packet)
    mf = d / ("AI_INFRA_PM_%s.md" % stamp)
    mf.write_text(md, encoding="utf-8")
    # latest 软链
    for target, linkname in ((jf.name, "latest_PM.json"), (mf.name, "latest_PM.md")):
        link = d / linkname
        if link.is_symlink() or link.exists():
            link.unlink()
        try:
            link.symlink_to(target)
        except Exception:
            pass
    return jf, mf


def _f(v, fmt="%+.2f"):
    return (fmt % v) if isinstance(v, (int, float)) else "—"


def _render_packet_md(p):
    L = []
    L.append("# 📡 AI主线 · 盘后数据包 %s（%s）" % (p["date"], p["day_index"]))
    L.append("")
    L.append("> **系统**：%s" % p["system"])
    L.append("> **原则**：%s" % p["principle"])
    L.append("> **数据源**：%s ｜ 资金流：%s" % (p["data_source"]["primary"], p["data_source"]["capital_flow"]))
    L.append("")
    L.append("## 一句话状态")
    L.append("")
    L.append("- **市场状态：%s**" % p["market_state"])
    L.append("- **精确表述：%s**" % p.get("state_precise", ""))
    L.append("- **PCB阶段：%s ｜ Gate2：%s（%s）**" % (p["gate2"]["r_stage"], p["gate2"]["score"], "通过" if p["gate2"]["passed"] else "未跃迁R2"))
    L.append("- **操作结论：今日不动钱**（Gate2未跃迁）" if not p["gate2"]["passed"] else "- **操作结论：Gate2通过，可R2-A**")
    L.append("")
    L.append("> 基准：第一曲线7只等权 5D **%s%%** / 10D **%s%%**" % (_f(p["benchmark"]["curve1_5d_pct"], "%.2f"), _f(p["benchmark"]["curve1_10d_pct"], "%.2f")))
    L.append("")
    # 第一曲线
    L.append("## 一、第一曲线（AI算力）")
    L.append("")
    L.append("| 股票 | 收盘 | 日% | 5D% | 10D% | 5D RS | 10D RS | 成交额(亿) | 主力1D | 5D主力 | 趋势 |")
    L.append("|------|------|-----|-----|------|-------|--------|-----------|--------|--------|------|")
    for r in p["first_curve"]:
        L.append("| %s | %s | %s | %s | %s | %s | %s | %s | %s | %s | %s |" % (
            r["name"], r["price"] or "—", _f(r["daily_pct"]), _f(r["pct_5d"], "%.2f"), _f(r["pct_10d"], "%.2f"),
            _f(r["rs5"]), _f(r["rs10"]), _f(r["amount_yi"], "%.1f"),
            _f(r["capital_1d_yi"], "%.2f"), _f(r["capital_5d_yi"], "%.2f"), r["trend"] or "—"))
    L.append("")
    # PCB
    L.append("## 二、第二曲线 · PCB/CCL 五人组")
    L.append("")
    L.append("| 股票 | 角色 | 收盘 | 日% | 5D% | 10D% | 5D RS | 10D RS | 成交额(亿) | 主力1D |")
    L.append("|------|------|------|-----|-----|------|-------|--------|-----------|--------|")
    roles = {"沪电股份": "哨兵(不加仓)", "深南电路": "中军", "生益电子": "R1.5-S二次启动器",
             "胜宏科技": "估值压力测试器", "生益科技": "CCL温度计"}
    for r in p["pcb"]:
        L.append("| %s | %s | %s | %s | %s | %s | %s | %s | %s | %s |" % (
            r["name"], roles.get(r["name"], ""), r["price"] or "—", _f(r["daily_pct"]),
            _f(r["pct_5d"], "%.2f"), _f(r["pct_10d"], "%.2f"),
            _f(r["rs5"]), _f(r["rs10"]), _f(r["amount_yi"], "%.1f"), _f(r["capital_1d_yi"], "%.2f")))
    L.append("")
    # 迁移
    m = p["migration"]
    L.append("## 三、迁移指标（第一曲线 vs 第二曲线）")
    L.append("")
    L.append("| 指标 | 值 | 含义 |")
    L.append("|------|----|------|")
    L.append("| 第一曲线成交额 | %s 亿 | 7只合计 |" % _f(m["curve1_amount_yi"], "%.1f"))
    L.append("| PCB五人组成交额 | %s 亿 | |" % _f(m["pcb_amount_yi"], "%.1f"))
    L.append("| PCB/第一曲线 成交额比 | %s | PCB资金厚度 |" % _f(m["pcb_curve1_amount_ratio"], "%.3f"))
    L.append("| 光模块 5D RS 均值 | %s | 第一曲线短期强度 |" % _f(m["opt_rs5_avg"]))
    L.append("| PCB 5D RS 均值 | %s | |" % _f(m["pcb_rs5_avg"]))
    L.append("| **PCB-光模块 5D RS差** | **%s** | 负=第一曲线短期仍领涨 |" % _f(m["pcb_opt_rs5_diff"]))
    L.append("| 光模块 10D RS 均值 | %s | |" % _f(m["opt_rs10_avg"]))
    L.append("| PCB 10D RS 均值 | %s | |" % _f(m["pcb_rs10_avg"]))
    L.append("| **PCB-光模块 10D RS差** | **%s** | 正=PCB 10日相对强 |" % _f(m["pcb_opt_rs10_diff"]))
    L.append("")
    L.append("> **判读**：%s" % m["interpretation"])
    L.append("")
    L.append("**三层定价权（关键：不能把10D反超写成既成事实）**")
    L.append("")
    L.append("| 层级 | 状态 | 证据 |")
    L.append("|------|------|------|")
    pp = m.get("pricing_power_3layer", {})
    L.append("| L1 价格/相对定价权(10D) | ✅ 已出现 | %s |" % pp.get("L1_relative_10d", ""))
    L.append("| L2 短期资金定价权(5D) | ❌ 未获得 | %s |" % pp.get("L2_shortterm_5d", ""))
    L.append("| L3 成交定价权(斜率) | ⏳ 未确认 | %s |" % pp.get("L3_turnover", ""))
    L.append("")
    L.append("> **健康迁移定义**：%s" % m.get("healthy_migration", ""))
    L.append("")
    # 反迁移指标
    rm = p.get("reverse_migration", {})
    L.append("## 三·补、反迁移指标（Reverse Migration Score）")
    L.append("")
    L.append("> 判断 PCB 上涨是「自己真强」还是「光模块休息一天」。%s" % rm.get("verdict", ""))
    L.append("")
    L.append("| 指标 | 真迁移 | 假迁移（强势轮动） | 今日 |")
    L.append("|------|--------|------------------|------|")
    L.append("| PCB RS5 | ↑ | ↑ | ⏳待连续 |")
    L.append("| PCB成交额占比 | ↑（斜率） | →/↓（只看绝对值无意义） | ⏳待连续 |")
    L.append("| PCB资金 | ↑ | →/↓ | ⏳9/10起 |")
    L.append("| PCB核心股同步 | 多龙头 | 仅沪电单龙头 | %s |" % ("✅" if rm.get("pcb_leader_sync") else "❌"))
    L.append("")
    L.append("> 规则：%s ｜ 反例：%s" % (rm.get("true_migration_rule", ""), rm.get("fake_migration_rule", "")))
    L.append("")
    # Gate2
    g = p["gate2"]
    L.append("## 四、Gate2 资金门（5项≥4 → R2跃迁）")
    L.append("")
    L.append("| 指标 | 状态 | 广度 |")
    L.append("|------|------|------|")
    L.append("| ① 5D RS 全部>0 | %s | %s |" % ("✅" if g["5d_rs_all_pos"] else "❌", g.get("5d_rs_breadth", "")))
    L.append("| ② 10D RS 全部>0 | %s | %s |" % ("✅" if g["10d_rs_all_pos"] else "❌", g.get("10d_rs_breadth", "")))
    L.append("| ③ 成交额占比连续5日升 | ⏳ 待9/10-9/16斜率 | 0.498是水平值 |")
    L.append("| ④ 龙头扩散≥2只 | %s | 沪电/深南/生益 |" % ("✅" if g["leader_diffusion_ge2"] else "❌"))
    L.append("| ⑤ 上涨质量 | %s | 偏正不PASS |" % "🟡")
    L.append("| **合计** | **%s（%s）** | ①②V1.0用100%%，5日后回测80%% |" % (g["score"], "通过可R2" if g["passed"] else "未跃迁"))
    L.append("")
    L.append("**Gate2跃迁还差三项关键确认**：")
    for c in g.get("three_key_confirm", []):
        L.append("- %s" % c)
    L.append("")
    L.append("**动作**：%s" % g["action"])
    L.append("")
    # 组合
    L.append("## 五、持仓风险位（300万组合）")
    L.append("")
    L.append("| 股票 | 仓位% | 浮动盈亏% | 收盘价 | 成本损失警戒线 / 处理 |")
    L.append("|------|-------|----------|--------|----------------------|")
    for r in p["portfolio"]:
        msg = "；".join(r["flags"]) if r["flags"] else "—"
        if r.get("action"):
            msg += ("　→ " + r["action"]) if msg != "—" else ("→ " + r["action"])
        L.append("| %s | %s | %s | %s | %s |" % (
            r["name"], r["position_pct"] if r["position_pct"] is not None else "—",
            _f(r["pnl_pct"]), r["price"] or "—", msg))
    L.append("")
    L.append("> **成本损失警戒线≠机械止损线**：%s" % p.get("portfolio_principle", ""))
    L.append(">")
    L.append("> 盈亏按成本价×现价实时计算；单股超20%需确定性；TPO 3/4恶化强制降总仓≤60%。")
    L.append("")
    # 生益电子 R1.5-S
    rs = p.get("r15s_shengyi", {})
    if rs:
        L.append("## 五·补、生益电子 R1.5-S 二次启动确认器（%s）" % rs.get("note", ""))
        L.append("")
        cond = rs.get("conditions", {})
        c1, c2, c3 = cond.get("recover_half", {}), cond.get("volume_up", {}), cond.get("capital_positive", {})
        def mark(v):
            return "✅" if v is True else ("❌" if v is False else "⏳盘后不可得")
        L.append("| 条件 | 状态 | 数据 |")
        L.append("|------|------|------|")
        L.append("| ①收复9/8阴线实体一半 | %s | 9/8开%s/收%s，中点%s；今日收%s |" % (
            mark(c1.get("pass")), c1.get("prev_open"), c1.get("prev_close"), c1.get("midpoint"), c1.get("today_close")))
        L.append("| ②放量(量>9/8) | %s | 量比%s（9/9 %s vs 9/8 %s 手） |" % (
            mark(c2.get("pass")), c2.get("vol_ratio"), c2.get("today_vol"), c2.get("prev_vol")))
        L.append("| ③主力资金转正 | %s | f62盘后清空，不臆测（9/8净流出2.31亿为外部口径） |" % mark(c3.get("pass")))
        L.append("")
        L.append("> 结论：%s。10D RS +22.15极强，但缩量上涨+资金未确认，继续作**观察器非确认器**；未来若突破+成交额>9/8+主力转正+RS5转强→优先级升为第一买入候选。" % rs.get("note", ""))
        L.append("")
    # 状态表
    L.append("## 六、各方向状态表")
    L.append("")
    L.append("| 方向 | 状态 |")
    L.append("|------|------|")
    for k, v in p.get("stage_table", {}).items():
        L.append("| %s | %s |" % (k, v))
    L.append("")
    L.append("**动钱纪律（状态跃迁驱动）**：不再讨论「今天该不该买PCB」。每天只检查 R1.5→R2→R2.5→R3 有没有跃迁；没跃迁不动钱；跃迁了按「弱资产释放→买最强确认器」：第一释放源澜起、第二海光(破230)；第一买入深南(中军)、第二生益(二次启动)；沪电~4%哨兵仓不动。")
    L.append("")
    # 待接入
    L.append("## 七、暂未接入（V1.0 后续阶段）")
    L.append("")
    L.append("- **宏观5项**（Nasdaq/SOX/NVDA/美债10Y/A股科技成交额）：%s" % p["macro"]["note"])
    L.append("- **液冷**：%s，当前%s" % (p["cooling"]["note"], p["cooling"]["stage"]))
    L.append("- **电源**：%s，当前%s" % (p["power"]["note"], p["power"]["stage"]))
    L.append("- **TPO 1-7 计分**：%s" % p["tpo"]["note"])
    L.append("")
    # 给外部AI
    L.append("## 八、请外部分析助手（ChatGPT/Claude/豆包）回答")
    L.append("")
    for i, q in enumerate(p["questions_for_analyst"], 1):
        L.append("%d. %s" % (i, q))
    L.append("")
    L.append("> 框架背景：五状态=集中/扩散/迁移/再集中/退潮；三层定价权=10D相对/5D短期/成交斜率；Gate1产业→Gate2资金(5项≥4)→Gate3迁移；R0/R1/R1.5/R2/R2.5/R3；TPO独立计0-4分；成本损失警戒线≠机械止损。Day0基准，9/10起连续5日观察。")
    L.append("")
    return "\n".join(L)


def render_capital_block(curr, stocks_meta, radar_map=None):
    """生成首页资金流对照区块（标记之间内容）"""
    radar_map = radar_map or {}
    hw = [s for s in stocks_meta if "第一幕" in str(s.get("main_line", ""))]
    sw = [s for s in stocks_meta if "第二幕" in str(s.get("main_line", ""))]
    out = [CAP_BEGIN, "", "## 🔀 资金流对照 · 第一幕 vs 第二幕", "",
           "> 自动更新于 %s · 数据源：东方财富/腾讯K线（自动）" % dt.datetime.now().strftime("%Y-%m-%d %H:%M"), "",
           "| 分组 | 股票 | 收盘 | 日涨跌 | 当日主力 | 5日主力 | 趋势 | 判读 |",
           "|------|------|------|--------|---------|---------|------|------|"]
    for tag, lst in (("硬件第一幕", hw), ("软件第二幕", sw)):
        for s in lst:
            c = curr.get(s["code"], {})
            if not c.get("price"):
                out.append("| %s | [[%s]] | — | — | — | — | %s | 数据缺失 |" % (tag, s["name"], c.get("trend", "—")))
                continue
            c1, c5 = c.get("capital_1d_yi"), c.get("capital_5d_yi")
            pct = c["pct_change_daily"] or 0
            note = "强 💪" if pct >= 3 else ("弱 ⚠️" if pct <= -3 else "稳定")
            rd = radar_map.get(s["code"]) or {}
            if rd.get("icon") in ("🟢", "🟠", "🔴"):
                note += " · " + rd["icon"] + rd["verdict"]
            fmt = lambda v: ("%.2f亿 %s" % (v, "🟢" if v > 0 else "🔴")) if isinstance(v, (int, float)) else "—"
            out.append("| %s | [[%s]] | %.2f | %+.2f%% | %s | %s | %s | %s |" % (
                tag, s["name"], c["price"], pct, fmt(c1), fmt(c5), c["trend"], note))
    hw5 = [curr[s["code"]].get("capital_5d_yi") for s in hw if isinstance(curr.get(s["code"], {}).get("capital_5d_yi"), (int, float))]
    sw5 = [curr[s["code"]].get("capital_5d_yi") for s in sw if isinstance(curr.get(s["code"], {}).get("capital_5d_yi"), (int, float))]
    if not hw5 and not sw5:
        judge = "资金流数据未取到（数据源限流，下次运行自动补齐）"
    else:
        judge = ("出现初步迁移迹象，需持续" if sw5 and sum(sw5) > 0 else "资金仍在第一幕，迁移未确认")
    def fmt_cnt(lst):
        return "%d/%d" % (sum(1 for v in lst if v > 0), len(lst)) if lst else "n/a"
    out += ["", "**迁移初判**：硬件5日主力正向 %s vs 软件 %s → %s" % (
        fmt_cnt(hw5), fmt_cnt(sw5), judge), "", CAP_END]
    return "\n".join(out)


def _compute_d_level(code, curr, sc, stocks=None):
    """计算单只票的D级（D0-D4），返回灯标+D级+一句话结论"""
    d = curr.get(code, {})
    trend = d.get("trend", "")
    cap1d = d.get("capital_1d_yi")
    pct = d.get("pct_change_daily", 0)
    price = d.get("price")
    rs5 = sc.get("rs5_%s" % code)
    # 从档案取持仓信息
    pos_pct = "0%"
    pnl_pct = 0
    if stocks:
        for s in stocks:
            if s.get("code") == code:
                pos_pct = s.get("holding_position", "0%")
                pnl_pct = s.get("holding_pnl_pct", 0)
                break
    # 海光关键位230、澜起190、兆易400
    key_levels = {"688041": 230, "688008": 190, "603986": 400}
    key_breached = False
    gap_note = ""
    if code in key_levels and price is not None:
        gap = price - key_levels[code]
        if gap < 0:
            key_breached = True
        gap_pct = round(gap / price * 100, 1)
        gap_note = "距%d%.1f%%" % (key_levels[code], abs(gap_pct))
    # 异常计数
    abn = 0
    if trend == "空头排列": abn += 1
    if isinstance(cap1d, (int, float)) and cap1d < -3: abn += 1  # 大单流出
    if isinstance(rs5, (int, float)) and rs5 < -3: abn += 1
    if key_breached: abn += 1
    # D级判定
    if abn == 0:
        level, light = "D0", "🟢"
    elif abn == 1:
        level, light = "D1", "🟡"
    elif abn == 2:
        level, light = "D2", "🟠"
    elif abn >= 3:
        level, light = "D3", "🔴"
    # 一句话结论
    name = CURVE1_NAMES.get(code, PCB5_NAMES.get(code, code))
    bits = []
    if trend == "空头排列": bits.append("空头")
    elif trend == "多头排列": bits.append("多头")
    if isinstance(cap1d, (int, float)):
        if cap1d > 10: bits.append("资金流入%.1f亿" % cap1d)
        elif cap1d < -3: bits.append("资金流出%.1f亿" % abs(cap1d))
    if isinstance(rs5, (int, float)):
        bits.append("RS5%+.2f" % rs5)
    if gap_note: bits.append(gap_note)
    note = " · ".join(bits) if bits else "正常"
    return light, level, note


# ========== 状态机 A/B/C/D + 3张卡决策引擎 ==========

def _compute_stock_state(code, curr, sc, stocks=None):
    """计算单只票的状态和动作（A强化/B钝化/C弱化/D危险）
    返回 (state_emoji, state_text, action, reason)

    状态机：
    - 🟢 强化：RS5>0 + 非空头排列
    - 🟡 钝化：RS5≈0 或 空头排列但RS5>-3
    - 🟠 弱化：RS5<-3 + 空头排列
    - 🔴 危险：关键位破 + 大仓位

    动作映射：
    - 强化+小仓位+Gate2≥4/5 → 等待加仓
    - 强化+大仓位 → 持有
    - 钝化 → 暂不动作
    - 弱化+大仓位(≥10%) → 减仓
    - 弱化+小仓位(<3%) → 持有（不机械处理）
    - 危险+大仓位 → 减至~15%
    - 危险+关键位破 → 清仓
    """
    d = curr.get(code, {})
    trend = d.get("trend", "")
    rs5 = sc.get("rs5_%s" % code)
    price = d.get("price")

    # 持仓
    pos_pct = "0%"
    if stocks:
        for s in stocks:
            if s.get("code") == code:
                pos_pct = s.get("holding_position", "0%")
                break
    try:
        pos_val = float(pos_pct.replace("%", ""))
    except (ValueError, AttributeError):
        pos_val = 0

    # 关键位
    key_levels = {"688041": 230, "688008": 190, "603986": 400}
    key_breached = False
    gap_note = ""
    if code in key_levels and price is not None:
        gap = price - key_levels[code]
        if gap < 0:
            key_breached = True
        gap_pct = round(gap / price * 100, 1) if price else 0
        gap_note = "距%d %.1f%%" % (key_levels[code], gap_pct)

    rs5v = rs5 if isinstance(rs5, (int, float)) else 0

    # 状态判定
    if key_breached and pos_val >= 10:
        state_emoji, state_text = "🔴", "危险"
    elif isinstance(rs5, (int, float)) and rs5 < -3 and trend == "空头排列":
        state_emoji, state_text = "🟠", "弱化"
    elif isinstance(rs5, (int, float)) and rs5 > 0 and trend != "空头排列":
        state_emoji, state_text = "🟢", "强化"
    else:
        state_emoji, state_text = "🟡", "钝化"

    # 动作判定
    # 1) 哨兵仓（沪电4%左右）
    if code == "002463" and pos_val <= 5:
        action, reason = "持有", "哨兵仓·第二曲线观察"
    # 2) 小仓位不机械处理
    elif pos_val < 3 and state_text == "弱化":
        action, reason = "持有", "仓位%.1f%%太小·不机械处理" % pos_val
    # 3) 危险+大仓位 → 减仓
    elif state_text == "危险" and pos_val >= 10:
        action, reason = "减至~15%", "%s×RS5%+.2f×%s" % (pos_pct, rs5v, gap_note)
    # 4) 危险+关键位破 → 清仓
    elif state_text == "危险" and key_breached:
        action, reason = "清仓", "关键位破·纪律退出"
    # 5) 弱化+大仓位 → 减仓
    elif state_text == "弱化" and pos_val >= 10:
        action, reason = "减仓", "仓位%.1f%%×RS5%+.2f×空头" % (pos_val, rs5v)
    # 6) 弱化+小仓位 → 观察
    elif state_text == "弱化":
        action, reason = "观察", "空头·RS5%+.2f" % rs5v
    # 7) 钝化 → 观察
    elif state_text == "钝化":
        if gap_note:
            action, reason = "暂不动作", "RS5%+.2f·%s" % (rs5v, gap_note)
        else:
            action, reason = "暂不动作", "RS5%+.2f" % rs5v
    # 8) 强化+小仓位 → 等待加仓（需Gate2）
    elif state_text == "强化" and pos_val < 10:
        g2 = sc.get("gate2", {})
        g2_score = sum(1 for k in ["5d_rs_all_pos", "10d_rs_all_pos", "leader_diffusion_ge2"] if g2.get(k))
        if g2_score >= 4:
            action, reason = "等待加仓", "强化·RS5%+.2f·Gate2 %d/5" % (rs5v, g2_score)
        else:
            action, reason = "持有", "强化·RS5%+.2f·Gate2 %d/5未通过" % (rs5v, g2_score)
    # 9) 强化+大仓位 → 持有
    else:
        action, reason = "持有", "强化·RS5%+.2f·龙头" % rs5v

    # 海光特殊规则（大仓位 + 接近230 + 弱化）
    if code == "688041" and pos_val >= 15 and price is not None and price < 235:
        if state_text in ("弱化", "危险") or (isinstance(rs5, (int, float)) and rs5 < -3):
            action = "减至~15%"
            gap_to_230 = abs((price - 230) / price * 100)
            reason = "%.1f%%仓位×RS5%+.2f×距230仅%.1f%%" % (pos_val, rs5v, gap_to_230)

    return state_emoji, state_text, action, reason


def _compute_mainline_state(curr, sc, radar=None):
    """计算各主线状态，返回 [(name, emoji, evidence), ...]"""
    # AI主线：第一曲线整体
    rs5_curve1 = [sc.get("rs5_%s" % c) for c in CURVE1_CODES if sc.get("rs5_%s" % c) is not None]
    rs5_pos = sum(1 for v in rs5_curve1 if v > 0) if rs5_curve1 else 0
    total = len(rs5_curve1) if rs5_curve1 else len(CURVE1_CODES)
    if rs5_pos >= 4:
        ai_emoji, ai_ev = "🟢", "%d/%d RS5正·主线强" % (rs5_pos, total)
    elif rs5_pos >= 2:
        ai_emoji, ai_ev = "🟡", "%d/%d RS5正·分化" % (rs5_pos, total)
    else:
        ai_emoji, ai_ev = "🟠", "%d/%d RS5正·弱化" % (rs5_pos, total)

    # 光模块：中际+新易盛
    opt_rs5 = [v for v in [sc.get("rs5_300308"), sc.get("rs5_300502")] if v is not None]
    opt_avg = sum(opt_rs5) / len(opt_rs5) if opt_rs5 else 0
    if opt_avg > 5:
        opt_emoji, opt_ev = "🟢", "5D RS均%+.2f·强" % opt_avg
    elif opt_avg > 0:
        opt_emoji, opt_ev = "🟢", "5D RS均%+.2f" % opt_avg
    else:
        opt_emoji, opt_ev = "🟠", "5D RS均%+.2f·弱" % opt_avg

    # PCB：优先用迁移雷达对AI硬件基准的RS差（迁移框架口径），兜底旧Gate字段
    pcb_ent = next((e for e in (radar or {}).get("entities", []) if e.get("key") == "pcb"), None)
    if pcb_ent and pcb_ent.get("rs20") is not None:
        rs10_diff, rs5_diff = pcb_ent["rs20"], pcb_ent["rs5"]
    else:
        rs10_diff, rs5_diff = sc.get("pcb_opt_rs10_diff"), sc.get("pcb_opt_rs5_diff")
    if rs10_diff is not None and rs10_diff > 0 and rs5_diff is not None and rs5_diff > 0:
        pcb_emoji, pcb_ev = "🟢", "20D %+.2f·5D %+.2f 对AI硬件双强" % (rs10_diff, rs5_diff)
    elif rs10_diff is not None and rs10_diff > 0:
        pcb_emoji = "🟡"
        pcb_ev = "20D %+.2f获相对·5D %s未同步" % (
            rs10_diff, ("%+.2f" % rs5_diff) if rs5_diff is not None else "待算")
    else:
        pcb_emoji = "🟠"
        pcb_ev = "20D %s·5D %s" % (("%.2f" % rs10_diff) if rs10_diff is not None else "待算",
                                    ("%.2f" % rs5_diff) if rs5_diff is not None else "待算")

    # 半导体设备：北方华创+中微+海光
    semi_codes = ["002371", "688012", "688041"]
    semi_trends = [curr.get(c, {}).get("trend") for c in semi_codes]
    bear_count = sum(1 for t in semi_trends if t == "空头排列")
    if bear_count >= 2:
        semi_emoji, semi_ev = "🟠", "%d/3空头排列" % bear_count
    elif bear_count >= 1:
        semi_emoji, semi_ev = "🟡", "%d/3空头排列" % bear_count
    else:
        semi_emoji, semi_ev = "🟢", "稳定"

    # 候选新主线：必须通过双向裁决（成形≠候选，避免把'跑赢大跌'误读为迁移）
    pools = (radar or {}).get("pools", [])
    cand = [p for p in pools if p.get("migration_candidate")]
    forming = [p for p in pools if p.get("state") in ("成形", "强化")]
    if cand:
        cand_row = ("候选新主线", "🟡",
                    "迁移候选：%s（待Gate确认）" % " · ".join(p["name"] for p in cand))
    elif forming:
        cand_row = ("候选新主线", "🛰️",
                    "%d个成形但旧主线未衰退/资金未确认：%s" % (
                        len(forming), " · ".join(p["name"] for p in forming)))
    else:
        cand_row = ("候选新主线", "暂无", "左侧雷达5方向均未成形")

    return [
        ("AI主线", ai_emoji, ai_ev),
        ("光模块", opt_emoji, opt_ev),
        ("PCB", pcb_emoji, pcb_ev),
        ("半导体设备", semi_emoji, semi_ev),
        ("液冷/电源", "⏳", "R0.5-R1"),
        cand_row,
    ]


def _compute_action_list(curr, sc, stocks=None):
    """生成今日优先级动作清单，返回 [(priority, action, trigger), ...]"""
    actions = []

    # 扫描所有持仓股
    held_codes = []
    for code in CURVE1_CODES + PCB5_CODES:
        pos_pct = "0%"
        if stocks:
            for s in stocks:
                if s.get("code") == code:
                    pos_pct = s.get("holding_position", "0%")
                    break
        try:
            pos_val = float(pos_pct.replace("%", ""))
        except (ValueError, AttributeError):
            pos_val = 0
        if pos_val >= 0.5:
            held_codes.append(code)

    for code in held_codes:
        state_e, state_t, action, reason = _compute_stock_state(code, curr, sc, stocks)
        name = CURVE1_NAMES.get(code, PCB5_NAMES.get(code, code))

        if action == "减至~15%":
            actions.append(("🔴 P0", "%s减至~15%%" % name, reason))
        elif action == "清仓":
            actions.append(("🔴 P0", "%s清仓" % name, reason))
        elif action == "减仓":
            actions.append(("🟠 P1", "%s减仓" % name, reason))

    # 澜起观察190
    lq = curr.get("688008", {})
    lq_price = lq.get("price")
    if lq_price is not None:
        gap_pct = (lq_price - 190) / lq_price * 100
        if abs(gap_pct) < 3:
            actions.append(("🟡 P1", "澜起观察190", "距190仅%.1f%%" % abs(gap_pct)))

    # PCB不迁仓（Gate2未通过）
    gate2 = sc.get("gate2", {})
    g2_score = sum(1 for k in ["5d_rs_all_pos", "10d_rs_all_pos", "leader_diffusion_ge2"] if gate2.get(k))
    if g2_score < 4:
        actions.append(("🟡 P3", "PCB不迁仓", "Gate2 %d/5·未获Capital Permission" % g2_score))

    # 强势股不追
    for code in OPT_CODES:
        state_e, state_t, action, reason = _compute_stock_state(code, curr, sc, stocks)
        if state_t == "强化":
            name = CURVE1_NAMES.get(code, code)
            actions.append(("🟢 P2", "%s不追" % name, "已强势反弹"))

    # 释放资金
    actions.append(("💰 释放资金", "进入现金", "不自动再投资·等Gate2≥4/5"))

    return actions


def render_home_dashboard_block(date_str, curr, sc, stocks=None, radar=None):
    """生成首页3张卡（HOME_DASHBOARD_BEGIN/END 之间）
    卡1·主线：钱往哪里走？（含左侧雷达：下一条主线在哪里形成）
    卡2·持仓：核心股变强还是变弱？
    卡3·动作：今天必须做什么？"""
    now_str = dt.datetime.now().strftime("%Y-%m-%d %H:%M")
    # === 卡1·主线：钱往哪里走？ ===
    mainlines = _compute_mainline_state(curr, sc, radar)
    gate2 = sc.get("gate2", {})
    g2_score = sum(1 for k in ["5d_rs_all_pos", "10d_rs_all_pos", "leader_diffusion_ge2"] if gate2.get(k))

    # === 卡2·持仓：核心股变强还是变弱？ ===
    # 收集所有持仓股（第一曲线7只 + PCB5中有持仓的）
    held_codes = list(CURVE1_CODES)
    for code in PCB5_CODES:
        if code in CURVE1_CODES:
            continue
        pos_pct = "0%"
        if stocks:
            for s in stocks:
                if s.get("code") == code:
                    pos_pct = s.get("holding_position", "0%")
                    break
        try:
            pos_val = float(pos_pct.replace("%", ""))
        except (ValueError, AttributeError):
            pos_val = 0
        if pos_val >= 0.5:
            held_codes.append(code)

    position_rows = []
    for code in held_codes:
        pos_pct = "0%"
        if stocks:
            for s in stocks:
                if s.get("code") == code:
                    pos_pct = s.get("holding_position", "0%")
                    break
        try:
            pos_val = float(pos_pct.replace("%", ""))
        except (ValueError, AttributeError):
            pos_val = 0
        state_e, state_t, action, reason = _compute_stock_state(code, curr, sc, stocks)
        name = CURVE1_NAMES.get(code, PCB5_NAMES.get(code, code))
        if pos_val >= 15:
            name = "**%s**" % name
            action = "**%s**" % action
        position_rows.append("| %s | %s | %s %s | %s | %s |" % (
            name, pos_pct, state_e, state_t, action, reason))

    # === 卡3·动作：今天必须做什么？ ===
    actions = _compute_action_list(curr, sc, stocks)
    risk_actions = [a for prio, a, t in actions if prio.startswith("🔴")]
    risk_card = " · ".join(risk_actions) if risk_actions else "暂无"
    # Capital Permission：双向裁决 + Gate
    cand_pools = [p for p in (radar or {}).get("pools", []) if p.get("migration_candidate")]
    if cand_pools:
        cap_card = "🟡 %s 迁移候选·待Gate确认·人做最终决定" % "、".join(p["name"] for p in cand_pools)
    elif g2_score >= 4:
        cap_card = "🟢 PCB Gate2通过·可R2小仓试探（资金从弱资产释放）"
    else:
        cap_card = "❌ 无 · Gate2 %d/5 · 释放现金持有等待" % g2_score

    # === 组装3张卡（内含5区块）===
    L = [HOME_DASHBOARD_BEGIN,
         "> 📊 **数据自动更新于 %s** · 数据源：东方财富/腾讯K线 · 下一次：交易日15:35" % now_str,
         "",
         "---",
         "",
         "## 🎯 卡1·主线 · 钱往哪里走？",
         "",
         "### ① 当前主线",
         "",
         "| 主线 | 状态 | 关键证据 |",
         "|------|------|---------|"]
    for name, emoji, ev in mainlines:
        L.append("| %s | %s | %s |" % (name, emoji, ev))
    L += ["",
          "**Gate2 %d/5 · %s**" % (
              g2_score,
              "扩散→迁移前置观察期·尚未Capital Permission" if g2_score < 4 else "Gate2通过·可R2小仓试探")]
    # ③ 主线迁移距离 + ④ 左侧雷达产业进度
    if radar and radar.get("entities"):
        L += ["",
              "### ③ 主线迁移距离 · 赚钱位置正在往哪走？",
              "",
              "> %s" % radar.get("narrative", ""),
              "",
              "| 方向 | 迁移距离 | 状态 |",
              "|------|---------|------|"]
        for e in radar["entities"]:
            dist = ("**%g**" % e["distance"]) if e["distance"] is not None else "—"
            L.append("| %s %s | %s | %s %s |" % (e["icon"], e["name"], dist, e["icon"], e["state"]))
        L += ["",
              "**双向裁决**：%s" % radar["old_line"]["verdict"],
              "（证据：%s）" % (" · ".join(radar["old_line"]["evidence"]) or "无")]
        L += ["",
              "### ④ 左侧雷达 · 产业进度（R阶段四灯·进度条不是日期）",
              "",
              "| 方向 | R阶段 | 产业 | 资金 | RS | 盈利 | 主线资格 |",
              "|------|-------|------|------|-----|------|---------|"]
        for p in radar["pools"]:
            L.append("| %s | R%s | %s | %s | %s | %s | %s |" % (
                p["name"], p["r_stage"], p["ind_light"], p["money_light"], p["rs_light"], p["earn_light"],
                "🟢成立" if p["qualified"] else "未成立"))
        L += ["",
              "> 股票只是采样点；顺序 产业→板块→环节→龙头→个股。R2送样/小批量不算盈利兑现，主线资格需R≥3+盈利+强化。",
              "> 新主线强化≠旧主线衰退；A旧弱+B新强同时成立才允许迁仓。详见 [[%s_主线迁移雷达]]。" % date_str]
    L += ["",
          "---",
          "",
          "## 📈 卡2·持仓 · 核心股变强还是变弱？",
          "",
          "| 票 | 仓位 | 状态 | 动作 | 为什么 |",
          "|----|------|------|------|--------|"]
    L += position_rows
    L += ["",
          "---",
          "",
          "## ⚡ 卡3·动作 · 今天必须做什么？",
          "",
          "### ⑤ Capital Permission",
          "",
          "| 牌 | 内容 |",
          "|----|------|",
          "| 🔴 **Risk Permission**（可卖） | %s |" % risk_card,
          "| 🟢 **Capital Permission**（可买） | %s |" % cap_card,
          "",
          "### 今日执行",
          "",
          "| 优先级 | 动作 | 触发条件 |",
          "|--------|------|---------|"]
    for p, a, t in actions:
        L.append("| %s | %s | %s |" % (p, a, t))
    L += ["",
          "**闭环**：持仓引擎(持有/加仓/减仓/TPO) + 迁移引擎(观察/成形/强化/过热/衰退/迁移候选) → Capital Permission 连接两者·每日重判",
          "",
          HOME_DASHBOARD_END]
    return "\n".join(L)


def update_home_dashboard(vault, curr, date_str, sc, stocks=None, radar=None):
    """更新首页 HOME_DASHBOARD_BEGIN/END 区块 + frontmatter last_updated"""
    home = vault / HOME_FILE
    if not home.exists():
        return False
    text = home.read_text(encoding="utf-8")
    # 1) 更新 frontmatter last_updated
    fm_new = "---\nhome: true\nlast_updated: %s\n---" % date_str
    text = re.sub(r"^---\n.*?\n---", fm_new, text, count=1, flags=re.DOTALL)
    # 2) 替换看板区块
    block = render_home_dashboard_block(date_str, curr, sc, stocks, radar)
    if HOME_DASHBOARD_BEGIN in text and HOME_DASHBOARD_END in text:
        pre = text[:text.index(HOME_DASHBOARD_BEGIN)]
        post = text[text.index(HOME_DASHBOARD_END) + len(HOME_DASHBOARD_END):]
        home.write_text(pre + block + post, encoding="utf-8")
        return True
    # 3) 无标记则追加到 frontmatter 后
    if text.startswith("---"):
        m = re.match(r"^---\n.*?\n---\n", text, re.DOTALL)
        pre = text[:m.end()] if m else text
        post = text[m.end():] if m else ""
        home.write_text(pre + "\n" + block + "\n\n" + post, encoding="utf-8")
        return True
    home.write_text(block + "\n\n" + text, encoding="utf-8")
    return True


def update_home_capital(vault, curr, stocks_meta, radar_map=None):
    home = vault / HOME_FILE
    if not home.exists():
        return False
    text = home.read_text(encoding="utf-8")
    block = render_capital_block(curr, stocks_meta, radar_map)
    if CAP_BEGIN in text and CAP_END in text:
        pre = text[:text.index(CAP_BEGIN)]
        post = text[text.index(CAP_END) + len(CAP_END):]
        home.write_text(pre + block + post, encoding="utf-8")
        return True
    # 首次：替换旧表区块（从旧标题到下一个 ---）
    m = re.search(r"## 🔀 资金流对照[\s\S]*?\n---", text)
    if m:
        home.write_text(text[:m.start()] + block + "\n\n---" + text[m.end():], encoding="utf-8")
        return True
    log("  ⚠️ 首页未找到资金流区块，跳过")
    return False


# V1.0 Money Radar 首页区块标记
MONEY_BEGIN = "<!-- MONEY_RADAR_BEGIN -->"
MONEY_END = "<!-- MONEY_RADAR_END -->"


def update_home_money_radar(vault, money_radar, date_str=None):
    """首页"今日资金画像"浓缩区块（V1.0 Money Radar）

    输出4行：
    - 持仓舱状态分布（趋势×N · 分歧×N · 衰竭×N）
    - 价资同步性分布
    - 需警惕股票（衰竭/撤离/真分歧）
    - 全文链接
    """
    home = vault / HOME_FILE
    if not home.exists():
        return False
    text = home.read_text(encoding="utf-8")
    if date_str is None:
        date_str = dt.date.today().isoformat()
    summary = money_radar.get("summary", {})
    state_count = summary.get("holding_state_count", {})
    sync_count = summary.get("holding_sync_count", {})

    # 需警惕的股票（衰竭/撤离/真分歧/派发嫌疑/顶部背离）
    alerts = []
    for h in money_radar.get("holding_cabin", []):
        if h["state"] in ("衰竭", "分歧") or h["sync_zh"] in ("撤离", "真分歧", "派发嫌疑", "顶部背离"):
            alerts.append("%s(%s%s)" % (h["name"], h["state"], h["sync_zh"]))

    block = (MONEY_BEGIN + "\n" +
             "## 💰 今日资金画像 · Money Radar\n\n"
             "> 真实资金观察层：成交额占比 + 融资净买入（T+1）+ 主力净流入（仅参考）\n\n"
             "- **持仓舱状态**: %s\n" % (" · ".join("%s×%d" % (k, v) for k, v in state_count.items()) or "—") +
             "- **价资同步性**: %s\n" % (" · ".join("%s×%d" % (k, v) for k, v in sync_count.items()) or "—") +
             ("- **需警惕**: %s\n" % " · ".join(alerts) if alerts else "- **需警惕**: 无\n") +
             "- **三舱驾驶舱**: [[40_信号看板/%s/%s_MoneyRadar]]\n" % (date_str[:7], date_str) +
             "\n" + MONEY_END)

    if MONEY_BEGIN in text and MONEY_END in text:
        pre = text[:text.index(MONEY_BEGIN)]
        post = text[text.index(MONEY_END) + len(MONEY_END):]
        home.write_text(pre + block + post, encoding="utf-8")
    else:
        # 追加到下钻入口前
        marker = "## 🔗 下钻入口"
        if marker in text:
            home.write_text(text.replace(marker, block + "\n" + marker, 1), encoding="utf-8")
        else:
            home.write_text(text + "\n" + block, encoding="utf-8")
    return True


# ---------- 主流程 ----------

def main(vault_dir, skip_time_guard=False):
    global LOG_FILE

    # 时间窗口守卫：防止早间登录/重载 RunAtLoad 误触发
    # 交易日 15:30-23:00 才自动跑；15:30 前跳过（数据未收盘）；周末跳过
    if not skip_time_guard:
        now = dt.datetime.now()
        wd = now.weekday()
        if wd >= 5:
            print("[守卫] 周末，跳过快照")
            return 0
        h, m = now.hour, now.minute
        if h < 15 or (h == 15 and m < 30):
            print("[守卫] 交易日 %02d:%02d 未到15:30，跳过（A股未收盘）" % (h, m))
            return 0
        # 超过23:00 也跳过（太晚，默认今天已跑过；如需强制补跑用 --force）
        if h >= 23:
            print("[守卫] 已过23:00，跳过（如需强制补跑加 --force）")
            return 0

    date_str = dt.date.today().isoformat()
    log_dir = vault_dir / LOG_ROOT
    ensure_dir(log_dir)
    LOG_FILE = log_dir / ("%s.log" % date_str)

    log("=== 鸿鹄收盘快照启动 %s ===" % date_str)

    # 1. 枚举股票档案
    stocks = []
    for sd in STOCK_DIRS:
        d = vault_dir / sd
        if not d.exists():
            continue
        for md in sorted(d.glob("*.md")):
            fm = parse_front_matter(md)
            if fm.get("code"):
                fm["__path"] = md
                stocks.append(fm)
                NAMES_TO_ARCHIVE[fm["name"]] = fm
    codes = [s["code"] for s in stocks]
    log("枚举 %d 只：%s" % (len(codes), codes))

    # 2. 前一日快照
    prev = {}
    prev_radar = {}
    pf = vault_dir / AGENT_FEED / "latest.json"
    if pf.exists():
        try:
            pj = json.loads(pf.read_text(encoding="utf-8"))
            for p in pj.get("positions", []) + pj.get("candidates_act2", []):
                prev[p["code"]] = p
            for r in pj.get("structure_radar", []):
                if isinstance(r, dict) and r.get("code"):
                    prev_radar[r["code"]] = r
        except Exception as e:
            log("读前一日快照失败：%s" % e)

    # 3. 拉真实数据
    log("拉取东方财富行情+资金流...")
    curr = fetch_market_diagnostics(codes)

    # 3.1 左侧雷达池采集（并入curr → 原始数据一并归档，5日资金可用自有口径累加）
    radar_new = [c for c in RADAR_CODES if c not in curr]
    if radar_new:
        log("拉取左侧雷达池 %d 只..." % len(radar_new))
        curr.update(fetch_market_diagnostics(radar_new))

    # 3.2 V1.0 Money Radar: 融资融券余额采集（T+1披露，datacenter-web不被TLS封锁）
    #     持仓+雷达池逐只调用（共27只，约40秒）；如失败单只降级不影响主流程
    margin_balance = {}
    all_codes_for_margin = list(set(codes + RADAR_CODES))
    log("拉取融资融券余额 %d 只..." % len(all_codes_for_margin))
    for code in all_codes_for_margin:
        m = fetch_margin_balance(code)
        if m:
            margin_balance[code] = m
        time.sleep(0.5)  # datacenter API不被封锁但仍降速避免限流
    log("融资融券：成功 %d/%d 只" % (len(margin_balance), len(all_codes_for_margin)))

    # 3.3 V1.0 Money Radar: 行业板块成交额采集（push2间歇TLS封锁，失败优雅降级）
    #     铁律：行业层是增强数据，任何异常都不允许拖垮快照主流程
    log("拉取行业板块成交额...")
    industry_turnover = None
    try:
        industry_turnover = fetch_industry_turnover()
    except Exception as exc:
        log("行业板块：异常（%s），降级到仅个股层" % exc)
    if industry_turnover:
        log("行业板块：成功 %d 个" % len(industry_turnover))
    else:
        log("行业板块：失败（TLS封锁），降级到仅个股层")

    # 3.5 原始数据归档（永不覆盖；用于可追溯 + 自有口径累加5日资金）
    rf = archive_raw(vault_dir, date_str, curr,
                     margin_balance=margin_balance if margin_balance else None,
                     industry_turnover=industry_turnover)
    log("原始数据归档：%s" % rf.relative_to(vault_dir))

    # 4. 回写档案 YAML
    for s in stocks:
        c = curr.get(s["code"], {})
        upd = {"last_updated": date_str}
        if c.get("price"):
            upd["holding_current_price"] = c["price"]
        if c.get("trend") not in (None, "待更新"):
            upd["trend"] = c["trend"]
        if isinstance(c.get("capital_5d_yi"), (int, float)):
            upd["capital_5d_yi"] = c["capital_5d_yi"]
        update_front_matter(s["__path"], upd)
    log("档案 YAML 回写完成")

    # 5. Signal 门控
    signals, alerts, upgrade, downgrade, sat = evaluate_signals(prev, curr, stocks)
    log("Signal 满足 %d/4 → upgrade=%s alerts=%d" % (sat, upgrade, len(alerts)))

    # 5.5 结构真实性雷达（A层自动 + B层确认，🟠/🔴发警报）
    radar = []
    for s in stocks:
        r = structure_radar(s["code"], curr.get(s["code"], {}), s, prev_radar)
        r["name"] = s["name"]
        radar.append(r)
    for r in radar:
        if r["icon"] == "🔴":
            alerts.append({"level": "critical", "target": "结构雷达·%s" % r["name"],
                           "content": "%s：%s%s" % (r["verdict"], r["reason"],
                                                    "（连续%d日）" % r["streak"] if r["streak"] > 1 else "")})
        elif r["icon"] == "🟠" and r["streak"] >= RADAR_STREAK_TO_TPO:
            alerts.append({"level": "warning", "target": "结构雷达·%s" % r["name"],
                           "content": "%s连续%d日 → 计入TPO C条件恶化计数" % (r["verdict"], r["streak"])})
    radar_map = {r["code"]: r for r in radar}
    log("结构雷达：%d🔴 %d🟠 %d🟢" % (
        sum(1 for r in radar if r["icon"] == "🔴"),
        sum(1 for r in radar if r["icon"] == "🟠"),
        sum(1 for r in radar if r["icon"] == "🟢")))

    # 6. 信号看板
    sig_md = write_signal_md(vault_dir, date_str, prev, curr, signals, alerts, sat, stocks, radar)
    log("信号看板：%s" % sig_md.name)

    # 7. Agent JSON
    positions = [s for s in stocks if s.get("holding_position")]
    candidates = [s for s in stocks if not s.get("holding_position")]
    second_curve = compute_second_curve(curr)

    # 7.5 主线迁移雷达（左侧观察池：行情/RS/资金/成交额每日采集；订单/财报/产业事件周度人做）
    log("主线迁移雷达：计算5方向状态 + 60日高点距离...")
    high60 = fetch_radar_high60()
    radar_pools = compute_migration_radar(curr, high60)
    log("雷达状态：%s" % " · ".join("%s%s" % (p["icon"], p["name"]) for p in radar_pools["pools"]))

    # 7.6 V1.0 Money Radar · 三舱资金观察（持仓舱8只 + 观察舱19只 + 市场雷达）
    log("Money Radar：计算三舱资金状态...")
    money_radar = compute_money_radar(curr, margin_balance if 'margin_balance' in dir() else None)
    holding_summary = money_radar["summary"]
    log("Money Radar 持仓舱: %s | 价资同步性: %s" % (
        " · ".join("%s×%d" % (k, v) for k, v in holding_summary["holding_state_count"].items()),
        " · ".join("%s×%d" % (k, v) for k, v in holding_summary["holding_sync_count"].items()),
    ))

    payload = {
        "protocol": "honghu-a2a", "version": "0.2", "type": "daily_snapshot",
        "date": date_str,
        "source": "eastmoney_auto",
        "positions": [{
            "code": s["code"], "name": s["name"], "main_line": s.get("main_line"),
            "position_pct": s.get("holding_position"),
            "pnl_pct": s.get("holding_pnl_pct"),
            "cost": s.get("holding_cost"),
            "price": curr.get(s["code"], {}).get("price"),
            "pct_change_daily": curr.get(s["code"], {}).get("pct_change_daily"),
            "capital_1d_yi": curr.get(s["code"], {}).get("capital_1d_yi"),
            "capital_5d_yi": curr.get(s["code"], {}).get("capital_5d_yi"),
            "trend": curr.get(s["code"], {}).get("trend"),
            "volume_ratio": curr.get(s["code"], {}).get("volume_ratio"),
            "evidence_level": s.get("evidence_level"),
            "capital_permission": s.get("capital_permission"),
            "archive_url": "file://%s" % s["__path"],
        } for s in positions],
        "candidates_act2": [{
            "code": s["code"], "name": s["name"], "main_line": s.get("main_line"),
            "price": curr.get(s["code"], {}).get("price"),
            "pct_change_daily": curr.get(s["code"], {}).get("pct_change_daily"),
            "capital_5d_yi": curr.get(s["code"], {}).get("capital_5d_yi"),
            "ai_revenue_disclosed": s.get("ai_revenue_disclosed"),
            "archive_url": "file://%s" % s["__path"],
        } for s in candidates],
        "signals_gate": {**signals, "upgrade_gate_triggered": upgrade,
                         "downgrade_gate_triggered": downgrade,
                         "gate_summary": "Signal满足%d/4" % sat},
        "risk_alerts": alerts,
        "structure_radar": radar,
        "second_curve": second_curve,
        "radar_pools": radar_pools,
        "money_radar": money_radar,  # V1.0 Money Radar 三舱资金观察
        "raw_market_data": curr,
        "archive_index": {
            "home": "file://%s" % (vault_dir / HOME_FILE),
            "signal_latest": "file://%s" % sig_md,
            "tpo": "file://%s" % (vault_dir / SIGNAL_ROOT / "TPO2.0预警机制.md"),
        },
    }
    aj = write_agent_json(vault_dir, date_str, payload)
    log("Agent JSON：%s → latest.json" % aj.name)

    # 8. 警报
    af = write_inbox_alert(vault_dir, date_str, alerts)
    if af:
        log("⚠️ 警报：%s" % af.name)

    # 8.5 第二曲线每日作战表
    sc_md = write_second_curve_md(vault_dir, date_str, second_curve)
    if sc_md:
        log("第二曲线作战表：%s" % sc_md.name)

    # 8.45 主线迁移雷达md（左侧观察池）
    radar_md = write_migration_radar_md(vault_dir, date_str, radar_pools)
    log("主线迁移雷达：%s" % radar_md.name)

    # 8.46 V1.0 Money Radar md（三舱资金观察驾驶舱）
    money_md = write_money_radar_md(vault_dir, date_str, money_radar)
    log("Money Radar：%s" % money_md.name)

    # 8.6 可分享标准数据包（JSON + MD，供 ChatGPT/Claude/豆包 分析）
    try:
        packet = build_share_packet(vault_dir, date_str, payload, second_curve, curr)
        pj, pm = write_share_packet(vault_dir, date_str, packet)
        log("📤 分享数据包：%s / %s" % (pj.name, pm.name))
        # 自动发布到桌面文件夹（~/Desktop/鸿鹄数据包/，固定文件名永远最新）
        try:
            sp = Path(__file__).resolve().parent / "share_packet.py"
            subprocess.run([sys.executable, str(sp), "publish"], timeout=30,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            log("📁 已发布到桌面：~/Desktop/鸿鹄数据包/")
        except Exception as e:
            log("桌面发布失败（不影响主流程）：%s" % e)
    except Exception as e:
        log("分享数据包生成失败：%s" % e)

    # 8.5. 首页决策看板（3张卡 + 左侧雷达 + frontmatter日期）
    ok = update_home_dashboard(vault_dir, curr, date_str, second_curve, stocks, radar_pools)
    log("首页决策看板：%s" % ("已更新" if ok else "未更新"))

    # 9. 首页资金流区块（含雷达判读）
    ok = update_home_capital(vault_dir, curr, stocks, radar_map)
    log("首页资金流区块：%s" % ("已更新" if ok else "未更新"))

    # 9.5 V1.0 Money Radar 首页区块
    ok = update_home_money_radar(vault_dir, money_radar, date_str)
    log("首页 Money Radar 区块：%s" % ("已更新" if ok else "未更新"))

    # 9.6 V1.0 Web 发布（浏览器驾驶舱 + Agent JSON 接口 → CloudBase）
    #     失败不影响主流程：快照已落盘，发布可次日重跑
    try:
        r = subprocess.run(
            [sys.executable, str(Path(__file__).parent / "publish_web.py")],
            capture_output=True, text=True, timeout=300)
        tail = (r.stdout or "").strip().splitlines()[-3:]
        log("Web发布：%s" % (" | ".join(tail) if tail else "无输出"))
        if r.returncode != 0:
            log("Web发布失败（不影响快照）：%s" % (r.stderr or "")[:200])
    except Exception as exc:
        log("Web发布异常（不影响快照）：%s" % exc)

    # 9.7 V1.0 微信日报推送（PushPlus → 公众号；非交易日自动跳过；失败不影响快照）
    try:
        r = subprocess.run(
            [sys.executable, str(Path(__file__).parent / "push_wechat.py")],
            capture_output=True, text=True, timeout=60)
        out = (r.stdout or "").strip().splitlines()
        log("微信日报：%s" % (out[-1] if out else "无输出"))
        if r.returncode != 0:
            log("微信日报失败（不影响快照）：%s" % ((r.stderr or "") + (r.stdout or ""))[:200])
    except Exception as exc:
        log("微信日报异常（不影响快照）：%s" % exc)

    log("=== 快照完成 %s ===" % date_str)
    return 0


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--vault-dir", default=VAULT_DEFAULT)
    ap.add_argument("--force", action="store_true", help="强制运行（跳过时间窗口守卫，用于手动补跑）")
    args = ap.parse_args()
    try:
        sys.exit(main(Path(args.vault_dir), skip_time_guard=args.force))
    except Exception as exc:
        msg = "快照致命错误：%s\n%s" % (exc, traceback.format_exc())
        print(msg, file=sys.stderr, flush=True)
        if LOG_FILE:
            try:
                with open(LOG_FILE, "a", encoding="utf-8") as f:
                    f.write(msg + "\n")
            except Exception:
                pass
        sys.exit(2)
