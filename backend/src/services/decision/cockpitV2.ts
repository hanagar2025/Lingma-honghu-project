/**
 * 《鸿鹄理财》V3 资本生命线 —— 投资人首屏装配层。
 *
 * 机器每天只回答六句话：
 *   ① 战略有没有变？
 *   ② 哪些公司仍然值得拥有？
 *   ③ 哪些公司的证据正在强化？
 *   ④ 哪些公司的风险正在增加？
 *   ⑤ 当前每家公司处于生命线哪一段？
 *   ⑥ 如果今天必须调整资本，调整的唯一合法理由是什么？
 *
 * 第一屏五块：战略 / 资本流向 / 持仓生命线 / 风险 / 今日最多三件事。
 * 复杂数据全部折叠。本文件不生产动作、不新增指标、不打分。
 *
 * V2 字段（strategy / capital / holdings / questions）仍保留，
 * 以免下游接口和自检在过渡期各说一套。
 */

import { MAINLINES, findMember } from '../msr/universe'
import type { Action } from '../cockpit/types'
import type {
  Dashboard, HoldingRow, MainlineRow, NextLayerRow, NodeStructureRow,
} from '../cockpit/dashboard'
import type { ProfitMap, NodeProfit, MemberProfit } from '../research/profitRadar'
import { judgeOne, type AccountingTrigger, type CompanyFacts, type Judged, type NodeFacts } from './judge'
import {
  EXIT_TEXT, R4_STATUS_TEXT, STRATEGIC_DOT, STRATEGIC_TEXT,
  type CapitalLane, type StrategicState,
} from './strategy'
import { HUNTER_TEXT, type HunterStage } from './hunter'
import {
  CAPITAL_ACTION_TEXT, OWNERSHIP_TEXT,
  type CapitalAction, type Ownership,
} from './triaxis'
import { LAYER_STATUS_TEXT } from './evidence'

/** 投资人首屏主线只允许这四个词。不是评分。 */
export type MainlineBoard = '成立' | '强化' | '弱化' | '不可判断'

export interface MainlineStrategyRow {
  mainlineId: string
  name: string
  combat: boolean
  strategic: StrategicState
  board: MainlineBoard
  headline: string
  why: readonly string[]
  judgable: boolean
}

export interface CapitalRow {
  code: string
  name: string
  node: string
  mainline: string
  lane: CapitalLane
  strategic: StrategicState
  facts: readonly string[]
}

export interface HoldingStateRow {
  code: string
  name: string
  posPct: number | null
  ownLogic: string
  riskLine: string
  portfolioLine: string
  decision: string
  why: string
  judged: Judged
}

export interface V2Question {
  no: 1 | 2 | 3 | 4 | 5 | 6
  question: string
  headline: string
  lines: readonly string[]
}

export interface CapitalMove {
  code: string
  name: string
  action: CapitalAction
  oneReason: string
}

export interface LifelineRow {
  code: string
  name: string
  posPct: number | null
  ownership: Ownership
  hunter: HunterStage
  action: CapitalAction
  oneReason: string
  ownYes: boolean
}

export type RiskLevel = '低' | '中' | '高' | '未知'
export type ExpectationLevel = '未测' | '低' | '中' | '高'
export type PortfolioRisk = '超限' | '正常'

export interface RiskBoard {
  strategy: RiskLevel
  company: RiskLevel
  expectation: ExpectationLevel
  portfolio: PortfolioRisk
  dataGaps: readonly string[]
}

export interface Sentence {
  no: 1 | 2 | 3 | 4 | 5 | 6
  question: string
  answer: string
}

export interface DecisionCockpit {
  date: string
  productName: '鸿鹄理财'
  productModel: '资本生命线'
  version: 'V3'
  strategy: MainlineStrategyRow[]
  capital: { enhance: CapitalRow[]; observe: CapitalRow[]; forbid: CapitalRow[] }
  holdings: HoldingStateRow[]
  questions: V2Question[]
  cards: Judged[]
  missingForDecision: readonly string[]
  noCompositeScoreNote: string
  capitalMoves: CapitalMove[]
  lifeline: LifelineRow[]
  riskBoard: RiskBoard
  todayTasks: readonly string[]
  sentences: Sentence[]
}

export interface DecisionCockpitInput {
  date: string
  holdings: HoldingRow[]
  mainlines: MainlineRow[]
  nextLayer: NextLayerRow[]
  nodeStructure: Record<string, NodeStructureRow[]>
  actions: Action[]
  pendingSellCount: number
  /** 账务事实。与驾驶舱同一份利润地图，不是研究台账。 */
  profit: ProfitMap | null
  circuitState: Dashboard['assets']['circuitState']
  circuitReason: string
}

