#!/usr/bin/env bash
# 部署到阿里云 ECS：下线旧应用，装上驾驶舱
#
# 为什么不是"把服务器删干净重装"：
#   那台机器上的 Let's Encrypt 证书（certbot 自动续期）是本项目的**硬依赖** ——
#   加密快照的解锁用 WebCrypto，浏览器只在 HTTPS 下提供它。
#   重装系统会把证书、certbot 续期配置和 ACME 账户一起清掉，
#   然后要重新申请、重新配 —— 而这跟"下线旧应用"是两件毫不相干的事。
#   所以本脚本只做三件事：备份、换文件、换站点配置。系统、nginx、证书一概不动。
#
# 用法：
#   DEPLOY_HOST=39.104.86.200 TIOS_PASSPHRASE='口令' ./scripts/deploy-ecs.sh
#   DRY_RUN=1 ...          只打印将在服务器上执行的脚本，不连服务器
#   DEPLOY_KEY=~/.ssh/id   指定私钥；不指定就用默认密钥或密码登录
#   DEPLOY_PORT=22         非默认端口
#
# 需要：本机已能 ssh 到服务器（密钥或密码皆可），远端有 sudo 权限。
# 阿里云查不到已有私钥 —— 私钥只在创建密钥对时下载那一次。
# 用密码登录同样可以，本脚本复用一条 SSH 连接，全程只需输一次密码。

set -euo pipefail

HOST="${DEPLOY_HOST:-}"
USER_="${DEPLOY_USER:-root}"
WEBROOT="${DEPLOY_PATH:-/var/www/tios}"
DOMAIN="${DEPLOY_DOMAIN:-hhwealth.cc}"
BASE="${BASE_PATH:-/}"
DRY="${DRY_RUN:-0}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STAMP="$(date +%Y%m%d-%H%M%S)"
LINE="$(printf '─%.0s' {1..70})"

die() { printf '\n\033[31m✗ %s\033[0m\n\n' "$1" >&2; exit 1; }
step() { printf '\n%s\n%s\n%s\n' "$LINE" "$1" "$LINE"; }

[[ -n "$HOST" ]] || die "未设置 DEPLOY_HOST。例：DEPLOY_HOST=39.104.86.200"
[[ -n "${TIOS_PASSPHRASE:-}" ]] || die \
  "未设置 TIOS_PASSPHRASE。公网部署必须加密 —— 页面含全部持仓与总资产，
   不加密等于把它公开发布。口令至少 8 位。"

# ── 一、本地构建并体检 ──
step "一、本地构建加密产物并体检"
cd "$ROOT"
BASE_PATH="$BASE" npm run web:build
npm run web:preflight
BASE_PATH="$BASE" npm run web:package

TARBALL="$(ls -t "$ROOT"/frontend/release/*.tar.gz | head -1)"
[[ -f "$TARBALL" ]] || die "找不到打包产物"
printf '\n  产物：%s\n' "$TARBALL"

# ── 二、生成将在服务器上执行的脚本 ──
# 单独生成成文件而不是一行行 ssh：这样可以先读一遍再执行。
# 涉及删文件与改 nginx 配置的操作，应当先看清楚再跑。
REMOTE_SH="$(mktemp)"
cat > "$REMOTE_SH" <<REMOTE
#!/usr/bin/env bash
set -euo pipefail

WEBROOT="$WEBROOT"
DOMAIN="$DOMAIN"
BASE="$BASE"
STAMP="$STAMP"
TAR="/tmp/\$(basename "$TARBALL")"
BACKUP="/root/hhwealth-backup-\$STAMP.tar.gz"
NGINX_SITE="/etc/nginx/sites-available/tios-\$DOMAIN"

echo "── 1/6 备份现状（无条件执行）──"
# 用户说旧应用没有需要的数据，但 nginx 配置与证书路径是需要的：
# 一旦新配置写错，这个备份是唯一能快速回退的东西。备份很便宜，不做很贵。
sudo tar -czf "\$BACKUP" \\
  --ignore-failed-read \\
  /etc/nginx/sites-available /etc/nginx/sites-enabled /etc/nginx/conf.d \\
  /var/www 2>/dev/null || true
echo "   已备份到 \$BACKUP（\$(sudo du -h "\$BACKUP" | cut -f1)）"

