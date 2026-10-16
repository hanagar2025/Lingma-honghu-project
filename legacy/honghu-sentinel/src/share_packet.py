#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
鸿鹄 · 一键分享工具
用法：
  python3 share_packet.py today    # 复制今日完整数据包到剪贴板 + 桌面文件夹
  python3 share_packet.py bundle   # 把所有交易日累计成一份趋势数据包，复制到剪贴板
  python3 share_packet.py folder   # 只打开桌面文件夹

双击桌面的「📤鸿鹄·一键分享.command」会弹出选择菜单，等价于上述三种模式。
"""
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

VAULT = Path(os.environ.get("HONGHU_VAULT", "/Users/muscap/鸿鹄研究库"))
SHARE_DIR = VAULT / "99_每日数据包"
DESKTOP_DIR = Path.home() / "Desktop" / "鸿鹄数据包"


def pbcopy(text: str):
    """复制文本到 macOS 剪贴板"""
    subprocess.run(["pbcopy"], input=text.encode("utf-8"), check=False)


def notify(title: str, msg: str):
    safe = msg.replace('"', "'").replace("\\", "")
    subprocess.run(["osascript", "-e",
                    'display notification "%s" with title "%s"' % (safe, title)],
                   check=False)


def open_folder():
    DESKTOP_DIR.mkdir(parents=True, exist_ok=True)
    subprocess.run(["open", str(DESKTOP_DIR)], check=False)


def publish_to_desktop():
    """把研究库里最新的 md/json 复制到桌面文件夹（每日快照也会自动调用）"""
    DESKTOP_DIR.mkdir(parents=True, exist_ok=True)
    copied = []
    for name, stable in (("latest_PM.md", "⭐最新_AI主线数据包.md"),
                         ("latest_PM.json", "⭐最新_AI主线数据包.json")):
        link = SHARE_DIR / name
        if link.exists():
            real = link.resolve()
            shutil.copy2(real, DESKTOP_DIR / real.name)               # 带日期的副本
            shutil.copy2(real, DESKTOP_DIR / stable)                  # 固定文件名，永远最新
            copied.append(real.name)
    return copied


def load_all_packets():
    packets = []
    for f in sorted(SHARE_DIR.glob("AI_INFRA_PM_*.json")):
        try:
            packets.append(json.loads(f.read_text(encoding="utf-8")))
        except Exception:
            pass
    return packets


def _f(v, fmt="%+.2f"):
    return (fmt % v) if isinstance(v, (int, float)) else "—"


def build_bundle(packets):
    """把多个交易日的数据包累计成一份趋势数据包（供外部AI看'变化'，不是看'一天'）"""
    L = []
    L.append("# 鸿鹄AI主线监测 · 多日累计数据包（%d 个交易日）" % len(packets))
    L.append("")
    L.append("> **体系**：五状态（集中/扩散/迁移/再集中/退潮）→ Gate1产业门 → Gate2资金门(5项≥4) → Gate3迁移门 → R0/R1/R1.5/R2/R2.5/R3；TPO独立计撤退分。")
    L.append("> **原则**：不预测涨跌，只识别盈利→资金→相对强度→成交定价权的迁移；不因故事买入，只因Gate逐级通过加仓；机器算数据，人做最终决策。")
    L.append("")
    L.append("## 一、每日核心指标趋势（这是判断'涨'还是'获定价权'的关键）")
    L.append("")
    L.append("| 日期 | 日序 | 市场状态 | PCB阶段 | Gate2 | 基准5D% | 基准10D% | PCB-光模块 5D RS差 | 10D RS差 | 成交额比 |")
    L.append("|------|------|---------|---------|-------|--------|---------|------------------|---------|---------|")
    for p in packets:
        m, g, b = p["migration"], p["gate2"], p["benchmark"]
        L.append("| %s | %s | %s | %s | %s | %s | %s | %s | %s | %s |" % (
            p["date"], p.get("day_index", ""), p["market_state"], g["r_stage"], g["score"],
            _f(b["curve1_5d_pct"], "%.2f"), _f(b["curve1_10d_pct"], "%.2f"),
            _f(m["pcb_opt_rs5_diff"]), _f(m["pcb_opt_rs10_diff"]),
            _f(m["pcb_curve1_amount_ratio"], "%.3f")))
    L.append("")
    L.append("**读法**：")
    L.append("- 10D RS差 持续>0 = PCB 10日维度相对光模块获定价权；若回落转负 = 反证")
    L.append("- 5D RS差 仍<0 = 第一曲线短期没退场（扩散非迁移）；转正且 Gate2≥4 = 迁移门接近")
    L.append("- 成交额比连续5日上升 = Gate2 第③项（9/10–9/16 五日实验就是为了确认它）")
    L.append("")

    # 最新日完整数据
    latest = packets[-1]
    L.append("## 二、最新交易日完整数据（%s · %s）" % (latest["date"], latest.get("day_index", "")))
    L.append("")
    md_file = SHARE_DIR / ("AI_INFRA_PM_%s.md" % latest["date"].replace("-", ""))
    if md_file.exists():
        body = md_file.read_text(encoding="utf-8").splitlines()
        L.append("\n".join(body[1:]))  # 去掉重复的标题行
    L.append("")

    L.append("## 三、请基于多日趋势回答")
    L.append("")
    L.append("1. 综合 %d 个交易日，市场处于五状态中的哪一个？是否正从【扩散】走向【迁移】？" % len(packets))
    L.append("2. PCB 现在是单纯'上涨'，还是已经'获得相对于光模块的定价权'？请用表中 RS 差和成交额比的变化论证。")
    L.append("3. Gate2 五项各自走向如何？还差什么才到 R2？")
    L.append("4. 持仓风险位（见最新日数据）：触及止损线的标的应如何按纪律处理？")
    L.append("5. 当前应不应该动钱？若动，第一笔从哪里释放、买哪个确认器？")
    L.append("")
    return "\n".join(L)


def mode_today():
    publish_to_desktop()
    md = SHARE_DIR / "latest_PM.md"
    if not md.exists():
        notify("鸿鹄分享", "还没有数据包，请先运行快照")
        return 1
    text = md.resolve().read_text(encoding="utf-8")
    pbcopy(text)
    open_folder()
    notify("鸿鹄分享", "今日数据包已复制到剪贴板，去AI对话框 Cmd+V 即可")
    print("✅ 今日完整数据包已复制到剪贴板（%d 字）" % len(text))
    print("📁 文件位置：%s" % DESKTOP_DIR)
    return 0


def mode_bundle():
    publish_to_desktop()
    packets = load_all_packets()
    if not packets:
        notify("鸿鹄分享", "还没有数据包")
        return 1
    bundle = build_bundle(packets)
    pbcopy(bundle)
    out = DESKTOP_DIR / ("⭐鸿鹄_累计%d日数据包.md" % len(packets))
    DESKTOP_DIR.mkdir(parents=True, exist_ok=True)
    out.write_text(bundle, encoding="utf-8")
    open_folder()
    notify("鸿鹄分享", "累计%d日数据包已复制，直接粘贴给AI" % len(packets))
    print("✅ 累计 %d 个交易日的数据包已复制到剪贴板（%d 字）" % (len(packets), len(bundle)))
    print("📁 累计文件：%s" % out)
    return 0


def mode_folder():
    publish_to_desktop()
    open_folder()
    return 0


if __name__ == "__main__":
    m = sys.argv[1] if len(sys.argv) > 1 else "today"
    if m == "today":
        sys.exit(mode_today())
    if m == "bundle":
        sys.exit(mode_bundle())
    if m == "folder":
        sys.exit(mode_folder())
    if m == "publish":   # 供快照脚本调用：只发布文件到桌面
        publish_to_desktop()
        sys.exit(0)
    print("unknown mode: %s" % m)
    sys.exit(1)
