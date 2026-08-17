/**
 * 独立证据族：来源独立 + 因果链独立。
 *
 * V4 规定「加仓必须出现新的独立证据族」。本文件回答那个最容易出 bug 的问题：
 * 什么叫独立？
 *
 * 同一客户订单周期里的：
 *   需求增加 → 订单增加 → 收入增加 → 利润增加
 * 不是四个证据，是一个证据族：需求兑现。
 *
 * 收入增长 + 扣非利润增长 = 同一族（盈利兑现）。
 * 收入增长 + 新客户导入 = 两族（盈利兑现 + 公司竞争力）。
 *
 * 本文件不生产动作，不改变建仓/加仓门槛。
 * 族数门槛仍是设计规则，不是样本外验证过的统计规律。
 */

import type { EvidenceFamily } from './capitalGates'

/** 投资人问题。每一族只回答自己的问题。 */
export const FAMILY_QUESTION: Record<EvidenceFamily, string> = {
  MAINLINE: '产业需求有没有成立？',
  COMPANY: '公司竞争地位有没有提高？',
  ATTRIBUTION: '赚到的钱是不是来自我们要押注的主线？',
  EARNINGS: '盈利有没有兑现？',
  FORWARD: '未来盈利兑现有没有越来越可信？',
  QUALITY: '利润能不能转化成现金？',
  EXPECTATION: '市场价格隐含的增长与可证明增长是否错配？',
  QUALIFICATION: '战略上还值不值得拥有？',
}

/**
 * 原子事实属于哪一族。同一族的多条事实只算一次。
 * 订单进前瞻，不进产业需求 —— 行业出货/终端需求才是主线。
 */
export const ATOM_FAMILY = {
  INDUSTRY_DEMAND: 'MAINLINE',
  INDUSTRY_SHIPMENTS: 'MAINLINE',
  END_DEMAND: 'MAINLINE',
  SHARE: 'COMPANY',
  DESIGN_WIN: 'COMPANY',
  PRODUCT_COMPETE: 'COMPANY',
  SUBSTITUTION: 'COMPANY',
  REVENUE: 'EARNINGS',
  GROSS_MARGIN: 'EARNINGS',
  NET_PROFIT: 'EARNINGS',
  ROIC: 'EARNINGS',
  ORDERS: 'FORWARD',
  CAPACITY: 'FORWARD',
  ASP: 'FORWARD',
  GUIDANCE: 'FORWARD',
  OCF: 'QUALITY',
  RECEIVABLES: 'QUALITY',
  INVENTORY: 'QUALITY',
  CAPITALIZATION: 'QUALITY',
  IMPLIED_GROWTH: 'EXPECTATION',
  SUPPORTED_GROWTH: 'EXPECTATION',
  MAINLINE_CHECK: 'ATTRIBUTION',
  STRATEGIC_SEAT: 'QUALIFICATION',
} as const

export type AtomKind = keyof typeof ATOM_FAMILY

export interface EvidenceAtom {
  kind: AtomKind
  /** 同一因果源头必须相同。例如同一客户订单周期。 */
  causalSource: string
  fact: string
}

export interface CollapsedSource {
  source: string
  families: readonly EvidenceFamily[]
  /** 同一源头只保留一个族，避免一张订单被记成四族。 */
  kept: EvidenceFamily
  atoms: readonly EvidenceAtom[]
}

export interface Independence {
  families: readonly EvidenceFamily[]
  sources: readonly CollapsedSource[]
  /** 去重后的独立族数。这是计数，不是评分。 */
  independent: number
  why: string
}

const FAMILY_PRIORITY: readonly EvidenceFamily[] = [
  'QUALIFICATION',
  'MAINLINE',
  'COMPANY',
  'ATTRIBUTION',
  'EARNINGS',
  'FORWARD',
  'QUALITY',
  'EXPECTATION',
]

export function familyOf(kind: AtomKind): EvidenceFamily {
  return ATOM_FAMILY[kind]
}

/**
 * 同一因果源头只贡献一个族。
 * 跨源头、且回答不同问题，才算独立。
 */
export function collapseAtoms(atoms: readonly EvidenceAtom[]): Independence {
  const bySource = new Map<string, EvidenceAtom[]>()
  for (const a of atoms) {
    const list = bySource.get(a.causalSource) ?? []
    list.push(a)
    bySource.set(a.causalSource, list)
  }

  const sources: CollapsedSource[] = []
  for (const [source, list] of bySource) {
    const families = unique(list.map(a => familyOf(a.kind)))
    const kept = pickKept(families)
    sources.push({ source, families, kept, atoms: list })
  }

  const families = unique(sources.map(s => s.kept))
  const collapsed = sources.filter(s => s.families.length > 1)
  const why = collapsed.length
    ? `同一因果源头的多条事实已折叠：${collapsed.map(s =>
      `${s.source}（${s.families.join('+')} → ${s.kept}）`).join('；')}。`
      + '不是四个证据，是一件事被报表重复记录。'
    : families.length
      ? `独立证据族 ${families.length} 个：${families.join('、')}。同一族的重复事实已去重。`
      : '没有可计数的证据原子。'

  return { families, sources, independent: families.length, why }
}

function pickKept(families: readonly EvidenceFamily[]): EvidenceFamily {
  for (const f of FAMILY_PRIORITY) {
    if (families.includes(f)) return f
  }
  return families[0] ?? 'EARNINGS'
}

function unique<T>(xs: readonly T[]): T[] {
  return [...new Set(xs)]
}

/** 收入 + 扣非是否算两个独立族。恒为 false。 */
export function revenueAndProfitAreIndependent(): boolean {
  return false
}