echo "── 2/6 探测现有证书路径 ──"
# **探测而不是假设**：证书路径写错会让 HTTPS 直接起不来，
# 而 HTTPS 是解锁功能的硬依赖。宁可失败退出，也不猜一个路径。
ALL_CERT=\$(sudo grep -rhoP '(?<=ssl_certificate\s)\S+(?=;)' /etc/nginx/ 2>/dev/null | sort -u || true)
ALL_KEY=\$(sudo grep -rhoP '(?<=ssl_certificate_key\s)\S+(?=;)' /etc/nginx/ 2>/dev/null | sort -u || true)
# 机器上可能配着多个域名的证书。优先取路径里含本域名的那张 ——
# 挑错证书的后果是 HTTPS 报名称不匹配，而浏览器一报错就不给 WebCrypto，解锁直接失效。
CERT=\$(echo "\$ALL_CERT" | grep -F "\$DOMAIN" | head -1 || true)
KEY=\$(echo "\$ALL_KEY" | grep -F "\$DOMAIN" | head -1 || true)
[[ -n "\$CERT" ]] || CERT=\$(echo "\$ALL_CERT" | head -1)
[[ -n "\$KEY" ]] || KEY=\$(echo "\$ALL_KEY" | head -1)
if [[ -z "\$CERT" || -z "\$KEY" ]]; then
  echo "   未能从 nginx 配置中读出证书路径。"
  echo "   请手动查看：sudo grep -r ssl_certificate /etc/nginx/"
  echo "   然后以 CERT=... KEY=... 重跑本脚本。已中止，未改动任何东西。"
  exit 1
fi
echo "   证书 \$CERT"
echo "   私钥 \$KEY"
# 文件真的存在才继续。配置里写着但文件已被删的情况会让 nginx 起不来
sudo test -f "\$CERT" || { echo "   证书文件不存在，已中止"; exit 1; }
sudo test -f "\$KEY" || { echo "   私钥文件不存在，已中止"; exit 1; }
if [[ \$(echo "\$ALL_CERT" | wc -l) -gt 1 ]]; then
  echo "   注意：机器上有多张证书，已按域名选中上面这张。全部候选："
  echo "\$ALL_CERT" | sed 's/^/     /'
fi

echo "── 3/6 部署新产物 ──"
sudo mkdir -p "\$WEBROOT"
# 只清空我们自己的目录，且用固定路径拼接，绝不对变量做通配删除
sudo find "\$WEBROOT" -mindepth 1 -delete
sudo tar -xzf "\$TAR" -C "\$WEBROOT"
sudo chown -R www-data:www-data "\$WEBROOT"
echo "   已部署 \$(sudo find "\$WEBROOT" -type f | wc -l) 个文件到 \$WEBROOT"

echo "── 4/6 写入站点配置 ──"
sudo tee "\$NGINX_SITE" > /dev/null <<'NGINXCONF'
# TIOS 驾驶舱。由 scripts/deploy-ecs.sh 生成。
server {
    listen 80;
    listen [::]:80;
    server_name __DOMAIN__ www.__DOMAIN__;
    # 解锁用 WebCrypto，浏览器只在安全上下文提供它 → 必须强制 HTTPS
    return 301 https://__DOMAIN__\$request_uri;
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name __DOMAIN__ www.__DOMAIN__;

    ssl_certificate     __CERT__;
    ssl_certificate_key __KEY__;
    ssl_protocols TLSv1.2 TLSv1.3;

    root __WEBROOT__;
    index index.html;

    # 页面含全部持仓与总资产：明确禁止搜索引擎收录。
    # 这不构成访问控制（爬虫可以无视），真正的保护是数据本身已加密。
    add_header X-Robots-Tag "noindex, nofollow, noarchive" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;
    add_header Referrer-Policy "no-referrer" always;

    # 单页应用：未命中的路径交给 index.html 处理
    location / {
        try_files \$uri \$uri/ /index.html;
    }

    # 快照每个交易日都换。缓存住会让人看着昨天的数据做今天的决定 ——
    # 而这种错误没有任何提示，页面看起来完全正常。
    location ~* ^/data/.*\.json\$ {
        add_header Cache-Control "no-store, no-cache, must-revalidate" always;
        add_header X-Robots-Tag "noindex, nofollow" always;
        expires -1;
    }

    # 带哈希的静态资源可长期缓存
    location /assets/ {
        expires 30d;
        add_header Cache-Control "public, immutable";
    }

    # 不暴露 nginx 版本号
    server_tokens off;
}
NGINXCONF
sudo sed -i "s|__DOMAIN__|\$DOMAIN|g; s|__CERT__|\$CERT|g; s|__KEY__|\$KEY|g; s|__WEBROOT__|\$WEBROOT|g" "\$NGINX_SITE"

