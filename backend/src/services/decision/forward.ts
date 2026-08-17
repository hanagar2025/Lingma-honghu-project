/**
 * 未来盈利证据链。
 *
 * 建仓/加仓真正要问的是：未来的盈利兑现有没有越来越可信？
 * 过去收入、过去利润、历史份额回答不了这个问题。
 *
 * 投资人首页只看一个词：强化 / 稳定 / 弱化 / UNKNOWN。
 * 机器可以保存全部细项。没有细项时，整链必须是 UNKNOWN，
 * 不得用均线、涨跌或历史利润增速冒充「未来正在兑现」。
 *
 * 本文件不 import 数据源。细项由调用方传入；日常复跑不传，就是 UNKNOWN。
 */

export type ForwardTone = 'STRENGTHENING' | 'STABLE' | 'WEAKENING' | 'UNKNOWN'

export const FORWARD_TONE_TEXT: Record<ForwardTone, string> = {
  STRENGTHENING: '强化',
  STABLE: '稳定',
  WEAKENING: '弱化',
  UNKNOWN: 'UNKNOWN',
}

export const FORWARD_ITEMS = [
  'ORDERS',
  'CUSTOMERS',
  'CAPACITY',
  'SHIPMENTS',
  'ASP',
  'GUIDANCE',
  'CAPEX',
  'UTILIZATION',
  'INVENTORY',
  'VISIBILITY',
] as const

export type ForwardItemId = typeof FORWARD_ITEMS[number]

export const FORWARD_ITEM_TEXT: Record<ForwardItemId, string> = {
  ORDERS: '在手订单',
  CUSTOMERS: '客户验证',
  CAPACITY: '产能扩张',
  SHIPMENTS: '出货量',
  ASP: 'ASP',
  GUIDANCE: '公司指引',
  CAPEX: '资本开支',
  UTILIZATION: '产能利用率',
  INVENTORY: '库存',
  VISIBILITY: '订单可见度',
}

export interface ForwardFact {
  id: ForwardItemId
  tone: ForwardTone
  fact: string
}

export interface ForwardEvidence {
  tone: ForwardTone
  items: readonly ForwardFact[]
  known: number
  missing: readonly string[]
  why: string
}

export function buildForward(facts: readonly ForwardFact[] = []): ForwardEvidence {
  const byId = new Map(facts.map(f => [f.id, f]))
  const items: ForwardFact[] = FORWARD_ITEMS.map(id => byId.get(id) ?? {
    id, tone: 'UNKNOWN', fact: '未接入决策层',
  })
  const known = items.filter(i => i.tone !== 'UNKNOWN')
  const missing = items.filter(i => i.tone === 'UNKNOWN').map(i => FORWARD_ITEM_TEXT[i.id])

  if (known.length === 0) {
    return {
      tone: 'UNKNOWN',
      items,
      known: 0,
      missing,
      why: '未来盈利证据未接入。历史利润不是前瞻。不允许把「已经发生了什么」写成「未来正在兑现」。',
    }
  }

  const weak = known.filter(i => i.tone === 'WEAKENING')
  const strong = known.filter(i => i.tone === 'STRENGTHENING')
  const tone: ForwardTone = weak.length > 0 && weak.length >= strong.length
    ? 'WEAKENING'
    : strong.length > 0
      ? 'STRENGTHENING'
      : 'STABLE'

  return {
    tone,
    items,
    known: known.length,
    missing,
    why: tone === 'STRENGTHENING'
      ? `前瞻细项中 ${strong.map(i => FORWARD_ITEM_TEXT[i.id]).join('、')} 正在强化。`
      : tone === 'WEAKENING'
        ? `前瞻细项中 ${weak.map(i => FORWARD_ITEM_TEXT[i.id]).join('、')} 正在弱化。`
        : '已接入的前瞻细项稳定，没有新的强化或恶化。',
  }
}

/** 价格能不能冒充前瞻证据。恒为 false。 */
export function priceCanFillForward(): boolean {
  return false
}