const ACCOUNTING_REASONS: readonly AccountingTrigger[] = [
  'POSITION_LIMIT', 'SECTOR_LIMIT', 'THEME_LIMIT',
  'CIRCUIT_BREAKER', 'HARD_STOP', 'STRATEGY_FALSIFIED',
]

export function buildDecisionCockpit(input: DecisionCockpitInput): DecisionCockpit {
  const cards = collectUniverse(input).map(x => judgeOne(x))
  const byCode = new Map(cards.map(c => [c.code, c]))

  const strategy = MAINLINES.map(ml => {
    const row = input.mainlines.find(m => m.mainlineId === ml.id)
    const nodes = input.nodeStructure[ml.id] ?? []
    const top = nodes[0]
    return judgeMainline(ml.id, ml.name, row, top)
  })

  const holdings: HoldingStateRow[] = input.holdings.map(h => {
    const j = byCode.get(h.code) ?? judgeOne(toJudgeInput(h, input))
    return toHoldingState(j)
  })

  const capital = {
    enhance: cards.filter(c => showInLane(c, 'ENHANCE')).map(toCapital),
    observe: cards.filter(c => showInLane(c, 'OBSERVE')).map(toCapital),
    forbid: cards.filter(c => showInLane(c, 'FORBID')).map(toCapital),
  }

  const questions = sixQuestions({
    strategy, holdings, cards, input,
  })
  const capitalMoves = holdings.map(h => ({
    code: h.code, name: h.name,
    action: h.judged.capitalAction,
    oneReason: h.judged.oneReason,
  }))
  const lifeline = holdings.map(toLifeline)
  const riskBoard = buildRiskBoard(strategy, holdings, input)
  const todayTasks = buildTodayTasks(holdings, strategy, input)
  const sentences = questions.map(q => ({
    no: q.no, question: q.question, answer: q.headline,
  }))

  return {
    date: input.date,
    productName: '鸿鹄理财',
    productModel: '资本生命线',
    version: 'V3',
    strategy, capital, holdings, questions, cards,
    missingForDecision: MISSING,
    noCompositeScoreNote:
      '本驾驶舱不输出综合评分、总分或排名。'
      + '战略决定拥有什么；证据决定是否继续值得拥有；'
      + '战术决定现在拥有多少；组合规则决定最多能拥有多少；'
      + '生命线决定下一步资本往哪走。',
    capitalMoves, lifeline, riskBoard, todayTasks, sentences,
  }
}

const MISSING = [
  '第一优先级：市场预期 vs 实际盈利（R4 预期—估值错配因此尚未可测）',
  '第二优先级：主线收入归因（产品/应用拆分仍有缺口）',
  '第三优先级：订单 / 客户 / 产能等前瞻指标',
  '第四优先级：现金流与盈利质量（扣非已有，经营现金流/ROIC 未齐）',
  '第五优先级：真实资金结构（当前只有成交额代理）',
] as const

function collectUniverse(input: DecisionCockpitInput): ReturnType<typeof toJudgeInput>[] {
  const codes = new Set<string>()
  const out: ReturnType<typeof toJudgeInput>[] = []
  const add = (code: string, name: string, held: boolean, posPct: number | null,
    valuationGateUsable: boolean, reviewTriggers: readonly string[]) => {
    if (codes.has(code)) return
    codes.add(code)
    out.push(toJudgeInput({
      code, name, posPct, reviewTriggers, peUsable: valuationGateUsable,
    } as HoldingRow, input, held))
  }

  for (const h of input.holdings) {
    add(h.code, h.name, true, h.posPct, h.peUsable, h.reviewTriggers)
  }
  for (const ml of MAINLINES) {
    for (const m of ml.members) {
      if (m.champion || m.retiredC) {
        add(m.code, m.name, false, null, false, [])
      }
    }
  }
  for (const n of input.nextLayer) {
    for (const m of n.members) add(m.code, m.name, false, null, false, [])
  }
  return out
}

