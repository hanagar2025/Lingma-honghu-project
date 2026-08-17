#!/usr/bin/env bash
# 一条命令走完全部发布流程，失败即停
#
# ── 为什么需要它 ──
#
# 发布要按顺序做四件事：部署前端 → 校验线上 → 更新服务器脚本 → 跑一次并校验。
# 分成四条命令交给人执行，实测反复出现同一类问题：
# 其中一步被跳过或中途挂起，而后面几步照样"跑完了"，输出看起来只是有点怪 ——
# 于是排查方向指向最后一步，真正的原因在第一步。
#
# 合成一条并且**任一步失败立刻停**，就能把"哪一步坏了"直接暴露出来。
# 这不是图省事，是让失败位置可读。
#
# 用法：
#   DEPLOY_HOST=39.104.86.200 DEPLOY_KEY=~/.ssh/tios_ecs ./scripts/ship.sh
#   SKIP_SERVER=1 ...   只部署前端，不动服务器定时任务
#   DRY_RUN=1 ...       只打印将执行什么

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOST="${DEPLOY_HOST:-39.104.86.200}"
KEY="${DEPLOY_KEY:-$HOME/.ssh/tios_ecs}"
LINE="$(printf '━%.0s' {1..70})"

STEP=0
TOTAL=5

banner() {
  STEP=$((STEP + 1))
  printf '\n%s\n【%d/%d】%s\n%s\n' "$LINE" "$STEP" "$TOTAL" "$1" "$LINE"
}

fail() {
  printf '\n\033[31m%s\033[0m\n' "$LINE"
  printf '\033[31m第 %d/%d 步失败：%s\033[0m\n' "$STEP" "$TOTAL" "$1"
  printf '\033[31m后面的步骤没有执行 —— 先解决这一步，不要跳过。\033[0m\n'
  printf '\033[31m%s\033[0m\n\n' "$LINE"
  exit 1
}

cd "$ROOT"

if [[ "${DRY_RUN:-0}" == "1" ]]; then
  cat <<EOF

将按顺序执行（任一步失败即停）：

  1/5  git 状态检查（有未提交改动时提醒，但不阻止）
  2/5  部署前端到 ${HOST}（含快照，会清空站点目录再解包）
  3/5  校验线上（npm run web:status）
  4/5  更新服务器上的仓库与更新脚本
  5/5  在服务器上跑一次并强制发布，再校验一次

加 SKIP_SERVER=1 可只做 1–3 步。

EOF
  exit 0
fi

# ── 1/5 本地状态 ──
banner "本地状态检查"
if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  printf '  \033[33m注意：有未提交的本地改动。\033[0m发布用的是「工作区」内容，不是最后一次提交。\n'
  git status --short --untracked-files=no | sed 's/^/    /'
  printf '\n'
else
  printf '  ✓ 工作区干净，发布内容与最后一次提交一致\n'
fi
printf '  当前提交：%s\n' "$(git log --oneline -1)"
[[ -f "$KEY" ]] || fail "找不到 SSH 私钥 ${KEY}。先跑 ./scripts/setup-ssh-key.sh"
printf '  ✓ SSH 私钥 %s\n' "$KEY"

# ── 2/5 部署前端 ──
# 放在最前面，因为服务器上的定时任务只更新数据文件；
# JS/CSS 与页面功能全靠这一步。跳过它，后面几步都会"成功"而页面依旧是旧的。
banner "部署前端到服务器"
DEPLOY_HOST="$HOST" DEPLOY_KEY="$KEY" NONINTERACTIVE=1 ./scripts/deploy-ecs.sh \
  || fail "前端部署失败"

# ── 3/5 校验线上 ──
banner "校验线上状态"
npm run --silent web:status || fail "线上校验未通过（上面逐项列出了原因）"

if [[ "${SKIP_SERVER:-0}" == "1" ]]; then
  printf '\n  SKIP_SERVER=1：跳过服务器定时任务部分。\n\n'
  exit 0
fi

# ── 4/5 更新服务器脚本 ──
# 必须在 run-now 之前。服务器上的 update-snapshot.sh 是 install 时写的快照，
# 本地改了它并不会自动同步 —— 这一点实测坑过一次：
# 加了 FORCE 支持后服务器仍跑旧版，现象看起来像"FORCE 没生效"。
banner "更新服务器上的仓库与更新脚本"
DEPLOY_HOST="$HOST" DEPLOY_KEY="$KEY" ./scripts/schedule-server.sh update \
  || fail "服务器脚本更新失败"

# ── 5/5 跑一次并校验 ──
banner "在服务器上跑一次并强制发布"
DEPLOY_HOST="$HOST" DEPLOY_KEY="$KEY" ./scripts/schedule-server.sh run-now \
  || fail "服务器执行失败"

printf '\n  再校验一次线上：\n'
npm run --silent web:status || fail "服务器发布后线上仍不正常"

cat <<EOF

$LINE
全部完成。
$LINE

  手机打开 https://hhwealth.cc/ ，直接就是驾驶舱。
  若仍看到旧页面，强制刷新（iOS Safari 长按刷新按钮）。

  下一个交易日 09:20 / 15:10 服务器会自动更新，Mac 可以关机。
  届时跑一次 npm run web:status，看到"数据是今天的"即整条链闭环。

  档案（changelog / 审计档）归属方是服务器。定期取回提交：
    DEPLOY_HOST=$HOST DEPLOY_KEY=$KEY ./scripts/schedule-server.sh pull-archive

EOF
