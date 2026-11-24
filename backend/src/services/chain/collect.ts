/**
 * 固定拉数。四件事，各自独立，哪一件失败都不影响别的：
 *
 *   collectDaily     日线与主力净流入（收盘后定稿）
 *   collectMargin    个股与全市场融资余额（上一交易日的，次日早间才公布）
 *   collectIntraday  盘中快照：现价、成交额、当日主力净流入
 *   collectEarnings  业绩与业绩预告
 *
 * 只把已收盘的交易日写进日线：15:05 之前，当天那一根是实时价，去掉。
 * 每次拉数在 runs.jsonl 留一行：拉到哪一天、成功几只、缺哪几只。
 */
import { beijingStamp } from '../intake/store'
import { emBars, emEarnings, emFlow, emForecasts, emMargin, emMarketMargin, emQuotes, tencentQuotes, type SourceOptions } from './sources'
import type { ChainStore } from './store'
import type { RunRecord } from './types'

export interface CollectOptions extends SourceOptions {
  now?: Date
  /** 首次拉取或补历史时取多少根；平时只取最近一段 */
  backfill?: boolean
  concurrency?: number
}

/** 两源最新收盘价允许的差。超过就记进 notes，由汇总照实写出 */
const PRICE_TOLERANCE = 0.002

async function pool<T>(items: readonly T[], limit: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await work(items[next++]!)
  }))
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/** 日线里今天那一根在收盘前是实时价 */
function closedOnly<T extends { date: string }>(rows: T[], now: Date): T[] {
  const bj = beijingStamp(now)
  const last = rows[rows.length - 1]
  return last && last.date === bj.slice(0, 10) && bj.slice(11, 16) < '15:05' ? rows.slice(0, -1) : rows
}

function finish(store: ChainStore, task: string, now: Date, asOf: string | null, ok: number, failed: string[], notes: string[]): RunRecord {
  const record: RunRecord = { task, at: beijingStamp(now), asOf, ok, failed: failed.sort(), notes }
  store.logRun(record)
  return record
}

export async function collectDaily(store: ChainStore, codes: readonly string[], opts: CollectOptions = {}): Promise<RunRecord> {
  const now = opts.now ?? new Date()
  const failed: string[] = []
  const notes: string[] = []
  const lastDates: string[] = []
  let ok = 0
  await pool(codes, opts.concurrency ?? 6, async code => {
    const have = store.series(code)
    const count = opts.backfill || !have || have.bars.length < 70 ? 130 : 30
    let got = false
    try {
      const { name, bars } = await emBars(code, count, opts)
      const closed = closedOnly(bars, now)
      store.mergeSeries(code, { name, bars: closed }, now)
      const last = closed[closed.length - 1]
      if (last) lastDates.push(last.date)
      got = true
    } catch (e) {
      failed.push(`${code} 日线（${message(e)}）`)
    }
    try {
      store.mergeSeries(code, { flow: closedOnly(await emFlow(code, opts), now) }, now)
    } catch (e) {
      got = false
      failed.push(`${code} 主力净流入（${message(e)}）`)
    }
    if (got) ok++
  })
  const asOf = lastDates.sort().pop() ?? null

  // 第二来源核对最新收盘价。只在腾讯报的也是同一天时比
  if (asOf) {
    try {
      const second = await tencentQuotes(codes, opts)
      for (const code of codes) {
        const bar = store.series(code)?.bars.slice(-1)[0]
        const q = second[code]
        if (!bar || bar.date !== asOf) continue
        // 盘中补数时腾讯报的已经是今天的实时价，和昨天的收盘价没法比
        if (q && q.date > asOf) continue
        if (!q || q.date !== asOf) { notes.push(`${code} 收盘价没有第二来源`); continue }
        if (Math.abs(q.price - bar.close) > Math.max(0.011, PRICE_TOLERANCE * bar.close)) notes.push(`${code} 收盘价两源不一致`)
      }
    } catch (e) {
      notes.push(`收盘价第二来源取不到（${message(e)}）`)
    }
  }
  return finish(store, 'daily', now, asOf, ok, failed, notes)
}

export async function collectMargin(store: ChainStore, codes: readonly string[], opts: CollectOptions = {}): Promise<RunRecord> {
  const now = opts.now ?? new Date()
  const failed: string[] = []
  const notes: string[] = []
  let ok = 0
  let asOf: string | null = null
  try {
    const market = store.mergeMarketMargin(await emMarketMargin(opts.backfill || store.market().margin.length < 30 ? 150 : 30, opts), now)
    asOf = market.margin[market.margin.length - 1]?.date ?? null
  } catch (e) {
    failed.push(`全市场融资（${message(e)}）`)
  }
  await pool(codes, opts.concurrency ?? 6, async code => {
    try {
      const have = store.series(code)
      const rows = await emMargin(code, opts.backfill || !have || have.margin.length < 30 ? 150 : 30, opts)
      if (rows.length) store.mergeSeries(code, { margin: rows }, now)
      else notes.push(`${code} 没有融资数据（不是两融标的）`)
      ok++
    } catch (e) {
      failed.push(`${code} 融资余额（${message(e)}）`)
    }
  })
  return finish(store, 'margin', now, asOf, ok, failed, notes)
}

export async function collectIntraday(store: ChainStore, codes: readonly string[], opts: CollectOptions = {}): Promise<RunRecord> {
  const now = opts.now ?? new Date()
  const at = beijingStamp(now)
  try {
    const { quotes, sourceAt, host } = await emQuotes(codes, opts)
    const failed = codes.filter(c => !quotes[c]).map(c => `${c} 盘中行情`)
    store.addIntraday(at.slice(0, 10), { at, sourceAt, quotes, failed })
    return finish(store, 'intraday', now, at.slice(0, 10), Object.keys(quotes).length, failed, [`入口 ${host}，行情时刻 ${sourceAt ?? '未知'}`])
  } catch (e) {
    return finish(store, 'intraday', now, null, 0, [`盘中行情（${message(e)}）`], [])
  }
}

export async function collectEarnings(store: ChainStore, codes: readonly string[], opts: CollectOptions = {}): Promise<RunRecord> {
  const now = opts.now ?? new Date()
  const have = store.earnings()
  const failed: string[] = []
  let earnings = have.earnings
  let forecasts = have.forecasts
  try { earnings = { ...earnings, ...(await emEarnings(codes, opts)) } } catch (e) { failed.push(`业绩报表（${message(e)}）`) }
  try { forecasts = { ...forecasts, ...(await emForecasts(codes, opts)) } } catch (e) { failed.push(`业绩预告（${message(e)}）`) }
  store.saveEarnings({ earnings, forecasts, updatedAt: beijingStamp(now) })
  const missing = codes.filter(c => !earnings[c])
  const reports = Object.values(earnings).map(e => e.report).sort()
  return finish(store, 'earnings', now, reports[reports.length - 1] ?? null, codes.length - missing.length, failed,
    missing.length ? [`没有业绩报表：${missing.join('、')}`] : [])
}

/** 财报期每天拉业绩，其余时间每周一拉一次 */
export function earningsDue(now: Date): boolean {
  const bj = new Date(now.getTime() + 8 * 3600_000)
  const month = bj.getUTCMonth() + 1
  return [1, 2, 3, 4, 7, 8, 10].includes(month) || bj.getUTCDay() === 1
}
