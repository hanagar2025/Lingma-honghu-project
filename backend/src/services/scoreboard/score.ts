/**
 * 记分牌：事后对照，回答"照规则做了没有、做了之后结果怎样"。
 *
 *   净值      账户、"从第一天起不交易"、创业板指，三条线比
 *   执行差    执行单上的指令挂了几天没做，这几天价格怎么走
 *   交易记分  每笔登记的成交，到今天的结果
 *
 * 数据来自每个交易日收盘后的留底（journal）和成交记录，都在私有目录里。
 * 留底从服务器上线那天起才有，之前的不补。
 */
import type { DecisionCard } from '../dailyDecision/card'
import type { DecisionInput } from '../dailyDecision/types'

export interface JournalDay {
  date: string
  ledgerAsOf: string | null
  total: number
  cash: number
  positions: { code: string; name: string; quantity: number; close: number }[]
  /** 创业板指收盘 */
  bench: number | null
  /** 当天执行单上的指令。早先的留底没有 side，那时只有卖出 */
  orders: { code: string; name: string; side?: 'SELL' | 'BUY'; shares: number; refPrice: number | null; reason: string }[]
}

export interface TradeLog {
  id: string
  date?: string
  side?: 'BUY' | 'SELL'
  code?: string
  name?: string
  quantity?: number
  price?: number | null
  void?: boolean
}

/** 收盘后的留底。执行单停单、或价格不是当日收盘价时不留 */
export function journalOf(input: DecisionInput | null, card: DecisionCard, closeDate: string | null, bench: number | null): JournalDay | null {
  if (!input || !card.ok || !closeDate || input.date !== closeDate) return null
  const held = input.holdings.filter(h => h.quantity > 0)
  if (held.some(h => h.close === null || h.barDate !== closeDate)) return null
  return {
    date: closeDate,
    ledgerAsOf: input.ledgerAsOf,
    total: input.snapshot.portfolioTotal,
    cash: input.snapshot.cash + input.snapshot.externalCash,
    positions: held.map(h => ({ code: h.code, name: h.name, quantity: h.quantity, close: h.close as number })),
    bench,
    orders: card.lines.filter(l => l.shares !== null && l.shares > 0)
      .map(l => ({ code: l.code, name: l.name, side: l.side, shares: l.shares as number, refPrice: l.refPrice, reason: l.reason.split('（')[0]! })),
  }
}

const pct = (v: number): string => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`
const md = (d: string): string => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`

function navLines(journal: readonly JournalDay[], prices: Readonly<Record<string, number>>): string[] {
  const first = journal[0]
  const last = journal[journal.length - 1]
  if (!first || !last || first.date === last.date) return ['- 净值：留底不足两个交易日，还不能比。每个交易日收盘后自动留一份。']
  const now = (code: string): number | undefined => last.positions.find(p => p.code === code)?.close ?? prices[code]
  const missing = first.positions.filter(p => now(p.code) === undefined)
  const hold = missing.length ? null
    : (first.positions.reduce((s, p) => s + p.quantity * now(p.code)!, 0) + first.cash) / first.total - 1
  const stale = journal.filter(j => !j.ledgerAsOf || j.ledgerAsOf < j.date).length
  const out = [
    `- 净值（${md(first.date)} 至 ${md(last.date)}，${journal.length} 个留底日）：账户 ${pct(last.total / first.total - 1)}；`
    + `从第一天起不交易 ${hold === null ? '算不出（缺行情）' : pct(hold)}；`
    + `创业板指 ${first.bench && last.bench ? pct(last.bench / first.bench - 1) : '算不出'}。假设期间没有转入转出资金。`,
  ]
  if (stale) out.push(`- 其中 ${stale} 天的账本不是当日的，那几天的净值按旧股数估算。每天收盘后上传持仓截图，这一项才准。`)
  return out
}

/** 早先的留底没有记方向，那时执行单只有卖出 */
const sideOf = (o: { side?: 'SELL' | 'BUY' }): 'SELL' | 'BUY' => o.side ?? 'SELL'

