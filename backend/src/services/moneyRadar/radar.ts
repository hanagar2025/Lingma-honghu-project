/**
 * 资金驾驶舱（R-01）· 装配层
 *
 * 把三个入口的对象、指标、状态、背离、迁移和国家队温度计装成一份视图，
 * 供 CLI / 网页渲染。视图的最高输出是"复核顺序"：按类别排，不打分。
 * 视图里没有买卖动作，也没有能被下游当作法定理由的字段。
 */

import type { EvidenceTier } from '../cockpit/types'
import { findMember } from '../msr/universe'
import {
  THRESHOLDS, WATCHLIST, NATIONAL_TEAM_ETFS, NATIONAL_TEAM_VERIFIED, INDUSTRY_TAXONOMY,
  basketObjects, basketOf, holdingCodes, stockObject,
} from './config'
import { computeMetrics, rawSeries, rollingMean, quantile, type DayMetrics, type Num } from './metrics'
import { PROVIDER_CANDIDATES, ROUTING, anyRealProviderWired } from './providers'
import {
  checkDivergence, classifyNationalTeam, nationalTeamFlow, checkMigration,
  type DivergenceVerdict, type MigrationVerdict,
} from './signals'
import { runStateMachine, STATE_TEXT, type MoneyState, type Pending } from './stateMachine'
import { ENTRY_TEXT, type DataSet, type EntryNo, type MoneyObject } from './types'

const TIER: EvidenceTier = 'OBSERVATION'

export const MONEY_COCKPIT_ID = 'R-01'
export const MONEY_COCKPIT_TITLE = '鸿鹄·资金驾驶舱'

export function moneyGrantsPermission(): false { return false }
export function moneyProducesAction(): false { return false }
export function usesEstimatedMoneyFlow(): false { return false }
export function nationalTeamIsMainline(): false { return false }
export function divergenceIsSellOrder(): false { return false }

/** 复核顺序的类别。按固定顺序排，不打分 */
export type ReviewClass =
  | 'DIVERGENCE'
  | 'RETREAT'
  | 'EXHAUST'
  | 'DIVERGENCE_PENDING_A2'
  | 'NEW_TRANSITION'
  | 'WATCH'

export const REVIEW_ORDER: readonly ReviewClass[] = [
  'DIVERGENCE', 'RETREAT', 'EXHAUST', 'DIVERGENCE_PENDING_A2', 'NEW_TRANSITION', 'WATCH',
]

export const REVIEW_TEXT: Record<ReviewClass, string> = {
  DIVERGENCE: '高位背离（四项全满足）',
  RETREAT: '资金撤离',
  EXHAUST: '资金衰竭（放量滞涨）',
  DIVERGENCE_PENDING_A2: '背离待 A2 确认',
  NEW_TRANSITION: '近 5 日发生状态跃迁',
  WATCH: '常规观察',
}

export type Standing = '作战主线在册' | '研究主线在册' | '在册但C级清退' | '不在册'

export function standingOf(code: string): Standing {
  const hit = findMember(code)
  if (!hit) return '不在册'
  if (hit.member.retiredC) return '在册但C级清退'
  return hit.mainline.id === 'power' ? '研究主线在册' : '作战主线在册'
}

/** 图表用序列：最近 CHART_DAYS 个交易日。份额以 % 表示 */
export interface ChartSeries {
  dates: string[]
  s5: Num[]
  s20: Num[]
  median: Num[]
  q25: Num[]
  q75: Num[]
  close: Num[]
  margin: Num[]
  /** 20 日日均成交额（亿元/日） */
  level20Yi: Num[]
  /** 水位对应的日均成交额（亿元/日） */
  base20Yi: Num[]
}

export interface LeaderRow {
  code: string
  name: string
  standing: Standing
  /** 20 日成交额占所属对象的比例 */
  share20: number
  /** 与 20 个交易日前相比的变化（百分点） */
  change20: number | null
}

