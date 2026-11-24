/**
 * AI 主线全链的环节与核心股名单。
 *
 * 名单只有一处：scripts/ai-mainline-map.py 的 LAYERS。data/universe.json 由 scripts/chain-universe.py 从它导出，
 * CI 里用 --check 比对两边一致。要改名单，改脚本，然后重新导出。
 * 持仓里不在名单内的股票自动并入「链外持仓」，这样每只持仓都有读数。
 */
import universe from './data/universe.json'

export interface Segment { layer: string; segment: string; codes: string[] }

export const OUTSIDE_SEGMENT = '链外持仓'

export const SEGMENTS: readonly Segment[] = universe.layers.flatMap(l => l.segments.map(s => ({ layer: l.layer, segment: s.segment, codes: s.codes })))

export const CORE_CODES: readonly string[] = SEGMENTS.flatMap(s => s.codes)

/** 名单加上不在名单内的持仓 */
export function withHoldings(holdingCodes: readonly string[]): Segment[] {
  const extra = [...new Set(holdingCodes)].filter(c => /^\d{6}$/.test(c) && !CORE_CODES.includes(c))
  return extra.length ? [...SEGMENTS, { layer: OUTSIDE_SEGMENT, segment: OUTSIDE_SEGMENT, codes: extra }] : [...SEGMENTS]
}
