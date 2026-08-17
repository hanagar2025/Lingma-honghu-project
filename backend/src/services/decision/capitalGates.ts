/**
 * 资本向上迁移闸门。
 *
 * V3 已经能回答「为什么卖」和「卖了以后生命线怎么走」。
 * 本文件回答另一半：什么证据足以让资本从观察走到建仓、加仓、追加、核心。
 *
 * ── 独立证据族，不是层数评分 ──
 *
 * 3 层变 5 层是例子，不是 3/5=60 分可以买。
 * 两件同一族的事实（节点利润 + 公司利润）只算一族：盈利兑现。
 * 加仓必须出现**新的独立族**，追加必须出现**与加仓不同的新族**。
 *
 * ── 价格进不来 ──
 *
 * 本文件的输入没有价格、均线、相对强弱。
 * 跌了 10% 不能加仓，涨了突破也不能加仓。
 */

import { layerOf, type EvidenceChain, type LayerStatus } from './evidence'
import type { ForwardTone } from './forward'
import type { ExpectationVerdict } from './r4'
import { ownershipAllows, type Ownership } from './triaxis'
import type { RiskCategory } from './lifecycle'

export type EvidenceFamily =
  | 'MAINLINE'
  | 'COMPANY'
  | 'ATTRIBUTION'
  | 'EARNINGS'
  | 'FORWARD'
  | 'QUALITY'
  | 'EXPECTATION'
  | 'QUALIFICATION'

export const FAMILY_TEXT: Record<EvidenceFamily, string> = {
  MAINLINE: '产业景气',
  COMPANY: '公司竞争地位',
  ATTRIBUTION: '目标主线核验',
  EARNINGS: '盈利兑现',
  FORWARD: '未来盈利证据',
  QUALITY: '利润质量',
  EXPECTATION: '预期差',
  QUALIFICATION: '战略资格',
}

/** 建仓最低完整度：战略资格 + 主线 + 盈利。缺一不可。 */
export const ENTRY_MIN: readonly EvidenceFamily[] = [
  'QUALIFICATION', 'MAINLINE', 'EARNINGS',
]

/** 核心持有：资格、主线、竞争地位、盈利同时成立。前瞻/R4 未知不挡。 */
export const CORE_MIN: readonly EvidenceFamily[] = [
  'QUALIFICATION', 'MAINLINE', 'COMPANY', 'EARNINGS',
]

/** 追加必须是新的、与加仓不同类的证据。没有前瞻/质量，日常不能追加。 */
export const TOP_UP_NEW: readonly EvidenceFamily[] = [
  'FORWARD', 'QUALITY', 'EXPECTATION',
]

export interface GateFacts {
  chain: EvidenceChain
  companyProfitUp: boolean
  forward: ForwardTone
  r4: ExpectationVerdict
  ownership: Ownership
  risks: readonly RiskCategory[]
}

export interface GateVerdict {
  ok: boolean
  why: string
  standing: readonly EvidenceFamily[]
  missing: readonly EvidenceFamily[]
  gained: readonly EvidenceFamily[]
}

export function standingOf(s: LayerStatus): boolean {
  return s === 'ESTABLISHED' || s === 'STRENGTHENING'
}

export function standingFamilies(p: GateFacts): EvidenceFamily[] {
  const out: EvidenceFamily[] = []
  if (standingOf(layerOf(p.chain, 'MAINLINE').status)) out.push('MAINLINE')
  if (standingOf(layerOf(p.chain, 'COMPETITIVE').status)) out.push('COMPANY')
  if (standingOf(layerOf(p.chain, 'REVENUE_FLAG').status)
    || standingOf(layerOf(p.chain, 'PROFIT_ATTR').status)) {
    out.push('ATTRIBUTION')
  }
  if (standingOf(layerOf(p.chain, 'NODE_PROFIT').status) || p.companyProfitUp) {
    out.push('EARNINGS')
  }
  if (p.forward === 'STRENGTHENING' || p.forward === 'STABLE') out.push('FORWARD')
  if (standingOf(layerOf(p.chain, 'CASHFLOW').status)) out.push('QUALITY')
  if (p.r4 === 'OPPORTUNITY' || p.r4 === 'ALIGNED') out.push('EXPECTATION')
  if (standingOf(layerOf(p.chain, 'QUALIFICATION').status)) out.push('QUALIFICATION')
  return out
}

export function gainedFamilies(
  prev: readonly EvidenceFamily[], now: readonly EvidenceFamily[],
): EvidenceFamily[] {
  return now.filter(f => !prev.includes(f))
}

function stretched(p: GateFacts): boolean {
  return p.r4 === 'STRETCHED'
}

function companyOrMainlineRisk(p: GateFacts): boolean {
  return p.risks.includes('R2_COMPANY') || p.risks.includes('R3_MAINLINE')
}

