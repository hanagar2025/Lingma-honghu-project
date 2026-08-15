// 7 笔执行债务按 8/15 新口径逐笔重审
//
// 委员会 2026-08-15：「先纠正账，再统计执行率。否则你会拿一个错误的仓位模型，
// 去惩罚自己的执行能力 —— 这才是真正危险的系统错误。」
//
// 这份脚本只做一件事：把每一笔待执行卖出指令的**法定理由**放到新口径下重算，
// 判断它是否仍然成立。它不生成新动作，也不撤销任何指令 ——
// 撤销属于执行层，须由委员会逐笔确认。

import { readFileSync } from 'node:fs'
import { fetchDailyBars } from './src/services/marketData'
import { LIMITS, singleNameWeight } from './src/services/cockpit/safety'

interface PF {
  cash: number
  externalCash?: number | null
  positions: { code: string; name: string; quantity: number }[]
}

async function main() {
  const pf = JSON.parse(
    readFileSync('src/services/cockpit/data/portfolio.json', 'utf-8')
  ) as PF

  const mv: Record<string, { name: string; v: number }> = {}
  for (const p of pf.positions) {
    const bars = await fetchDailyBars(p.code, 5)
    const px = bars.length ? bars[bars.length - 1].close : 0
    mv[p.code] = { name: p.name, v: px * p.quantity }
  }
  const positionsValue = Object.values(mv).reduce((s, x) => s + x.v, 0)
  const brokerTotal = pf.cash + positionsValue
  const portfolioTotal = brokerTotal + (pf.externalCash ?? 0)
  const w = (v: number) => `${(v / 10000).toFixed(1)}万`

  console.log('执行债务重审 —— 按 2026-08-15 组合口径')
  console.log('─'.repeat(78))
  console.log(`旧分母（券商账户合计）${w(brokerTotal)}`)
  console.log(`新分母（组合总资产）  ${w(portfolioTotal)}`)
  console.log()

  console.log('标的'.padEnd(8), '市值'.padEnd(9), '旧口径'.padEnd(9),
    '新口径'.padEnd(9), '旧结论'.padEnd(11), '新结论')
  console.log('─'.repeat(78))

  let stillOver = 0
  let voided = 0
  for (const [, x] of Object.entries(mv).sort((a, b) => b[1].v - a[1].v)) {
    const oldPct = x.v / brokerTotal
    const newPct = singleNameWeight(x.v, portfolioTotal)
    const oldOver = oldPct > LIMITS.singleStock
    const newOver = newPct > LIMITS.singleStock
    if (oldOver && newOver) stillOver++
    if (oldOver && !newOver) voided++
    console.log(
      x.name.padEnd(6),
      w(x.v).padEnd(10),
      `${(oldPct * 100).toFixed(1)}%`.padEnd(10),
      `${(newPct * 100).toFixed(2)}%`.padEnd(10),
      (oldOver ? `超${((oldPct - 0.12) * 100).toFixed(1)}pct` : '未超限').padEnd(12),
      newOver ? `仍超${((newPct - 0.12) * 100).toFixed(2)}pct` : (oldOver ? '← 理由消失' : '未超限')
    )
  }

  console.log('─'.repeat(78))
  console.log(`旧口径超限但新口径不超限：${voided} 只 → 其"仓位超限"法定理由已不成立`)
  console.log(`两个口径都超限：${stillOver} 只 → 法定理由仍成立，但幅度须按新口径重算`)
  console.log()
  console.log('对 7 笔待执行卖出指令的结论：')
  console.log('  · 凡法定理由为 POSITION_LIMIT 且标的落在"理由消失"一列的，')
  console.log('    该笔指令的前提已不存在，不应继续计入 E1 执行率的分母。')
  console.log('  · 凡法定理由为熔断（CIRCUIT_BREAKER）的，当前无法判断 ——')
  console.log('    峰值仍是券商账户口径，回撤不可比，须先重新认定峰值。')
  console.log('  · 凡法定理由为 C 级清退或硬止损的，与分母无关，继续有效。')
  console.log()
  console.log('本脚本不撤销任何指令。撤销属执行层，须委员会逐笔确认后记录。')
}
main()
