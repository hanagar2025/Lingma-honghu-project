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
#   OBSIDIAN_VAULT="/Users/muscap/投资助理/鸿鹄理财" ./scripts/obsidian-from-mac.sh auto
#
# refresh：盘后。拉真实行情 → 程序分析 → 重写看台、结论、变化。不连 GitHub。
# pre：盘前 09:20。只出简报，不归档。不连 GitHub。
# pull：拉 hhwealth.cc 上已发布的 today.json，再渲染。服务器停在旧代码时，
#       看台会诚实说没有看台字段，但仍写出当时的结论和变化。
# auto：给本机时钟用。北京时间 12:00 前跑盘前，之后跑盘后。不连 GitHub。
#
# 日常拿数走本机：腾讯行情 → 本机分析 → 重写鸿鹄/看台.md。
# 不经过呼和浩特服务器，也不经过 GitHub。GitHub 只在改程序时才需要。
# 定时：交易日北京时间 09:20 跑 pre，15:10 跑 refresh。
# 装一次：./scripts/install-mac-clock.sh install
# 不要和服务器档案抢同一本账：本机一律不归档。

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ACTION="${1:-refresh}"
HOUR="$(TZ=Asia/Shanghai date +%H)"

cd "${ROOT}"

case "${ACTION}" in
refresh)
  npm run obsidian:refresh
  ;;
pre)
  npm run obsidian:pre
  ;;
pull)
  npm run obsidian:pull
  ;;
auto)
  if [ "${HOUR}" -lt 12 ]; then
    npm run obsidian:pre
  else
    npm run obsidian:refresh
  fi
  ;;
*)
  printf '用法：OBSIDIAN_VAULT=库路径 %s refresh|pre|pull|auto\n' "$0" >&2
  exit 1
  ;;
esac
