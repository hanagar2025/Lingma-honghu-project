#!/usr/bin/env bash
# 在服务器上安装鸿鹄。随发布包一起上传（包里叫 install.sh），由 scripts/ship-from-mac.sh 调用。
# 也可以登录服务器后手动运行：
#   DOMAIN=example.com bash install.sh
#
# 前提：以 root 运行；服务器上有 systemd。没有 Node.js 18 以上时自动从阿里云镜像下载一份，只给鸿鹄用。
# 不需要 npm，不需要访问 GitHub。
#
# 做五件事：
#   一、建服务账号和私有数据目录 /var/lib/honghu（只有服务账号能读）。
#       账本、成交、意向、截图都在这里。
#   二、把程序放到 /opt/honghu。
#   三、第一次运行时生成两个口令，写入 /etc/honghu.env（只有 root 能读）。
#   四、注册 systemd 服务，只监听本机端口。
#   五、把域名接到本机端口并配 HTTPS：
#       接到正在占用 80/443 的 nginx 或 Caddy 上，加一个站点，不动现有站点；
#       nginx 的证书用 certbot 申请，Caddy 自己申请。两个都没有时装 Caddy。
#
# 重复运行是安全的：口令和数据不会被覆盖；nginx 配置写坏了会自动还原。
# 第五步做不成（域名没解析到本机、证书申请不下来）不会让前四步白做，脚本会写明还差什么。
set -euo pipefail

: "${DOMAIN:?请先设置 DOMAIN，例如 DOMAIN=example.com}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR=/opt/honghu
DATA_DIR="${DATA_DIR:-/var/lib/honghu}"
ENV_FILE=/etc/honghu.env
SERVICE_USER=honghu
PORT="${PORT:-5080}"
TODO=()

