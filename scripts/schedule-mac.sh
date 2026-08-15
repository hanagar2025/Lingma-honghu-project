#!/usr/bin/env bash
# 在 Mac 上装两个定时任务：盘前 09:20、盘后 15:10 各发布一次
#
# ── 为什么在 Mac 上跑，而不在服务器上 ──
#
# 服务器 always-on，看起来更适合放定时任务。但**加密快照必须在持有口令的机器上生成**，
# 而整套加密的前提正是"服务端自己也解不开"。把口令放到服务器上，
# 那句话立刻变成假的：服务器能生成密文，就能解开密文。
# 这不是理论风险 —— 服务器暴露在公网、有历史遗留应用、root 可被他人接管，
# 而你的 Mac 不是。所以生成留在 Mac，服务器只当静态托管。
#
# 代价是 Mac 得醒着并联网。launchd 会把睡眠期间错过的任务在唤醒后补跑一次
# （cron 不会，这是选 launchd 而非 crontab 的原因）。
#
# 口令从 macOS 钥匙串取，不落盘、不进 plist、不进环境变量文件。
#
# 用法：
#   ./scripts/schedule-mac.sh install
#   ./scripts/schedule-mac.sh status
#   ./scripts/schedule-mac.sh uninstall
#   ./scripts/schedule-mac.sh run-now      立即跑一次，看日志

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOST="${DEPLOY_HOST:-39.104.86.200}"
KEY="${DEPLOY_KEY:-$HOME/.ssh/tios_ecs}"
KEYCHAIN_ITEM="${TIOS_KEYCHAIN_ITEM:-tios-deploy-passphrase}"
LABEL_PRE="cc.hhwealth.tios.preopen"
LABEL_POST="cc.hhwealth.tios.postclose"
AGENTS="$HOME/Library/LaunchAgents"
LOGDIR="$HOME/Library/Logs/tios"
LINE="$(printf '─%.0s' {1..70})"

die() { printf '\n\033[31m✗ %s\033[0m\n\n' "$1" >&2; exit 1; }
step() { printf '\n%s\n%s\n%s\n' "$LINE" "$1" "$LINE"; }

[[ "$(uname)" == "Darwin" ]] || die "本脚本用 launchd，只支持 macOS。Linux 请改用 systemd timer 或 cron。"

ACTION="${1:-}"

write_plist() {
  local label="$1" hour="$2" minute="$3"
  mkdir -p "$AGENTS" "$LOGDIR"
  cat > "$AGENTS/$label.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>-lc</string>
    <!-- 口令不写在这里。NONINTERACTIVE=1 会让部署脚本从钥匙串取，
         plist 是明文文件且会被 Time Machine 备份，绝不能放秘密。 -->
    <string>cd ${ROOT} &amp;&amp; NONINTERACTIVE=1 DEPLOY_HOST=${HOST} DEPLOY_KEY=${KEY} TIOS_KEYCHAIN_ITEM=${KEYCHAIN_ITEM} ./scripts/deploy-ecs.sh</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key><integer>${hour}</integer>
    <key>Minute</key><integer>${minute}</integer>
  </dict>
  <key>StandardOutPath</key><string>${LOGDIR}/${label}.log</string>
  <key>StandardErrorPath</key><string>${LOGDIR}/${label}.log</string>
  <key>RunAtLoad</key><false/>
</dict>
</plist>
PLIST
}

