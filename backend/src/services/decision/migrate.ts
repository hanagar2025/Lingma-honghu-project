/**
 * 证据变化 → 生命线迁移。
 *
 * 这是 V3 真正要闭合的那一环。V2 能把当前快照落成一个状态；
 * V3 要回答：什么证据变了，才允许从一段走到下一段。
 *
 * ── 两条硬约束 ──
 *
 * 1. 价格、均线、相对强弱、RSI 不是本函数的参数。
 *    它们进不来，就不能迁移。这比写一句「不要用技术指标」更硬。
 * 2. R1 组合超限不迁移生命线。
 *    海光仍然是核心持有；变的是 Exposure 与 Action，不是 HunterStage。
 *
 * 「涨了」不能成为加仓理由。「跌了」也不能成为减仓理由。
 * 加仓看的是成立的证据层变多；减仓看的是哪一层开始恶化。
 */

import { layerOf, standingOf, type EvidenceChain } from './evidence'
import {
  HUNTER_TEXT, isForward, type HunterStage,
} from './hunter'
import { ownershipAllows, type Ownership } from './triaxis'
import type { RiskCategory } from './lifecycle'
import type { StrategicState } from './strategy'

export type MigrationDirection = 'FORWARD' | 'HOLD' | 'REVERSE' | 'INIT'

export interface Migration {
  from: HunterStage | null
  to: HunterStage
  direction: MigrationDirection
  /** false = 试图跨越的迁移不合法，已挡回 from */
  legal: boolean
  why: string
}

export interface InferInput {
  held: boolean
  ownership: Ownership
  strategic: StrategicState
  risks: readonly RiskCategory[]
  evidence: EvidenceChain
  factsStrengthening: boolean
  inUniverse: boolean
}

export function inferHunter(p: InferInput): HunterStage {
  if (p.ownership === 'RETIRED' || p.strategic === 'FALSIFIED') return 'VALUE_EXIT'
  if (p.held && p.risks.includes('R2_COMPANY')) return 'TACTICAL_REDUCE'
  if (p.held && p.risks.includes('R3_MAINLINE')) return 'TACTICAL_REDUCE'
  if (!p.held) {
    if (!p.inUniverse) return 'DISCOVER'
    if (p.ownership === 'STRATEGIC_VETO') return 'DISCOVER'
    if (p.ownership === 'STRATEGIC_WATCH') return 'OBSERVE'
    if (ownershipAllows(p.ownership)
      && layerOf(p.evidence, 'QUALIFICATION').status === 'ESTABLISHED'
      && (p.strategic === 'HOLDS' || p.strategic === 'STRENGTHENED')) {
      return 'ENTRY'
    }
    return 'OBSERVE'
  }
  // R1 不在这里出现：超限不是生命线问题。
  if (p.factsStrengthening) return 'ADD'
  if (p.ownership === 'STRATEGIC_CORE'
    && (p.strategic === 'HOLDS' || p.strategic === 'STRENGTHENED')) {
    return 'CORE'
  }
  return 'ENTRY'
}

export interface MigrateInput {
  prev: HunterStage | null
  inferred: HunterStage
  ownership: Ownership
  evidence: EvidenceChain
  prevEvidence: EvidenceChain | null
  risks: readonly RiskCategory[]
  /** 只有技术复核、没有任何账务/基本面风险 */
  reviewOnly: boolean
}

export function migrate(p: MigrateInput): Migration {
  const prev = p.prev
  if (prev === null) {
    return {
      from: null, to: p.inferred, direction: 'INIT', legal: true,
      why: '无昨日生命线档案，按当前证据落位。落位 ≠ 迁移。',
    }
  }
  return migrateFrom({ ...p, prev })
}

