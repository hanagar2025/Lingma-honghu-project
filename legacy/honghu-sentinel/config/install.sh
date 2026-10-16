#!/bin/bash
# ============================================================================
# 资金哨兵（Honghu Sentinel）· macOS launchd 定时部署脚本
#
# 适用：在本机用 launchd 每个交易日 15:35 自动跑快照。
#      服务器/阿里云部署不需要本脚本，请改用 cron / systemd / 容器调度。
#
# 可通过环境变量覆盖：
#   HONGHU_VAULT  研究库数据根目录（默认 /Users/<你>/鸿鹄研究库）
#
# 用法：
#   bash config/install.sh
#   HONGHU_VAULT=/data/honghu bash config/install.sh
# ============================================================================
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PKG_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SRC_DIR="$PKG_DIR/src"
LOG_DIR="$PKG_DIR/logs"

VAULT_DIR="${HONGHU_VAULT:-$HOME/鸿鹄研究库}"
PLIST_NAME="com.honghu.daily-snapshot"
PLIST_FILE="$HOME/Library/LaunchAgents/$PLIST_NAME.plist"

echo "== 资金哨兵 · launchd 定时部署 =="
echo "  代码目录 : $SRC_DIR"
echo "  数据目录 : $VAULT_DIR"
echo "  日志目录 : $LOG_DIR"

# 0. 前置检查
[ -f "$SRC_DIR/honghu_snapshot.py" ] || { echo "❌ 找不到 $SRC_DIR/honghu_snapshot.py"; exit 1; }
[ -d "$VAULT_DIR" ] || echo "⚠️  数据目录尚不存在：$VAULT_DIR（首次运行会自动创建）"
mkdir -p "$LOG_DIR"

# 1. 渲染 plist 占位符
sed -e "s|__VAULT_DIR__|$VAULT_DIR|g" \
    -e "s|__SNAPSHOT_PY__|$SRC_DIR/honghu_snapshot.py|g" \
    -e "s|__LOG_DIR__|$LOG_DIR|g" \
    -e "s|__HOME__|$HOME|g" \
    "$SCRIPT_DIR/$PLIST_NAME.plist" > "$PLIST_FILE"
echo "✅ plist 已生成：$PLIST_FILE"

# 2. 加载
launchctl unload "$PLIST_FILE" 2>/dev/null || true
launchctl load "$PLIST_FILE"
echo "✅ launchd 任务已加载：$(launchctl list | grep honghu || echo '⚠️ 未列出，请检查')"

# 3. Python 环境检查（脚本零第三方依赖）
python3 -c "import json, urllib.request, datetime, argparse" && echo "✅ Python 标准库 OK（零第三方依赖）"

cat <<EOF

== 部署完成 ==
触发时间   ：周一至周五 15:35（收盘后5分钟）
手动测试   ：HONGHU_VAULT="$VAULT_DIR" python3 "$SRC_DIR/honghu_snapshot.py"
微信推送   ：需配置 PushPlus token（见 config/settings.example.json）
网页发布   ：需配置 CloudBase 环境（迁阿里云后将替换该适配器）
卸载       ：bash "$SCRIPT_DIR/uninstall.sh"
EOF
