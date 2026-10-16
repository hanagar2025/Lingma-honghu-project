#!/usr/bin/env python3
"""V1.0 Web 发布器：三舱资金驾驶舱 HTML + Agent JSON 接口 → 腾讯云 CloudBase 静态托管

用法:
  python3 publish_web.py                 # 渲染 + 上传
  python3 publish_web.py --render-only   # 只渲染不上传（调试）

输出站点结构（上传 site/ 目录）:
  /honghu-<token>/index.html            # 浏览器驾驶舱
  /honghu-<token>/api/latest.json       # Agent 当日全量接口
  /honghu-<token>/api/history/*.json    # Agent 历史归档接口

安全: 随机 token 路径隐蔽保护，数据含完整持仓，URL 勿外传给不可信对象。
"""
import json
import os
import sys
import datetime as dt
import subprocess
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from sentinel_config import vault_root, cloudbase_env_id, site_token

VAULT = vault_root()
RAW_ROOT = VAULT / "97_原始数据"
FEED_FILE = VAULT / "80_Agent_Feed" / "latest.json"
SITE_ROOT = Path(os.environ.get("HONGHU_SITE_ROOT", str(VAULT / "98_自动化" / "web_site")))
ENV_ID = cloudbase_env_id()

STATE_COLOR = {
    # 状态灯语义（非A股涨跌色）：红=危险 黄=警惕 绿=健康 蓝=中性
    "衰竭": "#e5484d", "撤离": "#e5484d", "派发嫌疑": "#e5484d",
    "分歧": "#f5a623", "真分歧": "#f5a623", "顶部背离": "#f5a623",
    "趋势": "#2fbf71", "有效推动": "#2fbf71", "抛压减轻": "#2fbf71", "启动": "#2fbf71", "持续": "#2fbf71",
    "积累": "#5b8def", "观察": "#6b7280", "爆发": "#f5a623",
}
SYNC_ORDER = ["有效推动", "真分歧", "派发嫌疑", "顶部背离", "抛压减轻", "撤离", "价升资平", "价跌资平", "中性", "数据不足"]


def load_token():
    t = site_token()
    if not t:
        raise SystemExit("站点 token 未配置：设置环境变量 HONGHU_SITE_TOKEN 或在 config/settings.json 配置 site_token")
    return t


def replay_history():
    """逐日重放历史归档 → 趋势序列 [{date, state_count, sync_count}]"""
    from honghu_snapshot import compute_money_radar
    out = []
    for d in sorted(RAW_ROOT.iterdir()):
        f = d / "raw_market.json"
        if not f.exists():
            continue
        try:
            j = json.loads(f.read_text(encoding="utf-8"))
            curr = j.get("data") or {}
            if not curr:
                continue
            mr = compute_money_radar(curr, j.get("margin_balance") or {})
            out.append({
                "date": d.name,
                "state_count": mr["summary"]["holding_state_count"],
                "sync_count": mr["summary"]["holding_sync_count"],
            })
        except Exception as e:
            out.append({"date": d.name, "error": str(e)[:80]})
    return out[-15:]  # 最近15个交易日


def trend_html(history):
    """历史状态演变的横向堆叠条"""
    if not history:
        return "<p class='muted'>暂无历史数据</p>"
    rows = []
    for h in history:
        if "error" in h:
            continue
        total = sum(h["state_count"].values()) or 1
        segs = []
        for state in ["趋势", "积累", "分歧", "爆发", "衰竭"]:
            n = h["state_count"].get(state, 0)
            if n:
                segs.append("<div class='seg' style='width:%.1f%%;background:%s' title='%s×%d'></div>" % (
                    n / total * 100, STATE_COLOR[state], state, n))
        label = " · ".join("%s×%d" % (k, v) for k, v in h["state_count"].items())
        rows.append(
            "<div class='trend-row'><span class='trend-date'>%s</span>"
            "<div class='trend-bar'>%s</div>"
            "<span class='trend-label'>%s</span></div>" % (h["date"], "".join(segs), label))
    return "".join(rows)


