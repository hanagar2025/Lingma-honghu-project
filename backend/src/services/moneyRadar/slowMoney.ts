/**
 * 资金驾驶舱（R-01）· 慢钱层：被动资金（科创系 ETF 申赎）、机构持仓、股东户数
 *
 * 成交额看得到"钱在哪里转"，看不到"钱是谁的"。这一层补三样真实披露的数据：
 *
 *   被动资金  科创 50 / 100 / 200 / 芯片 / 综指 的全部沪市 ETF 每日份额变化 × 净值近似（收盘价）
 *             —— 申购赎回是真金白银进出，T+1 可得；再按中证月末权重摊到成分股
 *   机构持仓  基金、机构合计占流通股比例（季度）。只有中报、年报是全部持仓，一季报、三季报只含前十大重仓，
 *             所以"变化"只拿中报对中报前的年报、年报对中报这种全持仓对全持仓来比
 *   股东户数  个股展示用最近一次披露（不少公司按旬 / 按月披露，不限季末），注明截止日与上期截止日；
 *             分组中位数与历史检验仍用季末定期报告 —— 各家披露间隔长短不一，混在一起比较没有意义。
 *             户数下降 = 筹码在集中
 *
 * 可得时点（事先写死，检验时只用"那天之后"的价格）：
 *   ETF 份额 T+1；基金中报全持仓 08-31、年报 03-31；股东户数按每家公司的公告日，次一交易日起算。
 *
 * 局限写在明处：
 *   · 权重只有最近一个月末的，没有历史 —— 摊到个股只用于"当前"的展示，不进入历史检验；
 *   · ETF 净值用收盘价近似，溢价大时有偏差；
 *   · 机构合计里含"其他"（一般法人、大股东关联方等），不能用 1 − 机构合计 当作散户占比。
 */

import { excessReturn } from './backtest'
import {
  fetchHolderNum, fetchHolderNumLatest, fetchIndexWeights, fetchKline, fetchOrgHold, fetchSecurityNames, fetchSseEtfShares,
  runPool, stockKlineCached, type HolderNumRow, type IndexWeights, type OrgHoldRow,
} from './fetch'
import { pearson, spearman } from './leadlag'
import { etfFlowSeries, sumEtfFlows, type Num } from './metrics'
import type { DataSet } from './types'

// ─────────────────────────── 登记 ───────────────────────────

export const STAR_INDEXES: readonly { index: string; name: string; kline: string; pattern: RegExp }[] = [
  { index: '000688', name: '科创50', kline: 'sh000688', pattern: /科创(板)?50/ },
  { index: '000698', name: '科创100', kline: 'sh000698', pattern: /科创(板)?100/ },
  { index: '000699', name: '科创200', kline: 'sh000699', pattern: /科创(板)?200/ },
  { index: '000685', name: '科创芯片', kline: 'sh000685', pattern: /科创(板)?芯片(?!设计)/ },
  { index: '000680', name: '科创综指', kline: 'sh000680', pattern: /科创综指|科创板综/ },
]

/** ETF 与指数日收益相关系数低于此值不算跟踪该指数（防止名称相近的主题 ETF 混入） */
export const TRACKING_MIN_CORR = 0.97

/** 机构持仓报告期的可得日（保守取法定披露截止日） */
export function orgHoldAvailableOn(reportDate: string): string {
  const y = Number(reportDate.slice(0, 4))
  const md = reportDate.slice(5)
  if (md === '03-31') return `${y}-04-30`
  if (md === '06-30') return `${y}-08-31`
  if (md === '09-30') return `${y}-10-31`
  return `${y + 1}-03-31`
}

/** 基金持仓是否为全部持仓（中报、年报） */
export function isFullHoldingReport(reportDate: string): boolean {
  return reportDate.endsWith('06-30') || reportDate.endsWith('12-31')
}

export function quarterEnds(from: string, to: string): string[] {
  const out: string[] = []
  for (let y = Number(from.slice(0, 4)); y <= Number(to.slice(0, 4)); y++) {
    for (const md of ['03-31', '06-30', '09-30', '12-31']) {
      const d = `${y}-${md}`
      if (d >= from && d <= to) out.push(d)
    }
  }
  return out
}

