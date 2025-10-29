# 🚀 快速启动指南

## 🎵 股票决策小程序 - 音乐播放器风格

### 一键启动 (推荐)

#### macOS/Linux 用户
```bash
# 在项目根目录运行
./start.sh
```

#### Windows 用户
```cmd
# 在项目根目录运行
start.bat
```

### 手动启动

#### 1. 安装依赖
```bash
# 安装后端依赖
cd backend
npm install

# 安装前端依赖
cd ../frontend
npm install
```

#### 2. 配置环境
创建 `backend/.env` 文件：
```env
NODE_ENV=development
PORT=3000
JWT_SECRET=your_jwt_secret_here
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=your_password
DB_NAME=stock_decision
REDIS_URL=redis://localhost:6379
```

#### 3. 启动服务
```bash
# 启动后端 (终端1)
cd backend
npm run dev

# 启动前端 (终端2)
cd frontend
npm run dev
```

#### 4. 访问应用
- 📱 前端: http://localhost:5173
- 🔧 后端: http://localhost:3000

## 🎯 功能预览

### 1. 我的歌单 (Dashboard)
- 🎵 音乐播放器风格的股票展示
- ▶️ 播放/暂停股票分析
- 📊 投资概览统计

### 2. 持仓管理 (Portfolio)
- 🎶 歌单视图和列表视图
- 🔍 搜索和筛选功能
- ➕ 添加/编辑持仓

### 3. 数据分析 (Analysis)
- 📈 技术分析图表
- 📊 基本面分析
- 🏢 板块分析

### 4. 智能报表 (Reports)
- 🌅 盘前准备报表
- 📈 盘中观察报表
- 🌆 收盘复盘报表
- 🤖 日终决策报表

### 5. AI决策 (Decisions)
- 🧠 智能投资决策
- 📋 决策历史记录
- ⚡ 一键执行决策

### 6. 系统设置 (Settings)
- ⚙️ 个人设置
- 📊 系统监控
- 💬 用户反馈

## 🎨 设计特色

### 音乐播放器风格
- 🎵 股票以歌单形式展示
- ▶️ 播放/暂停控制
- 📊 评分进度条
- 🎶 音乐播放器界面

### 现代设计
- 🌈 渐变背景色彩
- 🔄 12px圆角设计
- ✨ 悬停动画效果
- 📱 响应式布局

### 色彩系统
- **主色调**: 蓝紫渐变 (#667eea → #764ba2)
- **右侧仓位**: 绿色 (#52c41a)
- **左侧仓位**: 蓝色 (#1890ff)
- **防御仓位**: 橙色 (#faad14)
- **观察仓位**: 紫色 (#722ed1)

## 🛠️ 技术栈

### 前端
- React 18 + TypeScript
- Ant Design 5
- Redux Toolkit
- React Router
- ECharts
- Vite

### 后端
- Node.js + Express
- TypeScript
- MySQL
- Redis
- JWT
- WebSocket

### 数据源
- 新浪财经 (免费)
- 东方财富 (免费)
- 腾讯财经 (免费)

## 🎵 使用技巧

### 1. 歌单操作
- 点击股票卡片的播放按钮开始分析
- 使用音乐播放器控制播放状态
- 通过搜索栏快速找到目标股票

### 2. 播放控制
- 播放: 开始股票分析
- 暂停: 停止分析
- 上一首/下一首: 切换股票
- 音量: 调整分析强度

### 3. 视图切换
- 歌单视图: 音乐播放器风格
- 列表视图: 传统表格视图
- 概览视图: 投资概览信息

## 🚨 常见问题

### Q: 启动失败怎么办？
A: 检查Node.js版本 >= 18.0.0，确保依赖安装完整

### Q: 数据库连接失败？
A: 检查MySQL服务是否启动，确认数据库配置正确

### Q: 前端页面空白？
A: 检查后端服务是否正常启动，确认API接口可访问

### Q: 样式显示异常？
A: 清除浏览器缓存，重新加载页面

## 📞 技术支持

- 📧 邮箱: support@stock-music.com
- 💬 微信: stock-music-support
- 🌐 官网: https://stock-music.com

---

**让投资变得像听音乐一样轻松！** 🎵📈

