# TIOS —— 科技投资操作系统（精炼版）

一个**规则驱动**的个人交易决策小程序。没有预测、没有推荐、没有Mock数据——只有一个大脑：把《交易操作系统V1.0》《主线龙头体系V2.0》《CTC框架》的铁律翻译成代码，每天生成一张**盘前四问**决策单，并记录你是否执行了它。

## 核心理念

> 规则在盘前写好，盘中不许改。体系的价值不在于预测对错，而在于执行一致性。

系统只回答四个问题：

1. **今天允许买入什么？**（三道闸门：阶段解禁 → 止跌三要素 → 仓位/现金/禁买检查）
2. **今天必须卖出什么？**（硬止损25% / 单日熔断12% / 破均线 / 组合熔断，优先级最高）
3. **继续持有什么？**（没有触发条款的一律不动）
4. **今天禁止做什么？**（下跌期禁买、单股12%/板块30%/主题45%上限、现金10%红线）

## 完整闭环

```
① 数据    腾讯行情（免费，无需token）→ 真实日K落库 stock_daily
② 决策    TIOS规则引擎：市场阶段判定 + 卖出条款 + 买入闸门 → 盘前四问
③ 留痕    决策报告入库 decision_reports，卖出指令生成待执行记录
④ 反馈    盘后回填"是否执行"→ 铁律执行率统计（体系有效性的核心指标）
```

工作日 17:00（北京时间）自动运行；也可在页面上一键手动触发。

## 技术栈与结构

- 后端：Node.js 20 + Express + TypeScript + MySQL（唯一外部依赖）
- 前端：React 18 + Vite + Ant Design + Redux Toolkit

```
backend/src/
  services/tios/        # 大脑：纯函数规则引擎（阶段判定/卖出条款/买入闸门/赔率/盘前四问）
  services/marketData.ts # 数据：腾讯行情接入（报价/日K/搜索）
  services/tiosService.ts# 编排：数据库状态 → 引擎输入 → 报告留痕
  services/scheduler.ts  # 定时：工作日17:00自动跑闭环
  routes/               # auth / portfolio / market / tios
frontend/src/
  pages/DailyReport.tsx  # 盘前四问（主页）：决策单 + 执行回填 + 规则卡 + 账户状态
  pages/Portfolio.tsx    # 持仓管理（板块/主题字段用于仓位闸门）
交易操作系统/           # 体系文档：规则条款原文
战略组合2026-2030/      # 体系文档：战略框架与作战地图
```

## 在浏览器里看今天的分析（推荐，不需要数据库和登录）

驾驶舱有四个出口，读的是**同一份数据**，因此不可能给出互相矛盾的结论。

首次在一台新机器上（把 `~/tios` 换成你想放的目录）：

```bash
git clone -b cursor/decision-audit-c819 https://github.com/hanagar2025/Lingma-honghu-project.git ~/tios
cd ~/tios
npm install
npm run web
```

`npm run web` 会自己打开浏览器；没打开就手动开 `http://localhost:5173`。
之后每天只要两步：`cd ~/tios` 然后 `npm run web`。

`npm run web` 做两件事：先用命令行引擎直连行情算出当日快照
（落到 `frontend/public/data/today.json`），再以离线模式启动前端读它。
**全程不碰 MySQL，也不需要登录** —— 因为"今天没看"重复三次，系统就等于不存在。

| 出口 | 命令 | 适用场景 |
|---|---|---|
| 浏览器（React 五层驾驶舱） | `npm run web` | 每天盘后看，可展开追溯每个数字 |
| 单文件 HTML | `npm run daily` → `backend/src/services/cockpit/data/reports/` | 发到手机、存档、离线翻看 |
| 命令行 | `npm run daily` | 需要归档变化台账与决策审计时 |

离线模式下拿不到的东西会**显式标注缺失**，不用默认值伪装成通过项：
执行债务明细与「标记已执行」按钮、KPI E1–E4、家庭年度刚性支出 —— 这三项存在数据库里。
需要勾选清偿执行债务时，才需要下面的完整模式。

要做成静态站点（可放任意静态托管）：

```bash
npm run web:build  # 产出 frontend/dist，含快照
npm run web:serve
```

## 手机上看

两条路，都不需要把数据放到公网。

```bash
npm run web:lan    # 起服务并打印手机可访问的局域网地址
```

手机与电脑连**同一个 WiFi**，在手机浏览器打开打印出来的 `http://192.168.x.x:5173`。
离开这个 WiFi 就打不开，外网访问不到 —— 对一个显示全部持仓与总资产的页面来说，
这个限制是特性而不是缺陷。

