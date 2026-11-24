/**
 * 行情源。一期全部用免费的网页接口：
 *
 *   日线        东方财富 push2his（主）；腾讯实时行情只用来核对最新收盘价
 *   主力净流入  东方财富资金流日线。源头只留约 120 个交易日，所以必须自己逐日累积
 *   盘中        东方财富 ulist（现价、成交额、当日主力净流入）。实时入口 push2 在海外机房返回 302，依次换备用入口
 *   融资        东方财富数据中心（源头是交易所，次日早间公布）
 *   业绩        东方财富业绩报表、业绩预告
 *
 * 这些接口没有文档也没有承诺。每项重试；取不到就抛错，由调用方记成“缺”，不补、不猜。
 * 主力资金各家口径不同：一条序列只用一个来源。
 */
import { tencentSymbol } from '../dailyDecision/input'
import type { BarRow, Earning, FlowRow, Forecast, MarginRow, Quote } from './types'

export type Fetch = typeof fetch

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'
const EM_HIS = 'https://push2his.eastmoney.com'
/** 盘中入口，按顺序试 */
const EM_LIVE = ['https://push2.eastmoney.com', 'https://push2delay.eastmoney.com', EM_HIS] as const
const EM_DATA = 'https://datacenter-web.eastmoney.com/api/data/v1/get'
const DATE = /^\d{4}-\d{2}-\d{2}$/

export interface SourceOptions { doFetch?: Fetch; attempts?: number; backoffMs?: number }

async function getBytes(url: string, referer: string, o: SourceOptions): Promise<ArrayBuffer> {
  const doFetch = o.doFetch ?? fetch
  const attempts = o.attempts ?? 4
  let last: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await doFetch(url, { headers: { Referer: referer, 'User-Agent': UA }, redirect: 'manual', signal: AbortSignal.timeout(15_000) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return await res.arrayBuffer()
    } catch (e) {
      last = e
      if (i < attempts - 1) await new Promise(r => setTimeout(r, (o.backoffMs ?? 800) * (i + 1)))
    }
  }
  throw last instanceof Error ? last : new Error(String(last))
}

async function getJson<T>(url: string, referer: string, o: SourceOptions): Promise<T> {
  return JSON.parse(new TextDecoder('utf-8').decode(await getBytes(url, referer, o))) as T
}

export function secid(code: string): string {
  return `${/^[69]/.test(code) ? '1' : '0'}.${code}`
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' && v !== '-' ? Number(v) : NaN
  return Number.isFinite(n) ? n : null
}

/** 东方财富前复权日线。旧的在前。盘中最后一根是实时价，由调用方决定要不要 */
export async function emBars(code: string, count: number, o: SourceOptions = {}): Promise<{ name: string; bars: BarRow[] }> {
  const url = `${EM_HIS}/api/qt/stock/kline/get?secid=${secid(code)}&klt=101&fqt=1&lmt=${count}&end=20500101`
    + '&fields1=f1,f3&fields2=f51,f52,f53,f54,f55,f57,f59'
  const json = await getJson<{ data?: { name?: string; klines?: string[] } | null }>(url, 'https://quote.eastmoney.com/', o)
  const bars: BarRow[] = []
  for (const line of json.data?.klines ?? []) {
    const f = line.split(',')
    const [open, close, high, low, amount, pct] = [num(f[1]), num(f[2]), num(f[3]), num(f[4]), num(f[5]), num(f[6])]
    if (!DATE.test(f[0] ?? '') || open === null || close === null || high === null || low === null || amount === null || pct === null || close <= 0) continue
    bars.push({ date: f[0]!, open, close, high, low, amount, pct: pct / 100 })
  }
  if (bars.length < 2) throw new Error('日线为空')
  return { name: (json.data?.name ?? '').replace(/\s+/g, ''), bars }
}