export interface ObjectView {
  id: string
  name: string
  kind: MoneyObject['kind']
  entry: EntryNo
  standing: Standing | null
  basket: string | null
  dataStatus: 'OK' | 'NOT_WIRED' | 'INSUFFICIENT'
  state: MoneyState | null
  stateText: string
  stateSince: string | null
  pending: Pending
  persist: number | null
  maxPersistBefore: number | null
  /** 当前资金量：20 日日均成交额，亿元/日 */
  level20Yi: number | null
  /** 原有资金量：水位对应的日均成交额，亿元/日 */
  base20Yi: number | null
  /** 近 20 日日均超额成交额（相对水位），亿元/日。正 = 资金在积累 */
  excessDailyYi: number | null
  dev5: number | null
  dev20: number | null
  ret20: number | null
  a2: { marginDelta10Yi: number | null; etfNet10Yi: number | null; instNet10Yi: number | null }
  divergence: DivergenceVerdict | null
  divergenceDetail: string[]
  /** 背离四项逐项结果；第 3 项 null = 方向性数据缺失 */
  divergenceChecks: { poolHigh: boolean; shareFading: boolean; directionalOutflow: boolean | null; priceHolding: boolean } | null
  reviewClass: ReviewClass
  leaders: LeaderRow[]
  risers: LeaderRow[]
  series: ChartSeries | null
}

export interface EntryView {
  entry: EntryNo
  title: string
  objects: ObjectView[]
  note: string
}

const CHART_DAYS = 250
const yiOf = (v: number | null) => (v === null ? null : v / 1e8)
const r4 = (v: Num) => (v === null ? null : Math.round(v * 1e6) / 1e6)

function dev(x: number | null, base: number | null): number | null {
  return x === null || base === null || base <= 0 ? null : x / base - 1
}

function excess20(ms: readonly DayMetrics[], raw: { share: Num[] }, mkt: readonly Num[], t: number): number | null {
  const med = ms[t]?.median ?? null
  if (med === null || t < 19) return null
  let s = 0
  for (let i = t - 19; i <= t; i++) {
    const sh = raw.share[i] ?? null
    const m = mkt[i] ?? null
    if (sh === null || m === null) return null
    s += (sh - med) * m
  }
  return s
}

function leadersOf(obj: MoneyObject, ds: DataSet, t: number, names: Record<string, string>): { leaders: LeaderRow[]; risers: LeaderRow[] } {
  if (obj.kind === 'STOCK' || t < 40) return { leaders: [], risers: [] }
  const sum20 = (code: string, at: number): number | null => {
    const xs = ds.stocks[code]
    if (!xs) return null
    let s = 0
    for (let i = at - 19; i <= at; i++) {
      const v = xs[i]?.amount
      if (v === null || v === undefined) return null
      s += v
    }
    return s
  }
  const rows = obj.codes.map(code => ({ code, now: sum20(code, t), before: sum20(code, t - 20) }))
  const totNow = rows.reduce((a, r) => a + (r.now ?? 0), 0)
  const totBefore = rows.reduce((a, r) => a + (r.before ?? 0), 0)
  if (totNow <= 0) return { leaders: [], risers: [] }
  const out: LeaderRow[] = rows.filter(r => r.now !== null).map(r => ({
    code: r.code,
    name: names[r.code] ?? r.code,
    standing: standingOf(r.code),
    share20: r.now! / totNow,
    change20: r.before !== null && totBefore > 0 ? r.now! / totNow - r.before / totBefore : null,
  }))
  const leaders = [...out].sort((a, b) => b.share20 - a.share20).slice(0, 3)
  const risers = [...out].filter(r => r.change20 !== null && r.change20 > 0)
    .sort((a, b) => b.change20! - a.change20!).slice(0, 3)
  return { leaders, risers }
}

