/**
 * 资金驾驶舱（R-01）· 信号层：高位背离、主线迁移、核心股切换、国家队温度计
 *
 * 这里的每一个输出都是"观察"，最高只能把一个对象排到复核队列第一位。
 * 没有任何函数返回动作，也没有任何函数 import 动作构造器。
 */

import { THRESHOLDS as T } from './config'
import { etfFlowOf, lastKDays, quantile, sumEtfFlows, type DayMetrics, type Num } from './metrics'
import type { MoneyState } from './stateMachine'
import type { DataSet } from './types'

// ─────────────────────────── 高位背离 ───────────────────────────

export type DivergenceVerdict =
  /** 四项全满足 */
  | 'DIVERGENCE'
  /** 1、2、4 满足，方向性数据缺失 —— 待 T+1 A2 补齐 */
  | 'DIVERGENCE_PENDING_A2'
  /** 1、2、4 满足，但方向性数据显示没有流出 —— 可能是锁仓，不升为背离 */
  | 'LOW_VOLUME_RISE'
  | 'NONE'

export interface DivergenceCheck {
  c1PoolHigh: boolean
  c2ShareFading: boolean
  /** 方向性确认。null = 融资、ETF、机构三项数据都缺 */
  c3DirectionalOutflow: boolean | null
  c4PriceHolding: boolean
  verdict: DivergenceVerdict
  detail: string[]
}

export function checkDivergence(ms: readonly DayMetrics[], t: number): DivergenceCheck {
  const m = ms[t]!
  const detail: string[] = []

  const poolHigh = m.pool > 0 && m.poolQ90 !== null && m.pool >= m.poolQ90
  // 历史上必须出现过一段真正的堆积（至少达到趋势的持续门槛），"创纪录"才有意义；
  // 平稳期份额在水位上下抖动，最长也就连续两三天，拿它当纪录会让任何一段行情都"创纪录"。
  const persistHigh = m.maxPersistBefore >= T.trendPersistDays
    && m.persist >= T.divergencePersistRatio * m.maxPersistBefore
  const c1 = poolHigh || persistHigh
  if (poolHigh) detail.push('本段堆积的累计超额成交处于自身历史 90% 分位以上')
  if (persistHigh) detail.push(`堆积 ${m.persist} 日，达到自身历史最长 ${m.maxPersistBefore} 日的 90% 以上`)

  const c2 = lastKDays(ms, t, T.divergenceShareDays, x =>
    x.s5 === null || x.s20 === null ? null : x.s5 < x.s20)
  if (c2) detail.push(`5 日份额连续 ${T.divergenceShareDays} 日低于 20 日份额`)

  // 融资余额 T+1 发布：从最近 2 个交易日内已发布的那一天往回数
  let end = t
  while (end > t - 3 && end >= 0 && (ms[end]?.margin ?? null) === null) end--
  let marginKnown = end > t - 3 && end >= T.divergenceMarginDays
  let marginFalling = marginKnown
  for (let i = end - T.divergenceMarginDays + 1; marginKnown && i <= end; i++) {
    const cur = ms[i]?.margin ?? null
    const prev = ms[i - 1]?.margin ?? null
    if (cur === null || prev === null) { marginKnown = false; marginFalling = false }
    else if (!(cur < prev)) marginFalling = false
  }
  const etfOut = m.etfNet10 === null ? null : m.etfNet10 < 0
  const instOut = m.instNet10 === null ? null : m.instNet10 < 0
  const known = [marginKnown ? marginFalling : null, etfOut, instOut].filter((v): v is boolean => v !== null)
  const c3 = known.length ? known.some(Boolean) : null
  if (marginKnown && marginFalling) detail.push(`融资余额连续 ${T.divergenceMarginDays} 日下降`)
  if (etfOut) detail.push('相关 ETF 10 日净赎回')
  if (instOut) detail.push('龙虎榜机构 10 日净卖出')

  const c4 = m.ret20 !== null && m.ret20 > 0 && m.close !== null && m.high60 !== null
    && m.close >= (1 - T.divergenceNearHigh) * m.high60
  if (c4) detail.push('价格仍在上涨，距 60 日高点不足 3%')

  let verdict: DivergenceVerdict = 'NONE'
  if (c1 && c2 && c4) {
    verdict = c3 === true ? 'DIVERGENCE' : c3 === null ? 'DIVERGENCE_PENDING_A2' : 'LOW_VOLUME_RISE'
  }
  return { c1PoolHigh: c1, c2ShareFading: c2, c3DirectionalOutflow: c3, c4PriceHolding: c4, verdict, detail }
}

