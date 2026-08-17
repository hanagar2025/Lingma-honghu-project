/**
 * 把已有证据翻译成五层决策链的输入轴。
 *
 * ── 本文件刻意不引入任何新指标 ──
 *
 * 委员会 2026-08-17：「下一阶段不是增加数据，而是把现有数据
 * 组织成战略—战术—仓位的因果决策链。」
 *
 * 因此这里只消费：
 *   - universe 上已经写死的战略资格（champion / retiredC / 三项验证）
 *   - 利润结构地图已经算好的节点份额与公司净利增量（账务事实）
 *   - 驾驶舱已经产出的法定减仓理由（账务事实）
 *
 * 不消费：均线、相对强弱、成交额比、雷达总分、PE 分位。
 * PE 分位只用于回答「S3 估值闸门是否可核」，不用于填写 R4。
 *
 * ── 三条判断必须拆开 ──
 *
 *   股票价值：值不值得继续拥有？
 *   仓位预算：组合里该拥有多少？
 *   战术当下：现在增加、维持还是减少？为什么？
 *
 * 仓位上限不是"股票不好"的判断，而是组合风险预算。
 */

import { findMember, COMBAT_MAINLINE_IDS, type UniverseMember } from '../msr/universe'
import {
  judgeActs,
  type ActVerdict, type Axes, type LifecycleState, type RiskCategory,
} from './lifecycle'
import {
  type CapitalLane, type DecisionExit, type R4Status, type StrategicState,
  type TacticalStage, type TechnicalRole,
} from './strategy'

/** 账务层已经成立的法定触发。本文件不重算阈值。 */
export type AccountingTrigger =
  | 'POSITION_LIMIT'
  | 'SECTOR_LIMIT'
  | 'THEME_LIMIT'
  | 'CIRCUIT_BREAKER'
  | 'HARD_STOP'
  | 'STRATEGY_FALSIFIED'

export interface NodeFacts {
  node: string
  levelShare: number | null
  delta4Q: number | null
  medianNpYoy: number | null
  npAbsDeltaSum: number | null
}

export interface CompanyFacts {
  shareWithinNode: number | null
  npAbsDelta: number | null
  netProfitYoy: number | null
}

/**
 * 一只标的进入决策链所需的全部已有证据。
 *
 * 字段名刻意避开研究台账（hypotheses / attribution / alternatives / link2）。
 * 研究结论可以被人阅读，但没有进入本函数的通道。
 */
export interface JudgeInput {
  code: string
  name: string
  held: boolean
  posPct: number | null
  /** 只含该标的自己的账务触发。组合熔断不挂到每一只上。 */
  accounting: readonly AccountingTrigger[]
  /** 技术复核项。只能进 REVIEW，不能进风险类别。 */
  reviewTriggers: readonly string[]
  /** S3 估值闸门是否可核。true 不表示"便宜"，只表示分位可算。 */
  valuationGateUsable: boolean
  node: NodeFacts | null
  company: CompanyFacts | null
}

export type WorthOwning = 'YES' | 'NO' | 'UNKNOWN'

export interface Judged {
  code: string
  name: string
  held: boolean
  posPct: number | null
  member: UniverseMember | null
  mainlineId: string | null
  mainlineName: string | null
  combat: boolean
  strategyAllows: boolean
  /** 第一层 */
  strategic: StrategicState
  strategicWhy: readonly string[]
  /** 第二层 */
  tactical: TacticalStage
  /** 第三层：仓位生命线。R1 不把它从 CORE 降级。 */
  lifecycle: LifecycleState
  qualification: Axes['qualification']
  risks: readonly RiskCategory[]
  r4: R4Status
  /** 第四层 */
  acts: ActVerdict
  /** 第五层 */
  exit: DecisionExit
  whyAct: string
  whyStillOwn: string
  whyNotSell: string
  worthOwning: WorthOwning
  positionBudget: 'OVER' | 'WITHIN' | 'UNKNOWN'
  lane: CapitalLane
  factsStrengthening: boolean
  technicalRole: TechnicalRole
  reviewTriggers: readonly string[]
}

const R1_TRIGGERS: readonly AccountingTrigger[] = [
  'POSITION_LIMIT', 'SECTOR_LIMIT', 'THEME_LIMIT',
]

