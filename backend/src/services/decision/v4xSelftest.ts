/**
 * 《鸿鹄 V4.x：证据有效性压力测试》
 *
 * 不是新功能。守的是：规则会不会被过度放行。
 *
 *   1. R4 不能退化成 PE 排名
 *   2. 前瞻强化 ≠ 未来已经兑现
 *   3. 同一因果链的多条事实不能算多个独立族
 *   4. 核心持有不能被读成可以继续加仓
 *   5. 迁移留痕不计算收益、不声称回测证明门槛
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { judgeOne, type JudgeInput } from './judge'
import { measureExpectation, peCanFillR4, R4_IS_NOT_A_PE_RANKING, OPPORTUNITY_CANNOT_ADD, STRETCHED_CANNOT_SELL } from './r4'
import { buildForward, FORWARD_STRENGTHENING_IS_NOT_REALIZATION, priceCanFillForward } from './forward'
import {
  CORE_IS_NOT_ADD_PERMISSION, THRESHOLDS_ARE_DESIGN_RULES,
  canAdd, canEnter, canTopUp, standingFamilies,
} from './capitalGates'
import { collapseAtoms, revenueAndProfitAreIndependent } from './independence'
import { canRaiseCapital, coreGrantsAddPermission } from './permission'
import {
  LEDGER_FIELDS, NEVER_CLAIM_BACKTEST_PROVED_FAMILIES,
  afterTheFact, formatRecord, persistJournal, recordOf,
} from './migrationJournal'
import { CORE_MEANS_OWN_NOT_ADD } from './hunter'
import {
  APPARENT_ERROR_LAYERS, ARCHITECTURE_CLOSED_AT_V4X, AUDITABLE_NOT_CORRECT,
  CHALLENGE_RULES_REQUIRES, DAILY_AUDIT, DAILY_QUESTION, DAILY_WORK, DO_NOT_RUSH,
  EVIDENCE_OUTCOME_CANNOT_REVISE_QUALITY, EVIDENCE_OUTCOME_MAY_REVISE_RULE_BELIEF,
  FIRST_QUESTION_ON_PROBLEM, FOUR_CANNOTS, FREEZE_BASELINE, FROZEN_RULE_FINGERPRINT,
  HOLD_AS_DECISION, HOLD_IS_AN_ACTIVE_DECISION, INDICATORS_FROZEN, LET_IT_RUN,
  LEGAL_MOVE_QUESTION, LIFELINE_FROZEN, LONG_TERM_GOAL, MATURITY, MISSION,
  MOST_VALUABLE_NOW, ONE_CASE_CANNOT_CHANGE_RULES, OWN_BUT_CANNOT_RAISE,
  PAGE_ARCHITECTURE_FROZEN, PHASE, PRICE_CANNOT_FILL_EVIDENCE_OUTCOME,
  PRIMARY_ARTIFACT, PROBLEM_GAPS, RETURNS_CANNOT_JUDGE_SYSTEM, RULES_FROZEN,
  SEMANTICS_FROZEN, SEVEN_QUESTIONS, THREE_LEDGERS, V5_MUST_BE_FORCED_BY_DATA,
  V5_UNDEFINED, admits, answerIsIllegal, askAddIndicator, classifyProblem,
  discardFamilyBecauseOneLoss, evidenceOutcomeCannotReviseQuality,
  feelingSystemIsInsufficient, laterLossCannotMarkViolation,
  laterReturnCannotReviseQuality, laterRiseCannotDemandAdd, legalMoveOf,
  lowerAddThresholdBecauseMissedRally, oneInterestingCaseCannotChangeRules,
  priceCannotFillEvidenceOutcome, qualifiesToChallengeFreeze, splitApparentError,
} from './charter'
import { RISK_CAN_PRODUCE } from './lifecycle'
import { buildEvidence } from './evidence'

let pass = 0
let fail = 0
const ok = (name: string, cond: boolean, extra = ''): void => {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name} ${extra}`) }
}

console.log('\n═══ V4.x 证据有效性压力测试 ═══\n')

const haiguang: JudgeInput = {
  code: '688041', name: '海光信息', held: true, posPct: 0.132,
  accounting: ['POSITION_LIMIT'],
  reviewTriggers: [],
  valuationGateUsable: true,
  node: { node: 'CPU/DCU', levelShare: 1, delta4Q: -3.2, medianNpYoy: 0.4, npAbsDeltaSum: 1.2e8 },
  company: { shareWithinNode: 1, npAbsDelta: 8e7, netProfitYoy: 0.55 },
  pePercentile: 0.9,
}

const zhaoyi: JudgeInput = {
  code: '603986', name: '兆易创新', held: true, posPct: 0.022,
  accounting: [],
  reviewTriggers: [],
  valuationGateUsable: true,
  node: { node: '存储', levelShare: 1, delta4Q: 8.4, medianNpYoy: 0.8, npAbsDeltaSum: 2e8 },
  company: { shareWithinNode: 1, npAbsDelta: 5e7, netProfitYoy: 0.26 },
}

const zhongwei: JudgeInput = {
  code: '688012', name: '中微公司', held: true, posPct: 0.044,
  accounting: [],
  reviewTriggers: [],
  valuationGateUsable: true,
  node: { node: '刻蚀/MOCVD', levelShare: 0.22, delta4Q: 4.1, medianNpYoy: 0.6, npAbsDeltaSum: 3e8 },
  company: { shareWithinNode: 0.7, npAbsDelta: 2e8, netProfitYoy: 0.4 },
}

const strong = buildEvidence({
  combat: true, retiredC: false, champion: true,
  industryVerified: true, earningsVerified: true, revenueFlag: true,
  strategyAllows: true, nodeName: '刻蚀/MOCVD',
  levelShare: 0.22, delta4Q: 4.1, npAbsDeltaSum: 3e8,
  shareWithinNode: 0.7, npAbsDelta: 2e8,
})
const emptyGate = {
  chain: strong, companyProfitUp: true, forward: 'UNKNOWN' as const,
  r4: 'UNKNOWN' as const, ownership: 'STRATEGIC_CORE' as const, risks: [] as const,
}

// ══════════════════════════════════════════════════════════════
// 一、R4 不能退化成估值模块
// ══════════════════════════════════════════════════════════════
ok('R4 不是估值排名', R4_IS_NOT_A_PE_RANKING === true)
ok('PE 不能填 R4', peCanFillR4() === false)
ok('OPPORTUNITY 不能直接加仓', OPPORTUNITY_CANNOT_ADD === true)
ok('STRETCHED 不能卖出', STRETCHED_CANNOT_SELL === true)
ok('R4 可产生卖出集仍为空', RISK_CAN_PRODUCE.R4_EXPECTATION.length === 0)

{
  const highPe = measureExpectation({
    impliedGrowth: null, supportedGrowth: null, pePercentile: 0.95, peTtm: 90,
  })
  const lowPe = measureExpectation({
    impliedGrowth: null, supportedGrowth: null, pePercentile: 0.05, peTtm: 8,
  })
  ok('高估值 + 两端缺失 → UNKNOWN，不是 STRETCHED', highPe.verdict === 'UNKNOWN')
  ok('低估值 + 两端缺失 → UNKNOWN，不是 OPPORTUNITY', lowPe.verdict === 'UNKNOWN')
}

{
  const highGrowthHighImplied = measureExpectation({
    impliedGrowth: 0.5, supportedGrowth: 0.5, pePercentile: 0.95,
  })
  const highGrowthFair = measureExpectation({
    impliedGrowth: 0.25, supportedGrowth: 0.4, pePercentile: 0.4,
  })
  const lowGrowthStretched = measureExpectation({
    impliedGrowth: 0.4, supportedGrowth: 0.08, pePercentile: 0.2,
  })
  const lowGrowthCheapLooking = measureExpectation({
    impliedGrowth: 0.08, supportedGrowth: 0.08, pePercentile: 0.05,
  })
  ok('高增长且两端匹配 → ALIGNED，即使 PE 很高', highGrowthHighImplied.verdict === 'ALIGNED')
  ok('高增长且证据高于隐含 → OPPORTUNITY', highGrowthFair.verdict === 'OPPORTUNITY')
  ok('低增长但价格要求很高 → STRETCHED，即使 PE 看起来不高',
    lowGrowthStretched.verdict === 'STRETCHED')
  ok('低增长且两端匹配 → ALIGNED，PE 低不能加成机会',
    lowGrowthCheapLooking.verdict === 'ALIGNED')
}

{
  const opp = measureExpectation({ impliedGrowth: 0.1, supportedGrowth: 0.3 })
  const add = canAdd({ ...emptyGate, r4: 'OPPORTUNITY' }, standingFamilies(emptyGate))
  ok('OPPORTUNITY 文案写明本身不能加仓', opp.why.includes('本身不能加仓'))
  ok('只多了预期差，不能加仓', add.ok === false)
}

// ══════════════════════════════════════════════════════════════
// 二、前瞻强化 ≠ 已经兑现
// ══════════════════════════════════════════════════════════════
ok('前瞻强化不是兑现证明', FORWARD_STRENGTHENING_IS_NOT_REALIZATION === true)
ok('价格不能冒充前瞻', priceCanFillForward() === false)

{
  const fwd = buildForward([
    { id: 'ORDERS', tone: 'STRENGTHENING', fact: '在手订单增加' },
    { id: 'GUIDANCE', tone: 'STRENGTHENING', fact: '上调指引' },
  ])
  ok('当时可以记强化', fwd.tone === 'STRENGTHENING')
  ok('文案不声称未来几个季度已经兑现',
    !/将兑现|已经兑现|证明未来|回测证明/.test(fwd.why))
  ok('文案只说正在强化，不说资本应当加仓',
    fwd.why.includes('正在强化') && !fwd.why.includes('加仓'))
}

// ══════════════════════════════════════════════════════════════
// 三、独立证据族去重
// ══════════════════════════════════════════════════════════════
ok('收入与扣非利润不是两个独立族', revenueAndProfitAreIndependent() === false)
ok('族数门槛是设计规则，不是统计规律', THRESHOLDS_ARE_DESIGN_RULES === true)

{
  const sameCycle = collapseAtoms([
    { kind: 'INDUSTRY_DEMAND', causalSource: 'customer-X-2026H1', fact: 'AI服务器需求增加' },
    { kind: 'ORDERS', causalSource: 'customer-X-2026H1', fact: '公司订单增加' },
    { kind: 'REVENUE', causalSource: 'customer-X-2026H1', fact: '公司收入增加' },
    { kind: 'NET_PROFIT', causalSource: 'customer-X-2026H1', fact: '利润增加' },
  ])
  ok('同一订单周期四条事实 → 1 个独立族', sameCycle.independent === 1, String(sameCycle.independent))
  ok('折叠理由点明重复记录', sameCycle.why.includes('重复记录'))
}

{
  const earningsOnly = collapseAtoms([
    { kind: 'REVENUE', causalSource: 'fy2025', fact: '收入 +30%' },
    { kind: 'NET_PROFIT', causalSource: 'fy2025', fact: '扣非 +40%' },
  ])
  ok('收入 + 扣非 → 1 族', earningsOnly.independent === 1)
}

{
  const two = collapseAtoms([
    { kind: 'REVENUE', causalSource: 'fy2025', fact: '收入 +30%' },
    { kind: 'DESIGN_WIN', causalSource: 'new-customer-2026', fact: '新客户导入' },
  ])
  ok('收入 + 新客户导入 → 2 族', two.independent === 2, String(two.independent))
}

{
  const sameFamilyDiffSource = collapseAtoms([
    { kind: 'REVENUE', causalSource: 'q1', fact: 'Q1 收入' },
    { kind: 'NET_PROFIT', causalSource: 'q2', fact: 'Q2 利润' },
  ])
  ok('同一盈利族、不同季度仍是 1 族（重复事实）',
    sameFamilyDiffSource.independent === 1)
}

// ══════════════════════════════════════════════════════════════
// 四、核心 ≠ 加仓许可；迁移不得过度放行
// ══════════════════════════════════════════════════════════════
ok('核心不授予加仓许可', coreGrantsAddPermission() === false)
ok('CORE_IS_NOT_ADD_PERMISSION 恒为 true', CORE_IS_NOT_ADD_PERMISSION === true)
ok('总纲钉死核心语义', CORE_MEANS_OWN_NOT_ADD.includes('核心 ≠ 可以继续加仓'))

{
  const j = judgeOne(zhongwei)
  const raise = canRaiseCapital({
    ownership: j.ownership,
    hunter: j.hunter,
    exposureOver: j.exposure.portfolioStatus === 'OVER',
    add: canAdd(emptyGate, standingFamilies(emptyGate)),
    topUp: canTopUp(emptyGate, standingFamilies(emptyGate)),
    r4: j.expectation.verdict,
  })
  ok('中微是核心持有', j.hunter === 'CORE')
  ok('中微证据强化', j.evidenceTone === 'STRENGTHENING')
  ok('中微今日不得加仓', j.capitalAction === 'HOLD_CAPITAL')
  ok('核心 + R4 未测 + 无新独立族 → 没有提高权重的资格',
    raise.ok === false && (raise.verdict === 'HOLD' || raise.verdict === 'UNJUDGABLE'))
}

{
  const j = judgeOne(haiguang)
  const raise = canRaiseCapital({
    ownership: j.ownership,
    hunter: j.hunter,
    exposureOver: true,
    add: { ok: false, why: '', standing: [], missing: [], gained: [] },
    topUp: { ok: false, why: '', standing: [], missing: [], gained: [] },
    r4: 'UNKNOWN',
  })
  ok('海光仍是核心持有', j.hunter === 'CORE' && j.ownership === 'STRATEGIC_CORE')
  ok('海光动作是降暴露，不是价值退出',
    j.capitalAction === 'REDUCE_EXPOSURE' && j.exit === 'PORTFOLIO_FORCE')
  ok('超限时迁移资格是 REDUCE，不是 RAISE', raise.verdict === 'REDUCE')
}

{
  const j = judgeOne(zhaoyi)
  ok('兆易产业改善不能恢复加仓资格',
    j.ownership === 'RETIRED' && j.capitalAction === 'EXIT')
  ok('不能建仓', canEnter({
    ...emptyGate,
    chain: j.evidence,
    ownership: 'RETIRED',
    companyProfitUp: true,
  }).ok === false)
}

{
  const raise = canRaiseCapital({
    ownership: 'STRATEGIC_CORE',
    hunter: 'CORE',
    exposureOver: false,
    add: { ok: true, why: '表面上过了', standing: [], missing: [], gained: [] },
    topUp: { ok: false, why: '', standing: [], missing: [], gained: [] },
    r4: 'ALIGNED',
    newIndependentFamilies: 0,
  })
  ok('去重后 0 个新族，即使闸门表面通过也不能加仓',
    raise.ok === false && raise.why.includes('没有新的独立证据族'))
}

{
  const j = judgeOne({
    ...zhongwei,
    impliedGrowth: 0.5,
    supportedGrowth: 0.2,
  })
  ok('STRETCHED 仍是核心持有，不卖',
    j.hunter === 'CORE' && j.capitalAction === 'HOLD_CAPITAL')
  const raise = canRaiseCapital({
    ownership: j.ownership, hunter: j.hunter, exposureOver: false,
    add: { ok: true, why: 'x', standing: [], missing: [], gained: ['FORWARD'] },
    topUp: { ok: true, why: 'x', standing: [], missing: [], gained: ['FORWARD'] },
    r4: 'STRETCHED',
  })
  ok('STRETCHED 即使有新族也不得再增加资本', raise.ok === false && raise.verdict === 'HOLD')
}

// ══════════════════════════════════════════════════════════════
// 五、迁移留痕：记录为什么，不算收益
// ══════════════════════════════════════════════════════════════
ok('禁止声称回测证明了族数门槛', NEVER_CLAIM_BACKTEST_PROVED_FAMILIES === true)

{
  const j = judgeOne(zhongwei)
  const rec = recordOf('2026-08-17', j)
  ok('留痕含日期、公司、从→到、动作',
    rec.date === '2026-08-17' && rec.code === '688012' && rec.to === 'CORE')
  ok('留痕声明不是收益归因', rec.notAReturnClaim === true)
  ok('中微阻止条件含 R4 与前瞻 UNKNOWN',
    rec.blockers.some(b => b.includes('R4')) && rec.blockers.some(b => b.includes('前瞻')))
  const txt = formatRecord(rec)
  ok('留痕文本含资本动作与原因',
    txt.includes('资本动作') && txt.includes(rec.why))
  ok('留痕文本拒绝收益归因和门槛有效性声称',
    txt.includes('不是收益归因') && txt.includes('不证明族数门槛有效'))
  ok('Decision Quality 当时合规，Evidence Outcome 只能 PENDING',
    rec.decisionQuality === 'COMPLIANT' && rec.evidenceOutcome === 'PENDING')
  ok('Capital Outcome 不得用来判断系统',
    rec.capitalOutcome === 'NOT_USED_TO_JUDGE_SYSTEM')
  ok('后来大跌不能改写当时合规',
    laterReturnCannotReviseQuality(rec.decisionQuality, -0.4) === 'COMPLIANT')
  ok('价格不能填 Evidence Outcome',
    priceCannotFillEvidenceOutcome() === 'PENDING'
    && PRICE_CANNOT_FILL_EVIDENCE_OUTCOME === true)
}

{
  const dir = mkdtempSync(join(tmpdir(), 'hh-mig-'))
  try {
    const j = judgeOne(haiguang)
    persistJournal('2026-08-17', [j], dir)
    const raw = readFileSync(join(dir, '2026-08-17.json'), 'utf-8')
    ok('档案可落盘且不含 score/rank/weight 字段名',
      !/"score"|"rank"|"weight"/i.test(raw))
    ok('档案不含回测证明措辞', !/回测证明/.test(raw))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

{
  const files = [
    'independence.ts', 'permission.ts', 'migrationJournal.ts',
    'r4.ts', 'forward.ts', 'capitalGates.ts', 'charter.ts',
  ]
  for (const f of files) {
    const src = readFileSync(new URL(`./${f}`, import.meta.url), 'utf-8')
    const code = src.split('\n').filter(l => {
      const t = l.trim()
      return !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*')
    }).join('\n')
    ok(`${f} 不出现回测证明`, !/回测证明/.test(code))
    for (const banned of ['score', 'Score', 'rank', 'Rank', 'weight', 'Weight']) {
      ok(`${f} 不出现「${banned}」`, !new RegExp(`\\b${banned}\\b`).test(code))
    }
  }
}

// ══════════════════════════════════════════════════════════════
// 六、四个不能 + 合法迁移问题 + 准入闸门
// ══════════════════════════════════════════════════════════════
ok('使命钉死：不是预测哪只股票会涨', MISSION.includes('不是告诉我们哪只股票会涨'))
ok('核心语言：拥有资格成立，但资本向上迁移依据不足',
  OWN_BUT_CANNOT_RAISE === '拥有资格成立，但资本向上迁移依据不足。')
ok('机器先问七问，不是先问涨跌', SEVEN_QUESTIONS.length === 7
  && !SEVEN_QUESTIONS.some(q => q.includes('涨') || q.includes('跌')))
ok('四个不能齐备', FOUR_CANNOTS.map(c => c.id).join('|') === 'PRICE|COUNT|CORE|UNKNOWN')
ok('收益率不能判断系统好坏', RETURNS_CANNOT_JUDGE_SYSTEM === true)
ok('成熟度停在 V4.x 验证期，不预定义 V5',
  MATURITY.V4X.includes('决策验证系统') && !('V5' in MATURITY))

ok('观察→建仓必须问为什么第一次给资本',
  LEGAL_MOVE_QUESTION.OBSERVE_TO_ENTRY.includes('第一次值得给它资本'))
ok('建仓→加仓必须问今天多知道了什么',
  LEGAL_MOVE_QUESTION.ENTRY_TO_ADD.includes('多知道了什么'))
ok('加仓→追加必须问未来兑现确定性',
  LEGAL_MOVE_QUESTION.ADD_TO_TOP_UP.includes('未来盈利兑现'))
ok('核心→战术减仓必须问哪项证据恶化',
  LEGAL_MOVE_QUESTION.CORE_TO_TACTICAL.includes('证据恶化'))
ok('核心→价值退出必须问根本理由还在吗',
  LEGAL_MOVE_QUESTION.CORE_TO_VALUE_EXIT.includes('根本理由'))

ok('「涨得不错」不能作为建仓答案',
  answerIsIllegal('OBSERVE_TO_ENTRY', '它涨得不错'))
ok('「股价上涨」不能作为加仓答案',
  answerIsIllegal('ENTRY_TO_ADD', '因为股价上涨'))
ok('「跌了所以减」不能作为战术减仓答案',
  answerIsIllegal('CORE_TO_TACTICAL', '跌了所以减'))
ok('合法映射：观察→建仓', legalMoveOf('OBSERVE', 'ENTRY') === 'OBSERVE_TO_ENTRY')
ok('核心维持不是一次向上迁移', legalMoveOf('CORE', 'CORE') === null)

ok('新均线指标答不出改善哪个决策 → 不准入',
  admits({ improves: null, why: '再加一条均线' }) === false)
ok('RSI 页面没有决策槽位 → 不准入',
  admits({ improves: null, why: '' }) === false)
ok('冻结期即使改善 Evidence 也不准入新规则',
  admits({ improves: 'EVIDENCE', why: '同一因果链不得数成四个族' }) === false)
ok('冻结期只允许回填 Evidence Outcome',
  admits({
    improves: 'AUDIT',
    why: '回填 Evidence Outcome',
    purpose: 'VALIDATE',
  }) === true)

{
  const j = judgeOne(zhongwei)
  ok('中微一句话用上核心语言', j.oneReason.includes(OWN_BUT_CANNOT_RAISE))
}

// ══════════════════════════════════════════════════════════════
// 七、停点：维持是主动决策；账本可事后审问；正确的不作为
// ══════════════════════════════════════════════════════════════
ok('最重要产物是可被审问的理由，不是今日动作',
  PRIMARY_ARTIFACT.includes('一年后能不能审问这个动作'))
ok('每天只盯有没有足以改变资本状态的新事实',
  DAILY_QUESTION.includes('足以改变资本状态的新事实'))
ok('维持是主动决策', HOLD_IS_AN_ACTIVE_DECISION === true
  && HOLD_AS_DECISION.includes('系统有能力加仓'))
ok('架构开发停在 V4.x，V5 由数据逼出',
  ARCHITECTURE_CLOSED_AT_V4X === true && V5_MUST_BE_FORCED_BY_DATA === true)

{
  const j = judgeOne(zhongwei)
  ok('中微理由写明维持是主动决策', j.oneReason.includes('维持是主动决策'))
  ok('中微理由写明证据没到资本迁移标准',
    j.oneReason.includes('证据没有达到资本迁移标准'))
  const rec = recordOf('2026-08-17', j)
  for (const field of LEDGER_FIELDS) {
    ok(`账本有 ${field}`, field in rec)
  }
  ok('INIT/HOLD 的新证据族必须是空数组，站立族不算新增',
    rec.newFamilies.length === 0 && rec.action === 'HOLD_CAPITAL')
  ok('中微独立性依据写明维持是主动决策，不是系统无能',
    rec.independenceWhy.includes('维持是主动决策')
    && rec.independenceWhy.includes('不是系统无能'))
  ok('中微 Exposure 正常，不是超限', rec.exposure === '正常')
  ok('中微当日后续解释为空，Evidence Outcome 只能 PENDING',
    rec.aftermath === '' && rec.evidenceOutcome === 'PENDING')

  const rewritten = afterTheFact(rec, {
    evidenceOutcome: 'REALIZED',
    aftermath: '一年后收入继续兑现。未增加资本，因此没有捕获全部上涨。',
    laterReturn: 0.5,
    decisionQuality: 'VIOLATION',
    action: 'INCREASE_CAPITAL',
  })
  ok('后来上涨 50% 不能把维持改写成应该加仓',
    laterRiseCannotDemandAdd(rec.action, 0.5) === 'HOLD_CAPITAL'
    && rewritten.action === 'HOLD_CAPITAL')
  ok('回填不得改写 Decision Quality',
    rewritten.decisionQuality === 'COMPLIANT'
    && laterLossCannotMarkViolation('COMPLIANT', -0.4) === 'COMPLIANT')
  ok('回填只改 Evidence Outcome 与后续解释',
    rewritten.evidenceOutcome === 'REALIZED'
    && rewritten.aftermath.includes('没有捕获全部上涨'))
}

{
  const surged = judgeOne({
    ...haiguang,
    posPct: 0.14,
    accounting: ['POSITION_LIMIT'],
    reviewTriggers: ['放量上涨', '突破均线', '10日涨幅 20%'],
  })
  ok('海光仓位 14% 仍须降暴露，即使当天暴涨',
    surged.capitalAction === 'REDUCE_EXPOSURE' && surged.exit === 'PORTFOLIO_FORCE')
  ok('海光降暴露的原因是组合硬约束，不是涨跌',
    surged.oneReason.includes('组合超限') && !surged.oneReason.includes('跌'))
  const rec = recordOf('2026-08-17', surged)
  ok('海光账本新证据族仍为空', rec.newFamilies.length === 0)
  ok('海光独立性依据写明动作来自组合硬约束',
    rec.independenceWhy.includes('组合硬约束'))
}

{
  const dropped = judgeOne({
    ...haiguang,
    posPct: 0.11,
    accounting: [],
    reviewTriggers: ['放量下跌', '跌破均线', '10日跌 15%'],
  })
  ok('海光仓位 11% 时暴露回到硬顶内',
    dropped.exposure.portfolioStatus === 'WITHIN')
  ok('海光仅因暴跌不能自动减仓',
    dropped.capitalAction === 'HOLD_CAPITAL'
    && dropped.exit !== 'PORTFOLIO_FORCE'
    && !dropped.risks.includes('R1_PORTFOLIO'))
}

// ══════════════════════════════════════════════════════════════
// 八、V4.x 冻结：自然运行与证据积累，不再设计规则
// ══════════════════════════════════════════════════════════════
ok('里程碑是 Decision Validation Phase',
  PHASE === '鸿鹄 V4.x — Decision Validation Phase')
ok('规则 / 指标 / 生命线 / 页面架构 / 决策语义全部冻结',
  RULES_FROZEN && INDICATORS_FROZEN && LIFELINE_FROZEN
  && PAGE_ARCHITECTURE_FROZEN && SEMANTICS_FROZEN)
ok('冻结指纹仍是 a401aaf3271e', FROZEN_RULE_FINGERPRINT === 'a401aaf3271e')
ok('冻结基线完整，V5 不定义',
  FREEZE_BASELINE.fingerprint === 'a401aaf3271e'
  && FREEZE_BASELINE.v5 === null
  && V5_UNDEFINED === true)
ok('不追求每天正确，追求每天可审计',
  AUDITABLE_NOT_CORRECT.includes('可审计的动作')
  && AUDITABLE_NOT_CORRECT.includes('不追求每天都做出正确动作'))
ok('出现问题先不能问要不要加指标', askAddIndicator() === false)
ok('出现问题必须先问现有规则为什么无法回答',
  FIRST_QUESTION_ON_PROBLEM.includes('缺数据')
  && FIRST_QUESTION_ON_PROBLEM.includes('缺证据')
  && FIRST_QUESTION_ON_PROBLEM.includes('规则本身被历史样本证明有问题'))
ok('三个缺口必须分开：只缺数据',
  classifyProblem({ missingData: true, missingEvidence: false, ruleFalsifiedBySample: false })
  === 'MISSING_DATA')
ok('三个缺口必须分开：只缺证据',
  classifyProblem({ missingData: false, missingEvidence: true, ruleFalsifiedBySample: false })
  === 'MISSING_EVIDENCE')
ok('三个缺口必须分开：只规则被样本证伪',
  classifyProblem({ missingData: false, missingEvidence: false, ruleFalsifiedBySample: true })
  === 'RULE_FALSIFIED_BY_SAMPLE')
ok('同时勾选两种缺口 → 拒绝混答',
  classifyProblem({ missingData: true, missingEvidence: true, ruleFalsifiedBySample: false })
  === null)
ok('缺口文案三种都在',
  PROBLEM_GAPS.MISSING_DATA.includes('缺数据')
  && PROBLEM_GAPS.MISSING_EVIDENCE.includes('缺证据')
  && PROBLEM_GAPS.RULE_FALSIFIED_BY_SAMPLE.includes('Evidence Outcome'))
ok('每天只做四件事：运行留痕审计验证',
  DAILY_WORK.map(x => x.id).join('|') === 'RUN|LOG|AUDIT|VALIDATE')
ok('当日审计六条齐备', DAILY_AUDIT.length === 6
  && DAILY_AUDIT.some(x => x.includes('价格'))
  && DAILY_AUDIT.some(x => x.includes('重复计算'))
  && DAILY_AUDIT.some(x => x.includes('核心'))
  && DAILY_AUDIT.some(x => x.includes('UNKNOWN'))
  && DAILY_AUDIT.some(x => x.includes('组合风险'))
  && DAILY_AUDIT.some(x => x.includes('倒灌')))
ok('验证是回填 Evidence Outcome，不是改 Decision Quality',
  DAILY_WORK[3]!.text.includes('Evidence Outcome')
  && DAILY_WORK[3]!.text.includes('不修改过去的 Decision Quality'))
ok('加均线不能借验证期准入',
  admits({ improves: 'AUDIT', why: '再加一条均线', purpose: 'VALIDATE' }) === false)

{
  const src = readFileSync(new URL('./cockpitV2.ts', import.meta.url), 'utf-8')
  ok('驾驶舱最重要的问题是每天一问',
    src.includes('dailyQuestion: DAILY_QUESTION')
    && src.includes('DAILY_QUESTION'))
  ok('驾驶舱 maxim 以每天一问打头',
    src.includes('${DAILY_QUESTION} 没有 → 维持'))
}

// ══════════════════════════════════════════════════════════════
// 九、不破坏它：单一样本不能改规则，看似系统错了必须三层拆
// ══════════════════════════════════════════════════════════════
ok('Evidence Outcome 可以改对规则的认识，但不能改当时合规',
  EVIDENCE_OUTCOME_MAY_REVISE_RULE_BELIEF === true
  && EVIDENCE_OUTCOME_CANNOT_REVISE_QUALITY === true)
ok('后来证伪不能改写当时合规',
  evidenceOutcomeCannotReviseQuality('COMPLIANT', 'FALSIFIED') === 'COMPLIANT')
ok('后来兑现也不能把当时违规改成合规',
  evidenceOutcomeCannotReviseQuality('VIOLATION', 'REALIZED') === 'VIOLATION')
ok('看似系统错了必须拆成三层',
  APPARENT_ERROR_LAYERS.map(x => x.id).join('|') === 'THEN_RULE|LATER_FACT|LONG_RUN')

{
  const holdThenSurge = splitApparentError({
    violatedThen: false, evidenceOutcome: 'REALIZED',
  })
  ok('没加仓后暴涨：当时未违规 → Decision Quality 仍合规',
    holdThenSurge.decisionQuality === 'COMPLIANT')
  ok('没加仓后暴涨：Evidence Outcome 可以记兑现',
    holdThenSurge.evidenceOutcome === 'REALIZED')
  ok('没加仓后暴涨：单一样本不能挑战规则',
    holdThenSurge.mayChallengeRule === false)
  ok('不能立即得出鸿鹄太保守、要降低加仓门槛',
    lowerAddThresholdBecauseMissedRally() === false
    && oneInterestingCaseCannotChangeRules('HOLD_THEN_SURGE') === FROZEN_RULE_FINGERPRINT)
}

{
  const addThenCrash = splitApparentError({
    violatedThen: false, evidenceOutcome: 'FALSIFIED',
  })
  ok('加仓后暴跌：当时未违规 → Decision Quality 仍合规',
    addThenCrash.decisionQuality === 'COMPLIANT')
  ok('加仓后暴跌：Evidence Outcome 可以记证伪',
    addThenCrash.evidenceOutcome === 'FALSIFIED')
  ok('不能立即得出这个证据族没用',
    discardFamilyBecauseOneLoss() === false
    && oneInterestingCaseCannotChangeRules('ADD_THEN_CRASH') === FROZEN_RULE_FINGERPRINT)
}

ok('单一样本不能改规则', ONE_CASE_CANNOT_CHANGE_RULES === true)
ok('挑战规则必须同类证据、同类迁移、后续兑现反复出现',
  CHALLENGE_RULES_REQUIRES.includes('同类证据')
  && CHALLENGE_RULES_REQUIRES.includes('同类资本迁移')
  && CHALLENGE_RULES_REQUIRES.includes('后续基本面兑现')
  && CHALLENGE_RULES_REQUIRES.includes('反复出现'))
ok('未来一年要形成三张表：决策 / 证据兑现 / 规则审计',
  THREE_LEDGERS.map(x => x.id).join('|') === 'DECISION|EVIDENCE|RULE'
  && THREE_LEDGERS[0]!.asks.includes('当时为什么这么做')
  && THREE_LEDGERS[1]!.asks.includes('后来有没有强化')
  && THREE_LEDGERS[2]!.asks.includes('系统性偏差'))
ok('现在最有价值的动作是让 V4.x 安静地运行',
  MOST_VALUABLE_NOW.includes('安静地运行') && !('V5' in MATURITY))
ok('「系统好像不够」本身不是理由', feelingSystemIsInsufficient() === false)
ok('缺数据不能挑战冻结',
  qualifiesToChallengeFreeze('MISSING_DATA', true) === false)
ok('缺证据不能挑战冻结',
  qualifiesToChallengeFreeze('MISSING_EVIDENCE', true) === false)
ok('规则被样本证伪但只有一例，仍不能挑战冻结',
  qualifiesToChallengeFreeze('RULE_FALSIFIED_BY_SAMPLE', false) === false)
ok('只有第三种且同类样本反复出现，才有资格挑战冻结',
  qualifiesToChallengeFreeze('RULE_FALSIFIED_BY_SAMPLE', true) === true)
ok('有资格挑战 ≠ 现在改规则',
  admits({ improves: 'EVIDENCE', why: '规则被样本证伪' }) === false)
ok('长期目标是用自己的历史决策数据证明哪些证据真的重要',
  LONG_TERM_GOAL.includes('我们认为哪些证据重要')
  && LONG_TERM_GOAL.includes('历史决策数据证明哪些证据真的重要'))
ok('这一步不能急，现在就让它跑',
  DO_NOT_RUSH === true && LET_IT_RUN.includes('现在就让它跑')
  && LET_IT_RUN.includes('运行，而不是发明'))

console.log(`\n═══ 结果：${pass} 通过 / ${fail} 失败 ═══\n`)
if (fail > 0) process.exit(1)
