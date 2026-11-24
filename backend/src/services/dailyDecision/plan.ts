/**
 * 把《半年计划》的规则套到今天的账户上：证据分读数、指令簿核对、买入指令过规则。
 *
 * 只在价格两源核对通过之后才核对指令簿（sync）。没通过时只把原有的指令列出来，不新增、不结束。
 */
import type { SeriesView } from '../chain/view'
import type { LineStatus } from '../chain/watch'
import { closedSince, openOf, syncBook, type Instruction, type OrderBook } from './book'
import { buildEvidence, sellCheck, type Evidence, type Score } from './evidence'
import { PLAN, sharesForBuyValue } from './rules'
import type { BuyGate, DecisionInput, DecisionSession, EvidenceRow, PlanFacts } from './types'

export interface PlanContext {
  view: SeriesView | null
  /** 按最近收盘日算的盯线状态 */
  watch: LineStatus[]
  book: OrderBook
  /** 指令簿有变化时写回私有目录 */
  saveBook: (book: OrderBook) => void
  /** 净值指数创了新高时写回 */
  saveHigh?: (index: number) => void
}

const pct1 = (v: number): string => `${(v * 100).toFixed(1)}%`
const isRelated = (segment: string): boolean => PLAN.related.segments.includes(segment)

function sellNote(now: Score | undefined, prev: Score | undefined, asOf: string | null): string {
  if (!now) return '没有读数，核对不了'
  if (now.date !== asOf) return `日线停在 ${now.date}，核对不了`
  const check = sellCheck(now, prev)
  const met = check.clearByC || check.clearByTrend ? '清仓条件' : check.halve ? '减半条件' : null
  if (met) return check.provisional ? `${met}初算成立，待定稿` : `${met}成立`
  if (check.unsure) return '缺数据，核对不了'
  return check.provisional ? '初算未成立' : '未成立'
}

function evidenceRows(input: DecisionInput, ev: Evidence | null, view: SeriesView | null): EvidenceRow[] {
  const total = input.snapshot.portfolioTotal
  return input.holdings.filter(h => h.quantity > 0).map(h => {
    const now = ev?.now[h.code]
    const segment = now?.segment ?? view?.segments.find(s => s.codes.includes(h.code))?.segment ?? ''
    const weight = total > 0 && h.close !== null ? (h.quantity * h.close) / total : 0
    return {
      code: h.code, name: h.name, segment, weight,
      c: now?.c ?? null, cUnknown: now?.cUnknown ?? 0, cUnknownWhy: now?.cUnknownWhy ?? [],
      t: now?.t ?? null, deduction: now?.deduction ?? null, deductionWhy: now?.deductionWhy ?? null, e: now?.e ?? null,
      provisional: now?.provisional ?? false,
      addCap: now ? PLAN.addCap[now.e] ?? 0 : 0,
      sellNote: sellNote(now, ev?.prev[h.code], ev?.asOf ?? null),
    }
  }).sort((a, b) => b.weight - a.weight)
}

