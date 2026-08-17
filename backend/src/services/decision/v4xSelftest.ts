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
import { formatRecord, NEVER_CLAIM_BACKTEST_PROVED_FAMILIES, persistJournal, recordOf } from './migrationJournal'
import { CORE_MEANS_OWN_NOT_ADD } from './hunter'
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
    'r4.ts', 'forward.ts', 'capitalGates.ts',
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

console.log(`\n═══ 结果：${pass} 通过 / ${fail} 失败 ═══\n`)
if (fail > 0) process.exit(1)