/** 第一个严格晚于 date 的交易日下标；没有返回 -1 */
export function firstTradingAfter(dates: readonly string[], date: string): number {
  let lo = 0
  let hi = dates.length
  while (lo < hi) { const m = (lo + hi) >> 1; if (dates[m]! <= date) lo = m + 1; else hi = m }
  return lo < dates.length ? lo : -1
}

// ─────────────────────────── 装载 ───────────────────────────

export interface IndexFlowSeries {
  index: string
  name: string
  etfs: { code: string; name: string; corr: number }[]
  rejected: { code: string; name: string; corr: number | null }[]
  /** 每日净申赎（元）；null = 份额数据缺失 */
  flow: Num[]
  /** 每日 ETF 合计规模（元） */
  aum: Num[]
  close: Num[]
  weights: IndexWeights | null
}

export interface SlowData {
  dates: string[]
  indexes: IndexFlowSeries[]
  /** 报告期 → 机构合计 / 基金 */
  orgHold: Record<string, { inst: Record<string, OrgHoldRow>; fund: Record<string, OrgHoldRow> }>
  /** 截止日 → 股东户数 */
  holderNum: Record<string, Record<string, HolderNumRow>>
  /** 每只股票最近一次披露（不限季末），用于当前展示 */
  holderLatest: Record<string, HolderNumRow>
  marketCap: Record<string, number>
}

function alignBars(bars: { date: string; close: number }[], dates: readonly string[]): Num[] {
  const m = new Map(bars.map(b => [b.date, b.close]))
  return dates.map(d => m.get(d) ?? null)
}

function dailyReturns(xs: readonly Num[], n: number): { a: number[]; idx: number[] } {
  const a: number[] = []
  const idx: number[] = []
  for (let t = Math.max(1, xs.length - n); t < xs.length; t++) {
    const p = xs[t - 1] ?? null
    const c = xs[t] ?? null
    if (p !== null && c !== null && p > 0) { a.push(c / p - 1); idx.push(t) }
  }
  return { a, idx }
}

/** 两条价格序列最近 n 日日收益的相关系数（只用两者都有的日子） */
export function returnCorr(x: readonly Num[], y: readonly Num[], n = 120): number | null {
  const rx = dailyReturns(x, n)
  const dy = dailyReturns(y, n)
  const ry = new Map(dy.idx.map((t, i) => [t, dy.a[i]!]))
  const xa: number[] = []
  const ya: number[] = []
  rx.idx.forEach((t, i) => { const v = ry.get(t); if (v !== undefined) { xa.push(rx.a[i]!); ya.push(v) } })
  return xa.length >= 40 ? pearson(xa, ya) : null
}

