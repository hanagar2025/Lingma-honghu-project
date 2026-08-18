#!/usr/bin/env bash
# 在 ECS 本机部署看台：拉代码、重建前端、改跟踪分支、强制发布一版快照。
#
# 存在理由：云代理没有 SSH 私钥，deploy-ecs.sh / ship.sh 从外网连不上这台机器。
# 你已经以 root 登进工作台时，部署只能在这台机器上完成。
#
# 本脚本不动 nginx、不动证书、不重装系统。
# 只换 /opt/tios 的代码、/var/www/tios 的前端产物，以及 cron 跟踪的分支。
#
# 用法（在服务器 root 下）：
#   cd /opt/tios
#   GIT_TERMINAL_PROMPT=0 git fetch origin cursor/cockpit-lookout-c819
#   git reset --hard FETCH_HEAD
#   bash scripts/deploy-on-server.sh

set -euo pipefail

BRANCH="${TIOS_BRANCH:-cursor/cockpit-lookout-c819}"
REPO_DIR="${TIOS_REPO_DIR:-/opt/tios}"
WEBROOT="${DEPLOY_PATH:-/var/www/tios}"
DOMAIN="${DEPLOY_DOMAIN:-hhwealth.cc}"
STAMP="$(date +%Y%m%d-%H%M%S)"
LINE="$(printf '─%.0s' {1..70})"

die() { printf '\n\033[31m✗ %s\033[0m\n\n' "$1" >&2; exit 1; }
step() { printf '\n%s\n%s\n%s\n' "$LINE" "$1" "$LINE"; }

[[ "$(id -u)" -eq 0 ]] || die "必须用 root 跑。你现在在阿里云工作台里，直接粘贴即可。"
[[ -d "${WEBROOT}" ]] || die "找不到站点目录 ${WEBROOT}。这台机器上还没做过首次部署。"
[[ -d "${REPO_DIR}/.git" ]] || die "找不到仓库 ${REPO_DIR}。先确认 cron 用的就是这个目录。"
[[ -f "${REPO_DIR}/update-snapshot.sh" ]] || die "找不到 ${REPO_DIR}/update-snapshot.sh。先确认定时任务装过。"

export GIT_TERMINAL_PROMPT=0
export GIT_ASKPASS=/bin/true
export PATH=/usr/local/bin:/usr/bin:/bin

step "一、备份现状"
BACKUP="/root/hhwealth-webroot-${STAMP}.tar.gz"
tar -czf "${BACKUP}" -C "${WEBROOT}" .
printf '  站点备份 %s（%s）\n' "${BACKUP}" "$(du -h "${BACKUP}" | cut -f1)"
printf '  当前代码 %s\n' "$(git -C "${REPO_DIR}" log --oneline -1)"

step "二、拉看台分支"
cd "${REPO_DIR}"
git fetch origin "${BRANCH}" || die "git fetch 失败。检查：curl -I https://github.com"
git checkout -B "${BRANCH}" "origin/${BRANCH}" 2>/dev/null \
  || git reset --hard "origin/${BRANCH}" \
  || git reset --hard FETCH_HEAD
printf '  已落到 %s\n' "$(git log --oneline -1)"

step "三、安装构建依赖（前端构建需要 vite，不能 --omit=dev）"
if ! command -v node >/dev/null 2>&1; then
  die "未安装 Node。这台机器以前能跑 cron，不应走到这里。"
fi
MAJOR="$(node -v | sed 's/^v\([0-9]*\).*/\1/')"
[[ "${MAJOR}" -ge 18 ]] || die "Node 版本过低：$(node -v)。需要 18+"
printf '  Node %s\n' "$(node -v)"
npm ci --workspaces --include-workspace-root --no-audit --no-fund \
  || npm install --workspaces --include-workspace-root --legacy-peer-deps --no-audit --no-fund
printf '  依赖就绪\n'