/** 东方财富资金流日线：每日主力净流入。旧的在前 */
export async function emFlow(code: string, o: SourceOptions = {}): Promise<FlowRow[]> {
  const url = `${EM_HIS}/api/qt/stock/fflow/daykline/get?lmt=0&klt=101&secid=${secid(code)}&fields1=f1&fields2=f51,f52`
  const json = await getJson<{ data?: { klines?: string[] } | null }>(url, 'https://quote.eastmoney.com/', o)
  const rows: FlowRow[] = []
  for (const line of json.data?.klines ?? []) {
    const f = line.split(',')
    const main = num(f[1])
    if (DATE.test(f[0] ?? '') && main !== null) rows.push({ date: f[0]!, main })
  }
  if (!rows.length) throw new Error('资金流日线为空')
  return rows
}

interface EmReport { result?: { pages?: number; data?: Record<string, unknown>[] } | null }

async function emReport(report: string, columns: string, filter: string, sort: string, size: number, pages: number, o: SourceOptions): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = []
  for (let p = 1; p <= pages; p++) {
    const q = new URLSearchParams({
      reportName: report, columns, filter, pageSize: String(size), pageNumber: String(p), sortColumns: sort, sortTypes: '-1', source: 'WEB', client: 'WEB',
    })
    const json = await getJson<EmReport>(`${EM_DATA}?${q.toString()}`, 'https://data.eastmoney.com/', o)
    out.push(...(json.result?.data ?? []))
    if (p >= (json.result?.pages ?? 0)) break
  }
  return out
}

function toMargin(rows: Record<string, unknown>[], dateKey: string): MarginRow[] {
  const out: MarginRow[] = []
  for (const r of rows) {
    const date = String(r[dateKey] ?? '').slice(0, 10)
    const balance = num(r.RZYE)
    if (DATE.test(date) && balance !== null && balance > 0) out.push({ date, balance, buy: num(r.RZMRE) ?? 0, repay: num(r.RZCHE) ?? 0 })
  }
  return out.sort((a, b) => a.date.localeCompare(b.date))
}

/** 个股融资余额。不是两融标的时返回空数组 */
export async function emMargin(code: string, size: number, o: SourceOptions = {}): Promise<MarginRow[]> {
  return toMargin(await emReport('RPTA_WEB_RZRQ_GGMX', 'DATE,RZYE,RZMRE,RZCHE', `(SCODE="${code}")`, 'DATE', size, 1, o), 'DATE')
}

export async function emMarketMargin(size: number, o: SourceOptions = {}): Promise<MarginRow[]> {
  const rows = toMargin(await emReport('RPTA_RZRQ_LSHJ', 'DIM_DATE,RZYE,RZMRE,RZCHE', '', 'DIM_DATE', size, 1, o), 'DIM_DATE')
  if (!rows.length) throw new Error('全市场融资为空')
  return rows
}

const inList = (codes: readonly string[]): string => `(SECURITY_CODE in ("${codes.join('","')}"))`
const ratio = (v: unknown): number | null => { const n = num(v); return n === null ? null : n / 100 }

/** 每只股票最新一期业绩报表 */
export async function emEarnings(codes: readonly string[], o: SourceOptions = {}): Promise<Record<string, Earning>> {
  const rows = await emReport('RPT_LICO_FN_CPD', 'SECURITY_CODE,REPORTDATE,NOTICE_DATE,YSTZ,SJLTZ', inList(codes), 'REPORTDATE', 500, 3, o)
  const out: Record<string, Earning> = {}
  for (const r of rows) {
    const code = String(r.SECURITY_CODE ?? '')
    const report = String(r.REPORTDATE ?? '').slice(0, 10)
    if (!DATE.test(report) || (out[code] && out[code]!.report >= report)) continue
    out[code] = { report, notice: String(r.NOTICE_DATE ?? '').slice(0, 10), revYoy: ratio(r.YSTZ), npYoy: ratio(r.SJLTZ) }
  }
  if (!Object.keys(out).length) throw new Error('业绩报表为空')
  return out
}

