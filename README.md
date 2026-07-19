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

## 快速开始

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
