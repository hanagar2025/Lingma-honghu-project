/**
 * 行情与融资数据。只取四组驱动动作的数据里"市场上拿得到"的两组：
 *
 *   卖压    个股日线（是否创 60 日新低）、个股与全市场的融资余额
 *   海外锚  英伟达、Lumentum、Coherent 的日线
 *
 * 只用已收盘的交易日。任何一项取不到都如实记在 failed 里，由判定环节按"不成立"处理，不补、不猜。
 */
import { tencentSymbol } from '../dailyDecision/input'

export interface Bar { date: string; close: number }
export interface MarginRow { date: string; balance: number }

export interface UsSeries {
  bars: Bar[]
  /** 最新收盘价与第二数据源（新浪）一致 */
  verified: boolean
  note: string
}

export interface MarketData {
  /** 北京时间 YYYY-MM-DD HH:mm */
  fetchedAt: string
  /** A 股代码或指数代码（sh000001）→ 日线，旧的在前 */
  bars: Record<string, Bar[]>
  us: Record<string, UsSeries>
  /** A 股代码 → 融资余额，新的在前 */
  margin: Record<string, MarginRow[]>
  marketMargin: MarginRow[]
  failed: string[]
}

export const US_ANCHORS = [
  { key: 'NVDA', name: '英伟达', tencent: 'usNVDA.OQ', sina: 'nvda' },
  { key: 'LITE', name: 'Lumentum', tencent: 'usLITE.OQ', sina: 'lite' },
  { key: 'COHR', name: 'Coherent', tencent: 'usCOHR.N', sina: 'cohr' },
] as const

export const INDEXES = { shanghai: 'sh000001', chinext: 'sz399006', star50: 'sh000688' } as const

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'
const EM = 'https://datacenter-web.eastmoney.com/api/data/v1/get'

type Fetch = typeof fetch

async function getText(url: string, referer: string, doFetch: Fetch, attempts = 3): Promise<string> {
  let last: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await doFetch(url, { headers: { Referer: referer, 'User-Agent': UA }, signal: AbortSignal.timeout(12_000) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return await res.text()
    } catch (e) {
      last = e
      if (i < attempts - 1) await new Promise(r => setTimeout(r, 500 * (i + 1)))
    }
  }
  throw last instanceof Error ? last : new Error(String(last))
}

function rowsToBars(rows: unknown): Bar[] {
  if (!Array.isArray(rows)) return []
  return (rows as string[][])
    .map(r => ({ date: String(r[0]), close: Number(r[2]) }))
    .filter(b => /^\d{4}-\d{2}-\d{2}$/.test(b.date) && b.close > 0)
}

/** 腾讯前复权日线。symbol 形如 sz300308、sh000001、usNVDA.OQ */
export async function fetchBars(symbol: string, count = 130, doFetch: Fetch = fetch): Promise<Bar[]> {
  const path = symbol.startsWith('us') ? 'usfqkline' : 'newfqkline'
  const text = await getText(`https://web.ifzq.gtimg.cn/appstock/app/${path}/get?param=${symbol},day,,,${count},qfq`, 'https://gu.qq.com/', doFetch)
  const data = (JSON.parse(text) as { data?: Record<string, { qfqday?: unknown; day?: unknown }> }).data?.[symbol]
  const bars = rowsToBars(data?.qfqday ?? data?.day)
  if (bars.length < 2) throw new Error('日线为空')
  return bars
}

/** 新浪美股日线，只用来核对腾讯的最新收盘价 */
export async function fetchSinaUsLast(symbol: string, doFetch: Fetch = fetch): Promise<Bar> {
  const text = await getText(
    `https://stock.finance.sina.com.cn/usstock/api/jsonp_v2.php/var%20_x=/US_MinKService.getDailyK?symbol=${symbol}`,
    'https://finance.sina.com.cn', doFetch,
  )
  const all = [...text.matchAll(/"d":"(\d{4}-\d{2}-\d{2})"[^}]*?"c":"([\d.]+)"/g)]
  const m = all[all.length - 1]
  if (!m) throw new Error('新浪美股日线为空')
  return { date: m[1]!, close: Number(m[2]) }
}

async function emRows(report: string, filter: string, sort: string, size: number, doFetch: Fetch): Promise<Record<string, unknown>[]> {
  const url = `${EM}?reportName=${report}&columns=ALL&filter=${encodeURIComponent(filter)}&sortColumns=${sort}&sortTypes=-1&pageSize=${size}&pageNumber=1`
  const json = JSON.parse(await getText(url, 'https://data.eastmoney.com/', doFetch)) as { result?: { data?: Record<string, unknown>[] } }
  const rows = json.result?.data
  if (!rows?.length) throw new Error('融资数据为空')
  return rows
}

