#!/usr/bin/env bash
# 在服务器上装定时更新：盘前 09:20、盘后 15:10 各生成一次快照
#
# ── 为什么这次可以放在服务器上 ──
#
# 之前不行，因为加密快照必须在持有口令的机器上生成，而"服务端自己也解不开"
# 是那套设计的前提 —— 口令一旦上服务器，那句话立刻变成假的。
# 委员会 2026-08-15 决议去掉口令后，这个约束消失了：
# 生成快照不再需要任何秘密，服务器可以自己算自己发。
#
# 因此 Mac 可以关机。这也是这个脚本存在的全部理由。
#
# ── 只更新数据，不重建前端 ──
#
# 每天变的只有 data/today.json（约 380KB）。前端 JS/CSS 只在代码变动时才需要重建，
# 那件事继续从 Mac 上用 deploy-ecs.sh 做。
# 服务器上跑 vite 构建既慢又要装一堆构建期依赖，没有必要。
#
# 用法（在 Mac 上执行，它会 ssh 到服务器完成安装）：
#   DEPLOY_HOST=39.104.86.200 DEPLOY_KEY=~/.ssh/tios_ecs ./scripts/schedule-server.sh install
#   ... status | uninstall | run-now
#
# 前提：先用 deploy-ecs.sh 部署过一次（服务器上要有 /var/www/tios 与前端产物）。

set -euo pipefail

# 仓库根目录。pull-archive 要把服务器上的档案写回本地，需要它 ——
# 之前漏了这行，pull-archive 一跑就会报 ROOT: unbound variable。
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOST="${DEPLOY_HOST:-39.104.86.200}"
USER_="${DEPLOY_USER:-root}"
KEY="${DEPLOY_KEY:-$HOME/.ssh/tios_ecs}"
WEBROOT="${DEPLOY_PATH:-/var/www/tios}"
REPO="${TIOS_REPO:-https://github.com/hanagar2025/Lingma-honghu-project.git}"
BRANCH="${TIOS_BRANCH:-cursor/cockpit-lookout-c819}"
REMOTE_DIR="/opt/tios"
LINE="$(printf '─%.0s' {1..70})"

die() { printf '\n\033[31m✗ %s\033[0m\n\n' "$1" >&2; exit 1; }
step() { printf '\n%s\n%s\n%s\n' "$LINE" "$1" "$LINE"; }

# ── 远端命令一律不许交互 ──
# 实测踩过：update 在远端 git fetch 处被挂起（^Z suspended）。
# 任何可能弹提示的远端命令，在没有 TTY 时都会变成 hang，
# 而 hang 看起来像"脚本坏了"，方向完全指错 —— 失败即退比卡住好得多。
SSH_OPTS=(-o ConnectTimeout=15 -o ServerAliveInterval=15 -o ServerAliveCountMax=4)
if [[ -f "$KEY" ]]; then
  # 有密钥就禁掉一切口令提示；没有密钥时保留交互，让人能输服务器密码
  SSH_OPTS+=(-i "$KEY" -o BatchMode=yes)
fi
rsh() { ssh "${SSH_OPTS[@]}" "$USER_@$HOST" "$@"; }

