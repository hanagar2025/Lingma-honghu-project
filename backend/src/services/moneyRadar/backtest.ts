/**
 * 资金驾驶舱（R-01）· 校准与样本外检验
 *
 *   npm run money:calibrate
 *
 * 纪律（方案 9.4）：预先登记 → 样本内校准一次 → 冻结 → 样本外检验 / 影子运行期间不再调整。
 *
 * 校准只检查"信号卫生"，不拿收益来调参：
 *   按"之后能不能赚钱"去挑阈值，等于把阈值拟合到过去 —— 这正是冻结纪律要防的事。
 *   所以样本内只问：状态会不会乱跳、会不会过度触发。卫生标准在跑数据之前写死在下面。
 *   预登记初值全部通过 → 原样确认；有不通过的 → 允许调整一次并留档。
 *
 * 样本外只做事件研究：每条规则触发后第 20 / 60 个交易日相对两市基准的超额收益，
 * 置信区间按"交易日"分组自助抽样 —— 同一天常有一批行业同时触发，逐事件独立抽样会让区间假性变窄。
 * 结果只作为证据登记，不自动升级任何规则。
 */

import { createHash } from 'node:crypto'
import { THRESHOLDS } from './config'
import { computeMetrics, rawSeries, type DayMetrics, type Num } from './metrics'
import { checkDivergence } from './signals'
import { runStateMachine, type MoneyState, type Transition } from './stateMachine'
import type { DataSet, EntryNo, MoneyObject } from './types'

// ─────────────────────────── 事先写死的标准 ───────────────────────────

/** 卫生标准（2026-09-23 登记，先于任何样本内数据运行） */
export const HYGIENE_CRITERIA = {
  registeredOn: '2026-09-23',
  /** H1 已结束状态段的停留天数中位数 ≥ 最短保持期的 2 倍 */
  minMedianStateDays: THRESHOLDS.minHoldDays * 2,
  /** H2 每个对象每 20 个交易日平均跃迁次数 ≤ 1 */
  maxTransitionsPer20: 1,
  /** H3 每日处于非潜伏状态的对象占比，中位数在此区间 */
  activeShareRange: [0.15, 0.6] as const,
  /** H4 每日处于衰竭状态的对象占比，中位数 ≤ 20% */
  maxExhaustShare: 0.2,
  /** H5 背离新触发率（对象 × 交易日）≤ 1% */
  maxDivergenceRate: 0.01,
  /** H6 启动后未站稳即失败的比例 ≤ 70% */
  maxFailedStartShare: 0.7,
} as const

export type RuleId = 'START' | 'TREND' | 'BURST' | 'EXHAUST' | 'RETREAT' | 'FAILED_START' | 'DIVERGENCE'

/** 每条规则事先声明的方向：+1 预期之后跑赢基准，-1 预期跑输 */
export const RULE_HYPOTHESIS: Record<RuleId, { sign: 1 | -1; text: string }> = {
  START: { sign: 1, text: '资金开始集中 → 之后跑赢' },
  TREND: { sign: 1, text: '资金趋势成立 → 之后跑赢' },
  BURST: { sign: -1, text: '资金爆发（拥挤）→ 之后跑输' },
  EXHAUST: { sign: -1, text: '放量滞涨 → 之后跑输' },
  RETREAT: { sign: -1, text: '资金撤离 → 之后跑输' },
  FAILED_START: { sign: -1, text: '启动失败 → 之后跑输' },
  DIVERGENCE: { sign: -1, text: '高位背离 → 之后跑输' },
}

export const HORIZONS = [20, 60] as const

// ─────────────────────────── 逐对象回放 ───────────────────────────

export interface EvalObject {
  id: string
  name: string
  kind: MoneyObject['kind']
  entry: EntryNo | null
  metrics: DayMetrics[]
  states: MoneyState[]
  transitions: Transition[]
  /** 每日背离是否成立（四项全满足） */
  divergence: boolean[]
  close: Num[]
}

export function replayObjects(ds: DataSet, objs: readonly MoneyObject[]): EvalObject[] {
  const mkt = ds.market.map(d => d.totalAmount)
  return objs.map(obj => {
    const raw = rawSeries(obj, ds)
    const metrics = computeMetrics(raw, mkt)
    const { days, transitions } = runStateMachine(metrics)
    return {
      id: obj.id, name: obj.name, kind: obj.kind, entry: obj.entry,
      metrics,
      states: days.map(d => d.state),
      transitions,
      divergence: metrics.map((_, t) => checkDivergence(metrics, t).verdict === 'DIVERGENCE'),
      close: raw.close,
    }
  })
}

// ─────────────────────────── 样本内卫生 ───────────────────────────