function chartOf(ms: readonly DayMetrics[], ds: DataSet): ChartSeries {
  const from = Math.max(0, ds.dates.length - CHART_DAYS)
  const pick = <K extends keyof DayMetrics>(k: K) => ms.slice(from).map(m => m[k] as Num)
  return {
    dates: ds.dates.slice(from),
    s5: pick('s5').map(r4), s20: pick('s20').map(r4),
    median: pick('median').map(r4), q25: pick('q25').map(r4), q75: pick('q75').map(r4),
    close: pick('close').map(v => (v === null ? null : Math.round(v * 100) / 100)),
    margin: pick('margin').map(v => (v === null ? null : Math.round(v / 1e6) / 100)),
    level20Yi: pick('amount20').map(v => (v === null ? null : Math.round(v / 1e6) / 100)),
    base20Yi: pick('baseLevel20').map(v => (v === null ? null : Math.round(v / 1e6) / 100)),
  }
}

interface Built { view: ObjectView; states: MoneyState[]; metrics: DayMetrics[] }

function viewOf(
  obj: MoneyObject & { entry: EntryNo }, ds: DataSet | null, names: Record<string, string>, withSeries: boolean,
): Built {
  const standing = obj.kind === 'STOCK' ? standingOf(obj.codes[0]!) : null
  const basket = obj.kind === 'STOCK' ? basketOf(obj.codes[0]!) : null
  const empty: ObjectView = {
    id: obj.id, name: obj.name, kind: obj.kind, entry: obj.entry, standing, basket,
    dataStatus: 'NOT_WIRED', state: null, stateText: '数据源未接入', stateSince: null, pending: null,
    persist: null, maxPersistBefore: null, level20Yi: null, base20Yi: null, excessDailyYi: null,
    dev5: null, dev20: null, ret20: null,
    a2: { marginDelta10Yi: null, etfNet10Yi: null, instNet10Yi: null },
    divergence: null, divergenceDetail: [], divergenceChecks: null, reviewClass: 'WATCH', leaders: [], risers: [], series: null,
  }
  if (!ds || !ds.dates.length) return { view: empty, states: [], metrics: [] }

  const mkt = ds.market.map(d => d.totalAmount)
  const raw = rawSeries(obj, ds)
  const metrics = computeMetrics(raw, mkt)
  const { days, transitions } = runStateMachine(metrics)
  const t = ds.dates.length - 1
  const m = metrics[t]!
  const d = days[t]!
  const states = days.map(x => x.state)
  if (d.state === 'NO_BASELINE') {
    return {
      view: { ...empty, dataStatus: 'INSUFFICIENT', state: 'NO_BASELINE', stateText: STATE_TEXT.NO_BASELINE },
      states, metrics,
    }
  }
  const div = checkDivergence(metrics, t)
  const recent = transitions.some(tr => tr.t > t - 5)
  const reviewClass: ReviewClass =
    div.verdict === 'DIVERGENCE' ? 'DIVERGENCE'
      : d.state === 'RETREAT' ? 'RETREAT'
        : d.state === 'EXHAUST' ? 'EXHAUST'
          : div.verdict === 'DIVERGENCE_PENDING_A2' ? 'DIVERGENCE_PENDING_A2'
            : recent ? 'NEW_TRANSITION' : 'WATCH'
  const { leaders, risers } = leadersOf(obj, ds, t, names)

  return {
    view: {
      ...empty,
      dataStatus: 'OK',
      state: d.state,
      stateText: STATE_TEXT[d.state] + (d.pending ? '（待 A2 确认）' : ''),
      stateSince: ds.dates[d.since] ?? null,
      pending: d.pending,
      persist: m.persist,
      maxPersistBefore: m.maxPersistBefore,
      level20Yi: yiOf(m.amount20),
      base20Yi: yiOf(m.baseLevel20),
      excessDailyYi: (() => { const x = excess20(metrics, raw, mkt, t); return x === null ? null : x / 20 / 1e8 })(),
      dev5: dev(m.s5, m.median),
      dev20: dev(m.s20, m.median),
      ret20: m.ret20,
      a2: { marginDelta10Yi: yiOf(m.marginDelta10), etfNet10Yi: yiOf(m.etfNet10), instNet10Yi: yiOf(m.instNet10) },
      divergence: div.verdict,
      divergenceDetail: div.detail,
      divergenceChecks: {
        poolHigh: div.c1PoolHigh, shareFading: div.c2ShareFading,
        directionalOutflow: div.c3DirectionalOutflow, priceHolding: div.c4PriceHolding,
      },
      reviewClass,
      leaders,
      risers,
      series: withSeries ? chartOf(metrics, ds) : null,
    },
    states,
    metrics,
  }
}

