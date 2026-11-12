/**
 * 模拟层 · SIM-LEADLAG：价格信号是否领先扣非利润拐点（逐节点）
 *
 * 委员会 2026-10-17：「资本市场领先基本面约 8 个月」只是待检验假设。
 * 本模块在模拟层比较价格信号与实际报告中的扣非利润拐点，逐节点记录领先期、样本数量和失败案例；
 * 在样本积累充分之前不宣布存在稳定领先规律。任何结果都不进入执行单、不改变 C0–C3 判定、不产生动作。
 *
 * 口径（模拟层预登记，不是委员会裁定，改动须在报告里写明）：
 *   价格信号    收盘价低于 60 日均线，且 60 日收益跑输所属主线基准；连续 20 个交易日不满足后再次满足才算新一次信号
 *   利润拐点    单季扣非净利低于上年同季（单季 = 本期累计 − 上期累计），且上一季不低于上年同季；日期取公告日
 *   命中        拐点公告日前 250 个交易日内出现过价格信号
 *   领先期      拐点公告日（及报告期末）与此前最近一次价格信号之间的交易日数
 *   误报        价格信号之后 250 个交易日内没有出现利润拐点（不足 250 日的信号记「未到期」，不计入）
 *   随机基准    样本期内任意一个交易日，其前 250 个交易日内出现过价格信号的比例；命中率比它高不到 5 个百分点，就没有可区分的领先信息
 *   敏感性      另以 60、120 个交易日窗口重算命中率与随机基准
 */

import type { Bar } from './ma60'

export const LEADLAG = {
  maDays: 60,
  rsDays: 60,
  resetDays: 20,
  windowDays: 250,
  minTurnsPerNode: 20,
  minEdge: 0.05,
  sensitivityWindows: [60, 120],
} as const

export interface DeductRow { reportDate: string; noticeDate: string | null; cumDeduct: number | null }
export interface SingleQuarter { reportDate: string; noticeDate: string; value: number }
export interface EarningsTurn { reportDate: string; noticeDate: string; value: number; sameQuarterLastYear: number }

const prevQuarterEnd = (d: string): string | null => {
  const m = d.slice(5, 10)
  const y = d.slice(0, 4)
  return m === '06-30' ? `${y}-03-31` : m === '09-30' ? `${y}-06-30` : m === '12-31' ? `${y}-09-30` : null
}

/** 累计扣非 → 单季扣非。缺上一期累计值的季度不推算 */
export function singleQuarters(rows: DeductRow[]): SingleQuarter[] {
  const by = new Map(rows.filter(r => r.cumDeduct != null).map(r => [r.reportDate, r]))
  const out: SingleQuarter[] = []
  for (const r of [...by.values()].sort((a, b) => a.reportDate.localeCompare(b.reportDate))) {
    if (!r.noticeDate) continue
    const prev = prevQuarterEnd(r.reportDate)
    if (prev === null) out.push({ reportDate: r.reportDate, noticeDate: r.noticeDate, value: r.cumDeduct! })
    else {
      const p = by.get(prev)
      if (p?.cumDeduct != null) out.push({ reportDate: r.reportDate, noticeDate: r.noticeDate, value: r.cumDeduct! - p.cumDeduct })
    }
  }
  return out
}

const lastYear = (d: string) => `${+d.slice(0, 4) - 1}${d.slice(4)}`

/** 单季扣非由「不低于上年同季」转为「低于上年同季」 */
export function earningsTurns(qs: SingleQuarter[]): EarningsTurn[] {
  const by = new Map(qs.map(q => [q.reportDate, q]))
  const diff = (q: SingleQuarter) => {
    const ly = by.get(lastYear(q.reportDate))
    return ly ? q.value - ly.value : null
  }
  const out: EarningsTurn[] = []
  const sorted = [...qs].sort((a, b) => a.reportDate.localeCompare(b.reportDate))
  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i]!
    const prev = sorted[i - 1]!
    const expected = prevQuarterEnd(cur.reportDate) ?? `${+cur.reportDate.slice(0, 4) - 1}-12-31`
    if (prev.reportDate !== expected) continue
    const d = diff(cur)
    const dp = diff(prev)
    if (d != null && dp != null && d < 0 && dp >= 0) {
      out.push({ reportDate: cur.reportDate, noticeDate: cur.noticeDate, value: cur.value, sameQuarterLastYear: by.get(lastYear(cur.reportDate))!.value })
    }
  }
  return out
}

