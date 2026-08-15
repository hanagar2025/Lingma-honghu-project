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
    totalAssets: brokerTotal,
    cash: pf.cash,
    positionsValue,
    externalCash,
    portfolioTotal: brokerTotal + externalCash,
    peakAssets: pf.peakAssets,
    peakBasis: pf.peakBasis ?? 'BROKER',
  }

  const rows = reauditDebts(loadDebts(), snapshot, positions)
  process.stdout.write(renderReaudit(rows, snapshot))
}
main()
