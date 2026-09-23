/**
 * 资金驾驶舱（R-01）· 公开数据抓取
 *
 * 2026-09-23 在本系统运行环境实测可用的来源：
 *
 *   腾讯日 K newfqkline      个股 / 指数：收盘价、成交额（万元），可回溯 800 日
 *   腾讯实时行情 qt.gtimg.cn  ETF 当日总份额（第 72 字段，单位份），沪深都有
 *   上交所 commonQuery        沪市 ETF 每日份额（万份），有历史
 *   东方财富数据中心          申万二级行业成分（行业估值表）、个股融资余额（按日全市场）、
 *                             全市场两融汇总、龙虎榜机构明细
 *
 * 不可用：东方财富 push2 行情接口（被拒）、深交所官网、申万官网（均连不上）。
 * 所以深市 ETF 份额只有当日值，历史从接入之日起每日存档积累。
 *
 * 一切结果先落本地缓存，重跑只补缺的部分。缓存不入库。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
export const CACHE_DIR = process.env.MONEY_CACHE_DIR ?? join(HERE, 'data', 'cache')

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36'
const DC = 'https://datacenter-web.eastmoney.com/api/data/v1/get'

function cachePath(...parts: string[]): string {
  const p = join(CACHE_DIR, ...parts)
  mkdirSync(dirname(p), { recursive: true })
  return p
}

export function readCache<T>(...parts: string[]): T | null {
  const p = join(CACHE_DIR, ...parts)
  if (!existsSync(p)) return null
  try { return JSON.parse(readFileSync(p, 'utf-8')) as T } catch { return null }
}

export function writeCache(value: unknown, ...parts: string[]): void {
  writeFileSync(cachePath(...parts), JSON.stringify(value), 'utf-8')
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

async function httpText(url: string, headers: Record<string, string> = {}, retries = 3): Promise<string> {
  let last: unknown
  for (let i = 0; i <= retries; i++) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 20_000)
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, ...headers }, signal: ctrl.signal })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return await res.text()
    } catch (e) {
      last = e
      await sleep(500 * 2 ** i)
    } finally {
      clearTimeout(timer)
    }
  }
  throw new Error(`请求失败 ${url.slice(0, 120)}：${String(last)}`)
}

async function httpJson<T>(url: string, headers: Record<string, string> = {}): Promise<T> {
  return JSON.parse(await httpText(url, headers)) as T
}

/** 限并发地跑一批任务。单个任务失败不拖垮整批，失败的记下来 */
export async function runPool<T>(
  items: readonly T[], concurrency: number, fn: (x: T) => Promise<void>,
  onProgress?: (done: number, total: number) => void,
): Promise<{ failed: T[] }> {
  const failed: T[] = []
  let next = 0
  let done = 0
  const worker = async () => {
    while (next < items.length) {
      const x = items[next++]!
      try { await fn(x) } catch { failed.push(x) }
      done++
      if (onProgress && (done % 200 === 0 || done === items.length)) onProgress(done, items.length)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker))
  return { failed }
}

// ─────────────────────────── 代码与市场 ───────────────────────────

export type Exchange = 'sh' | 'sz' | 'bj'

export function exchangeOf(code: string): Exchange {
  if (/^(4|8|92)/.test(code)) return 'bj'
  if (/^(5|6|9)/.test(code)) return 'sh'
  return 'sz'
}

/** 北交所不在"上证指数 + 深证综指"的两市总成交额里，为口径一致不纳入份额计算 */
export function inShSzUniverse(code: string): boolean {
  return exchangeOf(code) !== 'bj'
}

// ─────────────────────────── 腾讯日 K ───────────────────────────

export interface KBar { date: string; close: number; amount: number }