// ─────────────────────────── 主线迁移 ───────────────────────────

export type MigrationVerdict = 'MIGRATION' | 'EBB' | 'DIFFUSION' | 'NONE'

const OUT_STATES: MoneyState[] = ['EXHAUST', 'RETREAT']
const IN_STATES: MoneyState[] = ['START', 'TREND', 'BURST']

/**
 * 迁移的证据等级（只看 A2 方向性数据：融资余额 10 日变化 + 主题 ETF 10 日净申赎，两者相加取净方向）：
 *   CONFIRMED  出端净流出、进端净流入 —— 份额迁移得到两头方向性数据支持
 *   CONFLICT   任一端的净方向与迁移相反（出端在加杠杆，或进端在减）—— 份额与方向数据打架
 *   INFERRED   任一端没有 A2 数据 —— 只有成交额份额此消彼长，属于推断
 * 迁移本身（verdict）只由份额与状态决定；这里只给证据等级，不改变是否判为迁移。
 */
export type MigrationConfirmation = 'CONFIRMED' | 'CONFLICT' | 'INFERRED'

export interface MigrationCheck {
  verdict: MigrationVerdict
  confirmation: MigrationConfirmation
  days: number
  /** 两端 A2 净方向（元）：融资 10 日变化 + ETF 10 日净申赎；null = 该端无 A2 数据 */
  fromA2: number | null
  toA2: number | null
}

/** 某日 A2 净方向（元）。融资与 ETF 都缺 → null */
export function a2Net(m: DayMetrics | undefined): number | null {
  if (!m) return null
  const xs = [m.marginDelta10, m.etfNet10].filter((v): v is number => v !== null)
  return xs.length ? xs.reduce((a, b) => a + b, 0) : null
}

export function migrationConfirmation(fromA2: number | null, toA2: number | null): MigrationConfirmation {
  if (fromA2 === null || toA2 === null) return 'INFERRED'
  if (fromA2 < 0 && toA2 > 0) return 'CONFIRMED'
  return 'CONFLICT'
}

/**
 * 从 from 到 to 的成交额份额迁移。一出一进同时成立、持续 N 日才叫迁移；
 * 只出不进叫退潮，只进不出叫扩散。成交额没有方向，所以"迁移"说的是份额结构，不是净资金流向。
 */
export function checkMigration(
  from: { states: readonly MoneyState[]; metrics: readonly DayMetrics[] },
  to: { states: readonly MoneyState[]; metrics: readonly DayMetrics[] },
  t: number,
): MigrationCheck {
  const run = (pred: (i: number) => boolean) => {
    let k = 0
    for (let i = t; i >= 0 && pred(i); i--) k++
    return k
  }
  const out = (i: number) => OUT_STATES.includes(from.states[i]!)
  const inn = (i: number) => IN_STATES.includes(to.states[i]!)
  const both = run(i => out(i) && inn(i))
  const fromA2 = a2Net(from.metrics[t])
  const toA2 = a2Net(to.metrics[t])
  const confirmation = migrationConfirmation(fromA2, toA2)
  const n = T.migrationPersistDays
  if (both >= n) return { verdict: 'MIGRATION', confirmation, days: both, fromA2, toA2 }
  const onlyOut = run(i => out(i) && !inn(i))
  if (onlyOut >= n) return { verdict: 'EBB', confirmation: 'INFERRED', days: onlyOut, fromA2, toA2 }
  const onlyIn = run(i => inn(i) && !out(i))
  if (onlyIn >= n) return { verdict: 'DIFFUSION', confirmation: 'INFERRED', days: onlyIn, fromA2, toA2 }
  return { verdict: 'NONE', confirmation: 'INFERRED', days: 0, fromA2, toA2 }
}