step() { printf '\n== %s\n' "$1"; }
note() { printf '   %s\n' "$1"; }
die() { printf '✗ %s\n' "$1" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "请以 root 运行"
[[ "${DOMAIN}" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ ]] || die "域名格式不对：${DOMAIN}"
[[ "${PORT}" =~ ^[0-9]+$ ]] || die "端口必须是数字：${PORT}"
[ -f "${HERE}/server.mjs" ] && [ -d "${HERE}/web" ] || die "发布包不完整：${HERE} 里缺 server.mjs 或 web/"
command -v systemctl >/dev/null 2>&1 || die "这台机器没有 systemd"
# 系统里没有合适的 Node.js 时，给鸿鹄单独放一份在 /opt/honghu/node，不动系统里的 Node.js：
# 同一台机器上的别的程序可能依赖它。阿里云镜像在服务器上能连上，GitHub 和 nodejs.org 不一定。
NODE_VERSION=v20.18.1
NODE_SHA256=259e5a8bf2e15ecece65bd2a47153262eda71c0b2c9700d5e703ce4951572784
PRIVATE_NODE="${APP_DIR}/node/bin/node"
node_ok() { [ -x "$1" ] && [ "$("$1" -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)" -ge 18 ]; }
if node_ok "$(command -v node 2>/dev/null || true)"; then
  :
elif node_ok "${PRIVATE_NODE}"; then
  PATH="${APP_DIR}/node/bin:${PATH}"
else
  [ "$(uname -m)" = "x86_64" ] || die "没有 Node.js 18 以上，且这台机器不是 x86_64，不能自动下载。请先安装 Node.js 18 以上"
  printf '没有 Node.js 18 以上，给鸿鹄单独下载一份 %s（不动系统里的 Node.js）\n' "${NODE_VERSION}"
  TGZ="$(mktemp)"
  GOT=0
  for MIRROR in https://mirrors.aliyun.com/nodejs-release https://cdn.npmmirror.com/binaries/node; do
    if curl -fsSL -m 300 -o "${TGZ}" "${MIRROR}/${NODE_VERSION}/node-${NODE_VERSION}-linux-x64.tar.gz" \
      && echo "${NODE_SHA256}  ${TGZ}" | sha256sum -c --status; then
      GOT=1
      break
    fi
  done
  [ "${GOT}" -eq 1 ] || { rm -f "${TGZ}"; die "Node.js 下载失败或校验不通过"; }
  install -d -m 755 "${APP_DIR}/node"
  tar xzf "${TGZ}" -C "${APP_DIR}/node" --strip-components=1 --no-same-owner
  rm -f "${TGZ}"
  node_ok "${PRIVATE_NODE}" || die "下载的 Node.js 运行不了"
  PATH="${APP_DIR}/node/bin:${PATH}"
fi
VERSION="$(cat "${HERE}/VERSION" 2>/dev/null || echo unknown)"
printf '安装鸿鹄 %s 到 %s，域名 %s，本机端口 %s\n' "${VERSION}" "${APP_DIR}" "${DOMAIN}" "${PORT}"

step "一、服务账号与私有数据目录"
if ! id -u "${SERVICE_USER}" >/dev/null 2>&1; then
  useradd --system --home-dir "${DATA_DIR}" --shell "$(command -v nologin || echo /bin/false)" "${SERVICE_USER}"
fi
install -d -m 700 -o "${SERVICE_USER}" -g "${SERVICE_USER}" "${DATA_DIR}"
# 首次安装用仓库里的旧账本做种子：它带着峰值与口径。
# 第一张持仓截图确认后，股数与现金整份替换，峰值沿用。
if [ ! -f "${DATA_DIR}/ledger/portfolio.json" ] && [ -f "${HERE}/seed-ledger.json" ]; then
  install -d -m 700 -o "${SERVICE_USER}" -g "${SERVICE_USER}" "${DATA_DIR}/ledger"
  install -m 600 -o "${SERVICE_USER}" -g "${SERVICE_USER}" "${HERE}/seed-ledger.json" "${DATA_DIR}/ledger/portfolio.json"
  note "已放入种子账本（旧账本，等第一张持仓截图替换）"
fi
note "数据目录 ${DATA_DIR}"

step "二、程序文件"
install -d -m 755 "${APP_DIR}"
rm -rf "${APP_DIR}/web.new"
cp -r "${HERE}/web" "${APP_DIR}/web.new"
rm -rf "${APP_DIR}/web"
mv "${APP_DIR}/web.new" "${APP_DIR}/web"
install -m 644 "${HERE}/server.mjs" "${APP_DIR}/server.mjs"
install -m 644 "${HERE}/VERSION" "${APP_DIR}/VERSION"
chmod -R a+rX "${APP_DIR}/web"
# Node 若装在 /root 或 /home 下（例如 nvm），服务账号读不到，拷一份到程序目录
NODE_BIN="$(readlink -f "$(command -v node)")"
if ! runuser -u "${SERVICE_USER}" -- "${NODE_BIN}" -v >/dev/null 2>&1; then
  install -d -m 755 "${APP_DIR}/bin"
  install -m 755 "${NODE_BIN}" "${APP_DIR}/bin/node"
  NODE_BIN="${APP_DIR}/bin/node"
  runuser -u "${SERVICE_USER}" -- "${NODE_BIN}" -v >/dev/null 2>&1 || die "服务账号运行不了 Node.js"
  note "Node.js 已拷到 ${NODE_BIN}"
fi
note "Node.js $("${NODE_BIN}" -v)"

step "三、口令"
if [ ! -f "${ENV_FILE}" ]; then
  gen() { "${NODE_BIN}" -e 'process.stdout.write(require("crypto").randomBytes(24).toString("hex"))'; }
  (
    umask 077
    {
      echo "DATA_DIR=${DATA_DIR}"
      echo "COMMITTEE_TOKEN=$(gen)"
      echo "AGENT_TOKEN=$(gen)"
    } > "${ENV_FILE}"
  )
  note "已生成两个口令，保存在 ${ENV_FILE}"
else
  note "沿用已有口令（${ENV_FILE}）"
fi
chmod 600 "${ENV_FILE}"

step "四、系统服务"
if ! systemctl is-active --quiet honghu.service 2>/dev/null \
  && command -v ss >/dev/null 2>&1 && ss -ltnH 2>/dev/null | awk '{print $4}' | grep -Eq "[:.]${PORT}\$"; then
  die "本机端口 ${PORT} 已被别的程序占用。换一个端口重新运行，例如 PORT=5081"
fi
cat > /etc/systemd/system/honghu.service <<UNIT
[Unit]
Description=Honghu
After=network-online.target
Wants=network-online.target

[Service]
User=${SERVICE_USER}
WorkingDirectory=${APP_DIR}
EnvironmentFile=${ENV_FILE}
Environment=PORT=${PORT}
Environment=WEB_DIR=${APP_DIR}/web
Environment=NODE_ENV=production
ExecStart=${NODE_BIN} ${APP_DIR}/server.mjs
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=${DATA_DIR}
PrivateTmp=true

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable honghu.service >/dev/null 2>&1 || true
systemctl restart honghu.service

LIVE=""
for _ in 1 2 3 4 5 6 7 8 9 10; do
  LIVE="$(curl -fsS -m 3 "http://127.0.0.1:${PORT}/health" 2>/dev/null || true)"
  [ -n "${LIVE}" ] && break
  sleep 1
done
if [ -z "${LIVE}" ]; then
  journalctl -u honghu.service -n 30 --no-pager 2>/dev/null || true
  die "服务没有起来。上面是最近的日志"
fi
case "${LIVE}" in
  *"\"${VERSION}\""*) note "服务已启动：${LIVE}" ;;
  *) die "本机端口 ${PORT} 上应答的不是这一版（${LIVE}）。可能端口被别的程序占用" ;;
