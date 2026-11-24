/**
 * 指令簿：执行单上每一条买卖指令从哪天起、到哪天止。存在私有目录 <DATA_DIR>/chain/orders.json，不进仓库。
 *
 * 指令只有三个来源：
 *   规则卖出   《半年计划》第二节：资金 0 分 → 清仓；收盘跌破 60 日线且融资在降 → 清仓；资金分连续 2 天 ≤1 → 减半
 *   盯线卖出   策略方登记、写明卖出档位的收盘线（第三节的个股线）
 *   策略方登记 买入（买到占总资产多少为止）和卖出。系统自己不生成买入
 *
 * 规则卖出只按定稿的资金分生成：融资余额次日早间公布，公布前的资金分是初算，只提示、不成指令。
 * 缺数据核对不了的条件不算成立，也不算不成立。
 * 指令在触发后的下一个交易日执行，没成交按原条件顺延 3 个交易日，之后作废（第六节第 5 条）。
 * 账本显示已经卖到位、买到位的指令自动结束。
 *
 * 系统不下单。指令是给她本人看的下单计划。
 */
import type { LineStatus } from '../chain/watch'
import { describeLine } from '../chain/watch'
import { sellCheck, type Evidence } from './evidence'
import { PLAN, sharesForBuyValue, sharesForFraction, type LinesCalc } from './rules'

export type Origin = 'RULE_ZERO' | 'RULE_TREND' | 'RULE_HALVE' | 'WATCH' | 'STRATEGY'
export type Portion = 'ALL' | 'HALF' | 'THIRD'

export interface Instruction {
  id: string
  code: string
  name: string
  side: 'SELL' | 'BUY'
  origin: Origin
  /** 条件和当时的读数。不写股数和金额 */
  reason: string
  /** 出处：规则章节，或策略方写的文档 */
  source: string
  /** 条件成立的那个收盘日；策略方登记的是登记时最近的收盘日 */
  triggerDate: string
  createdAt: string
  /** 卖出：卖多少（全部、一半、三分之一；合并过的写成文字） */
  portion?: string
  /** 卖出：卖后最多持有的股数（清仓为 0） */
  keep?: number
  /** 买入：买到占总资产多少为止，小数 */
  targetWeight?: number
  status: 'OPEN' | 'DONE' | 'EXPIRED' | 'CANCELLED'
  closedAt?: string
  closedWhy?: string
}

export interface BackupMode { since: string; why: string }

export interface OrderBook {
  instructions: Instruction[]
  /** 已经触发过、在条件解除之前不再重复生成的规则：键 → 触发的收盘日 */
  fired: Record<string, string>
  /** 已切换备用目标（单票上限 10%，股票 ≤50%）。null = 没有切换 */
  backup: BackupMode | null
  updatedAt: string
}

export const EMPTY_BOOK: OrderBook = { instructions: [], fired: {}, backup: null, updatedAt: '' }

const PORTION_TEXT: Record<Portion, string> = { ALL: '全部', HALF: '一半', THIRD: '三分之一' }
const FRACTION: Record<Portion, number> = { ALL: 1, HALF: 0.5, THIRD: 1 / 3 }
const MAX_CLOSED = 300
const RULE_SOURCE = '《半年计划》第二节'

export interface BookFacts {
  /** 北京时间 YYYY-MM-DD HH:mm:ss */
  now: string
  /** 已收盘的交易日，旧的在前 */
  tradingDates: readonly string[]
  holdings: readonly { code: string; name: string; quantity: number; price: number | null }[]
  /** 总资产；算不出为 null */
  total: number | null
  evidence: Evidence | null
  /** 按最近收盘日算的盯线状态 */
  watch: readonly LineStatus[]
  lines: LinesCalc
}

export interface SyncResult {
  book: OrderBook
  changed: boolean
  /** 这次核对里指令簿发生了什么 */
  events: string[]
  /** 核对不了的、初算成立待定稿的、条件还在但已经没有指令的 */
  notices: string[]
}

/** 触发日之后已经收盘了几个交易日 */
export function closedSince(triggerDate: string, tradingDates: readonly string[]): number {
  return tradingDates.filter(d => d > triggerDate).length
}

export const openOf = (book: OrderBook): Instruction[] => book.instructions.filter(i => i.status === 'OPEN')

function newId(book: OrderBook, date: string, code: string, origin: Origin): string {
  const stem = `${date}-${code}-${origin.toLowerCase()}`
  let id = stem
  for (let n = 2; book.instructions.some(i => i.id === id); n++) id = `${stem}-${n}`
  return id
}

