// MSR 五维雷达 —— 纯函数，无外部依赖
// 五维：资金提前量 / 相对强度 / 趋势启动状态 / 产业证据 / 估值与位置
//
// 硬性设计约束（2026-08-13 入档条款）：
//   禁止"涨幅否决法"。区间涨幅不得单独作为否决理由。
//   实证依据：中际旭创三段主升浪中幅度最大的一段（+198.7%），起点为"前60日已涨88.6%、超额+69pct"。
//   若以涨幅否决，将完整错过该段。有鉴别力的变量是扣非兑现与主线归因，不是位置。

import type { DailyBar } from '../tios/types'
import { sma } from '../tios/indicators'
import { EVIDENCE_SCORE, type UniverseMember } from './universe'

export interface DimensionScore {
  /** 0–5 */
  score: number
  /** 该维度是否数据完整。不完整 → 整体评分不完整 → 不具备候选资格 */
  complete: boolean
  detail: string
}

export interface RadarResult {
  code: string
  name: string
  tier: 1 | 2 | 3
  node: string
  capital: DimensionScore
  relativeStrength: DimensionScore
  trend: DimensionScore
  evidence: DimensionScore
  valuation: DimensionScore
  /** 五维合计 0–25 */
  total: number
  complete: boolean
  /** 参考量：绝对涨幅仅用于展示与体检，禁止作为否决依据 */
  metrics: RadarMetrics
}

export interface RadarMetrics {
  close: number
  ma20: number | null
  ma60: number | null
  ma120: number | null
  distMa20: number | null
  distMa60: number | null
  distMa120: number | null
  amt20Over60: number | null
  upDownVolumeRatio: number | null
  pullbackDepths: number[]
  ret10: number | null
  ret20: number | null
  ret60: number | null
  excess10: number | null
  excess20: number | null
  excess60: number | null
}

function ret(bars: DailyBar[], n: number): number | null {
  if (bars.length < n + 1) return null
  return bars[bars.length - 1].close / bars[bars.length - 1 - n].close - 1
}

/** 成交额（近似：收盘价×成交量），比值口径自洽，规避不同板块成交量单位差异 */
function amountRatio(bars: DailyBar[], shortN: number, longN: number): number | null {
  if (bars.length < longN) return null
  const amt = bars.map(b => b.close * b.volume)
  const s = amt.slice(-shortN).reduce((a, b) => a + b, 0) / shortN
  const l = amt.slice(-longN).reduce((a, b) => a + b, 0) / longN
  return l === 0 ? null : s / l
}

/** 上涨日均量 ÷ 下跌日均量。>1 = 上涨放量（筹码结构改善）；<1 = 下跌放量（派发） */
export function upDownVolumeRatio(bars: DailyBar[], window = 20): number | null {
  if (bars.length < window + 1) return null
  const seg = bars.slice(-window)
  const up: number[] = []
  const dn: number[] = []
  for (let i = 1; i < seg.length; i++) {
    if (seg[i].close > seg[i - 1].close) up.push(seg[i].volume)
    else if (seg[i].close < seg[i - 1].close) dn.push(seg[i].volume)
  }
  if (up.length === 0 || dn.length === 0) return null
  const au = up.reduce((a, b) => a + b, 0) / up.length
  const ad = dn.reduce((a, b) => a + b, 0) / dn.length
  return ad === 0 ? null : au / ad
}

/**
 * 回调深度序列：识别近 window 日内的局部高点，计算其后回撤幅度。
 * 委员会判据：回调越来越浅 = 承接增强。
 */
export function pullbackDepths(bars: DailyBar[], window = 60): number[] {
  if (bars.length < 10) return []
  const seg = bars.slice(-window)
  const depths: number[] = []
  let peak = seg[0].close
  let trough = seg[0].close
  let rising = true
  for (let i = 1; i < seg.length; i++) {
    const c = seg[i].close
    if (rising) {
      if (c > peak) {
        peak = c
        trough = c
      } else if (c < peak * 0.96) {
        rising = false
        trough = c
      }
    } else {
      if (c < trough) trough = c
      if (c > trough * 1.04) {
        depths.push(trough / peak - 1)
        rising = true
        peak = c
        trough = c
      }
    }
  }
  return depths
}