export async function loadSlowData(
  ds: DataSet, log: (s: string) => void, opts: { etfDays: number; marketCap: Record<string, number> },
): Promise<SlowData> {
  const dates = ds.dates
  const n = dates.length
  const etfDates = dates.slice(-opts.etfDays)
  const offset = n - etfDates.length

  log('· 慢钱：沪市 ETF 份额（缓存）')
  const sse: Record<string, Record<string, number> | null> = {}
  await runPool(etfDates, 4, async d => { sse[d] = await fetchSseEtfShares(d) })
  const allSse = new Set<string>()
  for (const d of etfDates) for (const c of Object.keys(sse[d] ?? {})) allSse.add(c)
  const starCodes = [...allSse].filter(c => /^58[89]/.test(c))
  const names = await fetchSecurityNames(starCodes)

  const indexes: IndexFlowSeries[] = []
  for (const spec of STAR_INDEXES) {
    const cand = starCodes.filter(c => spec.pattern.test(names[c] ?? '') && /ETF/.test(names[c] ?? ''))
    const idxBars = await fetchKline(spec.kline, 800).catch(() => [])
    const idxClose = alignBars(idxBars, dates)
    const closeOf: Record<string, Num[]> = {}
    const rawOf: Record<string, Num[]> = {}
    const ok: IndexFlowSeries['etfs'] = []
    const rejected: IndexFlowSeries['rejected'] = []
    await runPool(cand, 6, async c => {
      closeOf[c] = alignBars(await stockKlineCached(c, 800, dates.at(-1)!), dates)
      rawOf[c] = alignBars(await stockKlineCached(c, 800, dates.at(-1)!, 'raw'), dates)
    })
    for (const c of cand.sort()) {
      const corr = closeOf[c] ? returnCorr(closeOf[c]!, idxClose) : null
      if (corr !== null && corr >= TRACKING_MIN_CORR) ok.push({ code: c, name: names[c] ?? c, corr })
      else rejected.push({ code: c, name: names[c] ?? c, corr })
    }
    const series = ok.map(e => etfFlowSeries(
      dates.map((d, t) => (t < offset ? null : sse[d]?.[e.code] ?? null)), rawOf[e.code] ?? [], closeOf[e.code] ?? []))
    const splits = series.reduce((k, x) => k + x.splits.length, 0)
    const { flow, aum } = sumEtfFlows(series, n, t => t < offset || !sse[dates[t]!])
    indexes.push({ index: spec.index, name: spec.name, etfs: ok, rejected, flow, aum, close: idxClose, weights: await fetchIndexWeights(spec.index) })
    log(`    ${spec.name}：跟踪 ETF ${ok.length} 只${rejected.length ? `（名称相近但不跟踪、已剔除 ${rejected.length} 只）` : ''}${splits ? `；识别到份额折算 ${splits} 次，已按折算处理` : ''}`)
  }

  const reports = quarterEnds(dates[0]!, dates.at(-1)!)
  log(`· 慢钱：机构持仓 ${reports.length} 个报告期、股东户数（有缓存的跳过）`)
  const orgHold: SlowData['orgHold'] = {}
  const holderNum: SlowData['holderNum'] = {}
  await runPool(reports, 3, async q => {
    const [inst, fund, hn] = await Promise.all([fetchOrgHold(q, '00'), fetchOrgHold(q, '01'), fetchHolderNum(q)])
    if (inst.length || fund.length) {
      orgHold[q] = {
        inst: Object.fromEntries(inst.map(r => [r.code, r])),
        fund: Object.fromEntries(fund.map(r => [r.code, r])),
      }
    }
    if (hn.length) holderNum[q] = Object.fromEntries(hn.map(r => [r.code, r]))
  })
  let holderLatest: Record<string, HolderNumRow> = {}
  try { holderLatest = await fetchHolderNumLatest() } catch { log('    最新股东户数拉取失败，个股改用季末口径') }
  return { dates: [...dates], indexes, orgHold, holderNum, holderLatest, marketCap: opts.marketCap }
}

// ─────────────────────────── 当日视图 ───────────────────────────

const sumLast = (xs: readonly Num[], t: number, w: number): number | null => {
  if (t - w + 1 < 0) return null
  let s = 0
  for (let i = t - w + 1; i <= t; i++) { const v = xs[i]; if (v === null || v === undefined) return null; s += v }
  return s
}

/** 最近一天有值的下标（ETF 份额 T+1 才发布，当日通常没有） */
function lastKnown(xs: readonly Num[]): number {
  for (let t = xs.length - 1; t >= 0; t--) if (xs[t] !== null && xs[t] !== undefined) return t
  return -1
}

export interface SlowIndexView {
  index: string
  name: string
  etfCount: number
  asOf: string | null
  /** 净申赎（亿元），正 = 净申购 */
  flow5: number | null
  flow20: number | null
  flow60: number | null
  /** ETF 合计规模（亿元） */
  aum: number | null
  /** 20 日净申赎占规模 */
  flow20Pct: number | null
  /** 指数 20 日涨幅 */
  ret20: number | null
  /** ETF 规模占成分股总市值（近似：总市值而非自由流通市值） */
  aumOfCap: number | null
  weightsDate: string | null
  rejected: string[]
}

export interface SlowStockView {
  code: string
  name: string
  /** 所在科创系指数及权重（%） */
  indexWeights: { name: string; weight: number }[]
  /** 被动资金 20 日净申赎按权重摊到该股（亿元） */
  passive20: number | null
  /** 摊到该股的被动资金 ÷ 该股 20 日日均成交额 */
  passiveOfTurnover: number | null
  fundRatio: number | null
  fundRatioPrev: number | null
  instRatio: number | null
  holdReport: string | null
  holdReportPrev: string | null
  holders: number | null
  holdersChange: number | null
  holdersEndDate: string | null
  /** 比较的上一期截止日 */
  holdersPrevEndDate: string | null
  holdersNotice: string | null
  /** LATEST = 最近一次披露（不限季末）；QUARTER = 季末定期报告 */
  holdersBasis: 'LATEST' | 'QUARTER' | null
}