esac

step "五、域名与证书"
# 阿里云实例的公网地址从元数据服务读；读不到就不做解析核对
PUBLIC_IP="$(curl -fsS -m 3 http://100.100.100.200/latest/meta-data/eipv4 2>/dev/null || true)"
[ -n "${PUBLIC_IP}" ] || PUBLIC_IP="$(curl -fsS -m 3 http://100.100.100.200/latest/meta-data/public-ipv4 2>/dev/null || true)"
RESOLVED="$(getent ahostsv4 "${DOMAIN}" 2>/dev/null | awk '{print $1}' | sort -u | tr '\n' ' ' || true)"
DNS_OK=1
if [ -z "${RESOLVED}" ]; then
  DNS_OK=0
  TODO+=("域名 ${DOMAIN} 还没有解析记录。请加一条 A 记录指向 ${PUBLIC_IP:-本机公网地址}")
elif [ -n "${PUBLIC_IP}" ] && ! printf '%s' "${RESOLVED}" | grep -qw "${PUBLIC_IP}"; then
  DNS_OK=0
  TODO+=("域名 ${DOMAIN} 现在解析到 ${RESOLVED}，不是本机 ${PUBLIC_IP}。请把 A 记录改过来")
fi
note "本机公网地址：${PUBLIC_IP:-读不到}；域名解析到：${RESOLVED:-无}"

CERT_DIR="/etc/letsencrypt/live/${DOMAIN}"

