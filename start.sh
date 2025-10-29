#!/bin/bash

# 股票决策小程序启动脚本
echo "🎵 启动股票决策小程序 - 音乐播放器风格"
echo "=================================="

# 检查Node.js版本
node_version=$(node -v 2>/dev/null)
if [ $? -ne 0 ]; then
    echo "❌ 错误: 未安装Node.js，请先安装Node.js >= 18.0.0"
    exit 1
fi

echo "✅ Node.js版本: $node_version"

# 检查是否在项目根目录
if [ ! -f "README.md" ] || [ ! -d "frontend" ] || [ ! -d "backend" ]; then
    echo "❌ 错误: 请在项目根目录运行此脚本"
    exit 1
fi

# 安装依赖
echo ""
echo "📦 安装依赖..."
echo "=============="

# 安装后端依赖
echo "安装后端依赖..."
cd backend
if [ ! -d "node_modules" ]; then
    npm install
    if [ $? -ne 0 ]; then
        echo "❌ 后端依赖安装失败"
        exit 1
    fi
fi
cd ..

# 安装前端依赖
echo "安装前端依赖..."
cd frontend
if [ ! -d "node_modules" ]; then
    npm install
    if [ $? -ne 0 ]; then
        echo "❌ 前端依赖安装失败"
        exit 1
    fi
fi
cd ..

echo "✅ 依赖安装完成"

# 检查环境配置
echo ""
echo "🔧 检查环境配置..."
echo "=================="

# 检查后端环境文件
if [ ! -f "backend/.env" ]; then
    echo "⚠️  警告: 未找到backend/.env文件"
    echo "请创建backend/.env文件并配置以下内容:"
    echo ""
    echo "NODE_ENV=development"
    echo "PORT=3000"
    echo "JWT_SECRET=your_jwt_secret_here"
    echo "DB_HOST=localhost"
    echo "DB_PORT=3306"
    echo "DB_USER=root"
    echo "DB_PASSWORD=your_password"
    echo "DB_NAME=stock_decision"
    echo "REDIS_URL=redis://localhost:6379"
    echo ""
    echo "按任意键继续..."
    read -n 1
fi

# 检查数据库连接
echo "检查数据库连接..."
# 这里可以添加数据库连接检查逻辑

echo "✅ 环境配置检查完成"

# 启动服务
echo ""
echo "🚀 启动服务..."
echo "=============="

# 启动后端服务
echo "启动后端服务 (端口: 3000)..."
cd backend
npm run dev &
BACKEND_PID=$!
cd ..

# 等待后端启动
sleep 3

# 启动前端服务
echo "启动前端服务 (端口: 5173)..."
cd frontend
npm run dev &
FRONTEND_PID=$!
cd ..

echo ""
echo "🎉 服务启动完成!"
echo "================"
echo "📱 前端地址: http://localhost:5173"
echo "🔧 后端地址: http://localhost:3000"
echo ""
echo "按 Ctrl+C 停止所有服务"

# 等待用户中断
trap 'echo ""; echo "🛑 正在停止服务..."; kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; echo "✅ 服务已停止"; exit 0' INT

# 保持脚本运行
wait