case "$ACTION" in
install)
  step "检查前置条件"
  [[ -f "$KEY" ]] || die "找不到 SSH 私钥 ${KEY}。先跑 ./scripts/setup-ssh-key.sh"
  if ! security find-generic-password -a "$USER" -s "$KEYCHAIN_ITEM" -w >/dev/null 2>&1; then
    printf '\n  钥匙串里还没有解锁口令。现在存一次（只需一次）：\n\n'
    printf '    security add-generic-password -a "$USER" -s %s -w\n\n' "$KEYCHAIN_ITEM"
    printf '  回车后会提示输入，输入时不回显；存好再重跑本脚本。\n'
    printf '  这样口令不会出现在 shell 历史、plist 或任何文件里。\n\n'
    exit 1
  fi
  printf '  ✓ SSH 私钥 %s\n' "$KEY"
  printf '  ✓ 钥匙串条目「%s」\n' "$KEYCHAIN_ITEM"

  step "安装定时任务"
  write_plist "$LABEL_PRE" 9 20
  write_plist "$LABEL_POST" 15 10
  for l in "$LABEL_PRE" "$LABEL_POST"; do
    launchctl unload "$AGENTS/$l.plist" 2>/dev/null || true
    launchctl load "$AGENTS/$l.plist"
    printf '  ✓ 已装 %s\n' "$l"
  done

  cat <<EOF

  时间按「你 Mac 的本地时区」。若 Mac 不在北京时区，请自行换算：
    当前时区 $(date +%Z)，本地时间 $(date +%H:%M)，北京时间 $(TZ=Asia/Shanghai date +%H:%M)

  两个时点：
    09:20  盘前 —— 只更新持仓风险、超限与必办；不写入 30 天档案
    15:10  盘后 —— 完整报告并归档（收盘后 10 分钟，避开集合竞价余波）

  休市日会自动跳过：判据是"行情源给出的最新K线日期是否等于今天"。
  不用节假日日历 —— 日历会因调休和临时休市过期，而"最新K线是哪天"永远是当下的事实。

  日志：$LOGDIR/
    tail -f $LOGDIR/$LABEL_POST.log

EOF
  ;;

uninstall)
  step "卸载定时任务"
  for l in "$LABEL_PRE" "$LABEL_POST"; do
    launchctl unload "$AGENTS/$l.plist" 2>/dev/null || true
    rm -f "$AGENTS/$l.plist"
    printf '  ✓ 已卸 %s\n' "$l"
  done
  printf '\n  钥匙串里的口令与 SSH 私钥保持原样，没有删除。\n\n'
  ;;

status)
  step "定时任务状态"
  for l in "$LABEL_PRE" "$LABEL_POST"; do
    if launchctl list | grep -q "$l"; then
      printf '  ✓ %s 已加载\n' "$l"
    else
      printf '  ✗ %s 未加载\n' "$l"
    fi
  done
  printf '\n  线上当前发布的交易日：\n'
  curl -s --max-time 20 "https://hhwealth.cc/data/today.enc.json" 2>/dev/null \
    | python3 -c "
import json,sys
try:
    d=json.load(sys.stdin)
    print('    交易日', d.get('snapshotDate') or '未知', '｜生成于', d.get('generatedAt') or '未知')
except Exception:
    print('    取不到（页面可能未部署，或返回的不是密文）')
" 2>/dev/null || printf '    取不到\n'
  printf '\n  最近日志：\n'
  tail -n 12 "$LOGDIR/$LABEL_POST.log" 2>/dev/null | sed 's/^/    /' || printf '    还没有日志\n'
  printf '\n'
  ;;

run-now)
  step "立即执行一次（等同定时任务的行为）"
  cd "$ROOT"
  NONINTERACTIVE=1 DEPLOY_HOST="$HOST" DEPLOY_KEY="$KEY" \
    TIOS_KEYCHAIN_ITEM="$KEYCHAIN_ITEM" ./scripts/deploy-ecs.sh
  ;;

*)
  cat <<EOF

用法：./scripts/schedule-mac.sh <install|uninstall|status|run-now>

  install    装两个定时任务（盘前 09:20 / 盘后 15:10）
  status     看是否加载、线上发布的是哪个交易日、最近日志
  run-now    立即跑一次，验证钥匙串与 SSH 都通
  uninstall  卸载（不动钥匙串与私钥）

EOF
  exit 1
  ;;
esac