# 接到正在占用 80/443 端口的那个程序上；两个都没在跑时才看装了哪个
PROXY=""
HOLDER="$(ss -ltnpH '( sport = :80 or sport = :443 )' 2>/dev/null | grep -o 'users:(("[^"]*"' | sed 's/users:(("//' | sort -u | tr '\n' ' ' || true)"
if systemctl is-active --quiet caddy 2>/dev/null; then
  PROXY=caddy
elif systemctl is-active --quiet nginx 2>/dev/null; then
  PROXY=nginx
elif [ -n "${HOLDER}" ]; then
  TODO+=("80/443 端口被 ${HOLDER}占着，它不是系统服务里的 nginx 或 Caddy，没有自动接入。请手动把 https://${DOMAIN} 转到 http://127.0.0.1:${PORT}")
elif command -v nginx >/dev/null 2>&1; then
  PROXY=nginx
else
  PROXY=caddy
fi
note "对外的网页服务：${PROXY:-未接入}"

if [ "${PROXY}" = "nginx" ]; then
  note "用 nginx 加一个站点，不动现有站点"
  if grep -Eq 'include[[:space:]]+(/etc/nginx/)?conf\.d/\*\.conf' /etc/nginx/nginx.conf 2>/dev/null; then
    CONF="/etc/nginx/conf.d/honghu.conf"
  elif grep -Eq 'include[[:space:]]+(/etc/nginx/)?sites-enabled/' /etc/nginx/nginx.conf 2>/dev/null; then
    CONF="/etc/nginx/sites-enabled/honghu.conf"
  else
    CONF=""
    TODO+=("看不出 nginx 从哪个目录读站点配置。请手动加一个站点，把 ${DOMAIN} 转到 http://127.0.0.1:${PORT}")
  fi

  apply_nginx() {
    if nginx -t >/dev/null 2>&1; then
      systemctl reload nginx 2>/dev/null || nginx -s reload
      return 0
    fi
    nginx -t 2>&1 | sed 's/^/   /' || true
    if [ -f "${CONF}.bak" ]; then mv "${CONF}.bak" "${CONF}"; else rm -f "${CONF}"; fi
    return 1
  }

  write_http_only() {
    cat > "${CONF}" <<NGINX
# 鸿鹄。由 install.sh 生成，重新安装时会被覆盖。证书就绪前不转发任何请求。
server {
    listen 80;
    server_name ${DOMAIN};
    server_tokens off;
    location / { return 503; }
}
NGINX
  }

  write_full() {
    cat > "${CONF}" <<NGINX
# 鸿鹄。由 install.sh 生成，重新安装时会被覆盖。
server {
    listen 80;
    server_name ${DOMAIN};
    server_tokens off;
    location / { return 301 https://\$host\$request_uri; }
}
server {
    listen 443 ssl;
    server_name ${DOMAIN};
    server_tokens off;
    ssl_certificate ${CERT_DIR}/fullchain.pem;
    ssl_certificate_key ${CERT_DIR}/privkey.pem;
    client_max_body_size 12m;
    location / {
        proxy_pass http://127.0.0.1:${PORT};
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$remote_addr;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 60s;
    }
}
NGINX
  }

  if [ -n "${CONF}" ]; then
    [ -f "${CONF}" ] && cp "${CONF}" "${CONF}.bak"
    if [ ! -f "${CERT_DIR}/fullchain.pem" ]; then
      write_http_only
      apply_nginx || die "nginx 配置检查没有通过，已还原。现有站点没有受影响"
      if [ "${DNS_OK}" -eq 1 ] && command -v certbot >/dev/null 2>&1; then
        note "申请证书"
        certbot certonly --nginx -d "${DOMAIN}" -n --agree-tos --register-unsafely-without-email 2>&1 | sed 's/^/   /' \
          || TODO+=("证书没有申请下来（见上面的输出）。常见原因：域名没有备案，80 端口的请求被拦截")
      elif [ "${DNS_OK}" -eq 1 ]; then
        TODO+=("机器上没有 certbot，证书没有申请。装好 certbot 后重新运行本脚本")
      fi
    fi
    if [ -f "${CERT_DIR}/fullchain.pem" ]; then
      write_full
      apply_nginx || die "nginx 配置检查没有通过，已还原。现有站点没有受影响"
      note "nginx 站点已启用：${CONF}"
    else
      TODO+=("证书就绪前，${DOMAIN} 只返回 503，不转发请求。解决上面的问题后重新运行本脚本")
    fi
    rm -f "${CONF}.bak"
  fi
elif [ "${PROXY}" = "caddy" ]; then
  if ! command -v caddy >/dev/null 2>&1 && command -v apt-get >/dev/null 2>&1; then
    note "没有 nginx，安装 Caddy"
    apt-get install -y caddy >/dev/null 2>&1 || true
  fi
  if command -v caddy >/dev/null 2>&1; then
    # 用正在运行的 Caddy 实际读取的那份配置
    CADDYFILE="$(systemctl cat caddy 2>/dev/null | sed -n 's/.*--config[= ]\([^ ]*\).*/\1/p' | head -1)"
    CADDYFILE="${CADDYFILE:-/etc/caddy/Caddyfile}"
    note "Caddy 配置：${CADDYFILE}，加一个站点，不动现有站点"
    install -d -m 755 /etc/caddy
    cat > /etc/caddy/honghu.caddy <<CADDY
${DOMAIN} {
    encode gzip
    reverse_proxy 127.0.0.1:${PORT}
}
CADDY
    touch "${CADDYFILE}"
    cp "${CADDYFILE}" "${CADDYFILE}.honghu.bak"
    grep -q 'honghu.caddy' "${CADDYFILE}" || printf '\nimport /etc/caddy/honghu.caddy\n' >> "${CADDYFILE}"
    if caddy validate --config "${CADDYFILE}" --adapter caddyfile >/dev/null 2>&1; then
      systemctl enable caddy >/dev/null 2>&1 || true
      systemctl reload caddy 2>/dev/null || systemctl restart caddy
      note "Caddy 站点已启用，证书由 Caddy 自动申请和续期"
    else
      caddy validate --config "${CADDYFILE}" --adapter caddyfile 2>&1 | tail -5 | sed 's/^/   /' || true
      mv "${CADDYFILE}.honghu.bak" "${CADDYFILE}"
      rm -f /etc/caddy/honghu.caddy
      die "Caddy 配置检查没有通过，已还原。现有站点没有受影响"
    fi
    rm -f "${CADDYFILE}.honghu.bak"
  else
    TODO+=("机器上没有 nginx，也装不上 Caddy。请手动配一个反向代理，把 https://${DOMAIN} 转到 http://127.0.0.1:${PORT}")
  fi
fi

printf '\n'
if [ "${#TODO[@]}" -eq 0 ]; then
  printf '✓ 安装完成。打开 https://%s ，输入委员会口令。\n' "${DOMAIN}"
else
  printf '服务已在本机运行，但还差 %s 件事：\n' "${#TODO[@]}"
  for t in "${TODO[@]}"; do printf '  - %s\n' "${t}"; done
fi
printf '查看口令（在服务器上）：grep TOKEN %s\n' "${ENV_FILE}"
printf '  COMMITTEE_TOKEN 是打开页面时输入的口令。\n'
printf '  AGENT_TOKEN 交给战略侧：在 Cursor 的 Secrets 里存为 HONGHU_AGENT_TOKEN，网址存为 HONGHU_SERVER_URL。\n'
