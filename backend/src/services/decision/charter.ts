/**
 * 鸿鹄最高层架构约束。
 *
 * 里程碑：鸿鹄 V4.x — Decision Validation Phase
 * 从这一刻起进入自然运行与证据积累期，不再设计规则。
 *
 * 本文件不生产动作，不进规则指纹。
 */

import type { HunterStage } from './hunter'

/** 比「战略决定拥有什么」更接近终局的那一句。 */
export const MISSION =
  '鸿鹄不是告诉我们哪只股票会涨，而是持续判断：我们的战略假设是否仍然成立，以及在当前证据下，下一单位资本是否值得继续交给这家公司。'

/** 未知不能偷偷变成偏多时的核心语言。 */
export const OWN_BUT_CANNOT_RAISE =
  '拥有资格成立，但资本向上迁移依据不足。'

/** 从现在起，最重要的产物不是今日动作，而是可被一年后审问的理由。 */
export const PRIMARY_ARTIFACT =
  '鸿鹄最重要的产物不是今天给出什么动作，而是为什么给出这个动作，以及一年后能不能审问这个动作。'

/** 每天只盯这一问。没有新事实，就维持。 */
export const DAILY_QUESTION =
  '今天有没有出现足以改变资本状态的新事实？'

/** 维持是主动决策：有能力加仓，但证据没到迁移标准。 */
export const HOLD_IS_AN_ACTIVE_DECISION = true

export const HOLD_AS_DECISION =
  '维持是主动决策。系统有能力加仓，但证据没有达到资本迁移标准。'

/** V4.x 架构开发到此停止。进入运行—留痕—审计—验证。V5 由数据逼出。 */
export const ARCHITECTURE_CLOSED_AT_V4X = true
export const V5_MUST_BE_FORCED_BY_DATA = true

/** 今天作为一个明确的系统里程碑。 */
export const PHASE = '鸿鹄 V4.x — Decision Validation Phase'

export const RULES_FROZEN = true
export const INDICATORS_FROZEN = true
export const LIFELINE_FROZEN = true
export const PAGE_ARCHITECTURE_FROZEN = true
export const FROZEN_RULE_FINGERPRINT = 'a401aaf3271e'

/**
 * 鸿鹄不追求每天都做出正确动作，而追求每天都做出可审计的动作。
 * 前者在当下无法证明。后者可以。
 */
export const AUDITABLE_NOT_CORRECT =
  '鸿鹄不追求每天都做出正确动作，而追求每天都做出可审计的动作。'

/** 以后出现问题，先不能问「要不要加一个指标」。 */
export function askAddIndicator(): false {
  return false
}

export const FIRST_QUESTION_ON_PROBLEM =
  '现有规则为什么无法回答？是缺数据、缺证据，还是规则本身被历史样本证明有问题？'

export type ProblemGap = 'MISSING_DATA' | 'MISSING_EVIDENCE' | 'RULE_FALSIFIED_BY_SAMPLE'

export const PROBLEM_GAPS: Record<ProblemGap, string> = {
  MISSING_DATA: '缺数据：规则能问，但当天没有可测输入。',
  MISSING_EVIDENCE: '缺证据：输入在，但还没有新的独立证据族。',
  RULE_FALSIFIED_BY_SAMPLE: '规则被历史样本证明有问题：当时合规，但 Evidence Outcome 反复证伪。',
}

/** 三个问题必须分开。不能同时算作两种缺口。 */
export function classifyProblem(gap: {
  missingData: boolean
  missingEvidence: boolean
  ruleFalsifiedBySample: boolean
}): ProblemGap | null {
  const n = Number(gap.missingData) + Number(gap.missingEvidence) + Number(gap.ruleFalsifiedBySample)
  if (n !== 1) return null
  if (gap.missingData) return 'MISSING_DATA'
  if (gap.missingEvidence) return 'MISSING_EVIDENCE'
  return 'RULE_FALSIFIED_BY_SAMPLE'
}

export const DAILY_WORK = [
  { id: 'RUN', text: '运行：按既定规则处理当天数据。' },
  { id: 'LOG', text: '留痕：为什么动、为什么不动、新增了什么证据族、哪些仍然 UNKNOWN。' },
  { id: 'AUDIT', text: '审计：价格偷换、相关证据重复计算、核心偷换成加仓、UNKNOWN 写成偏多、组合风险写成公司风险、后来结果倒灌。' },
  { id: 'VALIDATE', text: '验证：回填 Evidence Outcome，不修改过去的 Decision Quality。' },
] as const

export const DAILY_AUDIT = [
  '把价格偷偷变成迁移理由',
  '把相关证据重复计算',
  '把核心偷换成加仓资格',
  '把 UNKNOWN 写成偏多',
  '把组合风险写成公司风险',
  '把后来结果倒灌回当时决策',
] as const

