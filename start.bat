@echo off
chcp 65001 >nul

REM 股票决策小程序启动脚本
echo 🎵 启动股票决策小程序 - 音乐播放器风格
echo ==================================

REM 检查Node.js版本
node -v >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ 错误: 未安装Node.js，请先安装Node.js ^>= 18.0.0
    pause
    exit /b 1
)

for /f "tokens=*" %%i in ('node -v') do set node_version=%%i
echo ✅ Node.js版本: %node_version%

REM 检查是否在项目根目录
if not exist "README.md" (
    echo ❌ 错误: 请在项目根目录运行此脚本
    pause
    exit /b 1
)

if not exist "frontend" (
    echo ❌ 错误: 请在项目根目录运行此脚本
    pause
    exit /b 1
)

if not exist "backend" (
    echo ❌ 错误: 请在项目根目录运行此脚本
    pause
    exit /b 1
)

REM 安装依赖
echo.
echo 📦 安装依赖...
echo ==============

REM 安装后端依赖
echo 安装后端依赖...
cd backend
if not exist "node_modules" (
    npm install
    if %errorlevel% neq 0 (
        echo ❌ 后端依赖安装失败
        pause
        exit /b 1
    )
)
cd ..

REM 安装前端依赖
echo 安装前端依赖...
cd frontend
if not exist "node_modules" (
    npm install
    if %errorlevel% neq 0 (
        echo ❌ 前端依赖安装失败
        pause
        exit /b 1
    )
)
cd ..

echo ✅ 依赖安装完成

REM 检查环境配置
echo.
echo 🔧 检查环境配置...
echo ==================

REM 检查后端环境文件
if not exist "backend\.env" (
    echo ⚠️  警告: 未找到backend\.env文件
    echo 请创建backend\.env文件并配置以下内容:
    echo.
    echo NODE_ENV=development
    echo PORT=3000
    echo JWT_SECRET=your_jwt_secret_here
    echo DB_HOST=localhost
    echo DB_PORT=3306
    echo DB_USER=root
    echo DB_PASSWORD=your_password
    echo DB_NAME=stock_decision
    echo REDIS_URL=redis://localhost:6379
    echo.
    echo 按任意键继续...
    pause >nul
)

echo ✅ 环境配置检查完成

REM 启动服务
echo.
echo 🚀 启动服务...
echo ==============

REM 启动后端服务
echo 启动后端服务 (端口: 3000)...
cd backend
start "后端服务" cmd /k "npm run dev"
cd ..

REM 等待后端启动
timeout /t 3 /nobreak >nul

REM 启动前端服务
echo 启动前端服务 (端口: 5173)...
cd frontend
start "前端服务" cmd /k "npm run dev"
cd ..

echo.
echo 🎉 服务启动完成!
echo ================
echo 📱 前端地址: http://localhost:5173
echo 🔧 后端地址: http://localhost:3000
echo.
echo 按任意键退出...
pause >nul