def stock_rows(stocks, is_holding):
    rows = []
    for i, s in enumerate(stocks, 1):
        color = STATE_COLOR.get(s["state"], "#6b7280")
        scolor = STATE_COLOR.get(s["sync_zh"], "#6b7280")
        pct = s.get("pct_change_daily")
        pct_str = "%+.2f%%" % pct if isinstance(pct, (int, float)) else "—"
        pct_color = "#e5484d" if isinstance(pct, (int, float)) and pct < 0 else ("#2fbf71" if isinstance(pct, (int, float)) and pct > 0 else "#9ca3af")
        base = "<td class='num'>%d</td><td class='code'>%s</td><td>%s</td>" % (i, s["code"], s["name"])
        if is_holding:
            rz = s.get("rzjme_yi")
            rz5 = s.get("rzjme_5d_yi")
            rows.append(
                base +
                "<td><span class='badge' style='background:%s22;color:%s;border:1px solid %s55'>%s</span></td>"
                "<td><span class='badge' style='background:%s22;color:%s;border:1px solid %s55'>%s</span></td>"
                "<td class='num'>%.2f亿</td><td class='num' style='color:%s'>%s</td>"
                "<td class='num' style='color:%s'>%s</td><td class='num' style='color:%s'>%s</td>"
                "<td class='muted small'>%s</td></tr>" % (
                    color, color, color, s["state"],
                    scolor, scolor, scolor, s["sync_zh"],
                    s.get("amount_yi") or 0,
                    pct_color, pct_str,
                    "#2fbf71" if isinstance(rz, (int, float)) and rz > 0 else "#e5484d",
                    "%+.2f亿" % rz if isinstance(rz, (int, float)) else "—",
                    "#2fbf71" if isinstance(rz5, (int, float)) and rz5 > 0 else "#e5484d",
                    "%+.2f亿" % rz5 if isinstance(rz5, (int, float)) else "—",
                    s.get("capital_source") or "—"))
        else:
            rows.append(
                base +
                "<td><span class='badge' style='background:%s22;color:%s;border:1px solid %s55'>%s</span></td>"
                "<td><span class='badge' style='background:%s22;color:%s;border:1px solid %s55'>%s</span></td>"
                "<td class='num'>%.2f亿</td><td class='num' style='color:%s'>%s</td></tr>" % (
                    color, color, color, s["state"],
                    scolor, scolor, scolor, s["sync_zh"],
                    s.get("amount_yi") or 0,
                    pct_color, pct_str))
    return "".join(rows)


def dist_chips(count_map):
    """状态分布 → 彩色 chips"""
    if not count_map:
        return "<span class='muted'>—</span>"
    return " ".join(
        "<span class='badge' style='background:%s22;color:%s;border:1px solid %s55'>%s ×%d</span>" % (
            STATE_COLOR.get(k, "#6b7280"), STATE_COLOR.get(k, "#6b7280"), STATE_COLOR.get(k, "#6b7280"), k, v)
        for k, v in count_map.items())


def _fmt_yi(v):
    return ("%.2f亿" % v) if isinstance(v, (int, float)) else "—"


def _pct5d_from_note(note):
    """从 sync_note 字符串里提取 5D涨跌（如 '... | 5D涨跌-10.98%'）"""
    if not isinstance(note, str):
        return "—"
    for part in note.split("|"):
        part = part.strip()
        if part.startswith("5D涨跌"):
            return part.replace("5D涨跌", "")
    return "—"