export interface SlowGroupView {
  id: 'STAR' | 'TECH' | 'ALL'
  text: string
  size: number
  /** 按总市值加权的基金持股占流通股比例（%） */
  fundRatio: number | null
  fundRatioPrev: number | null
  instRatio: number | null
  /** 股东户数较上期变化的中位数（%，季末定期报告口径） */
  holdersChangeMedian: number | null
}

export interface SlowMoneyView {
  asOf: string
  holdReport: string | null
  holdReportPrev: string | null
  indexes: SlowIndexView[]
  groups: SlowGroupView[]
  stocks: SlowStockView[]
  notes: string[]
  evidence?: SlowEvidence
}

/** 最近一个已过法定披露日、且为全部持仓的报告期，以及它前一个全持仓报告期 */
export function latestFullReports(orgHold: SlowData['orgHold'], asOf: string): [string | null, string | null] {
  const ok = Object.keys(orgHold).filter(q => isFullHoldingReport(q) && orgHoldAvailableOn(q) <= asOf).sort()
  return [ok.at(-1) ?? null, ok.at(-2) ?? null]
}

/** 最近一个已公告的股东户数：按截止日从新到旧找，公告日不晚于 asOf */
function latestHolder(hn: SlowData['holderNum'], code: string, asOf: string): HolderNumRow | null {
  for (const q of Object.keys(hn).sort().reverse()) {
    const r = hn[q]![code]
    if (r && r.noticeDate <= asOf) return r
  }
  return null
}

function capWeighted(codes: readonly string[], val: (c: string) => number | null, cap: Record<string, number>): number | null {
  let s = 0
  let w = 0
  for (const c of codes) {
    const v = val(c)
    const k = cap[c]
    if (v === null || !k) continue
    s += v * k; w += k
  }
  return w > 0 ? s / w : null
}

const median = (xs: number[]): number | null => {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2
}