export function judgeOne(input: JudgeInput): Judged {
  const hit = findMember(input.code)
  const member = hit?.member ?? null
  const mainlineId = hit?.mainline.id ?? null
  const mainlineName = hit?.mainline.name ?? null
  const combat = mainlineId !== null && COMBAT_MAINLINE_IDS.includes(mainlineId)
  const strategyAllows = !!member && !member.retiredC && combat

  const strategic = judgeStrategic(member, combat, input.node, input.company)
  const strategicWhy = whyStrategic(member, combat, input.node, input.company, strategic)
  const factsStrengthening = isStrengthening(member, strategyAllows, input.node, input.company)
  const risks = judgeRisks(input.accounting, input.company, input.node)
  const qualification = qualify(member, input.valuationGateUsable)
  const lifecycle = judgeLifecycle({
    held: input.held, strategic, risks, factsStrengthening, qualification, strategyAllows,
  })
  const tactical = stageOf(lifecycle, input.held, qualification, member)
  const axes: Axes = {
    code: input.code, name: input.name,
    qualification, lifecycle, risks, strategyAllows,
  }
  const acts = judgeActs(axes)
  const worthOwning = worthOf(strategic, strategyAllows)
  const positionBudget = input.posPct === null
    ? 'UNKNOWN'
    : input.accounting.some(t => R1_TRIGGERS.includes(t)) ? 'OVER' : 'WITHIN'
  const exit = pickExit(strategic, risks, factsStrengthening, acts)
  const technicalRole: TechnicalRole = input.reviewTriggers.length > 0 ? 'REVIEW' : 'NONE'

  return {
    code: input.code, name: input.name, held: input.held, posPct: input.posPct,
    member, mainlineId, mainlineName, combat, strategyAllows,
    strategic, strategicWhy, tactical, lifecycle, qualification, risks,
    r4: 'NOT_YET_MEASURABLE',
    acts, exit,
    whyAct: whyActOf(exit, input, strategic, risks),
    whyStillOwn: whyOwnOf(input, member, strategic, strategyAllows),
    whyNotSell: whyNotSellOf(input, strategic, risks, technicalRole),
    worthOwning, positionBudget,
    lane: laneOf(strategic, strategyAllows, factsStrengthening),
    factsStrengthening, technicalRole, reviewTriggers: input.reviewTriggers,
  }
}

function judgeStrategic(
  member: UniverseMember | null,
  combat: boolean,
  node: NodeFacts | null,
  company: CompanyFacts | null,
): StrategicState {
  if (!member) return 'WATCH'
  if (member.retiredC) return 'FALSIFIED'
  if (!combat) return 'WATCH'
  if (member.evidence === 'C' || member.evidence === 'D') return 'WEAKENED'

  const verified = !!member.industryVerified && !!member.earningsVerified
    && member.mainlineAttributionVerified === true
  const nodeUp = (node?.delta4Q ?? 0) > 0
  const nodeDown = node?.delta4Q !== null && node?.delta4Q !== undefined && node.delta4Q < 0
  const profitUp = (company?.npAbsDelta ?? 0) > 0

  if (member.champion && verified && nodeUp && profitUp) return 'STRENGTHENED'
  if (member.champion && verified && !nodeDown) return 'HOLDS'
  if (member.champion && verified && nodeDown) return 'HOLDS'
  if (!member.industryVerified || !member.earningsVerified) return 'WATCH'
  if (member.mainlineAttributionVerified === false) return 'WATCH'
  return 'WATCH'
}

function whyStrategic(
  member: UniverseMember | null,
  combat: boolean,
  node: NodeFacts | null,
  company: CompanyFacts | null,
  state: StrategicState,
): string[] {
  if (!member) return ['未入册，战略层尚未授予研究席位']
  const out: string[] = []
  if (member.retiredC) {
    out.push(`C级清退：${member.note ?? '战略层已关闭仓位资格，须走冠军替换四步程序'}`)
    return out
  }
  if (!combat) out.push('该主线处于「只研究不进组合」')
  if (member.champion) out.push('仍是节点冠军席位')
  if (member.industryVerified) out.push('产业验证已通过')
  else out.push('产业验证未完成')
  if (member.earningsVerified) out.push('盈利验证已通过')
  else out.push('盈利验证未完成')
  if (member.mainlineAttributionVerified === true) out.push('主线归因已核验')
  else if (member.mainlineAttributionVerified === false) out.push('主线归因未核验')
  else out.push('主线归因尚未登记')
  if (node) {
    const share = node.levelShare === null ? '缺失' : `${(node.levelShare * 100).toFixed(0)}%`
    const d = node.delta4Q === null ? '缺失' : `${node.delta4Q > 0 ? '+' : ''}${node.delta4Q.toFixed(1)}pct`
    out.push(`节点「${node.node}」利润份额 ${share}，四季变化 ${d}`)
  }
  if (company?.npAbsDelta !== null && company?.npAbsDelta !== undefined) {
    out.push(company.npAbsDelta > 0 ? '公司单季净利绝对增量 > 0' : '公司单季净利绝对增量 ≤ 0')
  }
  if (state === 'HOLDS' && node && (node.delta4Q ?? 0) < 0) {
    out.push('节点份额在缩小，但公司盈利仍兑现、战略资格未关闭 → 记为成立并核查，不是证伪')
  }
  return out
}

