/**
 * 盯线。线由策略方登记（固定价位、20 日线、60 日线、60 日最低收盘价），这里只算“现价在线的哪一边、差多少”。
 * 不产生买卖指令：越线只是读数，动作写的是规则原文。
 */
import type { LineLevel, StockSeries, WatchLine } from './types'

export interface LineStatus {
  id: string
  code: string
  name: string
  basis: WatchLine['basis']
  op: WatchLine['op']
  level: LineLevel
  /** 线的价位；数据不够算不出为 null */
  levelValue: number | null
  price: number | null
  /** 现价相对线的距离，小数。正数 = 在线上方 */
  distance: number | null
  /** 现价已经在触发的那一边 */
  beyond: boolean | null
  and: WatchLine['and']
  /** 附加条件成立与否；没有附加条件为 null，数据缺也为 null */
  andMet: boolean | null
  /** 越线且附加条件成立（没有附加条件时只看越线） */
  hit: boolean | null
  action: string
  source: string
}

export interface LiveQuote { price: number; main: number | null }

const mean = (xs: number[]): number => xs.reduce((s, x) => s + x, 0) / xs.length

/**
 * live：盘中现价。给了就按“今天这一根还没收”算：均线用前 19、59 个收盘价加现价，60 日最低只看此前的收盘价。
 * 不给就按最近一个已收盘日算。
 */
export function lineStatus(line: WatchLine, series: StockSeries | null, live: LiveQuote | null): LineStatus {
  const closes = series?.bars.map(b => b.close) ?? []
  const lastBar = series?.bars[series.bars.length - 1] ?? null
  const price = live?.price ?? lastBar?.close ?? null
  // 判定用的收盘序列：把现价当作最新一根
  const prior = live ? closes : closes.slice(0, -1)
  let levelValue: number | null = null
  if (typeof line.level === 'number') levelValue = line.level
  else if (price !== null) {
    if (line.level === 'ma20' && prior.length >= 19) levelValue = mean([...prior.slice(-19), price])
    else if (line.level === 'ma60' && prior.length >= 59) levelValue = mean([...prior.slice(-59), price])
    else if (line.level === 'low60' && prior.length >= 59) levelValue = Math.min(...prior.slice(-59))
  }
  let beyond: boolean | null = null
  if (price !== null && levelValue !== null) {
    // 创 60 日新低：收盘价不高于此前 59 日的最低收盘价
    if (line.level === 'low60') beyond = line.op === 'below' ? price <= levelValue : price > levelValue
    else beyond = line.op === 'below' ? price < levelValue : price > levelValue
  }
  let andMet: boolean | null = null
  if (line.and === 'main_out') {
    const main = live ? live.main : series?.flow.find(f => f.date === lastBar?.date)?.main ?? null
    andMet = main === null ? null : main < 0
  } else if (line.and === 'margin_down') {
    const m = series?.margin ?? []
    andMet = m.length >= 6 ? m[m.length - 1]!.balance < m[m.length - 6]!.balance : null
  }
  const hit = beyond === null ? null : !beyond ? false : line.and === null ? true : andMet
  return {
    id: line.id, code: line.code, name: line.name, basis: line.basis, op: line.op, level: line.level, levelValue, price,
    distance: price !== null && levelValue !== null && levelValue > 0 ? price / levelValue - 1 : null,
    beyond, and: line.and, andMet, hit, action: line.action, source: line.source,
  }
}

/** 校验策略方提交的线。返回错误原因，或整理好的清单 */
export function parseLines(input: unknown): WatchLine[] | string {
  if (!Array.isArray(input)) return '应当是一组线'
  if (input.length > 100) return '线太多，最多 100 条'
  const out: WatchLine[] = []
  for (const [i, raw] of input.entries()) {
    const r = raw as Record<string, unknown>
    const code = String(r.code ?? '')
    const level = r.level
    if (!/^\d{6}$/.test(code)) return `第 ${i + 1} 条：代码不对`
    if (r.basis !== 'close' && r.basis !== 'price') return `第 ${i + 1} 条：basis 只能是 close 或 price`
    if (r.op !== 'below' && r.op !== 'above') return `第 ${i + 1} 条：op 只能是 below 或 above`
    if (!(typeof level === 'number' && level > 0) && level !== 'ma20' && level !== 'ma60' && level !== 'low60') return `第 ${i + 1} 条：level 只能是正数、ma20、ma60、low60`
    if (r.and != null && r.and !== 'main_out' && r.and !== 'margin_down') return `第 ${i + 1} 条：and 只能是 main_out 或 margin_down`
    const action = String(r.action ?? '').trim()
    const source = String(r.source ?? '').trim()
    if (!action || action.length > 200) return `第 ${i + 1} 条：要写规则原文的动作（200 字以内）`
    if (!source || source.length > 200) return `第 ${i + 1} 条：要写出处（200 字以内）`
    out.push({
      id: `${code}-${typeof level === 'number' ? level : level}-${r.op}-${r.basis}`,
      code, name: String(r.name ?? '').slice(0, 20), basis: r.basis, op: r.op, level: level as LineLevel,
      and: (r.and as WatchLine['and']) ?? null, action, source,
    })
  }
  if (new Set(out.map(l => l.id)).size !== out.length) return '有重复的线'
  return out
}

/** 今天第一次越线的那些线。seen：线 → 今天已经报过的日期 */
export function newlyBeyond(statuses: readonly LineStatus[], seen: Readonly<Record<string, string>>, today: string): LineStatus[] {
  return statuses.filter(s => s.beyond === true && seen[s.id] !== today)
}

export function describeLine(s: LineStatus): string {
  const level = typeof s.level === 'number' ? `${s.level}` : s.level === 'ma20' ? '20 日线' : s.level === 'ma60' ? '60 日线' : '60 日最低收盘价'
  const side = s.op === 'below' ? '跌破' : '升破'
  const dist = s.distance === null ? '' : `，现价相对该线 ${(s.distance * 100 >= 0 ? '+' : '')}${(s.distance * 100).toFixed(1)}%`
  const and = s.and === 'main_out' ? '，附加条件：当天主力净流出' : s.and === 'margin_down' ? '，附加条件：5 日融资变化为负' : ''
  const cross = s.level === 'low60' && s.op === 'below' ? '创 60 日新低' : `${side} ${level}`
  return `${s.name || s.code} ${s.basis === 'close' ? '收盘' : '盘中'}${cross}${dist}${and}`
}
