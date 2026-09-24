/**
 * 资金驾驶舱（R-01）· 累计提醒
 *
 * 每天的小变动看不出来，所以系统替人记账：把资金变化按 5 / 10 / 20 / 60 日累计，
 * 和每个对象自己的历史比；累计到"数量级"就单独拿出来，一句话说清：
 * 哪只、机会还是风险、到了什么程度、持续了几天。
 *
 * 纪律：
 *   · 提醒只决定"先复核谁"，不是买卖指令；每条都标证据等级。
 *   · 量级档位是显示门槛，不参与冻结的状态判定；登记日 2026-09-24，接入后不边看边调
 *     （ALERT_RULES_HASH 钉住取值，改动会被自检拦下）。
 *   · 生命周期由回放得出：每次把最近 120 个交易日逐日重算，所以"第 N 天"从条件真正成立那天算起。
 */

import { createHash } from 'node:crypto'
import { checkCoreSwitch, checkMigration } from './signals'
import { STATE_TEXT, type MoneyState } from './stateMachine'
import type { EvalObject } from './backtest'
import type { DataSet, EntryNo } from './types'
import type { Num } from './metrics'

// ─────────────────────────── 登记 ───────────────────────────

export const ALERT_RULES = {
  registeredOn: '2026-09-24',
  /** 关注 / 警示 / 重大：20 日日均超额在自身历史分位的低端与高端 */
  pctWatch: [0.15, 0.85],
  pctWarn: [0.07, 0.93],
  pctMajor: [0.02, 0.98],
  /** 同侧连续天数门槛（高于或低于常态） */
  runDays: 10,
  /** 市场新方向：日均超额排在行业前 N */
  newDirectionTopN: 10,
  /** 临时观察池：最后一次提醒后连续这么多个交易日没有新提醒即移出 */
  tempPoolExpireDays: 20,
  /** 首页最多展开的卡片数 */
  maxExpanded: 8,
  /** 生命周期回放的交易日数 */
  replayDays: 120,
  /** 自身历史分位至少需要多少个交易日的样本 */
  minHistoryForPct: 120,
  /** 数据源连续失败多少个交易日出"数据异常"卡片 */
  anomalyAfterFailures: 2,
} as const

export function alertRulesHash(r: Record<string, unknown> = ALERT_RULES): string {
  const keys = Object.keys(r).sort()
  return createHash('sha256').update(JSON.stringify(keys.map(k => [k, r[k]]))).digest('hex').slice(0, 12)
}

/** 登记时钉住的取值指纹。改 ALERT_RULES 的任何取值，自检会报错 */
export const ALERT_RULES_HASH = '9333dfac2090'

export type AlertType =
  | 'OPP_TREND' | 'OPP_ACCUM' | 'OPP_NEW_DIRECTION' | 'OPP_CORE_SWITCH'
  | 'RISK_OUTFLOW' | 'RISK_LEVERAGE' | 'RISK_FADING' | 'RISK_RETREAT' | 'RISK_DIVERGENCE' | 'RISK_MIGRATION'
  | 'NOTE_EXHAUST' | 'DATA_ANOMALY'

export const TYPE_LABEL: Record<AlertType, string> = {
  OPP_TREND: '资金趋势', OPP_ACCUM: '资金积累', OPP_NEW_DIRECTION: '市场新方向', OPP_CORE_SWITCH: '核心股切换',
  RISK_OUTFLOW: '资金流失', RISK_LEVERAGE: '杠杆推涨', RISK_FADING: '积累减弱', RISK_RETREAT: '资金撤离',
  RISK_DIVERGENCE: '高位背离', RISK_MIGRATION: '主线迁移', NOTE_EXHAUST: '放量滞涨', DATA_ANOMALY: '数据异常',
}

export type AlertCategory = 'RISK' | 'OPP' | 'NOTE' | 'DATA'
export type AlertLevel = 1 | 2 | 3

export const LEVEL_TEXT: Record<AlertLevel, string> = { 1: '关注', 2: '警示', 3: '重大' }
export const CATEGORY_TEXT: Record<AlertCategory, string> = { RISK: '风险', OPP: '机会', NOTE: '注意', DATA: '数据' }