# 写入服务器上的更新脚本。install 与 update 共用 ——
# 缺了共用入口的后果实测过一次：改了 FORCE 支持后服务器仍是旧脚本，
# 现象看起来像"FORCE 没生效"而不是"脚本没更新"。
write_updater() {
  # 脚本里带交易日闸门：休市日行情源给出的最新K线仍是上一个交易日的，
  # 此时覆盖线上文件只会把"数据日期"刷成今天，让人误以为看的是今天的数据。
  rsh "REMOTE_DIR='$REMOTE_DIR' WEBROOT='$WEBROOT' bash -s" <<'WRITER'
set -euo pipefail
sudo tee "$REMOTE_DIR/update-snapshot.sh" > /dev/null <<'INNER'
#!/usr/bin/env bash
# 由 cron 调用。生成当日快照并放进站点目录。
set -euo pipefail
export PATH=/usr/local/bin:/usr/bin:/bin
cd /opt/tios

SESSION="${1:-post}"
# FORCE=1 跳过交易日闸门。**只给 run-now 用。**
# 缺了它，休市日 run-now 会在闸门处退出，于是"管线到底通不通"这件事
# 要等到下一个交易日才知道 —— 而那时若是坏的，观察期已经丢掉一天。
# 测试的目的正是在真正需要它之前先失败一次。
FORCE="${FORCE:-0}"
# NOPULL=1 跳过拉代码（排障时用）。默认拉 —— 见下方理由。
NOPULL="${NOPULL:-0}"
BRANCH_REF="${TIOS_BRANCH:-cursor/cockpit-lookout-c819}"
LOG=/var/log/tios-update.log
exec >> "$LOG" 2>&1
echo "=== $(date '+%F %T %Z') session=$SESSION force=$FORCE ==="

# ── 先拉代码，再生成 ──
#
# 实测踩过：此脚本原本不拉代码，于是 cron 每天忠实地用同一份旧代码跑下去。
# 8/15 08:20 GMT 部署过一次，而资产层是 09:45 GMT 提交的 ——
# 之后两天的全部改动（组合口径分母、630 万峰值、一级熔断、风控四层）都不在服务器上。
#
# 最糟的部分不是"没更新"，而是**它不会报错**：
# 旧代码照样生成一份完整报告，只是用的是旧口径与旧持仓。
# 一份看起来正常、数字全错的报告，比一份生成失败的报告危险得多。
if [[ "$NOPULL" != "1" ]]; then
  if git -C /opt/tios fetch --quiet origin "$BRANCH_REF" 2>/dev/null \
    && git -C /opt/tios reset --hard --quiet "origin/$BRANCH_REF" 2>/dev/null; then
    echo "已拉取 origin/$BRANCH_REF → $(git -C /opt/tios rev-parse --short HEAD)"
    # 依赖可能随代码变化。--omit=dev 保持轻量；失败不阻断（多数改动不涉及新依赖）
    npm ci --omit=dev --silent 2>/dev/null || echo "  npm ci 跳过（不影响 tsx 直跑）"
  else
    echo "⚠ 拉取失败，继续用本地代码 $(git -C /opt/tios rev-parse --short HEAD 2>/dev/null || echo '未知')"
  fi
fi

# 把正在运行的代码版本写进环境，供快照自报版本 ——
# 缺了这个，从外部完全无法判断服务器在跑哪一版（这次就是这样被瞒过去的）。
export TIOS_CODE_COMMIT="$(git -C /opt/tios rev-parse --short HEAD 2>/dev/null || echo 'unknown')"
export TIOS_CODE_COMMITTED_AT="$(git -C /opt/tios log -1 --format=%cI 2>/dev/null || echo '')"
echo "代码版本 $TIOS_CODE_COMMIT （提交于 ${TIOS_CODE_COMMITTED_AT:-未知}）"

# 盘前只出简报不归档；盘后完整并归档
if [[ "$SESSION" == "pre" ]]; then
  SESSION=pre WEB=1 npx tsx backend/src/services/cockpit/run.ts || { echo "生成失败"; exit 1; }
else
  WEB=1 SHARE=1 npx tsx backend/src/services/cockpit/run.ts || { echo "生成失败"; exit 1; }
fi

SRC=/opt/tios/frontend/public/data/today.json
[[ -s "$SRC" ]] || { echo "快照文件为空或不存在，放弃发布"; exit 1; }

# 交易日闸门：最新K线不是今天就不发布。
# 不用节假日日历 —— 日历会因调休与临时休市过期，而"最新K线是哪天"永远是当下的事实。
SNAP_DATE=$(node -e "try{console.log(require('$SRC').date||'')}catch(e){console.log('')}")
TODAY=$(TZ=Asia/Shanghai date +%F)
if [[ -n "$SNAP_DATE" && "$SNAP_DATE" != "$TODAY" ]]; then
  if [[ "$FORCE" == "1" ]]; then
    echo "最新K线 $SNAP_DATE ≠ 今天 ${TODAY}，但 FORCE=1 → 仍然发布（用于验证管线）"
    echo "  注意：页面上显示的交易日会是 ${SNAP_DATE}，不是今天。这是对的。"
  else
    echo "最新K线 $SNAP_DATE ≠ 今天 ${TODAY}（休市或数据未更新），跳过发布"
    exit 0
  fi
fi

install -o www-data -g www-data -m 644 "$SRC" /var/www/tios/data/today.json
echo "已发布，交易日 $SNAP_DATE"
INNER
sudo chmod +x "$REMOTE_DIR/update-snapshot.sh"
sudo mkdir -p /var/log && sudo touch /var/log/tios-update.log
echo "  已写入 $REMOTE_DIR/update-snapshot.sh"
WRITER
}