export function buildSlowView(
  sd: SlowData, ds: DataSet, focus: readonly { code: string; name: string }[],
  groups: Record<SlowGroupView['id'], { text: string; codes: string[] }>,
): SlowMoneyView {
  const asOf = ds.dates.at(-1)!
  const [rep, prev] = latestFullReports(sd.orgHold, asOf)
  const Y = 1e8

  const indexes: SlowIndexView[] = sd.indexes.map(ix => {
    const t = lastKnown(ix.flow)
    const f20 = t >= 0 ? sumLast(ix.flow, t, 20) : null
    const aum = t >= 0 ? ix.aum[t] ?? null : null
    const members = Object.keys(ix.weights?.weights ?? {})
    const cap = members.reduce((a, c) => a + (sd.marketCap[c] ?? 0), 0)
    const c0 = ix.close.length > 20 ? ix.close[ix.close.length - 21] ?? null : null
    const c1 = ix.close.at(-1) ?? null
    return {
      index: ix.index, name: ix.name, etfCount: ix.etfs.length,
      asOf: t >= 0 ? sd.dates[t]! : null,
      flow5: t >= 0 && sumLast(ix.flow, t, 5) !== null ? sumLast(ix.flow, t, 5)! / Y : null,
      flow20: f20 !== null ? f20 / Y : null,
      flow60: t >= 0 && sumLast(ix.flow, t, 60) !== null ? sumLast(ix.flow, t, 60)! / Y : null,
      aum: aum !== null ? aum / Y : null,
      flow20Pct: f20 !== null && aum ? f20 / aum : null,
      ret20: c0 !== null && c1 !== null && c0 > 0 ? c1 / c0 - 1 : null,
      aumOfCap: aum !== null && cap > 0 ? aum / cap : null,
      weightsDate: ix.weights?.date ?? null,
      rejected: ix.rejected.map(r => `${r.name}（${r.code}）`),
    }
  })

  const stocks: SlowStockView[] = focus.map(({ code, name }) => {
    const iw: SlowStockView['indexWeights'] = []
    let passive: number | null = null
    for (const ix of sd.indexes) {
      const w = ix.weights?.weights[code]
      if (w === undefined) continue
      iw.push({ name: ix.name, weight: w })
      const t = lastKnown(ix.flow)
      const f20 = t >= 0 ? sumLast(ix.flow, t, 20) : null
      if (f20 !== null) passive = (passive ?? 0) + f20 * w / 100
    }
    const bars = ds.stocks[code] ?? []
    const amt = bars.slice(-20).map(b => b.amount).filter((v): v is number => v !== null)
    const avgAmt = amt.length === 20 ? amt.reduce((a, b) => a + b, 0) / 20 : null
    const q = latestHolder(sd.holderNum, code, asOf)
    const l = sd.holderLatest[code]
    const useLatest = !!l && l.noticeDate <= asOf && (!q || l.endDate >= q.endDate)
    const hr = useLatest ? l : q
    return {
      code, name, indexWeights: iw,
      passive20: passive !== null ? passive / Y : null,
      passiveOfTurnover: passive !== null && avgAmt ? passive / 20 / avgAmt : null,
      fundRatio: rep ? sd.orgHold[rep]!.fund[code]?.ratio ?? null : null,
      fundRatioPrev: prev ? sd.orgHold[prev]!.fund[code]?.ratio ?? null : null,
      instRatio: rep ? sd.orgHold[rep]!.inst[code]?.ratio ?? null : null,
      holdReport: rep, holdReportPrev: prev,
      holders: hr?.holders ?? null, holdersChange: hr?.ratio ?? null,
      holdersEndDate: hr?.endDate ?? null, holdersPrevEndDate: hr?.prevEndDate ?? null, holdersNotice: hr?.noticeDate ?? null,
      holdersBasis: hr ? (useLatest ? 'LATEST' : 'QUARTER') : null,
    }
  })

  const groupViews: SlowGroupView[] = (Object.keys(groups) as SlowGroupView['id'][]).map(id => {
    const g = groups[id]
    const ch: number[] = []
    for (const c of g.codes) { const r = latestHolder(sd.holderNum, c, asOf); if (r?.ratio !== null && r?.ratio !== undefined) ch.push(r.ratio) }
    return {
      id, text: g.text, size: g.codes.length,
      fundRatio: rep ? capWeighted(g.codes, c => sd.orgHold[rep]!.fund[c]?.ratio ?? null, sd.marketCap) : null,
      fundRatioPrev: prev ? capWeighted(g.codes, c => sd.orgHold[prev]!.fund[c]?.ratio ?? null, sd.marketCap) : null,
      instRatio: rep ? capWeighted(g.codes, c => sd.orgHold[rep]!.inst[c]?.ratio ?? null, sd.marketCap) : null,
      holdersChangeMedian: median(ch),
    }
  })

  return {
    asOf, holdReport: rep, holdReportPrev: prev, indexes, groups: groupViews, stocks,
    notes: [
      'ETF 申赎：沪市 ETF 每日份额变化 × 收盘价，T+1 可得；深市科创 ETF 无份额历史，未计入',
      `机构持仓：${rep ?? '—'} 为最近一个全持仓报告期（中报 08-31、年报 03-31 才算可得），与 ${prev ?? '—'} 比较；一季报、三季报只含前十大重仓，不用于比较`,
      '机构合计含"其他"（一般法人、大股东关联方等），1 − 机构合计 不等于散户占比',
      '股东户数：个股用最近一次披露（不限季末），"较上期"是与该公司上一次披露比，间隔长短不一，看截止日；分组中位数用季末定期报告口径',
      'ETF 规模占比按成分股总市值近似，自由流通市值口径会更高',
      '摊到个股只用最近一个月末权重，没有历史权重，因此只用于当前展示，不进入历史检验',
    ],
  }
}

// ─────────────────────────── 时效检验 ───────────────────────────

export interface EtfTimingRow {
  index: string
  name: string
  /** 20 日净申赎占规模 与 过去 20 日指数超额收益 的相关 */
  past: { r: number | null; ci: [number, number] | null }
  /** 与 之后 20 日（T+1 收盘起）指数超额收益 的相关 */
  fwd: { r: number | null; ci: [number, number] | null }
  independent: number
}

export interface CrossSectionRow {
  period: string
  availableOn: string
  n: number
  /** 与"信号形成期间"价格表现的秩相关 */
  pastIc: number | null
  /** 与可得日次一交易日起 60 日超额收益的秩相关 */
  fwdIc: number | null
  /** 信号最强 1/5 减最弱 1/5 的之后 60 日超额收益 */
  spread: number | null
}

export interface CrossSectionStudy {
  signal: 'FUND_DELTA' | 'HOLDER_DROP'
  text: string
  universe: string
  rows: CrossSectionRow[]
  meanPastIc: number | null
  meanFwdIc: number | null
  /** 之后 60 日 IC 为正的期数 / 总期数 */
  positive: [number, number]
  meanSpread: number | null
}

