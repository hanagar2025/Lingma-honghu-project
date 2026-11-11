/**
 * 输入框背后的全部动作：收文字、收图片、挂上识别结果、确认、撤销。
 *
 * 生效规则：
 *   文字是本人所写，句式读得出就直接生效，可以撤销；
 *   图片由别人识别，必须先过勾稽核对，再由委员会本人确认才生效；
 *   内容自相矛盾的不生效。
 * 账本只被持仓快照整份替换。成交只作记录，不用来推算账本。
 */
import { COMMITTEE_ORDERS } from '../dailyDecision/orders'
import { MAINLINES } from '../msr/universe'
import { parseText, type NameBook } from './parseText'
import { checksPassed, classifyIntent, diffLedger, reconcileHoldings, toLedger, unverifiable, type DayRange } from './reconcile'
import { beijingStamp, decodeImage, type Store } from './store'
import type { HoldingsSnapshot, Parsed, Submission, TradeRecord } from './types'

export interface IntakeContext {
  store: Store
  now?: Date
  /** 当前执行单上的卖出指令：代码 → 股数。用于给意向定性；执行单停单时为 null */
  instructed?: Record<string, number> | null
  /** 当日最低价与最高价，用于核对截图上的现价 */
  ranges?: Record<string, DayRange>
}

export function nameBook(store: Store): NameBook {
  const book: NameBook = {}
  for (const m of MAINLINES) for (const x of m.members) book[x.name] = x.code
  for (const o of COMMITTEE_ORDERS) book[o.name] = o.code
  for (const p of store.readLedger()?.positions ?? []) book[p.name] = p.code
  return book
}

const SIDE_TEXT = { BUY: '买入', SELL: '卖出' } as const

function describe(parsed: Parsed): string {
  if (parsed.kind === 'HOLDINGS') {
    const h = parsed.holdings
    return `持仓快照 ${h.asOf}：${h.positions.map(p => `${p.name} ${p.quantity} 股`).join('，') || '空仓'}；现金 ${h.cash.toFixed(2)}`
  }
  if (parsed.kind === 'TRADE') {
    return `成交：${parsed.trades.map(t => `${SIDE_TEXT[t.side]} ${t.name} ${t.quantity} 股${t.price === null ? '（缺成交价）' : `，成交价 ${t.price}`}`).join('；')}`
  }
  if (parsed.kind === 'INTENT') {
    const i = parsed.intent
    return `下单前登记：计划${SIDE_TEXT[i.side]} ${i.name}${i.quantity === null ? '' : ` ${i.quantity} 股`}${i.reason ? `，理由：${i.reason}` : ''}`
  }
  return '留言，已转给战略侧'
}

/** 让一条已经读懂的内容生效 */
function apply(ctx: IntakeContext, s: Submission): void {
  const p = s.parsed
  if (!p) return
  if (p.kind === 'HOLDINGS') ctx.store.writeLedger(toLedger(p.holdings, ctx.store.readLedger()), s.id)
  if (p.kind === 'TRADE') for (const t of p.trades) ctx.store.append('trades', { id: s.id, receivedAt: s.receivedAt, ...t })
  if (p.kind === 'INTENT') ctx.store.append('intents', { id: s.id, receivedAt: s.receivedAt, ...p.intent, verdict: s.verdict })
}

/** 旧日期的持仓不能盖掉更新的账本。同一天的可以，后发的为准 */
function olderThanLedger(store: Store, h: HoldingsSnapshot): string | null {
  const current = store.readLedger()?.asOf
  return current && h.asOf < current ? `这份持仓的日期 ${h.asOf} 早于当前账本 ${current}，不能覆盖` : null
}

function heldNow(store: Store): Record<string, number> {
  return Object.fromEntries((store.readLedger()?.positions ?? []).filter(p => p.quantity > 0).map(p => [p.code, p.quantity]))
}