function gapLines(journal: readonly JournalDay[]): string[] {
  const last = journal[journal.length - 1]
  if (!last) return ['- 执行差：还没有留底。']
  let done = 0
  for (let i = 1; i < journal.length; i++) {
    for (const o of journal[i - 1]!.orders) {
      const before = journal[i - 1]!.positions.find(p => p.code === o.code)?.quantity ?? 0
      const after = journal[i]!.positions.find(p => p.code === o.code)?.quantity ?? 0
      if (o.side === 'BUY' ? after > before : after < before) done++
    }
  }
  const out: string[] = []
  for (const o of last.orders) {
    let start = journal.length - 1
    while (start > 0 && journal[start - 1]!.orders.some(x => x.code === o.code && sideOf(x) === sideOf(o))) start--
    const firstDay = journal[start]!
    const days = journal.length - start
    const then = firstDay.orders.find(x => x.code === o.code)?.refPrice ?? null
    const now = last.positions.find(p => p.code === o.code)?.close ?? null
    let cost = ''
    if (then && now && days > 1) {
      const move = now / then - 1
      const impact = o.shares * (then - now) / last.total
      cost = sideOf(o) === 'BUY' ? `；这期间股价 ${pct(move)}`
        : `；这期间股价 ${pct(move)}，${impact > 0 ? `没卖的这部分多亏了约占总资产 ${(impact * 100).toFixed(2)}%` : '没卖的这部分暂时没有多亏'}`
    }
    out.push(`- 执行差：${sideOf(o) === 'BUY' ? '买入' : '卖出'} ${o.name} ${o.shares} 股（${o.reason}），自 ${md(firstDay.date)} 起已挂 ${days} 个交易日未完成${cost}。`)
  }
  if (!last.orders.length) out.push('- 执行差：现在没有未完成的指令。')
  if (done) out.push(`- 留底以来，指令之后持仓确有相应变动的共 ${done} 次。`)
  return out
}

function tradeLines(trades: readonly TradeLog[], journal: readonly JournalDay[], prices: Readonly<Record<string, number>>): string[] {
  const voided = new Set(trades.filter(t => t.void).map(t => t.id))
  const live = trades.filter(t => !t.void && !voided.has(t.id) && t.code && t.side && t.date)
  if (!live.length) return ['- 交易记分：还没有登记的成交。成交后发一行字或成交截图。']
  const last = journal[journal.length - 1]
  return live.slice(-10).map(t => {
    const now = last?.positions.find(p => p.code === t.code)?.close ?? prices[t.code!]
    const ordered = journal.filter(j => j.date <= t.date!).pop()?.orders.some(o => o.code === t.code && sideOf(o) === t.side)
    const rule = ordered === undefined ? '当日没有留底，无法对照执行单' : ordered ? '规则内' : '规则外（执行单上没有，记为偏离）'
    const head = `- ${md(t.date!)} ${t.side === 'BUY' ? '买入' : '卖出'} ${t.name} ${t.quantity} 股`
    if (!t.price || !now) return `${head}：${rule}；缺成交价或现价，无法记分。`
    const move = now / t.price - 1
    return `${head}，成交价 ${t.price}：${rule}；之后股价 ${pct(move)}，`
      + (t.side === 'BUY' ? (move >= 0 ? '这笔暂时是赚的' : '这笔暂时是亏的') : (move <= 0 ? '卖出避开了之后的下跌' : '卖出之后股价上涨'))
      + '。'
  })
}

export function scoreMarkdown(journal: readonly JournalDay[], trades: readonly TradeLog[], prices: Readonly<Record<string, number>>): string {
  return [...navLines(journal, prices), ...gapLines(journal), ...tradeLines(trades, journal, prices)].join('\n')
}

/** 记分要用到、但不一定还在持仓里的股票 */
export function scoreCodes(journal: readonly JournalDay[], trades: readonly TradeLog[]): string[] {
  return [...new Set([...(journal[0]?.positions.map(p => p.code) ?? []), ...trades.map(t => t.code).filter((c): c is string => !!c)])]
}