export const ALERT_TYPE: Record<AlertType, { category: AlertCategory; evidence: string; order: number }> = {
  DATA_ANOMALY: { category: 'DATA', evidence: '数据源', order: 0 },
  RISK_DIVERGENCE: { category: 'RISK', evidence: '样本不足（样本外仅 7 次）', order: 1 },
  RISK_RETREAT: { category: 'RISK', evidence: '无显著效果（样本外）', order: 2 },
  RISK_LEVERAGE: { category: 'RISK', evidence: '观察', order: 3 },
  RISK_OUTFLOW: { category: 'RISK', evidence: '观察', order: 4 },
  RISK_MIGRATION: { category: 'RISK', evidence: '观察', order: 5 },
  RISK_FADING: { category: 'RISK', evidence: '观察', order: 6 },
  OPP_TREND: { category: 'OPP', evidence: '已验证（样本外 20 日 +1.7%、60 日 +4.7%）', order: 7 },
  OPP_NEW_DIRECTION: { category: 'OPP', evidence: '趋势部分已验证', order: 8 },
  OPP_ACCUM: { category: 'OPP', evidence: '观察', order: 9 },
  OPP_CORE_SWITCH: { category: 'OPP', evidence: '观察', order: 10 },
  NOTE_EXHAUST: { category: 'NOTE', evidence: '样本外 60 日多为跑赢（与"见顶"相反），只提示', order: 11 },
}

// ─────────────────────────── 逐对象累计序列 ───────────────────────────

export interface AlertSeries {
  /** 20 日日均超额（亿元/日） */
  e20: Num[]
  /** e20 在自身历史（截至当日）中的分位；样本不足为 null */
  pct: Num[]
  /** 同侧连续天数（正 = 高于常态，负 = 低于常态） */
  run: number[]
}

function sortedInsert(xs: number[], v: number): void {
  let lo = 0
  let hi = xs.length
  while (lo < hi) { const m = (lo + hi) >> 1; if (xs[m]! < v) lo = m + 1; else hi = m }
  xs.splice(lo, 0, v)
}

function rankOf(xs: readonly number[], v: number): number {
  let lo = 0
  let hi = xs.length
  while (lo < hi) { const m = (lo + hi) >> 1; if (xs[m]! <= v) lo = m + 1; else hi = m }
  return lo
}

export function alertSeries(o: EvalObject): AlertSeries {
  const n = o.dailyExcess.length
  const e20: Num[] = []
  const pct: Num[] = []
  const run: number[] = []
  const sorted: number[] = []
  for (let t = 0; t < n; t++) {
    let v: Num = null
    if (t >= 19) {
      let s = 0
      let ok = true
      for (let i = t - 19; i <= t; i++) {
        const x = o.dailyExcess[i]
        if (x === null || x === undefined) { ok = false; break }
        s += x
      }
      if (ok) v = s / 20 / 1e8
    }
    e20.push(v)
    if (v !== null) {
      sortedInsert(sorted, v)
      pct.push(sorted.length >= ALERT_RULES.minHistoryForPct ? (rankOf(sorted, v) - 1) / Math.max(1, sorted.length - 1) : null)
    } else pct.push(null)
    const prev = run[t - 1] ?? 0
    run.push(v === null || v === 0 ? 0 : v > 0 ? (prev > 0 ? prev + 1 : 1) : (prev < 0 ? prev - 1 : -1))
  }
  return { e20, pct, run }
}

/** k 日累计超额成交额（亿元）；窗口内有缺失返回 null */
export function cumExcess(o: EvalObject, t: number, k: number): Num {
  if (t - k + 1 < 0) return null
  let s = 0
  for (let i = t - k + 1; i <= t; i++) {
    const x = o.dailyExcess[i]
    if (x === null || x === undefined) return null
    s += x
  }
  return s / 1e8
}

// ─────────────────────────── 逐日判定 ───────────────────────────

export interface RawAlert {
  key: string
  objectId: string
  type: AlertType
  level: AlertLevel
  /** 迁移类提醒的对端 */
  peer?: string
  /** 核心股切换的新进股 */
  entrant?: string
}

export interface AlertContext {
  ds: DataSet
  objs: readonly EvalObject[]
  series: Map<string, AlertSeries>
}

const IN_STATES: MoneyState[] = ['TREND', 'BURST']

function levelHigh(p: number): AlertLevel | 0 {
  if (p >= ALERT_RULES.pctMajor[1]) return 3
  if (p >= ALERT_RULES.pctWarn[1]) return 2
  if (p >= ALERT_RULES.pctWatch[1]) return 1
  return 0
}