type EntryObj = MoneyObject & { entry: EntryNo }

/** 三个入口的对象清单。入口③ 由调用方传入（申万二级行业），未接入时为空 */
export function entryObjects(industries: readonly EntryObj[] = []): Record<EntryNo, EntryObj[]> {
  const holdings = holdingCodes()
  const baskets = basketObjects()
  const heldBaskets = new Set(holdings.map(h => basketOf(h.code)).filter((x): x is string => x !== null))
  const watchBaskets = new Set(WATCHLIST.map(w => basketOf(w.code)).filter((x): x is string => x !== null))

  const e1: EntryObj[] = [
    ...holdings.map(h => stockObject(h.code, h.name, 1) as EntryObj),
    ...baskets.filter(b => heldBaskets.has(b.id)).map(b => ({ ...b, entry: 1 as const })),
  ]
  const e2: EntryObj[] = [
    ...WATCHLIST.map(w => stockObject(w.code, w.name, 2) as EntryObj),
    ...baskets.filter(b => watchBaskets.has(b.id) && !heldBaskets.has(b.id)).map(b => ({ ...b, entry: 2 as const })),
  ]
  return { 1: e1, 2: e2, 3: [...industries] }
}

export interface EntryShareSeries {
  dates: string[]
  /** 各入口 20 日成交额份额（%） */
  lines: { entry: EntryNo; label: string; s20: Num[]; baseline: Num }[]
  entry3Members: string[]
}

export interface MarketPanel {
  dates: string[]
  /** 两市成交额 5 日均值，亿元 */
  amount5Yi: Num[]
  baselineYi: Num
  deviation: Num
  daysAbove: number
  latestYi: Num
  marginYi: Num[]
  marginDelta20Yi: Num
}

export interface NationalTeamPanel {
  etfs: typeof NATIONAL_TEAM_ETFS
  verified: boolean
  /** 有份额历史的 ETF 只数（沪市）；深市只有当日值，从接入之日逐日积累 */
  withHistory: number
  dates: string[]
  flowYi: Num[]
  net10Yi: Num
  lastDay: string | null
  role: string
}

export interface MoneyCockpitView {
  id: typeof MONEY_COCKPIT_ID
  title: typeof MONEY_COCKPIT_TITLE
  tier: EvidenceTier
  generatedAt: string
  asOf: string | null
  dataMode: 'NOT_WIRED' | 'FIXTURE' | 'LIVE'
  entries: EntryView[]
  reviewQueue: { id: string; name: string; entry: EntryNo; reviewClass: ReviewClass; text: string }[]
  migrations: { from: string; to: string; verdict: MigrationVerdict; confirmation: string; days: number }[]
  entryShares: EntryShareSeries | null
  market: MarketPanel | null
  nationalTeam: NationalTeamPanel
  provenance: DataSet['provenance']
  providers: typeof PROVIDER_CANDIDATES
  routing: typeof ROUTING
  thresholds: typeof THRESHOLDS
  taxonomy: typeof INDUSTRY_TAXONOMY
  dataNotes: string[]
  doesNotImply: readonly string[]
  flags: Record<string, boolean>
}

export const R01_DOES_NOT_IMPLY = [
  '不意味着资金驾驶舱可以直接产生买卖动作',
  '不意味着 C 级估算数据（主力净流入）可以进入判定',
  '不意味着"爆发"是买点，也不意味着"背离"已经是卖出令',
  '不意味着国家队资金是一条主线',
  '不意味着不在册股票可以因为资金集中而进入候选',
  '不意味着 Capital Permission 会因为资金信号而打开',
  '不改 V4.x，不改决策规则。本层不发令',
] as const

