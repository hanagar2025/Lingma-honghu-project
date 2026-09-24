/**
 * 资金驾驶舱（R-01）· 第二数据源交叉核对
 *
 * 主数据源是腾讯日 K。这里用两个与腾讯无关的来源逐项核对：
 *
 *   新浪实时行情 hq.sinajs.cn     沪深全部个股与指数的当日收盘价、成交额（元），收盘后即定稿
 *   上交所官方行情 yunhq.sse.com.cn  沪市个股与上证指数的日 K（不复权收盘价、成交额），可回溯约 300 日
 *   新浪日 K                        深市个股不复权收盘价（没有成交额）
 *
 * 口径：
 *   · 收盘价比"不复权"：腾讯前复权价在除权后会整体平移，拿它和别人的原始价比会误报；
 *   · 成交额容许 0.1%：腾讯成交额单位是万元，取整误差最多 5000 元；
 *   · 只在当日数据定稿后（16:30）做当日核对，盘中只做历史核对。
 *
 * 只登记核对结果，不自动替换任何数据 —— 两边对不上时，要人去看是谁错了。
 */

import { exchangeOf, fetchKline, runPool, stockKlineCached, type KBar } from './fetch'

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36'

async function get(url: string, headers: Record<string, string>): Promise<ArrayBuffer> {
  let last: unknown
  for (let i = 0; i < 3; i++) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 20_000)
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, ...headers }, signal: ctrl.signal })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return await res.arrayBuffer()
    } catch (e) {
      last = e
      await new Promise(r => setTimeout(r, 600 * 2 ** i))
    } finally {
      clearTimeout(timer)
    }
  }
  throw new Error(`请求失败 ${url.slice(0, 100)}：${String(last)}`)
}

// ─────────────────────────── 抓取 ───────────────────────────

export interface QuoteDay { code: string; date: string; close: number; amount: number }

/** 新浪实时行情。symbol 形如 sh600183、sz399106；停牌股的日期停在最后交易日 */
export function parseSinaQuotes(text: string): Record<string, QuoteDay> {
  const out: Record<string, QuoteDay> = {}
  for (const line of text.split('\n')) {
    const m = /hq_str_(s[hz])(\d{6})="([^"]*)"/.exec(line)
    if (!m) continue
    const f = m[3]!.split(',')
    if (f.length < 32) continue
    const close = Number(f[3])
    const amount = Number(f[9])
    const date = f[30] ?? ''
    if (!Number.isFinite(close) || close <= 0 || !Number.isFinite(amount) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue
    out[`${m[1]}${m[2]}`] = { code: m[2]!, date, close, amount }
  }
  return out
}

export async function fetchSinaQuotes(symbols: readonly string[]): Promise<Record<string, QuoteDay>> {
  const out: Record<string, QuoteDay> = {}
  const batches: string[][] = []
  for (let i = 0; i < symbols.length; i += 300) batches.push(symbols.slice(i, i + 300) as string[])
  const dec = new TextDecoder('gbk')
  await runPool(batches, 3, async b => {
    const buf = await get(`https://hq.sinajs.cn/list=${b.join(',')}`, { Referer: 'https://finance.sina.com.cn' })
    Object.assign(out, parseSinaQuotes(dec.decode(buf)))
  })
  return out
}

