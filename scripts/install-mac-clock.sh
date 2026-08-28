#!/usr/bin/env bash
# 在本机装一次时钟。之后交易日 09:20 / 15:10 自动重算看台，写入 Obsidian。
# 日常拿数不连 GitHub，也不经过呼和浩特服务器。不写档案。档案只在服务器上记。
set -euo pipefail

LABEL="cc.hhwealth.clock"
PLIST_NAME="${LABEL}.plist"
PLIST_PATH="${HOME}/Library/LaunchAgents/${PLIST_NAME}"
LOG_PATH="${HOME}/Library/Logs/honghu-clock.log"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
VAULT="${OBSIDIAN_VAULT:-${ROOT}/鸿鹄理财}"
RUNNER="${SCRIPT_DIR}/obsidian-from-mac.sh"
ACTION="${1:-}"
HOMEBREW_BIN="/opt/homebrew/bin"
USR_LOCAL_BIN="/usr/local/bin"
USR_BIN="/usr/bin"
BIN_DIR="/bin"
CLOCK_PATH="${PATH:-${HOMEBREW_BIN}:${USR_LOCAL_BIN}:${USR_BIN}:${BIN_DIR}}"
CLOCK_PATH="${HOMEBREW_BIN}:${USR_LOCAL_BIN}:${CLOCK_PATH}"

usage() {
  echo "用法: $0 install | uninstall | status | run-now"
  echo "install    装到本机。交易日 09:20 盘前、15:10 盘后自动重算看台。"
  echo "uninstall  卸掉本机时钟。"
  echo "status     看时钟在不在、下次会不会跑。"
  echo "run-now    现在立刻重算一次，不等人。不连 GitHub。"
}

need_mac() {
  if [ "$(uname -s)" != "Darwin" ]; then
    echo "这个安装只在苹果电脑上跑。现在这台不是。"
    exit 1
  fi
}

need_runner() {
  if [ ! -f "${RUNNER}" ]; then
    echo "找不到 ${RUNNER}"
    exit 1
  fi
  if [ ! -f "${ROOT}/package.json" ]; then
    echo "找不到代码目录 ${ROOT}"
    exit 1
  fi
}

write_plist() {
  mkdir -p "${HOME}/Library/LaunchAgents"
  mkdir -p "$(dirname "${LOG_PATH}")"
  python3 - "${PLIST_PATH}" "${ROOT}" "${VAULT}" "${RUNNER}" "${LOG_PATH}" "${LABEL}" "${CLOCK_PATH}" <<'PY'
import plistlib
import sys
from pathlib import Path

out, root, vault, runner, log, label, clock_path = sys.argv[1:8]
intervals = []
for weekday in range(1, 6):
    intervals.append({"Weekday": weekday, "Hour": 9, "Minute": 20})
    intervals.append({"Weekday": weekday, "Hour": 15, "Minute": 10})
payload = {
    "Label": label,
    "WorkingDirectory": root,
    "ProgramArguments": [
        "/bin/bash",
        runner,
        "auto",
    ],
    "EnvironmentVariables": {
        "HONGHU_ROOT": root,
        "OBSIDIAN_VAULT": vault,
        "ARCHIVE": "0",
        "TZ": "Asia/Shanghai",
        "PATH": clock_path,
    },
    "StartCalendarInterval": intervals,
    "StandardOutPath": log,
    "StandardErrorPath": log,
    "RunAtLoad": False,
    "ProcessType": "Background",
}
Path(out).write_bytes(plistlib.dumps(payload))
print(out)
PY
}

load_agent() {
  local uid
  uid="$(id -u)"
  if launchctl bootstrap "gui/${uid}" "${PLIST_PATH}" 2>/dev/null; then
    return 0
  fi
  launchctl unload "${PLIST_PATH}" 2>/dev/null || true
  launchctl load "${PLIST_PATH}"
}

unload_agent() {
  local uid
  uid="$(id -u)"
  if launchctl bootout "gui/${uid}/${LABEL}" 2>/dev/null; then
    return 0
  fi
  if [ -f "${PLIST_PATH}" ]; then
    launchctl unload "${PLIST_PATH}" 2>/dev/null || true
  fi
}

print_status() {
  echo "代码目录  ${ROOT}"
  echo "笔记库    ${VAULT}"
  echo "时钟文件  ${PLIST_PATH}"
  echo "运行日志  ${LOG_PATH}"
  if [ -f "${PLIST_PATH}" ]; then
    echo "时钟文件已在。"
  else
    echo "时钟文件还没有。先跑 ./scripts/install-mac-clock.sh install"
  fi
  if command -v launchctl >/dev/null 2>&1; then
    if launchctl list 2>/dev/null | grep -q "${LABEL}"; then
      echo "本机时钟已装上。"
    else
      echo "本机时钟还没装上，或者这台不是苹果电脑。"
    fi
  fi
}

case "${ACTION}" in
  install)
    need_mac
    need_runner
    chmod +x "${RUNNER}" || true
    unload_agent || true
    write_plist
    load_agent
    echo "已装上本机时钟。"
    echo "交易日北京时间 09:20 盘前、15:10 盘后，会自动重算看台。"
    echo "数据从行情源直接进本机，不经过呼和浩特服务器，也不连 GitHub。"
    echo "电脑开着才会跑。睡着会错过这一次。"
    echo "打开 Obsidian 看 鸿鹄/看台.md。"
    print_status
    ;;
  uninstall)
    need_mac
    unload_agent || true
    rm -f "${PLIST_PATH}"
    echo "已卸掉本机时钟。"
    ;;
  status)
    print_status
    ;;
  run-now)
    need_runner
    echo "现在立刻重算一次。不连 GitHub。不写档案。"
    cd "${ROOT}"
    OBSIDIAN_VAULT="${VAULT}" ARCHIVE=0 TZ=Asia/Shanghai "${RUNNER}" auto
    ;;
  *)
    usage
    exit 1
    ;;
esac