/** 价格信号的起点日期 */
export function priceEpisodes(bars: Bar[], bench: Map<string, number>): { starts: number[]; evaluable: boolean[] } {
  const { maDays, rsDays, resetDays } = LEADLAG
  const n = bars.length
  const cond: (boolean | null)[] = new Array(n).fill(null)
  let sum = 0
  for (let i = 0; i < n; i++) {
    sum += bars[i]!.close
    if (i >= maDays) sum -= bars[i - maDays]!.close
    if (i < Math.max(maDays, rsDays)) continue
    const b0 = bench.get(bars[i - rsDays]!.date)
    const b1 = bench.get(bars[i]!.date)
    if (b0 == null || b1 == null) continue
    const below = bars[i]!.close < sum / maDays
    const rs = bars[i]!.close / bars[i - rsDays]!.close - b1 / b0
    cond[i] = below && rs < 0
  }
  const starts: number[] = []
  let quiet = 0
  for (let i = 0; i < n; i++) {
    const c = cond[i]
    if (c === null) { quiet = 0; continue }
    if (c) {
      if (quiet >= resetDays) starts.push(i)
      quiet = 0
    } else quiet++
  }
  return { starts, evaluable: cond.map(c => c !== null) }
}

export interface TurnResult {
  code: string
  name: string
  reportDate: string
  noticeDate: string
  hit: boolean
  /** 公告日前最近一次价格信号的日期 */
  signalDate: string | null
  leadToNotice: number | null
  /** 正数 = 信号早于报告期末；负数 = 信号在期末之后、公告之前 */
  leadToPeriodEnd: number | null
}

export interface StockLeadLag {
  code: string
  name: string
  node: string
  benchmark: string
  turns: TurnResult[]
  /** 不在可检验区间内（行情不足或超出样本）的拐点 */
  skippedTurns: number
  signals: { date: string; outcome: 'FOLLOWED' | 'FALSE_ALARM' | 'PENDING' }[]
  /** 随机基准：任意交易日前 250 日内有信号的比例 */
  coverage: number | null
  evaluableDays: number
}

const firstIndexOnOrAfter = (bars: Bar[], date: string) => {
  let lo = 0
  let hi = bars.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (bars[mid]!.date < date) lo = mid + 1
    else hi = mid
  }
  return lo
}

export function analyzeStock(
  m: { code: string; name: string; node: string; benchmark: string },
  bars: Bar[], bench: Map<string, number>, turns: EarningsTurn[], from: string,
  W: number = LEADLAG.windowDays,
): StockLeadLag {
  const { starts, evaluable } = priceEpisodes(bars, bench)
  const firstEval = evaluable.findIndex(Boolean)
  const fromIdx = Math.max(firstIndexOnOrAfter(bars, from), firstEval < 0 ? bars.length : firstEval + LEADLAG.resetDays)
  const results: TurnResult[] = []
  let skipped = 0
  for (const t of turns) {
    const i = firstIndexOnOrAfter(bars, t.noticeDate)
    if (i >= bars.length || i - W < fromIdx) { skipped++; continue }
    const inWindow = starts.filter(s => s <= i && s >= i - W)
    const last = inWindow.at(-1)
    const pe = firstIndexOnOrAfter(bars, t.reportDate)
    results.push({
      code: m.code, name: m.name, reportDate: t.reportDate, noticeDate: t.noticeDate, hit: last != null,
      signalDate: last != null ? bars[last]!.date : null,
      leadToNotice: last != null ? i - last : null,
      leadToPeriodEnd: last != null ? pe - last : null,
    })
  }
  const turnIdx = turns.map(t => firstIndexOnOrAfter(bars, t.noticeDate))
  const signals = starts.filter(s => s >= fromIdx).map(s => ({
    date: bars[s]!.date,
    outcome: turnIdx.some(i => i > s && i <= s + W) ? 'FOLLOWED' as const : s + W >= bars.length ? 'PENDING' as const : 'FALSE_ALARM' as const,
  }))
  let covered = 0
  let days = 0
  for (let t = fromIdx + W; t < bars.length; t++) {
    days++
    if (starts.some(s => s <= t && s >= t - W)) covered++
  }
  return { ...m, turns: results, skippedTurns: skipped, signals, coverage: days ? covered / days : null, evaluableDays: days }
}

