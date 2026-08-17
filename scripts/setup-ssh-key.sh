#!/usr/bin/env bash
# 给 ECS 配一把 SSH 密钥 —— 不重启实例
#
# 背景：阿里云**查不到已有私钥**。私钥只在创建密钥对时下载那一次，
# 阿里云自己也不留副本。所以"在哪里查看"这个问题没有答案，只能新配一把。
#
# 阿里云控制台的做法是"创建密钥对 → 绑定实例"，但**绑定会重启实例**。
# 本脚本走另一条路：本机生成密钥，把公钥贴进服务器的 authorized_keys。
# 不碰阿里云的密钥对功能，因此不需要重启 —— 线上服务不会中断。
#
# 用法：./scripts/setup-ssh-key.sh

set -euo pipefail

HOST="${DEPLOY_HOST:-39.104.86.200}"
KEY="${DEPLOY_KEY:-$HOME/.ssh/tios_ecs}"
LINE="$(printf '─%.0s' {1..70})"

step() { printf '\n%s\n%s\n%s\n' "$LINE" "$1" "$LINE"; }

step "一、本机生成密钥（私钥永不离开这台电脑）"
if [[ -f "$KEY" ]]; then
  printf '  已存在 %s，直接复用。\n' "$KEY"
else
  # ed25519：比 RSA 短得多，贴进终端时不会因为换行被截断
  ssh-keygen -t ed25519 -f "$KEY" -N "" -C "tios-deploy-$(date +%Y%m%d)"
  printf '\n  已生成 %s（私钥）与 %s.pub（公钥）\n' "$KEY" "$KEY"
fi
chmod 600 "$KEY"

PUB="$(cat "$KEY.pub")"

step "二、把公钥装到服务器上（用阿里云 Workbench 的浏览器终端）"
cat <<EOF
  阿里云控制台 → 云服务器 ECS → 实例 → honghu-wealth → 远程连接 → Workbench
  （你截图里那个"免密连接"，用户名 root，直接点登录）

  登录后把下面这一整段粘贴进去，回车：

────────────────────────────────────────────────────────────────────
mkdir -p ~/.ssh && chmod 700 ~/.ssh && echo '$PUB' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys && echo "公钥已装好，共 \$(wc -l < ~/.ssh/authorized_keys) 把"
────────────────────────────────────────────────────────────────────

  这条命令只往 authorized_keys 追加一行，不删任何东西、不重启任何服务。
EOF

step "三、回到本机验证"
cat <<EOF
  ssh -i $KEY root@$HOST 'echo 连接成功; nginx -v'

  第一次连接会问 "Are you sure you want to continue connecting?" —— 输 yes。
  能打印出 nginx 版本就说明通了。
EOF

step "四、部署"
cat <<EOF
  DEPLOY_HOST=${HOST} DEPLOY_KEY=${KEY} npm run ship

  ship 按顺序做完五步（部署前端 → 校验线上 → 更新服务器脚本 → 跑一次 → 再校验），
  任一步失败立刻停。先加 DRY_RUN=1 看清楚再执行。
EOF

step "如果想让 Cursor 里的 Agent 替你部署"
cat <<EOF
  把私钥内容加到 Cursor 后台：Cloud Agents → Secrets，
  变量名 ECS_SSH_KEY，值是下面这个文件的「全部内容」：

    $KEY

  查看：cat $KEY

  提醒两点：
    · 这是私钥。除了 Cursor Secrets，不要贴到任何聊天、issue 或提交里。
    · 这把钥匙只用于部署。想随时废除，登录服务器删掉 authorized_keys 里
      对应的那一行即可（注释是 tios-deploy-*），不影响你原有的登录方式。
EOF

printf '\n%s\n' "$LINE"
printf '不需要在阿里云创建密钥对，也不需要重启实例 —— 线上服务不会中断。\n'
printf '%s\n\n' "$LINE"