function isStrengthening(
  member: UniverseMember | null,
  strategyAllows: boolean,
  node: NodeFacts | null,
  company: CompanyFacts | null,
): boolean {
  if (!member || !strategyAllows || !member.earningsVerified) return false
  if ((company?.npAbsDelta ?? 0) <= 0) return false
  if (node?.delta4Q !== null && node?.delta4Q !== undefined && node.delta4Q < 0) return false
  return true
}

/**
 * 风险类别只来自账务与基本面恶化。
 *
 * 技术复核项故意不在参数里 —— 让它没有进入风险轴的通道。
 * R4 恒不写入：当前测不到预期错配。
 */
function judgeRisks(
  accounting: readonly AccountingTrigger[],
  company: CompanyFacts | null,
  node: NodeFacts | null,
): RiskCategory[] {
  const risks: RiskCategory[] = []
  if (accounting.some(t => R1_TRIGGERS.includes(t))) risks.push('R1_PORTFOLIO')
  const profitDown = company?.npAbsDelta !== null && company?.npAbsDelta !== undefined
    && company.npAbsDelta < 0
    && company.netProfitYoy !== null && company.netProfitYoy < 0
  if (profitDown) risks.push('R2_COMPANY')
  const cakeShrinking = node?.delta4Q !== null && node?.delta4Q !== undefined
    && node.delta4Q < 0
    && node.npAbsDeltaSum !== null && node.npAbsDeltaSum < 0
  if (cakeShrinking) risks.push('R3_MAINLINE')
  return risks
}

function qualify(
  member: UniverseMember | null,
  valuationGateUsable: boolean,
): Axes['qualification'] {
  if (!member || member.retiredC) return null
  const s1 = !!member.industryVerified
  const s2 = !!member.earningsVerified
  if (s1 && s2 && valuationGateUsable) return 'S3'
  if (s1 && s2) return 'S2'
  if (s1) return 'S1'
  return 'S0'
}

function judgeLifecycle(p: {
  held: boolean
  strategic: StrategicState
  risks: readonly RiskCategory[]
  factsStrengthening: boolean
  qualification: Axes['qualification']
  strategyAllows: boolean
}): LifecycleState {
  if (p.strategic === 'FALSIFIED') return 'X'
  if (p.held && p.risks.includes('R2_COMPANY')) return 'RISK_R2'
  if (p.held && p.risks.includes('R3_MAINLINE')) return 'RISK_R3'
  if (!p.held) {
    if (p.strategyAllows && p.qualification === 'S3'
      && (p.strategic === 'HOLDS' || p.strategic === 'STRENGTHENED')) return 'O1'
    return 'O0'
  }
  // R1 不改变生命线：超限是组合预算，不是公司从核心变成观察。
  if (p.factsStrengthening) return 'P2'
  if (p.strategic === 'HOLDS' || p.strategic === 'STRENGTHENED') return 'P3'
  return 'P1'
}

function stageOf(
  life: LifecycleState,
  held: boolean,
  qualification: Axes['qualification'],
  member: UniverseMember | null,
): TacticalStage {
  if (life === 'X') return 'EXIT'
  if (life === 'RISK_R2' || life === 'RISK_R3') return 'REDUCE'
  if (life === 'O1' || life === 'P1') return 'ENTRY'
  if (life === 'P2' || life === 'P4') return 'ADD'
  if (life === 'P3' || life === 'RISK_R4') return 'CORE'
  if (!held) {
    if (!member) return 'RADAR'
    if (member.industryVerified || member.earningsVerified) return 'RESEARCH'
    if (qualification === 'S0' || qualification === null) return 'RADAR'
    return 'OBSERVE'
  }
  return 'OBSERVE'
}

