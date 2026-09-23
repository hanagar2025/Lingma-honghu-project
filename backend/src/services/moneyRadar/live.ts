/**
 * 资金驾驶舱（R-01）· 真实数据装载
 *
 * 把公开来源拼成一份按交易日对齐的 DataSet：
 *
 *   交易日与全市场成交额  上证指数 + 深证综指（腾讯日 K）
 *   个股成交额、价格      腾讯日 K（沪深全部，北交所不计入）
 *   申万二级行业          东方财富行业估值表
 *   个股融资余额          东方财富数据中心，按交易日全市场拉取
 *   龙虎榜机构            东方财富数据中心
 *   ETF 份额              上交所（沪市历史）+ 腾讯行情（沪深当日）
 *
 * 缺失规则：
 *   · 某只股票上市前的日子：个股对象为缺失；行业汇总时按 0 计（它当时不在行业里）；
 *   · 上市后腾讯不出行的日子按停牌处理：成交额 0，价格沿用前值；
 *   · 某只股票整只抓取失败：行业覆盖率下降；覆盖率低于 95% 的行业整体标缺失。
 */

import { MAINLINES } from '../msr/universe'
import { NATIONAL_TEAM_ETFS, WATCHLIST, holdingCodes } from './config'
import {
  fetchKline, fetchMarginByDate, fetchMarginTotal, fetchQuoteEtfShares, fetchSseEtfShares,
  fetchSwMembership, fetchTopInstByDate, inShSzUniverse, exchangeOf, runPool, stockKlineCached,
  readCache, writeCache, type KBar, type SwMember,
} from './fetch'
import type { DataKind, DataSet, EtfDay, InstDay, MarketDay, MoneyObject, StockDay, Availability } from './types'

export interface LiveOptions {
  days: number
  marginDays: number
  instDays: number
  etfDays: number
  concurrency: number
  log: (s: string) => void
}

export const DEFAULT_LIVE: Omit<LiveOptions, 'log'> = {
  days: 420,
  marginDays: 260,
  instDays: 60,
  etfDays: 260,
  concurrency: 10,
}

export interface IndustryInfo {
  id: string
  code: string
  name: string
  members: string[]
  coverage: number
  usable: boolean
}

export interface LiveResult {
  ds: DataSet
  industries: IndustryInfo[]
  names: Record<string, string>
  marketMargin: (number | null)[]
  coverage: { stocksWanted: number; stocksFetched: number; failed: string[] }
}

export const INDUSTRY_MIN_COVERAGE = 0.95

export function alignStock(code: string, bars: KBar[], dates: string[], margin: Record<string, Record<string, number> | null>): StockDay[] {
  const byDate = new Map(bars.map(b => [b.date, b]))
  const first = bars[0]?.date ?? null
  let lastClose: number | null = null
  return dates.map(date => {
    const b = byDate.get(date)
    const m = margin[date]
    const marginBalance = m ? (m[code] ?? null) : null
    if (b) {
      lastClose = b.close
      return { date, code, close: b.close, amount: b.amount, marginBalance }
    }
    if (first === null || date < first) return { date, code, close: null, amount: null, marginBalance }
    return { date, code, close: lastClose, amount: 0, marginBalance }
  })
}