/** 每只股票最新一期业绩预告里的净利润同比区间。没有预告的股票不出现 */
export async function emForecasts(codes: readonly string[], o: SourceOptions = {}): Promise<Record<string, Forecast>> {
  const rows = await emReport(
    'RPT_PUBLIC_OP_NEWPREDICT', 'SECURITY_CODE,REPORT_DATE,NOTICE_DATE,PREDICT_FINANCE,ADD_AMP_LOWER,ADD_AMP_UPPER', inList(codes), 'REPORT_DATE', 500, 2, o,
  )
  const rank = (item: string): number => (item.includes('归属于上市公司股东的净利润') && !item.includes('扣除') ? 2 : item === '净利润' ? 1 : 0)
  const out: Record<string, Forecast> = {}
  for (const r of rows) {
    const code = String(r.SECURITY_CODE ?? '')
    const report = String(r.REPORT_DATE ?? '').slice(0, 10)
    const item = String(r.PREDICT_FINANCE ?? '')
    if (!DATE.test(report) || rank(item) === 0) continue
    const have = out[code]
    if (have && (have.report > report || (have.report === report && rank(have.item) >= rank(item)))) continue
    out[code] = { report, notice: String(r.NOTICE_DATE ?? '').slice(0, 10), item, lower: ratio(r.ADD_AMP_LOWER), upper: ratio(r.ADD_AMP_UPPER) }
  }
  return out
}

/** 盘中：现价、涨跌幅、成交额、当日主力净流入。sourceAt 是行情源报的最新时刻（北京时间） */
export async function emQuotes(codes: readonly string[], o: SourceOptions = {}): Promise<{ quotes: Record<string, Quote>; sourceAt: string | null; host: string }> {
  let last: unknown
  for (const host of EM_LIVE) {
    try {
      const quotes: Record<string, Quote> = {}
      let latest = 0
      for (let i = 0; i < codes.length; i += 60) {
        const part = codes.slice(i, i + 60)
        const url = `${host}/api/qt/ulist.np/get?fltt=2&secids=${part.map(secid).join(',')}&fields=f2,f3,f6,f12,f62,f124`
        const json = await getJson<{ data?: { diff?: Record<string, unknown>[] } | null }>(url, 'https://quote.eastmoney.com/', { ...o, attempts: 2 })
        for (const d of json.data?.diff ?? []) {
          const price = num(d.f2)
          const pct = num(d.f3)
          const amount = num(d.f6)
          if (price === null || price <= 0 || pct === null || amount === null) continue
          quotes[String(d.f12)] = { price, pct: pct / 100, amount, main: num(d.f62) }
          latest = Math.max(latest, num(d.f124) ?? 0)
        }
      }
      if (!Object.keys(quotes).length) throw new Error('盘中行情为空')
      const sourceAt = latest > 0 ? new Date(latest * 1000 + 8 * 3600_000).toISOString().slice(0, 19).replace('T', ' ') : null
      return { quotes, sourceAt, host: new URL(host).hostname }
    } catch (e) {
      last = e
    }
  }
  throw last instanceof Error ? last : new Error(String(last))
}

export interface TencentQuote { price: number; prevClose: number; date: string }

/** 腾讯实时行情：只用来核对东方财富的最新价。收盘后现价就是收盘价 */
export async function tencentQuotes(codes: readonly string[], o: SourceOptions = {}): Promise<Record<string, TencentQuote>> {
  const out: Record<string, TencentQuote> = {}
  for (let i = 0; i < codes.length; i += 60) {
    const part = codes.slice(i, i + 60)
    const text = new TextDecoder('gbk').decode(await getBytes(`https://qt.gtimg.cn/q=${part.map(tencentSymbol).join(',')}`, 'https://gu.qq.com/', o))
    for (const m of text.matchAll(/v_(?:sh|sz|bj)(\d{6})="([^"]*)"/g)) {
      const f = m[2]!.split('~')
      const price = num(f[3])
      const prevClose = num(f[4])
      const stamp = f[30] ?? ''
      if (price === null || price <= 0 || prevClose === null || !/^\d{8}/.test(stamp)) continue
      out[m[1]!] = { price, prevClose, date: `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}` }
    }
  }
  return out
}
