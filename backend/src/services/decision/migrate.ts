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

import { layerOf, type EvidenceChain } from './evidence'
import {
  HUNTER_TEXT, isForward, type HunterStage,
} from './hunter'
import { ownershipAllows, type Ownership } from './triaxis'
import type { RiskCategory } from './lifecycle'
import type { StrategicState } from './strategy'
import type { ForwardTone } from './forward'
import type { ExpectationVerdict } from './r4'
import {
  canAdd, canCore, canEnter, canTopUp, reasonOf, standingFamilies,
  type CapitalReason, type EvidenceFamily, type GateFacts,
} from './capitalGates'

export type MigrationDirection = 'FORWARD' | 'HOLD' | 'REVERSE' | 'INIT'

export interface Migration {
  from: HunterStage | null
  to: HunterStage
  direction: MigrationDirection
  /** false = 试图跨越的迁移不合法，已挡回 from */
  legal: boolean
  why: string
  capitalReason: CapitalReason
}

export interface InferInput {
  held: boolean
  ownership: Ownership
  strategic: StrategicState
  risks: readonly RiskCategory[]
  evidence: EvidenceChain
  inUniverse: boolean
  companyProfitUp: boolean
  forward: ForwardTone
  r4: ExpectationVerdict
}

export function inferHunter(p: InferInput): HunterStage {
  if (p.ownership === 'RETIRED' || p.strategic === 'FALSIFIED') return 'VALUE_EXIT'
  if (p.held && p.risks.includes('R2_COMPANY')) return 'TACTICAL_REDUCE'
  if (p.held && p.risks.includes('R3_MAINLINE')) return 'TACTICAL_REDUCE'
  const gates = toGates(p)
  if (!p.held) {
    if (!p.inUniverse || p.ownership === 'STRATEGIC_VETO') return 'DISCOVER'
    if (canEnter(gates).ok) return 'ENTRY'
    return 'OBSERVE'
  }
  // 加仓/追加不能靠落位推出来，必须有昨日证据对照。
  if (canCore(gates).ok) return 'CORE'
  // 已持有的战略核心：盈利族未测 ≠ 盈利证伪。未知不挡落位，也不构成加仓。
  if (p.ownership === 'STRATEGIC_CORE') return 'CORE'
  if (canEnter(gates).ok) return 'ENTRY'
  return 'OBSERVE'
}

export interface MigrateInput {
  prev: HunterStage | null
  inferred: HunterStage
  ownership: Ownership
  evidence: EvidenceChain
  prevEvidence: EvidenceChain | null
  prevFamilies?: readonly EvidenceFamily[] | null
  risks: readonly RiskCategory[]
  /** 只有技术复核、没有任何账务/基本面风险 */
  reviewOnly: boolean
  companyProfitUp: boolean
  forward: ForwardTone
  r4: ExpectationVerdict
}

export function migrate(p: MigrateInput): Migration {
  const prev = p.prev
  if (prev === null) {
    return {
      from: null, to: p.inferred, direction: 'INIT', legal: true,
      why: '无昨日生命线档案，按当前证据落位。落位 ≠ 迁移。证据强化本身不能推出加仓。',
      capitalReason: {
        kind: 'HOLD',
        families: standingFamilies(toGates(p)),
        text: '落位不是资本向上迁移。向上必须对照昨日证据族。',
      },
    }
  }
  return migrateFrom({ ...p, prev })
}