export function canEnter(p: GateFacts): GateVerdict {
  const standing = standingFamilies(p)
  const missing = ENTRY_MIN.filter(f => !standing.includes(f))
  if (!ownershipAllows(p.ownership)) {
    return { ok: false, why: '战略层不允许拥有，不能建仓。', standing, missing, gained: [] }
  }
  if (companyOrMainlineRisk(p)) {
    return { ok: false, why: '公司或主线风险成立，风险闸门未通过。', standing, missing, gained: [] }
  }
  if (stretched(p)) {
    return {
      ok: false,
      why: 'R4 市场隐含高于可证明增长。不得建仓。这不是减仓理由。',
      standing, missing, gained: [],
    }
  }
  if (missing.length) {
    return {
      ok: false,
      why: `建仓最低完整度未到：缺 ${missing.map(f => FAMILY_TEXT[f]).join('、')}。`,
      standing, missing, gained: [],
    }
  }
  return {
    ok: true,
    why: '战略资格成立，主线与盈利证据达到最低完整度，风险闸门通过。不是因为涨了。',
    standing, missing: [], gained: [],
  }
}

export function canAdd(p: GateFacts, prevStanding: readonly EvidenceFamily[]): GateVerdict {
  const standing = standingFamilies(p)
  const gained = gainedFamilies(prevStanding, standing)
  const base = canEnter(p)
  if (!base.ok) return { ...base, gained }
  if (stretched(p)) {
    return {
      ok: false,
      why: 'R4 透支。公司可以很好，但不能加仓。',
      standing, missing: [], gained,
    }
  }
  const material = gained.filter(f => f !== 'EXPECTATION')
  if (material.length === 0 || standing.length < 4) {
    return {
      ok: false,
      why: '加仓需要新增独立证据族，使「值得拥有」的可信度提高。同一族的重复事实不算。预期差本身不能加仓。价格涨跌不算。',
      standing, missing: [], gained,
    }
  }
  return {
    ok: true,
    why: `新增独立证据：${material.map(f => FAMILY_TEXT[f]).join('、')}。`
      + `成立族从 ${prevStanding.length} 增加到 ${standing.length}。不是因为涨了。`,
    standing, missing: [], gained: material,
  }
}

export function canTopUp(p: GateFacts, prevStanding: readonly EvidenceFamily[]): GateVerdict {
  const standing = standingFamilies(p)
  const gained = gainedFamilies(prevStanding, standing)
  const independent = gained.filter(f => (TOP_UP_NEW as readonly string[]).includes(f))
  if (!ownershipAllows(p.ownership)) {
    return { ok: false, why: '战略层不允许追加。', standing, missing: [], gained }
  }
  if (companyOrMainlineRisk(p) || stretched(p)) {
    return { ok: false, why: '风险闸门未通过，不能追加。', standing, missing: [], gained }
  }
  if (independent.length === 0) {
    return {
      ok: false,
      why: '追加不是重复加仓。必须出现新的独立证据（未来盈利、利润质量或可测的预期差）。',
      standing, missing: [...TOP_UP_NEW], gained,
    }
  }
  return {
    ok: true,
    why: `出现与加仓不同的独立证据：${independent.map(f => FAMILY_TEXT[f]).join('、')}。`
      + '原来的假设未被破坏，错误概率进一步下降。',
    standing, missing: [], gained: independent,
  }
}

export function canCore(p: GateFacts): GateVerdict {
  const standing = standingFamilies(p)
  const missing = CORE_MIN.filter(f => !standing.includes(f))
  if (p.ownership !== 'STRATEGIC_CORE') {
    return { ok: false, why: '不是战略核心席位，不能进入核心持有。', standing, missing, gained: [] }
  }
  if (companyOrMainlineRisk(p)) {
    return { ok: false, why: '公司或主线风险成立，不能进入核心持有。', standing, missing, gained: [] }
  }
  if (missing.length) {
    return {
      ok: false,
      why: `核心持有缺 ${missing.map(f => FAMILY_TEXT[f]).join('、')}。前瞻与 R4 未知不挡核心。`,
      standing, missing, gained: [],
    }
  }
  return {
    ok: true,
    why: '战略核心席位 + 主线、竞争地位、盈利兑现同时成立。前瞻与预期未测，不因此否定核心。',
    standing, missing: [], gained: [],
  }
}

export type CapitalReasonKind =
  | 'ENTRY'
  | 'ADD'
  | 'TOP_UP'
  | 'CORE'
  | 'HOLD'
  | 'PORTFOLIO'
  | 'TACTICAL'
  | 'VALUE_EXIT'
  | 'BLOCKED'

export interface CapitalReason {
  kind: CapitalReasonKind
  families: readonly EvidenceFamily[]
  text: string
}

export function reasonOf(kind: CapitalReasonKind, v: GateVerdict): CapitalReason {
  return { kind, families: v.gained.length ? v.gained : v.standing, text: v.why }
}