/** 买入指令逐条过规则。前面放行的买入会占掉后面的现金、仓位和相关环节额度 */
function gateBuys(input: DecisionInput, ev: Evidence | null, plan: Pick<PlanFacts, 'instructions' | 'rows' | 'backup' | 'relatedWeight'>): BuyGate[] {
  const total = input.snapshot.portfolioTotal
  const lines = input.lines
  let cash = input.snapshot.cash
  let stockWeight = total > 0 ? input.snapshot.positionsValue / total : 1
  let related = plan.relatedWeight
  const out: BuyGate[] = []
  for (const i of plan.instructions.filter(x => x.side === 'BUY')) {
    const h = input.holdings.find(x => x.code === i.code && x.quantity > 0)
    const row = plan.rows.find(r => r.code === i.code)
    const score = ev?.now[i.code]
    const weight = row?.weight ?? 0
    const isNew = !h
    const price = h?.close ?? score?.close ?? null
    const target = i.targetWeight ?? 0
    const notes: string[] = []
    const stop = (blocked: string): void => { out.push({ id: i.id, shares: 0, refPrice: price, blocked, allowedWeight: weight, notes }) }
    const nav = lines.navIndex?.toFixed(1)

    if (lines.level === 'NO_BASE') { stop('净值指数算不出，三条线核对不了，核对不了时不买'); continue }
    if (lines.level === 'TARGET') { stop(`净值指数 ${nav} 已到目标 ${PLAN.lines.target}，不再买入`); continue }
    if (lines.buyBlocked) { stop(`净值指数 ${nav} 触及停手线 ${lines.stop}，停止一切买入`); continue }
    if (isNew && lines.newEntryBlocked) { stop(`净值指数 ${nav} 触及观察线 ${PLAN.lines.watch}，不开新股票`); continue }
    if (plan.instructions.some(x => x.side === 'SELL' && x.code === i.code)) { stop('这只股票有未执行的卖出指令'); continue }
    if (!score || !ev) { stop('没有证据分读数（不在全链名单内，或链上数据还没拉到）'); continue }
    if (score.date !== ev.asOf) { stop(`日线停在 ${score.date}，证据分不是最新的`); continue }
    if (score.provisional) { stop(`证据分还是初算（${score.date} 的融资余额没公布），定稿后再出股数`); continue }
    if (isNew) {
      if (score.e < PLAN.entry.minE) { stop(`E=${score.e}，新开仓要 E≥${PLAN.entry.minE}`); continue }
      if (score.deduction > 0) { stop(`有基本面扣分（${score.deductionWhy}），不开仓`); continue }
      if (score.amount < PLAN.entry.minAmount) { stop(`${score.date} 成交 ${(score.amount / 1e8).toFixed(1)} 亿，不到 10 亿`); continue }
      notes.push(`下单时当天涨幅须不超过 ${pct1(PLAN.entry.maxPct)}，超过则当天不买`)
    }
    let cap = PLAN.addCap[score.e] ?? 0
    if (cap === 0) { stop(`E=${score.e}，不加`); continue }
    let capWhy = `证据分 E=${score.e} 对应上限 ${pct1(cap)}`
    if (plan.backup && cap > PLAN.backup.singleCap) { cap = PLAN.backup.singleCap; capWhy = `已切换备用目标，单票上限 ${pct1(cap)}` }
    let allowed = Math.min(target, cap)
    notes.push(`目标占比 ${pct1(target)}；${capWhy}`)
    if (score.cUnknown > 0) notes.push(`资金分缺${score.cUnknownWhy.join('、')}，缺的按 0 分算`)

    if (isRelated(score.segment)) {
      const room = PLAN.related.cap - related
      if (!(room > 0)) { stop(`相关环节（光模块加 PCB）合计 ${pct1(related)}，已到 ${pct1(PLAN.related.cap)}，不加`); continue }
      if (weight + room < allowed) { allowed = weight + room; notes.push(`相关环节合计 ${pct1(related)}，只剩 ${pct1(room)} 的额度`) }
    }
    const equityCap = Math.min(lines.equityCap ?? 1, plan.backup ? PLAN.backup.equityCap : 1)
    if (equityCap < 1) {
      const room = equityCap - stockWeight
      if (!(room > 0)) { stop(`股票占比 ${pct1(stockWeight)}，已到上限 ${pct1(equityCap)}`); continue }
      if (weight + room < allowed) { allowed = weight + room; notes.push(`股票占比上限 ${pct1(equityCap)}，只剩 ${pct1(room)} 的额度`) }
    }
    if (!(allowed > weight)) { stop(`现占比 ${pct1(weight)}，已到上限 ${pct1(allowed)}`); continue }
    if (price === null || !(price > 0)) { stop('取不到价格，算不出股数'); continue }
    let value = (allowed - weight) * total
    if (!(cash > 0)) { stop('账内没有可用现金（未执行的卖出不计入）'); continue }
    if (value > cash) { value = cash; notes.push('按账内现金封顶（未执行的卖出不计入）') }
    const shares = sharesForBuyValue(i.code, value, price)
    if (shares === 0) { stop('可买的金额不够一手'); continue }
    const spent = shares * price
    cash -= spent
    stockWeight += spent / total
    if (isRelated(score.segment)) related += spent / total
    if (isNew) notes.push('参考价是最近收盘价')
    out.push({ id: i.id, shares, refPrice: price, blocked: null, allowedWeight: weight + spent / total, notes })
  }
  return out
}

/** 已收盘的交易日。收盘后那一单把当天也算上；其余时段只算今天之前的 */
function closedDates(view: SeriesView | null, input: DecisionInput, session: DecisionSession, today: string): string[] {
  const dates = new Set<string>()
  for (const s of Object.values(view?.stocks ?? {})) for (const r of s.rows) dates.add(r.date)
  if (session === 'POST_CLOSE') dates.add(input.date)
  return [...dates].filter(d => (session === 'POST_CLOSE' ? d <= input.date : d < today)).sort()
}

export function buildPlan(
  input: DecisionInput, session: DecisionSession, ctx: PlanContext, opts: { sync: boolean; now: string },
): PlanFacts {
  const ev = buildEvidence(ctx.view)
  const total = input.snapshot.portfolioTotal
  const tradingDates = closedDates(ctx.view, input, session, opts.now.slice(0, 10))
  let book = ctx.book
  let events: string[] = []
  let notices: string[] = []
  if (opts.sync) {
    const result = syncBook(book, {
      now: opts.now, tradingDates,
      holdings: input.holdings.map(h => ({ code: h.code, name: h.name, quantity: h.quantity, price: h.close })),
      total: total > 0 ? total : null, evidence: ev, watch: ctx.watch, lines: input.lines,
    })
    if (result.changed) ctx.saveBook(result.book)
    book = result.book
    events = result.events
    notices = result.notices
    if (input.lines.navIndex !== null && input.lines.navHigh !== null && input.lines.navIndex >= input.lines.navHigh) ctx.saveHigh?.(input.lines.navIndex)
    if (session === 'PRE_OPEN' && ev && ev.asOf < input.date) notices.unshift(`链上数据停在 ${ev.asOf}，比行情（${input.date}）旧。卖出条件核对的是 ${ev.asOf} 的数`)
  }
  const rows = evidenceRows(input, ev, ctx.view)
  const instructions: Instruction[] = openOf(book)
  const relatedWeight = rows.filter(r => isRelated(r.segment)).reduce((s, r) => s + r.weight, 0)
  const partial = { instructions, rows, backup: book.backup, relatedWeight }
  return {
    asOf: ev?.asOf ?? null, marginAsOf: ev?.marginAsOf ?? null, synced: opts.sync, ...partial,
    rolled: Object.fromEntries(instructions.map(i => [i.id, closedSince(i.triggerDate, tradingDates)])),
    buys: opts.sync ? gateBuys(input, ev, partial) : [],
    events, notices,
  }
}