const pct1 = (v: number): string => `${(v * 100).toFixed(1)}%`

/**
 * 核对一遍：已到位的结束，过期的作废，新成立的条件生成指令。同样的事实核对两遍，结果不变。
 */
export function syncBook(input: OrderBook, facts: BookFacts): SyncResult {
  const book: OrderBook = {
    instructions: input.instructions.map(i => ({ ...i })), fired: { ...input.fired }, backup: input.backup, updatedAt: input.updatedAt,
  }
  const events: string[] = []
  const notices: string[] = []
  const held = new Map(facts.holdings.map(h => [h.code, h]))
  const qty = (code: string): number => held.get(code)?.quantity ?? 0
  const close = (i: Instruction, status: Instruction['status'], why: string): void => {
    i.status = status
    i.closedAt = facts.now
    i.closedWhy = why
    events.push(`${i.name} ${i.side === 'SELL' ? '卖出' : '买入'}指令（${i.triggerDate} 触发）：${why}`)
  }

  // 1. 已到位的结束，过期的作废
  for (const i of openOf(book)) {
    if (i.side === 'SELL') {
      if (qty(i.code) <= (i.keep ?? 0)) { close(i, 'DONE', '账本显示已卖到位，结束'); continue }
    } else {
      const h = held.get(i.code)
      if (h && h.quantity > 0 && h.price && facts.total && i.targetWeight !== undefined) {
        const gap = (i.targetWeight - (h.quantity * h.price) / facts.total) * facts.total
        if (sharesForBuyValue(i.code, gap, h.price) === 0) { close(i, 'DONE', '账本显示已买到位，结束'); continue }
      }
    }
    if (closedSince(i.triggerDate, facts.tradingDates) >= PLAN.validTradingDays) {
      close(i, 'EXPIRED', `顺延 ${PLAN.validTradingDays - 1} 个交易日仍未完成，作废`)
    }
  }

  const openSell = (code: string): Instruction | undefined => openOf(book).find(i => i.side === 'SELL' && i.code === code)

  /** 生成一条卖出。同一只股票已有未执行的卖出时并成一条：新的一档在原来卖剩的基础上再算 */
  const addSell = (code: string, name: string, origin: Origin, portion: Portion, reason: string, source: string, triggerDate: string): void => {
    const have = openSell(code)
    if (have && (have.keep ?? 0) === 0) {
      notices.push(`${name}：${reason}。已有一条未执行的清仓指令，不另生成`)
      return
    }
    const baseQty = have ? Math.min(qty(code), have.keep ?? 0) : qty(code)
    if (!(baseQty > 0)) return
    const keep = portion === 'ALL' ? 0 : baseQty - sharesForFraction(code, baseQty, FRACTION[portion])
    let text = PORTION_TEXT[portion]
    let why = reason
    if (have) {
      close(have, 'CANCELLED', portion === 'ALL' ? '被清仓指令取代' : '并入新的卖出指令')
      if (portion !== 'ALL') text = `${have.portion ?? ''}，再卖剩余的${PORTION_TEXT[portion]}`
      why = `${reason}；此前未执行的一条：${have.reason}`
    }
    book.instructions.push({
      id: newId(book, triggerDate, code, origin), code, name, side: 'SELL', origin, reason: why, source, triggerDate,
      createdAt: facts.now, portion: text, keep, status: 'OPEN',
    })
    events.push(`${name}：生成卖出指令（${text}）—— ${reason}`)
  }

  // 2. 规则卖出
  // 已经不持有的股票，触发记录清掉：以后再买回来，条件成立时照常生成
  for (const key of Object.keys(book.fired)) {
    const [kind, code] = key.split(':')
    if (kind !== 'watch' && code && !(qty(code) > 0)) delete book.fired[key]
  }
  const ev = facts.evidence
  for (const h of facts.holdings) {
    if (!(h.quantity > 0)) continue
    const now = ev?.now[h.code]
    if (!ev || !now) { notices.push(`${h.name}：没有资金分读数，卖出条件核对不了。不算成立，也不算不成立`); continue }
    if (now.date !== ev.asOf) { notices.push(`${h.name}：日线停在 ${now.date}，${ev.asOf} 的卖出条件核对不了`); continue }
    const check = sellCheck(now, ev.prev[h.code])
    const zeroKey = `zero:${h.code}`
    const halveKey = `halve:${h.code}`
    const trendKey = `trend:${h.code}`
    // 条件解除：资金分确定回到 1 分以上、2 分以上，下一次成立时重新生成
    if (now.c >= 1) delete book.fired[zeroKey]
    if (now.c >= 2) delete book.fired[halveKey]
    if (check.unsure) notices.push(`${h.name}：${check.unsure}。不算成立，也不算不成立，数据补上后重算`)

    const hits: { key: string; origin: Origin; portion: Portion; reason: string; state: boolean }[] = []
    if (check.clearByC) hits.push({ key: zeroKey, origin: 'RULE_ZERO', portion: 'ALL', reason: `资金 0 分（${now.date} 收盘）`, state: true })
    if (check.clearByTrend) {
      hits.push({
        key: trendKey, origin: 'RULE_TREND', portion: 'ALL', state: false,
        reason: `${now.date} 收盘跌破 60 日线（相对该线 ${pct1(now.d60 ?? 0)}），5 日融资 ${pct1(now.margin5 ?? 0)}`,
      })
    }
    if (check.halve) {
      hits.push({
        key: halveKey, origin: 'RULE_HALVE', portion: 'HALF', state: true,
        reason: `资金分连续 2 天 ≤1（${ev.prev[h.code]!.date} 为 ${ev.prev[h.code]!.c}，${now.date} 为 ${now.c}）`,
      })
    }
    for (const hit of hits) {
      if (check.provisional) {
        notices.push(`${h.name}：${hit.reason}，初算成立。${now.date} 的融资余额还没公布，公布后定稿；定稿仍成立才生成指令`)
        continue
      }
      const firedAt = book.fired[hit.key]
      if (firedAt === undefined || (!hit.state && firedAt !== now.date)) {
        book.fired[hit.key] = now.date
        addSell(h.code, h.name, hit.origin, hit.portion, hit.reason, RULE_SOURCE, now.date)
      } else if (hit.state && !openSell(h.code)) {
        // 条件一直成立，但那条指令已经结束：不重复生成，照实写出来
        const last = [...book.instructions].reverse().find(i => i.code === h.code && i.origin === hit.origin)
        const how = last?.status === 'DONE' ? '已执行' : last?.status === 'EXPIRED' ? '已顺延期满作废'
          : /并入|取代/.test(last?.closedWhy ?? '') ? '已并入另一条指令' : '已撤销'
        notices.push(`${h.name}：${hit.reason}，条件仍成立；${firedAt} 触发的那条指令${how}。规则没有写再卖一次，不重复生成；要不要再卖由策略方登记`)
      }
    }
  }

  // 3. 盯线卖出：只认收盘判定、写了卖出档位的线
  for (const s of facts.watch) {
    if (s.basis !== 'close' || !s.sell || !(qty(s.code) > 0)) continue
    const key = `watch:${s.id}`
    if (s.beyond === false) { delete book.fired[key]; continue }
    if (s.hit === null) {
      notices.push(`${describeLine(s)}：${s.beyond === null ? '线的价位算不出' : '附加条件缺数据'}，核对不了。不算成立，也不算不成立`)
      continue
    }
    if (!s.hit || !s.barDate || book.fired[key] !== undefined) continue
    book.fired[key] = s.barDate
    addSell(s.code, s.name || held.get(s.code)?.name || s.code, 'WATCH', s.sell, `${describeLine(s)}，${s.barDate} 收盘成立。规则写的动作：${s.action}`, s.source, s.barDate)
  }

  // 4. 触及预警线：切换备用目标（第五节第 3 条）。切换后不自动切回
  if (!book.backup && (facts.lines.level === 'WARN' || facts.lines.level === 'STOP') && facts.lines.navIndex !== null) {
    book.backup = { since: facts.now.slice(0, 10), why: `净值指数 ${facts.lines.navIndex.toFixed(1)}，触及预警线 ${PLAN.lines.warn}` }
    events.push(`已切换备用目标：${book.backup.why}。此后单票上限 ${pct1(PLAN.backup.singleCap)}，股票不超过 ${pct1(PLAN.backup.equityCap)}`)
  }

  // 结束了的指令只留最近的一批
  const closed = book.instructions.filter(i => i.status !== 'OPEN')
  if (closed.length > MAX_CLOSED) {
    const drop = new Set(closed.slice(0, closed.length - MAX_CLOSED).map(i => i.id))
    book.instructions = book.instructions.filter(i => !drop.has(i.id))
  }
  const changed = JSON.stringify({ ...book, updatedAt: '' }) !== JSON.stringify({ ...input, updatedAt: '' })
  if (changed) book.updatedAt = facts.now
  return { book, changed, events, notices }
}

