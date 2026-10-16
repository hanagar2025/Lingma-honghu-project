#!/usr/bin/env python3
"""V1.0 微信日报推送：Money Radar 摘要 → PushPlus → 微信公众号

用法:
  python3 push_wechat.py            # 读 latest.json 推送当日日报
  python3 push_wechat.py --test     # 发送测试消息（验证 token/通道）

前置:
  1. 微信扫码登录 https://www.pushplus.plus 并关注"pushplus推送加"公众号
  2. token 存入 web_site/.pushplus_token（32位字符串，一行，勿提交任何仓库）

安全边界: PushPlus token 只能向本人微信发消息，读不到本系统数据。
"""
import json
import sys
import urllib.request
import urllib.error
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from sentinel_config import vault_root, cloudbase_env_id, site_token, pushplus_token_file

VAULT = vault_root()
FEED_FILE = VAULT / "80_Agent_Feed" / "latest.json"
RAW_ROOT = VAULT / "97_原始数据"
TOKEN_FILE = pushplus_token_file()
PUSH_URL = "https://www.pushplus.plus/send"


def _env_id():
    return cloudbase_env_id()

# 微信浅色卡片配色（公众号消息背景为白，必须浅色）
C = {"danger": "#d93025", "warn": "#e8830c", "ok": "#1e8e4a",
     "neutral": "#5f6368", "bg": "#f6f7f9", "border": "#e3e6ea"}
STATE_COLOR = {"衰竭": C["danger"], "撤离": C["danger"], "派发嫌疑": C["danger"],
               "分歧": C["warn"], "真分歧": C["warn"], "顶部背离": C["warn"], "爆发": C["warn"],
               "趋势": C["ok"], "有效推动": C["ok"], "抛压减轻": C["ok"], "启动": C["ok"], "持续": C["ok"],
               "积累": C["neutral"], "观察": C["neutral"]}
DANGER_STATES = {"衰竭", "撤离", "派发嫌疑"}


def dashboard_url():
    return "https://%s-1342894131.tcloudbaseapp.com/%s/index.html" % (_env_id(), site_token())


def load_pushplus_token():
    if not TOKEN_FILE.exists():
        raise SystemExit(
            "未找到 PushPlus token：\n"
            "  1. 微信扫码登录 https://www.pushplus.plus\n"
            "  2. 关注'pushplus推送加'公众号\n"
            "  3. 个人中心复制 token，写入: %s" % TOKEN_FILE)
    t = TOKEN_FILE.read_text().strip()
    if len(t) < 16:
        raise SystemExit("token 格式异常（应为32位字符串），检查: %s" % TOKEN_FILE)
    return t


def badge(text):
    color = STATE_COLOR.get(text, C["neutral"])
    return ("<span style='display:inline-block;padding:1px 8px;margin:2px;border-radius:9px;"
            "font-size:12px;color:#fff;background:%s'>%s</span>" % (color, text))


