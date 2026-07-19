// TIOS 引擎验收自测 —— 用 2026-07-16/17 的真实场景回放
// 运行：npm run tios:selftest（tsx 直接执行，无需数据库）

import type { DailyBar, Position, RuleCard } from './types'
import { evaluateSellRules, evaluatePortfolioCircuit, mergeTriggers } from './executionEngine'
import { riskReward } from './gates'

let failures = 0
function check(name: string, cond: boolean, detail = '') {
  if (cond) {
    console.log(`  ✓ ${name}`)
  } else {
    failures++
    console.error(`  ✗ ${name} ${detail}`)
  }
}

/** 构造K线：给定收盘价序列（成交量恒定），只用于不依赖均线的条款测试 */
function barsFromCloses(closes: number[]): DailyBar[] {
  return closes.map((c, i) => ({
    date: `D${i}`,
    open: c,
    high: c,
    low: c,
    close: c,
    volume: 1_000_000,
  }))
}

console.log('场景1：澜起科技 2026-07-17 —— 盘中186低于止损线，收盘198.17回到线上 → 硬止损不触发；7/16的-16.44%熔断待补执行')
{
  const position: Position = { code: '688008', name: '澜起科技', sector: '电子', theme: 'AI', cost: 261.447, marketValue: 250000 }
  const card: RuleCard = { code: '688008', hardStopPct: 0.25, crashPct: 0.12, banBuy: true, banReason: '韩国反垄断调查', pendingCrashExecutions: 1 }
  // 7/15收盘252.66 → 7/16收盘211.13(-16.44%) → 7/17收盘198.17(-6.14%)
  const bars = barsFromCloses([252.66, 211.13, 198.17])
  const events = evaluateSellRules(position, card, bars, 'downtrend')
  const clauses = events.map(e => e.clause)
  check('硬止损未触发（回撤24.2% < 25%）', !clauses.includes('V1.0-2.1-硬止损'), JSON.stringify(clauses))
  check('当日-6.14%未触发新熔断', !events.some(e => e.clause === 'V1.0-2.1-单日熔断'), JSON.stringify(clauses))
  check('存在熔断补执行位（减30%）', events.some(e => e.clause === 'V1.0-2.1-熔断补执行' && e.action === 'REDUCE_30'))

  // 若收盘为盘中低点186.10，硬止损应触发且合并后取最严（全退）
  const barsIntraday = barsFromCloses([252.66, 211.13, 186.10])
  const events2 = mergeTriggers(evaluateSellRules(position, card, barsIntraday, 'downtrend'))
  const top = events2.find(e => e.code === '688008')
  check('若收盘186.10则硬止损触发并按最严合并为全退', top?.action === 'EXIT_ALL', JSON.stringify(events2))
}

console.log('场景2：中际旭创 2026-07-17 收盘-12.00% —— 熔断边界值触发')
{
  const position: Position = { code: '300308', name: '中际旭创', sector: '通信', theme: 'AI', cost: 967.221, marketValue: 400000 }
  const card: RuleCard = { code: '300308', hardStopPct: 0.25, crashPct: 0.12, banBuy: false, pendingCrashExecutions: 0 }
  // 前收1113.02 → 收盘979.46 = 原始-11.9998%，显示口径-12.00% → 应触发（引擎按显示口径判定）
  const bars = barsFromCloses([1113.02, 979.46])
  const events = evaluateSellRules(position, card, bars, 'downtrend')
  check('-12.00%边界触发熔断减30%', events.some(e => e.clause === 'V1.0-2.1-单日熔断' && e.action === 'REDUCE_30'), JSON.stringify(events))

  // -11.99% 不应触发
  const bars2 = barsFromCloses([1113.02, 1113.02 * (1 - 0.1199)])
  const events2 = evaluateSellRules(position, card, bars2, 'downtrend')
  check('-11.99%不触发熔断', !events2.some(e => e.clause === 'V1.0-2.1-单日熔断'))
}

console.log('场景3：组合熔断分支 —— 净值高点口径决定判定结果')
{
  const branchA = evaluatePortfolioCircuit({ date: '2026-07-17', totalAssets: 3841267, cash: 1403569, positionsValue: 2437598, peakAssets: 4300000 })
  check('分支A（高点430万）：回撤10.7%未触发', branchA.positionCap === 1, branchA.detail)
  const branchB = evaluatePortfolioCircuit({ date: '2026-07-17', totalAssets: 3841267, cash: 1403569, positionsValue: 2437598, peakAssets: 4640000 })
  check('分支B（高点464万）：回撤17.2%触发50%上限', branchB.positionCap === 0.5 && !branchB.sellOnly, branchB.detail)
}

console.log('场景4：赔率引擎阈值')
{
  const good = riskReward(100, 130, 90) // 上行30% 下行10% → RR 3
  check('RR=3.0 允许建仓', good.verdict === 'FIRST_ENTRY_OK', `rr=${good.rr.toFixed(2)}`)
  const bad = riskReward(100, 120, 75) // 上行20% 下行25% → RR 0.8
  check('RR=0.8 禁止买入', bad.verdict === 'FORBIDDEN', `rr=${bad.rr.toFixed(2)}`)
}

if (failures > 0) {
  console.error(`\n自测失败：${failures} 项`)
  process.exit(1)
}
console.log('\n全部自测通过。')
