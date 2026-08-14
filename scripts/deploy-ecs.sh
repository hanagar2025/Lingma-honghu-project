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

# ── 口令：优先交互式输入 ──
# 写在命令行里的口令会**原文进入 ~/.zsh_history**，而这个口令是公网页面的唯一保护。
# 所以默认改为读取输入且不回显：不进历史、不进进程列表（ps 能看到命令行参数）。
# 已经用环境变量传进来的仍然接受 —— 自动化场景需要它，但会提示历史泄漏。
if [[ -n "${TIOS_PASSPHRASE:-}" ]]; then
  printf '\n  \033[33m注意：口令通过环境变量传入，会留在 shell 历史里。\033[0m\n'
  printf '  清理：history -d 对应行号，或直接删掉 ~/.zsh_history 里那一行。\n'
else
  step "设置解锁口令"
  cat <<'TIP'
  这是以后每次打开页面要输的口令。它是公网页面的唯一保护，因为：
    · 数据以密文静态托管，服务器自己也解不开；
    · 任何人都能下载那个密文文件，然后在自己机器上离线慢慢试口令。

  所以口令必须经得起离线爆破：
    · 至少 12 位；
    · 不要用域名、品牌名、"honghu"、"wealth"、"hhwealth" 这类能猜到的词 ——
      攻击者的第一批字典就是这些；
    · 不要与其他账号复用。

  输入时不回显，也不会进入 shell 历史。
TIP
  printf '\n  口令：'
  read -rs TIOS_PASSPHRASE
  printf '\n  再输一次：'
  read -rs PASS2
  printf '\n'
  [[ "$TIOS_PASSPHRASE" == "$PASS2" ]] || die "两次输入不一致"
  unset PASS2
  export TIOS_PASSPHRASE
fi

# ── 口令强度 ──
# 原来的规则是"含 honghu / wealth 就拒绝"。**那条规则拦错了对象** ——
# honghu 当记忆锚点没有问题，问题是除它之外什么都没有。
# 现在改为估算"去掉可猜成分后剩余的熵"，于是 honghu-青瓦-灯塔-47 这种
# 好记又够强的口令能通过，而 honghu2026 那种一秒即破的仍被拦。
#
# 口令走标准输入传给检查器，不走命令行参数 —— argv 会出现在 ps 输出里。
WEAK_FLAG=""
[[ "${TIOS_ALLOW_WEAK:-0}" == "1" ]] && WEAK_FLAG="--allow-weak"
if ! STRENGTH="$(printf '%s' "$TIOS_PASSPHRASE" | node "$ROOT/scripts/check-passphrase.mjs" $WEAK_FLAG)"; then
  die "口令未通过强度检查，未做任何改动。"
fi

if [[ "$STRENGTH" == WEAK* ]]; then
  printf '\n  \033[31m确认使用弱口令？\033[0m 这个页面挂在公网，口令是唯一保护。\n'
  printf '  强度：%s\n' "${STRENGTH#WEAK }"
  read -r -p '  输入 "我知道风险" 继续：' ack
  [[ "$ack" == "我知道风险" ]] || die "已取消，未做任何改动"
fi
printf '\n  口令强度：%s\n' "${STRENGTH#* }"

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
echo "   已备份到 \${BACKUP}（\$(sudo du -h "\$BACKUP" | cut -f1)）"

echo "── 2/6 探测现有证书路径 ──"
# **探测而不是假设**：证书路径写错会让 HTTPS 直接起不来，
# 而 HTTPS 是解锁功能的硬依赖。宁可失败退出，也不猜一个路径。
# 同样用 \K：后向断言是固定长度的，只能吃一个空格，
# 而对齐排版的配置（含本脚本自己生成的那份）用的是多个空格 ——
# 那会让重跑时读不到自己写的配置，且失败方式是"静默匹配不到"。
# \K 之后要求 \s+，因此不会误吃 ssl_certificate_key 那一行。
ALL_CERT=\$(sudo grep -rhoP '^\s*ssl_certificate\s+\K\S+(?=;)' /etc/nginx/ 2>/dev/null | sort -u || true)
ALL_KEY=\$(sudo grep -rhoP '^\s*ssl_certificate_key\s+\K\S+(?=;)' /etc/nginx/ 2>/dev/null | sort -u || true)
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
# 先记下旧站点的 root 目录再解除启用。
# **本脚本不删旧应用的文件**，只让 nginx 不再服务它 ——
# 删除必须发生在新站点验证通过之后，否则一旦新站点有问题就没有回退余地。
# 把路径打印出来，等验证通过再由人决定删不删。
# 用 \K 而不是后向断言：PCRE 的 (?<=...) 不支持可变长度，
# 而 root 前面的缩进长度不定，写成后向断言会静默匹配不到任何东西。
OLD_ROOTS=\$(sudo grep -rhoP '^\s*root\s+\K\S+(?=;)' /etc/nginx/sites-enabled/ 2>/dev/null \\
  | sort -u | grep -v "^\$WEBROOT\$" || true)