export interface NodeLeadLag {
  node: string
  stocks: number
  turns: number
  hits: number
  hitRate: number | null
  baseline: number | null
  medianLeadToNotice: number | null
  medianLeadToPeriodEnd: number | null
  signals: number
  falseAlarms: number
  pendingSignals: number
  falseAlarmRate: number | null
  misses: TurnResult[]
  bySplit: { label: string; turns: number; hits: number }[]
  verdict: string
}

export function median(xs: number[]): number | null {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2
}

export function summarizeNode(node: string, rows: StockLeadLag[], oosFrom: string): NodeLeadLag {
  const turns = rows.flatMap(r => r.turns)
  const hits = turns.filter(t => t.hit)
  const sig = rows.flatMap(r => r.signals)
  const settled = sig.filter(s => s.outcome !== 'PENDING')
  const fa = sig.filter(s => s.outcome === 'FALSE_ALARM').length
  const covs = rows.filter(r => r.coverage != null && r.evaluableDays > 0)
  const baseline = covs.length ? covs.reduce((a, r) => a + r.coverage! * r.evaluableDays, 0) / covs.reduce((a, r) => a + r.evaluableDays, 0) : null
  const hitRate = turns.length ? hits.length / turns.length : null
  const split = (label: string, f: (t: TurnResult) => boolean) => ({ label, turns: turns.filter(f).length, hits: turns.filter(t => f(t) && t.hit).length })
  let verdict: string
  if (turns.length < LEADLAG.minTurnsPerNode) verdict = `样本不足（${turns.length} 次拐点，少于 ${LEADLAG.minTurnsPerNode} 次），不能判断是否领先`
  else if (hitRate == null || baseline == null) verdict = '无法计算随机基准，不能判断'
  else if (hitRate - baseline < LEADLAG.minEdge) verdict = `命中率 ${(hitRate * 100).toFixed(1)}% 与随机基准 ${(baseline * 100).toFixed(1)}% 相差不到 ${LEADLAG.minEdge * 100} 个百分点：价格信号没有表现出可区分的领先信息`
  else verdict = `命中率 ${(hitRate * 100).toFixed(1)}% 高于随机基准 ${(baseline * 100).toFixed(1)}%；仍须样本外复验与误报代价评估，不宣布领先规律`
  return {
    node, stocks: rows.length, turns: turns.length, hits: hits.length, hitRate, baseline,
    medianLeadToNotice: median(hits.map(t => t.leadToNotice!)),
    medianLeadToPeriodEnd: median(hits.map(t => t.leadToPeriodEnd!)),
    signals: sig.length, falseAlarms: fa, pendingSignals: sig.length - settled.length,
    falseAlarmRate: settled.length ? fa / settled.length : null,
    misses: turns.filter(t => !t.hit),
    bySplit: [split(`样本内（${oosFrom} 前公告）`, t => t.noticeDate < oosFrom), split(`样本外（${oosFrom} 起公告）`, t => t.noticeDate >= oosFrom)],
    verdict,
  }
}

export function leadLagDeclaresRule(): false { return false }
export function leadLagProducesAction(): false { return false }