不想开电脑服务时，走单文件路线：`npm run daily` 生成的
`backend/src/services/cockpit/data/reports/YYYY-MM-DD.html` 隔空投送到手机，
用 Safari 打开即可。窄屏已单独适配（表格横滑，不隐藏任何一列 ——
手机上看不到的那列，正好可能是法定减仓理由）。完全离线，可长期存档翻看。

> ### ⚠ 不要把这个页面放到公开的静态托管上
>
> 页面包含全部持仓、股数、成本、现金与总资产。GitHub Pages 在免费与 Pro 计划下
> **即使仓库是私有的，发布出去的站点也是公开的**。
> 若确实需要一个随处可访问的链接，必须选带访问控制的方案
> （例如 Cloudflare Access、Netlify 密码保护、Tailscale 私有网络），
> 不能只依赖"URL 没人知道"。

## 三个真踩过的坑

**一、`致命错误：不是 Git 仓库` / `Could not read package.json`**

命令是在家目录（`~`）下跑的，那里既没有 `.git` 也没有 `package.json`。
先 `cd` 到项目目录。确认当前位置：`pwd`；确认是不是项目根：`ls package.json`。

**二、`cd: too many arguments`**

zsh 交互式 shell **默认不把 `#` 当注释**（`interactive_comments` 未开启），
所以 `cd /some/path   # 说明文字` 里的说明文字会被当成 `cd` 的额外参数。
粘贴命令时不要带行尾注释；本 README 的命令块都不含注释。

**三、手机打不开 `192.168.1.x`**

`192.168.1.x` 是**占位写法，不是可用地址**。真实地址要看 `npm run web:lan`
打印出来的那一行，形如 `http://192.168.1.23:5173` —— 最后那段是具体数字。
手机还必须与电脑连同一个 WiFi。

## 持仓数据的存放位置（关系到隐私）

`backend/src/services/cockpit/data/portfolio.json` 记录现金、峰值净值、每只标的的股数与成本。
它默认**在版本库里**，因此仓库若是公开的，这些数字就是公开的。审计档
（`data/audits/*.md`）与变化台账（`governance/data/changelog/*.json`）同样含仓位百分比与减仓金额。

两种处理方式，按需要选一种：

1. **把仓库设为 Private**（推荐）—— 保留跨机器同步，一处设置即可。
   注意历史提交不会自动消失，改为私有只能止住继续暴露。
2. **把持仓文件放到版本库之外** —— 所有命令都支持 `PORTFOLIO=` 指定路径：

   ```bash
   PORTFOLIO=~/.tios/portfolio.json npm run web:snapshot
   ```

   此时可以 `git rm --cached backend/src/services/cockpit/data/portfolio.json` 并加入 `.gitignore`。
   代价是持仓不再随仓库同步。

## 完整模式（需要数据库，可写入执行记录）

```bash
# 1. 准备 MySQL，创建数据库
mysql -e "CREATE DATABASE stock_decision CHARACTER SET utf8mb4"

# 2. 配置环境变量
cp backend/env.example backend/.env   # 填入数据库密码

# 3. 安装依赖并启动（前端 5173 / 后端 5000）
npm install
npm run dev
```

首次使用：注册账号 → 「持仓管理」录入持仓（含板块/主题）→ 「盘前四问」填入现金与净值高点 → 点击「同步行情并生成今日决策」。

接口不可用时前端会**自动降级**到离线快照并在页面顶部说明原因 ——
后端挂掉时还能看到当天数据，比弹一个报错更有用。

## 验证

```bash
npm run tios:selftest   # 引擎自测：用2026-07-16/17真实行情验证全部条款
npm test                # 后端测试
```

## 主要API

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/tios/run` | 一键闭环：同步K线→生成盘前四问→入库 |
| GET | `/api/tios/report/latest` | 最新决策报告 |
| PUT | `/api/tios/rule-cards/:code` | 修改个股规则卡（止损/熔断/禁买） |
| PUT | `/api/tios/account` | 更新现金与净值高点 |
| PUT | `/api/tios/executions/:id` | 回填执行记录 |
| GET | `/api/tios/executions/stats` | 铁律执行率 |
| POST | `/api/tios/risk-reward` | 赔率计算（RR≥3才允许建仓） |

## 铁律的保护条款

规则化卖出遇到极端事件（公司公告、海外重大事件、交易所异常）时，允许**盘前书面引用**保护条款，效果仅为"推迟到收盘再确认"，滥用记为违规。详见 `战略组合2026-2030/TIOS六层架构-估值赔率与领先指标V1.0.md`。