def build_agent_markdown(latest, history):
    """生成给外部 Agent 分析的完整 Markdown 数据包（复制到剪贴板用）"""
    mr = latest.get("money_radar") or {}
    holding = mr.get("holding_cabin") or []
    watch = mr.get("watch_cabin") or []
    summary = mr.get("summary") or {}
    date_str = latest.get("date", "?")
    L = []
    L.append("# 资金哨兵 · 三舱资金观察数据包（%s）" % date_str)
    L.append("")
    L.append("> **系统角色**：资金哨兵是观察层（👁 看），只回答“钱在往哪走、个股资金有没有恶化”，不生成买卖指令；具体操作由交易执行单（✋ 做）负责。两者模块隔离，禁止跨模块串证。")
    L.append("> **数据原则**：只用真实资金（成交额 + 融资净买入 T+1），估算的主力净流入仅参考不投票。状态机阈值为 V1.0 初定值。")
    L.append("")
    L.append("## 数据字典")
    L.append("")
    L.append("- **持仓舱状态（5 态）**：积累（价跌/平+资金流入，吸筹）/ 趋势（价涨+资金流入，健康）/ 分歧（价涨+资金流入放缓，或价平+资金流出，关注）/ 衰竭（价涨+资金流出，顶部背离）/ 爆发（价量齐升+占比显著偏离，过热）")
    L.append("- **价资同步性（5 种）**：有效推动（资金升+价涨）/ 真分歧（资金升+价平，最值得关注）/ 顶部背离（资金升+价跌，或价涨+资金降）/ 抛压减轻（资金降+价不跌）/ 撤离（资金降+价跌）")
    L.append("- **融资净买入**：真实数据，T+1 披露，正=杠杆资金当日净流入（单位：亿元）")
    L.append("- **5日累计**：近 5 日融资净买入之和（亿元）")
    L.append("- **成交额**：当日真实成交额（亿元）")
    L.append("")
    L.append("## 当日状态分布")
    L.append("")
    for k, v in (summary.get("holding_state_count") or {}).items():
        L.append("- 持仓舱 %s ×%d" % (k, v))
    for k, v in (summary.get("holding_sync_count") or {}).items():
        L.append("- 价资 %s ×%d" % (k, v))
    L.append("")
    L.append("## ① 持仓舱（8 只）")
    L.append("")
    L.append("| 代码 | 名称 | 状态 | 价资同步 | 收盘价 | 当日涨跌 | 成交额 | 5D涨跌 | 融资净买入 | 5日累计 | 资金来源 |")
    L.append("|------|------|------|---------|--------|---------|--------|--------|-----------|---------|---------|")
    for s in holding:
        L.append("| %s | %s | %s | %s | %s | %s | %s | %s | %s | %s | %s |" % (
            s.get("code", ""), s.get("name", ""), s.get("state", ""), s.get("sync_zh", ""),
            s.get("price") if isinstance(s.get("price"), (int, float)) else "—",
            ("%+.2f%%" % s["pct_change_daily"]) if isinstance(s.get("pct_change_daily"), (int, float)) else "—",
            _fmt_yi(s.get("amount_yi")),
            _pct5d_from_note(s.get("sync_note")),
            ("%+.2f亿" % s["rzjme_yi"]) if isinstance(s.get("rzjme_yi"), (int, float)) else "—",
            ("%+.2f亿" % s["rzjme_5d_yi"]) if isinstance(s.get("rzjme_5d_yi"), (int, float)) else "—",
            s.get("capital_source", "")))
    L.append("")
    L.append("## ② 观察舱（左侧观察池 %d 只）" % len(watch))
    L.append("")
    L.append("| 代码 | 名称 | 状态 | 价资同步 | 收盘价 | 当日涨跌 | 成交额 | 5D涨跌 |")
    L.append("|------|------|------|---------|--------|---------|--------|--------|")
    for s in watch:
        L.append("| %s | %s | %s | %s | %s | %s | %s | %s |" % (
            s.get("code", ""), s.get("name", ""), s.get("state", ""), s.get("sync_zh", ""),
            s.get("price") if isinstance(s.get("price"), (int, float)) else "—",
            ("%+.2f%%" % s["pct_change_daily"]) if isinstance(s.get("pct_change_daily"), (int, float)) else "—",
            _fmt_yi(s.get("amount_yi")),
            _pct5d_from_note(s.get("sync_note"))))
    L.append("")
    L.append("## ③ 近 %d 个交易日状态演变（看“变化”，不是看“一天”）" % len(history))
    L.append("")
    L.append("| 日期 | 积累 | 趋势 | 分歧 | 衰竭 | 爆发 | 撤离(价资) |")
    L.append("|------|------|------|------|------|------|-----------|")
    for h in history:
        if "error" in h:
            continue
        sc = h.get("state_count") or {}
        yc = h.get("sync_count") or {}
        L.append("| %s | %s | %s | %s | %s | %s | %s |" % (
            h.get("date", "?"),
            sc.get("积累", 0), sc.get("趋势", 0), sc.get("分歧", 0), sc.get("衰竭", 0), sc.get("爆发", 0),
            yc.get("撤离", 0)))
    L.append("")
    L.append("## 请基于以上数据回答")
    L.append("")
    L.append("1. 综合近 %d 日趋势，持仓舱资金是在改善还是恶化？衰竭+撤离的个股数量是扩散还是收敛？" % len(history))
    L.append("2. 哪几只个股出现“衰竭+撤离”组合（资金层危险信号）？它们的融资净买入是绝对值大还是相对 5 日累计恶化？")
    L.append("3. 有没有个股出现“真分歧”（资金升+价平）？这通常是最值得关注的先手信号。")
    L.append("4. 观察舱里有没有个股状态从“观察”转向“启动/趋势”？是否可能有资金从持仓主线向观察池迁移的早期迹象？")
    L.append("5. 仅基于资金层证据（不做宏观/产业串证），当前应不应该对某只个股升级 TPO 复核？")
    L.append("")
    return "\n".join(L)