// ── 策略方登记 ──

export interface RegisterContext {
  now: string
  /** 登记时最近的已收盘交易日 */
  triggerDate: string
  holdings: readonly { code: string; name: string; quantity: number }[]
}

/** 校验并登记一条策略方的指令。返回错误原因，或新的指令簿 */
export function registerOrder(book: OrderBook, raw: unknown, ctx: RegisterContext): { book: OrderBook; instruction: Instruction } | string {
  const r = (raw ?? {}) as Record<string, unknown>
  const code = String(r.code ?? '')
  const reason = String(r.reason ?? '').trim()
  const source = String(r.source ?? '').trim()
  if (!/^\d{6}$/.test(code)) return '代码不对'
  if (r.side !== 'SELL' && r.side !== 'BUY') return 'side 只能是 SELL 或 BUY'
  if (!reason || reason.length > 300) return '要写理由（300 字以内）：成立的条件和读数'
  if (!source || source.length > 200) return '要写出处（200 字以内）'
  if (/\d\s*股|万元|\d\s*万/.test(reason)) return '理由里不写股数和金额，只写比例和读数'
  const h = ctx.holdings.find(x => x.code === code)
  const name = String(r.name ?? h?.name ?? '').trim().slice(0, 20)
  if (!name) return '要写股票名称'
  if (openOf(book).some(i => i.code === code && i.side === r.side)) return `${name} 已有一条未结束的${r.side === 'SELL' ? '卖出' : '买入'}指令，先撤销或等它结束`
  const base = { id: newId(book, ctx.triggerDate, code, 'STRATEGY'), code, name, origin: 'STRATEGY' as const, reason, source, triggerDate: ctx.triggerDate, createdAt: ctx.now, status: 'OPEN' as const }
  let instruction: Instruction
  if (r.side === 'SELL') {
    if (r.sell !== 'ALL' && r.sell !== 'HALF' && r.sell !== 'THIRD') return 'sell 只能是 ALL、HALF 或 THIRD'
    if (!h || !(h.quantity > 0)) return `账本里没有 ${name} 的持仓`
    const keep = r.sell === 'ALL' ? 0 : h.quantity - sharesForFraction(code, h.quantity, FRACTION[r.sell])
    instruction = { ...base, side: 'SELL', portion: PORTION_TEXT[r.sell], keep }
  } else {
    const w = r.targetWeight
    const max = PLAN.addCap[6]!
    if (typeof w !== 'number' || !(w > 0) || w > max) return `targetWeight 写成小数，大于 0、不超过 ${max}（单票上限 ${pct1(max)}）`
    instruction = { ...base, side: 'BUY', targetWeight: w }
  }
  return { book: { ...book, instructions: [...book.instructions, instruction], updatedAt: ctx.now }, instruction }
}