export const SEVEN_QUESTIONS = [
  '战略上还应该拥有吗？',
  '支持拥有它的证据是在强化还是削弱？',
  '有没有新的、真正独立的证据？',
  '这些证据是否足以获得更多资本？',
  '组合是否允许给它更多资本？',
  '如果不允许调整，阻止它的究竟是什么？',
  '如果必须调整，是价值、战术还是组合原因？',
] as const

export const FOUR_CANNOTS = [
  {
    id: 'PRICE',
    text: '不能因为价格变化而迁移生命线',
    detail: '涨了不能加仓，跌了不能减仓。技术指标只能复核，不能变成迁移规则。',
  },
  {
    id: 'COUNT',
    text: '不能因为证据数量增加而自动迁移',
    detail: '同一订单周期里的需求、订单、收入、利润是一个证据族，不是四个。',
  },
  {
    id: 'CORE',
    text: '不能因为核心而自动增加仓位',
    detail: 'Ownership ≠ Exposure ≠ Action。核心 + 证据稳定 + 仓位合理 = 维持。',
  },
  {
    id: 'UNKNOWN',
    text: '不能把未知偷偷变成偏多',
    detail: OWN_BUT_CANNOT_RAISE,
  },
] as const

export type CannotId = typeof FOUR_CANNOTS[number]['id']

export type LegalMove =
  | 'OBSERVE_TO_ENTRY'
  | 'ENTRY_TO_ADD'
  | 'ADD_TO_TOP_UP'
  | 'CORE_TO_TACTICAL'
  | 'CORE_TO_VALUE_EXIT'

/** 一次合法迁移必须回答的问题。答成「涨了/跌了」就不合法。 */
export const LEGAL_MOVE_QUESTION: Record<LegalMove, string> = {
  OBSERVE_TO_ENTRY: '为什么现在第一次值得给它资本？',
  ENTRY_TO_ADD: '今天比第一次建仓时，多知道了什么？',
  ADD_TO_TOP_UP: '未来盈利兑现的确定性有没有进一步提高？',
  CORE_TO_TACTICAL: '哪一项关键证据恶化了？不是跌了。',
  CORE_TO_VALUE_EXIT: '当初拥有它的根本理由还在吗？',
}

export const ILLEGAL_ANSWERS: Record<LegalMove, readonly string[]> = {
  OBSERVE_TO_ENTRY: ['涨得不错', '突破均线', '技术走强'],
  ENTRY_TO_ADD: ['股价上涨', '又涨了', '趋势延续'],
  ADD_TO_TOP_UP: ['继续上涨', '创新高', '动量加强'],
  CORE_TO_TACTICAL: ['跌了所以减', '破位', '均线向下'],
  CORE_TO_VALUE_EXIT: ['股票不好看了', '跌多了', '估值太贵'],
}

export function legalMoveOf(from: HunterStage | null, to: HunterStage): LegalMove | null {
  if (from === 'OBSERVE' && to === 'ENTRY') return 'OBSERVE_TO_ENTRY'
  if (from === 'ENTRY' && to === 'ADD') return 'ENTRY_TO_ADD'
  if (from === 'ADD' && to === 'TOP_UP') return 'ADD_TO_TOP_UP'
  if (from === 'CORE' && to === 'TACTICAL_REDUCE') return 'CORE_TO_TACTICAL'
  if (from === 'CORE' && to === 'VALUE_EXIT') return 'CORE_TO_VALUE_EXIT'
  return null
}

export function answerIsIllegal(move: LegalMove, answer: string): boolean {
  return ILLEGAL_ANSWERS[move].some(p => answer.includes(p))
}

/**
 * 三类审计必须分开。
 * 后来跌了，不能改写当时合规；后来涨了，也不能说系统错过机会。
 */
export type DecisionQuality = 'COMPLIANT' | 'VIOLATION' | 'UNJUDGABLE'
export type EvidenceOutcome = 'PENDING' | 'REALIZED' | 'FALSIFIED' | 'INCONCLUSIVE'
export type CapitalOutcome = 'NOT_USED_TO_JUDGE_SYSTEM'

export const RETURNS_CANNOT_JUDGE_SYSTEM = true
export const PRICE_CANNOT_FILL_EVIDENCE_OUTCOME = true

export function laterReturnCannotReviseQuality(
  quality: DecisionQuality, laterReturn: number,
): DecisionQuality {
  void laterReturn
  return quality
}

export function priceCannotFillEvidenceOutcome(): EvidenceOutcome {
  return 'PENDING'
}