const IN_STATES: MoneyState[] = ['START', 'TREND', 'BURST']

function unionShare(codes: readonly string[], ds: DataSet): Num[] {
  const amount = ds.dates.map((_, t) => {
    let s = 0
    for (const c of codes) {
      const v = ds.stocks[c]?.[t]?.amount
      if (v !== null && v !== undefined) s += v
    }
    return s
  })
  const share = amount.map((a, t) => {
    const tot = ds.market[t]?.totalAmount ?? null
    return tot ? (a / tot) * 100 : null
  })
  return rollingMean(share, 20)
}

export interface BuildExtras {
  names?: Record<string, string>
  industries?: EntryObj[]
  dataNotes?: string[]
}

/**
 * @param ds 数据集。null = 数据源未接入，视图只给出骨架与登记信息
 * @param mode 自检与示意用 FIXTURE；真实数据为 LIVE
 */
export function buildMoneyCockpitView(ds: DataSet | null, mode: 'FIXTURE' | 'LIVE' = 'LIVE', extras: BuildExtras = {}): MoneyCockpitView {
  const names = extras.names ?? {}
  const objs = entryObjects(extras.industries ?? [])
  const built: Record<string, Built> = {}
  const entries: EntryView[] = ([1, 2, 3] as EntryNo[]).map(e => {
    const views = objs[e].map(o => {
      const b = viewOf(o, ds, names, e !== 3)
      built[o.id] = b
      return b.view
    })
    if (e === 3) {
      // 入口③ 回答"市场正在把钱投向哪里"，按日均超额资金排；衰竭、撤离等提醒另进复核顺序
      views.sort((a, b) => (b.excessDailyYi ?? -Infinity) - (a.excessDailyYi ?? -Infinity))
      // 入口③ 只给最值得看的一批补图表序列，控制快照体积
      const focus = views.filter(v => v.state && (IN_STATES.includes(v.state) || v.reviewClass !== 'WATCH')).slice(0, 16)
      for (const v of focus) {
        const b = built[v.id]
        if (b && ds) v.series = chartOf(b.metrics, ds)
      }
    }
    return {
      entry: e,
      title: ENTRY_TEXT[e],
      objects: views,
      note: e === 3
        ? `行业骨架：${INDUSTRY_TAXONOMY.standard} 二级（官方 ${INDUSTRY_TAXONOMY.expectedCount} 个，可得 ${views.length} 个）。按超额资金排序，只排序不打分`
        : e === 2 ? '观察仓 7 只（委员会 2026-09-23 确认）+ 所在主线篮子' : '持仓 8 只（读自账本）+ 所在主线篮子',
    }
  })

  const all = entries.flatMap(e => e.objects)
  // 入口① ② 是我们的仓位与观察仓，全部进复核队列；入口③ 只收背离与撤离，且最多 5 个 ——
  // 市场上一百多个行业每天总有若干在跃迁，全放进来会淹没真正要看的持仓
  const e3Serious = all.filter(v => v.entry === 3 && (v.reviewClass === 'DIVERGENCE' || v.reviewClass === 'RETREAT')).slice(0, 5)
  const reviewQueue = [...all.filter(v => v.entry !== 3 && v.reviewClass !== 'WATCH'), ...e3Serious]
    .sort((a, b) => REVIEW_ORDER.indexOf(a.reviewClass) - REVIEW_ORDER.indexOf(b.reviewClass) || a.entry - b.entry)
    .map(v => ({ id: v.id, name: v.name, entry: v.entry, reviewClass: v.reviewClass, text: REVIEW_TEXT[v.reviewClass] }))

  const migrations: MoneyCockpitView['migrations'] = []
  let entryShares: EntryShareSeries | null = null
  let market: MarketPanel | null = null
  let net10Yi: Num = null
  let lastDay: string | null = null
  let flowYi: Num[] = []
  let ntDates: string[] = []
  let withHistory = 0

  if (ds && ds.dates.length) {
    const t = ds.dates.length - 1

    // 主线迁移：从持仓 / 观察仓篮子出发；目标只认处于趋势或爆发、且日均超额资金排在前 10 的篮子或行业。
    // 进入"启动"的方向每天都有一批，全算作迁移目标会把"一出一进"稀释成噪音
    const sources = [...entries[0]!.objects, ...entries[1]!.objects].filter(v => v.kind === 'BASKET')
    const targets = all
      .filter(v => v.kind !== 'STOCK' && (v.state === 'TREND' || v.state === 'BURST') && (v.excessDailyYi ?? 0) > 0)
      .sort((a, b) => (b.excessDailyYi ?? 0) - (a.excessDailyYi ?? 0))
      .slice(0, 10)
    for (const a of sources) {
      const found: (MoneyCockpitView['migrations'][number] & { strength: number })[] = []
      for (const b of targets) {
        if (a.id === b.id) continue
        const A = built[a.id]
        const B = built[b.id]
        if (!A?.states.length || !B?.states.length) continue
        const r = checkMigration({ states: A.states, metrics: A.metrics }, { states: B.states, metrics: B.metrics }, t)
        if (r.verdict === 'MIGRATION') found.push({ from: a.name, to: b.name, ...r, strength: b.excessDailyYi ?? 0 })
      }
      found.sort((x, y) => y.strength - x.strength)
      for (const f of found.slice(0, 3)) {
        const { strength: _s, ...rest } = f
        migrations.push(rest)
      }
    }

    // 三入口份额迁移图：① 8 只持仓，② 7 只观察股，③ 市场资金流入最强的 5 个行业（去掉与 ①② 重复的股票）。
    // 三块互不重叠；主线篮子只在表格里作背景，不进这张图，否则观察股会因为和持仓同属一个篮子被去重掉
    const from = Math.max(0, ds.dates.length - CHART_DAYS)
    const codes1 = objs[1].filter(o => o.kind === 'STOCK').flatMap(o => o.codes)
    const set1 = new Set(codes1)
    const codes2 = objs[2].filter(o => o.kind === 'STOCK').flatMap(o => o.codes).filter(c => !set1.has(c))
    const set2 = new Set(codes2)
    const hot = entries[2]!.objects
      .filter(v => v.state && IN_STATES.includes(v.state) && (v.excessDailyYi ?? 0) > 0)
      .slice(0, 5)
    const hotNames = hot.map(v => v.name)
    const codes3 = [...new Set(hot.flatMap(v => objs[3].find(o => o.id === v.id)?.codes ?? []))]
      .filter(c => !set1.has(c) && !set2.has(c))
    const line = (entry: EntryNo, label: string, codes: string[]) => {
      const s20 = unionShare(codes, ds)
      const base = quantile(s20.slice(-THRESHOLDS.baselineWindow), 0.5)
      return { entry, label, s20: s20.slice(from).map(r4), baseline: r4(base) }
    }
    entryShares = {
      dates: ds.dates.slice(from),
      lines: [
        line(1, '入口① 持仓主线', codes1),
        line(2, '入口② 观察仓主线', codes2),
        line(3, '入口③ 市场自选方向', codes3),
      ],
      entry3Members: hotNames,
    }

    // 市场总水位与杠杆资金
    const amt = ds.market.map(d => d.totalAmount)
    const a5 = rollingMean(amt, 5)
    const baseline = quantile(a5.slice(-THRESHOLDS.baselineWindow), 0.5)
    let daysAbove = 0
    for (let i = t; i >= 0; i--) {
      const v = a5[i]
      if (v === null || v === undefined || baseline === null || v < baseline) break
      daysAbove++
    }
    const mg = ds.market.map(d => d.marginTotal)
    const mNow = mg[t] ?? mg[t - 1] ?? null
    const mBefore = mg[t - 20] ?? mg[t - 21] ?? null
    market = {
      dates: ds.dates.slice(from),
      amount5Yi: a5.slice(from).map(v => (v === null ? null : Math.round(v / 1e6) / 100)),
      baselineYi: baseline === null ? null : Math.round(baseline / 1e6) / 100,
      deviation: dev(a5[t] ?? null, baseline),
      daysAbove,
      latestYi: amt[t] === null || amt[t] === undefined ? null : Math.round(amt[t]! / 1e6) / 100,
      marginYi: mg.slice(from).map(v => (v === null ? null : Math.round(v / 1e6) / 100)),
      marginDelta20Yi: mNow !== null && mBefore !== null ? (mNow - mBefore) / 1e8 : null,
    }

    // 国家队温度计：只用有份额历史的 ETF，缺数据的不拿来凑
    const withShares = NATIONAL_TEAM_ETFS.map(e => e.code)
      .filter(c => (ds.etfs[c] ?? []).filter(x => x.share !== null).length >= THRESHOLDS.baselineMinWindow)
    withHistory = withShares.length
    if (withShares.length) {
      const flow = nationalTeamFlow(ds, withShares)
      const cls = classifyNationalTeam(flow)
      // ETF 份额 T+1 发布：取截至最近已发布日的 10 个交易日
      let end = flow.length - 1
      while (end >= 0 && flow[end] === null && end > flow.length - 4) end--
      const last10 = flow.slice(Math.max(0, end - 9), end + 1)
      net10Yi = last10.length === 10 && last10.every(v => v !== null)
        ? (last10 as number[]).reduce((a, b) => a + b, 0) / 1e8 : null
      lastDay = [...cls].reverse().find(x => x !== null) ?? null
      ntDates = ds.dates.slice(-60)
      flowYi = flow.slice(-60).map(v => (v === null ? null : Math.round(v / 1e6) / 100))
    }
  }

  return {
    id: MONEY_COCKPIT_ID,
    title: MONEY_COCKPIT_TITLE,
    tier: TIER,
    generatedAt: new Date().toISOString(),
    asOf: ds?.dates.at(-1) ?? null,
    dataMode: ds ? mode : 'NOT_WIRED',
    entries,
    reviewQueue,
    migrations,
    entryShares,
    market,
    nationalTeam: {
      etfs: NATIONAL_TEAM_ETFS,
      verified: NATIONAL_TEAM_VERIFIED,
      withHistory,
      dates: ntDates,
      flowYi,
      net10Yi,
      lastDay,
      role: '背景层温度计：大跌日大额申购读作托底，上涨中持续赎回读作降温。不进入主线份额比较',
    },
    provenance: ds?.provenance ?? [],
    providers: PROVIDER_CANDIDATES,
    routing: ROUTING,
    thresholds: THRESHOLDS,
    taxonomy: INDUSTRY_TAXONOMY,
    dataNotes: extras.dataNotes ?? [],
    doesNotImply: R01_DOES_NOT_IMPLY,
    flags: {
      moneyGrantsPermission: moneyGrantsPermission(),
      moneyProducesAction: moneyProducesAction(),
      usesEstimatedMoneyFlow: usesEstimatedMoneyFlow(),
      nationalTeamIsMainline: nationalTeamIsMainline(),
      divergenceIsSellOrder: divergenceIsSellOrder(),
      realProviderWired: mode === 'LIVE' && !!ds ? true : anyRealProviderWired(),
      thresholdsFrozen: THRESHOLDS.status === 'FROZEN',
    },
  }
}