/** 撤销一条未结束的指令。策略方撤自己的，委员会可以否决任何一条 */
export function cancelOrder(book: OrderBook, id: string, by: string, now: string): OrderBook | string {
  const target = book.instructions.find(i => i.id === id)
  if (!target) return '没有这条指令'
  if (target.status !== 'OPEN') return '这条指令已经结束'
  return {
    ...book, updatedAt: now,
    instructions: book.instructions.map(i => (i.id === id ? { ...i, status: 'CANCELLED' as const, closedAt: now, closedWhy: `由${by}撤销` } : i)),
  }
}

/** 切换或撤回备用目标 */
export function setBackup(book: OrderBook, on: unknown, why: unknown, now: string): OrderBook | string {
  if (typeof on !== 'boolean') return 'on 只能是 true 或 false'
  const text = String(why ?? '').trim()
  if (!text || text.length > 200) return '要写原因（200 字以内）'
  return { ...book, updatedAt: now, backup: on ? { since: now.slice(0, 10), why: text } : null }
}

/** 给接口用：不带股数 */
export function publicBook(book: OrderBook): { instructions: Omit<Instruction, 'keep'>[]; backup: BackupMode | null; updatedAt: string } {
  return {
    instructions: [...book.instructions].reverse().slice(0, 100).map(({ keep: _keep, ...rest }) => rest),
    backup: book.backup, updatedAt: book.updatedAt,
  }
}