function toMargin(rows: Record<string, unknown>[], dateKey: string): MarginRow[] {
  return rows
    .map(r => ({ date: String(r[dateKey]).slice(0, 10), balance: Number(r.RZYE) }))
    .filter(r => /^\d{4}-\d{2}-\d{2}$/.test(r.date) && r.balance > 0)
}

/** 东方财富数据中心：个股融资余额。单一来源 */
export async function fetchStockMargin(code: string, doFetch: Fetch = fetch): Promise<MarginRow[]> {
  return toMargin(await emRows('RPTA_WEB_RZRQ_GGMX', `(SCODE="${code}")`, 'DATE', 30, doFetch), 'DATE')
}

export async function fetchMarketMargin(doFetch: Fetch = fetch): Promise<MarginRow[]> {
  return toMargin(await emRows('RPTA_RZRQ_LSHJ', '', 'DIM_DATE', 30, doFetch), 'DIM_DATE')
}

function stamp(now: Date, offsetHours: number): string {
  return new Date(now.getTime() + offsetHours * 3600_000).toISOString().slice(0, 16).replace('T', ' ')
}

/** 盘中的最后一根是实时价，不是收盘价：15:00 前去掉当天那一根 */
export function completedOnly(bars: Bar[], now: Date): Bar[] {
  const bj = stamp(now, 8)
  const last = bars[bars.length - 1]
  return last && last.date === bj.slice(0, 10) && bj.slice(11) < '15:00' ? bars.slice(0, -1) : bars
}

/** 美股同理：纽约时间 16:10 前去掉当天那一根 */
export function completedOnlyUs(bars: Bar[], now: Date): Bar[] {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now).map(p => [p.type, p.value]))
  const nyDate = `${parts.year}-${parts.month}-${parts.day}`
  const nyTime = `${parts.hour}:${parts.minute}`
  const last = bars[bars.length - 1]
  return last && (last.date > nyDate || (last.date === nyDate && nyTime < '16:10')) ? bars.slice(0, -1) : bars
}

const close = (a: number, b: number): boolean => Math.abs(a - b) <= Math.max(0.011, 0.005 * b)

export interface CollectOptions { now?: Date; doFetch?: Fetch }

export async function collectMarket(codes: readonly string[], opts: CollectOptions = {}): Promise<MarketData> {
  const now = opts.now ?? new Date()
  const doFetch = opts.doFetch ?? fetch
  const out: MarketData = { fetchedAt: stamp(now, 8), bars: {}, us: {}, margin: {}, marketMargin: [], failed: [] }
  const unique = [...new Set(codes)]
  const jobs: Promise<void>[] = []

  for (const key of [...Object.values(INDEXES), ...unique]) {
    const symbol = /^\d{6}$/.test(key) ? tencentSymbol(key) : key
    jobs.push(fetchBars(symbol, 130, doFetch)
      .then(b => { out.bars[key] = completedOnly(b, now) })
      .catch(e => { out.failed.push(`${key} 日线（${e instanceof Error ? e.message : String(e)}）`) }))
  }
  for (const a of US_ANCHORS) {
    jobs.push((async () => {
      try {
        const bars = completedOnlyUs(await fetchBars(a.tencent, 130, doFetch), now)
        const last = bars[bars.length - 1]!
        let verified = false
        let note = ''
        try {
          const second = await fetchSinaUsLast(a.sina, doFetch)
          const same = bars.find(b => b.date === second.date)
          if (!same) note = `第二数据源日期 ${second.date} 对不上`
          else if (!close(same.close, second.close)) note = `两源收盘价不一致（${same.close} / ${second.close}）`
          else if (second.date < last.date) note = `第二数据源停在 ${second.date}`
          else verified = true
        } catch {
          note = '第二数据源取不到'
        }
        out.us[a.key] = { bars, verified, note }
      } catch (e) {
        out.failed.push(`${a.name} 日线（${e instanceof Error ? e.message : String(e)}）`)
      }
    })())
  }
  for (const code of unique) {
    jobs.push(fetchStockMargin(code, doFetch)
      .then(r => { out.margin[code] = r })
      .catch(() => { out.failed.push(`${code} 融资余额`) }))
  }
  jobs.push(fetchMarketMargin(doFetch)
    .then(r => { out.marketMargin = r })
    .catch(() => { out.failed.push('全市场融资余额') }))

  await Promise.all(jobs)
  out.failed.sort()
  return out
}