export interface SlowEvidence {
  etfTiming: EtfTimingRow[]
  cross: CrossSectionStudy[]
  conclusion: string[]
}

function corrWithCi(x: number[], y: number[]): { r: number | null; ci: [number, number] | null } {
  const r = pearson(x, y)
  if (x.length < 60) return { r, ci: null }
  const n = x.length
  const block = 20
  let s = 20260924
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647 }
  const rs: number[] = []
  for (let it = 0; it < 2000; it++) {
    const bx: number[] = []; const by: number[] = []
    while (bx.length < n) {
      const st = Math.floor(rnd() * (n - block + 1))
      for (let k = 0; k < block && bx.length < n; k++) { bx.push(x[st + k]!); by.push(y[st + k]!) }
    }
    const v = pearson(bx, by)
    if (v !== null) rs.push(v)
  }
  rs.sort((a, b) => a - b)
  return { r, ci: rs.length ? [rs[Math.floor(rs.length * 0.025)]!, rs[Math.floor(rs.length * 0.975)]!] : null }
}

export function studyEtfTiming(sd: SlowData, ds: DataSet): EtfTimingRow[] {
  const bench = ds.market.map(d => d.close ?? null)
  const n = ds.dates.length
  return sd.indexes.map(ix => {
    const px: number[] = []; const py: number[] = []
    const fx: number[] = []; const fy: number[] = []
    for (let t = 20; t < n; t++) {
      const f = sumLast(ix.flow, t, 20)
      const a = ix.aum[t] ?? null
      if (f === null || !a) continue
      const x = f / a
      const yp = excessReturn(ix.close, bench, t - 20, 20)
      if (yp !== null) { px.push(x); py.push(yp) }
      const yf = excessReturn(ix.close, bench, t + 1, 20)
      if (yf !== null) { fx.push(x); fy.push(yf) }
    }
    return { index: ix.index, name: ix.name, past: corrWithCi(px, py), fwd: corrWithCi(fx, fy), independent: Math.floor(fx.length / 20) }
  })
}

const H = 60

function crossSection(
  period: string, availableOn: string, items: { code: string; x: number; entry: number; pastFrom: number; pastTo: number }[],
  ds: DataSet,
): CrossSectionRow | null {
  const bench = ds.market.map(d => d.close ?? null)
  const xs: number[] = []; const fwd: number[] = []
  const xp: number[] = []; const past: number[] = []
  for (const it of items) {
    const close = ds.stocks[it.code]?.map(b => b.close) ?? null
    if (!close) continue
    const p = it.pastFrom >= 0 ? excessReturn(close, bench, it.pastFrom, it.pastTo - it.pastFrom) : null
    if (p !== null) { xp.push(it.x); past.push(p) }
    if (it.entry < 0 || !(ds.stocks[it.code]![it.entry]?.amount)) continue
    const f = excessReturn(close, bench, it.entry, H)
    if (f !== null) { xs.push(it.x); fwd.push(f) }
  }
  if (xs.length < 30) return null
  const order = xs.map((_, i) => i).sort((a, b) => xs[a]! - xs[b]!)
  const q = Math.floor(order.length / 5)
  const avg = (ix: number[]) => ix.reduce((a, i) => a + fwd[i]!, 0) / ix.length
  return {
    period, availableOn, n: xs.length,
    pastIc: xp.length >= 30 ? spearman(xp, past) : null,
    fwdIc: spearman(xs, fwd),
    spread: q ? avg(order.slice(-q)) - avg(order.slice(0, q)) : null,
  }
}

function summarizeCross(signal: CrossSectionStudy['signal'], text: string, universe: string, rows: CrossSectionRow[]): CrossSectionStudy {
  const m = (xs: (number | null)[]) => { const v = xs.filter((x): x is number => x !== null); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null }
  return {
    signal, text, universe, rows,
    meanPastIc: m(rows.map(r => r.pastIc)),
    meanFwdIc: m(rows.map(r => r.fwdIc)),
    positive: [rows.filter(r => (r.fwdIc ?? 0) > 0).length, rows.length],
    meanSpread: m(rows.map(r => r.spread)),
  }
}

