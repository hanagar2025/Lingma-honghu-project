#!/usr/bin/env bash
set -euo pipefail

# 启动后端与前端（小程序 alipay）开发环境的简单脚本
# 后端在前台运行，前端在后台运行（便于在单一终端启动所有服务）

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
echo "Root: $ROOT_DIR"

echo "Starting backend dev..."
npm run dev:backend &
BACKEND_PID=$!

echo "Starting frontend alipay dev (watch)..."
npm run dev:alipay &
FRONTEND_PID=$!

echo "Started backend (pid=$BACKEND_PID) and frontend (pid=$FRONTEND_PID)."
echo "To stop: kill $BACKEND_PID $FRONTEND_PID"

wait $BACKEND_PID $FRONTEND_PID