def build_daily_html(latest):
    """微信兼容 HTML：table 布局 + 全 inline style + 浅色主题"""
    mr = latest.get("money_radar") or {}
    holding = mr.get("holding_cabin") or []
    summary = mr.get("summary") or {}
    date_str = latest.get("date", "")
    state_count = summary.get("holding_state_count", {})
    sync_count = summary.get("holding_sync_count", {})

    # 标题级别：危险股数量
    danger_n = sum(1 for h in holding
                   if h["state"] in DANGER_STATES or h["sync_zh"] in DANGER_STATES)
    if danger_n >= 5:
        head = "🔴 资金撤离扩散 %d/8" % danger_n
    elif danger_n >= 3:
        head = "🟠 出现资金恶化 %d/8" % danger_n
    elif danger_n >= 1:
        head = "🟡 局部警惕 %d/8" % danger_n
    else:
        head = "🟢 资金状态平稳"

    chips_state = "".join(badge("%s ×%d" % (k, v)) for k, v in state_count.items()) or "—"
    chips_sync = "".join(badge(k) for k in sync_count.keys()) or "—"

    # 8 只持仓精简表
    rows = []
    for h in holding:
        rz = h.get("rzjme_yi")
        rz_str = "%+.2f亿" % rz if isinstance(rz, (int, float)) else "—"
        rz_color = C["ok"] if isinstance(rz, (int, float)) and rz > 0 else C["danger"]
        rows.append(
            "<tr>"
            "<td style='padding:6px 8px;border-bottom:1px solid %s'>%s</td>"
            "<td style='padding:6px 8px;border-bottom:1px solid %s;color:%s;font-size:12px'>%s</td>"
            "<td style='padding:6px 8px;border-bottom:1px solid %s;color:%s;font-size:12px'>%s</td>"
            "<td style='padding:6px 8px;border-bottom:1px solid %s;text-align:right;color:%s;font-size:12px'>%s</td>"
            "</tr>" % (
                C["border"], h["name"],
                C["border"], STATE_COLOR.get(h["state"], C["neutral"]), h["state"],
                C["border"], STATE_COLOR.get(h["sync_zh"], C["neutral"]), h["sync_zh"],
                C["border"], rz_color, rz_str))
    table = (
        "<table style='width:100%%;border-collapse:collapse;font-size:13px;margin-top:6px'>"
        "<tr style='color:%s;font-size:12px'>"
        "<th style='text-align:left;padding:4px 8px'>名称</th>"
        "<th style='text-align:left;padding:4px 8px'>状态</th>"
        "<th style='text-align:left;padding:4px 8px'>价资同步</th>"
        "<th style='text-align:right;padding:4px 8px'>融资净买入</th>"
        "</tr>%s</table>" % (C["neutral"], "".join(rows)))

    url = dashboard_url()

    return """<div style="max-width:100%%;font-family:-apple-system,'PingFang SC',sans-serif;color:#1f2329">
<p style="font-size:15px;font-weight:600;margin:0 0 10px">%s · 持仓舱 8 只</p>

<div style="background:%s;border-radius:8px;padding:10px 12px;margin-bottom:10px">
<p style="margin:0 0 6px;font-size:13px;color:%s"><b>%s</b></p>
<p style="margin:4px 0;font-size:13px">状态：%s</p>
<p style="margin:4px 0;font-size:13px">价资：%s</p>
</div>

%s

<p style="margin:14px 0 4px;font-size:12px;color:%s">融资净买入为真实数据（T+1）；主力净流入为估算仅参考。资金哨兵只看不动，收盘后请对照交易执行单。<br><b>📦 完整数据（收盘价/成交额/5日累计/观察舱19只/15日趋势）在紧跟着的下一条消息里，打开它点底部「复制原文内容」即可粘贴给 Agent，无需打开网页。</b></p>

<p style="text-align:center;margin:16px 0 4px">
<a target="_blank" rel="noopener" href="%s" style="display:inline-block;background:#5f6368;color:#fff;text-decoration:none;padding:8px 22px;border-radius:20px;font-size:12px">💻 完整网页（建议电脑浏览器打开，手机微信会被拦截）</a>
</p>
<p style="text-align:center;margin:0;font-size:11px;color:%s;word-break:break-all">%s</p>
</div>""" % (
        date_str,
        C["bg"],
        C["danger"] if danger_n >= 5 else (C["warn"] if danger_n >= 1 else C["ok"]),
        head, chips_state, chips_sync,
        table,
        C["neutral"],
        url,
        C["neutral"], url)