def render_html(latest, history):
    mr = latest.get("money_radar") or {}
    holding = mr.get("holding_cabin") or []
    watch = mr.get("watch_cabin") or []
    summary = mr.get("summary") or {}
    date_str = latest.get("date", str(dt.date.today()))
    now_str = dt.datetime.now().strftime("%H:%M")
    market = mr.get("market_radar")

    market_block = ""
    if market:
        rows = "".join(
            "<tr><td class='num'>%d</td><td>%s</td><td class='num'>%.2f亿</td></tr>" % (
                i, m.get("industry_name", ""), (m.get("turnover_yuan") or 0) / 1e8)
            for i, m in enumerate(market[:20], 1))
        market_block = ("<h2>③ 市场雷达</h2><table><tr><th>#</th><th>行业</th><th>成交额</th></tr>%s</table>" % rows)
    else:
        market_block = ("<h2>③ 市场雷达</h2><div class='warn-box'>行业板块数据源（push2）TLS 封锁，已降级到个股层。"
                        "持仓舱 + 观察舱两层判定不受影响。</div>")

    gate_rows = [
        ("Gate 0", "产业存在", "（产业层，非本雷达职责）", "观察池准入"),
        ("Gate 1", "成形（观察）", "5D成交额占比上穿20D + 状态=启动", "无仓位"),
        ("Gate 2", "强化（1-3%试探）", "占比持续≥3日 + 价资同步=有效推动 + 行业吸引力倍数>1.2", "允许1-3%试探仓"),
        ("Gate 3", "兑现（战略仓）", "Gate 2持续 + 盈利验证 + 融资余额5日净买入为正", "允许战略仓"),
        ("Gate 4", "过热（TPO监控）", "状态=爆发或衰竭 + 拥挤度高位", "进入TPO监控"),
    ]
    gate_html = "".join(
        "<tr><td class='code'>%s</td><td>%s</td><td class='small'>%s</td><td class='small'>%s</td></tr>" % g
        for g in gate_rows)

    agent_md = build_agent_markdown(latest, history)
    # 防御：Markdown 内容中的 </script> 会提前闭合隐藏域；% 会干扰 % 格式化
    agent_md_safe = agent_md.replace("</script>", "<\\/script>")

    html = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>资金哨兵 · 三舱资金观察 %s</title>
