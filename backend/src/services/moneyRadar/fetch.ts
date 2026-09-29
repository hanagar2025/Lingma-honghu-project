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

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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

async function httpBuffer(url: string, headers: Record<string, string> = {}, retries = 3): Promise<ArrayBuffer> {
  let last: unknown
  for (let i = 0; i <= retries; i++) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 20_000)
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, ...headers }, signal: ctrl.signal })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return await res.arrayBuffer()
    } catch (e) {
      last = e
      await sleep(500 * 2 ** i)
    } finally {
      clearTimeout(timer)
    }
  }
  throw new Error(`请求失败 ${url.slice(0, 120)}：${String(last)}`)
}

const DAY_MS = 86_400_000

/** 缓存是否在 maxAgeDays 天内抓过 */
function fresh(fetchedAt: string | undefined, maxAgeDays: number): boolean {
  return !!fetchedAt && Date.now() - new Date(fetchedAt).getTime() < maxAgeDays * DAY_MS
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

export type Fq = 'qfq' | 'raw'

/** 腾讯日 K，默认前复权；raw = 不复权。成交额字段单位万元，这里换算成元。停牌日腾讯不出行 */
export async function fetchKline(symbol: string, days: number, fq: Fq = 'qfq'): Promise<KBar[]> {
  const url = `https://web.ifzq.gtimg.cn/appstock/app/newfqkline/get?param=${symbol},day,,,${days},${fq === 'qfq' ? 'qfq' : ''}`
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
/** 北京时间的日期与 HHMM */
export function beijingClock(at = new Date()): { date: string; hhmm: number } {
  const bj = new Date(at.getTime() + 8 * 3600_000)
  return { date: bj.toISOString().slice(0, 10), hhmm: bj.getUTCHours() * 100 + bj.getUTCMinutes() }
}

/** 当日 K 线定稿时刻：科创板盘后固定价格交易到 15:30，16:30 后成交额才完整 */
export const KLINE_FINAL_HHMM = 1630

/**
 * 缓存里最后一根 K 线是不是定稿的。
 * 盘中抓到的当日 K 线是半截数据；若把它当成"已是最新日期"，收盘后就再也不会重抓 ——
 * 这一天的成交额会永远停在盘中那一刻。
 */
export function lastBarFinal(lastDate: string, fetchedAt: string | undefined): boolean {
  if (!fetchedAt) return false
  const f = beijingClock(new Date(fetchedAt))
  return lastDate < f.date || (lastDate === f.date && f.hhmm >= KLINE_FINAL_HHMM)
}

/** 缓存记下当初请求过多少日（新股历史本来就短，不能靠条数判断"够不够长"）与抓取时刻 */
export interface KlineCache { days: number; bars: KBar[]; fetchedAt?: string }

/**
 * 前复权价在每次除权除息后会把全部历史重新缩放；增量抓来的最近 30 根和缓存里的旧历史就不在同一把尺子上了，
 * 拼在一起会在除权日凭空多出一段涨跌（送转股时是腰斩）。所以拿重叠日比对：对不上就整段重抓。
 * 缓存里最后一根如果不是定稿（盘中抓的），不参与比对。
 */
export function klineDrifted(cached: KlineCache, fresh: readonly KBar[]): boolean {
  const lastFinal = lastBarFinal(cached.bars.at(-1)?.date ?? '', cached.fetchedAt)
  const lastDate = cached.bars.at(-1)?.date
  const old = new Map(cached.bars.map(b => [b.date, b.close]))
  return fresh.some(b => {
    if (!lastFinal && b.date === lastDate) return false
    const o = old.get(b.date)
    return o !== undefined && o > 0 && Math.abs(b.close / o - 1) > 1e-3
  })
}

export async function stockKlineCached(code: string, days: number, latestDate: string, fq: Fq = 'qfq'): Promise<KBar[]> {
  const dir = fq === 'qfq' ? 'kline' : 'kline-raw'
  const raw = readCache<KlineCache | KBar[]>(dir, `${code}.json`)
  const cached: KlineCache | null = raw === null ? null
    : Array.isArray(raw) ? { days: raw.length, bars: raw } : raw
  const longEnough = !!cached && cached.days >= days
  const last = cached?.bars.at(-1)?.date ?? ''
  if (cached && longEnough && last >= latestDate && lastBarFinal(last, cached.fetchedAt)) return cached.bars
  const sym = `${exchangeOf(code)}${code}`
  let fresh = await fetchKline(sym, longEnough ? 30 : days, fq)
  let base = cached?.bars ?? []
  if (cached && longEnough && fq === 'qfq' && klineDrifted(cached, fresh)) {
    fresh = await fetchKline(sym, days, fq)
    base = []
  }
  const merged = new Map<string, KBar>()
  for (const b of base) merged.set(b.date, b)
  for (const b of fresh) merged.set(b.date, b)
  const bars = [...merged.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-days)
  writeCache({ days: Math.max(days, cached?.days ?? 0), bars, fetchedAt: new Date().toISOString() } satisfies KlineCache, dir, `${code}.json`)
  return bars
}

// ─────────────────────────── 东方财富数据中心 ───────────────────────────

interface DcResp<T> { result: { data: T[]; pages: number; count: number } | null; success: boolean }

async function dcAll<T>(report: string, columns: string, filter: string, sort = ''): Promise<T[]> {
  const out: T[] = []
  for (let page = 1; page < 200; page++) {
    const url = `${DC}?reportName=${report}&columns=${columns}&pageSize=500&pageNumber=${page}`
      + (filter ? `&filter=${encodeURIComponent(filter)}` : '') + sort
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

/**
 * 某日两融明细是否发布完整。沪深北三所分开发布，节假日前后常见"沪市已出、深市未出"：
 * 只拿到半截时，行业融资余额会凭空"下降一半"。按交易所比对行数，任一所不到参照日的 80% 即视为未发布完。
 */
export function marginDayComplete(cur: Record<string, number>, ref: Record<string, number>): { ok: boolean; missing: Exchange[] } {
  const count = (m: Record<string, number>) => {
    const c: Record<Exchange, number> = { sh: 0, sz: 0, bj: 0 }
    for (const k of Object.keys(m)) c[exchangeOf(k)]++
    return c
  }
  const a = count(cur)
  const b = count(ref)
  const missing = (['sh', 'sz', 'bj'] as const).filter(x => b[x] > 0 && a[x] < 0.8 * b[x])
  return { ok: missing.length === 0, missing }
}

export function dropCache(...parts: string[]): void {
  const p = join(CACHE_DIR, ...parts)
  if (existsSync(p)) rmSync(p)
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
  // 龙虎榜当日晚间才发布完整；19:30 之前抓到的当日结果不写缓存，免得把"还没发布"永久记成"没有上榜"
  const now = beijingClock()
  if (date < now.date || now.hhmm >= 1930) writeCache(out, 'topinst', `${date}.json`)
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

// ─────────────────────────── 慢钱：指数权重、ETF 名称、机构持仓、股东户数 ───────────────────────────

export interface IndexWeights { index: string; name: string; date: string; weights: Record<string, number>; fetchedAt: string }

/** 中证指数官网月末权重（xls）。权重单位 %，只有最近一个月末，没有历史 */
export async function fetchIndexWeights(index: string): Promise<IndexWeights | null> {
  const cached = readCache<IndexWeights>('csindex', `${index}.json`)
  if (cached && fresh(cached.fetchedAt, 7)) return cached
  try {
    const XLSX = await import('xlsx')
    const buf = await httpBuffer(`https://oss-ch.csindex.com.cn/static/html/csindex/public/uploads/file/autofile/closeweight/${index}closeweight.xls`)
    const wb = XLSX.read(new Uint8Array(buf))
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]!]!, { header: 1 })
    const weights: Record<string, number> = {}
    let date = ''
    let name = ''
    for (const r of rows.slice(1)) {
      const code = String(r[4] ?? '').padStart(6, '0')
      const w = Number(r[9])
      if (!/^\d{6}$/.test(code) || !Number.isFinite(w)) continue
      weights[code] = w
      date = String(r[0] ?? '')
      name = String(r[2] ?? '')
    }
    if (!Object.keys(weights).length) return cached
    const out: IndexWeights = {
      index, name, date: `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`, weights, fetchedAt: new Date().toISOString(),
    }
    writeCache(out, 'csindex', `${index}.json`)
    return out
  } catch {
    return cached
  }
}

/** ETF 简称（腾讯行情第 1 字段，GBK 编码）。一周刷新一次 */
export async function fetchSecurityNames(codes: readonly string[]): Promise<Record<string, string>> {
  const cached = readCache<{ fetchedAt: string; names: Record<string, string> }>('security-names.json')
  const names: Record<string, string> = { ...(cached?.names ?? {}) }
  const want = fresh(cached?.fetchedAt, 7) ? codes.filter(c => !names[c]) : [...codes]
  const dec = new TextDecoder('gbk')
  for (let i = 0; i < want.length; i += 60) {
    const syms = want.slice(i, i + 60).map(c => `${exchangeOf(c)}${c}`)
    const text = dec.decode(await httpBuffer(`https://qt.gtimg.cn/q=${syms.join(',')}`, { Referer: 'https://gu.qq.com/' }))
    for (const line of text.split(';')) {
      const f = line.split('~')
      if (f.length > 2 && f[1] && f[2]) names[f[2]] = f[1]
    }
  }
  if (want.length) writeCache({ fetchedAt: new Date().toISOString(), names }, 'security-names.json')
  return names
}

export interface OrgHoldRow { code: string; ratio: number | null; holders: number | null; value: number | null }

/**
 * 某报告期全市场机构持仓（东方财富数据中心 RPT_MAIN_ORGHOLD）。
 * orgType：00 机构合计，01 基金。ratio = 占流通股比例（%）。
 * 一季报、三季报的基金持仓只含前十大重仓，中报、年报才是全部持仓 —— 由调用方标注。
 * 报告期结束 5 个月后视为披露完毕才写永久缓存；之前每天重抓。
 */
export async function fetchOrgHold(reportDate: string, orgType: '00' | '01'): Promise<OrgHoldRow[]> {
  const key = `${reportDate}-${orgType}.json`
  const cached = readCache<{ final: boolean; rows: OrgHoldRow[]; fetchedAt?: string }>('orghold', key)
  if (cached && (cached.final || fresh(cached.fetchedAt, 1))) return cached.rows
  const rows = await dcAll<{ SECURITY_CODE: string; FREESHARES_RATIO: number | null; HOULD_NUM: number | null; HOLD_VALUE: number | null }>(
    'RPT_MAIN_ORGHOLD', 'SECURITY_CODE,FREESHARES_RATIO,HOULD_NUM,HOLD_VALUE',
    `(REPORT_DATE='${reportDate}')(ORG_TYPE="${orgType}")`)
  const out = rows.map(r => ({ code: r.SECURITY_CODE, ratio: r.FREESHARES_RATIO, holders: r.HOULD_NUM, value: r.HOLD_VALUE }))
  const final = Date.now() - new Date(reportDate).getTime() > 150 * DAY_MS
  if (out.length) writeCache({ final, rows: out, fetchedAt: new Date().toISOString() }, 'orghold', key)
  return out
}

export interface HolderNumRow { code: string; holders: number; ratio: number | null; endDate: string; noticeDate: string; prevEndDate?: string | null }

/**
 * 全市场每只股票最近一次披露的股东户数（RPT_HOLDERNUMLATEST），不限季末：
 * 不少公司在互动平台、临时公告里按旬 / 按月披露。带截止日、上期截止日和公告日。每天刷新一次。
 */
export async function fetchHolderNumLatest(): Promise<Record<string, HolderNumRow>> {
  const cached = readCache<{ fetchedAt: string; rows: Record<string, HolderNumRow> }>('holdernum-latest.json')
  if (cached && fresh(cached.fetchedAt, 0.5)) return cached.rows
  const rows = await dcAll<{ SECURITY_CODE: string; HOLDER_NUM: number | null; HOLDER_NUM_RATIO: number | null; END_DATE: string; PRE_END_DATE: string | null; HOLD_NOTICE_DATE: string | null }>(
    'RPT_HOLDERNUMLATEST', 'SECURITY_CODE,HOLDER_NUM,HOLDER_NUM_RATIO,END_DATE,PRE_END_DATE,HOLD_NOTICE_DATE', '')
  const out: Record<string, HolderNumRow> = {}
  for (const r of rows) {
    if (r.HOLDER_NUM === null || !r.HOLD_NOTICE_DATE) continue
    out[r.SECURITY_CODE] = {
      code: r.SECURITY_CODE, holders: r.HOLDER_NUM, ratio: r.HOLDER_NUM_RATIO,
      endDate: r.END_DATE.slice(0, 10), noticeDate: r.HOLD_NOTICE_DATE.slice(0, 10), prevEndDate: r.PRE_END_DATE?.slice(0, 10) ?? null,
    }
  }
  if (Object.keys(out).length) writeCache({ fetchedAt: new Date().toISOString(), rows: out }, 'holdernum-latest.json')
  return Object.keys(out).length ? out : cached?.rows ?? {}
}

/** 某截止日全市场股东户数（东方财富数据中心 RPT_HOLDERNUM_DET），带公告日期 */
export async function fetchHolderNum(endDate: string): Promise<HolderNumRow[]> {
  const key = `${endDate}.json`
  const cached = readCache<{ final: boolean; rows: HolderNumRow[]; fetchedAt?: string }>('holdernum', key)
  if (cached && (cached.final || fresh(cached.fetchedAt, 1))) return cached.rows
  const rows = await dcAll<{ SECURITY_CODE: string; HOLDER_NUM: number | null; HOLDER_NUM_RATIO: number | null; END_DATE: string; HOLD_NOTICE_DATE: string | null }>(
    'RPT_HOLDERNUM_DET', 'SECURITY_CODE,HOLDER_NUM,HOLDER_NUM_RATIO,END_DATE,HOLD_NOTICE_DATE', `(END_DATE='${endDate}')`)
  const out: HolderNumRow[] = []
  for (const r of rows) {
    if (r.HOLDER_NUM === null || !r.HOLD_NOTICE_DATE) continue
    out.push({ code: r.SECURITY_CODE, holders: r.HOLDER_NUM, ratio: r.HOLDER_NUM_RATIO, endDate: r.END_DATE.slice(0, 10), noticeDate: r.HOLD_NOTICE_DATE.slice(0, 10) })
  }
  const final = Date.now() - new Date(endDate).getTime() > 150 * DAY_MS
  if (out.length) writeCache({ final, rows: out, fetchedAt: new Date().toISOString() }, 'holdernum', key)
  return out
}
