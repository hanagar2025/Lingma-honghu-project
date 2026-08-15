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

HOST="${DEPLOY_HOST:-39.104.86.200}"
USER_="${DEPLOY_USER:-root}"
KEY="${DEPLOY_KEY:-$HOME/.ssh/tios_ecs}"
WEBROOT="${DEPLOY_PATH:-/var/www/tios}"
REPO="${TIOS_REPO:-https://github.com/hanagar2025/Lingma-honghu-project.git}"
BRANCH="${TIOS_BRANCH:-cursor/decision-audit-c819}"
REMOTE_DIR="/opt/tios"
LINE="$(printf '─%.0s' {1..70})"

die() { printf '\n\033[31m✗ %s\033[0m\n\n' "$1" >&2; exit 1; }
step() { printf '\n%s\n%s\n%s\n' "$LINE" "$1" "$LINE"; }

SSH_OPTS=(-o BatchMode=no)
[[ -f "$KEY" ]] && SSH_OPTS+=(-i "$KEY")
rsh() { ssh "${SSH_OPTS[@]}" "$USER_@$HOST" "$@"; }

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

if [[ -d "$REMOTE_DIR/.git" ]]; then
  echo "  仓库已存在，拉取最新……"
  sudo git -C "$REMOTE_DIR" fetch --quiet origin "$BRANCH"
  sudo git -C "$REMOTE_DIR" reset --hard --quiet "origin/$BRANCH"
else
  echo "  克隆仓库到 ${REMOTE_DIR}……"
  sudo git clone --quiet --branch "$BRANCH" --depth 20 "$REPO" "$REMOTE_DIR"
fi

echo "  安装依赖（npm ci，不会改动 lock 文件）……"
cd "$REMOTE_DIR"
sudo npm ci --omit=dev --no-audit --no-fund >/dev/null 2>&1 || sudo npm ci --no-audit --no-fund >/dev/null 2>&1
echo "  依赖就绪"
SETUP

  step "三、写入更新脚本"
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
LOG=/var/log/tios-update.log
exec >> "$LOG" 2>&1
echo "=== $(date '+%F %T %Z') session=$SESSION force=$FORCE ==="

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

用法：DEPLOY_HOST=… DEPLOY_KEY=… ./scripts/schedule-server.sh <install|status|run-now|uninstall>

  install    在服务器上装 Node、仓库与 cron（盘前 09:20 / 盘后 15:10）
  status     看 cron 配置、数据文件时间、最近日志
  run-now    立即在服务器上跑一次
  uninstall  只删 cron，不动仓库与站点文件

装好之后 Mac 可以关机。前端代码变动仍需从 Mac 用 deploy-ecs.sh 重新部署。

EOF
  exit 1
  ;;
esac