function toJudgeInput(
  h: Pick<HoldingRow, 'code' | 'name' | 'posPct' | 'reviewTriggers' | 'peUsable'>,
  input: DecisionCockpitInput,
  held = true,
): Parameters<typeof judgeOne>[0] {
  const hit = findMember(h.code)
  const nodeName = hit?.member.node
  const np = findNode(input.profit, hit?.mainline.id, nodeName)
  const mine = np?.members.find(m => m.code === h.code) ?? findMemberProfit(input.profit, h.code)
  const accounting = triggersOf(h.code, input.actions)
  return {
    code: h.code, name: h.name, held, posPct: h.posPct ?? null,
    accounting, reviewTriggers: h.reviewTriggers ?? [],
    valuationGateUsable: !!h.peUsable,
    node: np ? nodeFacts(np) : null,
    company: mine ? companyFacts(mine) : null,
  }
}

function triggersOf(code: string, actions: Action[]): AccountingTrigger[] {
  return actions
    .filter(a => a.code === code && a.kind === 'REDUCE')
    .map(a => a.reason)
    .filter((r): r is AccountingTrigger =>
      (ACCOUNTING_REASONS as readonly string[]).includes(r))
}

function findNode(
  profit: ProfitMap | null, mainlineId: string | undefined, node: string | undefined,
): NodeProfit | undefined {
  if (!profit || !mainlineId || !node) return undefined
  return profit.nodes.find(n => n.mainlineId === mainlineId && n.node === node)
}

function findMemberProfit(profit: ProfitMap | null, code: string): MemberProfit | undefined {
  if (!profit) return undefined
  for (const n of profit.nodes) {
    const hit = n.members.find(m => m.code === code)
    if (hit) return hit
  }
  return undefined
}

function nodeFacts(n: NodeProfit): NodeFacts {
  return {
    node: n.node,
    levelShare: n.levelShare,
    delta4Q: n.levelShareDelta4Q,
    medianNpYoy: n.medianNpYoy,
    npAbsDeltaSum: n.npAbsDeltaSum,
  }
}

function companyFacts(m: MemberProfit): CompanyFacts {
  return {
    shareWithinNode: m.shareWithinNode,
    npAbsDelta: m.npAbsDelta,
    netProfitYoy: m.latestSingle?.netProfitYoy ?? null,
  }
}

function judgeMainline(
  id: string, name: string, row: MainlineRow | undefined, top: NodeStructureRow | undefined,
): MainlineStrategyRow {
  const combat = MAINLINES.find(m => m.id === id)
    ? !['power'].includes(id)
    : false
  const why: string[] = []
  if (!combat) why.push('冻结令：只研究，不进组合')
  if (!row?.judgable) {
    why.push(row?.blockers.join('；') || '利润结构数据不足，不具备机会判断资格')
    return {
      mainlineId: id, name, combat,
      strategic: 'WATCH',
      board: '不可判断',
      headline: combat ? '需要核查（数据不足）' : '数据不足 · 只研究不进组合',
      why, judgable: false,
    }
  }
  const d = top?.delta4Q ?? null
  if (d !== null) {
    why.push(`首位节点「${top?.node}」份额四季 ${d > 0 ? '+' : ''}${d.toFixed(1)}pct`)
  }
  if ((d ?? 0) < 0) {
    why.push('首位节点份额缩小，须核查是扩散还是主线走弱 —— 这不是股价判断')
    return {
      mainlineId: id, name, combat, strategic: 'WATCH',
      board: '弱化',
      headline: '主线分化，需要核查',
      why, judgable: true,
    }
  }
  why.push('首位节点利润份额未缩小，战略主线未被这份利润数据证伪')
  const rising = (d ?? 0) > 0
  return {
    mainlineId: id, name, combat,
    strategic: rising ? 'STRENGTHENED' : 'HOLDS',
    board: rising ? '强化' : '成立',
    headline: rising ? '战略强化' : '战略成立',
    why, judgable: true,
  }
}

function showInLane(c: Judged, lane: CapitalLane): boolean {
  if (c.lane !== lane) return false
  // 组合强制调整的持仓不进「增强」—— 资本方向与当日动作会互相打架。
  if (lane === 'ENHANCE' && c.exit === 'PORTFOLIO_FORCE') return false
  if (lane === 'ENHANCE' && c.exit === 'VALUE_EXIT') return false
  return true
}

function toCapital(c: Judged): CapitalRow {
  return {
    code: c.code, name: c.name,
    node: c.member?.node ?? '未归属',
    mainline: c.mainlineName ?? '未归属',
    lane: c.lane, strategic: c.strategic,
    facts: c.strategicWhy,
  }
}

