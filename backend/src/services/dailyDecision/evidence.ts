/**
 * 证据分。口径照《半年计划》第二节：
 *
 *   资金分 C（0–4），每条 1 分：
 *     5 日融资变化好于全市场；5 日融资变化 ≥0；近 5 天主力净流入的天数 ≥3；近 5 天主力净流入合计 >0
 *   趋势分 T（0–2）：站上 20 日线 1 分，站上 60 日线 1 分
 *   基本面扣分：最新报告期净利同比为负，或登记在册的供应、监管冲击，扣 1 分
 *   证据分 E = C + T − 扣分
 *
 * 这是 agents/honghu-digest/bot/lib/score.ts 的同一套算法。定时汇总和执行单各算一遍，
 * 两处的结果由执行单自检在随机样本上逐项比对，不允许出现两个口径。
 *
 * 缺数据：缺的那一条记 0 分，对买入是保守的；对卖出会凭空造出“资金 0 分”，
 * 所以另记 cUnknown（有几条是取不到数才没得分的）。卖出条件只在补齐数据后也必然成立时才算成立。
 * 不是两融标的的股票没有融资数据，那两条是确定的 0 分。
 * 融资余额次日早间才公布：融资比日线晚一天时资金分是初算，涉及融资的卖出条件要等定稿。
 */
import type { SeriesView, ViewRow } from '../chain/view'
import type { Earning, ShockFlag } from '../chain/types'
import { PLAN } from './rules'

export interface Score {
  code: string
  name: string
  segment: string
  date: string
  close: number
  pct: number
  amount: number
  c: number
  /** 资金分四条里，有几条是因为取不到数才没得分的。0 = 资金分算得全 */
  cUnknown: number
  cUnknownWhy: string[]
  marginBeatsMarket: boolean | null
  marginUp: boolean | null
  mainDaysOk: boolean | null
  mainSumOk: boolean | null
  margin5: number | null
  market5: number | null
  marginDate: string | null
  mainDays: number | null
  main5: number | null
  t: number
  above20: boolean | null
  above60: boolean | null
  d20: number | null
  d60: number | null
  deduction: number
  deductionWhy: string | null
  e: number
  /** 融资比日线晚一天：资金分是初算 */
  provisional: boolean
  gaps: string[]
}

export interface StockData { name: string; rows: ViewRow[]; earning: Earning | null }

const mean = (xs: number[]): number => xs.reduce((s, x) => s + x, 0) / xs.length

/** 在第 at 根（含）为止的数据上打分 */
export function scoreAt(
  code: string, segment: string, stock: StockData, at: number, market: ReadonlyMap<string, number>, flags: readonly ShockFlag[],
): Score {
  const rows = stock.rows
  const row = rows[at]!
  const gaps: string[] = []

  const closes = rows.slice(0, at + 1).map(r => r.close)
  const ma20 = closes.length >= 20 ? mean(closes.slice(-20)) : null
  const ma60 = closes.length >= 60 ? mean(closes.slice(-60)) : null
  if (ma20 === null) gaps.push('不足 20 根日线')
  if (ma60 === null) gaps.push('不足 60 根日线')
  const above20 = ma20 === null ? null : row.close > ma20
  const above60 = ma60 === null ? null : row.close > ma60

  const last5 = rows.slice(Math.max(0, at - 4), at + 1)
  let mainDays: number | null = null
  let mainSum: number | null = null
  if (last5.length === 5 && last5.every(r => r.main !== null)) {
    mainDays = last5.filter(r => (r.main as number) > 0).length
    mainSum = last5.reduce((s, r) => s + (r.main as number), 0)
  } else gaps.push('近 5 天主力净流入不全')
  const amount5 = last5.reduce((s, r) => s + r.amount, 0)

  // 融资：取到 at 为止最新公布的一天，和它 5 个交易日前比
  let m = at
  while (m >= 0 && rows[m]!.margin === null) m--
  let margin5: number | null = null
  let market5: number | null = null
  const marginDate = m >= 0 ? rows[m]!.date : null
  if (m < 0) gaps.push('没有融资数据（不是两融标的）')
  else if (at - m > 1) gaps.push(`融资停在 ${marginDate}`)
  if (m >= 5 && at - m <= 1) {
    const before = rows[m - 5]!
    if (before.margin !== null && before.margin > 0) margin5 = rows[m]!.margin! / before.margin - 1
    else gaps.push('5 个交易日前没有融资余额')
    const mNow = market.get(rows[m]!.date)
    const mBefore = market.get(before.date)
    if (mNow !== undefined && mBefore !== undefined && mBefore > 0) market5 = mNow / mBefore - 1
    else gaps.push('全市场融资不全')
  }
  const marginBeatsMarket = margin5 === null || market5 === null ? null : margin5 > market5
  const marginUp = margin5 === null ? null : margin5 >= 0
  const mainDaysOk = mainDays === null ? null : mainDays >= 3
  const mainSumOk = mainSum === null ? null : mainSum > 0
  const c = [marginBeatsMarket, marginUp, mainDaysOk, mainSumOk].filter(x => x === true).length
  const marginUnknown = m < 0 ? 0 : [marginBeatsMarket, marginUp].filter(x => x === null).length
  const mainUnknown = [mainDaysOk, mainSumOk].filter(x => x === null).length
  const cUnknownWhy = [...(mainUnknown ? ['主力净流入'] : []), ...(marginUnknown ? ['融资'] : [])]
  const t = [above20, above60].filter(x => x === true).length

  const why: string[] = []
  const np = stock.earning?.npYoy ?? null
  if (np !== null && np < 0) why.push(`${stock.earning!.report.slice(0, 7)} 报告期净利同比 ${(np * 100).toFixed(0)}%`)
  if (!stock.earning) gaps.push('没有业绩报表')
  for (const f of flags) {
    if (f.code === code && f.since <= row.date && (f.until === null || f.until >= row.date)) why.push(f.reason)
  }
  const deduction = why.length ? 1 : 0

  return {
    code, name: stock.name, segment, date: row.date, close: row.close, pct: row.pct, amount: row.amount,
    c, cUnknown: marginUnknown + mainUnknown, cUnknownWhy,
    marginBeatsMarket, marginUp, mainDaysOk, mainSumOk, margin5, market5, marginDate, mainDays,
    main5: mainSum === null || amount5 <= 0 ? null : mainSum / amount5,
    t, above20, above60,
    d20: ma20 === null ? null : row.close / ma20 - 1,
    d60: ma60 === null ? null : row.close / ma60 - 1,
    deduction, deductionWhy: why.length ? why.join('；') : null,
    e: c + t - deduction,
    provisional: m >= 0 && m < at,
    gaps,
  }
}