function migrateFrom(p: MigrateInput & { prev: HunterStage }): Migration {

  const vetoed = p.ownership === 'RETIRED' || p.ownership === 'STRATEGIC_VETO'
  if (vetoed) {
    if (p.prev === 'VALUE_EXIT') {
      return hold(p.prev, '战略资格仍关闭。节点利润改善不能恢复资格。')
    }
    if (p.prev === 'REOBSERVE') {
      return {
        from: p.prev, to: 'VALUE_EXIT', direction: 'REVERSE', legal: true,
        why: '重新观察后战略资格仍未恢复，回到价值退出。',
      }
    }
    return {
      from: p.prev, to: 'VALUE_EXIT', direction: 'REVERSE', legal: true,
      why: '战略资格否决或清退。这是价值退出，不是战术减仓，也不是组合减仓。',
    }
  }

  const hasR2 = p.risks.includes('R2_COMPANY')
  const hasR3 = p.risks.includes('R3_MAINLINE')
  const hasR1 = p.risks.includes('R1_PORTFOLIO')
  const onlyR1 = hasR1 && !hasR2 && !hasR3

  // 组合超限：生命线不动。
  if (onlyR1) {
    return hold(p.prev, '组合超限不迁移生命线。值得拥有 ≠ 拥有太多。减的是暴露，不是资格。')
  }

  // 技术复核单独成立：生命线不动。
  if (p.reviewOnly && !hasR2 && !hasR3) {
    return hold(p.prev, '技术复核只触发重新检查基本面，不迁移生命线。涨跌不是迁移条件。')
  }

  const qual = layerOf(p.evidence, 'QUALIFICATION').status
  if (qual === 'FALSIFIED') {
    return {
      from: p.prev, to: 'VALUE_EXIT', direction: 'REVERSE', legal: true,
      why: '战略资格被证伪。退出须走战略层程序。',
    }
  }

  if (hasR2 || hasR3) {
    if (p.prev === 'VALUE_EXIT' || p.prev === 'REOBSERVE') {
      return hold(p.prev, '已在退出/再观察段。公司或主线风险不把退出改写成战术减仓。')
    }
    return {
      from: p.prev, to: 'TACTICAL_REDUCE', direction: 'REVERSE', legal: true,
      why: hasR2
        ? '公司盈利证据恶化，从当前段进入战术减仓。这不是战略证伪，也不是组合超限。'
        : '主线利润蛋糕在缩小，进入战术减仓。冠军身份不构成继续原仓位的理由。',
    }
  }

  // 风险释放：战术减仓 → 核心/加仓；价值退出 → 再观察。
  if (p.prev === 'TACTICAL_REDUCE' && !hasR2 && !hasR3 && ownershipAllows(p.ownership)) {
    const restored = p.inferred === 'CORE' || p.inferred === 'ADD' || p.inferred === 'TOP_UP'
      ? p.inferred
      : 'CORE'
    return {
      from: p.prev, to: restored, direction: 'FORWARD', legal: true,
      why: '公司/主线风险已解除，生命线从战术减仓回到持有段。',
    }
  }
  if (p.prev === 'VALUE_EXIT' && ownershipAllows(p.ownership)) {
    return {
      from: p.prev, to: 'REOBSERVE', direction: 'FORWARD', legal: true,
      why: '战略资格重新打开，进入退出后重新观察。尚未恢复建仓资格。',
    }
  }
  if (p.prev === 'REOBSERVE') {
    if (p.inferred === 'ENTRY' || p.inferred === 'OBSERVE' || p.inferred === 'DISCOVER') {
      return {
        from: p.prev, to: p.inferred, direction: 'FORWARD', legal: true,
        why: '重新观察后证据达到当前段门槛。',
      }
    }
    return hold(p.prev, '重新观察中。尚未达到建仓门槛。')
  }

  return forwardOrHold(p)
}

function hold(from: HunterStage, why: string): Migration {
  return { from, to: from, direction: 'HOLD', legal: true, why }
}