function toHoldingState(j: Judged): HoldingStateRow {
  const riskBits: string[] = []
  if (j.risks.includes('R2_COMPANY')) riskBits.push('R2 公司盈利兑现转坏')
  if (j.risks.includes('R3_MAINLINE')) riskBits.push('R3 主线利润蛋糕缩小')
  if (j.technicalRole === 'REVIEW') {
    riskBits.push(`技术复核 ${j.reviewTriggers.length} 项（只触发重新检查基本面）`)
  }
  if (j.r4 === 'NOT_YET_MEASURABLE') riskBits.push('R4 尚未可测')

  const portfolio = j.positionBudget === 'OVER'
    ? `组合：超限 ${j.posPct === null ? '?' : `${(j.posPct * 100).toFixed(1)}%`} > 12%`
    : j.positionBudget === 'WITHIN'
      ? '组合：未超单票上限'
      : '组合：仓位未知'

  return {
    code: j.code, name: j.name, posPct: j.posPct,
    ownLogic: `持有逻辑：${STRATEGIC_DOT[j.strategic]} ${STRATEGIC_TEXT[j.strategic]}。${j.whyStillOwn}`,
    riskLine: riskBits.length ? `风险：${riskBits.join('；')}` : '风险：无公司/主线风险成立',
    portfolioLine: portfolio,
    decision: decisionLine(j),
    why: j.whyAct,
    judged: j,
  }
}

function decisionLine(j: Judged): string {
  if (j.exit === 'PORTFOLIO_FORCE') return '决策：减仓。减仓原因：组合风险，不是公司价值恶化。'
  if (j.exit === 'VALUE_EXIT') return '决策：不因技术指标减仓。退出须走战略层冠军替换程序。'
  if (j.exit === 'TACTICAL_REDUCE') return '决策：进入战术减仓评估（评估 ≠ 自动卖出）。'
  if (j.exit === 'ADD_CAPITAL') return '决策：具备加仓资格（事实强化）。资格 ≠ 今天必须买。'
  return '决策：维持。逻辑成立，今日不动作。'
}

function sixQuestions(p: {
  strategy: MainlineStrategyRow[]
  holdings: HoldingStateRow[]
  cards: Judged[]
  input: DecisionCockpitInput
}): V2Question[] {
  const { strategy, holdings, cards, input } = p
  const changed = strategy.filter(s => s.board === '弱化' || s.board === '不可判断')
  const stillOwn = holdings.filter(h => h.judged.worthOwning === 'YES')
  const stronger = holdings.filter(h => h.judged.factsStrengthening)
  const realRisk = holdings.filter(h =>
    h.judged.risks.includes('R2_COMPANY') || h.judged.risks.includes('R3_MAINLINE')
    || h.judged.strategic === 'FALSIFIED')
  const r1 = holdings.filter(h => h.judged.risks.includes('R1_PORTFOLIO'))

  return [
    {
      no: 1,
      question: '战略有没有变？',
      headline: changed.length === 0
        ? '作战主线均未被这份数据证伪。战略没有因为股价涨跌而改变。'
        : `需要核查：${changed.map(s => `${s.name}（${s.headline}）`).join('、')}`,
      lines: strategy.map(s =>
        `${STRATEGIC_DOT[s.strategic]} ${s.name}　${s.headline}`
        + (s.combat ? '' : '　（只研究不进组合）')),
    },
    {
      no: 2,
      question: '哪些公司仍然值得拥有？',
      headline: stillOwn.length
        ? stillOwn.map(h => h.name).join('、')
        : '当前持仓中没有被战略层明确保留为「值得拥有」的公司。',
      lines: stillOwn.map(h => `${h.name}　${h.ownLogic}`),
    },
    {
      no: 3,
      question: '哪些公司的证据正在强化？',
      headline: stronger.length
        ? `${stronger.map(h => h.name).join('、')}：盈利继续兑现且节点份额未恶化。`
        : '今日没有持仓同时满足「盈利增量 > 0 且节点份额未缩小」。价格上涨不计入。',
      lines: stronger.length
        ? stronger.map(h => `${h.name}　${h.judged.strategicWhy.join('；')}`)
        : ['事实强化 ≠ 涨得好。加仓看的是判断被新证据加固，不是均线向上。'],
    },
    {
      no: 4,
      question: '哪些公司的风险正在增加？',
      headline: realRisk.length
        ? realRisk.map(h =>
          `${h.name}（${h.judged.strategic === 'FALSIFIED' ? '战略证伪' : h.judged.risks.join('、')}）`
        ).join('、')
        : r1.length
          ? `没有公司/主线风险成立。组合风险在：${r1.map(h => h.name).join('、')}（超限 ≠ 公司变坏）。`
          : '没有公司风险、主线风险或战略证伪成立。',
      lines: [
        ...realRisk.map(h => `${h.name}　${h.riskLine}`),
        ...r1.map(h => `${h.name}　${h.portfolioLine}　—— 这是 R1，不是 R2`),
        R4_STATUS_TEXT.NOT_YET_MEASURABLE,
      ],
    },
    {
      no: 5,
      question: '当前每家公司处于生命线哪一段？',
      headline: holdings.map(h =>
        `${h.name} ${HUNTER_TEXT[h.judged.hunter]}`
      ).join('　│　') || '无持仓',
      lines: holdings.map(h =>
        `${h.name}　${HUNTER_TEXT[h.judged.hunter]}　${CAPITAL_ACTION_TEXT[h.judged.capitalAction]}　${h.judged.oneReason}`),
    },
    {
      no: 6,
      question: '如果今天必须调整资本，调整的唯一合法理由是什么？',
      headline: headlineQ6(holdings, input),
      lines: [
        ...holdings.filter(h => h.judged.exit !== 'HOLD').map(h =>
          `${h.name}　${EXIT_TEXT[h.judged.exit]}　${h.why}`),
        input.circuitState !== 'NORMAL' && input.circuitState !== 'INCOMPARABLE'
          ? `组合熔断 ${input.circuitState}：${input.circuitReason}。不指定卖哪一只。`
          : '',
        input.pendingSellCount > 0
          ? `执行债务 ${input.pendingSellCount} 笔未清偿 —— 清偿前禁止新增建仓。`
          : '',
      ].filter(Boolean),
    },
  ]
}