function levelLow(p: number): AlertLevel | 0 {
  if (p <= ALERT_RULES.pctMajor[0]) return 3
  if (p <= ALERT_RULES.pctWarn[0]) return 2
  if (p <= ALERT_RULES.pctWatch[0]) return 1
  return 0
}

/** 某一交易日的全部提醒（未含生命周期） */
export function alertsAt(ctx: AlertContext, t: number): RawAlert[] {
  const out: RawAlert[] = []
  const push = (objectId: string, type: AlertType, level: AlertLevel, extra: Partial<RawAlert> = {}) =>
    out.push({ key: `${objectId}|${type}${extra.peer ? `|${extra.peer}` : ''}${extra.entrant ? `|${extra.entrant}` : ''}`, objectId, type, level, ...extra })

  const industries = ctx.objs.filter(o => o.kind === 'INDUSTRY')
  const topNew = new Set(
    industries
      .filter(o => IN_STATES.includes(o.states[t]!) && (ctx.series.get(o.id)?.e20[t] ?? 0) > 0)
      .sort((a, b) => (ctx.series.get(b.id)!.e20[t] ?? 0) - (ctx.series.get(a.id)!.e20[t] ?? 0))
      .slice(0, ALERT_RULES.newDirectionTopN)
      .map(o => o.id),
  )

  for (const o of ctx.objs) {
    const s = ctx.series.get(o.id)
    if (!s) continue
    const state = o.states[t]
    if (!state || state === 'NO_BASELINE') continue
    const m = o.metrics[t]!
    const e = s.e20[t] ?? null
    const p = s.pct[t] ?? null
    const run = s.run[t] ?? 0
    const margin = m.marginDelta10

    if (o.entry === 3) {
      // 市场池只对达到"警示"的出提醒：资金排进前 N，且处于自身历史 93% 分位以上
      if (topNew.has(o.id) && p !== null && p >= ALERT_RULES.pctWarn[1]) {
        push(o.id, 'OPP_NEW_DIRECTION', p >= ALERT_RULES.pctMajor[1] && (margin ?? 0) > 0 ? 3 : 2)
      }
      continue
    }

    if (o.divergence[t]) push(o.id, 'RISK_DIVERGENCE', 3)
    if (state === 'RETREAT') push(o.id, 'RISK_RETREAT', 2)
    if (state === 'EXHAUST') push(o.id, 'NOTE_EXHAUST', 1)
    if (IN_STATES.includes(state)) {
      push(o.id, 'OPP_TREND', p !== null && p >= ALERT_RULES.pctMajor[1] && (margin ?? 0) > 0 ? 3 : 2)
    }
    if (e === null || p === null) continue

    if (e > 0 && run >= ALERT_RULES.runDays) {
      const lv = levelHigh(p)
      if (lv) push(o.id, 'OPP_ACCUM', lv === 3 && !((margin ?? 0) > 0) ? 2 : lv)
    }
    if (e < 0 && -run >= ALERT_RULES.runDays) {
      const lv = levelLow(p)
      push(o.id, 'RISK_OUTFLOW', lv === 0 ? 1 : lv === 3 && !((margin ?? 0) < 0) ? 2 : lv)
    }
    if (e > 0) {
      const e20ago = s.e20[t - 20] ?? null
      if (levelLow(p) && e20ago !== null && e < e20ago) push(o.id, 'RISK_FADING', 1)
    }
    const lowLv = levelLow(p)
    if (lowLv && (m.ret20 ?? 0) > 0 && (margin ?? 0) > 0) push(o.id, 'RISK_LEVERAGE', lowLv >= 2 ? 2 : 1)
  }

  // 主线迁移：持仓 / 观察仓篮子出、日均超额前 N 的行业进
  const baskets = ctx.objs.filter(o => o.kind === 'BASKET')
  const targets = industries.filter(o => topNew.has(o.id))
  for (const a of baskets) {
    for (const b of targets) {
      const r = checkMigration({ states: a.states, metrics: a.metrics }, { states: b.states, metrics: b.metrics }, t)
      if (r.verdict === 'MIGRATION') push(a.id, 'RISK_MIGRATION', r.confirmation === 'CONFIRMED' ? 3 : 1, { peer: b.id })
    }
  }

  // 核心股切换：篮子与进入市场新方向的行业
  for (const o of [...baskets, ...targets]) {
    if (t < 40) continue
    const members: Record<string, Num[]> = {}
    for (const c of o.codes) members[c] = ctx.ds.stocks[c]?.map(d => d.amount) ?? []
    const cs = checkCoreSwitch(members, t)
    for (const code of cs.entrants) push(o.id, 'OPP_CORE_SWITCH', 1, { entrant: code })
  }
  return out
}