export interface HygieneCheck {
  id: string
  text: string
  value: number | null
  pass: boolean
}

function median(xs: number[]): number | null {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2
}

export function hygiene(objs: readonly EvalObject[], start: number, end: number): HygieneCheck[] {
  const C = HYGIENE_CRITERIA
  const days = end - start
  const durations: number[] = []
  let transitions = 0
  let starts = 0
  let failedStarts = 0
  let divOnsets = 0
  let objDays = 0

  for (const o of objs) {
    const inWin = o.transitions.filter(tr => tr.t >= start && tr.t < end && tr.from !== 'NO_BASELINE')
    transitions += inWin.length
    starts += inWin.filter(tr => tr.to === 'START').length
    failedStarts += inWin.filter(tr => tr.failed).length
    const all = o.transitions.filter(tr => tr.from !== 'NO_BASELINE')
    for (let i = 1; i < all.length; i++) {
      const a = all[i - 1]!
      const b = all[i]!
      if (a.t >= start && b.t < end) durations.push(b.t - a.t)
    }
    for (let t = start; t < end; t++) {
      if (o.states[t] === 'NO_BASELINE') continue
      objDays++
      if (o.divergence[t] && !o.divergence[t - 1]) divOnsets++
    }
  }

  const activeShare: number[] = []
  const exhaustShare: number[] = []
  for (let t = start; t < end; t++) {
    const live = objs.filter(o => o.states[t] !== 'NO_BASELINE')
    if (!live.length) continue
    activeShare.push(live.filter(o => o.states[t] !== 'LATENT').length / live.length)
    exhaustShare.push(live.filter(o => o.states[t] === 'EXHAUST').length / live.length)
  }

  const medDur = median(durations)
  const per20 = objs.length && days > 0 ? transitions / objs.length / (days / 20) : null
  const act = median(activeShare)
  const exh = median(exhaustShare)
  const divRate = objDays ? divOnsets / objDays : null
  const failShare = starts ? failedStarts / starts : null

  return [
    { id: 'H1', text: `已结束状态段停留天数中位数 ≥ ${C.minMedianStateDays}`, value: medDur, pass: medDur !== null && medDur >= C.minMedianStateDays },
    { id: 'H2', text: `每对象每 20 日跃迁次数 ≤ ${C.maxTransitionsPer20}`, value: per20, pass: per20 !== null && per20 <= C.maxTransitionsPer20 },
    { id: 'H3', text: `非潜伏对象占比中位数在 ${C.activeShareRange[0] * 100}%–${C.activeShareRange[1] * 100}%`, value: act, pass: act !== null && act >= C.activeShareRange[0] && act <= C.activeShareRange[1] },
    { id: 'H4', text: `衰竭对象占比中位数 ≤ ${C.maxExhaustShare * 100}%`, value: exh, pass: exh !== null && exh <= C.maxExhaustShare },
    { id: 'H5', text: `背离新触发率 ≤ ${C.maxDivergenceRate * 100}%`, value: divRate, pass: divRate !== null && divRate <= C.maxDivergenceRate },
    { id: 'H6', text: `启动失败比例 ≤ ${C.maxFailedStartShare * 100}%`, value: failShare, pass: failShare === null || failShare <= C.maxFailedStartShare },
  ]
}

// ─────────────────────────── 样本外事件研究 ───────────────────────────

export interface RuleEvent { rule: RuleId; objectId: string; kind: MoneyObject['kind']; t: number; date: string }

export function collectEvents(objs: readonly EvalObject[], ds: DataSet, start: number, end: number): RuleEvent[] {
  const out: RuleEvent[] = []
  for (const o of objs) {
    for (const tr of o.transitions) {
      if (tr.t < start || tr.t >= end || tr.from === 'NO_BASELINE') continue
      const rule: RuleId | null = tr.failed ? 'FAILED_START'
        : tr.to === 'START' || tr.to === 'TREND' || tr.to === 'BURST' || tr.to === 'EXHAUST' || tr.to === 'RETREAT' ? tr.to : null
      if (rule) out.push({ rule, objectId: o.id, kind: o.kind, t: tr.t, date: ds.dates[tr.t]! })
    }
    for (let t = Math.max(1, start); t < end; t++) {
      if (o.divergence[t] && !o.divergence[t - 1]) out.push({ rule: 'DIVERGENCE', objectId: o.id, kind: o.kind, t, date: ds.dates[t]! })
    }
  }
  return out
}