/** 维度一：资金提前量 */
export function scoreCapital(bars: DailyBar[]): DimensionScore {
  const a2060 = amountRatio(bars, 20, 60)
  const a560 = amountRatio(bars, 5, 60)
  const udv = upDownVolumeRatio(bars)
  const depths = pullbackDepths(bars)
  if (a2060 === null || udv === null) {
    return { score: 0, complete: false, detail: '成交数据不足60日' }
  }
  let s = 0
  const parts: string[] = []
  // ① 成交额抬升阶梯：0.7→0.9→1.1→1.3
  if (a2060 >= 1.3) { s += 2; parts.push(`额20/60=${a2060.toFixed(2)}(显著抬升+2)`) }
  else if (a2060 >= 1.1) { s += 1.5; parts.push(`额20/60=${a2060.toFixed(2)}(抬升+1.5)`) }
  else if (a2060 >= 0.9) { s += 1; parts.push(`额20/60=${a2060.toFixed(2)}(走平+1)`) }
  else { parts.push(`额20/60=${a2060.toFixed(2)}(萎缩+0)`) }
  // ② 上涨放量、下跌缩量
  if (udv >= 1.3) { s += 2; parts.push(`涨跌量比=${udv.toFixed(2)}(结构优+2)`) }
  else if (udv >= 1.0) { s += 1; parts.push(`涨跌量比=${udv.toFixed(2)}(中性偏优+1)`) }
  else { parts.push(`涨跌量比=${udv.toFixed(2)}(下跌放量·派发特征+0)`) }
  // ③ 回调递浅
  if (depths.length >= 2) {
    const last = depths[depths.length - 1]
    const prev = depths[depths.length - 2]
    if (Math.abs(last) < Math.abs(prev)) { s += 1; parts.push(`回调递浅 ${(prev * 100).toFixed(1)}%→${(last * 100).toFixed(1)}%(+1)`) }
    else { parts.push(`回调加深 ${(prev * 100).toFixed(1)}%→${(last * 100).toFixed(1)}%(+0)`) }
  } else {
    parts.push('回调样本不足(+0)')
  }
  if (a560 !== null && a560 > a2060 && a2060 >= 0.9) { s = Math.min(5, s); }
  return { score: Math.min(5, s), complete: true, detail: parts.join('；') }
}

/** 维度二：相对强度（对主线基准指数） */
export function scoreRelativeStrength(bars: DailyBar[], index: DailyBar[]): DimensionScore {
  const r10 = ret(bars, 10), r20 = ret(bars, 20), r60 = ret(bars, 60)
  const i10 = ret(index, 10), i20 = ret(index, 20), i60 = ret(index, 60)
  if (r10 === null || r20 === null || i10 === null || i20 === null) {
    return { score: 0, complete: false, detail: '数据不足20日' }
  }
  const e10 = r10 - i10, e20 = r20 - i20
  const e60 = r60 !== null && i60 !== null ? r60 - i60 : null
  let s = 0
  const parts = [`10日超额${(e10 * 100).toFixed(1)}pct`, `20日超额${(e20 * 100).toFixed(1)}pct`]
  if (e60 !== null) parts.push(`60日超额${(e60 * 100).toFixed(1)}pct`)
  // 委员会判据：10日与20日同时转正才算恢复；仅短期为正不计分
  if (e10 > 0 && e20 > 0) s += 3
  else if (e10 > 0) s += 1
  if (e60 !== null && e60 > 0) s += 1
  if (e10 > 0 && e20 > 0 && e60 !== null && e60 > 0) s += 1
  return { score: Math.min(5, s), complete: true, detail: parts.join('；') }
}

/**
 * 维度三：趋势启动状态。
 * 委员会判据：MA20 由下降→走平→向上，MA60 由下降→走平，价格突破MA20后回踩不破再突破。
 * 关键：本维度奖励"刚从弱转强"，对"已极端加速"降分 —— 这是位置的合法用法（衡量趋势阶段），
 * 而非涨幅否决（禁止用"已涨X%"作为否决理由）。
 */