// ─────────────────────────── 生命周期 ───────────────────────────

export type AlertEvent = 'NEW' | 'UP' | 'DOWN' | 'CONTINUE' | 'RESOLVED'

export interface AlertLife extends RawAlert {
  firstDate: string
  days: number
  event: AlertEvent
  history: { date: string; event: AlertEvent; level: AlertLevel }[]
}

export interface Lifecycle {
  active: AlertLife[]
  /** 回放窗口内所有生命周期事件（不含 CONTINUE） */
  events: { date: string; key: string; objectId: string; type: AlertType; event: AlertEvent; level: AlertLevel }[]
  resolvedToday: { key: string; objectId: string; type: AlertType; level: AlertLevel; firstDate: string }[]
  /** 临时观察池：市场新方向行业，最后一次提醒后 20 日内保留 */
  tempPool: { objectId: string; joined: string; lastAlert: string; expires: string }[]
}

export function replayLifecycle(ctx: AlertContext): Lifecycle {
  const n = ctx.ds.dates.length
  const start = Math.max(0, n - ALERT_RULES.replayDays)
  const live = new Map<string, AlertLife>()
  const events: Lifecycle['events'] = []
  let resolvedToday: Lifecycle['resolvedToday'] = []
  const poolLast = new Map<string, { joined: number; last: number }>()

  for (let t = start; t < n; t++) {
    const date = ctx.ds.dates[t]!
    const now = new Map(alertsAt(ctx, t).map(a => [a.key, a]))
    resolvedToday = []
    for (const [key, life] of live) {
      if (!now.has(key)) {
        events.push({ date, key, objectId: life.objectId, type: life.type, event: 'RESOLVED', level: life.level })
        if (t === n - 1) resolvedToday.push({ key, objectId: life.objectId, type: life.type, level: life.level, firstDate: life.firstDate })
        live.delete(key)
      }
    }
    for (const [key, a] of now) {
      const prev = live.get(key)
      if (!prev) {
        const life: AlertLife = { ...a, firstDate: date, days: 1, event: 'NEW', history: [{ date, event: 'NEW', level: a.level }] }
        live.set(key, life)
        events.push({ date, key, objectId: a.objectId, type: a.type, event: 'NEW', level: a.level })
      } else {
        const ev: AlertEvent = a.level > prev.level ? 'UP' : a.level < prev.level ? 'DOWN' : 'CONTINUE'
        prev.days++
        prev.event = ev
        if (ev !== 'CONTINUE') {
          prev.history.push({ date, event: ev, level: a.level })
          events.push({ date, key, objectId: a.objectId, type: a.type, event: ev, level: a.level })
        }
        prev.level = a.level
      }
      if (a.type === 'OPP_NEW_DIRECTION') {
        const p = poolLast.get(a.objectId)
        poolLast.set(a.objectId, { joined: p && t - p.last <= ALERT_RULES.tempPoolExpireDays ? p.joined : t, last: t })
      }
    }
  }
  // 回放起点之前就已成立的提醒，"第 N 天"会被低估：把起点那天就存在的标记出来
  for (const life of live.values()) if (life.firstDate === ctx.ds.dates[start]) life.firstDate = `≤${life.firstDate}`

  const tempPool = [...poolLast.entries()]
    .filter(([, v]) => n - 1 - v.last < ALERT_RULES.tempPoolExpireDays)
    .map(([objectId, v]) => ({
      objectId,
      joined: ctx.ds.dates[v.joined]!,
      lastAlert: ctx.ds.dates[v.last]!,
      expires: ctx.ds.dates[Math.min(n - 1, v.last + ALERT_RULES.tempPoolExpireDays)] ?? '',
    }))
  return { active: [...live.values()], events, resolvedToday, tempPool }
}

// ─────────────────────────── 卡片 ───────────────────────────

