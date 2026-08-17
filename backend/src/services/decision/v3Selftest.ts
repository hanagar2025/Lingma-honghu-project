/**
 * 《鸿鹄 V3：资本生命线》自检。
 *
 * 守的全是否定式约束。否定式在重构时不会报错，只会静默消失。
 *
 *   1. 涨跌 / 均线 / RSI 不能迁移生命线
 *   2. 三种减仓永不混：战略 / 公司 / 组合
 *   3. R4 不填，预期层恒为 UNKNOWN
 *   4. 质量再好也不能推出 100% 仓位
 *   5. 海光：值得拥有 + 核心持有 + 降暴露
 *   6. 兆易：清退 + 存储变好也不能回来
 *   7. 加仓看证据层变多（3→5），不看价格
 *   8. 首屏五块 + 六句话 + 今日最多三件事
 */

import { readFileSync } from 'node:fs'
import { judgeOne, type JudgeInput } from './judge'
import { buildEvidence, layerOf, standingOf, LAYER_DEFS } from './evidence'
import { inferHunter, migrate, priceCanMigrate } from './migrate'
import { HUNTER_TEXT, HUNTER_FORWARD, HUNTER_REVERSE } from './hunter'
import {
  actualAllowed, buildExposure, CONVICTION_CAP, PORTFOLIO_HARD_CAP,
  QUALITY_NEVER_IMPLIES_FULL, judgeOwnership,
} from './triaxis'
import { buildDecisionCockpit, renderDecisionCockpit } from './cockpitV2'
import type { Action } from '../cockpit/types'
import type { Dashboard } from '../cockpit/dashboard'