ACTION="${1:-}"

case "$ACTION" in
install)
  step "一、检查服务器环境"
  rsh 'bash -s' <<'PROBE'
set -euo pipefail
echo "  系统：$(. /etc/os-release; echo "$PRETTY_NAME")"
if command -v node >/dev/null 2>&1; then
  echo "  Node：$(node -v)"
else
  echo "  Node：未安装"
fi
echo "  站点目录：$(test -d /var/www/tios && echo 存在 || echo 缺失)"
PROBE

  step "二、安装 Node 20（若需要）与仓库"
  # Ubuntu 20.04 的 apt 源里 Node 只有 v10/v12，跑不了 tsx（需要 18+），
  # 故走 NodeSource。已经装了合适版本就跳过，不重复折腾系统。
  rsh "REPO='$REPO' BRANCH='$BRANCH' REMOTE_DIR='$REMOTE_DIR' bash -s" <<'SETUP'
set -euo pipefail
NEED_NODE=1
if command -v node >/dev/null 2>&1; then
  MAJOR=$(node -v | sed 's/^v\([0-9]*\).*/\1/')
  [[ "$MAJOR" -ge 18 ]] && NEED_NODE=0
fi
if [[ "$NEED_NODE" == "1" ]]; then
  echo "  安装 Node 20……"
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - >/dev/null 2>&1
  sudo apt-get install -y nodejs >/dev/null 2>&1
fi
echo "  Node $(node -v)"

command -v git >/dev/null 2>&1 || sudo apt-get install -y git >/dev/null 2>&1

export GIT_TERMINAL_PROMPT=0
export GIT_ASKPASS=/bin/true
if [[ -d "$REMOTE_DIR/.git" ]]; then
  echo "  仓库已存在，拉取最新……"
  sudo -n git -C "$REMOTE_DIR" fetch --quiet origin "$BRANCH"
  sudo -n git -C "$REMOTE_DIR" reset --hard --quiet "origin/$BRANCH"
else
  echo "  克隆仓库到 ${REMOTE_DIR}……"
  sudo -n git clone --quiet --branch "$BRANCH" --depth 20 "$REPO" "$REMOTE_DIR"
fi

echo "  安装依赖（npm ci，不会改动 lock 文件）……"
cd "$REMOTE_DIR"
sudo npm ci --omit=dev --no-audit --no-fund >/dev/null 2>&1 || sudo npm ci --no-audit --no-fund >/dev/null 2>&1
echo "  依赖就绪"
SETUP

  step "三、写入更新脚本"
  write_updater

  step "四、装 cron"
  # 服务器时区可能不是北京，故 cron 项显式带 CRON_TZ，避免"09:20 到底是哪个 09:20"
  rsh "REMOTE_DIR='$REMOTE_DIR' bash -s" <<'CRON'