export interface WindowRow { k: number; cumYi: Num; pct: Num; priceChg: Num; marginChgYi: Num }

export interface AlertCard {
  objectId: string
  name: string
  entry: EntryNo | null
  kind: EvalObject['kind']
  category: AlertCategory
  level: AlertLevel
  type: AlertType
  title: string
  detail: string
  evidence: string
  days: number
  firstDate: string
  event: AlertEvent
  /** 同一对象上的其他提醒 */
  tags: { type: AlertType; level: AlertLevel; text: string }[]
  history: AlertLife['history']
  windows: WindowRow[]
  series: { dates: string[]; e20: Num[]; close: Num[]; marginYi: Num[]; p15: Num; p85: Num }
  column: 'LEFT' | 'RIGHT'
  expanded: boolean
}

const pctS = (v: Num, d = 1) => (v === null ? '—' : `${v > 0 ? '+' : ''}${(v * 100).toFixed(d)}%`)
const yiS = (v: Num, d = 1) => (v === null ? '—' : `${Math.abs(v).toFixed(d)} 亿`)

function titleOf(a: RawAlert, o: EvalObject, s: AlertSeries, t: number, names: Map<string, string>): string {
  const p = s.pct[t] ?? null
  const run = s.run[t] ?? 0
  const pp = p === null ? '' : `${Math.round(p * 100)}%`
  switch (a.type) {
    case 'OPP_TREND': return `资金趋势成立（${STATE_TEXT[o.states[t]!]}）`
    case 'OPP_ACCUM': return `资金积累到自身历史 ${pp} 分位`
    case 'OPP_NEW_DIRECTION': return `市场新方向：资金进入${STATE_TEXT[o.states[t]!]}`
    case 'OPP_CORE_SWITCH': return `${names.get(a.entrant ?? '') ?? a.entrant} 进入份额前二`
    case 'RISK_OUTFLOW': return p !== null && p <= 0.005 ? '资金降到自身有记录以来最低' : `资金连续 ${-run} 日低于常态`
    case 'RISK_LEVERAGE': return '资金在减、价格在涨、融资在加'
    case 'RISK_FADING': return `资金仍高于常态，但积累降到自身历史 ${pp} 分位`
    case 'RISK_RETREAT': return '资金撤离：跌破常态且融资或 ETF 流出'
    case 'RISK_DIVERGENCE': return '高位背离：四项全满足'
    case 'RISK_MIGRATION': return `疑似主线迁移 → ${names.get(a.peer ?? '') ?? a.peer}`
    case 'NOTE_EXHAUST': return '放量滞涨（历史上多为整理）'
    case 'DATA_ANOMALY': return '数据异常'
  }
}

function detailOf(o: EvalObject, s: AlertSeries, t: number): string {
  const m = o.metrics[t]!
  const e = s.e20[t] ?? null
  const run = s.run[t] ?? 0
  const p = s.pct[t] ?? null
  const lvl = m.amount20 === null ? null : m.amount20 / 1e8
  const base = m.baseLevel20 === null ? null : m.baseLevel20 / 1e8
  const parts = [
    e === null ? '日均资金数据不足' : `日均比常态${e >= 0 ? '多' : '少'} ${yiS(e)}（常态 ${base === null ? '—' : base.toFixed(1)} 亿/日，现在 ${lvl === null ? '—' : lvl.toFixed(1)} 亿/日）`,
    run === 0 ? '' : `已连续 ${Math.abs(run)} 日${run > 0 ? '高于' : '低于'}常态`,
    p === null ? '' : `处于自身历史 ${Math.round(p * 100)}% 分位`,
    `价格 20 日 ${pctS(m.ret20)}`,
    m.marginDelta10 === null ? '融资 10 日 —' : `融资 10 日 ${m.marginDelta10 >= 0 ? '+' : '−'}${yiS(m.marginDelta10 / 1e8)}`,
  ].filter(Boolean)
  return parts.join('；')
}

