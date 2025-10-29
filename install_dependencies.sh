#!/bin/bash

# 股票决策小程序 - 依赖安装脚本
echo "🎵 股票决策小程序 - 依赖安装"
echo "================================"

# 检查系统
OS="$(uname -s)"
echo "操作系统: $OS"

# 安装 Homebrew (macOS)
if [ "$OS" = "Darwin" ]; then
    if ! command -v brew &> /dev/null; then
        echo ""
        echo "📦 检测到 macOS，需要安装 Homebrew"
        echo "请访问: https://brew.sh/"
        echo "或运行以下命令:"
        echo '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"'
        echo ""
        read -p "是否已安装 Homebrew? (y/n) " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            echo "请先安装 Homebrew，然后重新运行此脚本"
            exit 1
        fi
    fi
    
    echo ""
    echo "✅ Homebrew 已安装"
    
    # 安装 MySQL
    echo ""
    echo "📦 安装 MySQL..."
    if ! command -v mysql &> /dev/null; then
        brew install mysql
    else
        echo "✅ MySQL 已安装"
    fi
    
    # 启动 MySQL
    echo ""
    echo "🚀 启动 MySQL 服务..."
    brew services start mysql || echo "MySQL 服务已启动"
    
    # 安装 Redis
    echo ""
    echo "📦 安装 Redis..."
    if ! command -v redis-server &> /dev/null; then
        brew install redis
    else
        echo "✅ Redis 已安装"
    fi
    
    # 启动 Redis
    echo ""
    echo "🚀 启动 Redis 服务..."
    brew services start redis || echo "Redis 服务已启动"
    
    echo ""
    echo "✅ 所有依赖安装完成！"
    echo ""
    echo "下一步："
    echo "1. 运行 ./setup.sh 配置环境"
    echo "2. 运行 ./start.sh 启动服务"
    
elif [ "$OS" = "Linux" ]; then
    echo ""
    echo "📦 检测到 Linux 系统"
    echo "请手动安装 MySQL 和 Redis："
    echo ""
    echo "# Ubuntu/Debian"
    echo "sudo apt-get update"
    echo "sudo apt-get install mysql-server redis-server"
    echo ""
    echo "# CentOS/RHEL"
    echo "sudo yum install mysql-server redis"
    echo ""
    echo "安装完成后运行: ./setup.sh"
    
else
    echo "不支持的操作系统: $OS"
    exit 1
fi