set -euo pipefail
sudo tee /etc/cron.d/tios > /dev/null <<INNER
# TIOS 驾驶舱定时更新。由 scripts/schedule-server.sh 生成。
# 显式指定时区：服务器时区未必是北京，而 09:20/15:10 说的是交易时间。
CRON_TZ=Asia/Shanghai
SHELL=/bin/bash
PATH=/usr/local/bin:/usr/bin:/bin
20 9 * * 1-5 root $REMOTE_DIR/update-snapshot.sh pre
10 15 * * 1-5 root $REMOTE_DIR/update-snapshot.sh post
INNER
sudo chmod 644 /etc/cron.d/tios
sudo systemctl reload cron 2>/dev/null || sudo service cron reload 2>/dev/null || true
echo "  已装 /etc/cron.d/tios"
cat /etc/cron.d/tios | sed 's/^/    /'
CRON

  cat <<EOF

$LINE
装好了。Mac 现在可以关机。
$LINE

  盘前 09:20 / 盘后 15:10（北京时间，周一至周五）自动生成并发布。
  休市日会跳过 —— 判据是"最新K线日期是否等于今天"，不依赖节假日日历。

  服务器上没有任何秘密：去掉口令后，生成快照不需要凭据。

  日志：ssh 上去 tail -f /var/log/tios-update.log
  立即测一次：./scripts/schedule-server.sh run-now

  注意：前端代码变动仍需从 Mac 用 deploy-ecs.sh 重新部署。
  服务器这个定时任务只更新数据（data/today.json），不重建 JS/CSS。

EOF
  ;;

update)
  # install 会重装 Node、重跑 npm ci，代价大且没必要。
  # 而缺了这个入口的后果实测过一次：改了 FORCE 支持之后，服务器上仍是旧脚本，
  # run-now 照旧在闸门处退出，而现象看起来像"FORCE 没用"而不是"脚本没更新"。
  step "更新服务器上的仓库与脚本（不重装 Node、不重跑 npm ci）"
  rsh "REMOTE_DIR='$REMOTE_DIR' BRANCH='$BRANCH' bash -s" <<'UPD'
set -euo pipefail
# GIT_TERMINAL_PROMPT=0：git 若想问凭据就直接失败，而不是等一个不存在的终端。
# 这是上一次 update 被挂起的直接原因。
export GIT_TERMINAL_PROMPT=0
export GIT_ASKPASS=/bin/true
cd "$REMOTE_DIR"
echo "  拉取 origin/$BRANCH ……"
sudo -n GIT_TERMINAL_PROMPT=0 git fetch --quiet origin "$BRANCH" || {
  echo "  ✗ git fetch 失败。检查服务器能否访问 GitHub：curl -I https://github.com"
  exit 1
}
sudo -n git reset --hard --quiet "origin/$BRANCH"
echo "  已更新到 $(sudo -n git log --oneline -1)"
UPD
  step "重写 update-snapshot.sh"
  write_updater
  printf '\n  完成。cron 配置未改动（要改时点请重跑 install）。\n\n'
  ;;

