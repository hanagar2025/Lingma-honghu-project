// Profit Radar —— 利润池迁移地图
//
// 回答委员会的问题：「哪个节点的利润正在从预期变成兑现？」
//
// 本文件只做两件事：把累计财报还原成单季序列，按节点汇总。**不含任何决策规则。**
// 全部输出为会计事实（ACCOUNTING）或描述性标签（OBSERVATION），不产生动作、不产生买入候选。
//
// ⚠ 一条必须先读的结构性约束（实测）：
//   2026-08-13 抓取 51 只标的，**仅 2 只已披露 2026 中报**，其余 49 只最新为 2026Q1。
//   即利润数据对 96% 的标的滞后约 4.5 个月。
//
//   推论：**利润雷达在结构上不可能是"每天变化"的雷达。** 它一年只更新四次，且集中在财报季。
//   若把它塞进一张每日刷新的表，那张表里唯一每天变化的东西就是价格与成交 ——
//   于是"每日新核心发现"的日间变动会 100% 由价格驱动，只是这次穿的是财报的外衣。
//
//   正确用法：利润雷达**事件驱动**（财报披露触发），价格/资金雷达每日运行，
//   两者的更新频率必须在界面上分别标注，不得混在一张"今日"表里制造实时感。

import { readFileSync } from 'node:fs'
import { PROFIT_FILE, type ProfitFile, type ProfitRecord, type RawPeriod } from './profitFetch'
import { NODE_CANDIDATES } from './nodeCandidates'
import { MAINLINES } from '../msr/universe'

/** 单季还原结果 */
export interface QuarterPoint {
  year: number
  quarter: 1 | 2 | 3 | 4
  label: string
  /** 单季营业收入（元） */
  revenue: number | null
  /** 单季归母净利润（元） */
  netProfit: number | null
  /** 单季收入同比 */
  revenueYoy: number | null
  /** 单季净利同比 */
  netProfitYoy: number | null
}

/**
 * 累计 → 单季。
 *
 * Q1 的累计即单季；Q2/Q3/Q4 单季 = 本期累计 − 同年上期累计。
 * 缺任一端则该季为 null，**不做插值** —— 插出来的利润会被当成兑现证据。
 */
export function toSingleQuarter(periods: RawPeriod[]): QuarterPoint[] {
  const byKey = new Map<string, RawPeriod>()
  for (const p of periods) byKey.set(`${p.year}Q${p.quarter}`, p)

  const single = new Map<string, { revenue: number | null; netProfit: number | null }>()
  for (const p of periods) {
    if (p.quarter === 1) {
      single.set(`${p.year}Q1`, { revenue: p.revenueCum, netProfit: p.netProfitCum })
      continue
    }
    const prev = byKey.get(`${p.year}Q${p.quarter - 1}`)
    single.set(`${p.year}Q${p.quarter}`, {
      revenue: p.revenueCum !== null && prev?.revenueCum != null ? p.revenueCum - prev.revenueCum : null,
      netProfit: p.netProfitCum !== null && prev?.netProfitCum != null ? p.netProfitCum - prev.netProfitCum : null,
    })
  }

  const out: QuarterPoint[] = []
  for (const p of periods) {
    const key = `${p.year}Q${p.quarter}`
    const cur = single.get(key)
    const yoyKey = `${p.year - 1}Q${p.quarter}`
    const base = single.get(yoyKey)
    // 同比要求基期为正。基期为负时"同比增长率"没有可解释含义，宁可留空
    const revYoy = cur?.revenue != null && base?.revenue != null && base.revenue > 0
      ? cur.revenue / base.revenue - 1 : null
    const npYoy = cur?.netProfit != null && base?.netProfit != null && base.netProfit > 0
      ? cur.netProfit / base.netProfit - 1 : null
    out.push({
      year: p.year, quarter: p.quarter, label: key,
      revenue: cur?.revenue ?? null, netProfit: cur?.netProfit ?? null,
      revenueYoy: revYoy, netProfitYoy: npYoy,
    })
  }
  return out
}