/** 腾讯前复权日 K。成交额字段单位万元，这里换算成元。停牌日腾讯不出行 */
export async function fetchKline(symbol: string, days: number): Promise<KBar[]> {
  const url = `https://web.ifzq.gtimg.cn/appstock/app/newfqkline/get?param=${symbol},day,,,${days},qfq`
  const j = await httpJson<{ data?: Record<string, { qfqday?: unknown[][]; day?: unknown[][] }> }>(
    url, { Referer: 'https://gu.qq.com/' })
  const node = j.data?.[symbol]
  const rows = node?.qfqday ?? node?.day ?? []
  return rows
    .filter(r => Array.isArray(r) && r.length >= 9)
    .map(r => ({ date: String(r[0]), close: Number(r[2]), amount: Number(r[8]) * 1e4 }))
    .filter(b => Number.isFinite(b.close) && Number.isFinite(b.amount))
}

/**
 * 个股 K 线，带缓存增量更新：缓存已到最新交易日则直接用；
 * 否则只补最近一段并与缓存合并。
 */
/** 缓存记下当初请求过多少日：新股历史本来就短，不能靠条数判断"够不够长" */
interface KlineCache { days: number; bars: KBar[] }

export async function stockKlineCached(code: string, days: number, latestDate: string): Promise<KBar[]> {
  const raw = readCache<KlineCache | KBar[]>('kline', `${code}.json`)
  const cached: KlineCache | null = raw === null ? null
    : Array.isArray(raw) ? { days: raw.length, bars: raw } : raw
  const longEnough = !!cached && cached.days >= days
  if (cached && longEnough && cached.bars.length && cached.bars.at(-1)!.date >= latestDate) return cached.bars
  const sym = `${exchangeOf(code)}${code}`
  const fresh = await fetchKline(sym, longEnough ? 30 : days)
  const merged = new Map<string, KBar>()
  for (const b of cached?.bars ?? []) merged.set(b.date, b)
  for (const b of fresh) merged.set(b.date, b)
  const bars = [...merged.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-days)
  writeCache({ days: Math.max(days, cached?.days ?? 0), bars } satisfies KlineCache, 'kline', `${code}.json`)
  return bars
}

// ─────────────────────────── 东方财富数据中心 ───────────────────────────

interface DcResp<T> { result: { data: T[]; pages: number; count: number } | null; success: boolean }

async function dcAll<T>(report: string, columns: string, filter: string, sort = ''): Promise<T[]> {
  const out: T[] = []
  for (let page = 1; page < 200; page++) {
    const url = `${DC}?reportName=${report}&columns=${columns}&pageSize=500&pageNumber=${page}`
      + `&filter=${encodeURIComponent(filter)}${sort}`
    const j = await httpJson<DcResp<T>>(url)
    if (!j.result) break
    out.push(...j.result.data)
    if (page >= j.result.pages) break
  }
  return out
}

export interface SwMember { code: string; name: string; boardCode: string; boardName: string; marketCap: number | null }

/** 申万二级行业成分（取自东方财富行业估值表）。按最新交易日取全市场 */
export async function fetchSwMembership(date: string): Promise<SwMember[]> {
  const cached = readCache<SwMember[]>('sw', `${date}.json`)
  if (cached?.length) return cached
  const rows = await dcAll<{ SECURITY_CODE: string; SECURITY_NAME_ABBR: string; BOARD_CODE: string; BOARD_NAME: string; TOTAL_MARKET_CAP: number | null }>(
    'RPT_VALUEANALYSIS_DET', 'SECURITY_CODE,SECURITY_NAME_ABBR,BOARD_CODE,BOARD_NAME,TOTAL_MARKET_CAP',
    `(TRADE_DATE='${date}')`)
  const out = rows.map(r => ({
    code: r.SECURITY_CODE, name: r.SECURITY_NAME_ABBR, boardCode: r.BOARD_CODE,
    boardName: r.BOARD_NAME, marketCap: r.TOTAL_MARKET_CAP ?? null,
  }))
  if (out.length) writeCache(out, 'sw', `${date}.json`)
  return out
}