export interface SellCheck {
  /** 资金分连续 2 天 ≤1 → 减半 */
  halve: boolean
  /** 资金 0 分 → 清仓 */
  clearByC: boolean
  /** 收盘跌破 60 日线且融资在降 → 清仓 */
  clearByTrend: boolean
  provisional: boolean
  note: string
  /** 按已有的数看像是成立、但缺数据不能算成立的那几条。null = 都核对得了 */
  unsure: string | null
}

/**
 * 卖出条件。
 *   “收盘跌破 60 日线” = 当天收盘从线上跌到线下（前一天收盘不低于 60 日线），不是“在线下方”这个状态。
 *   “融资在降” = 5 日融资变化为负。
 *   算得全才算成立：c + cUnknown 是补齐数据后资金分最多能到的数。
 */
export function sellCheck(now: Score, prev: Score | undefined): SellCheck {
  const top = (s: Score): number => s.c + s.cUnknown
  const halve = top(now) <= PLAN.sell.halveMaxC && prev !== undefined && top(prev) <= PLAN.sell.halveMaxC
  const clearByC = top(now) <= PLAN.sell.clearMaxC
  const crossed = now.above60 === false && prev?.above60 === true
  const clearByTrend = crossed && now.margin5 !== null && now.margin5 < 0
  const parts: string[] = []
  if (clearByC) parts.push('资金 0 分')
  else if (halve) parts.push(`资金分连续 2 天 ≤1（前一日 ${prev!.c}，当日 ${now.c}）`)
  if (crossed) parts.push(`收盘跌破 60 日线，5 日融资 ${now.margin5 === null ? '缺' : `${(now.margin5 * 100).toFixed(1)}%`}`)

  const lacking = [...new Set([...now.cUnknownWhy, ...(prev && prev.c <= 1 ? prev.cUnknownWhy : [])])].join('、')
  const doubt: string[] = []
  if (!clearByC && now.c <= PLAN.sell.clearMaxC) doubt.push('资金 0 分')
  if (!halve && !clearByC && now.c <= PLAN.sell.halveMaxC && prev !== undefined && prev.c <= PLAN.sell.halveMaxC) doubt.push('资金分连续 2 天 ≤1')
  if (crossed && now.margin5 === null && now.marginDate !== null) doubt.push('收盘跌破 60 日线且融资在降（5 日融资算不出）')
  const unsure = doubt.length ? `${doubt.join('、')}：缺${lacking || '融资'}数据，资金分已得 ${now.c} 分、另有 ${now.cUnknown} 条算不出，核对不了` : null
  return { halve: halve && !clearByC, clearByC, clearByTrend, provisional: now.provisional, note: parts.join('；'), unsure }
}

/** 新开仓准入：E≥5、当天涨幅 ≤3%、日成交 ≥10 亿、没有基本面扣分 */
export function entryCheck(s: Score, pctNow = s.pct, amountNow = s.amount): { ok: boolean; why: string[] } {
  const why: string[] = []
  if (s.e < PLAN.entry.minE) why.push(`E=${s.e}`)
  if (pctNow > PLAN.entry.maxPct) why.push(`当天涨幅 ${(pctNow * 100).toFixed(1)}%`)
  if (amountNow < PLAN.entry.minAmount) why.push(`成交 ${(amountNow / 1e8).toFixed(1)} 亿`)
  if (s.deduction > 0) why.push('有基本面扣分')
  return { ok: why.length === 0, why }
}

export interface Evidence {
  /** 打分所在的交易日（日线最新的已收盘日） */
  asOf: string
  marginAsOf: string | null
  now: Record<string, Score>
  prev: Record<string, Score>
}

/** 名单内每只股票在最新收盘日和前一日的分。没有日线时返回 null */
export function buildEvidence(view: SeriesView | null): Evidence | null {
  if (!view?.asOf) return null
  const market = new Map(view.marketMargin.map(r => [r.date, r.balance]))
  const now: Record<string, Score> = {}
  const prev: Record<string, Score> = {}
  for (const seg of view.segments) {
    for (const code of seg.codes) {
      const stock = view.stocks[code]
      if (!stock) continue
      let at = stock.rows.length - 1
      while (at >= 0 && stock.rows[at]!.date > view.asOf) at--
      if (at < 0) continue
      now[code] = scoreAt(code, seg.segment, stock, at, market, view.flags)
      if (at >= 1) prev[code] = scoreAt(code, seg.segment, stock, at - 1, market, view.flags)
    }
  }
  return { asOf: view.asOf, marginAsOf: view.marginAsOf, now, prev }
}