step "四、生成快照并构建前端"
# 构建用 ARCHIVE=0，避免在构建机语义下写一份不完整档案。
# 真正的归档由后面 FORCE=1 update-snapshot.sh 负责，归属方仍是服务器。
BASE_PATH=/ ARCHIVE=0 WEB=1 HTML=1 npm run web:snapshot
BASE_PATH=/ npm run build:offline --workspace frontend
[[ -f frontend/dist/index.html ]] || die "前端产物没有 index.html"
[[ -f frontend/dist/data/today.json ]] || die "前端产物没有快照 data/today.json"
if ! grep -q '看台' frontend/dist/assets/*.js; then
  die "构建产物里没有「看台」。停在这里，没有覆盖线上文件。"
fi
printf '  产物含看台标识\n'

step "五、替换站点文件（不改 nginx）"
find "${WEBROOT}" -mindepth 1 -delete
tar -C frontend/dist -cf - . | tar -C "${WEBROOT}" -xf -
chown -R www-data:www-data "${WEBROOT}"
printf '  已写入 %s 个文件到 %s\n' "$(find "${WEBROOT}" -type f | wc -l)" "${WEBROOT}"

step "六、定时任务改跟看台分支"
# 只拉代码不改默认分支的后果实测过：cron 第二天会 reset 回旧分支，
# 报告照出，数字全是旧口径，而且不报错。
sed -i "s#cursor/decision-audit-c819#${BRANCH}#g" "${REPO_DIR}/update-snapshot.sh"
if [[ -f /etc/cron.d/tios ]]; then
  if grep -q '^TIOS_BRANCH=' /etc/cron.d/tios; then
    sed -i "s#^TIOS_BRANCH=.*#TIOS_BRANCH=${BRANCH}#" /etc/cron.d/tios
  else
    sed -i "/^PATH=/a TIOS_BRANCH=${BRANCH}" /etc/cron.d/tios
  fi
  printf '  cron 跟踪 %s\n' "${BRANCH}"
  sed 's/^/    /' /etc/cron.d/tios
else
  printf '  ⚠ 没有 /etc/cron.d/tios，只改了 update-snapshot.sh 的默认分支\n'
fi

step "七、强制发布一版（今日若已过 15:10 或闸门挡住，也要能看见看台）"
FORCE=1 "${REPO_DIR}/update-snapshot.sh" post
printf '  最近日志：\n'
tail -n 20 /var/log/tios-update.log 2>/dev/null | sed 's/^/    /' || true

step "八、核对本机产物与公网"
JS_FILE="$(find "${WEBROOT}/assets" -name '*.js' -type f | head -1)"
[[ -n "${JS_FILE}" ]] || die "站点目录里没有 JS"
grep -q '看台' "${JS_FILE}" || die "刚写下的 JS 里没有「看台」"
printf '  ✓ 本机 JS 含看台（%s）\n' "$(basename "${JS_FILE}")"

BODY="$(curl -fsS --max-time 20 "https://${DOMAIN}/" || true)"
if [[ "${BODY}" == *'鸿鹄理财'* || "${BODY}" == *'TIOS'* ]]; then
  printf '  ✓ 公网首页仍是本项目\n'
else
  die "公网首页不是本项目。站点文件已换，nginx 可能仍指到别处。备份在 ${BACKUP}"
fi

LIVE_JS="$(printf '%s' "${BODY}" | sed -n 's/.*src="\([^"]*\/assets\/[^"]*\.js\)".*/\1/p' | head -1)"
LIVE_BODY="$(curl -fsS --max-time 20 "https://${DOMAIN}${LIVE_JS}" || true)"
if [[ "${LIVE_BODY}" == *'看台'* ]]; then
  printf '  ✓ 公网 JS 已含看台\n'
else
  printf '  ⚠ 公网 JS 还没有看台。多半是浏览器/CDN 缓存，或 nginx 根目录不是 %s\n' "${WEBROOT}"
  printf '    本机已经换完。强制刷新后再看 https://%s/\n' "${DOMAIN}"
fi

SNAP="$(curl -fsS --max-time 20 "https://${DOMAIN}/data/today.json" || true)"
if [[ "${SNAP}" == *'"date"'* && "${SNAP}" == *'"dashboard"'* ]]; then
  SDATE="$(printf '%s' "${SNAP}" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("date") or "未知")' 2>/dev/null || echo 未知)"
  SCOMMIT="$(printf '%s' "${SNAP}" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("codeCommit") or "未知")' 2>/dev/null || echo 未知)"
  printf '  ✓ 快照可取，交易日 %s，代码 %s\n' "${SDATE}" "${SCOMMIT}"
else
  die "快照不可用。备份在 ${BACKUP}"
fi

cat <<EOF

${LINE}
部署完成。
${LINE}

  手机打开 https://${DOMAIN}/ ，第一屏应是看台。
  若仍是旧页，强制刷新（iOS Safari 长按刷新）。

  代码：$(git -C "${REPO_DIR}" log --oneline -1)
  备份：${BACKUP}
  证书与 nginx 未改动。

EOF