/** 后来上涨 50%，不能把当天的维持改写成应该加仓。 */
export function laterRiseCannotDemandAdd(
  action: 'HOLD_CAPITAL' | 'INCREASE_CAPITAL' | string, laterReturn: number,
): 'HOLD_CAPITAL' | 'INCREASE_CAPITAL' | string {
  void laterReturn
  return action
}

/** 后来基本面失败、资本亏损，不能把当时合规改成违规。 */
export function laterLossCannotMarkViolation(
  quality: DecisionQuality, laterReturn: number,
): DecisionQuality {
  void laterReturn
  return quality
}

/**
 * Evidence Outcome 可以改变我们对「规则是否有效」的认识，
 * 但不能改变当时的 Decision Quality。
 */
export const EVIDENCE_OUTCOME_MAY_REVISE_RULE_BELIEF = true
export const EVIDENCE_OUTCOME_CANNOT_REVISE_QUALITY = true

export function evidenceOutcomeCannotReviseQuality(
  quality: DecisionQuality, later: EvidenceOutcome,
): DecisionQuality {
  void later
  return quality
}

/**
 * 看似「系统错了」时，先按三层拆。
 * 不能用单个成功或失败案例污染系统。
 */
export const APPARENT_ERROR_LAYERS = [
  { id: 'THEN_RULE', question: '当时有没有违反规则？', writes: 'Decision Quality' },
  { id: 'LATER_FACT', question: '当时使用的证据后来有没有兑现？', writes: 'Evidence Outcome' },
  { id: 'LONG_RUN', question: '这个规则长期来看是否值得保留？', writes: '规则审计账本' },
] as const

export function splitApparentError(input: {
  violatedThen: boolean
  evidenceOutcome: EvidenceOutcome
}): {
  decisionQuality: DecisionQuality
  evidenceOutcome: EvidenceOutcome
  mayChallengeRule: false
} {
  return {
    decisionQuality: input.violatedThen ? 'VIOLATION' : 'COMPLIANT',
    evidenceOutcome: input.evidenceOutcome,
    mayChallengeRule: false,
  }
}

/** 不要因为发现了一个很有意思的案例就修改规则。 */
export const ONE_CASE_CANNOT_CHANGE_RULES = true

export function oneInterestingCaseCannotChangeRules(
  story: 'HOLD_THEN_SURGE' | 'ADD_THEN_CRASH' | string,
): typeof FROZEN_RULE_FINGERPRINT {
  void story
  return FROZEN_RULE_FINGERPRINT
}

export function lowerAddThresholdBecauseMissedRally(): false {
  return false
}

export function discardFamilyBecauseOneLoss(): false {
  return false
}

export const CHALLENGE_RULES_REQUIRES =
  '同类证据 → 同类资本迁移 → 后续基本面兑现，反复出现之后，才有资格挑战规则。'

/** 未来一年真正该形成的三张表。现在只留痕，不汇合成 V5。 */
export const THREE_LEDGERS = [
  { id: 'DECISION', name: '决策账本', asks: '当时为什么这么做。' },
  { id: 'EVIDENCE', name: '证据兑现账本', asks: '当时认为会强化的基本面，后来有没有强化。' },
  { id: 'RULE', name: '规则审计账本', asks: '某类规则长期表现如何，是否出现系统性偏差。' },
] as const

export const MOST_VALUABLE_NOW =
  '现在最有价值的动作就是：让 V4.x 安静地运行。'

export const MATURITY = {
  V1: '风险监控器：哪里违规？',
  V2: '决策语义系统：为什么调整？',
  V3: '资本生命线：资本现在处在哪一段？',
  V4: '证据驱动迁移系统：为什么资本应该向上或向下迁移？',
  V4X: '决策验证系统：这些迁移规则有没有被真实证据证明有效？',
} as const

export type DecisionSlot =
  | 'STRATEGY'
  | 'OWNERSHIP'
  | 'EVIDENCE'
  | 'FORWARD'
  | 'EXPECTATION'
  | 'PERMISSION'
  | 'EXPOSURE'
  | 'ACTION'
  | 'LIFELINE'
  | 'AUDIT'

/**
 * 冻结期不准入新规则、新指标、新页面。
 * 只允许验证：回填 Evidence Outcome。
 */
export function admits(change: {
  improves: DecisionSlot | null
  why: string
  purpose?: 'ARCHITECTURE' | 'VALIDATE'
}): boolean {
  if (askAddIndicator() !== false) return false
  if (/均线|RSI|MACD|布林|KDJ/.test(change.why)) return false
  const purpose = change.purpose ?? 'ARCHITECTURE'
  if (purpose === 'ARCHITECTURE') return false
  return change.improves === 'AUDIT' && change.why.includes('Evidence Outcome')
}