/** 某交易日全市场个股融资余额（元）。空结果视为当日未发布，不写缓存 */
export async function fetchMarginByDate(date: string): Promise<Record<string, number> | null> {
  const cached = readCache<Record<string, number>>('margin', `${date}.json`)
  if (cached) return cached
  const rows = await dcAll<{ SCODE: string; RZYE: number | null }>('RPTA_WEB_RZRQ_GGMX', 'SCODE,RZYE', `(DATE='${date}')`)
  if (!rows.length) return null
  const out: Record<string, number> = {}
  for (const r of rows) if (r.RZYE !== null) out[r.SCODE] = r.RZYE
  writeCache(out, 'margin', `${date}.json`)
  return out
}

/** 全市场融资余额历史（元） */
export async function fetchMarginTotal(): Promise<Record<string, number>> {
  const rows = await dcAll<{ DIM_DATE: string; RZYE: number }>(
    'RPTA_RZRQ_LSHJ', 'DIM_DATE,RZYE', '(DIM_DATE>=\'2023-01-01\')', '&sortColumns=DIM_DATE&sortTypes=1')
  const out: Record<string, number> = {}
  for (const r of rows) out[r.DIM_DATE.slice(0, 10)] = r.RZYE
  return out
}

/** 某交易日龙虎榜机构席位净买入（元），按股票汇总 */
export async function fetchTopInstByDate(date: string): Promise<Record<string, number>> {
  const cached = readCache<Record<string, number>>('topinst', `${date}.json`)
  if (cached) return cached
  const rows = await dcAll<{ SECURITY_CODE: string; NET_BUY_AMT: number | null }>(
    'RPT_ORGANIZATION_TRADE_DETAILS', 'SECURITY_CODE,NET_BUY_AMT', `(TRADE_DATE='${date}')`)
  const out: Record<string, number> = {}
  for (const r of rows) if (r.NET_BUY_AMT !== null) out[r.SECURITY_CODE] = (out[r.SECURITY_CODE] ?? 0) + r.NET_BUY_AMT
  writeCache(out, 'topinst', `${date}.json`)
  return out
}

// ─────────────────────────── ETF 份额 ───────────────────────────

/** 上交所某交易日全部 ETF 份额（份）。空结果视为当日未发布，不写缓存 */
export async function fetchSseEtfShares(date: string): Promise<Record<string, number> | null> {
  const cached = readCache<Record<string, number>>('etf-sse', `${date}.json`)
  if (cached) return cached
  const url = 'https://query.sse.com.cn/commonQuery.do?isPagination=true&pageHelp.pageSize=1000&pageHelp.pageNo=1'
    + `&sqlId=COMMON_SSE_ZQPZ_ETFZL_XXPL_ETFGM_SEARCH_L&STAT_DATE=${date}`
  const j = await httpJson<{ pageHelp?: { data?: { SEC_CODE: string; TOT_VOL: string }[] } }>(
    url, { Referer: 'https://www.sse.com.cn/' })
  const rows = j.pageHelp?.data ?? []
  if (!rows.length) return null
  const out: Record<string, number> = {}
  for (const r of rows) {
    const v = Number(r.TOT_VOL)
    if (Number.isFinite(v)) out[r.SEC_CODE] = v * 1e4
  }
  writeCache(out, 'etf-sse', `${date}.json`)
  return out
}

/** 腾讯实时行情里的 ETF 当日总份额（份）与收盘价。沪深都有，只有当日值 */
export async function fetchQuoteEtfShares(codes: readonly string[]): Promise<Record<string, { share: number; close: number }>> {
  const out: Record<string, { share: number; close: number }> = {}
  const syms = codes.map(c => `${exchangeOf(c)}${c}`)
  for (let i = 0; i < syms.length; i += 50) {
    const url = `https://qt.gtimg.cn/q=${syms.slice(i, i + 50).join(',')}`
    const text = await httpText(url, { Referer: 'https://gu.qq.com/' })
    for (const line of text.split(';')) {
      const f = line.split('~')
      if (f.length < 74) continue
      const share = Number(f[72])
      const close = Number(f[3])
      if (Number.isFinite(share) && share > 0 && Number.isFinite(close)) out[f[2]!] = { share, close }
    }
  }
  return out
}
