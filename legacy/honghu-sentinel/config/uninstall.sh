#!/bin/bash
# 卸载资金哨兵 launchd 定时任务（不删除任何数据档案）

set -e
PLIST_NAME="com.honghu.daily-snapshot"
PLIST_FILE="$HOME/Library/LaunchAgents/$PLIST_NAME.plist"

echo "卸载资金哨兵收盘快照定时任务..."

launchctl unload "$PLIST_FILE" 2>/dev/null || echo "（任务未加载，跳过）"
rm -f "$PLIST_FILE"

echo "✅ 已卸载。数据档案与代码均保留不变。"
echo "需要恢复：重新执行 config/install.sh"
