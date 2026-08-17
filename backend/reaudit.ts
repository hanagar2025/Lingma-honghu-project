// CLI：npm run reaudit
//
// 只做重审与分类，不生成任何交易指令。

import { readFileSync } from 'node:fs'
import { fetchDailyBars } from './src/services/marketData'
import { loadDebts, reauditDebts, renderReaudit } from './src/services/governance/reaudit'
import type { AccountSnapshot, Position } from './src/services/tios/types'

interface PF {
  cash: number
  externalCash?: number | null
  peakAssets: number
  peakBasis?: 'BROKER' | 'PORTFOLIO'
  positions: { code: string; name: string; quantity: number; cost: number; sector: string; theme: string }[]
}

async function main() {
  const pf = JSON.parse(
    readFileSync('src/services/cockpit/data/portfolio.json', 'utf-8')
  ) as PF

  const positions: Position[] = []
  for (const p of pf.positions) {
    const bars = await fetchDailyBars(p.code, 5)
    const px = bars.length ? bars[bars.length - 1].close : p.cost
    positions.push({
      code: p.code, name: p.name, sector: p.sector, theme: p.theme,
      cost: p.cost * p.quantity, marketValue: px * p.quantity,
    })
  }

  const positionsValue = positions.reduce((s, p) => s + p.marketValue, 0)
  const brokerTotal = pf.cash + positionsValue
  const externalCash = pf.externalCash ?? 0
  const snapshot: AccountSnapshot = {
    date: new Date().toISOString().slice(0, 10),
    brokerTotal,
    cash: pf.cash,
    positionsValue,
    externalCash,
    portfolioTotal: brokerTotal + externalCash,
    peakAssets: pf.peakAssets,
    peakBasis: pf.peakBasis ?? 'BROKER',
  }

  const rows = reauditDebts(loadDebts(), snapshot, positions)
  process.stdout.write(renderReaudit(rows, snapshot))

  // 峰值口径是 D4（熔断类）能否重算的前提，故与重审同屏输出
  const { peakScenarios, renderPeakScenarios, renderPeakHistory } =
    await import('./src/services/governance/peakBasis')
  process.stdout.write(`${renderPeakHistory()}\n`)
  // legacy 峰值必须取自 PEAK_HISTORY，不能用 pf.peakAssets ——
  // 后者在 8/15 裁定后已经是组合口径的 630 万，再加 200 万会得出 830 万。
  const { PEAK_HISTORY: PH } = await import('./src/services/governance/peakBasis')
  const legacyPeak = PH.find(r => r.basis === 'legacy_account_basis')?.peak ?? 0
  process.stdout.write(renderPeakScenarios(peakScenarios(
    snapshot.portfolioTotal, snapshot.positionsValue, legacyPeak, externalCash
  )))
}
main()