def send(token, title, content, template="html"):
    body = json.dumps({
        "token": token, "title": title, "content": content,
        "template": template, "channel": "wechat",
    }).encode("utf-8")
    req = urllib.request.Request(
        PUSH_URL, data=body,
        headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            j = json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        raise SystemExit("PushPlus HTTP %s: %s" % (e.code, e.read().decode("utf-8", "ignore")[:200]))
    if j.get("code") != 200:
        raise SystemExit("PushPlus 拒绝: code=%s msg=%s" % (j.get("code"), j.get("msg")))
    return j


# ---------- 第②条消息：纯文本完整数据包（PushPlus「复制原文内容」原样复制） ----------

def replay_history(limit=15):
    """从每日归档重建近 N 日状态演变"""
    out = []
    if not RAW_ROOT.exists():
        return out
    for d in sorted(RAW_ROOT.iterdir())[-limit:]:
        f = d / "raw_market.json"
        if not f.exists():
            continue
        try:
            j = json.loads(f.read_text(encoding="utf-8"))
            s = (j.get("money_radar") or {}).get("summary") or {}
            out.append({"date": d.name,
                        "state_count": s.get("holding_state_count") or {},
                        "sync_count": s.get("holding_sync_count") or {}})
        except Exception:
            continue
    return out


def _pct5d(note):
    if not isinstance(note, str):
        return "—"
    for part in note.split("|"):
        part = part.strip()
        if part.startswith("5D涨跌"):
            return part.replace("5D涨跌", "")
    return "—"


def _yi(v):
    return ("%+.2f亿" % v) if isinstance(v, (int, float)) else "—"


def build_packet_text(latest):
    """纯文本数据包：复制即所得，任何 Agent 可直接分析"""
    mr = latest.get("money_radar") or {}
    holding = mr.get("holding_cabin") or []
    watch = mr.get("watch_cabin") or []
    summary = mr.get("summary") or {}
    history = replay_history()
    date_str = latest.get("date", "?")
    L = []
    L.append("【资金哨兵 · 三舱资金观察数据包 %s】" % date_str)
    L.append("")
    L.append("系统角色：资金哨兵是观察层（只看），只回答钱在往哪走、个股资金有没有恶化，不生成买卖指令；具体操作由交易执行单负责。禁止跨模块串证。")
    L.append("数据原则：只用真实资金（成交额+融资净买入，T+1披露），估算主力净流入仅参考不投票。阈值V1.0初定。")
    L.append("")
    L.append("【数据字典】")
    L.append("持仓舱5态：积累(价跌/平+资金流入) / 趋势(价涨+资金流入) / 分歧(价涨资金放缓或价平资金流出) / 衰竭(价涨+资金流出,顶部背离) / 爆发(价量齐升过热)")
    L.append("价资5种：有效推动(资升+价涨) / 真分歧(资升+价平,先手信号) / 顶部背离(资升价跌或价涨资降) / 抛压减轻(资降+价不跌) / 撤离(资降+价跌)")
    L.append("融资净买入单位亿元(真实T+1)；5日累计=近5日融资净买入之和；成交额单位亿元。")
    L.append("")
    L.append("【当日状态分布】")
    for k, v in (summary.get("holding_state_count") or {}).items():
        L.append("  持仓 %s ×%d" % (k, v))
    for k, v in (summary.get("holding_sync_count") or {}).items():
        L.append("  价资 %s ×%d" % (k, v))
    L.append("")
    L.append("【①持仓舱 8只】")
    L.append("代码 | 名称 | 状态 | 价资 | 收盘 | 当日涨跌 | 成交额 | 5D涨跌 | 融资净买入 | 5日累计")
    for s in holding:
        price = s.get("price") if isinstance(s.get("price"), (int, float)) else "—"
        pct = ("%+.2f%%" % s["pct_change_daily"]) if isinstance(s.get("pct_change_daily"), (int, float)) else "—"
        amt = ("%.2f亿" % s["amount_yi"]) if isinstance(s.get("amount_yi"), (int, float)) else "—"
        L.append(" | ".join([str(s.get("code", "")), s.get("name", ""), s.get("state", ""), s.get("sync_zh", ""),
                             str(price), pct, amt, _pct5d(s.get("sync_note")),
                             _yi(s.get("rzjme_yi")), _yi(s.get("rzjme_5d_yi"))]))
    L.append("")
    L.append("【②观察舱 %d只】" % len(watch))
    L.append("代码 | 名称 | 状态 | 价资 | 收盘 | 当日涨跌 | 成交额 | 5D涨跌")
    for s in watch:
        price = s.get("price") if isinstance(s.get("price"), (int, float)) else "—"
        pct = ("%+.2f%%" % s["pct_change_daily"]) if isinstance(s.get("pct_change_daily"), (int, float)) else "—"
        amt = ("%.2f亿" % s["amount_yi"]) if isinstance(s.get("amount_yi"), (int, float)) else "—"
        L.append(" | ".join([str(s.get("code", "")), s.get("name", ""), s.get("state", ""), s.get("sync_zh", ""),
                             str(price), pct, amt, _pct5d(s.get("sync_note"))]))
    L.append("")
    L.append("【③近%d个交易日状态演变】(看变化不看一天)" % len(history))
    L.append("日期 | 积累 | 趋势 | 分歧 | 衰竭 | 爆发 | 价资撤离")
    for h in history:
        sc, yc = h["state_count"], h["sync_count"]
        L.append(" | ".join([h["date"], str(sc.get("积累", 0)), str(sc.get("趋势", 0)), str(sc.get("分歧", 0)),
                             str(sc.get("衰竭", 0)), str(sc.get("爆发", 0)), str(yc.get("撤离", 0))]))
    L.append("")
    L.append("【请基于以上数据回答】")
    L.append("1. 近%d日资金在改善还是恶化？衰竭+撤离的数量是扩散还是收敛？" % len(history))
    L.append("2. 哪几只出现衰竭+撤离组合？融资净买入恶化看绝对值还是看5日累计斜率？")
    L.append("3. 有没有真分歧(资金升+价平)的先手信号？")
    L.append("4. 观察舱有无从观察转向启动/趋势的个股？资金迁移早期迹象？")
    L.append("5. 仅基于资金层证据(不做宏观/产业串证)，哪只该升级TPO复核？")
    L.append("")
    return "\n".join(L)


def main():
    token = load_pushplus_token()

    if "--test" in sys.argv:
        # ① 通道测试卡
        url = dashboard_url()
        html = ('<div style="font-family:sans-serif">'
                '<p style="font-size:15px">✅ <b>资金哨兵 · 推送通道测试（第①条·看结论）</b></p>'
                '<p style="color:#5f6368;font-size:13px">收到此消息说明通道正常。完整数据会在第②条消息，用底部「复制原文内容」复制。</p>'
                '<p style="text-align:center;margin-top:10px">'
                '<a target="_blank" rel="noopener" href="%s" '
                'style="display:inline-block;background:#5f6368;color:#fff;text-decoration:none;'
                'padding:8px 20px;border-radius:20px;font-size:12px">💻 完整网页（电脑浏览器）</a></p></div>') % url
        j1 = send(token, "资金哨兵 · 通道测试① ✅", html)
        print("测试①卡片: code=%s" % j1.get("code"))
        # ② 真实数据包（若 latest.json 存在）
        if FEED_FILE.exists() and FEED_FILE.stat().st_size > 0:
            latest = json.loads(FEED_FILE.read_text(encoding="utf-8"))
            j2 = send(token, "📦资金哨兵数据包 · 测试②（复制原文→粘贴给Agent）",
                      build_packet_text(latest), template="txt")
            print("测试②数据包: code=%s | 字符数=%d" % (j2.get("code"), len(build_packet_text(latest))))
        return 0

    if not FEED_FILE.exists() or FEED_FILE.stat().st_size == 0:
        raise SystemExit("latest.json 缺失，先跑 honghu_snapshot.py")
    latest = json.loads(FEED_FILE.read_text(encoding="utf-8"))

    # 非交易日保护：快照日期不是今天则不推（避免周末/节假日重复推旧报）
    import datetime as _dt
    today = _dt.date.today().isoformat()
    if latest.get("date") != today:
        print("跳过推送：最新快照日期 %s ≠ 今天 %s（非交易日或快照未更新）" % (latest.get("date"), today))
        return 0

    mr = latest.get("money_radar") or {}
    holding = mr.get("holding_cabin") or []
    danger_n = sum(1 for h in holding
                   if h["state"] in DANGER_STATES or h["sync_zh"] in DANGER_STATES)
    title_flag = "🔴" if danger_n >= 5 else ("🟠" if danger_n >= 3 else "")

    # ① 结论卡片（HTML）
    j1 = send(token, ("资金哨兵日报 %s %s" % (latest.get("date", ""), title_flag)).strip(),
              build_daily_html(latest))
    print("①日报已推送: code=%s" % j1.get("code"))

    # ② 完整数据包（纯文本，复制即所得，不依赖网页）
    packet = build_packet_text(latest)
    j2 = send(token, "📦资金哨兵数据包 %s（复制原文→粘贴给Agent）" % latest.get("date", ""),
              packet, template="txt")
    print("②数据包已推送: code=%s | %d 字" % (j2.get("code"), len(packet)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
