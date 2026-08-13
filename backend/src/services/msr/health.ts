// 主线健康度 —— 区分"主线内部轮动"与"末端补涨"
// 委员会 2026-08-13 判据：龙头调整时，必须同时满足①板块总成交保持②二线扩散
// ③强势股数量增加④产业基本面无恶化，才允许判定为轮动；否则为末端补涨，禁买。

import type { DailyBar } from '../tios/types'
import { sma } from '../tios/indicators'
import type { Mainline, UniverseMember } from './universe'

export type MainlineHealth = 'ROTATION' | 'TAIL_CHASE' | 'HEALTHY_UPTREND' | 'BROAD_RETREAT' | 'INSUFFICIENT_DATA'

export interface MainlineHealthResult {
  mainlineId: string
  mainlineName: string
  health: MainlineHealth
  /** 龙头（tier 1）是否处于调整 */
  leadersAdjusting: boolean
  /** 板块总成交额 20/60 比值 */
  sectorAmt20Over60: number | null
  /** 强势股数量（收盘站上MA20）本期 vs 20日前 */
  strongCountNow: number
  strongCountPrev: number
  /** 二线（tier2/3）跑赢龙头的家数占比 */
  tier2OutperformRatio: number | null
  detail: string
  /** 是否允许 MSR 输出建仓候选 */
  allowCandidates: boolean
}

function ret(bars: DailyBar[], n: number): number | null {
  if (bars.length < n + 1) return null
  return bars[bars.length - 1].close / bars[bars.length - 1 - n].close - 1
}

function amountRatio(bars: DailyBar[], shortN: number, longN: number): number | null {
  if (bars.length < longN) return null
  const amt = bars.map(b => b.close * b.volume)
  const s = amt.slice(-shortN).reduce((a, b) => a + b, 0) / shortN
  const l = amt.slice(-longN).reduce((a, b) => a + b, 0) / longN
  return l === 0 ? null : s / l
}

/** 站上MA20 视为强势；prevOffset 用于回看20日前的同一判据 */
function isStrong(bars: DailyBar[], prevOffset = 0): boolean {
  const idx = bars.length - 1 - prevOffset
  if (idx < 20) return false
  const ma = sma(bars, 20, idx)
  return ma !== null && bars[idx].close > ma
}

export function evaluateMainlineHealth(
  mainline: Mainline,
  barsByCode: Record<string, DailyBar[]>
): MainlineHealthResult {
  const members = mainline.members.filter(m => !m.retiredC)
  const withBars = members.filter(m => (barsByCode[m.code]?.length ?? 0) >= 60)
  if (withBars.length < 3) {
    return {
      mainlineId: mainline.id, mainlineName: mainline.name, health: 'INSUFFICIENT_DATA',
      leadersAdjusting: false, sectorAmt20Over60: null, strongCountNow: 0, strongCountPrev: 0,
      tier2OutperformRatio: null, detail: '有效样本不足3只', allowCandidates: false,
    }
  }

  const leaders = withBars.filter(m => m.tier === 1)
  const tier23 = withBars.filter(m => m.tier !== 1)

  // ① 龙头是否调整：tier1 全部收于 MA20 下方 或 20日收益为负
  const leadersAdjusting = leaders.length > 0 && leaders.every(m => {
    const b = barsByCode[m.code]
    const ma20 = sma(b, 20)
    const r20 = ret(b, 20)
    return (ma20 !== null && b[b.length - 1].close < ma20) || (r20 !== null && r20 < 0)
  })

  // ② 板块总成交额是否保持：以全部成员成交额合成
  const dates = barsByCode[withBars[0].code].map(b => b.date)
  const sectorSeries: DailyBar[] = dates.slice(-70).map(d => {
    let amt = 0
    let close = 0
    let cnt = 0
    for (const m of withBars) {
      const hit = barsByCode[m.code].find(b => b.date === d)
      if (hit) { amt += hit.close * hit.volume; close += hit.close; cnt++ }
    }
    return { date: d, open: 0, high: 0, low: 0, close: cnt > 0 ? close / cnt : 0, volume: cnt > 0 ? amt / Math.max(close / cnt, 1) : 0 }
  })
  const sectorAmt = amountRatio(sectorSeries, 20, 60)

  // ③ 强势股数量：现在 vs 20日前
  const strongNow = withBars.filter(m => isStrong(barsByCode[m.code], 0)).length
  const strongPrev = withBars.filter(m => isStrong(barsByCode[m.code], 20)).length

  // ④ 二线是否真正跑赢龙头（20日口径，非单日/单周补涨）
  const leaderR20 = leaders.length > 0
    ? leaders.reduce((a, m) => a + (ret(barsByCode[m.code], 20) ?? 0), 0) / leaders.length
    : null
  const tier2Out = leaderR20 === null || tier23.length === 0
    ? null
    : tier23.filter(m => (ret(barsByCode[m.code], 20) ?? -1) > leaderR20).length / tier23.length

  const sectorHolding = sectorAmt !== null && sectorAmt >= 0.9
  const diffusionUp = strongNow > strongPrev
  const tier2Leading = tier2Out !== null && tier2Out >= 0.5

  let health: MainlineHealth
  let detail: string
  if (!leadersAdjusting && strongNow >= withBars.length * 0.6 && sectorHolding) {
    health = 'HEALTHY_UPTREND'
    detail = '龙头未进入调整且板块广度良好 —— 无需轮动，按既有持仓规则运行'
  } else if (!sectorHolding && !diffusionUp) {
    health = 'BROAD_RETREAT'
    detail = `板块成交萎缩(额20/60=${sectorAmt?.toFixed(2) ?? 'NA'})且强势股数量未增加(${strongPrev}→${strongNow}) —— 全板块资金撤退，主线战术降仓，禁止建仓`
  } else if (leadersAdjusting && sectorHolding && diffusionUp && tier2Leading) {
    health = 'ROTATION'
    detail = `龙头调整 + 板块成交保持(${sectorAmt?.toFixed(2)}) + 强势股扩散(${strongPrev}→${strongNow}) + 二线20日跑赢龙头占比${((tier2Out ?? 0) * 100).toFixed(0)}% —— 主线内部轮动成立`
  } else if (leadersAdjusting) {
    const miss: string[] = []
    if (!sectorHolding) miss.push(`板块成交萎缩(${sectorAmt?.toFixed(2) ?? 'NA'})`)
    if (!diffusionUp) miss.push(`强势股未扩散(${strongPrev}→${strongNow})`)
    if (!tier2Leading) miss.push(`二线20日未真正跑赢龙头(占比${tier2Out === null ? 'NA' : (tier2Out * 100).toFixed(0) + '%'})`)
    health = 'TAIL_CHASE'
    detail = `龙头调整但轮动条件不全：${miss.join('、')} —— 判定为末端补涨，禁止建仓`
  } else {
    health = 'TAIL_CHASE'
    detail = '轮动条件不全，按末端补涨处理'
  }

  return {
    mainlineId: mainline.id,
    mainlineName: mainline.name,
    health,
    leadersAdjusting,
    sectorAmt20Over60: sectorAmt,
    strongCountNow: strongNow,
    strongCountPrev: strongPrev,
    tier2OutperformRatio: tier2Out,
    detail,
    allowCandidates: health === 'ROTATION',
  }
}

export function memberLabel(m: UniverseMember): string {
  return `${m.name}(${m.code}·T${m.tier}·${m.node})`
}
