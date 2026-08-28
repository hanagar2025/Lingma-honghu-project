#!/usr/bin/env bash
# 本机把真实数据推进 Obsidian 看台。
#
# 存在理由：网页经常打不开，服务器 today.json 又可能停在旧代码。
# 本机可以自己拉真实行情、当场分析、把最后结果写进本地记事本。
#
# 用法（在代码目录，不要在家目录）：
#   OBSIDIAN_VAULT="/Users/muscap/投资助理/鸿鹄理财" ./scripts/obsidian-from-mac.sh refresh
#   OBSIDIAN_VAULT="/Users/muscap/投资助理/鸿鹄理财" ./scripts/obsidian-from-mac.sh pre
#   OBSIDIAN_VAULT="/Users/muscap/投资助理/鸿鹄理财" ./scripts/obsidian-from-mac.sh pull
#
# refresh：盘后。拉真实行情 → 程序分析 → 重写看台、结论、变化。
# pre：盘前 09:20。只出简报，不归档。
# pull：拉 hhwealth.cc 上已发布的 today.json，再渲染。服务器停在旧代码时，
#       看台会诚实说没有看台字段，但仍写出当时的结论和变化。
#
# 定时：交易日北京时间 09:20 跑 pre，15:10 跑 refresh。
# 可用 macOS 日历或 cron。不要和服务器档案抢同一本账：本机一律不归档。

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ACTION="${1:-refresh}"

cd "$ROOT"

case "$ACTION" in
refresh)
  npm run obsidian:refresh
  ;;
pre)
  npm run obsidian:pre
  ;;
pull)
  npm run obsidian:pull
  ;;
*)
  printf '用法：OBSIDIAN_VAULT=库路径 %s refresh|pre|pull\n' "$0" >&2
  exit 1
  ;;
esac
