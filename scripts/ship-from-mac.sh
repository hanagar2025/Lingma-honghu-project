#!/usr/bin/env bash
# 从自己的电脑发布到服务器。
#
# 服务器连不上 GitHub，所以代码在本机打包、拷上去、在服务器上安装。
# 服务器上只需要 Node.js 18 以上，不需要 npm，不需要 git。
#
# 用法（在仓库根目录）：
#   DEPLOY_HOST=<服务器公网地址> DOMAIN=<域名> ./scripts/ship-from-mac.sh
#
# 可选：
#   DEPLOY_KEY=~/.ssh/tios_ecs   指定登录用的私钥；不指定就用默认密钥或密码
#   DEPLOY_USER=root             登录账号，缺省 root；不是 root 时需要能 sudo
#   DEPLOY_PORT=22               SSH 端口
#   APP_PORT=5080                程序在服务器本机监听的端口
#   DRY_RUN=1                    只打包并在本机试跑，不连服务器
#
# 重复运行是安全的：服务器上的口令和数据不会被覆盖。
set -euo pipefail

: "${DOMAIN:?请先设置 DOMAIN，例如 DOMAIN=example.com}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
USER_="${DEPLOY_USER:-root}"
SSH_PORT="${DEPLOY_PORT:-22}"
APP_PORT="${APP_PORT:-5080}"

cd "${ROOT}"

printf '== 一、打包并在本机试跑\n'
[ -d node_modules ] || npm ci --no-audit --no-fund
node scripts/package-server.mjs --smoke
TARBALL="$(ls -t release/honghu-*.tar.gz | head -1)"
VERSION="$(cat release/honghu/VERSION)"

if [ "${DRY_RUN:-0}" = "1" ]; then
  printf '\n只打包，不连服务器。包在 %s\n' "${TARBALL}"
  exit 0
fi

: "${DEPLOY_HOST:?请先设置 DEPLOY_HOST（服务器公网地址）}"
SSH_OPTS=(-o ConnectTimeout=15 -o ServerAliveInterval=15)
if [ -n "${DEPLOY_KEY:-}" ]; then SSH_OPTS+=(-i "${DEPLOY_KEY}"); fi
SUDO=""
if [ "${USER_}" != "root" ]; then SUDO="sudo"; fi

printf '\n== 二、拷到服务器 %s\n' "${DEPLOY_HOST}"
scp "${SSH_OPTS[@]}" -P "${SSH_PORT}" "${TARBALL}" "${USER_}@${DEPLOY_HOST}:/tmp/honghu.tar.gz"

printf '\n== 三、在服务器上安装\n'
ssh "${SSH_OPTS[@]}" -p "${SSH_PORT}" "${USER_}@${DEPLOY_HOST}" \
  "set -e; rm -rf /tmp/honghu-release; mkdir -p /tmp/honghu-release; tar xzf /tmp/honghu.tar.gz -C /tmp/honghu-release; ${SUDO} env DOMAIN='${DOMAIN}' PORT='${APP_PORT}' bash /tmp/honghu-release/honghu/install.sh; rm -rf /tmp/honghu-release /tmp/honghu.tar.gz"

printf '\n== 四、从公网核对\n'
LIVE="$(curl -fsS -m 15 "https://${DOMAIN}/health" 2>/dev/null || true)"
case "${LIVE}" in
  *"\"${VERSION}\""*)
    printf '✓ https://%s 上运行的是这一版（%s）\n' "${DOMAIN}" "${VERSION}"
    ;;
  "")
    printf '⚠ 从公网打不开 https://%s/health 。服务器上的安装输出里写了还差什么。\n' "${DOMAIN}"
    exit 1
    ;;
  *)
    printf '⚠ https://%s 上应答的不是这一版：%s\n' "${DOMAIN}" "${LIVE}"
    exit 1
    ;;
esac