export async function loadLiveDataSet(opt: LiveOptions): Promise<LiveResult> {
  const { log } = opt
  const provenance: DataSet['provenance'] = []
  const mark = (kind: DataKind, source: string, asOf: string, status: Availability) =>
    provenance.push({ kind, source, asOf, status })

  // ── 交易日与全市场成交额 ──
  log('· 两市成交额（上证指数 + 深证综指）')
  const [sh, sz] = await Promise.all([fetchKline('sh000001', opt.days), fetchKline('sz399106', opt.days)])
  const szMap = new Map(sz.map(b => [b.date, b]))
  const dates = sh.map(b => b.date).filter(d => szMap.has(d))
  const shMap = new Map(sh.map(b => [b.date, b]))
  const market: MarketDay[] = dates.map(date => ({
    date, totalAmount: shMap.get(date)!.amount + szMap.get(date)!.amount, marginTotal: null,
  }))
  const latest = dates.at(-1)!
  mark('MARKET_AMOUNT', '腾讯日K：上证指数+深证综指', latest, 'OK')

  // ── 申万二级行业成分 ──
  log('· 申万二级行业成分')
  let members: SwMember[] = []
  for (let i = dates.length - 1; i >= Math.max(0, dates.length - 5) && !members.length; i--) {
    members = await fetchSwMembership(dates[i]!)
  }
  mark('SW_INDUSTRY', '东方财富行业估值表（申万二级）', latest, members.length ? 'OK' : 'MISSING')
  const names: Record<string, string> = {}
  for (const m of members) names[m.code] = m.name

  // ── 需要抓 K 线的股票 ──
  const holdings = holdingCodes()
  for (const h of holdings) names[h.code] = h.name
  for (const w of WATCHLIST) names[w.code] = w.name
  for (const ml of MAINLINES) for (const m of ml.members) names[m.code] = m.name
  const wanted = [...new Set([
    ...members.map(m => m.code),
    ...holdings.map(h => h.code), ...WATCHLIST.map(w => w.code),
    ...MAINLINES.flatMap(ml => ml.members.map(m => m.code)),
  ])].filter(inShSzUniverse)

  log(`· 个股日 K：${wanted.length} 只（有缓存的只补增量）`)
  const bars: Record<string, KBar[]> = {}
  const { failed } = await runPool(wanted, opt.concurrency, async code => {
    const b = await stockKlineCached(code, opt.days, latest)
    if (b.length) bars[code] = b
    else throw new Error('empty')
  }, (d, n) => log(`    ${d}/${n}`))
  mark('STOCK_AMOUNT', '腾讯日K newfqkline', latest, failed.length ? 'OK' : 'OK')

  // ── 融资余额 ──
  const marginDates = dates.slice(-opt.marginDays)
  log(`· 个股融资余额：${marginDates.length} 个交易日（按日全市场拉取，已缓存的跳过）`)
  const margin: Record<string, Record<string, number> | null> = {}
  await runPool(marginDates, 4, async d => { margin[d] = await fetchMarginByDate(d) }, (d, n) => log(`    ${d}/${n}`))
  const marginLatest = [...marginDates].reverse().find(d => margin[d]) ?? null
  mark('MARGIN', '东方财富数据中心 RPTA_WEB_RZRQ_GGMX', marginLatest ?? '—', margin[latest] ? 'OK' : 'PENDING')

  let marginTotalMap: Record<string, number> = {}
  try { marginTotalMap = await fetchMarginTotal() } catch { log('    全市场两融汇总拉取失败，顶栏杠杆资金显示缺失') }
  const marketMargin = dates.map(d => marginTotalMap[d] ?? null)
  market.forEach((m, i) => { m.marginTotal = marketMargin[i] ?? null })

  // ── 龙虎榜机构 ──
  const instDates = dates.slice(-opt.instDays)
  log(`· 龙虎榜机构：${instDates.length} 个交易日`)
  const instByDate: Record<string, Record<string, number>> = {}
  await runPool(instDates, 4, async d => { instByDate[d] = await fetchTopInstByDate(d) })
  mark('TOP_INST', '东方财富数据中心 RPT_ORGANIZATION_TRADE_DETAILS', instDates.at(-1) ?? '—', 'OK')

  // ── 个股序列 ──
  const stocks: Record<string, StockDay[]> = {}
  for (const code of Object.keys(bars)) stocks[code] = alignStock(code, bars[code]!, dates, margin)

  const inst: Record<string, InstDay[]> = {}
  const instSet = new Set(instDates)
  for (const code of Object.keys(stocks)) {
    inst[code] = dates.map(date => ({
      date, code, netBuy: instSet.has(date) ? (instByDate[date]?.[code] ?? null) : null,
    }))
  }

  // ── ETF：国家队宽基 ──
  const etfCodes = NATIONAL_TEAM_ETFS.map(e => e.code)
  log(`· 国家队 ETF：${etfCodes.length} 只（沪市份额有历史，深市份额只有当日值）`)
  const etfBars: Record<string, KBar[]> = {}
  await runPool(etfCodes, 6, async c => { etfBars[c] = await fetchKline(`${exchangeOf(c)}${c}`, opt.days) })
  const etfDates = dates.slice(-opt.etfDays)
  const sse: Record<string, Record<string, number> | null> = {}
  await runPool(etfDates, 4, async d => { sse[d] = await fetchSseEtfShares(d) })
  let quote: Record<string, { share: number; close: number }> = {}
  try { quote = await fetchQuoteEtfShares(etfCodes) } catch { log('    腾讯 ETF 当日份额拉取失败') }
  // 深市 ETF 没有历史来源：把腾讯当日份额按日期存档，逐日积累
  const szArchive = readCache<Record<string, Record<string, number>>>('etf-sz-archive.json') ?? {}
  szArchive[latest] = Object.fromEntries(Object.entries(quote).filter(([c]) => exchangeOf(c) === 'sz').map(([c, v]) => [c, v.share]))
  writeCache(szArchive, 'etf-sz-archive.json')

  const etfs: Record<string, EtfDay[]> = {}
  for (const code of etfCodes) {
    const closeBy = new Map((etfBars[code] ?? []).map(b => [b.date, b.close]))
    etfs[code] = dates.map(date => {
      const fromSse = sse[date]?.[code]
      const fromArchive = szArchive[date]?.[code]
      const share = exchangeOf(code) === 'sh' ? (fromSse ?? null) : (fromArchive ?? null)
      return { date, code, share, close: closeBy.get(date) ?? null }
    })
  }
  mark('ETF_SHARE', '上交所 commonQuery（沪市）+ 腾讯行情（深市当日，逐日存档）', latest,
    sse[latest] ? 'OK' : 'PENDING')

  // ── 行业汇总 ──
  log('· 汇总申万二级行业')
  const byBoard = new Map<string, { name: string; codes: string[] }>()
  for (const m of members) {
    if (!inShSzUniverse(m.code)) continue
    const g = byBoard.get(m.boardCode) ?? { name: m.boardName, codes: [] }
    g.codes.push(m.code)
    byBoard.set(m.boardCode, g)
  }
  const aggregates: Record<string, StockDay[]> = {}
  const industries: IndustryInfo[] = []
  for (const [code, g] of byBoard) {
    const have = g.codes.filter(c => stocks[c])
    const coverage = g.codes.length ? have.length / g.codes.length : 0
    const id = `industry:${code}`
    const usable = coverage >= INDUSTRY_MIN_COVERAGE && have.length >= 3
    industries.push({ id, code, name: g.name, members: g.codes, coverage, usable })
    if (!usable) continue
    let index = 100
    aggregates[id] = dates.map((date, t) => {
      let amount = 0
      let marginSum: number | null = margin[date] ? 0 : null
      const rets: number[] = []
      for (const c of have) {
        const d = stocks[c]![t]!
        amount += d.amount ?? 0
        if (marginSum !== null && d.marginBalance !== null) marginSum += d.marginBalance
        const prev = t > 0 ? stocks[c]![t - 1]!.close : null
        if (d.close !== null && prev !== null && prev > 0 && (d.amount ?? 0) > 0) rets.push(d.close / prev - 1)
      }
      if (t > 0 && rets.length) index *= 1 + rets.reduce((a, b) => a + b, 0) / rets.length
      return { date, code: id, close: index, amount, marginBalance: marginSum }
    })
  }

  return {
    ds: { dates, market, stocks, etfs, inst, aggregates, provenance },
    industries,
    names,
    marketMargin,
    coverage: { stocksWanted: wanted.length, stocksFetched: Object.keys(bars).length, failed },
  }
}

/** 入口③ 的行业对象 */
export function industryObjects(industries: readonly IndustryInfo[]): (MoneyObject & { entry: 3 })[] {
  return industries.filter(i => i.usable).map(i => ({
    id: i.id, name: i.name, kind: 'INDUSTRY' as const, entry: 3 as const, codes: i.members, themeEtfs: [],
  }))
}