// ─────────────────────────── 核心股切换 ───────────────────────────

export interface CoreSwitchCheck {
  topNow: string[]
  topBefore: string[]
  /** 新进入前 N 名并已持续 N 日的股票 */
  entrants: string[]
  /** 前 N 名份额之和（龙头集中度） */
  concentrationNow: Num
  concentrationBefore: Num
}

/** memberAmounts：篮子内每只股票的日成交额；以 20 日均值计算篮子内份额 */
export function checkCoreSwitch(memberAmounts: Record<string, readonly Num[]>, t: number): CoreSwitchCheck {
  const n = T.coreSwitchTopN
  const p = T.coreSwitchPersistDays
  const avg20 = (xs: readonly Num[], at: number): Num => {
    if (at < 19) return null
    let s = 0
    for (let i = at - 19; i <= at; i++) { const v = xs[i]; if (v === null || v === undefined) return null; s += v }
    return s / 20
  }
  const rank = (at: number) => {
    const rows = Object.entries(memberAmounts)
      .map(([code, xs]) => ({ code, v: avg20(xs, at) }))
      .filter((r): r is { code: string; v: number } => r.v !== null)
    const total = rows.reduce((a, r) => a + r.v, 0)
    rows.sort((a, b) => b.v - a.v)
    const top = rows.slice(0, n)
    return { top: top.map(r => r.code), conc: total > 0 ? top.reduce((a, r) => a + r.v, 0) / total : null }
  }
  const now = rank(t)
  const before = rank(t - p)
  const entrants = now.top.filter(code => {
    if (before.top.includes(code)) return false
    for (let i = t - p + 1; i <= t; i++) if (!rank(i).top.includes(code)) return false
    return true
  })
  return { topNow: now.top, topBefore: before.top, entrants, concentrationNow: now.conc, concentrationBefore: before.conc }
}

// ─────────────────────────── 国家队温度计 ───────────────────────────

export type NationalTeamDay = 'RESCUE' | 'COOL' | 'NORMAL' | null

/**
 * 国家队 ETF 合计净申赎（元）= Σ（份额变化 × 收盘价）。
 * 某只 ETF 当日缺数据 → 当日合计为 null，不用其余几只凑数。
 */
export function nationalTeamFlow(ds: DataSet, codes: readonly string[]): Num[] {
  const series = codes.map(c => etfFlowOf(ds, c))
  // 名单里任一只在整段数据里都没有份额，温度计就不可判定（不是"那只没人申赎"）
  if (series.some(s => s.first < 0)) return ds.dates.map(() => null)
  return sumEtfFlows(series, ds.dates.length, t => t === 0).flow
}

/** 托底日 / 降温日：当日净申赎落在自身 250 日分布的尾部（只用当日之前的数据） */
export function classifyNationalTeam(flow: readonly Num[]): NationalTeamDay[] {
  return flow.map((v, t) => {
    if (v === null) return null
    const hist = flow.slice(Math.max(0, t - T.baselineWindow), t)
    if (hist.filter(x => x !== null).length < T.baselineMinWindow) return null
    const hi = quantile(hist, T.nationalTeamRescueQuantile)
    const lo = quantile(hist, T.nationalTeamCoolQuantile)
    if (hi !== null && v > hi) return 'RESCUE'
    if (lo !== null && v < lo) return 'COOL'
    return 'NORMAL'
  })
}