<style>
:root{--bg:#0d1117;--card:#161b22;--border:#30363d;--text:#e6edf3;--muted:#8b949e;--accent:#5b8def}
*{margin:0;padding:0;box-sizing:border-box}
body{background:var(--bg);color:var(--text);font:14px/1.6 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif;padding:16px;max-width:1100px;margin:0 auto}
h1{font-size:20px;margin-bottom:4px}
h2{font-size:16px;margin:28px 0 10px;padding-left:10px;border-left:3px solid var(--accent)}
.sub{color:var(--muted);font-size:13px;margin-bottom:18px}
.card{background:var(--card);border:1px solid var(--border);border-radius:10px;padding:16px;margin-bottom:14px}
table{width:100%%;border-collapse:collapse;font-size:13px}
th{color:var(--muted);text-align:left;font-weight:500;padding:6px 8px;border-bottom:1px solid var(--border);white-space:nowrap}
td{padding:7px 8px;border-bottom:1px solid #21262d;white-space:nowrap}
tr:last-child td{border-bottom:none}
.num{text-align:right;font-variant-numeric:tabular-nums}
.code{color:var(--muted);font-family:ui-monospace,Menlo,monospace;font-size:12px}
.badge{display:inline-block;padding:1px 8px;border-radius:10px;font-size:12px;white-space:nowrap}
.muted{color:var(--muted)}.small{font-size:12px}
.warn-box{background:#2d1a1a;border:1px solid #5c2b2b;color:#f0a0a0;border-radius:8px;padding:10px 14px;font-size:13px}
.trend-row{display:flex;align-items:center;gap:10px;margin:6px 0}
.trend-date{width:86px;color:var(--muted);font-size:12px;font-family:ui-monospace,Menlo,monospace}
.trend-bar{flex:1;display:flex;height:18px;border-radius:4px;overflow:hidden;background:#21262d;min-width:120px}
.seg{height:100%%}
.trend-label{color:var(--muted);font-size:11px;white-space:nowrap}
.chips{display:flex;flex-wrap:wrap;gap:8px}
.note{font-size:12px;color:var(--muted);margin-top:8px}
.copy-bar{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:16px}
.copy-btn{background:#2ea043;color:#fff;border:none;border-radius:8px;padding:11px 22px;font-size:15px;font-weight:600;cursor:pointer;font-family:inherit;box-shadow:0 2px 8px rgba(46,160,67,.35)}
.copy-btn:active{opacity:0.85}
.copy-btn.copied{background:#238636;box-shadow:0 2px 8px rgba(35,134,54,.4)}
.copy-btn.ghost{background:#30363d;font-weight:400;box-shadow:none;font-size:13px;padding:11px 16px}
.copy-hint{color:var(--muted);font-size:12px;margin:-8px 0 16px 2px}
@media(max-width:700px){td,th{padding:5px 4px;font-size:12px}.trend-label{display:none}}
</style>
</head>
<body>
<h1>💰 资金哨兵 · 三舱资金观察</h1>
<div class="sub">%s · 更新于 %s · 数据原则：只用真实资金（成交额+融资净买入），估算主力流仅参考 · 只看不动，收盘后请对照交易执行单</div>

<div class="copy-bar">
  <button class="copy-btn" data-copy="copy">🟢 一键复制给 Agent</button>
  <button class="copy-btn ghost" data-copy="preview">👁 预览内容</button>
</div>
<div class="copy-hint">复制后到任意 AI 对话框粘贴 · 含持仓 8 只全字段 + 观察舱 19 只 + 近 15 日资金趋势 + 数据字典（微信里“复制原文”只有简表，完整数据在这里）</div>
<pre id="agent-md-preview" style="display:none;-webkit-user-select:text;user-select:text;background:var(--card);border:1px solid var(--border);border-radius:8px;padding:14px;font-size:12px;white-space:pre-wrap;max-height:400px;overflow-y:auto;color:var(--muted)"></pre>

<script type="text/plain" id="agent-data">__AGENT_MD__</script>

<div class="card">
  <div class="chips"><strong style="margin-right:6px">持仓舱状态</strong>%s</div>
  <div class="chips" style="margin-top:10px"><strong style="margin-right:6px">价资同步性</strong>%s</div>
</div>

<h2>趋势 · 近 %d 个交易日演变</h2>
<div class="card">%s</div>

<h2>① 持仓舱（8 只 · 5 态状态机）</h2>
<div class="card" style="overflow-x:auto">
<table>
<tr><th>#</th><th>代码</th><th>名称</th><th>状态</th><th>价资同步</th><th>成交额</th><th>5D涨跌</th><th>融资净买入</th><th>5日累计</th><th>资金来源</th></tr>
%s
</table>
<div class="note">资金来源列说明判定依据：融资净买入=真实（T+1披露）；主力净流入=估算（仅参考不投票）</div>
</div>

<h2>② 观察舱（左侧观察池 · 4 态）</h2>
<div class="card" style="overflow-x:auto">
<table>
<tr><th>#</th><th>代码</th><th>名称</th><th>状态</th><th>价资同步</th><th>成交额</th><th>5D涨跌</th></tr>
%s
</table>
<div class="note">观察池不自动获得 Capital Permission，需通过 Gate 0→4 验证</div>
</div>

%s

<h2>④ Capital Permission 资金层证据</h2>
<div class="card" style="overflow-x:auto">
<table>
<tr><th>Gate</th><th>名称</th><th>资金层证据要求</th><th>仓位含义</th></tr>
%s
</table>
<div class="note">禁止跨模块串证 · 判断顺序：M-01外部风险 → A股市场结构 → AI主线 → Portfolio既有Decision</div>
</div>

<h2>⑤ Agent 数据接口</h2>
<div class="card small">
<p>其他 AI / Agent 分析时可直接 fetch（JSON）：</p>
<p style="font-family:ui-monospace,Menlo,monospace;color:var(--accent);margin-top:6px">api/latest.json — 当日全量（money_radar + 持仓诊断 + 雷达池）</p>
<p style="font-family:ui-monospace,Menlo,monospace;color:var(--accent)">api/history/2026-MM-DD.json — 每交易日归档（含 margin_balance 融资融券块）</p>
</div>

<div class="note" style="margin-top:20px">
边界：资金哨兵是观察层输出，不预测股价、不生成买卖指令；具体操作以交易执行单为准。资金最集中处往往最拥挤。
黑天鹅前资金有时先行（融资余额骤降 / ETF 大额赎回）。状态机阈值为 V1.0 初定值。
</div>
<script>
(function(){
  var DATA_ID = "agent-data", PRE_ID = "agent-md-preview";
  function flashOk(btn){
    if(!btn.getAttribute("data-label")) btn.setAttribute("data-label", btn.textContent);
    btn.textContent = "✅ 已复制，去 Agent 对话框粘贴";
    btn.classList.add("copied");
    setTimeout(function(){ btn.textContent = btn.getAttribute("data-label"); btn.classList.remove("copied"); }, 2600);
  }
  function showManual(btn){
    btn.textContent = "⚠️ 自动复制被拦截，请长按下方文本全选复制";
  }
  function fallbackCopy(text, btn){
    var pre = document.getElementById(PRE_ID);
    pre.textContent = text;
    pre.style.display = "block";
    if(pre.scrollIntoView) pre.scrollIntoView({behavior:"smooth", block:"center"});
    var ok = false;
    try {
      var range = document.createRange();
      range.selectNodeContents(pre);
      var sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      ok = document.execCommand("copy");
    } catch(e){ ok = false; }
    if(ok){ flashOk(btn); } else { showManual(btn); }
  }
  function copyPacket(btn){
    var text = document.getElementById(DATA_ID).textContent;
    try {
      if(navigator.clipboard && navigator.clipboard.writeText){
        var p = navigator.clipboard.writeText(text);
        if(p && typeof p.then === "function"){
          p.then(function(){ flashOk(btn); }, function(){ fallbackCopy(text, btn); });
          return;
        }
      }
    } catch(e){}
    fallbackCopy(text, btn);
  }
  document.querySelectorAll(".copy-btn").forEach(function(btn){
    btn.addEventListener("click", function(){
      var action = btn.getAttribute("data-copy");
      if(action === "preview"){
        var pre = document.getElementById(PRE_ID);
        var hidden = pre.style.display === "none" || pre.style.display === "";
        if(hidden){
          pre.textContent = document.getElementById(DATA_ID).textContent;
          pre.style.display = "block";
          btn.textContent = "🙈 收起预览";
        } else {
          pre.style.display = "none";
          btn.textContent = "👁 预览内容";
        }
        return;
      }
      copyPacket(btn);
    });
  });
})();
</script>
</body>
</html>""" % (
        date_str, date_str, now_str,
        dist_chips(summary.get("holding_state_count", {})),
        dist_chips(summary.get("holding_sync_count", {})),
        len(history), trend_html(history),
        stock_rows(holding, True),
        stock_rows(watch, False),
        market_block,
        gate_html,
    )

    html = html.replace("__AGENT_MD__", agent_md_safe)
    return html


def collect_api_files(token):
    """拷贝 latest.json + 历史 raw_market.json → site/<token>/api/"""
    site_api = SITE_ROOT / "site" / token / "api"
    site_api.mkdir(parents=True, exist_ok=True)
    # latest
    if FEED_FILE.exists() and FEED_FILE.stat().st_size > 0:
        (site_api / "latest.json").write_bytes(FEED_FILE.read_bytes())
        print("  api/latest.json ✓ (%.0fKB)" % (FEED_FILE.stat().st_size / 1024))
    else:
        print("  ⚠️ latest.json 缺失或为空")
    # history
    hist_dir = site_api / "history"
    hist_dir.mkdir(exist_ok=True)
    n = 0
    for d in sorted(RAW_ROOT.iterdir()):
        f = d / "raw_market.json"
        if f.exists():
            (hist_dir / ("%s.json" % d.name)).write_bytes(f.read_bytes())
            n += 1
    print("  api/history/ ✓ (%d 天)" % n)


def deploy(token):
    site_dir = SITE_ROOT / "site"
    cmd = ["tcb", "hosting", "deploy", ".", "-e", ENV_ID, "--json"]
    r = subprocess.run(cmd, cwd=str(site_dir), capture_output=True, text=True, timeout=180)
    if r.returncode != 0:
        print("  ⚠️ tcb 上传失败: %s" % (r.stderr or r.stdout)[:300])
        return False
    print("  tcb 上传成功")
    return True


def main():
    render_only = "--render-only" in sys.argv
    token = load_token()
    print("Token: %s" % token)

    if not FEED_FILE.exists() or FEED_FILE.stat().st_size == 0:
        raise SystemExit("latest.json 缺失，先跑 honghu_snapshot.py")

    latest = json.loads(FEED_FILE.read_text(encoding="utf-8"))
    history = replay_history()
    print("数据: %s | 历史重放 %d 天" % (latest.get("date"), len(history)))

    # 渲染 index.html
    html = render_html(latest, history)
    site_token_dir = SITE_ROOT / "site" / token
    site_token_dir.mkdir(parents=True, exist_ok=True)
    (site_token_dir / "index.html").write_text(html, encoding="utf-8")
    print("  index.html ✓")

    # 收集 API JSON
    collect_api_files(token)

    if render_only:
        print("（--render-only，不上传）本地预览: %s" % (site_token_dir / "index.html"))
        return 0

    if deploy(token):
        # CloudBase默认域名必须带AppId后缀，无后缀返回418
        base = "https://%s-1342894131.tcloudbaseapp.com/%s" % (ENV_ID, token)
        url = base + "/index.html"
        api_url = base + "/api/latest.json"
        print("=" * 60)
        print("浏览器驾驶舱: %s" % url)
        print("Agent 接口:   %s" % api_url)
        print("=" * 60)
    return 0


if __name__ == "__main__":
    sys.exit(main())
