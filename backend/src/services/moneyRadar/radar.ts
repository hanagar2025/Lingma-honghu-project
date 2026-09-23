/**
 * 资金驾驶舱（R-01）· 装配层
 *
 * 把三个入口的对象、指标、状态、背离、迁移和国家队温度计装成一份视图，
 * 供 CLI / 网页 / Obsidian 渲染。
 *
 * 视图的最高输出是"复核顺序"：按类别排，不打分。
 * 视图里没有买卖动作，也没有能被下游当作法定理由的字段。
 */

import type { EvidenceTier } from '../cockpit/types'
import { findMember } from '../msr/universe'
import {
  THRESHOLDS, WATCHLIST, NATIONAL_TEAM_ETFS, NATIONAL_TEAM_VERIFIED, INDUSTRY_TAXONOMY,
  UNIVERSE_CODE_DEFECTS, basketObjects, basketOf, holdingCodes, stockObject,
} from './config'
import { computeMetrics, rawSeries, type DayMetrics } from './metrics'
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

function standingOf(code: string): Standing {
  const registered = UNIVERSE_CODE_DEFECTS.find(d => d.correct === code)?.registered ?? code
  const hit = findMember(registered)
  if (!hit) return '不在册'
  if (hit.member.retiredC) return '在册但C级清退'
  return hit.mainline.id === 'power' ? '研究主线在册' : '作战主线在册'
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
  /** 资金池存量，亿元 */
  poolYi: number | null
  dev5: number | null
  dev20: number | null
  ret20: number | null
  divergence: DivergenceVerdict | null
  divergenceDetail: string[]
  reviewClass: ReviewClass
}

export interface EntryView {
  entry: EntryNo
  title: string
  objects: ObjectView[]
  note: string
}

function dev(x: number | null, base: number | null): number | null {
  return x === null || base === null || base <= 0 ? null : x / base - 1
}

function viewOf(obj: MoneyObject & { entry: EntryNo }, ds: DataSet | null): {
  view: ObjectView; states: MoneyState[]; metrics: DayMetrics[]
} {
  const standing = obj.kind === 'STOCK' ? standingOf(obj.codes[0]!) : null
  const basket = obj.kind === 'STOCK' ? basketOf(obj.codes[0]!) : null
  const empty: ObjectView = {
    id: obj.id, name: obj.name, kind: obj.kind, entry: obj.entry, standing, basket,
    dataStatus: 'NOT_WIRED', state: null, stateText: '数据源未接入', stateSince: null, pending: null,
    persist: null, maxPersistBefore: null, poolYi: null, dev5: null, dev20: null, ret20: null,
    divergence: null, divergenceDetail: [], reviewClass: 'WATCH',
  }
  if (!ds || !ds.dates.length) return { view: empty, states: [], metrics: [] }

  const metrics = computeMetrics(rawSeries(obj, ds), ds.market.map(d => d.totalAmount))
  const { days, transitions } = runStateMachine(metrics)
  const t = ds.dates.length - 1
  const m = metrics[t]!
  const d = days[t]!
  if (d.state === 'NO_BASELINE') {
    return { view: { ...empty, dataStatus: 'INSUFFICIENT', state: 'NO_BASELINE', stateText: STATE_TEXT.NO_BASELINE }, states: days.map(x => x.state), metrics }
  }
  const div = checkDivergence(metrics, t)
  const recent = transitions.some(tr => tr.t > t - 5)
  const reviewClass: ReviewClass =
    div.verdict === 'DIVERGENCE' ? 'DIVERGENCE'
      : d.state === 'RETREAT' ? 'RETREAT'
        : d.state === 'EXHAUST' ? 'EXHAUST'
          : div.verdict === 'DIVERGENCE_PENDING_A2' ? 'DIVERGENCE_PENDING_A2'
            : recent ? 'NEW_TRANSITION' : 'WATCH'

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
      poolYi: m.pool / 1e8,
      dev5: dev(m.s5, m.median),
      dev20: dev(m.s20, m.median),
      ret20: m.ret20,
      divergence: div.verdict,
      divergenceDetail: div.detail,
      reviewClass,
    },
    states: days.map(x => x.state),
    metrics,
  }
}

/** 三个入口的对象清单。入口③ 的行业成分来自数据源（申万二级），数据源未接入时为空 */
export function entryObjects(): Record<EntryNo, (MoneyObject & { entry: EntryNo })[]> {
  const holdings = holdingCodes()
  const baskets = basketObjects()
  const heldBaskets = new Set(holdings.map(h => basketOf(h.code)).filter((x): x is string => x !== null))
  const watchBaskets = new Set(WATCHLIST.map(w => basketOf(w.code)).filter((x): x is string => x !== null))

  const e1: (MoneyObject & { entry: EntryNo })[] = [
    ...holdings.map(h => stockObject(h.code, h.name, 1) as MoneyObject & { entry: EntryNo }),
    ...baskets.filter(b => heldBaskets.has(b.id)).map(b => ({ ...b, entry: 1 as const })),
  ]
  const e2: (MoneyObject & { entry: EntryNo })[] = [
    ...WATCHLIST.map(w => stockObject(w.code, w.name, 2) as MoneyObject & { entry: EntryNo }),
    ...baskets.filter(b => watchBaskets.has(b.id) && !heldBaskets.has(b.id)).map(b => ({ ...b, entry: 2 as const })),
  ]
  return { 1: e1, 2: e2, 3: [] }
}