function windowsOf(o: EvalObject, t: number): WindowRow[] {
  return [5, 10, 20, 60].map(k => {
    const cum = cumExcess(o, t, k)
    let pct: Num = null
    if (cum !== null) {
      const hist: number[] = []
      for (let i = k - 1; i <= t; i++) { const v = cumExcess(o, i, k); if (v !== null) hist.push(v) }
      if (hist.length >= ALERT_RULES.minHistoryForPct) pct = hist.filter(v => v <= cum).length / hist.length
    }
    const c0 = o.close[t - k] ?? null
    const c1 = o.close[t] ?? null
    const mg0 = o.metrics[t - k]?.margin ?? o.metrics[t - k - 1]?.margin ?? null
    const mg1 = o.metrics[t]?.margin ?? o.metrics[t - 1]?.margin ?? null
    return {
      k, cumYi: cum, pct,
      priceChg: c0 !== null && c1 !== null && c0 > 0 ? c1 / c0 - 1 : null,
      marginChgYi: mg0 !== null && mg1 !== null ? (mg1 - mg0) / 1e8 : null,
    }
  })
}

function quantileOf(xs: Num[], q: number): Num {
  const v = xs.filter((x): x is number => x !== null).sort((a, b) => a - b)
  if (!v.length) return null
  return v[Math.min(v.length - 1, Math.floor(q * (v.length - 1)))]!
}

export interface AlertsView {
  asOf: string
  rules: typeof ALERT_RULES
  cards: AlertCard[]
  resolvedToday: { objectId: string; name: string; type: AlertType; text: string; firstDate: string }[]
  tempPool: { objectId: string; name: string; joined: string; lastAlert: string; expires: string; leaders: string[] }[]
  digest: {
    days5: { newCount: number; upCount: number; resolvedCount: number; items: string[] }
    days20: { newCount: number; upCount: number; resolvedCount: number }
  }
  anomalies: { kind: string; failures: number; text: string }[]
}

