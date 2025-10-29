#!/bin/bash

# 股票决策小程序 - 环境配置脚本
echo "🎵 股票决策小程序 - 环境配置"
echo "=============================="

# 检查环境
echo ""
echo "🔍 检查环境..."

# 检查 Node.js
if ! command -v node &> /dev/null; then
    echo "❌ 未安装 Node.js，请先安装 Node.js >= 18.0.0"
    exit 1
fi
echo "✅ Node.js: $(node -v)"

# 检查 MySQL
if ! command -v mysql &> /dev/null; then
    echo "❌ 未安装 MySQL"
    echo "请先运行: ./install_dependencies.sh"
    exit 1
fi
echo "✅ MySQL: $(mysql --version | awk '{print $5}')"

# 检查 Redis
if ! command -v redis-server &> /dev/null; then
    echo "❌ 未安装 Redis"
    echo "请先运行: ./install_dependencies.sh"
    exit 1
fi
echo "✅ Redis: $(redis-server --version | awk '{print $3}')"

# 配置数据库
echo ""
echo "🗄️  配置数据库..."
read -p "请输入 MySQL root 密码: " -s MYSQL_PASSWORD
echo ""

# 创建数据库
mysql -u root -p"$MYSQL_PASSWORD" -e "CREATE DATABASE IF NOT EXISTS stock_decision CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;" 2>/dev/null

if [ $? -eq 0 ]; then
    echo "✅ 数据库 stock_decision 创建成功"
else
    echo "⚠️  数据库可能已存在或密码错误"
fi

# 配置环境变量
echo ""
echo "⚙️  配置环境变量..."

if [ ! -f "backend/.env" ]; then
    cp backend/env.example backend/.env
    
    # 生成 JWT Secret
    JWT_SECRET=$(openssl rand -hex 32)
    
    # 更新 .env 文件
    sed -i.bak "s/DB_PASSWORD=your_password/DB_PASSWORD=$MYSQL_PASSWORD/" backend/.env
    sed -i.bak "s/JWT_SECRET=your_jwt_secret_key/JWT_SECRET=$JWT_SECRET/" backend/.env
    
    echo "✅ 环境配置文件已创建: backend/.env"
    echo ""
    echo "📝 配置文件内容预览:"
    echo "===================="
    cat backend/.env | grep -v "your_"
    echo ""
else
    echo "✅ 环境配置文件已存在"
fi

# 安装依赖
echo ""
echo "📦 安装项目依赖..."

# 后端依赖
if [ ! -d "backend/node_modules" ]; then
    echo "安装后端依赖..."
    cd backend
    npm install
    cd ..
else
    echo "✅ 后端依赖已安装"
fi

# 前端依赖
if [ ! -d "frontend/node_modules" ]; then
    echo "安装前端依赖..."
    cd frontend
    npm install
    cd ..
else
    echo "✅ 前端依赖已安装"
fi

echo ""
echo "🎉 环境配置完成！"
echo ""
echo "下一步："
echo "运行 ./start.sh 启动服务"
echo ""