export interface MoneyCockpitView {
  id: typeof MONEY_COCKPIT_ID
  title: typeof MONEY_COCKPIT_TITLE
  tier: EvidenceTier
  asOf: string | null
  dataMode: 'NOT_WIRED' | 'FIXTURE' | 'LIVE'
  entries: EntryView[]
  reviewQueue: { id: string; name: string; entry: EntryNo; reviewClass: ReviewClass; text: string }[]
  migrations: { from: string; to: string; verdict: MigrationVerdict; confirmation: string; days: number }[]
  nationalTeam: {
    etfs: typeof NATIONAL_TEAM_ETFS
    verified: boolean
    net10Yi: number | null
    lastDay: string | null
    role: string
  }
  providers: typeof PROVIDER_CANDIDATES
  routing: typeof ROUTING
  thresholds: typeof THRESHOLDS
  taxonomy: typeof INDUSTRY_TAXONOMY
  universeDefects: typeof UNIVERSE_CODE_DEFECTS
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
  '不改 V4.x，不改规则指纹。本层不发令',
] as const

/**
 * @param ds 数据集。null = 数据源未接入，视图只给出骨架与登记信息
 * @param mode 数据来源标记；自检与示意用 FIXTURE，真实数据接入后才是 LIVE
 */
export function buildMoneyCockpitView(ds: DataSet | null, mode: 'FIXTURE' | 'LIVE' = 'LIVE'): MoneyCockpitView {
  const objs = entryObjects()
  const built: Record<string, { view: ObjectView; states: MoneyState[]; metrics: DayMetrics[] }> = {}
  const entries: EntryView[] = ([1, 2, 3] as EntryNo[]).map(e => {
    const views = objs[e].map(o => {
      const b = viewOf(o, ds)
      built[o.id] = b
      return b.view
    })
    return {
      entry: e,
      title: ENTRY_TEXT[e],
      objects: views,
      note: e === 3
        ? `行业骨架：${INDUSTRY_TAXONOMY.standard} ${INDUSTRY_TAXONOMY.level}（${INDUSTRY_TAXONOMY.expectedCount} 个）。成分由 SW_INDUSTRY 数据源提供，未接入前为空`
        : e === 2 ? '观察仓起始 7 只（委员会 2026-09-23 确认）' : '持仓读自账本 portfolio.json',
    }
  })

  const all = entries.flatMap(e => e.objects)
  const reviewQueue = all
    .filter(v => v.reviewClass !== 'WATCH')
    .sort((a, b) => REVIEW_ORDER.indexOf(a.reviewClass) - REVIEW_ORDER.indexOf(b.reviewClass))
    .map(v => ({ id: v.id, name: v.name, entry: v.entry, reviewClass: v.reviewClass, text: REVIEW_TEXT[v.reviewClass] }))

  const migrations: MoneyCockpitView['migrations'] = []
  if (ds && ds.dates.length) {
    const t = ds.dates.length - 1
    const baskets = [...entries[0]!.objects, ...entries[1]!.objects].filter(v => v.kind === 'BASKET')
    for (const a of baskets) {
      for (const b of baskets) {
        if (a.id === b.id) continue
        const A = built[a.id]
        const B = built[b.id]
        if (!A || !B || !A.states.length || !B.states.length) continue
        const r = checkMigration({ states: A.states, metrics: A.metrics }, { states: B.states, metrics: B.metrics }, t)
        if (r.verdict === 'MIGRATION') migrations.push({ from: a.name, to: b.name, ...r })
      }
    }
  }

  let net10Yi: number | null = null
  let lastDay: string | null = null
  if (ds && ds.dates.length) {
    const flow = nationalTeamFlow(ds, NATIONAL_TEAM_ETFS.map(e => e.code))
    const cls = classifyNationalTeam(flow)
    const last10 = flow.slice(-10)
    net10Yi = last10.length === 10 && last10.every(v => v !== null)
      ? (last10 as number[]).reduce((a, b) => a + b, 0) / 1e8 : null
    const k = cls.length - 1
    lastDay = cls[k] ?? null
  }

  return {
    id: MONEY_COCKPIT_ID,
    title: MONEY_COCKPIT_TITLE,
    tier: TIER,
    asOf: ds?.dates.at(-1) ?? null,
    dataMode: ds ? mode : 'NOT_WIRED',
    entries,
    reviewQueue,
    migrations,
    nationalTeam: {
      etfs: NATIONAL_TEAM_ETFS,
      verified: NATIONAL_TEAM_VERIFIED,
      net10Yi,
      lastDay,
      role: '背景层温度计：大跌日大额申购读作托底，上涨中持续赎回读作降温。不进入主线份额比较',
    },
    providers: PROVIDER_CANDIDATES,
    routing: ROUTING,
    thresholds: THRESHOLDS,
    taxonomy: INDUSTRY_TAXONOMY,
    universeDefects: UNIVERSE_CODE_DEFECTS,
    doesNotImply: R01_DOES_NOT_IMPLY,
    flags: {
      moneyGrantsPermission: moneyGrantsPermission(),
      moneyProducesAction: moneyProducesAction(),
      usesEstimatedMoneyFlow: usesEstimatedMoneyFlow(),
      nationalTeamIsMainline: nationalTeamIsMainline(),
      divergenceIsSellOrder: divergenceIsSellOrder(),
      realProviderWired: anyRealProviderWired(),
      thresholdsFrozen: THRESHOLDS.status === 'FROZEN',
    },
  }
}