function migrateFrom(p: MigrateInput & { prev: HunterStage }): Migration {
  const exitReason: CapitalReason = {
    kind: 'VALUE_EXIT', families: [],
    text: '战略资格否决或清退。这是价值退出，不是战术减仓，也不是组合减仓。',
  }

  const vetoed = p.ownership === 'RETIRED' || p.ownership === 'STRATEGIC_VETO'
  if (vetoed) {
    if (p.prev === 'VALUE_EXIT') {
      return hold(p.prev, '战略资格仍关闭。节点利润改善不能恢复资格。', exitReason)
    }
    if (p.prev === 'REOBSERVE') {
      return move(p.prev, 'VALUE_EXIT', 'REVERSE', '重新观察后战略资格仍未恢复，回到价值退出。', exitReason)
    }
    return move(p.prev, 'VALUE_EXIT', 'REVERSE', exitReason.text, exitReason)
  }

  const hasR2 = p.risks.includes('R2_COMPANY')
  const hasR3 = p.risks.includes('R3_MAINLINE')
  const hasR1 = p.risks.includes('R1_PORTFOLIO')
  const onlyR1 = hasR1 && !hasR2 && !hasR3

  if (onlyR1) {
    return hold(p.prev, '组合超限不迁移生命线。值得拥有 ≠ 拥有太多。减的是暴露，不是资格。', {
      kind: 'PORTFOLIO', families: [], text: '组合超限不迁移生命线。',
    })
  }

  if (p.reviewOnly && !hasR2 && !hasR3) {
    return hold(p.prev, '技术复核只触发重新检查基本面，不迁移生命线。涨跌不是迁移条件。')
  }

  const qual = layerOf(p.evidence, 'QUALIFICATION').status
  if (qual === 'FALSIFIED') {
    return move(p.prev, 'VALUE_EXIT', 'REVERSE', '战略资格被证伪。退出须走战略层程序。', exitReason)
  }

  if (hasR2 || hasR3) {
    const text = hasR2
      ? '公司盈利证据恶化，从当前段进入战术减仓。这不是战略证伪，也不是组合超限。'
      : '主线利润蛋糕在缩小，进入战术减仓。冠军身份不构成继续原仓位的理由。'
    if (p.prev === 'VALUE_EXIT' || p.prev === 'REOBSERVE') {
      return hold(p.prev, '已在退出/再观察段。公司或主线风险不把退出改写成战术减仓。')
    }
    return move(p.prev, 'TACTICAL_REDUCE', 'REVERSE', text, { kind: 'TACTICAL', families: [], text })
  }

  if (p.prev === 'TACTICAL_REDUCE' && !hasR2 && !hasR3 && ownershipAllows(p.ownership)) {
    const restored = p.inferred === 'CORE' || p.inferred === 'ENTRY' ? p.inferred : 'CORE'
    return move(p.prev, restored, 'FORWARD', '公司/主线风险已解除，生命线从战术减仓回到持有段。', {
      kind: 'HOLD', families: standingFamilies(toGates(p)), text: '风险解除，回到持有段。',
    })
  }
  if (p.prev === 'VALUE_EXIT' && ownershipAllows(p.ownership)) {
    return move(p.prev, 'REOBSERVE', 'FORWARD', '战略资格重新打开，进入退出后重新观察。尚未恢复建仓资格。', {
      kind: 'HOLD', families: [], text: '重新观察，尚未恢复建仓资格。',
    })
  }
  if (p.prev === 'REOBSERVE') {
    if (p.inferred === 'ENTRY' || p.inferred === 'OBSERVE' || p.inferred === 'DISCOVER') {
      return move(p.prev, p.inferred, 'FORWARD', '重新观察后证据达到当前段门槛。', {
        kind: p.inferred === 'ENTRY' ? 'ENTRY' : 'HOLD',
        families: standingFamilies(toGates(p)),
        text: '重新观察后达到当前段门槛。',
      })
    }
    return hold(p.prev, '重新观察中。尚未达到建仓门槛。')
  }

  return forwardOrHold(p)
}

function hold(from: HunterStage, why: string, reason?: CapitalReason): Migration {
  return {
    from, to: from, direction: 'HOLD', legal: true, why,
    capitalReason: reason ?? { kind: 'HOLD', families: [], text: why },
  }
}

function toGates(p: {
  evidence: EvidenceChain
  companyProfitUp: boolean
  forward: ForwardTone
  r4: ExpectationVerdict
  ownership: Ownership
  risks: readonly RiskCategory[]
}): GateFacts {
  return {
    chain: p.evidence,
    companyProfitUp: p.companyProfitUp,
    forward: p.forward,
    r4: p.r4,
    ownership: p.ownership,
    risks: p.risks,
  }
}

function forwardFromChain(chain: EvidenceChain): ForwardTone {
  const s = layerOf(chain, 'FORWARD').status
  if (s === 'STRENGTHENING') return 'STRENGTHENING'
  if (s === 'WEAKENING') return 'WEAKENING'
  if (s === 'ESTABLISHED') return 'STABLE'
  return 'UNKNOWN'
}