# 移除全部旧的启用软链（原配置已在第 1 步备份）
sudo rm -f /etc/nginx/sites-enabled/*

# **仅清 sites-enabled 是不够的。** 实测踩过：旧配置放在 conf.d/ 里，
# 而 Ubuntu 的 nginx.conf 先 include conf.d/ 再 include sites-enabled/，
# 先到的 server 块赢，我们的配置被判为 "conflicting server name ... ignored"。
# 症状极具欺骗性：nginx -t 只报 warn 不报错、reload 成功、页面返回 200，
# 一切看着都对，但服务的还是旧应用。
# 所以要扫遍整个 /etc/nginx，把所有声明了本域名的其他配置一并停用。
echo "   扫描其他位置的同域名配置……"
OTHERS=\$(sudo grep -rl "server_name.*\$DOMAIN" /etc/nginx/ 2>/dev/null \\
  | grep -v "^\$NGINX_SITE\$" | grep -v '/sites-enabled/' | sort -u || true)
if [[ -n "\$OTHERS" ]]; then
  while IFS= read -r f; do
    [[ -z "\$f" ]] && continue
    sudo mv "\$f" "\$f.disabled-\$STAMP"
    echo "     已停用 \$f → \$(basename "\$f").disabled-\$STAMP"
  done <<< "\$OTHERS"
else
  echo "     没有其他位置声明本域名"
fi

sudo ln -sf "\$NGINX_SITE" /etc/nginx/sites-enabled/

# 冲突必须当失败处理。nginx 把它当 warn，而 warn 不会让 nginx -t 返回非零 ——
# 于是"配置被忽略"这件事会静默通过，正是上一次部署失败的原因。
if sudo nginx -t 2>&1 | grep -q 'conflicting server name'; then
  echo "   ✗ 仍有同域名的 server 块在竞争，我们的配置会被忽略"
  sudo nginx -t 2>&1 | grep 'conflicting server name' | sed 's/^/     /'
  echo "   请检查：sudo nginx -T | grep -n 'server_name.*\$DOMAIN'"
  echo "   已中止。备份在 \$BACKUP"
  exit 1
fi

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
echo "完成。证书与 certbot 续期未做任何改动。"
echo "旧 nginx 配置已备份在 \${BACKUP}。"
if [[ -n "\$OLD_ROOTS" ]]; then
  echo
  echo "旧应用的文件「仍在磁盘上」，只是 nginx 不再服务它们："
  echo "\$OLD_ROOTS" | sed 's/^/    /'
  echo
  echo "先在手机和电脑上确认新站点能正常解锁并看到数据，确认无误后再删："
  echo "\$OLD_ROOTS" | sed 's|^|    sudo rm -rf |'
  echo "  —— 删除前不必着急，它们不占带宽也不被访问。"
fi
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
# **只看状态码会给出假绿。** 上一次部署就是这么骗过去的：旧应用同样返回 200，
# 而它也是个 SPA，任何不存在的路径都被回退成 index.html（仍是 200）——
# 于是"首页 200、快照 200、明文不可访问"三项全绿，服务的却还是旧程序。
# 所以必须验内容：认我们自己页面里的标识串。
sleep 2
FAILED=0
BODY=$(curl -s --max-time 20 "https://$DOMAIN/" || true)

if [[ "$BODY" == *'TIOS'* ]]; then
  printf '  ✓ 首页是本项目（标题含 TIOS）\n'
else
  FAILED=1
  printf '  \033[31m✗ 首页不是本项目\033[0m\n'
  TITLE=$(printf '%s' "$BODY" | grep -oP '(?<=<title>).*?(?=</title>)' | head -1 || true)
  printf '     实际标题：%s\n' "${TITLE:-（取不到）}"
  printf '     多半是仍有同域名的 server 块在竞争，或浏览器/CDN 缓存。\n'
  printf '     查：sudo nginx -T | grep -n "server_name.*%s"\n' "$DOMAIN"
fi

# 密文必须是真的密文，不能是被 SPA 回退接走的 index.html
ENC=$(curl -s --max-time 20 "https://$DOMAIN/data/today.enc.json" || true)
if [[ "$ENC" == *'"encrypted"'* && "$ENC" == *'"dataB64"'* ]]; then
  printf '  ✓ 加密快照可取且确为密文\n'
else
  FAILED=1
  printf '  \033[31m✗ 加密快照不可用\033[0m（取到的前 60 字节：%s）\n' "$(printf '%s' "$ENC" | head -c 60)"
fi

PLAIN=$(curl -s --max-time 20 "https://$DOMAIN/data/today.json" 2>/dev/null || true)
if [[ "$PLAIN" == *'"date"'* && "$PLAIN" == *'"holdings"'* ]]; then
  FAILED=1
  printf '  \033[31m✗ 明文快照可公开下载，请立即处理\033[0m\n'
else
  printf '  ✓ 明文快照不可访问\n'
fi

if (( FAILED )); then
  printf '\n  \033[31m部署未生效。旧配置与文件都还在，备份也在服务器 /root/ 下。\033[0m\n\n'
  exit 1
fi
printf '\n  手机打开 https://%s/ ，应先出现口令解锁页。\n' "$DOMAIN"
printf '  若仍看到旧页面，先强制刷新（iOS Safari：长按刷新按钮）。\n\n'
