// 盘前四问决策单生成器 —— 闭环第③步
// 输入：全部持仓+K线+规则卡+账户快照+前日阶段 → 输出：结构化盘前四问

import type { AccountSnapshot, DailyBar, DailyReport, MarketStage, Position, RuleCard } from './types'
import { evaluatePortfolioCircuit, evaluateSellRules, mergeTriggers } from './executionEngine'
import { confirmStage } from './stage'
import { checkBuyGate } from './gates'

export interface DailyReportInput {
  date: string
  indexBars: DailyBar[]
  prevConfirmedStage: MarketStage
  snapshot: AccountSnapshot
  positions: Position[]
  cards: Record<string, RuleCard>
  barsByCode: Record<string, DailyBar[]>
}

export function generateDailyReport(input: DailyReportInput): DailyReport {
  const stage = confirmStage(input.indexBars, input.prevConfirmedStage)
  const circuit = evaluatePortfolioCircuit(input.snapshot)

  const allSellEvents = input.positions.flatMap(p => {
    const card = input.cards[p.code]
    const bars = input.barsByCode[p.code]
    if (!card || !bars) return []
    return evaluateSellRules(p, card, bars, stage.confirmed)
  })
  const sells = mergeTriggers(allSellEvents)
  const sellCodes = new Set(sells.map(s => s.code))

  const buys = input.positions.map(p =>
    checkBuyGate({
      position: p,
      code: p.code,
      name: p.name,
      sector: p.sector,
      theme: p.theme,
      card: input.cards[p.code],
      bars: input.barsByCode[p.code],
      stage: stage.confirmed,
      snapshot: input.snapshot,
      allPositions: input.positions,
      activeSellTriggers: sells.filter(s => s.code === p.code),
    })
  )

  const holds = input.positions.filter(p => !sellCodes.has(p.code)).map(p => `${p.name}(${p.code})`)
  const banned = buys.filter(b => !b.allowed).map(b => ({ code: b.code, reasons: b.freezeReasons }))
  const allowedBuys = buys.filter(b => b.allowed)

  const conclusion =
    sells.length === 0 && allowedBuys.length === 0
      ? '今天什么也不做。'
      : `执行：${sells.map(s => `${s.name}${actionText(s.action)}`).join('；')}${allowedBuys.length > 0 ? `；买入解锁：${allowedBuys.map(b => b.code).join('、')}（仍需星级价格资格+RR≥3+调仓三问）` : ''}。其余不动。`

  return { date: input.date, stage, portfolioCircuit: circuit, buys: allowedBuys, sells, holds, banned, conclusion }
}

function actionText(action: string): string {
  switch (action) {
    case 'EXIT_ALL': return '全部退出'
    case 'REDUCE_TO_40': return '减至原仓位40%以下'
    case 'REDUCE_30': return '减30%'
    case 'REDUCE_20': return '减20%'
    default: return ''
  }
}