function r4FromChain(chain: EvidenceChain): ExpectationVerdict {
  const s = layerOf(chain, 'EXPECTATION').status
  if (s === 'STRENGTHENING') return 'OPPORTUNITY'
  if (s === 'WEAKENING') return 'STRETCHED'
  if (s === 'ESTABLISHED') return 'ALIGNED'
  return 'UNKNOWN'
}

function forwardOrHold(p: MigrateInput & { prev: HunterStage }): Migration {
  const prev = p.prev
  const gates = toGates(p)
  // 昨日证据族只读昨日链。今天的前瞻/R4 不得回溯成「昨天已经有」。
  const prevFam = p.prevFamilies ?? (p.prevEvidence
    ? standingFamilies({
      ...gates,
      chain: p.prevEvidence,
      forward: forwardFromChain(p.prevEvidence),
      r4: r4FromChain(p.prevEvidence),
    })
    : [])

  if (prev === 'DISCOVER') {
    if (p.ownership === 'STRATEGIC_WATCH' || ownershipAllows(p.ownership)) {
      return move(prev, 'OBSERVE', 'FORWARD', '产业主线已进入研究视野，证据开始形成。', {
        kind: 'HOLD', families: standingFamilies(gates), text: '进入观察。尚未达到建仓门槛。',
      })
    }
    return hold(prev, '发现段：尚不足以进入观察。')
  }

  if (prev === 'OBSERVE') {
    const enter = canEnter(gates)
    if (enter.ok) {
      return move(prev, 'ENTRY', 'FORWARD', enter.why, reasonOf('ENTRY', enter))
    }
    if (p.inferred === 'CORE' || p.inferred === 'ADD' || p.inferred === 'TOP_UP') {
      return {
        from: prev, to: prev, direction: 'HOLD', legal: false,
        why: '观察不能直接跳到核心/加仓。中间必须经过建仓门槛。',
        capitalReason: reasonOf('BLOCKED', enter),
      }
    }
    return hold(prev, enter.why, reasonOf('BLOCKED', enter))
  }

  if (prev === 'ENTRY') {
    const add = canAdd(gates, prevFam)
    if (add.ok) {
      return move(prev, 'ADD', 'FORWARD', add.why, reasonOf('ADD', add))
    }
    if (p.inferred === 'CORE' || p.inferred === 'TOP_UP') {
      return {
        from: prev, to: prev, direction: 'HOLD', legal: false,
        why: '建仓不能因「看起来是核心」直接跳到核心持有。须有新增独立证据族。',
        capitalReason: reasonOf('BLOCKED', add),
      }
    }
    return hold(prev, add.why, reasonOf('BLOCKED', add))
  }

  if (prev === 'ADD') {
    const top = canTopUp(gates, prevFam)
    if (top.ok) {
      return move(prev, 'TOP_UP', 'FORWARD', top.why, reasonOf('TOP_UP', top))
    }
    const core = canCore(gates)
    if (core.ok) {
      return move(prev, 'CORE', 'FORWARD', core.why, reasonOf('CORE', core))
    }
    return hold(prev, '加仓段。没有新的独立证据，不能追加；也未达到核心门槛。', reasonOf('BLOCKED', top))
  }

  if (prev === 'TOP_UP') {
    const core = canCore(gates)
    if (core.ok) {
      return move(prev, 'CORE', 'FORWARD', core.why, reasonOf('CORE', core))
    }
    return hold(prev, core.why, reasonOf('BLOCKED', core))
  }

  if (prev === 'CORE') {
    return hold(prev, '核心持有。生命线不动，除非证据恶化或战略资格关闭。组合超限不在此列。', {
      kind: 'CORE', families: standingFamilies(gates), text: '核心持有。证据强化本身不能再推出加仓。',
    })
  }

  return hold(prev, `停留在${HUNTER_TEXT[prev]}。`)
}

function move(
  from: HunterStage, to: HunterStage, direction: MigrationDirection,
  why: string, capitalReason: CapitalReason,
): Migration {
  const dir: MigrationDirection = from === to
    ? 'HOLD'
    : isForward(from) && isForward(to) ? 'FORWARD' : direction
  return { from, to, direction: dir, legal: true, why, capitalReason }
}

/**
 * 价格能不能迁移生命线。**恒为 false。**
 *
 * 单独成函数，是为了让这条约束有一个可被自检点名的位置。
 */
export function priceCanMigrate(): boolean {
  return false
}