function headlineQ6(holdings: HoldingStateRow[], input: DecisionCockpitInput): string {
  const parts: string[] = []
  const port = holdings.filter(h => h.judged.exit === 'PORTFOLIO_FORCE')
  const val = holdings.filter(h => h.judged.exit === 'VALUE_EXIT')
  const tac = holdings.filter(h => h.judged.exit === 'TACTICAL_REDUCE')
  if (port.length) parts.push(`组合风险：${port.map(h => h.name).join('、')}`)
  if (val.length) parts.push(`战略退出评估：${val.map(h => h.name).join('、')}（须走冠军替换，不因技术卖）`)
  if (tac.length) parts.push(`战术减仓评估：${tac.map(h => h.name).join('、')}`)
  if (input.circuitState === 'LEVEL1' || input.circuitState === 'LEVEL2') {
    parts.push('组合熔断独立处理，不解释为个股变坏')
  }
  if (!parts.length) return '今日没有需要调整仓位的法定原因。R4 预期错配尚未可测，故不因估值分位调整。'
  return parts.join('。')
}

function toLifeline(h: HoldingStateRow): LifelineRow {
  return {
    code: h.code, name: h.name, posPct: h.posPct,
    ownership: h.judged.ownership,
    hunter: h.judged.hunter,
    action: h.judged.capitalAction,
    oneReason: h.judged.oneReason,
    ownYes: h.judged.worthOwning === 'YES',
  }
}

function buildRiskBoard(
  strategy: MainlineStrategyRow[],
  holdings: HoldingStateRow[],
  input: DecisionCockpitInput,
): RiskBoard {
  const combat = strategy.filter(s => s.combat)
  const strategyLevel: RiskLevel = combat.some(s => s.strategic === 'FALSIFIED')
    ? '高'
    : combat.some(s => s.board === '弱化')
      ? '中'
      : combat.every(s => s.board === '不可判断')
        ? '未知'
        : '低'
  const companyLevel: RiskLevel = holdings.some(h => h.judged.risks.includes('R2_COMPANY'))
    ? '高'
    : holdings.some(h => h.judged.strategic === 'WEAKENED')
      ? '中'
      : '低'
  const portfolio: PortfolioRisk =
    holdings.some(h => h.judged.risks.includes('R1_PORTFOLIO'))
    || input.circuitState === 'LEVEL1' || input.circuitState === 'LEVEL2'
      ? '超限'
      : '正常'
  const dataGaps = [
    '预期风险未测（R4：没有价格隐含增长 vs 可证明增长）',
    ...strategy.filter(s => s.board === '不可判断').map(s => `${s.name}：数据不足，不能做主线切换判断`),
    '目标主线利润核验、前瞻盈利证据、现金流质量均未接入',
  ]
  return {
    strategy: strategyLevel,
    company: companyLevel,
    expectation: '未测',
    portfolio,
    dataGaps,
  }
}

