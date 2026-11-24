/**
 * 查询口：把累积的数据整理成 bot 算分要用的样子。只读，不打分、不排序。
 *
 * 仓位只给占比和净值指数。股数、现金、总资产一概不出这个文件。
 */
import type { LedgerFile } from '../dailyDecision/ledger'
import { beijingStamp } from '../intake/store'
import type { ChainStore } from './store'
import type { BaseFile, Earning, Forecast, RunRecord, ShockFlag } from './types'
import type { Segment } from './universe'

export interface ViewRow {
  date: string
  close: number
  amount: number
  pct: number
  /** 当日主力净流入；这一天没有数据为 null */
  main: number | null
  /** 当日融资余额；还没公布或不是两融标的为 null */
  margin: number | null
}

export interface SeriesView {
  generatedAt: string
  /** 日线最新的已收盘交易日 */
  asOf: string | null
  /** 全市场融资余额最新一天 */
  marginAsOf: string | null
  segments: Segment[]
  stocks: Record<string, { name: string; rows: ViewRow[]; earning: Earning | null; forecast: Forecast | null }>
  marketMargin: { date: string; balance: number }[]
  flags: ShockFlag[]
  /** 缺什么，照实写 */
  gaps: string[]
  /** 每类拉数最近一次的记录 */
  lastRuns: RunRecord[]
}

export function seriesView(store: ChainStore, segments: Segment[], days: number, now = new Date()): SeriesView {
  const keep = Math.max(10, Math.min(days, 250))
  const { earnings, forecasts } = store.earnings()
  const stocks: SeriesView['stocks'] = {}
  const gaps: string[] = []
  const lastDates: string[] = []
  for (const code of segments.flatMap(s => s.codes)) {
    const s = store.series(code)
    if (!s || !s.bars.length) { gaps.push(`${code} 还没有日线`); continue }
    const flow = new Map(s.flow.map(r => [r.date, r.main]))
    const margin = new Map(s.margin.map(r => [r.date, r.balance]))
    stocks[code] = {
      name: s.name,
      rows: s.bars.slice(-keep).map(b => ({
        date: b.date, close: b.close, amount: b.amount, pct: b.pct, main: flow.get(b.date) ?? null, margin: margin.get(b.date) ?? null,
      })),
      earning: earnings[code] ?? null,
      forecast: forecasts[code] ?? null,
    }
    lastDates.push(s.bars[s.bars.length - 1]!.date)
  }
  const asOf = lastDates.sort().pop() ?? null
  for (const [code, s] of Object.entries(stocks)) {
    const last = s.rows[s.rows.length - 1]!
    if (asOf && last.date !== asOf) gaps.push(`${code} 日线停在 ${last.date}`)
    else if (last.main === null) gaps.push(`${code} 缺 ${last.date} 的主力净流入`)
  }
  const market = store.market().margin
  const latest = new Map<string, RunRecord>()
  for (const r of store.runs(200)) latest.set(r.task, r)
  return {
    generatedAt: beijingStamp(now),
    asOf,
    marginAsOf: market[market.length - 1]?.date ?? null,
    segments,
    stocks,
    marketMargin: market.slice(-keep).map(r => ({ date: r.date, balance: r.balance })),
    flags: store.flags().filter(f => !f.until || f.until >= beijingStamp(now).slice(0, 10)),
    gaps: gaps.sort(),
    lastRuns: [...latest.values()],
  }
}

export interface PortfolioView {
  generatedAt: string
  ledgerAsOf: string | null
  positions: { code: string; name: string; weight: number }[]
  /** 股票仓位、现金占比，小数 */
  stockWeight: number
  cashWeight: number
  /** 净值指数（基准 = 100）。基准没填或有持仓取不到价格时为 null */
  navIndex: number | null
  /** 基准以来到过的最高指数 */
  navHigh: number | null
  baseAt: string | null
  gaps: string[]
}

