#!/usr/bin/env bash
# 从 Mac 发布看台。服务器到不了 GitHub，不能在 ECS 上 git fetch。
#
# 呼和浩特这台机器：curl https://github.com 直接失败，
# git fetch 会 GnuTLS -54 或一直挂。工作台那条路已经证伪。
# 代码必须在 Mac 上打包，用已有的 tios_ecs 私钥拷上去。
#
# 用法：
#   git checkout cursor/cockpit-lookout-c819
#   DEPLOY_HOST=39.104.86.200 DEPLOY_KEY=~/.ssh/tios_ecs ./scripts/ship-from-mac.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOST="${DEPLOY_HOST:-39.104.86.200}"
KEY="${DEPLOY_KEY:-$HOME/.ssh/tios_ecs}"
USER_="${DEPLOY_USER:-root}"
REMOTE_DIR="/opt/tios"
BRANCH="${TIOS_BRANCH:-cursor/cockpit-lookout-c819}"
LINE="$(printf '━%.0s' {1..70})"

die() { printf '\n\033[31m✗ %s\033[0m\n\n' "$1" >&2; exit 1; }

[[ -f "${KEY}" ]] || die "找不到私钥 ${KEY}。先跑 ./scripts/setup-ssh-key.sh"
[[ -d "${ROOT}/.git" ]] || die "不在仓库根目录"

cd "${ROOT}"
REF="$(git rev-parse --abbrev-ref HEAD)"
[[ "${REF}" != "HEAD" ]] || die "现在是游离 HEAD。先：git checkout cursor/cockpit-lookout-c819"
HEAD="$(git rev-parse --short HEAD)"
HEAD_FULL="$(git rev-parse HEAD)"
if [[ "${REF}" != "${BRANCH}" ]]; then
  printf '  \033[33m注意：本机在 %s，不是 %s。发布的是当前这个提交。\033[0m\n' "${REF}" "${BRANCH}"
fi

printf '%s\n从 Mac 发布到 %s（不经过服务器访问 GitHub）\n%s\n' "${LINE}" "${HOST}" "${LINE}"
printf '  本机提交 %s\n' "$(git log --oneline -1)"
printf '  私钥 %s\n' "${KEY}"

# ── 1. 前端：本机构建，scp 上去。证书与 nginx 由 deploy-ecs.sh 处理 ──
printf '\n【1/4】构建并部署前端\n'
DEPLOY_HOST="${HOST}" DEPLOY_KEY="${KEY}" NONINTERACTIVE=1 ./scripts/deploy-ecs.sh

# ── 2. 后端代码：打一份 depth-1 副本拷到 /opt/tios，让 cron 用新代码出报告 ──
# 只拷文件、不让服务器 git fetch。否则明天 15:10 仍用 decision-audit 出旧口径。
printf '\n【2/4】把当前提交拷到服务器 /opt/tios\n'
SLIM="$(mktemp -d /tmp/honghu-slim-XXXX)"
cleanup() { rm -rf "${SLIM}" /tmp/honghu-slim.tgz; }
trap cleanup EXIT
git clone --depth 1 --branch "${REF}" "file://${ROOT}" "${SLIM}"
git -C "${SLIM}" reset --hard "${HEAD_FULL}"
tar -C "${SLIM}" --exclude .git -czf /tmp/honghu-slim.tgz .
# .git 单独带上，这样服务器上的 codeCommit 是真提交，不是旧的 23c7b08
tar -C "${SLIM}" -czf /tmp/honghu-git.tgz .git
scp -i "${KEY}" -o ConnectTimeout=15 /tmp/honghu-slim.tgz /tmp/honghu-git.tgz "${USER_}@${HOST}:/tmp/"

# ── 3. 服务器：解包、改跟踪分支、fetch 加超时、强制出一版 ──
printf '\n【3/4】服务器解包并强制发布\n'
ssh -i "${KEY}" -o ConnectTimeout=15 "${USER_}@${HOST}" \
  "REMOTE_DIR='${REMOTE_DIR}' BRANCH='${BRANCH}' HEAD='${HEAD}' bash -s" <<'REMOTE'
set -euo pipefail
cd "$REMOTE_DIR"
tar -xzf /tmp/honghu-slim.tgz
rm -rf .git
tar -xzf /tmp/honghu-git.tgz
# 上面的 update-snapshot.sh 可能被旧文件覆盖，按新默认分支重写关键两行
if [[ -f update-snapshot.sh ]]; then
  sed -i "s#cursor/decision-audit-c819#${BRANCH}#g" update-snapshot.sh
  # 无超时的 fetch 在这台机器上会卡住 cron
  if ! grep -q 'timeout 20 git' update-snapshot.sh; then
    sed -i 's#git -C /opt/tios fetch --quiet#timeout 20 git -C /opt/tios fetch --quiet#' update-snapshot.sh
  fi
fi
if [[ -f /etc/cron.d/tios ]]; then
  if grep -q '^TIOS_BRANCH=' /etc/cron.d/tios; then
    sed -i "s#^TIOS_BRANCH=.*#TIOS_BRANCH=${BRANCH}#" /etc/cron.d/tios
  else
    sed -i "/^PATH=/a TIOS_BRANCH=${BRANCH}" /etc/cron.d/tios
  fi
fi
echo "  服务器代码 $(git log --oneline -1)"
# 不要再 git fetch GitHub。出一版带新代码的快照。
FORCE=1 NOPULL=1 ./update-snapshot.sh post
if [[ -s /opt/tios/frontend/public/data/today.agent.md ]]; then
  install -o www-data -g www-data -m 644 \
    /opt/tios/frontend/public/data/today.agent.md \
    /var/www/tios/data/today.agent.md
  echo "  已发布 Agent 分享 today.agent.md"
fi
tail -n 15 /var/log/tios-update.log | sed 's/^/    /'
REMOTE

# ── 4. 公网校验 ──
printf '\n【4/4】校验线上\n'
npm run --silent web:status
printf '\n%s\n打 https://hhwealth.cc/ ，第一屏应是看台。旧页就强制刷新。\n%s\n' "${LINE}" "${LINE}"