export function submitText(ctx: IntakeContext, text: string): Submission {
  const now = ctx.now ?? new Date()
  const receivedAt = beijingStamp(now)
  const { parsed, errors } = parseText(text, nameBook(ctx.store), receivedAt.slice(0, 10))
  const s: Submission = { id: ctx.store.newId(now), receivedAt, source: 'TEXT', text, status: 'RECORDED', parsed, parsedBy: 'RULE' }

  if (errors.length) {
    s.status = 'NEEDS_FIX'
    s.summary = `没有生效：${errors.join('；')}`
    return ctx.store.save(s)
  }
  if (parsed.kind === 'HOLDINGS') {
    s.checks = reconcileHoldings(parsed.holdings)
    const older = olderThanLedger(ctx.store, parsed.holdings)
    if (!checksPassed(s.checks) || older) {
      s.status = 'NEEDS_FIX'
      s.summary = `没有生效：${[...s.checks.filter(c => c.ok === false).map(c => c.detail), ...(older ? [older] : [])].join('；')}`
      return ctx.store.save(s)
    }
    s.summary = `${describe(parsed)}。${diffLedger(ctx.store.readLedger(), parsed.holdings).join('；')}。`
      + (unverifiable(s.checks) ? '文字没有金额可供勾稽，截图更可靠。' : '')
  } else {
    s.summary = describe(parsed)
  }
  if (parsed.kind === 'INTENT') s.verdict = classifyIntent(parsed.intent, ctx.instructed === undefined ? {} : ctx.instructed, heldNow(ctx.store))
  apply(ctx, s)
  return ctx.store.save(s)
}

export function submitImage(ctx: IntakeContext, dataUrl: string, note?: string): Submission | string {
  const image = decodeImage(dataUrl)
  if (!image) return '只接收 PNG、JPEG 或 WebP 图片'
  const now = ctx.now ?? new Date()
  const id = ctx.store.newId(now)
  return ctx.store.save({
    id, receivedAt: beijingStamp(now), source: 'IMAGE', status: 'PENDING_PARSE',
    imageFile: ctx.store.saveImage(id, image.ext, image.bytes),
    ...(note?.trim() ? { text: note.trim() } : {}),
    summary: '图片已收到，等待识别。识别结果出来后需要您确认。',
  })
}