const pct = (v: number | null) => {
  if (v === null) return '—'
  const s = (v * 100).toFixed(1)
  return s === '-0.0' || s === '0.0' ? '0.0%' : `${v > 0 ? '+' : ''}${s}%`
}
const yi = (v: number | null) => (v === null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(1)} 亿`)

export function renderMoneyCockpit(v: MoneyCockpitView, entry3Limit = 15): string {
  const W = 122
  const L: string[] = ['', '═'.repeat(W), `${v.id}｜${v.title}`, '═'.repeat(W)]
  L.push('  本区不打分、不产生动作。证据等级恒为 OBSERVATION。最高输出是复核顺序。')
  L.push(`  数据模式：${v.dataMode === 'NOT_WIRED' ? '数据源未接入（框架阶段）' : v.dataMode === 'FIXTURE' ? '合成数据（示意，非真实行情）' : '真实数据'}`
    + `　截至：${v.asOf ?? '—'}　阈值：${v.thresholds.status}（登记于 ${v.thresholds.registeredOn}）`)
  if (v.market) {
    L.push(`  两市成交额 ${v.market.latestYi?.toFixed(0) ?? '—'} 亿，5 日均值偏离 250 日水位 ${pct(v.market.deviation)}，`
      + `连续高于水位 ${v.market.daysAbove} 日；两融 20 日变化 ${yi(v.market.marginDelta20Yi)}`)
  }
  L.push('')

  L.push('  ── 复核顺序（按类别，不打分）──')
  if (!v.reviewQueue.length) L.push(v.dataMode === 'NOT_WIRED' ? '  数据源未接入，无复核项。' : '  无需优先复核的对象。')
  v.reviewQueue.slice(0, 20).forEach((r, i) => L.push(`  ${i + 1}. [${ENTRY_TEXT[r.entry]}] ${r.name}　${r.text}`))
  L.push('')

  for (const e of v.entries) {
    const rows = e.entry === 3 ? e.objects.slice(0, entry3Limit) : e.objects
    L.push(`  ── ${e.title}（${e.objects.length}）── ${e.note}`)
    for (const o of rows) {
      const stand = o.standing ? `　${o.standing}` : ''
      const lvl = o.level20Yi === null ? '—' : `${o.level20Yi.toFixed(1)}`
      const bl = o.base20Yi === null ? '—' : `${o.base20Yi.toFixed(1)}`
      L.push(`  ${o.name.padEnd(12)}${o.stateText.padEnd(12)}日均资金 ${lvl}/水位 ${bl} 亿`.padEnd(46)
        + `日均超额 ${yi(o.excessDailyYi).padEnd(11)}持续 ${o.persist ?? '—'}/${o.maxPersistBefore ?? '—'}　`
        + `5日偏离 ${pct(o.dev5)}　20日涨幅 ${pct(o.ret20)}${stand}`)
      if (o.divergence && o.divergence !== 'NONE') {
        L.push(`      背离判定：${o.divergence}　${o.divergenceDetail.join('；')}`)
      }
      if (o.leaders.length && e.entry === 3) {
        L.push(`      份额前三：${o.leaders.map(l => `${l.name}${(l.share20 * 100).toFixed(0)}%`).join(' · ')}`)
      }
    }
    if (rows.length < e.objects.length) L.push(`  …… 其余 ${e.objects.length - rows.length} 个见网页驾驶舱`)
    L.push('')
  }

  L.push('  ── 主线迁移（一出一进持续 N 日）──')
  if (!v.migrations.length) L.push('  无。')
  for (const m of v.migrations) L.push(`  ${m.from} → ${m.to}　${m.verdict}　${m.confirmation}　持续 ${m.days} 日`)
  L.push('')

  L.push('  ── 国家队温度计（背景层）──')
  L.push(`  观察 ${v.nationalTeam.etfs.length} 只宽基 ETF，其中 ${v.nationalTeam.withHistory} 只有份额历史`
    + `　名单已核对季报：${v.nationalTeam.verified ? '是' : '否'}`)
  L.push(`  近 10 日净申赎：${yi(v.nationalTeam.net10Yi)}　最近一日：${v.nationalTeam.lastDay ?? '—'}`)
  L.push(`  ${v.nationalTeam.role}`)
  L.push('')

  if (v.dataNotes.length) {
    L.push('  ── 数据说明 ──')
    for (const x of v.dataNotes) L.push(`  · ${x}`)
    L.push('')
  }

  L.push('  本区不意味着：')
  for (const x of v.doesNotImply) L.push(`    · ${x}`)
  L.push('')
  return L.join('\n')
}