const pct = (v: number | null) => {
  if (v === null) return '—'
  const s = (v * 100).toFixed(1)
  return s === '-0.0' || s === '0.0' ? '0.0%' : `${v > 0 ? '+' : ''}${s}%`
}
const yi = (v: number | null) => (v === null ? '—' : `${v.toFixed(1)} 亿`)

export function renderMoneyCockpit(v: MoneyCockpitView): string {
  const W = 122
  const L: string[] = ['', '═'.repeat(W), `${v.id}｜${v.title}`, '═'.repeat(W)]
  L.push('  本区不打分、不产生动作。证据等级恒为 OBSERVATION。最高输出是复核顺序。')
  L.push(`  数据模式：${v.dataMode === 'NOT_WIRED' ? '数据源未接入（框架阶段）' : v.dataMode === 'FIXTURE' ? '合成数据（示意，非真实行情）' : '真实数据'}`
    + `　截至：${v.asOf ?? '—'}　阈值：${v.thresholds.status}（登记于 ${v.thresholds.registeredOn}）`)
  L.push('')

  L.push('  ── 复核顺序（按类别，不打分）──')
  if (!v.reviewQueue.length) L.push(v.dataMode === 'NOT_WIRED' ? '  数据源未接入，无复核项。' : '  无需优先复核的对象。')
  v.reviewQueue.forEach((r, i) => L.push(`  ${i + 1}. [${ENTRY_TEXT[r.entry]}] ${r.name}　${r.text}`))
  L.push('')

  for (const e of v.entries) {
    L.push(`  ── ${e.title}（${e.objects.length}）── ${e.note}`)
    for (const o of e.objects) {
      const stand = o.standing ? `　${o.standing}` : ''
      L.push(`  ${o.name.padEnd(12)}${o.stateText.padEnd(14)}资金池 ${yi(o.poolYi).padEnd(10)}`
        + `持续 ${o.persist ?? '—'} / 历史最长 ${o.maxPersistBefore ?? '—'}　`
        + `5日偏离 ${pct(o.dev5)}　20日偏离 ${pct(o.dev20)}　20日涨幅 ${pct(o.ret20)}${stand}`)
      if (o.divergence && o.divergence !== 'NONE') {
        L.push(`      背离判定：${o.divergence}　${o.divergenceDetail.join('；')}`)
      }
    }
    L.push('')
  }

  L.push('  ── 主线迁移（一出一进持续 N 日）──')
  if (!v.migrations.length) L.push('  无。')
  for (const m of v.migrations) L.push(`  ${m.from} → ${m.to}　${m.verdict}　${m.confirmation}　持续 ${m.days} 日`)
  L.push('')

  L.push('  ── 国家队温度计（背景层）──')
  L.push(`  观察 ${v.nationalTeam.etfs.length} 只宽基 ETF　名单已核对季报：${v.nationalTeam.verified ? '是' : '否（0 期核对）'}`)
  L.push(`  近 10 日净申赎：${yi(v.nationalTeam.net10Yi)}　最近一日：${v.nationalTeam.lastDay ?? '—'}`)
  L.push(`  ${v.nationalTeam.role}`)
  L.push('')

  L.push('  ── 数据源（候选，最终选择推迟）──')
  for (const p of v.providers) L.push(`  ${p.id.padEnd(18)}${p.status.padEnd(16)}${p.name}`)
  L.push('')

  if (v.universeDefects.length) {
    L.push('  ── 股票池代码缺陷（已登记，待委员会修正 universe.ts）──')
    for (const d of v.universeDefects) {
      L.push(`  ${d.name}：登记为 ${d.registered}（实为${d.registeredIs}），正确代码 ${d.correct}。${d.verifiedOn} 经${d.verifiedBy}核实`)
    }
    L.push('')
  }

  L.push('  本区不意味着：')
  for (const x of v.doesNotImply) L.push(`    · ${x}`)
  L.push('')
  return L.join('\n')
}
