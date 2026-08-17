/**
 * 《鸿鹄 V4：证据 → 资本向上迁移》自检。
 *
 * V3 把退出半边立住了。本文件守的是另一半：
 * 什么证据足以让资本从观察走到建仓、加仓、追加、核心。
 *
 * 守的全是否定式约束。否定式在重构时不会报错，只会静默消失。
 *
 *   1. PE 分位不能填 R4；缺任一端必须 UNKNOWN，并写明不允许判断
 *   2. STRETCHED 只停追加/加仓/建仓，不产生任何卖出
 *   3. OPPORTUNITY 本身不能加仓
 *   4. 无前瞻细项整链 UNKNOWN；价格不能冒充前瞻
 *   5. 观察不能跳核心；建仓→加仓必须新增独立族；无 FORWARD/QUALITY/EXPECTATION 不能追加
 *   6. 海光四轴：核心 / 稳定 / 超限 / 降暴露。减仓 ≠ 看空
 *   7. 兆易：清退 + 产业改善。产业向好 ≠ 恢复战略资格
 *   8. 中微：核心 + 强化 + 维持。证据强化 ≠ 加仓资格
 *   9. 首屏五问 + 永久不可判断区
 *  10. 价格 / 均线 / RSI 不是闸门参数
 */

import { readFileSync } from 'node:fs'
import { judgeOne, type JudgeInput } from './judge'
import { buildEvidence, layerOf } from './evidence'
import { inferHunter, migrate, priceCanMigrate } from './migrate'
import { measureExpectation, peCanFillR4 } from './r4'
import { buildForward, priceCanFillForward } from './forward'
import {
  canAdd, canCore, canEnter, canTopUp, ENTRY_MIN, standingFamilies,
} from './capitalGates'
import { RISK_CAN_PRODUCE } from './lifecycle'
import { buildDecisionCockpit, renderDecisionCockpit } from './cockpitV2'
import { PRICE_IS_NOT_A_MIGRATION_CAUSE } from './hunter'
import type { Action } from '../cockpit/types'
import type { Dashboard } from '../cockpit/dashboard'