export function scoreTrend(bars: DailyBar[]): DimensionScore {
  const n = bars.length - 1
  const ma20 = sma(bars, 20), ma60 = sma(bars, 60)
  if (ma20 === null || ma60 === null || bars.length < 65) {
    return { score: 0, complete: false, detail: '数据不足60日' }
  }
  const ma20Prev = sma(bars, 20, n - 5)
  const ma60Prev = sma(bars, 60, n - 5)
  const close = bars[n].close
  let s = 0
  const parts: string[] = []
  const ma20Slope = ma20Prev === null ? 0 : ma20 / ma20Prev - 1
  const ma60Slope = ma60Prev === null ? 0 : ma60 / ma60Prev - 1
  if (ma20Slope > 0.01) { s += 1.5; parts.push(`MA20上行(${(ma20Slope * 100).toFixed(1)}%/5日)+1.5`) }
  else if (ma20Slope > -0.01) { s += 1; parts.push('MA20走平+1') }
  else { parts.push(`MA20下行(${(ma20Slope * 100).toFixed(1)}%)+0`) }
  if (ma60Slope > 0.005) { s += 1.5; parts.push('MA60上行+1.5') }
  else if (ma60Slope > -0.005) { s += 1; parts.push('MA60走平+1') }
  else { parts.push(`MA60下行(${(ma60Slope * 100).toFixed(1)}%)+0`) }
  if (close > ma20) { s += 1; parts.push('站上MA20+1') }
  if (close > ma60) { s += 1; parts.push('站上MA60+1') }
  // 极端加速扣分：距MA20 过远意味着趋势已在加速段而非启动段
  const dist20 = close / ma20 - 1
  if (dist20 > 0.25) { s -= 2; parts.push(`距MA20 +${(dist20 * 100).toFixed(1)}%(极端加速段-2)`) }
  else if (dist20 > 0.15) { s -= 1; parts.push(`距MA20 +${(dist20 * 100).toFixed(1)}%(加速段-1)`) }
  return { score: Math.max(0, Math.min(5, s)), complete: true, detail: parts.join('；') }
}

/** 维度四：产业证据（人工维护，不得由行情推断） */
export function scoreEvidence(m: UniverseMember): DimensionScore {
  const s = EVIDENCE_SCORE[m.evidence]
  const attrOk = m.mainlineAttributionVerified
  const parts = [`证据${m.evidence}级`]
  let score = s
  if (attrOk === false) {
    score = Math.min(score, 2)
    parts.push('收入主线归因未核验(封顶2分)')
  } else if (attrOk === undefined) {
    parts.push('主线归因待核验')
  }
  return { score, complete: attrOk !== undefined, detail: parts.join('；') }
}

/** 维度五：估值与位置。PE历史分位缺失 → 评分不完整（档案条款：评分不完整即不具备候选资格） */
export function scoreValuation(m: UniverseMember): DimensionScore {
  if (m.peHistoryPercentile === undefined) {
    return { score: 0, complete: false, detail: 'PE历史分位缺失 → 评分不完整' }
  }
  const p = m.peHistoryPercentile
  const s = p <= 0.2 ? 5 : p <= 0.4 ? 4 : p <= 0.6 ? 3 : p <= 0.8 ? 1.5 : 0
  return { score: s, complete: true, detail: `PE历史分位${(p * 100).toFixed(0)}%` }
}

export function runRadar(m: UniverseMember, bars: DailyBar[], index: DailyBar[]): RadarResult {
  const capital = scoreCapital(bars)
  const relativeStrength = scoreRelativeStrength(bars, index)
  const trend = scoreTrend(bars)
  const evidence = scoreEvidence(m)
  const valuation = scoreValuation(m)
  const n = bars.length - 1
  const ma20 = sma(bars, 20), ma60 = sma(bars, 60), ma120 = sma(bars, 120)
  const close = bars[n]?.close ?? 0
  const r10 = ret(bars, 10), r20 = ret(bars, 20), r60 = ret(bars, 60)
  const i10 = ret(index, 10), i20 = ret(index, 20), i60 = ret(index, 60)
  return {
    code: m.code,
    name: m.name,
    tier: m.tier,
    node: m.node,
    capital, relativeStrength, trend, evidence, valuation,
    total: capital.score + relativeStrength.score + trend.score + evidence.score + valuation.score,
    complete: capital.complete && relativeStrength.complete && trend.complete && evidence.complete && valuation.complete,
    metrics: {
      close,
      ma20, ma60, ma120,
      distMa20: ma20 === null ? null : close / ma20 - 1,
      distMa60: ma60 === null ? null : close / ma60 - 1,
      distMa120: ma120 === null ? null : close / ma120 - 1,
      amt20Over60: amountRatio(bars, 20, 60),
      upDownVolumeRatio: upDownVolumeRatio(bars),
      pullbackDepths: pullbackDepths(bars).slice(-3),
      ret10: r10, ret20: r20, ret60: r60,
      excess10: r10 !== null && i10 !== null ? r10 - i10 : null,
      excess20: r20 !== null && i20 !== null ? r20 - i20 : null,
      excess60: r60 !== null && i60 !== null ? r60 - i60 : null,
    },
  }
}