function forwardOrHold(p: MigrateInput & { prev: HunterStage }): Migration {
  const prev = p.prev
  const now = standingOf(p.evidence)
  const was = p.prevEvidence ? standingOf(p.prevEvidence) : null
  const gained = was !== null && now > was

  if (prev === 'DISCOVER') {
    if (p.ownership === 'STRATEGIC_WATCH' || ownershipAllows(p.ownership)) {
      return step(prev, 'OBSERVE', '产业主线已进入研究视野，证据开始形成。')
    }
    return hold(prev, '发现段：尚不足以进入观察。')
  }

  if (prev === 'OBSERVE') {
    if (canEnter(p)) {
      return step(prev, 'ENTRY', '战略资格成立，且关键证据达到建仓最低门槛。不是因为涨了。')
    }
    if (p.inferred === 'CORE' || p.inferred === 'ADD' || p.inferred === 'TOP_UP') {
      return {
        from: prev, to: prev, direction: 'HOLD', legal: false,
        why: '观察不能直接跳到核心/加仓。中间必须经过建仓门槛。',
      }
    }
    return hold(prev, '观察中。建仓门槛尚未同时满足。')
  }

  if (prev === 'ENTRY') {
    if (gained || (p.inferred === 'ADD' && now >= 4)) {
      return step(prev, 'ADD', `关键证据从 ${was ?? '?'} 层成立增加到 ${now} 层。加仓因为证据确认，不是因为价格。`)
    }
    if (p.inferred === 'CORE' && p.ownership === 'STRATEGIC_CORE' && !gained) {
      return {
        from: prev, to: prev, direction: 'HOLD', legal: false,
        why: '建仓不能因「看起来是核心」直接跳到核心持有。须有新增证据。',
      }
    }
    return hold(prev, '已建仓。等待更多证据确认后再加仓。')
  }

  if (prev === 'ADD') {
    if (gained && now >= 5) {
      return step(prev, 'TOP_UP', `证据继续强化到 ${now} 层成立。追加看的是错误概率下降，不是越涨越买。`)
    }
    if (p.ownership === 'STRATEGIC_CORE' && canCore(p.evidence) && (gained || p.inferred === 'CORE')) {
      return step(prev, 'CORE', '战略核心席位 + 可测证据成立 + 无公司/主线风险。进入核心持有。')
    }
    return hold(prev, '加仓段。新证据尚未多到追加或核心。')
  }

  if (prev === 'TOP_UP') {
    if (p.ownership === 'STRATEGIC_CORE' && canCore(p.evidence)) {
      return step(prev, 'CORE', '追加后的证据足以支持核心持有。')
    }
    return hold(prev, '追加段。维持，直到证据足以进入核心或开始恶化。')
  }

  if (prev === 'CORE') {
    return hold(prev, '核心持有。生命线不动，除非证据恶化或战略资格关闭。组合超限不在此列。')
  }

  return hold(prev, `停留在${HUNTER_TEXT[prev]}。`)
}

function step(from: HunterStage, to: HunterStage, why: string): Migration {
  const direction: MigrationDirection = isForward(from) && isForward(to)
    ? (HUNTER_TEXT[from] === HUNTER_TEXT[to] ? 'HOLD' : 'FORWARD')
    : from === to ? 'HOLD' : 'FORWARD'
  return { from, to, direction: from === to ? 'HOLD' : direction, legal: true, why }
}

function canEnter(p: MigrateInput): boolean {
  if (!ownershipAllows(p.ownership)) return false
  const qual = layerOf(p.evidence, 'QUALIFICATION').status
  const main = layerOf(p.evidence, 'MAINLINE').status
  return (qual === 'ESTABLISHED' || qual === 'STRENGTHENING')
    && (main === 'ESTABLISHED' || main === 'STRENGTHENING')
}

function canCore(evidence: EvidenceChain): boolean {
  const need = ['MAINLINE', 'COMPETITIVE', 'QUALIFICATION'] as const
  return need.every(id => {
    const s = layerOf(evidence, id).status
    return s === 'ESTABLISHED' || s === 'STRENGTHENING'
  })
}

/**
 * 价格能不能迁移生命线。**恒为 false。**
 *
 * 单独成函数，是为了让这条约束有一个可被自检点名的位置。
 */
export function priceCanMigrate(): boolean {
  return false
}