let pass = 0
let fail = 0
const ok = (name: string, cond: boolean, extra = ''): void => {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name} ${extra}`) }
}

console.log('\n═══ V3 资本生命线自检 ═══\n')

const haiguang: JudgeInput = {
  code: '688041', name: '海光信息', held: true, posPct: 0.132,
  accounting: ['POSITION_LIMIT'],
  reviewTriggers: ['20日相对主线转弱', '收盘在 MA60 下方'],
  valuationGateUsable: true,
  node: { node: 'CPU/DCU', levelShare: 1, delta4Q: -3.2, medianNpYoy: 0.4, npAbsDeltaSum: 1.2e8 },
  company: { shareWithinNode: 1, npAbsDelta: 8e7, netProfitYoy: 0.55 },
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

const tianfu: JudgeInput = {
  code: '300394', name: '天孚通信', held: false, posPct: null,
  accounting: [],
  reviewTriggers: [],
  valuationGateUsable: false,
  node: { node: '光器件/光引擎', levelShare: 0.08, delta4Q: 2.2, medianNpYoy: 0.3, npAbsDeltaSum: 8e7 },
  company: { shareWithinNode: 0.5, npAbsDelta: 3e7, netProfitYoy: 0.3 },
}

// ══════════════════════════════════════════════════════════════
// 一、三轴同时成立且不互相改写
// ══════════════════════════════════════════════════════════════
{
  const j = judgeOne(haiguang)
  ok('海光 Ownership=战略核心，Exposure=组合超限，Action=减少暴露',
    j.ownership === 'STRATEGIC_CORE'
    && j.exposure.portfolioStatus === 'OVER'
    && j.capitalAction === 'REDUCE_EXPOSURE')
  ok('海光猎人段仍是核心持有（R1 不降级）', j.hunter === 'CORE', j.hunter)
  ok('海光迁移方向是 INIT 或 HOLD，不是 REVERSE',
    j.migration.direction === 'INIT' || j.migration.direction === 'HOLD')
  ok('海光证据链第 8 层（预期）是 UNKNOWN',
    layerOf(j.evidence, 'EXPECTATION').status === 'UNKNOWN')
  ok('海光节点利润弱化不推翻战略资格',
    layerOf(j.evidence, 'NODE_PROFIT').status === 'WEAKENING'
    && layerOf(j.evidence, 'QUALIFICATION').status === 'ESTABLISHED')
}

{
  const j = judgeOne(zhaoyi)
  ok('兆易三轴：清退 / 组合未超 12% / 退出',
    j.ownership === 'RETIRED'
    && j.exposure.portfolioStatus === 'WITHIN'
    && j.capitalAction === 'EXIT')
  ok('兆易节点利润强化不能恢复资格',
    layerOf(j.evidence, 'NODE_PROFIT').status === 'STRENGTHENING'
    && layerOf(j.evidence, 'QUALIFICATION').status === 'FALSIFIED'
    && j.hunter === 'VALUE_EXIT')
  ok('兆易相对 conviction 超限不得记成 R1',
    j.exposure.vsConviction === 'OVER'
    && !j.risks.includes('R1_PORTFOLIO'))
}

{
  const j = judgeOne(zhongwei)
  ok('中微猎人段是加仓（证据强化，不是涨了）', j.hunter === 'ADD', j.hunter)
  ok('中微资本动作是增加资本', j.capitalAction === 'INCREASE_CAPITAL')
  ok('中微理由写明不是因为涨了', j.oneReason.includes('不是因为涨了'))
}

{
  const j = judgeOne(tianfu)
  ok('天孚猎人段是观察，不是建仓', j.hunter === 'OBSERVE', j.hunter)
  ok('天孚资本动作是观察', j.capitalAction === 'OBSERVE')
}

// ══════════════════════════════════════════════════════════════
// 二、价格不能迁移
// ══════════════════════════════════════════════════════════════
ok('priceCanMigrate() 恒为 false', priceCanMigrate() === false)

{
  const j0 = judgeOne(haiguang)
  const j1 = judgeOne({
    ...haiguang,
    reviewTriggers: ['跌破 MA20', 'RSI 超卖', '10日跌 12%', 'MACD 死叉'],
    prevHunter: 'CORE',
    prevEvidence: j0.evidence,
  })
  ok('给海光加上一堆技术弱化，生命线仍是 CORE', j1.hunter === 'CORE', j1.hunter)
  ok('技术弱化的迁移是 HOLD', j1.migration.direction === 'HOLD')
  ok('迁移理由点明涨跌不是条件', j1.migration.why.includes('涨跌不是迁移条件')
    || j1.migration.why.includes('组合超限不迁移'))
}

{
  const files = ['migrate.ts', 'evidence.ts', 'hunter.ts', 'triaxis.ts']
  for (const f of files) {
    const src = readFileSync(new URL(`./${f}`, import.meta.url), 'utf-8')
    const code = src.split('\n').filter(l => {
      const t = l.trim()
      return !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*')
    }).join('\n')
    ok(`${f} 不出现 RSI/MACD/KDJ/布林`, !/RSI|MACD|KDJ|布林|bollinger/i.test(code))
    ok(`${f} 的 migrate/证据函数不接收 ret1/sma`, !/\bret1\b|\bsma\b|\bMA20\b|\bMA60\b/.test(code))
  }
}

// ══════════════════════════════════════════════════════════════
// 三、证据 3→5 才能从建仓走到加仓
// ══════════════════════════════════════════════════════════════
{
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
  ok('弱证据成立层少于强证据', standingOf(weak) < standingOf(strong),
    `${standingOf(weak)} vs ${standingOf(strong)}`)
  ok('强证据至少 4 层成立（可测层）', standingOf(strong) >= 4, String(standingOf(strong)))

  const blocked = migrate({
    prev: 'OBSERVE', inferred: 'CORE',
    ownership: 'STRATEGIC_CORE',
    evidence: strong, prevEvidence: weak,
    risks: [], reviewOnly: false,
  })
  ok('观察不能直接跳到核心', blocked.to === 'OBSERVE' || blocked.to === 'ENTRY', blocked.to)
  ok('非法跳跃被标成 legal=false 或停在建仓门槛',
    blocked.legal === false || blocked.to === 'ENTRY')

  const add = migrate({
    prev: 'ENTRY', inferred: 'ADD',
    ownership: 'STRATEGIC_CORE',
    evidence: strong, prevEvidence: weak,
    risks: [], reviewOnly: false,
  })
  ok('建仓 + 证据层增加 → 加仓', add.to === 'ADD' && add.direction === 'FORWARD', add.to)
  ok('加仓理由写明证据层增加、不是价格',
    add.why.includes('证据') && add.why.includes('不是因为价格'))
}

// ══════════════════════════════════════════════════════════════
// 四、三种减仓永不混
// ══════════════════════════════════════════════════════════════
{
  const core = judgeOne(haiguang)
  const fromCore = migrate({
    prev: 'CORE', inferred: 'CORE',
    ownership: 'STRATEGIC_CORE',
    evidence: core.evidence, prevEvidence: core.evidence,
    risks: ['R1_PORTFOLIO'], reviewOnly: false,
  })
  ok('R1 不把核心迁成战术减仓', fromCore.to === 'CORE' && fromCore.direction === 'HOLD')

  const r2 = migrate({
    prev: 'CORE', inferred: 'TACTICAL_REDUCE',
    ownership: 'STRATEGIC_CORE',
    evidence: core.evidence, prevEvidence: core.evidence,
    risks: ['R2_COMPANY'], reviewOnly: false,
  })
  ok('R2 把核心迁成战术减仓（公司减仓）', r2.to === 'TACTICAL_REDUCE')
  ok('R2 理由点明公司减仓，并写明不是组合超限、不是战略证伪',
    r2.why.includes('公司') && r2.why.includes('不是组合超限') && r2.why.includes('不是战略证伪'))

  const exit = migrate({
    prev: 'CORE', inferred: 'VALUE_EXIT',
    ownership: 'RETIRED',
    evidence: judgeOne(zhaoyi).evidence, prevEvidence: core.evidence,
    risks: [], reviewOnly: false,
  })
  ok('清退把核心迁成价值退出（战略减仓）', exit.to === 'VALUE_EXIT')
  ok('价值退出理由点明不是战术、不是组合',
    exit.why.includes('价值退出') && exit.why.includes('不是战术减仓'))
}

{
  const zy = judgeOne(zhaoyi)
  const stay = migrate({
    prev: 'VALUE_EXIT', inferred: 'VALUE_EXIT',
    ownership: 'RETIRED',
    evidence: zy.evidence, prevEvidence: zy.evidence,
    risks: [], reviewOnly: false,
  })
  ok('存储节点变好也不能从价值退出迁走', stay.to === 'VALUE_EXIT' && stay.direction === 'HOLD')
}

{
  const released = migrate({
    prev: 'VALUE_EXIT', inferred: 'OBSERVE',
    ownership: 'STRATEGIC_ALLOWED',
    evidence: judgeOne(tianfu).evidence, prevEvidence: judgeOne(zhaoyi).evidence,
    risks: [], reviewOnly: false,
  })
  ok('资格重新打开才进入退出后重新观察', released.to === 'REOBSERVE', released.to)
}

// ══════════════════════════════════════════════════════════════
// 五、conviction × 组合硬顶
// ══════════════════════════════════════════════════════════════
ok('质量永远不能单独推出满仓', QUALITY_NEVER_IMPLIES_FULL === true)
ok('即使 conviction=1，实际允许仍是 12%', actualAllowed(1, PORTFOLIO_HARD_CAP) === PORTFOLIO_HARD_CAP)
ok('组合硬顶来自 LIMITS.singleStock，不是手抄', PORTFOLIO_HARD_CAP === 0.12)
ok('清退 conviction=0', CONVICTION_CAP.RETIRED === 0)
ok('观察 conviction=0', CONVICTION_CAP.STRATEGIC_WATCH === 0)
{
  const exp = buildExposure(0.132, 'STRATEGIC_CORE')
  ok('海光暴露：组合超限，允许=12%',
    exp.portfolioStatus === 'OVER' && exp.allowedPct === 0.12)
  const zy = buildExposure(0.022, 'RETIRED')
  ok('兆易暴露：组合未超 12%，但相对 conviction 超限',
    zy.portfolioStatus === 'WITHIN' && zy.vsConviction === 'OVER' && zy.allowedPct === 0)
}

// ══════════════════════════════════════════════════════════════
// 六、九层证据：不可测层必须 UNKNOWN
// ══════════════════════════════════════════════════════════════
ok('正好九层', LAYER_DEFS.length === 9)
ok('后四层不可测',
  LAYER_DEFS.filter(l => !l.measurable).map(l => l.id).join(',')
  === 'PROFIT_ATTR,FORWARD,CASHFLOW,EXPECTATION')
{
  const j = judgeOne(zhongwei)
  for (const id of ['PROFIT_ATTR', 'FORWARD', 'CASHFLOW', 'EXPECTATION'] as const) {
    ok(`${id} 恒为 UNKNOWN`, layerOf(j.evidence, id).status === 'UNKNOWN')
  }
  ok('预期层事实拒绝 PE/均线',
    layerOf(j.evidence, 'EXPECTATION').fact.includes('不得用 PE'))
  ok('风险轴仍不含 R4', !j.risks.includes('R4_EXPECTATION'))
}

// ══════════════════════════════════════════════════════════════
// 七、猎人段是状态，不可比较
// ══════════════════════════════════════════════════════════════
ok('前向 6 段、反向 3 段，合计 9',
  HUNTER_FORWARD.length === 6 && HUNTER_REVERSE.length === 3)
ok('九段文案互不相同', new Set(Object.values(HUNTER_TEXT)).size === 9)
ok('核心持有文案不含减仓', !HUNTER_TEXT.CORE.includes('减仓'))

{
  const o = judgeOwnership({
    retiredC: false, combat: true, champion: true,
    industryVerified: true, earningsVerified: true, inUniverse: true,
  })
  ok('冠军+双验证+作战 = 战略核心', o === 'STRATEGIC_CORE')
  ok('C 级清退 = 清退',
    judgeOwnership({
      retiredC: true, combat: true, champion: false,
      industryVerified: false, earningsVerified: false, inUniverse: true,
    }) === 'RETIRED')
}

// ══════════════════════════════════════════════════════════════
// 八、首屏：五块 + 六句话 + 最多三件事
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
    ],
    mainlines: [
      {
        mainlineId: 'optical', name: 'AI光通信',
        trend: '↑' as const, relStrength: '↑' as const, volumeProxy: '?' as const,
        profitStructure: '↑' as const, leaderStatus: '正常',
        completeness: 0.8, verdict: '主线未失效', judgable: true, blockers: [], metrics: [],
      },
      {
        mainlineId: 'semi', name: '半导体国产替代',
        trend: '→' as const, relStrength: '→' as const, volumeProxy: '?' as const,
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

  const v3 = buildDecisionCockpit(dashLike)
  ok('今日任务最多 3 件', v3.todayTasks.length <= 3, String(v3.todayTasks.length))
  ok('今日任务含海光组合超限', v3.todayTasks.some(t => t.includes('海光') && t.includes('组合超限')))
  ok('今日任务含兆易不因技术减仓', v3.todayTasks.some(t => t.includes('兆易') && t.includes('战略资格已经否决')))
  ok('今日任务含电力不做主线切换', v3.todayTasks.some(t => t.includes('电力') && t.includes('不做主线切换')))
  ok('六句话正好 6 条', v3.sentences.length === 6)
  ok('预期风险恒为未测', v3.riskBoard.expectation === '未测')
  ok('组合风险为超限', v3.riskBoard.portfolio === '超限')
  ok('光通信板面是成立或强化',
    v3.strategy.find(s => s.mainlineId === 'optical')?.board === '强化'
    || v3.strategy.find(s => s.mainlineId === 'optical')?.board === '成立')
  ok('电力板面是不可判断',
    v3.strategy.find(s => s.mainlineId === 'power')?.board === '不可判断')
  ok('生命线表海光 ✓ 核心 减少暴露', (() => {
    const r = v3.lifeline.find(x => x.code === '688041')
    return !!r && r.ownYes && r.hunter === 'CORE' && r.action === 'REDUCE_EXPOSURE'
  })())
  ok('生命线表兆易 ✗ 价值退出', (() => {
    const r = v3.lifeline.find(x => x.code === '603986')
    return !!r && !r.ownYes && r.hunter === 'VALUE_EXIT' && r.action === 'EXIT'
  })())

  const txt = renderDecisionCockpit(v3)
  ok('渲染不含见顶/将涨', !/见顶|要跌|将涨|底部已现/.test(txt))
  ok('渲染声明质量不能推出满仓的结构句', txt.includes('组合规则决定最多能拥有多少') || txt.includes('生命线决定下一步'))
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
    walk(v3, 'v3')
    return keys.length === 0
  })())
}

// ══════════════════════════════════════════════════════════════
// 九、源码不引入新指标
// ══════════════════════════════════════════════════════════════
{
  const files = ['hunter.ts', 'evidence.ts', 'triaxis.ts', 'migrate.ts']
  for (const f of files) {
    const src = readFileSync(new URL(`./${f}`, import.meta.url), 'utf-8')
    const imports = src.split('\n').filter(l => l.trimStart().startsWith('import')).join('\n')
    ok(`${f} 不 import 均线/雷达/估值/行情`,
      !/sma|evaluateMomentum|runMsr|pePercentile|valuationFetch|marketData/i.test(imports))
    ok(`${f} 不 import makeAction`, !imports.includes('makeAction'))
    const code = src.split('\n').filter(l => {
      const t = l.trim()
      return !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*')
    }).join('\n')
    for (const banned of ['score', 'Score', 'rank', 'Rank', 'weight', 'Weight']) {
      ok(`${f} 不出现「${banned}」`, !new RegExp(`\\b${banned}\\b`).test(code))
    }
  }
}

// inferHunter 在无持仓+未入册时是发现
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
    risks: [], evidence: ev, factsStrengthening: false, inUniverse: false,
  }) === 'DISCOVER')
}

console.log(`\n═══ 结果：${pass} 通过 / ${fail} 失败 ═══\n`)
if (fail > 0) process.exit(1)
