// 市场阶段判定 —— 《主线龙头投资体系V2.0》第二章的代码化
// 收盘价口径；改判需连续2个交易日满足新阶段标准

import type { DailyBar, MarketStage, StageResult } from './types'
import { maRising, sma } from './indicators'

const STAGE_CAPS: Record<MarketStage, number> = {
  uptrend: 0.8,
  range: 0.6,
  downtrend: 0.4,
}

/** 单日候选阶段：收盘 vs 20日线 + 20日线方向 */
export function candidateStage(bars: DailyBar[], endIndex?: number): MarketStage {
  const end = endIndex ?? bars.length - 1
  const ma20 = sma(bars, 20, end)
  if (ma20 === null) return 'range'
  const close = bars[end].close
  const rising = maRising(bars.slice(0, end + 1), 20) ?? false
  if (close > ma20 && rising) return 'uptrend'
  if (close < ma20 && !rising) return 'downtrend'
  return 'range'
}

/**
 * 正式阶段：最近连续2日候选阶段一致才改判，否则维持前一确认阶段。
 * @param prevConfirmed 前一交易日的确认阶段
 */
export function confirmStage(bars: DailyBar[], prevConfirmed: MarketStage): StageResult {
  const today = candidateStage(bars)
  const yesterday = bars.length >= 2 ? candidateStage(bars, bars.length - 2) : today
  const confirmed = today === yesterday ? today : prevConfirmed
  const changed = confirmed !== prevConfirmed
  return {
    candidate: today,
    confirmed,
    positionCap: STAGE_CAPS[confirmed],
    detail: changed
      ? `阶段改判：${prevConfirmed} → ${confirmed}（连续2日确认），仓位上限${STAGE_CAPS[confirmed] * 100}%`
      : `阶段维持：${confirmed}（当日候选${today}），仓位上限${STAGE_CAPS[confirmed] * 100}%`,
  }
}