function buildTodayTasks(
  holdings: HoldingStateRow[],
  strategy: MainlineStrategyRow[],
  input: DecisionCockpitInput,
): string[] {
  const tasks: string[] = []
  for (const h of holdings.filter(x => x.judged.exit === 'PORTFOLIO_FORCE')) {
    tasks.push(`${h.name}：执行组合超限调整。`)
  }
  for (const h of holdings.filter(x => x.judged.strategic === 'FALSIFIED')) {
    tasks.push(`不因${h.name}技术弱化减仓。战略资格已经否决。`)
  }
  for (const s of strategy.filter(x => x.board === '不可判断')) {
    tasks.push(`${s.name}：数据不足，不做主线切换判断。`)
  }
  for (const h of holdings.filter(x => x.judged.exit === 'TACTICAL_REDUCE')) {
    tasks.push(`${h.name}：进入战术减仓评估（评估 ≠ 自动卖出）。`)
  }
  if (input.pendingSellCount > 0) {
    tasks.push(`执行债务 ${input.pendingSellCount} 笔未清偿 —— 清偿前禁止新增建仓。`)
  }
  return tasks.slice(0, 3)
}

export function renderDecisionCockpit(d: DecisionCockpit): string {
  const W = 108
  const L: string[] = []
  const w = (s = '') => L.push(s)
  w()
  w('═'.repeat(W))
  w(`  《${d.productName}》${d.productModel}  ${d.date}`)
  w('  第一层看决策。第二层看理由。第三层看证据。第四层机器看原始数据。')
  w('  战略决定拥有什么；证据决定是否继续值得拥有；生命线决定下一步资本往哪走。')
  w('═'.repeat(W))

  w()
  w('【① 战略】')
  for (const s of d.strategy) {
    w(`  ${s.name}　${s.board}`)
    for (const x of s.why.slice(0, 2)) w(`      · ${x}`)
  }

  w()
  w('【② 资本应该往哪里走】')
  if (!d.capitalMoves.length) w('  （无持仓）')
  for (const m of d.capitalMoves) {
    w(`  ${m.name}　${CAPITAL_ACTION_TEXT[m.action]}　${m.oneReason}`)
  }

  w()
  w('【③ 当前持仓生命线】')
  w('  标的　　战略　　生命线　　当前动作　　核心原因')
  for (const r of d.lifeline) {
    const own = r.ownYes ? '✓' : '✗'
    const pct = r.posPct === null ? '' : `${(r.posPct * 100).toFixed(1)}%`
    w(`  ${r.name}${pct ? ` ${pct}` : ''}　${own} ${OWNERSHIP_TEXT[r.ownership]}　${HUNTER_TEXT[r.hunter]}　${CAPITAL_ACTION_TEXT[r.action]}　${r.oneReason}`)
  }

  w()
  w('【④ 风险】')
  w(`  战略风险　${d.riskBoard.strategy}`)
  w(`  公司风险　${d.riskBoard.company}`)
  w(`  预期风险　${d.riskBoard.expectation}`)
  w(`  组合风险　${d.riskBoard.portfolio}`)
  w('  数据风险')
  for (const g of d.riskBoard.dataGaps) w(`      · ${g}`)

  w()
  w('【⑤ 今天真正需要投资人做的事】')
  if (!d.todayTasks.length) w('  今日没有必须由投资人执行的事。')
  d.todayTasks.forEach((t, i) => w(`  ${i + 1}. ${t}`))

  w()
  w('【六句话】')
  for (const q of d.sentences) {
    w(`  ${['①', '②', '③', '④', '⑤', '⑥'][q.no - 1]} ${q.question}`)
    w(`      ${q.answer}`)
  }

  w()
  w('【理由与证据（折叠）】')
  for (const h of d.holdings) {
    w(`  ${h.name}　${HUNTER_TEXT[h.judged.hunter]}`)
    w(`      理由　${h.judged.oneReason}`)
    w(`      迁移　${h.judged.migration.why}`)
    for (const layer of h.judged.evidence.layers) {
      w(`      ${layer.name}　${LAYER_STATUS_TEXT[layer.status]}　${layer.fact}`)
    }
  }

  w()
  w('【还缺什么才能做完整决策】')
  for (const m of d.missingForDecision) w(`  · ${m}`)
  w()
  w(`  ${d.noCompositeScoreNote}`)
  w()
  return L.join('\n')
}