export interface MemberProfit {
  code: string
  name: string
  scope: 'DECISION' | 'RESEARCH'
  node: string
  mainlineId: string
  /** 最新报告期 */
  latestReport: string | null
  /** 距今天数 —— 用于暴露利润数据的滞后 */
  reportAgeDays: number | null
  /** 是否已披露最近一期中报/年报（即扣非可得） */
  latestSingle: QuarterPoint | null
  prevSingle: QuarterPoint | null
  /** 单季净利同比的变化（pct点）。>0 表示同比增速本季高于上季 —— 事实，不是预测 */
  npYoyAccelPct: number | null
  /** 累计毛利率及其同比变化（pct点） */
  grossMargin: number | null
  grossMarginYoyPct: number | null
  /** 扣非占净利比。仅半年报/年报可得 */
  deductRatio: number | null
  deductRatioAsOf: string | null
  /** 现金含量 = 每股经营现金流 ÷ 基本每股收益 */
  cashMatch: number | null
  roe: number | null
  dataGaps: string[]
}

function daysSince(d: string, today: string): number {
  return Math.round((Date.parse(today) - Date.parse(d)) / 86400000)
}

export function computeMemberProfit(rec: ProfitRecord, node: string, mainlineId: string, today: string): MemberProfit {
  const gaps: string[] = []
  const sq = toSingleQuarter(rec.periods)
  const latest = rec.periods[rec.periods.length - 1] ?? null
  const latestSq = sq.length ? sq[sq.length - 1] : null
  const prevSq = sq.length > 1 ? sq[sq.length - 2] : null

  if (rec.error) gaps.push(`财报抓取失败：${rec.error}`)
  if (!latest) gaps.push('无任何财报数据')

  // 毛利率同比：与去年同季的累计毛利率比
  let gmYoy: number | null = null
  if (latest) {
    const lastYearSame = rec.periods.find(p => p.year === latest.year - 1 && p.quarter === latest.quarter)
    if (latest.grossMarginCum != null && lastYearSame?.grossMarginCum != null) {
      gmYoy = latest.grossMarginCum - lastYearSame.grossMarginCum
    } else gaps.push('毛利率同比基期缺失')
  }

  // 扣非占比：取最近一期同时有扣非与基本EPS的报告（半年报/年报）
  let deductRatio: number | null = null
  let deductAsOf: string | null = null
  for (let i = rec.periods.length - 1; i >= 0; i--) {
    const p = rec.periods[i]
    if (p.deductEps != null && p.basicEps != null && p.basicEps !== 0) {
      deductRatio = p.deductEps / p.basicEps
      deductAsOf = p.reportDate
      break
    }
  }
  if (deductRatio === null) gaps.push('扣非占比不可得（一季报/三季报无该字段）')
  else if (deductAsOf && latest && deductAsOf !== latest.reportDate) {
    gaps.push(`扣非口径滞后至 ${deductAsOf}（最新报告期 ${latest.reportDate} 无扣非字段）`)
  }

  const cashMatch = latest?.cfoPerShareCum != null && latest.basicEps != null && latest.basicEps !== 0
    ? latest.cfoPerShareCum / latest.basicEps : null
  if (cashMatch === null) gaps.push('现金含量不可算')

  const accel = latestSq?.netProfitYoy != null && prevSq?.netProfitYoy != null
    ? (latestSq.netProfitYoy - prevSq.netProfitYoy) * 100 : null
  if (accel === null) gaps.push('单季净利同比加速度不可算（基期为负或缺失）')

  return {
    code: rec.code, name: rec.name, scope: rec.scope, node, mainlineId,
    latestReport: latest?.reportDate ?? null,
    reportAgeDays: latest ? daysSince(latest.reportDate, today) : null,
    latestSingle: latestSq, prevSingle: prevSq,
    npYoyAccelPct: accel,
    grossMargin: latest?.grossMarginCum ?? null,
    grossMarginYoyPct: gmYoy,
    deductRatio, deductRatioAsOf: deductAsOf,
    cashMatch,
    roe: latest?.roeCum ?? null,
    dataGaps: gaps,
  }
}

/**
 * 节点级利润读数。
 *
 * `status` 是**描述性标签（OBSERVATION）**，不得作为动作依据。
 * 它只陈述"该节点在册标的的单季利润同比是加速还是减速"，不预测股价。
 */
