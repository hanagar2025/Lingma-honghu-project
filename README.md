# 鸿鹄

按真实账本出执行单。一个页面，一个输入框。

战略写在 `战略组合2026-2030/战略书-v1-草案.md`，不写在代码里。代码只做三件事：

1. 账户与纪律：读账本和持仓价格，按三条卖出规则和仓位上限算出当天的执行单。价格两处来源对不上、账本过期，就不下单。
2. 收件：委员会在页面上交持仓截图、成交记录、下单前的一行字。账本、成交、意向、截图只存在服务器的私有目录里，不进仓库。
3. 规则指纹：现行规则登记成清单并取指纹，任何改动都会在基线文件的 diff 里显形。

## 目录

| 位置 | 内容 |
|---|---|
| `backend/src/services/dailyDecision/` | 执行单：规则、账本、两源核价、版式、推送、历史回归 |
| `backend/src/services/intake/` | 输入框：文字句式、勾稽核对、私有存储 |
| `backend/src/services/governance/` | 规则登记册与基线、峰值口径 |
| `backend/src/services/msr/` | 四条主线名单；估值分位（只用于排序） |
| `backend/src/index.ts` | 服务器 |
| `frontend/` | 页面 |
| `scripts/` | 季度扫描、去杠杆监控、部署 |
| `战略组合2026-2030/` | 战略书、裁定、研究记录 |

## 常用命令

```bash
npm ci
npm run typecheck
npm run selftest                          # 执行单与输入框自检
npm -w backend run decision:regress       # 用历史执行单验收现在的代码
npm -w backend run freeze:check           # 规则指纹与基线比对
npm run decision                          # 出一张执行单（定时任务用）
```

本机试跑服务器：

```bash
DATA_DIR=.private COMMITTEE_TOKEN=<至少16位> npm run dev
```

部署到服务器（root，在仓库根目录）：

```bash
DOMAIN=<域名> bash scripts/deploy-server.sh
```

## 输入框怎么写

| 用途 | 写法 |
|---|---|
| 下单前登记 | `计划卖出 中际旭创 600股 单票归位` |
| 成交 | `卖出 中际旭创 600股 509.89`，一行一笔；或发成交截图 |
| 持仓 | 发持仓截图。识别结果过了勾稽核对后，回到页面确认，账本才更新 |
| 其他 | 直接写，原样转给战略侧 |

## 边界

- 执行单是下单计划，不是成交记录。
- 买入只通过《分段重建计划》，执行单不产生买入。
- 规则与阈值的改动须经委员会裁定，并重新生成规则基线。
- 金额、股数、现金不进公开仓库。
