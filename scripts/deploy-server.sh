#!/usr/bin/env bash
# 在服务器上部署鸿鹄：一个页面、一个输入框。
#
# 用法（在服务器上，以 root 运行，当前目录是仓库根目录）：
#   DOMAIN=example.com bash scripts/deploy-server.sh
#
# 做五件事：
#   1. 装依赖、构建前端；
#   2. 建私有数据目录 /var/lib/honghu（只有服务账号能读），账本、成交、意向、截图都在这里，不进仓库；
#   3. 第一次运行时生成两个口令，写入 /etc/honghu.env（只有 root 能读）；
#   4. 注册 systemd 服务，只监听本机 127.0.0.1:5000；
#   5. 用 Caddy 把域名接到本机端口，自动申请并续期 HTTPS 证书。
#
# 重复运行是安全的：口令与数据不会被覆盖。
set -euo pipefail

: "${DOMAIN:?请先设置 DOMAIN，例如 DOMAIN=example.com}"
APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_DIR="${DATA_DIR:-/var/lib/honghu}"
ENV_FILE=/etc/honghu.env
SERVICE_USER=honghu
PORT="${PORT:-5000}"

if [ "$(id -u)" -ne 0 ]; then
  echo "请以 root 运行" >&2
  exit 1
fi

node_major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
if [ "${node_major}" -lt 20 ]; then
  echo "需要 Node.js 20 或更高版本，当前是 ${node_major}" >&2
  exit 1
fi

id -u "${SERVICE_USER}" >/dev/null 2>&1 || useradd --system --home-dir "${DATA_DIR}" --shell /usr/sbin/nologin "${SERVICE_USER}"
install -d -m 700 -o "${SERVICE_USER}" -g "${SERVICE_USER}" "${DATA_DIR}"

# 第一次部署时，用仓库里的旧账本做种子：它带着峰值与口径。
# 第一张持仓截图确认后，股数与现金整份替换，峰值沿用。
SEED="${APP_DIR}/backend/src/services/dailyDecision/data/portfolio.json"
if [ ! -f "${DATA_DIR}/ledger/portfolio.json" ] && [ -f "${SEED}" ]; then
  install -d -m 700 -o "${SERVICE_USER}" -g "${SERVICE_USER}" "${DATA_DIR}/ledger"
  install -m 600 -o "${SERVICE_USER}" -g "${SERVICE_USER}" "${SEED}" "${DATA_DIR}/ledger/portfolio.json"
fi

cd "${APP_DIR}"
npm ci --no-audit --no-fund
npm run build

if [ ! -f "${ENV_FILE}" ]; then
  umask 077
  {
    echo "DATA_DIR=${DATA_DIR}"
    echo "PORT=${PORT}"
    echo "COMMITTEE_TOKEN=$(openssl rand -hex 24)"
    echo "AGENT_TOKEN=$(openssl rand -hex 24)"
  } > "${ENV_FILE}"
  echo "已生成口令，保存在 ${ENV_FILE}"
fi
chmod 600 "${ENV_FILE}"

cat > /etc/systemd/system/honghu.service <<UNIT
[Unit]
Description=Honghu
After=network-online.target
Wants=network-online.target

[Service]
User=${SERVICE_USER}
WorkingDirectory=${APP_DIR}/backend
EnvironmentFile=${ENV_FILE}
ExecStart=$(command -v npm) run start
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=${DATA_DIR}
PrivateTmp=true

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable honghu.service
systemctl restart honghu.service

if ! command -v caddy >/dev/null 2>&1; then
  if command -v apt-get >/dev/null 2>&1; then
    apt-get update -y
    apt-get install -y caddy
  else
    echo "没有找到 Caddy，也没有 apt-get。请手动安装 Caddy 后重新运行。" >&2
    exit 1
  fi
fi

cat > /etc/caddy/Caddyfile <<CADDY
${DOMAIN} {
  encode gzip
  reverse_proxy 127.0.0.1:${PORT}
}
CADDY
systemctl reload caddy || systemctl restart caddy

sleep 2
if curl -fsS "http://127.0.0.1:${PORT}/health" >/dev/null; then
  echo "服务已启动。打开 https://${DOMAIN} ，输入 ${ENV_FILE} 里的 COMMITTEE_TOKEN。"
  echo "AGENT_TOKEN 交给战略侧：在 Cursor 的 Secrets 里存为 HONGHU_AGENT_TOKEN，网址存为 HONGHU_SERVER_URL。"
else
  echo "服务没有起来。查看日志：journalctl -u honghu.service -n 50" >&2
  exit 1
fi