function worthOf(s: StrategicState, allows: boolean): WorthOwning {
  if (s === 'FALSIFIED' || !allows) return 'NO'
  if (s === 'WEAKENED') return 'UNKNOWN'
  if (s === 'HOLDS' || s === 'STRENGTHENED') return 'YES'
  return 'UNKNOWN'
}

function laneOf(
  s: StrategicState, allows: boolean, strengthening: boolean,
): CapitalLane {
  if (s === 'FALSIFIED' || !allows || s === 'WEAKENED') return 'FORBID'
  if (strengthening || s === 'STRENGTHENED' || s === 'HOLDS') return 'ENHANCE'
  return 'OBSERVE'
}

function pickExit(
  strategic: StrategicState,
  risks: readonly RiskCategory[],
  strengthening: boolean,
  acts: ActVerdict,
): DecisionExit {
  if (strategic === 'FALSIFIED') return 'VALUE_EXIT'
  if (risks.includes('R1_PORTFOLIO')) return 'PORTFOLIO_FORCE'
  if (risks.includes('R2_COMPANY') || risks.includes('R3_MAINLINE')) return 'TACTICAL_REDUCE'
  if (strengthening && (acts.allowed.includes('ADD') || acts.allowed.includes('TOP_UP'))) {
    return 'ADD_CAPITAL'
  }
  return 'HOLD'
}

function whyActOf(
  exit: DecisionExit,
  input: JudgeInput,
  strategic: StrategicState,
  risks: readonly RiskCategory[],
): string {
  if (exit === 'PORTFOLIO_FORCE') {
    const over = input.accounting.includes('POSITION_LIMIT')
    return over
      ? `减仓原因：组合风险（单票超限），不是公司价值恶化。战略状态仍是${strategic === 'FALSIFIED' ? '证伪' : '成立'}。`
      : '减仓原因：组合风险预算，不是公司价值恶化。'
  }
  if (exit === 'VALUE_EXIT') {
    return '投资逻辑已被战略层关闭。退出须走冠军替换四步程序，不是今天因价格或均线卖出。'
  }
  if (exit === 'TACTICAL_REDUCE') {
    return risks.includes('R2_COMPANY')
      ? '公司盈利兑现转坏，进入战术减仓评估（评估 ≠ 自动卖出）。'
      : '主线利润蛋糕在缩小，进入战术减仓评估。冠军身份不构成继续原仓位的理由。'
  }
  if (exit === 'ADD_CAPITAL') {
    return '加仓资格来自事实强化（盈利继续兑现且节点份额未恶化），不是价格本身。'
  }
  return '投资逻辑仍成立。今日不动作。'
}

function whyOwnOf(
  input: JudgeInput,
  member: UniverseMember | null,
  strategic: StrategicState,
  allows: boolean,
): string {
  if (!allows || strategic === 'FALSIFIED') {
    return '战略层不允许继续作为投资标的。拥有资格已关闭。'
  }
  const bits: string[] = []
  if (member?.champion) bits.push(`${input.node?.node ?? '该节点'}仍是冠军席位`)
  if (member?.earningsVerified) bits.push('盈利验证仍通过')
  if ((input.company?.npAbsDelta ?? 0) > 0) bits.push('公司利润仍在兑现')
  if (allows) bits.push('战略层允许')
  return bits.length ? bits.join('；') : '战略资格未关闭，但证据不完整，谈不上"值得重仓"。'
}

function whyNotSellOf(
  input: JudgeInput,
  strategic: StrategicState,
  risks: readonly RiskCategory[],
  technical: TechnicalRole,
): string {
  if (technical === 'REVIEW' && !risks.includes('R2_COMPANY') && !risks.includes('R3_MAINLINE')) {
    if (strategic === 'FALSIFIED') {
      return '不因技术指标减仓。退出需要战略层冠军替换程序，不是均线或相对强弱。'
    }
    return '技术复核只触发重新检查基本面，不构成减仓理由。回测已证伪价格窗口的预测能力。'
  }
  if (risks.includes('R1_PORTFOLIO') && !risks.includes('R2_COMPANY')) {
    return '今日若减，减的是组合暴露，不是否定这家公司。'
  }
  if (strategic === 'HOLDS' || strategic === 'STRENGTHENED') {
    return '战略未被证伪，盈利兑现未破坏，故不进入价值退出。'
  }
  return '无法定减仓理由，故不卖。'
}