echo "── 5/6 下线旧站点并校验配置 ──"
# 移除全部旧的启用软链（原配置已在第 1 步备份），只启用我们这一个
sudo rm -f /etc/nginx/sites-enabled/*
sudo ln -sf "\$NGINX_SITE" /etc/nginx/sites-enabled/
if ! sudo nginx -t; then
  echo "   ✗ nginx 配置校验失败，正在回滚站点启用状态"
  sudo rm -f /etc/nginx/sites-enabled/*
  sudo tar -xzf "\$BACKUP" -C / etc/nginx/sites-enabled 2>/dev/null || true
  sudo nginx -t && sudo systemctl reload nginx || true
  echo "   已回滚。备份仍在 \$BACKUP"
  exit 1
fi

echo "── 6/6 生效 ──"
sudo systemctl reload nginx
echo "   nginx 已重载"

echo
echo "完成。旧应用已下线，其文件与配置保留在 \$BACKUP。"
echo "证书与 certbot 续期未做任何改动。"
REMOTE

step "二、将在服务器上执行的脚本"
cat "$REMOTE_SH"

if [[ "$DRY" == "1" ]]; then
  step "DRY_RUN=1：未连接服务器，未做任何改动"
  printf '  上面就是会执行的全部内容。确认无误后去掉 DRY_RUN 重跑。\n\n'
  rm -f "$REMOTE_SH"
  exit 0
fi

# ── 三、执行 ──
step "三、上传并执行"
printf '  目标 %s@%s，站点目录 %s\n' "$USER_" "$HOST" "$WEBROOT"
printf '  旧应用文件与 nginx 配置会先备份到服务器 /root/ 下，不会直接删除。\n\n'
read -r -p "  确认继续？(输入 yes) " ans
[[ "$ans" == "yes" ]] || die "已取消，未做任何改动"

# 两个文件一次传完、只连两次：用密码登录时每次连接都要输一遍密码，
# 三次提示会让人以为卡住了或者输错了。
# ControlMaster 让 scp 与随后的 ssh 复用同一条连接 → 全程只输一次密码。
CTL="$(mktemp -u /tmp/tios-ssh-%C)"
SSH_OPTS=(-o "ControlMaster=auto" -o "ControlPath=$CTL" -o "ControlPersist=120")
[[ -n "${DEPLOY_KEY:-}" ]] && SSH_OPTS+=(-i "$DEPLOY_KEY")
[[ -n "${DEPLOY_PORT:-}" ]] && SSH_OPTS+=(-p "$DEPLOY_PORT")

cleanup_ssh() { ssh "${SSH_OPTS[@]}" -O exit "$USER_@$HOST" 2>/dev/null || true; }
trap cleanup_ssh EXIT

cp "$REMOTE_SH" "$(dirname "$REMOTE_SH")/tios-deploy.sh"
# scp 的端口参数是 -P 而不是 -p，单独拼一份，否则密码登录时会连不上而看不出原因
SCP_OPTS=(-o "ControlMaster=auto" -o "ControlPath=$CTL" -o "ControlPersist=120")
[[ -n "${DEPLOY_KEY:-}" ]] && SCP_OPTS+=(-i "$DEPLOY_KEY")
[[ -n "${DEPLOY_PORT:-}" ]] && SCP_OPTS+=(-P "$DEPLOY_PORT")

scp "${SCP_OPTS[@]}" "$TARBALL" "$(dirname "$REMOTE_SH")/tios-deploy.sh" "$USER_@$HOST:/tmp/"
ssh "${SSH_OPTS[@]}" "$USER_@$HOST" "chmod +x /tmp/tios-deploy.sh && /tmp/tios-deploy.sh"
rm -f "$REMOTE_SH" "$(dirname "$REMOTE_SH")/tios-deploy.sh"

step "四、验证"
sleep 2
CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "https://$DOMAIN/" || echo "000")
printf '  https://%s/ → HTTP %s\n' "$DOMAIN" "$CODE"
SNAP=$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "https://$DOMAIN/data/today.enc.json" || echo "000")
printf '  加密快照 → HTTP %s\n' "$SNAP"
PLAIN=$(curl -s --max-time 20 "https://$DOMAIN/data/today.json" 2>/dev/null | head -c 20 || true)
if [[ "$PLAIN" == *'"date"'* ]]; then
  printf '\n  \033[31m✗ 明文快照可公开下载，请立即处理\033[0m\n'
else
  printf '  明文快照 → 不可访问（正确）\n'
fi
printf '\n  手机打开 https://%s/ ，应先出现口令解锁页。\n\n' "$DOMAIN"