pull-archive)
  # ── 档案的唯一归属方是服务器 ──
  # 服务器不睡，因此它的 changelog/audits 是**连续**的；Mac 侧一律 ARCHIVE=0。
  # 但 git 在 Mac 上，所以要把服务器那份取回来提交 ——
  # 否则 30 天后的复盘只能 ssh 上去看，而且没有版本历史可比对。
  step "把服务器上的档案取回本地（供提交进 git）"
  mkdir -p "$ROOT/backend/src/services/governance/data/changelog" \
           "$ROOT/backend/src/services/cockpit/data/audits"
  SCP_OPTS=()
  [[ -f "$KEY" ]] && SCP_OPTS+=(-i "$KEY")
  scp "${SCP_OPTS[@]}" -q \
    "$USER_@$HOST:$REMOTE_DIR/backend/src/services/governance/data/changelog/*.json" \
    "$ROOT/backend/src/services/governance/data/changelog/" 2>/dev/null || true
  scp "${SCP_OPTS[@]}" -q \
    "$USER_@$HOST:$REMOTE_DIR/backend/src/services/governance/data/discovery.json" \
    "$ROOT/backend/src/services/governance/data/" 2>/dev/null || true
  scp "${SCP_OPTS[@]}" -q \
    "$USER_@$HOST:$REMOTE_DIR/backend/src/services/cockpit/data/audits/*.md" \
    "$ROOT/backend/src/services/cockpit/data/audits/" 2>/dev/null || true
  cd "$ROOT"
  printf '\n  本地档案现状：\n'
  ls -1 backend/src/services/governance/data/changelog/ | sed 's/^/    /'
  printf '\n  git 差异：\n'
  git status --short backend/src/services/governance/data backend/src/services/cockpit/data/audits \
    | sed 's/^/    /' || true
  printf '\n  确认无误后提交：git add -A backend/src/services && git commit -m "归档 …"\n\n'
  ;;

run-now)
  step "立即在服务器上跑一次（等同盘后任务，但强制发布）"
  printf '  FORCE=1：休市日也发布，否则这次测试会在交易日闸门处退出，\n'
  printf '  于是"管线通不通"要等到下一个交易日才知道。\n'
  printf '  发布出来的页面会显示最新那个交易日，不是今天 —— 这是对的。\n'
  rsh "FORCE=1 $REMOTE_DIR/update-snapshot.sh post; tail -n 25 /var/log/tios-update.log"
  printf '\n  线上数据日期：'
  curl -s --max-time 20 "https://hhwealth.cc/data/today.json" \
    | python3 -c "
import json,sys
try: print(json.load(sys.stdin).get('date') or '未知')
except Exception: print('取不到')
" 2>/dev/null || printf '取不到\n'
  printf '\n'
  ;;

status)
  step "服务器定时任务状态"
  rsh 'bash -s' <<'ST'
set -euo pipefail
echo "  cron 配置："
test -f /etc/cron.d/tios && sed 's/^/    /' /etc/cron.d/tios || echo "    未安装"
echo
echo "  站点数据文件："
ls -l --time-style=long-iso /var/www/tios/data/today.json 2>/dev/null | sed 's/^/    /' || echo "    缺失"
echo
echo "  最近日志："
tail -n 15 /var/log/tios-update.log 2>/dev/null | sed 's/^/    /' || echo "    还没有日志"
ST
  ;;

uninstall)
  step "卸载服务器定时任务"
  rsh 'sudo rm -f /etc/cron.d/tios && (sudo systemctl reload cron 2>/dev/null || true) && echo "  已删除 /etc/cron.d/tios"'
  printf '\n  仓库 %s 与站点文件保持原样，没有删除。\n\n' "$REMOTE_DIR"
  ;;

*)
  cat <<EOF

用法：DEPLOY_HOST=… DEPLOY_KEY=… ./scripts/schedule-server.sh <命令>

  install       装 Node、仓库与 cron（盘前 09:20 / 盘后 15:10）
  update        更新服务器上的仓库与更新脚本（不重装 Node、不重跑 npm ci）
  status        看 cron 配置、数据文件时间、最近日志
  run-now       立即跑一次并强制发布（休市日也能验证管线）
  pull-archive  把服务器上的 changelog/审计档取回本地，供提交进 git
  uninstall     只删 cron，不动仓库与站点文件

装好之后 Mac 可以关机。两点须知：

  · 前端代码变动仍需从 Mac 用 deploy-ecs.sh 重新部署（服务器只更新数据）。
  · 档案（changelog / 审计档）的唯一归属方是服务器，因为它不睡。
    Mac 侧的生成一律带 ARCHIVE=0，避免两台机器各写一份、得到两条不完整的序列。
    定期用 pull-archive 取回来提交进 git。

EOF
  exit 1
  ;;
esac