/**
 * 横截面检验：
 *   FUND_DELTA  基金持股比例较上一个全持仓报告期的变化（百分点）；可得日 = 法定披露截止日，次一交易日买入
 *   HOLDER_DROP 股东户数较上期下降的幅度（= −变化率）；可得日 = 各公司公告日，次一交易日买入
 * "信号形成期间"：FUND_DELTA 为两个报告期之间，HOLDER_DROP 为截止日前 60 个交易日。
 */
export function studyCross(sd: SlowData, ds: DataSet, universes: Record<string, { text: string; codes: Set<string> }>): CrossSectionStudy[] {
  const dates = ds.dates
  const out: CrossSectionStudy[] = []
  const full = Object.keys(sd.orgHold).filter(isFullHoldingReport).sort()
  const idxOn = (d: string) => { const i = firstTradingAfter(dates, d); return i < 0 ? dates.length - 1 : i - 1 }

  for (const [uid, u] of Object.entries(universes)) {
    const fundRows: CrossSectionRow[] = []
    for (let k = 1; k < full.length; k++) {
      const q = full[k]!
      const p = full[k - 1]!
      const avail = orgHoldAvailableOn(q)
      const entry = firstTradingAfter(dates, avail)
      if (entry < 0) continue
      const cur = sd.orgHold[q]!.fund
      const pre = sd.orgHold[p]!.fund
      const items = Object.keys(cur).filter(c => u.codes.has(c) && pre[c]).map(c => ({
        code: c, x: (cur[c]!.ratio ?? 0) - (pre[c]!.ratio ?? 0), entry, pastFrom: idxOn(p), pastTo: idxOn(q),
      }))
      const row = crossSection(q, avail, items, ds)
      if (row) fundRows.push(row)
    }
    out.push(summarizeCross('FUND_DELTA', '基金持股比例半年变化', `${uid}`, fundRows))

    const holderRows: CrossSectionRow[] = []
    for (const q of Object.keys(sd.holderNum).sort()) {
      const qi = idxOn(q)
      const items = Object.values(sd.holderNum[q]!)
        .filter(r => u.codes.has(r.code) && r.ratio !== null)
        .map(r => ({ code: r.code, x: -(r.ratio as number), entry: firstTradingAfter(dates, r.noticeDate), pastFrom: qi - 60, pastTo: qi }))
      const notices = Object.values(sd.holderNum[q]!).map(r => r.noticeDate).sort()
      const row = crossSection(q, notices[Math.floor(notices.length / 2)] ?? q, items, ds)
      if (row) holderRows.push(row)
    }
    out.push(summarizeCross('HOLDER_DROP', '股东户数下降幅度', `${uid}`, holderRows))
  }
  return out
}

const f3 = (v: number | null) => (v === null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(3)}`)

export function concludeSlow(etf: readonly EtfTimingRow[], cross: readonly CrossSectionStudy[]): string[] {
  const out: string[] = []
  for (const r of etf) {
    const lead = r.fwd.ci ? (r.fwd.ci[0] > 0 ? '正相关' : r.fwd.ci[1] < 0 ? '负相关（申购越多之后越弱）' : '无显著关系') : '样本不足'
    const follow = r.past.ci ? (r.past.ci[0] > 0 ? '跟涨申购' : r.past.ci[1] < 0 ? '逆势申购（跌了才买）' : '与过去涨跌无显著关系') : '样本不足'
    out.push(`${r.name} ETF 申赎：${follow}（r=${f3(r.past.r)}）；对之后 20 日${lead}（r=${f3(r.fwd.r)}，独立样本约 ${r.independent} 段）`)
  }
  for (const c of cross) {
    if (!c.rows.length) continue
    out.push(`${c.text}（${c.universe}）：${c.rows.length} 期，之后 60 日 IC 均值 ${f3(c.meanFwdIc)}，为正 ${c.positive[0]}/${c.positive[1]} 期；形成期间与价格 IC ${f3(c.meanPastIc)}`
      + (c.rows.length < 8 ? '（期数太少，只作方向参考）' : ''))
  }
  return out
}

export function studySlow(sd: SlowData, ds: DataSet, universes: Record<string, { text: string; codes: Set<string> }>): SlowEvidence {
  const etfTiming = studyEtfTiming(sd, ds)
  const cross = studyCross(sd, ds, universes)
  return { etfTiming, cross, conclusion: concludeSlow(etfTiming, cross) }
}