let pass = 0
let fail = 0
const ok = (name: string, cond: boolean, extra = ''): void => {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name} ${extra}`) }
}

console.log('\n═══ V4 证据 → 资本向上迁移自检 ═══\n')

const haiguang: JudgeInput = {
  code: '688041', name: '海光信息', held: true, posPct: 0.132,
  accounting: ['POSITION_LIMIT'],
  reviewTriggers: ['20日相对主线转弱', '收盘在 MA60 下方'],
  valuationGateUsable: true,
  node: { node: 'CPU/DCU', levelShare: 1, delta4Q: -3.2, medianNpYoy: 0.4, npAbsDeltaSum: 1.2e8 },
  company: { shareWithinNode: 1, npAbsDelta: 8e7, netProfitYoy: 0.55 },
  pePercentile: 0.9,
}

const zhaoyi: JudgeInput = {
  code: '603986', name: '兆易创新', held: true, posPct: 0.022,
  accounting: [],
  reviewTriggers: ['多项技术复核', '相对强弱转弱'],
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

const weak = buildEvidence({
  combat: true, retiredC: false, champion: false,
  industryVerified: true, earningsVerified: false, revenueFlag: null,
  strategyAllows: true, nodeName: '刻蚀/MOCVD',
  levelShare: 0.2, delta4Q: null, npAbsDeltaSum: null,
  shareWithinNode: null, npAbsDelta: null,
})
const strong = buildEvidence({
  combat: true, retiredC: false, champion: true,
  industryVerified: true, earningsVerified: true, revenueFlag: true,
  strategyAllows: true, nodeName: '刻蚀/MOCVD',
  levelShare: 0.22, delta4Q: 4.1, npAbsDeltaSum: 3e8,
  shareWithinNode: 0.7, npAbsDelta: 2e8,
})

// ══════════════════════════════════════════════════════════════
// 一、R4：PE 不能填；缺端必须 UNKNOWN
// ══════════════════════════════════════════════════════════════
ok('peCanFillR4() 恒为 false', peCanFillR4() === false)

{
  const g = measureExpectation({
    impliedGrowth: null, supportedGrowth: null, pePercentile: 0.9, peTtm: 80,
  })
  ok('PE 分位 90% + 两端缺失 → R4 UNKNOWN', g.verdict === 'UNKNOWN' && g.measurable === false)
  ok('UNKNOWN 写明不允许进行预期风险判断', g.why.includes('不允许进行预期风险判断'))
  ok('UNKNOWN 写明 PE 不是隐含增长', g.why.includes('PE'))
}

{
  const j = judgeOne(haiguang)
  ok('日常复跑即使传入 PE 分位，R4 仍未测',
    j.expectation.verdict === 'UNKNOWN' && j.r4 === 'NOT_YET_MEASURABLE')
  ok('兼容字段 r4 仍是 NOT_YET_MEASURABLE，真值看 expectation',
    j.r4 === 'NOT_YET_MEASURABLE' && j.expectation.verdict === 'UNKNOWN')
}

{
  const stretched = measureExpectation({ impliedGrowth: 0.5, supportedGrowth: 0.25 })
  ok('隐含 50% / 可证明 25% → STRETCHED', stretched.verdict === 'STRETCHED')
  ok('STRETCHED 写明不是减仓理由', stretched.why.includes('不是减仓理由'))
  ok('R4 不能产生任何卖出', RISK_CAN_PRODUCE.R4_EXPECTATION.length === 0)
}

{
  const opp = measureExpectation({ impliedGrowth: 0.1, supportedGrowth: 0.25 })
  ok('隐含 10% / 可证明 25% → OPPORTUNITY', opp.verdict === 'OPPORTUNITY')
  ok('OPPORTUNITY 写明本身不能加仓', opp.why.includes('本身不能加仓'))
}

{
  const aligned = measureExpectation({ impliedGrowth: 0.22, supportedGrowth: 0.25 })
  ok('两端差距 < 5pct → ALIGNED', aligned.verdict === 'ALIGNED')
}

{
  const j = judgeOne({
    ...zhongwei,
    impliedGrowth: 0.5,
    supportedGrowth: 0.25,
  })
  ok('STRETCHED 不把中微从核心持有拉下来', j.hunter === 'CORE', j.hunter)
  ok('STRETCHED 不产生减仓动作',
    j.capitalAction === 'HOLD_CAPITAL' && j.exit === 'HOLD')
  ok('STRETCHED 不写入风险轴', !j.risks.includes('R4_EXPECTATION'))
}

// ══════════════════════════════════════════════════════════════
// 二、未来盈利证据链
// ══════════════════════════════════════════════════════════════
ok('priceCanFillForward() 恒为 false', priceCanFillForward() === false)

{
  const empty = buildForward([])
  ok('无前瞻细项 → 整链 UNKNOWN', empty.tone === 'UNKNOWN' && empty.known === 0)
  ok('UNKNOWN 前瞻拒绝把历史写成未来', empty.why.includes('历史利润不是前瞻'))
}

{
  const fwd = buildForward([
    { id: 'ORDERS', tone: 'STRENGTHENING', fact: '在手订单可见度拉长' },
    { id: 'GUIDANCE', tone: 'STRENGTHENING', fact: '公司上调全年指引' },
  ])
  ok('订单+指引强化 → 投资人词是强化', fwd.tone === 'STRENGTHENING')
  ok('未接入细项仍保留为 UNKNOWN，不编造',
    fwd.items.filter(i => i.tone === 'UNKNOWN').length === 8)
}

{
  const j = judgeOne(zhongwei)
  ok('日常不传细项，前瞻层 UNKNOWN',
    j.forward.tone === 'UNKNOWN' && layerOf(j.evidence, 'FORWARD').status === 'UNKNOWN')
}

// ══════════════════════════════════════════════════════════════
// 三、资本向上迁移闸门
// ══════════════════════════════════════════════════════════════
ok('priceCanMigrate() 恒为 false', priceCanMigrate() === false)
ok('建仓最低完整度是资格+主线+盈利，不是分数',
  ENTRY_MIN.join('|') === 'QUALIFICATION|MAINLINE|EARNINGS')

{
  const blocked = migrate({
    prev: 'OBSERVE', inferred: 'CORE',
    ownership: 'STRATEGIC_CORE',
    evidence: strong, prevEvidence: weak,
    risks: [], reviewOnly: false,
    companyProfitUp: true, forward: 'UNKNOWN', r4: 'UNKNOWN',
  })
  ok('观察不能直接跳到核心', blocked.to !== 'CORE', blocked.to)
  ok('观察最多落到建仓，或停在观察',
    blocked.to === 'ENTRY' || blocked.to === 'OBSERVE', blocked.to)
  ok('每次迁移都带资本理由', !!blocked.capitalReason.text)
}

{
  const add = migrate({
    prev: 'ENTRY', inferred: 'ADD',
    ownership: 'STRATEGIC_CORE',
    evidence: strong, prevEvidence: weak,
    risks: [], reviewOnly: false,
    companyProfitUp: true, forward: 'UNKNOWN', r4: 'UNKNOWN',
  })
  ok('建仓 + 新的独立证据族 → 加仓', add.to === 'ADD' && add.direction === 'FORWARD', add.to)
  ok('加仓资本理由点明独立证据，不是价格',
    add.capitalReason.kind === 'ADD'
    && add.why.includes('独立证据')
    && add.why.includes('不是因为涨了'))
}

{
  const noTop = migrate({
    prev: 'ADD', inferred: 'TOP_UP',
    ownership: 'STRATEGIC_CORE',
    evidence: strong, prevEvidence: strong,
    risks: [], reviewOnly: false,
    companyProfitUp: true, forward: 'UNKNOWN', r4: 'UNKNOWN',
  })
  ok('没有前瞻/质量/可测预期差，不能追加', noTop.to !== 'TOP_UP', noTop.to)
}

{
  const top = migrate({
    prev: 'ADD', inferred: 'TOP_UP',
    ownership: 'STRATEGIC_CORE',
    evidence: strong, prevEvidence: strong,
    risks: [], reviewOnly: false,
    companyProfitUp: true, forward: 'STRENGTHENING', r4: 'UNKNOWN',
  })
  ok('加仓后出现未来盈利强化 → 追加', top.to === 'TOP_UP', top.to)
  ok('追加理由写明与加仓不同的独立证据',
    top.why.includes('独立证据') && top.capitalReason.kind === 'TOP_UP')
}

{
  const facts = {
    chain: strong,
    companyProfitUp: true,
    forward: 'UNKNOWN' as const,
    r4: 'OPPORTUNITY' as const,
    ownership: 'STRATEGIC_CORE' as const,
    risks: [] as const,
  }
  const prev = standingFamilies({ ...facts, r4: 'UNKNOWN' })
  const addByGap = canAdd(facts, prev)
  ok('OPPORTUNITY 本身不能加仓', addByGap.ok === false)
  ok('OPPORTUNITY 失败理由点明预期差本身不能加仓',
    addByGap.why.includes('预期差本身不能加仓'))
}

{
  const facts = {
    chain: strong,
    companyProfitUp: true,
    forward: 'UNKNOWN' as const,
    r4: 'STRETCHED' as const,
    ownership: 'STRATEGIC_CORE' as const,
    risks: [] as const,
  }
  ok('STRETCHED 挡建仓', canEnter(facts).ok === false)
  ok('STRETCHED 挡加仓', canAdd(facts, []).ok === false)
  ok('STRETCHED 挡追加', canTopUp(facts, []).ok === false)
  ok('STRETCHED 不挡核心持有', canCore(facts).ok === true)
}

{
  const j = judgeOne(zhongwei)
  ok('无昨日档案时迁移是 INIT，落位 ≠ 加仓',
    j.migration.direction === 'INIT' && j.hunter === 'CORE')
  ok('INIT 理由写明证据强化不能推出加仓',
    j.migration.why.includes('证据强化本身不能推出加仓'))
}

// ══════════════════════════════════════════════════════════════
// 四、规范案例四轴
// ══════════════════════════════════════════════════════════════
{
  const j = judgeOne(haiguang)
  ok('海光 Ownership=战略核心', j.ownership === 'STRATEGIC_CORE')
  ok('海光 Evidence=稳定（节点下降是复核）',
    j.evidenceTone === 'STABLE' && j.evidenceNote.includes('不是战略证伪'))
  ok('海光 Exposure=超限', j.exposure.portfolioStatus === 'OVER')
  ok('海光 Action=减少暴露', j.capitalAction === 'REDUCE_EXPOSURE')
  ok('海光生命线仍是核心持有。减仓 ≠ 看空', j.hunter === 'CORE')
}

{
  const j = judgeOne(zhaoyi)
  ok('兆易 Ownership=清退', j.ownership === 'RETIRED')
  ok('兆易 Evidence=产业改善但归因不足',
    j.evidenceNote.includes('产业改善但归因不足'))
  ok('兆易 Action=价值退出', j.capitalAction === 'EXIT' && j.hunter === 'VALUE_EXIT')
  ok('产业向好不能恢复战略资格',
    layerOf(j.evidence, 'NODE_PROFIT').status === 'STRENGTHENING'
    && layerOf(j.evidence, 'QUALIFICATION').status === 'FALSIFIED')
}

{
  const j = judgeOne(zhongwei)
  ok('中微 Ownership=战略核心', j.ownership === 'STRATEGIC_CORE')
  ok('中微 Evidence=强化，且注明 ≠ 必须加仓',
    j.evidenceTone === 'STRENGTHENING' && j.evidenceNote.includes('≠ 今天必须加仓'))
  ok('中微 Exposure=正常', j.exposure.portfolioStatus === 'WITHIN')
  ok('中微 Action=维持资本', j.capitalAction === 'HOLD_CAPITAL')
  ok('中微生命线是核心持有，不是加仓', j.hunter === 'CORE')
}

// ══════════════════════════════════════════════════════════════
// 五、价格进不了闸门
// ══════════════════════════════════════════════════════════════
{
  const files = ['r4.ts', 'forward.ts', 'capitalGates.ts', 'migrate.ts']
  for (const f of files) {
    const src = readFileSync(new URL(`./${f}`, import.meta.url), 'utf-8')
    const sig = src.split('\n').filter(l => {
      const t = l.trim()
      return !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*')
    }).join('\n')
    ok(`${f} 函数签名不含 ret1/sma/MA20/RSI`,
      !/\bret1\b|\bsma\b|\bMA20\b|\bMA60\b|\bRSI\b|\bMACD\b/.test(sig))
    for (const banned of ['score', 'Score', 'rank', 'Rank', 'weight', 'Weight']) {
      ok(`${f} 不出现「${banned}」`, !new RegExp(`\\b${banned}\\b`).test(sig))
    }
  }
}

ok('总纲第二句已钉死', PRICE_IS_NOT_A_MIGRATION_CAUSE.includes('价格不是生命线迁移的原因'))

{
  const j0 = judgeOne(zhongwei)
  const j1 = judgeOne({
    ...zhongwei,
    reviewTriggers: ['突破 MA20', 'RSI 超买', '放量上涨'],
    prevHunter: 'CORE',
    prevEvidence: j0.evidence,
  })
  ok('价格上涨的技术复核不能把核心迁成加仓',
    j1.hunter === 'CORE' && j1.capitalAction === 'HOLD_CAPITAL')
}

// ══════════════════════════════════════════════════════════════
// 六、首屏：五问 + 不可判断区
// ══════════════════════════════════════════════════════════════
{
  const actions: Action[] = [{
    code: '688041', name: '海光信息', kind: 'REDUCE', reason: 'POSITION_LIMIT',
    reasonDetail: '仓位13.2% > 上限12%',
    notReason: ['不是因为对该标的的股价判断'],
    reviewTriggers: ['20日相对主线转弱'],
    size: { display: '约100股', value: 100, note: '超限部分' },
    metrics: [],
  }]
  const dashLike = {
    date: '2026-08-17',
    holdings: [
      {
        code: '688041', name: '海光信息', posPct: 0.132,
        ret1: null, ret5: null, ret20: null, relMainline: null,
        aboveMa20: false, aboveMa60: false, pePercentile: 0.9, peUsable: true,
        nodeShareArrow: '↓' as const, shareWithinNode: 1,
        industryPosition: 'CPU/DCU',
        reviewTriggers: ['20日相对主线转弱'],
        legalReason: '单票仓位超过12%上限',
        status: '超限' as const, systemAction: '减仓', metrics: [],
      },
      {
        code: '603986', name: '兆易创新', posPct: 0.022,
        ret1: null, ret5: null, ret20: null, relMainline: null,
        aboveMa20: true, aboveMa60: true, pePercentile: 0.5, peUsable: true,
        nodeShareArrow: '↑↑' as const, shareWithinNode: 1,
        industryPosition: '存储',
        reviewTriggers: ['多项技术复核'],
        legalReason: null,
        status: '观察' as const, systemAction: '不动作，仅复核', metrics: [],
      },
      {
        code: '688012', name: '中微公司', posPct: 0.044,
        ret1: null, ret5: null, ret20: null, relMainline: null,
        aboveMa20: true, aboveMa60: true, pePercentile: 0.5, peUsable: true,
        nodeShareArrow: '↑' as const, shareWithinNode: 0.7,
        industryPosition: '刻蚀/MOCVD',
        reviewTriggers: [],
        legalReason: null,
        status: '持有' as const, systemAction: '不动作', metrics: [],
      },
    ],
    mainlines: [
      {
        mainlineId: 'optical', name: 'AI光通信',
        trend: '↑' as const, relStrength: '↑' as const, volumeProxy: '?' as const,
        profitStructure: '↑' as const, leaderStatus: '正常',
        completeness: 0.5, verdict: '主线未失效', judgable: true, blockers: [], metrics: [],
      },
      {
        mainlineId: 'compute', name: 'AI算力',
        trend: '↓' as const, relStrength: '↓' as const, volumeProxy: '?' as const,
        profitStructure: '↓' as const, leaderStatus: '正常',
        completeness: 0.6, verdict: '首位节点利润份额缩小', judgable: true, blockers: [], metrics: [],
      },
      {
        mainlineId: 'power', name: 'AI电力基础设施',
        trend: '?' as const, relStrength: '?' as const, volumeProxy: '?' as const,
        profitStructure: '?' as const, leaderStatus: '样本不足',
        completeness: 0, verdict: '数据不足', judgable: false,
        blockers: ['三项验证不足'], metrics: [],
      },
    ],
    nextLayer: [] as Dashboard['nextLayer'],
    nodeStructure: {
      optical: [{
        mainlineId: 'optical', node: '光模块', npLevel: 1e9, levelShare: 0.67,
        delta4Q: 2.1, leaders: [], direction: '↑' as const,
        researchOnly: false, maxReportAgeDays: 40,
      }],
      compute: [{
        mainlineId: 'compute', node: 'CPU/DCU', npLevel: 8e8, levelShare: 0.4,
        delta4Q: -3.2, leaders: [], direction: '↓' as const,
        researchOnly: false, maxReportAgeDays: 40,
      }],
    },
    actions,
    pendingSellCount: 5,
    profit: null,
    circuitState: 'LEVEL1' as const,
    circuitReason: '组合回撤触发一级熔断',
  }

  const v4 = buildDecisionCockpit(dashLike)
  ok('版本是 V4', v4.version === 'V4')
  ok('产品模型是资本配置操作系统', v4.productModel === '资本配置操作系统')
  ok('鸿鹄五问正好 5 条', v4.sentences.length === 5 && v4.questions.length === 5)
  ok('五问覆盖委员会原话',
    v4.questions[0]!.question.includes('战略有没有变化')
    && v4.questions[1]!.question.includes('仍然值得拥有')
    && v4.questions[2]!.question.includes('投资证据在强化')
    && v4.questions[3]!.question.includes('风险正在增加')
    && v4.questions[4]!.question.includes('资本应该往哪里移动'))
  ok('总纲第二句在 maxim', v4.maxim.includes('价格不是生命线迁移的原因'))

  ok('不可判断区含电力', v4.unjudgable.some(u => u.topic.includes('电力')))
  ok('不可判断区含 R4', v4.unjudgable.some(u =>
    u.topic.includes('R4') && u.forbidden.includes('不允许进行预期风险判断')))
  ok('不可判断区含未来盈利', v4.unjudgable.some(u =>
    u.topic.includes('未来盈利') && u.forbidden.includes('历史利润')))
  ok('不可判断区含利润质量', v4.unjudgable.some(u => u.topic.includes('现金流')))

  const hg = v4.lifeline.find(x => x.code === '688041')
  const zy = v4.lifeline.find(x => x.code === '603986')
  const zw = v4.lifeline.find(x => x.code === '688012')
  ok('生命线海光：核心 / 超限 / 降暴露（利润地图未接入时证据可为 UNKNOWN）',
    !!hg && hg.hunter === 'CORE' && hg.ownYes
    && hg.exposure === '超限' && hg.action === 'REDUCE_EXPOSURE')
  ok('生命线兆易：清退 / 价值退出',
    !!zy && !zy.ownYes && zy.hunter === 'VALUE_EXIT' && zy.action === 'EXIT')
  ok('生命线中微：核心 / 正常 / 维持（证据强化 ≠ 加仓）',
    !!zw && zw.hunter === 'CORE'
    && zw.exposure === '正常' && zw.action === 'HOLD_CAPITAL')

  const txt = renderDecisionCockpit(v4)
  ok('渲染含战略 / 四轴 / 不可判断 / 五问',
    txt.includes('【战略】')
    && txt.includes('Ownership')
    && txt.includes('Evidence')
    && txt.includes('【当前无法判断】')
    && txt.includes('【鸿鹄五问】'))
  ok('渲染不含见顶/将涨/综合分', !/见顶|要跌|将涨|底部已现|综合评分\s*\d/.test(txt))
  ok('JSON 不含 score/rank/weight 字段', (() => {
    const keys: string[] = []
    const walk = (v: unknown, p: string) => {
      if (!v || typeof v !== 'object') return
      if (Array.isArray(v)) { v.forEach((x, i) => walk(x, `${p}[${i}]`)); return }
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        if (/^(score|totalScore|rating|stars|rank|weight|综合分|总分|星级)$/i.test(k)) {
          keys.push(`${p}.${k}`)
        }
        walk(val, `${p}.${k}`)
      }
    }
    walk(v4, 'v4')
    return keys.length === 0
  })())
}

// 无持仓未入册仍是发现
{
  const ev = buildEvidence({
    combat: false, retiredC: false, champion: false,
    industryVerified: false, earningsVerified: false, revenueFlag: null,
    strategyAllows: false, nodeName: null,
    levelShare: null, delta4Q: null, npAbsDeltaSum: null,
    shareWithinNode: null, npAbsDelta: null,
  })
  ok('未入册 → 发现', inferHunter({
    held: false, ownership: 'STRATEGIC_WATCH', strategic: 'WATCH',
    risks: [], evidence: ev, inUniverse: false,
    companyProfitUp: false, forward: 'UNKNOWN', r4: 'UNKNOWN',
  }) === 'DISCOVER')
}

console.log(`\n═══ 结果：${pass} 通过 / ${fail} 失败 ═══\n`)
if (fail > 0) process.exit(1)
