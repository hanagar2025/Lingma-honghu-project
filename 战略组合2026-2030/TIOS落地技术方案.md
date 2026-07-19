# TIOS 落地技术方案 —— 从文档体系到可执行程序的闭环

> 制定日期：2026-07-19
> 载体：本仓库（鸿鹄理财，Express+TypeScript 后端 / React 前端 / MySQL / Redis）
> 原则：**规则即代码（Rules as Code）**。所有已冻结的条款（执行层V1.0、V2.0手册、CTC、六层引擎）逐条翻译为纯函数，人只做两件事——确认指令、录入成交。

---

## 一、闭环总览

```
┌─────────────────────────────────────────────────────────────┐
│  ①数据采集        每日收盘后：行情K线 / 账户快照 / 财务与一致预期 │
│      ↓            每周五：领先指标读数（人工+API混合录入）        │
│  ②引擎计算        阶段判定 → 执行层触发核对 → 估值/赔率 → 买卖闸门 │
│      ↓                                                       │
│  ③决策生成        自动产出《盘前四问》决策单（当晚生成，次日开盘前推送）│
│      ↓                                                       │
│  ④人工执行        用户在券商App执行指令（半自动：系统指令→人下单）  │
│      ↓                                                       │
│  ⑤成交回填        执行结果录入系统（价格/数量/是否偏离）           │
│      ↓                                                       │
│  ⑥复盘考核        执行率/违规次数自动统计 → 周报 → 季度评分与参数评审│
│      └──────────────── 回到①，形成闭环 ────────────────────────┘
```

**关键设计：交易指令由引擎生成，执行由人完成，偏离由系统记录。** 这与体系的考核哲学一致——评价的不是谁猜对了，而是谁执行了。

## 二、六层架构 → 代码模块映射

| TIOS层 | 代码模块 | 数据表 | 更新节奏 |
|---|---|---|---|
| 执行层 Trend OS | `services/tios/executionEngine.ts`（已实现） | rule_cards, trigger_events | 每日收盘 |
| 阶段/总量层 | `services/tios/stage.ts`（已实现） | market_stage_log | 每日收盘 |
| 买入闸门（两证+RR） | `services/tios/gates.ts`（已实现） | buy_gate_checks | 按需 |
| 估值引擎 | `services/tios/gates.ts` riskReward + 估值字段表 | valuations | 每周 |
| 领先指标看板 | 后续 `services/tios/indicatorsBoard.ts` | leading_indicators | 每周五 |
| 战略层 CTC | 评分卡表 + 季度评审流程 | ctc_scores, tech_tree | 每季度 |

## 三、已实现部分（P0，本次交付）

**纯函数引擎 `backend/src/services/tios/`**（零外部依赖，可独立测试）：

1. `types.ts` —— 领域类型：K线、持仓、规则卡、触发事件、阶段、盘前四问报告
2. `indicators.ts` —— 均线、单日涨跌、缩量判断
3. `executionEngine.ts` —— 执行层条款的代码化：
   - 硬止损（自成本回撤≥25% → 全退）
   - 单日熔断（跌幅≥12% → 次日开盘减30%；含历史未执行熔断的补执行位）
   - 均线条款（破120日全退 / 破60日减至40% / 破20日连续N日减20%，下跌期N=1）
   - 组合熔断（自峰值回撤≥15%→仓位上限50%；≥25%→只卖不买）
   - 触发优先级合并（同一股票多条款触发时取最严）
4. `stage.ts` —— 阶段判定（收盘价vs20日线+斜率，连续2日确认才改判）
5. `gates.ts` —— 买入闸门：止跌三要素（缩量/不创新低/收复5日线）、赔率RR计算与阈值、冻结原因枚举（阶段/单股12%/主题45%/板块30%/现金10%/禁买名单）
6. `dailyReport.ts` —— 盘前四问决策单生成器（输入行情+持仓+规则卡 → 输出四问JSON）
7. `selftest.ts` —— **用2026-07-16/17真实行情回放验收**：澜起收盘198.17不触发硬止损但补执行熔断、中际-12.00%边界触发、组合熔断分支A/B等
8. `routes/tios.ts` —— API：`POST /api/tios/daily-report`（传入数据→返回盘前四问）

## 四、后续阶段

| 阶段 | 内容 | 依赖 |
|---|---|---|
| P1 数据自动化 | 复用现有 `dataProvider.ts` 接真实K线（Tushare/东财）；账户快照录入页面；`cron.ts` 挂每日17:00自动生成盘前四问并推送 | Tushare token |
| P2 估值/赔率自动化 | 一致预期数据源接入，PE/PEG/分位自动计算，星级区间自动标注 | 财务数据源 |
| P3 领先指标看板 | 18个指标的录入界面+周五提醒+方向变化告警 | 人工录入为主 |
| P4 复盘自动化 | 成交回填→执行率/违规自动统计→周报生成（复用 `reportGenerator.ts`） | P1 |
| P5 前端 | 盘前四问页、看板页、规则卡管理页（复用现有React框架） | P1-P3 |

## 五、数据库新增表（P1时建）

```sql
rule_cards(code PK, hard_stop_pct, crash_pct, ban_buy, ban_reason, ma_rules_json, updated_at)
trigger_events(id, date, code, clause, action, detail, executed, exec_price, deviation, created_at)
market_stage_log(date PK, index_code, candidate, confirmed_stage, position_cap)
account_snapshots(date PK, total_assets, cash, positions_value, peak_assets)
leading_indicators(id, theme, name, reading, direction, source, updated_at)
valuations(code, date, pe_ttm, pe_fwd, peg, percentile_3y, roe_5y, star_zone)
decision_logs(id, date, report_json, three_questions_json, created_at)
```

## 六、执行模式的边界（重要）

- **系统不直连券商下单**。理由：①执行层条款全部以「次日开盘」为执行点，人工下单完全来得及；②失效条件条款需要人的最终确认；③合规与安全。
- 系统的责任边界：指令必须在开盘前生成完毕、指令必须可追溯到条款编号、偏离必须被记录。人的责任边界：按单执行、如实回填。
- 未来若需自动化下单，另行评审（券商API/条件单），不在本方案范围。