/**
 * 账本加价格 → 占比与净值指数。返回值里没有任何股数和金额。
 * newHigh：本次指数高于已记录的最高值时给出，由调用方写回 base.json。
 */
export function portfolioView(
  ledger: LedgerFile | null, prices: Readonly<Record<string, number | undefined>>, base: BaseFile | null, now = new Date(),
): { view: PortfolioView; newHigh: number | null } {
  const generatedAt = beijingStamp(now)
  const empty: PortfolioView = {
    generatedAt, ledgerAsOf: null, positions: [], stockWeight: 0, cashWeight: 0, navIndex: null, navHigh: base?.highIndex ?? null, baseAt: base?.at ?? null, gaps: [],
  }
  if (!ledger) return { view: { ...empty, gaps: ['还没有账本'] }, newHigh: null }
  const gaps: string[] = []
  const valued = ledger.positions.filter(p => p.quantity > 0).map(p => {
    const price = prices[p.code]
    if (!price) gaps.push(`${p.name} 取不到价格，占比按成本价估`)
    return { code: p.code, name: p.name, value: (price ?? p.cost ?? 0) * p.quantity }
  })
  const stocks = valued.reduce((s, p) => s + p.value, 0)
  const cash = ledger.cash + (ledger.externalCash ?? 0)
  const total = stocks + cash
  if (!(total > 0)) return { view: { ...empty, ledgerAsOf: ledger.asOf ?? null, gaps: ['账本总资产为 0'] }, newHigh: null }
  if (!base) gaps.push('净值基准还没填，指数算不出')
  const navIndex = base && base.totalAssets > 0 && gaps.every(g => !g.includes('取不到价格')) ? (total / base.totalAssets) * 100 : null
  const newHigh = navIndex !== null && base && navIndex > base.highIndex ? navIndex : null
  return {
    view: {
      generatedAt,
      ledgerAsOf: ledger.asOf ?? null,
      positions: valued.map(p => ({ code: p.code, name: p.name, weight: p.value / total })).sort((a, b) => b.weight - a.weight),
      stockWeight: stocks / total,
      cashWeight: cash / total,
      navIndex,
      navHigh: newHigh ?? base?.highIndex ?? null,
      baseAt: base?.at ?? null,
      gaps,
    },
    newHigh,
  }
}

export interface ChainStatus {
  generatedAt: string
  /** 日线最新的已收盘交易日 */
  lastClosed: string | null
  marginAsOf: string | null
  /** 名单里应有多少只、多少只有日线、日线最少的一只有多少个交易日（最多数到 250） */
  stocks: { expected: number; have: number; minBars: number | null }
  /** 两个脚本的读数各存到哪一天 */
  scripts: { mainline: string | null; scan: string | null }
  /** 净值基准填没填、哪个时点。金额不出 */
  base: { at: string; setAt: string } | null
  gaps: string[]
  lastRuns: { task: string; at: string; asOf: string | null; ok: number; failed: number }[]
}

/** 数据到了哪一步：发布后核对、页面「数据状态」用。只有日期和只数 */
export function statusView(store: ChainStore, segments: Segment[], now = new Date()): ChainStatus {
  const view = seriesView(store, segments, 250, now)
  const lengths = Object.values(view.stocks).map(s => s.rows.length)
  const base = store.base()
  const last = (kind: 'mainline' | 'scan'): string | null => store.scriptDates(kind).slice(-1)[0] ?? null
  return {
    generatedAt: view.generatedAt,
    lastClosed: view.asOf,
    marginAsOf: view.marginAsOf,
    stocks: { expected: segments.reduce((n, s) => n + s.codes.length, 0), have: lengths.length, minBars: lengths.length ? Math.min(...lengths) : null },
    scripts: { mainline: last('mainline'), scan: last('scan') },
    base: base ? { at: base.at, setAt: base.setAt } : null,
    gaps: view.gaps,
    lastRuns: view.lastRuns.map(r => ({ task: r.task, at: r.at, asOf: r.asOf, ok: r.ok, failed: r.failed.length })),
  }
}
