// 买入闸门 —— 三道闸的代码化：阶段解禁 → 两证（止跌三要素+价格/赔率资格）→ 仓位上限
// 对应 V2.0第六章、CTC第四章、TIOS赔率引擎

import type { AccountSnapshot, BuyGateResult, DailyBar, FreezeReason, MarketStage, Position, RuleCard, TriggerEvent } from './types'
import { noNewLow, sma, volumeShrinking } from './indicators'

export interface RiskReward {
  upside: number
  downside: number
  rr: number
  verdict: 'FIRST_ENTRY_OK' | 'ADD_ONLY' | 'HOLD_ONLY' | 'FORBIDDEN'
}

/** 赔率引擎：RR≥3可建仓；2~3只可对盈利仓加码；1.5~2持有不加；<1.5禁止 */
export function riskReward(current: number, targetPrice: number, defensePrice: number): RiskReward {
  const upside = targetPrice / current - 1
  const downside = 1 - defensePrice / current
  const rr = downside > 0 ? upside / downside : Infinity
  let verdict: RiskReward['verdict']
  if (rr >= 3) verdict = 'FIRST_ENTRY_OK'
  else if (rr >= 2) verdict = 'ADD_ONLY'
  else if (rr >= 1.5) verdict = 'HOLD_ONLY'
  else verdict = 'FORBIDDEN'
  return { upside, downside, rr, verdict }
}

/** 止跌三要素：缩量 + 不创新低 + 放量收复5日线（V2.0第六章） */
export function stopFallConfirmed(bars: DailyBar[]): { ok: boolean; detail: string } {
  const shrink = volumeShrinking(bars)
  const noLow = noNewLow(bars)
  const last = bars[bars.length - 1]
  const ma5 = sma(bars, 5)
  let avg5vol = 0
  if (bars.length >= 6) {
    for (let j = bars.length - 6; j < bars.length - 1; j++) avg5vol += bars[j].volume
    avg5vol /= 5
  }
  const reclaim = ma5 !== null && last.close > ma5 && avg5vol > 0 && last.volume >= avg5vol * 1.5
  const ok = shrink && noLow && reclaim
  return {
    ok,
    detail: `缩量:${shrink ? '✓' : '✗'} 不创新低:${noLow ? '✓' : '✗'} 放量收复5日线:${reclaim ? '✓' : '✗'}`,
  }
}

export interface BuyGateInput {
  position?: Position // 已有持仓（加仓场景）
  code: string
  name: string
  sector: string
  theme: string
  card: RuleCard
  bars: DailyBar[]
  stage: MarketStage
  snapshot: AccountSnapshot
  allPositions: Position[]
  /** 该股是否有卖出条款执行中 */
  activeSellTriggers: TriggerEvent[]
}

/** 买入闸门总检查：返回是否允许与全部冻结原因（一个都不能有） */
export function checkBuyGate(input: BuyGateInput): BuyGateResult {
  const reasons: FreezeReason[] = []
  const { snapshot, allPositions } = input

  if (input.stage === 'downtrend') reasons.push('STAGE_DOWNTREND')
  if (input.card.banBuy) reasons.push('BAN_LIST')
  if (input.activeSellTriggers.length > 0) reasons.push('SELLING_IN_PROGRESS')

  const stockPct = (input.position?.marketValue ?? 0) / snapshot.totalAssets
  if (stockPct >= 0.12) reasons.push('STOCK_CAP_12')

  const sectorValue = allPositions.filter(p => p.sector === input.sector).reduce((s, p) => s + p.marketValue, 0)
  if (sectorValue / snapshot.totalAssets >= 0.3) reasons.push('SECTOR_CAP_30')

  const themeValue = allPositions.filter(p => p.theme === input.theme).reduce((s, p) => s + p.marketValue, 0)
  if (themeValue / snapshot.totalAssets >= 0.45) reasons.push('THEME_CAP_45')

  if (snapshot.cash / snapshot.totalAssets <= 0.1) reasons.push('CASH_FLOOR_10')

  const stopFall = stopFallConfirmed(input.bars)
  if (!stopFall.ok) reasons.push('NO_STOP_FALL')

  return {
    code: input.code,
    allowed: reasons.length === 0,
    freezeReasons: reasons,
    detail: reasons.length === 0 ? `全部闸门通过（${stopFall.detail}）` : `冻结：${reasons.join(', ')}；${stopFall.detail}`,
  }
}