export interface NodeProfit {
  mainlineId: string
  node: string
  members: MemberProfit[]
  /** 有可用单季净利同比的标的数 */
  usable: number
  /** 单季净利同比中位数 */
  medianNpYoy: number | null
  /** 加速的标的数 */
  accelerating: number
  /** 最旧的报告期距今天数 —— 节点整体的数据新鲜度 */
  maxReportAgeDays: number | null
  /**
   * 描述性标签。`LEVEL_ONLY` 表示有同比读数但加速度不可算（基期为负或缺一季），
   * 与 `NO_DATA` 必须区分 —— 混为一谈会让"高速增长但历史太短"被误读成"没有数据"。
   */
  status: 'ACCELERATING' | 'DECELERATING' | 'MIXED' | 'LEVEL_ONLY' | 'NO_DATA'
  /** 该节点是否只有研究域标的（即决策域尚未覆盖） */
  researchOnly: boolean
}

function median(xs: number[]): number | null {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2
}

export interface ProfitMap {
  today: string
  generatedAt: string
  /** 数据新鲜度声明 —— 必须随地图一起呈现 */
  freshness: {
    withLatestHalfYear: number
    total: number
    medianReportAgeDays: number | null
    warning: string
  }
  nodes: NodeProfit[]
  unavailableFields: readonly string[]
}

export function buildProfitMap(today: string, file?: ProfitFile): ProfitMap {
  const f = file ?? (JSON.parse(readFileSync(PROFIT_FILE, 'utf-8')) as ProfitFile)

  // 节点归属：决策域取 universe.ts，研究域取 nodeCandidates.ts
  const attribution = new Map<string, { node: string; mainlineId: string }>()
  for (const ml of MAINLINES) {
    for (const m of ml.members) attribution.set(m.code, { node: m.node, mainlineId: ml.id })
  }
  for (const c of NODE_CANDIDATES) {
    if (!attribution.has(c.code)) attribution.set(c.code, { node: c.node, mainlineId: c.mainlineId })
  }

  const members = f.records.map(r => {
    const a = attribution.get(r.code) ?? { node: '未归属', mainlineId: '未归属' }
    return computeMemberProfit(r, a.node, a.mainlineId, today)
  })

  const keys = [...new Set(members.map(m => `${m.mainlineId}|${m.node}`))].sort()
  const nodes: NodeProfit[] = keys.map(k => {
    const [mainlineId, node] = k.split('|')
    const ms = members.filter(m => m.mainlineId === mainlineId && m.node === node)
    const yoys = ms.map(m => m.latestSingle?.netProfitYoy).filter((x): x is number => x != null)
    const accels = ms.map(m => m.npYoyAccelPct).filter((x): x is number => x != null)
    const ages = ms.map(m => m.reportAgeDays).filter((x): x is number => x != null)
    const accelerating = accels.filter(a => a > 0).length
    const status: NodeProfit['status'] = accels.length === 0
      ? (yoys.length ? 'LEVEL_ONLY' : 'NO_DATA')
      : accelerating === accels.length ? 'ACCELERATING'
      : accelerating === 0 ? 'DECELERATING' : 'MIXED'
    return {
      mainlineId, node, members: ms,
      usable: yoys.length,
      medianNpYoy: median(yoys),
      accelerating,
      maxReportAgeDays: ages.length ? Math.max(...ages) : null,
      status,
      researchOnly: ms.length > 0 && ms.every(m => m.scope === 'RESEARCH'),
    }
  })

  const ages = members.map(m => m.reportAgeDays).filter((x): x is number => x != null)
  const withH1 = members.filter(m => m.latestReport && m.latestReport >= `${today.slice(0, 4)}-06-30`).length

  return {
    today,
    generatedAt: f.generatedAt,
    freshness: {
      withLatestHalfYear: withH1,
      total: members.length,
      medianReportAgeDays: median(ages),
      warning:
        `仅 ${withH1}/${members.length} 只已披露最新半年报，中位滞后 ${median(ages) ?? '—'} 天。` +
        '利润雷达一年只更新四次，结构上不可能每天变化；把它放进每日表会让日间变动全部来自价格。',
    },
    nodes,
    unavailableFields: f.methodology.unavailable,
  }
}