/** 上交所官方日 K：[日期, 开, 高, 低, 收, 量, 额]，不复权 */
export async function fetchSseDayK(code: string, n: number): Promise<QuoteDay[]> {
  const buf = await get(`https://yunhq.sse.com.cn:32042/v1/sh1/dayk/${code}?begin=-${n}&end=-1&period=day`, { Referer: 'https://www.sse.com.cn/' })
  const j = JSON.parse(new TextDecoder().decode(buf)) as { kline?: number[][] }
  return (j.kline ?? []).map(r => {
    const d = String(r[0])
    return { code, date: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`, close: Number(r[4]), amount: Number(r[6]) }
  })
}

/** 新浪日 K（不复权收盘价；没有成交额） */
export async function fetchSinaDayK(symbol: string, n: number): Promise<{ date: string; close: number }[]> {
  const buf = await get(`https://quotes.sina.cn/cn/api/json_v2.php/CN_MarketDataService.getKLineData?symbol=${symbol}&scale=240&ma=no&datalen=${n}`, { Referer: 'https://finance.sina.com.cn' })
  const j = JSON.parse(new TextDecoder().decode(buf)) as { day: string; close: string }[] | null
  return (j ?? []).map(r => ({ date: r.day, close: Number(r.close) }))
}

// ─────────────────────────── 比对（纯函数） ───────────────────────────

export const TOL = {
  /** 收盘价容差（元） */
  close: 0.0051,
  /** 成交额相对容差 */
  amountRel: 0.001,
  /** 成交额绝对容差（元）：腾讯万元取整 */
  amountAbs: 1e4,
  /** 当日收盘价不一致的股票超过此比例 → 不通过 */
  failShare: 0.01,
  /** 两市总成交额相差超过此比例 → 不通过 */
  marketRel: 0.001,
}

export interface Mismatch { code: string; name: string; date: string; field: 'close' | 'amount'; primary: number; second: number }

export function amountMatches(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(TOL.amountAbs, TOL.amountRel * Math.max(Math.abs(a), Math.abs(b)))
}

export function closeMatches(a: number, b: number): boolean {
  return Math.abs(a - b) <= TOL.close
}

export interface TodayCheck {
  date: string
  /** 双方都有当日数据、参与比对的股票数 */
  checked: number
  /** 腾讯有、新浪当日无（多为停牌） */
  secondMissing: number
  closeMismatch: number
  amountMismatch: number
  worst: Mismatch[]
  market: { primary: number | null; second: number | null; diffPct: number | null }
}

/**
 * 当日全量核对。primary：腾讯最后一根 K 线（不复权收盘价）；second：新浪当日行情。
 * 新浪日期不是当日的股票算"新浪当日无"，不算不一致。
 */
export function compareToday(
  date: string,
  primary: Record<string, { close: number | null; amount: number | null }>,
  second: Record<string, QuoteDay>,
  names: Record<string, string>,
  market: { primary: number | null; second: number | null },
): TodayCheck {
  let checked = 0
  let missing = 0
  const mism: Mismatch[] = []
  for (const [code, p] of Object.entries(primary)) {
    if (p.close === null || p.amount === null || p.amount <= 0) continue
    const s = second[`${exchangeOf(code)}${code}`]
    if (!s || s.date !== date) { missing++; continue }
    checked++
    if (!closeMatches(p.close, s.close)) mism.push({ code, name: names[code] ?? code, date, field: 'close', primary: p.close, second: s.close })
    if (!amountMatches(p.amount, s.amount)) mism.push({ code, name: names[code] ?? code, date, field: 'amount', primary: p.amount, second: s.amount })
  }
  const rel = (m: Mismatch) => Math.abs(m.primary - m.second) / Math.max(Math.abs(m.second), 1e-9)
  return {
    date, checked, secondMissing: missing,
    closeMismatch: mism.filter(m => m.field === 'close').length,
    amountMismatch: mism.filter(m => m.field === 'amount').length,
    worst: mism.sort((a, b) => rel(b) - rel(a)).slice(0, 12),
    market: {
      ...market,
      diffPct: market.primary !== null && market.second !== null && market.second > 0 ? market.primary / market.second - 1 : null,
    },
  }
}

export interface HistoryCheck {
  source: string
  code: string
  name: string
  days: number
  closeMismatch: number
  amountMismatch: number | null
  /** 成交额最大相对偏差 */
  amountMaxRel: number | null
  first: Mismatch | null
}

export function compareHistory(
  source: string, code: string, name: string,
  primary: readonly KBar[], second: readonly { date: string; close: number; amount?: number }[],
  skipDate?: string,
): HistoryCheck {
  const byDate = new Map(primary.map(b => [b.date, b]))
  let days = 0
  let cm = 0
  let am = 0
  let maxRel = 0
  let first: Mismatch | null = null
  const hasAmount = second.some(s => s.amount !== undefined)
  for (const s of second) {
    if (s.date === skipDate) continue
    const p = byDate.get(s.date)
    if (!p) continue
    days++
    if (!closeMatches(p.close, s.close)) {
      cm++
      first ??= { code, name, date: s.date, field: 'close', primary: p.close, second: s.close }
    }
    if (s.amount !== undefined) {
      maxRel = Math.max(maxRel, Math.abs(p.amount - s.amount) / Math.max(s.amount, 1))
      if (!amountMatches(p.amount, s.amount)) {
        am++
        first ??= { code, name, date: s.date, field: 'amount', primary: p.amount, second: s.amount }
      }
    }
  }
  return { source, code, name, days, closeMismatch: cm, amountMismatch: hasAmount ? am : null, amountMaxRel: hasAmount ? maxRel : null, first }
}

export type CrossStatus = 'PASS' | 'WARN' | 'FAIL' | 'SKIPPED'

export const CROSS_STATUS_TEXT: Record<CrossStatus, string> = {
  PASS: '通过：两个来源逐项一致',
  WARN: '基本一致：有少量不一致，见明细',
  FAIL: '不通过：不一致超过阈值，今日数据需人工复核后再用',
  SKIPPED: '未做当日核对（盘中或第二来源不可用）',
}

export function crossStatus(today: TodayCheck | null, history: readonly HistoryCheck[]): CrossStatus {
  const histBad = history.some(h => h.closeMismatch > 0 || (h.amountMismatch ?? 0) > 0)
  if (!today) return history.length ? (histBad ? 'WARN' : 'PASS') : 'SKIPPED'
  const closeShare = today.checked ? today.closeMismatch / today.checked : 1
  const mkt = today.market.diffPct
  if (today.checked === 0 || closeShare > TOL.failShare || (mkt !== null && Math.abs(mkt) > TOL.marketRel)) return 'FAIL'
  if (today.closeMismatch + today.amountMismatch > 0 || histBad) return 'WARN'
  return 'PASS'
}

export interface CrossCheckView {
  asOf: string
  status: CrossStatus
  statusText: string
  sources: string[]
  today: TodayCheck | null
  todayNote: string | null
  history: HistoryCheck[]
  notes: string[]
}

// ─────────────────────────── 装配 ───────────────────────────

export async function runCrossCheck(opts: {
  asOf: string
  intraday: boolean
  /**
   * 主数据当日值（腾讯最后一根 K 线）。前复权只改历史、不改当日，所以当日收盘价就是不复权价。
   * 当日没有成交（停牌）的不要放进来。
   */
  primaryToday: Record<string, { close: number | null; amount: number | null }>
  /** 历史核对的重点股票（持仓、观察仓） */
  focus: readonly { code: string; name: string }[]
  names: Record<string, string>
  /** 腾讯两市总成交额（上证指数 + 深证综指），当日 */
  marketPrimary: number | null
  log: (s: string) => void
}): Promise<CrossCheckView> {
  const { asOf, log } = opts
  const notes: string[] = []
  let today: TodayCheck | null = null
  let todayNote: string | null = null

  // 历史核对需要腾讯不复权价
  const rawOf: Record<string, KBar[]> = {}
  await runPool(opts.focus.map(f => f.code), 6, async c => { rawOf[c] = await stockKlineCached(c, 800, asOf, 'raw') })

  if (opts.intraday) {
    todayNote = `${asOf} 当日数据 16:30 才定稿，盘中不做当日核对`
  } else {
    try {
      log(`· 交叉核对：新浪当日行情 ${Object.keys(opts.primaryToday).length} 只`)
      const second = await fetchSinaQuotes([...Object.keys(opts.primaryToday).map(c => `${exchangeOf(c)}${c}`), 'sh000001', 'sz399106'])
      const sh = second.sh000001
      const sz = second.sz399106
      today = compareToday(asOf, opts.primaryToday, second, opts.names, {
        primary: opts.marketPrimary,
        second: sh && sz && sh.date === asOf && sz.date === asOf ? sh.amount + sz.amount : null,
      })
    } catch (e) {
      todayNote = `新浪行情不可用（${e instanceof Error ? e.message : String(e)}），当日未核对`
    }
  }

  log(`· 交叉核对：上交所官方 / 新浪日 K 历史（${opts.focus.length} 只重点股 + 上证指数）`)
  const history: HistoryCheck[] = []
  const skip = opts.intraday ? asOf : undefined
  await runPool([...opts.focus], 4, async f => {
    try {
      if (exchangeOf(f.code) === 'sh') {
        history.push(compareHistory('上交所官方', f.code, f.name, rawOf[f.code] ?? [], await fetchSseDayK(f.code, 250), skip))
      } else {
        history.push(compareHistory('新浪日K', f.code, f.name, rawOf[f.code] ?? [], await fetchSinaDayK(`sz${f.code}`, 250), skip))
      }
    } catch (e) {
      notes.push(`${f.name} 历史核对失败：${e instanceof Error ? e.message : String(e)}`)
    }
  })
  try {
    const idx = await fetchKline('sh000001', 260)
    history.push(compareHistory('上交所官方', '000001', '上证指数', idx, await fetchSseDayK('000001', 250), skip))
  } catch (e) {
    notes.push(`上证指数历史核对失败：${e instanceof Error ? e.message : String(e)}`)
  }
  history.sort((a, b) => a.code.localeCompare(b.code))

  const status = crossStatus(today, history)
  return {
    asOf, status, statusText: CROSS_STATUS_TEXT[status],
    sources: ['主：腾讯日 K', '核：新浪实时行情（全市场当日）', '核：上交所官方日 K（沪市重点股与上证指数，约 250 日）', '核：新浪日 K（深市重点股收盘价）'],
    today, todayNote, history,
    notes: [
      `容差：收盘价 ±${TOL.close.toFixed(3)} 元；成交额 ±max(1 万元, 0.1%)（腾讯成交额单位万元）；收盘价按不复权比`,
      `当日收盘价不一致超过 ${TOL.failShare * 100}% 的股票、或两市总成交额相差超过 ${TOL.marketRel * 100}%，判为不通过`,
      '只登记核对结果，不自动替换数据',
      ...notes,
    ],
  }
}