/** 事件触发后第 h 个交易日相对两市基准的超额收益；未到期或数据缺失返回 null */
export function excessReturn(close: readonly Num[], bench: readonly Num[], t: number, h: number): number | null {
  const a0 = close[t] ?? null
  const a1 = close[t + h] ?? null
  const b0 = bench[t] ?? null
  const b1 = bench[t + h] ?? null
  if (a0 === null || a1 === null || b0 === null || b1 === null || a0 <= 0 || b0 <= 0) return null
  return a1 / a0 - b1 / b0
}

/** 按交易日分组的自助抽样置信区间。确定性随机数，结果可复现 */
export function clusteredBootstrap(values: { date: string; v: number }[], iters = 2000, seed = 20260923): [number, number] | null {
  if (values.length < 2) return null
  const byDate = new Map<string, number[]>()
  for (const x of values) byDate.set(x.date, [...(byDate.get(x.date) ?? []), x.v])
  const groups = [...byDate.values()]
  let s = seed
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647 }
  const means: number[] = []
  for (let i = 0; i < iters; i++) {
    let sum = 0
    let n = 0
    for (let g = 0; g < groups.length; g++) {
      const pick = groups[Math.floor(rnd() * groups.length)]!
      for (const v of pick) { sum += v; n++ }
    }
    means.push(sum / n)
  }
  means.sort((a, b) => a - b)
  return [means[Math.floor(iters * 0.025)]!, means[Math.floor(iters * 0.975)]!]
}

export type RuleVerdict = 'INSUFFICIENT_SAMPLE' | 'SUPPORTS' | 'CONTRADICTS' | 'NO_EFFECT'

export const VERDICT_TEXT: Record<RuleVerdict, string> = {
  INSUFFICIENT_SAMPLE: '样本不足（少于 30 次独立触发）',
  SUPPORTS: '支持预期方向（置信区间不含 0）',
  CONTRADICTS: '与预期方向相反（置信区间不含 0）',
  NO_EFFECT: '无显著效果（置信区间含 0）',
}

export interface RuleResult {
  rule: RuleId
  hypothesis: string
  horizon: number
  n: number
  days: number
  mean: number | null
  hitRate: number | null
  ci: [number, number] | null
  verdict: RuleVerdict
}

export function eventStudy(events: readonly RuleEvent[], objs: readonly EvalObject[], ds: DataSet): RuleResult[] {
  const byId = new Map(objs.map(o => [o.id, o]))
  const bench = ds.market.map(d => d.close ?? null)
  const out: RuleResult[] = []
  for (const rule of Object.keys(RULE_HYPOTHESIS) as RuleId[]) {
    const hyp = RULE_HYPOTHESIS[rule]
    for (const h of HORIZONS) {
      const vals: { date: string; v: number }[] = []
      for (const e of events) {
        if (e.rule !== rule) continue
        const o = byId.get(e.objectId)
        if (!o) continue
        const v = excessReturn(o.close, bench, e.t, h)
        if (v !== null) vals.push({ date: e.date, v })
      }
      const n = vals.length
      const mean = n ? vals.reduce((a, b) => a + b.v, 0) / n : null
      const hitRate = n ? vals.filter(x => Math.sign(x.v) === hyp.sign).length / n : null
      const ci = n >= 2 ? clusteredBootstrap(vals) : null
      let verdict: RuleVerdict = 'NO_EFFECT'
      if (n < THRESHOLDS.minTriggersForVerdict) verdict = 'INSUFFICIENT_SAMPLE'
      else if (ci && (ci[0] > 0 || ci[1] < 0)) verdict = Math.sign(ci[0] > 0 ? 1 : -1) === hyp.sign ? 'SUPPORTS' : 'CONTRADICTS'
      out.push({
        rule, hypothesis: hyp.text, horizon: h, n,
        days: new Set(vals.map(x => x.date)).size, mean, hitRate, ci, verdict,
      })
    }
  }
  return out
}

// ─────────────────────────── 切分与阈值指纹 ───────────────────────────

export interface Split { inSample: [number, number]; outOfSample: [number, number] }

/**
 * 从水位满 250 日处开始，前一半作样本内、后一半作样本外。
 * 样本外的事件要留出 60 日观察期，所以样本外终点前 60 日之后的事件只算 20 日结果。
 */
export function splitWindow(n: number): Split {
  const start = Math.min(THRESHOLDS.baselineWindow + 20, n)
  const mid = start + Math.floor((n - start) / 2)
  return { inSample: [start, mid], outOfSample: [mid, n] }
}

/** 阈值指纹：不含状态字段本身，只看取值 */
export function thresholdsHash(t: Record<string, unknown> = THRESHOLDS): string {
  const { status: _s, ...values } = t as Record<string, unknown> & { status?: unknown }
  const keys = Object.keys(values).sort()
  return createHash('sha256').update(JSON.stringify(keys.map(k => [k, values[k]]))).digest('hex').slice(0, 12)
}