export function buildAlerts(
  ctx: AlertContext, names: Map<string, string>, anomalies: AlertsView['anomalies'] = [],
): { view: AlertsView; life: Lifecycle } {
  const t = ctx.ds.dates.length - 1
  const life = replayLifecycle(ctx)
  const byId = new Map(ctx.objs.map(o => [o.id, o]))
  const grouped = new Map<string, AlertLife[]>()
  for (const a of life.active) grouped.set(a.objectId, [...(grouped.get(a.objectId) ?? []), a])

  const cards: AlertCard[] = []
  for (const [objectId, list] of grouped) {
    const o = byId.get(objectId)
    const s = ctx.series.get(objectId)
    if (!o || !s) continue
    list.sort((a, b) => b.level - a.level || ALERT_TYPE[a.type].order - ALERT_TYPE[b.type].order)
    const main = list[0]!
    const from = Math.max(0, t - 119)
    cards.push({
      objectId, name: names.get(objectId) ?? o.name, entry: o.entry, kind: o.kind,
      category: ALERT_TYPE[main.type].category,
      level: main.level, type: main.type,
      title: titleOf(main, o, s, t, names),
      detail: detailOf(o, s, t),
      evidence: ALERT_TYPE[main.type].evidence,
      days: main.days, firstDate: main.firstDate, event: main.event,
      tags: list.slice(1).map(a => ({ type: a.type, level: a.level, text: `${CATEGORY_TEXT[ALERT_TYPE[a.type].category]}·${TYPE_LABEL[a.type]}·${LEVEL_TEXT[a.level]}` })),
      history: main.history,
      windows: windowsOf(o, t),
      series: {
        dates: ctx.ds.dates.slice(from),
        e20: s.e20.slice(from).map(v => (v === null ? null : Math.round(v * 100) / 100)),
        close: o.close.slice(from),
        marginYi: o.metrics.slice(from).map(m => (m.margin === null ? null : Math.round(m.margin / 1e6) / 100)),
        p15: quantileOf(s.e20, ALERT_RULES.pctWatch[0]),
        p85: quantileOf(s.e20, ALERT_RULES.pctWatch[1]),
      },
      column: o.entry === 1 ? 'LEFT' : 'RIGHT',
      expanded: false,
    })
  }

  // 排序：左列 风险 > 机会 > 注意；右列 机会 > 风险 > 注意；同类按量级、新近
  const catRank = (c: AlertCard) => {
    const order = c.column === 'LEFT' ? ['RISK', 'OPP', 'NOTE'] : ['OPP', 'RISK', 'NOTE']
    return order.indexOf(c.category)
  }
  const evRank: Record<AlertEvent, number> = { NEW: 0, UP: 0, DOWN: 1, CONTINUE: 1, RESOLVED: 2 }
  cards.sort((a, b) => (a.column === b.column ? 0 : a.column === 'LEFT' ? -1 : 1)
    || catRank(a) - catRank(b) || b.level - a.level || evRank[a.event] - evRank[b.event]
    || (a.entry ?? 9) - (b.entry ?? 9) || a.days - b.days)

  // 首页最多展开 8 张：持仓风险优先，其余按排序依次填满
  const prio = (c: AlertCard) => (c.column === 'LEFT' && c.category === 'RISK' ? 0 : c.column === 'LEFT' && c.category === 'OPP' ? 1 : c.entry === 2 ? 2 : 3)
  const byPrio = [...cards].filter(c => c.category !== 'NOTE').sort((a, b) => prio(a) - prio(b) || b.level - a.level)
  for (const c of byPrio.slice(0, ALERT_RULES.maxExpanded)) c.expanded = true

  const d5 = new Set(ctx.ds.dates.slice(-5))
  const d20 = new Set(ctx.ds.dates.slice(-20))
  const ev5 = life.events.filter(e => d5.has(e.date))
  const ev20 = life.events.filter(e => d20.has(e.date))
  const fmt = (e: Lifecycle['events'][number]) =>
    `${e.date} ${names.get(e.objectId) ?? byId.get(e.objectId)?.name ?? e.objectId} ${CATEGORY_TEXT[ALERT_TYPE[e.type].category]}·${TYPE_LABEL[e.type]}·${LEVEL_TEXT[e.level]} ${({ NEW: '新增', UP: '升级', DOWN: '降级', CONTINUE: '持续', RESOLVED: '解除' } as const)[e.event]}`

  const leadersOf = (o: EvalObject): string[] => {
    const rows = o.codes.map(c => {
      let s = 0
      for (let i = t - 19; i <= t; i++) s += ctx.ds.stocks[c]?.[i]?.amount ?? 0
      return { c, s }
    }).sort((a, b) => b.s - a.s).slice(0, 3)
    return rows.map(r => names.get(r.c) ?? r.c)
  }

  const view: AlertsView = {
    asOf: ctx.ds.dates[t]!,
    rules: ALERT_RULES,
    cards,
    resolvedToday: life.resolvedToday.map(r => ({
      objectId: r.objectId, name: names.get(r.objectId) ?? byId.get(r.objectId)?.name ?? r.objectId, type: r.type,
      text: `${CATEGORY_TEXT[ALERT_TYPE[r.type].category]}·${TYPE_LABEL[r.type]}（${LEVEL_TEXT[r.level]}，自 ${r.firstDate}）解除`, firstDate: r.firstDate,
    })),
    tempPool: life.tempPool.map(p => {
      const o = byId.get(p.objectId)
      return { ...p, name: o?.name ?? p.objectId, leaders: o ? leadersOf(o) : [] }
    }),
    digest: {
      days5: {
        newCount: ev5.filter(e => e.event === 'NEW').length,
        upCount: ev5.filter(e => e.event === 'UP').length,
        resolvedCount: ev5.filter(e => e.event === 'RESOLVED').length,
        items: ev5.filter(e => e.event !== 'DOWN').filter(e => byId.get(e.objectId)?.entry !== 3 || e.level >= 2).map(fmt).slice(-30),
      },
      days20: {
        newCount: ev20.filter(e => e.event === 'NEW').length,
        upCount: ev20.filter(e => e.event === 'UP').length,
        resolvedCount: ev20.filter(e => e.event === 'RESOLVED').length,
      },
    },
    anomalies,
  }
  return { view, life }
}

export function buildAlertContext(ds: DataSet, objs: readonly EvalObject[]): AlertContext {
  return { ds, objs, series: new Map(objs.map(o => [o.id, alertSeries(o)])) }
}

/** 一行文字版，供 Agent 文件、通知与 Obsidian 使用 */
export function cardLine(c: AlertCard): string {
  const ev = ({ NEW: '新增', UP: '升级', DOWN: '降级', CONTINUE: '持续', RESOLVED: '解除' } as const)[c.event]
  return `[${CATEGORY_TEXT[c.category]}·${LEVEL_TEXT[c.level]}] ${c.name}：${c.title}。${c.detail}。第 ${c.days} 天（${ev}）｜证据：${c.evidence}`
}