function num(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

/** 识别结果来自外部，逐字段检查后才接收 */
export function validateParsed(x: unknown): Parsed | string {
  if (!x || typeof x !== 'object') return '识别结果不是对象'
  const o = x as Record<string, unknown>
  if (o.kind === 'NOTE') return { kind: 'NOTE' }
  if (o.kind === 'HOLDINGS') {
    const h = o.holdings as Record<string, unknown> | undefined
    if (!h || typeof h.asOf !== 'string' || !num(h.cash) || !Array.isArray(h.positions)) return '持仓快照缺少日期、现金或持仓列表'
    const positions: HoldingsSnapshot['positions'] = []
    for (const raw of h.positions as Record<string, unknown>[]) {
      if (!raw || typeof raw.code !== 'string' || typeof raw.name !== 'string' || !num(raw.quantity)) return '持仓行缺少代码、名称或股数'
      positions.push({
        code: raw.code, name: raw.name, quantity: raw.quantity,
        ...(num(raw.price) ? { price: raw.price } : {}),
        ...(num(raw.marketValue) ? { marketValue: raw.marketValue } : {}),
        ...(num(raw.cost) ? { cost: raw.cost } : {}),
      })
    }
    return {
      kind: 'HOLDINGS',
      holdings: {
        asOf: h.asOf, cash: h.cash, positions,
        ...(num(h.totalAssets) ? { totalAssets: h.totalAssets } : {}),
        ...(num(h.totalMarketValue) ? { totalMarketValue: h.totalMarketValue } : {}),
      },
    }
  }
  if (o.kind === 'TRADE') {
    if (!Array.isArray(o.trades) || !o.trades.length) return '成交记录是空的'
    const trades: TradeRecord[] = []
    for (const raw of o.trades as Record<string, unknown>[]) {
      if (!raw || typeof raw.date !== 'string' || (raw.side !== 'BUY' && raw.side !== 'SELL')
        || typeof raw.code !== 'string' || !/^\d{6}$/.test(raw.code) || typeof raw.name !== 'string'
        || !num(raw.quantity) || raw.quantity <= 0 || !(raw.price === null || num(raw.price))) return '成交记录缺少日期、方向、代码、股数或价格'
      trades.push({ date: raw.date, side: raw.side, code: raw.code, name: raw.name, quantity: raw.quantity, price: raw.price as number | null })
    }
    return { kind: 'TRADE', trades }
  }
  return '识别结果只能是持仓、成交或留言'
}

/** 识别方交回结果。只挂在等待识别的图片上；过了勾稽核对才进入待确认 */
export function attachParsed(ctx: IntakeContext, id: string, payload: unknown): Submission | string {
  const s = ctx.store.get(id)
  if (!s) return '没有这条提交'
  if (s.status !== 'PENDING_PARSE' && s.status !== 'NEEDS_FIX') return '这条提交不在等待识别的状态'
  const parsed = validateParsed(payload)
  if (typeof parsed === 'string') return parsed
  s.parsed = parsed
  s.parsedBy = 'AGENT'
  if (parsed.kind === 'HOLDINGS') {
    s.checks = reconcileHoldings(parsed.holdings, ctx.ranges)
    const older = olderThanLedger(ctx.store, parsed.holdings)
    if (!checksPassed(s.checks) || unverifiable(s.checks) || older) {
      s.status = 'NEEDS_FIX'
      s.summary = older ?? `识别结果没有通过核对，不能确认：${s.checks.filter(c => c.ok !== true).map(c => `${c.name}（${c.detail}）`).join('；')}`
      return ctx.store.save(s)
    }
    s.summary = `${describe(parsed)}。${diffLedger(ctx.store.readLedger(), parsed.holdings).join('；')}。`
  } else {
    s.summary = describe(parsed)
  }
  s.status = parsed.kind === 'NOTE' ? 'RECORDED' : 'PENDING_CONFIRM'
  return ctx.store.save(s)
}

export function confirm(ctx: IntakeContext, id: string): Submission | string {
  const s = ctx.store.get(id)
  if (!s) return '没有这条提交'
  if (s.status !== 'PENDING_CONFIRM') return '这条提交不在等待确认的状态'
  // 等待确认期间账本可能已被更新的持仓替换
  const older = s.parsed?.kind === 'HOLDINGS' ? olderThanLedger(ctx.store, s.parsed.holdings) : null
  if (older) return older
  apply(ctx, s)
  s.status = 'CONFIRMED'
  s.settledAt = beijingStamp(ctx.now ?? new Date())
  return ctx.store.save(s)
}

/**
 * 撤销。待确认的识别结果可以否决；已生效的成交与意向只追加一条撤销记录，原记录不删。
 * 已生效的账本不能撤销，发一份新的持仓来覆盖。
 */
export function reject(ctx: IntakeContext, id: string): Submission | string {
  const s = ctx.store.get(id)
  if (!s) return '没有这条提交'
  if (s.status === 'REJECTED') return '这条提交已经撤销'
  const effective = s.status === 'RECORDED' || s.status === 'CONFIRMED'
  if (effective && s.parsed?.kind === 'HOLDINGS') return '账本已经按这份持仓更新，不能撤销；请发一份新的持仓来覆盖'
  const at = beijingStamp(ctx.now ?? new Date())
  if (effective && s.parsed?.kind === 'TRADE') ctx.store.append('trades', { id: s.id, receivedAt: at, void: true })
  if (effective && s.parsed?.kind === 'INTENT') ctx.store.append('intents', { id: s.id, receivedAt: at, void: true })
  s.status = 'REJECTED'
  s.settledAt = at
  return ctx.store.save(s)
}
