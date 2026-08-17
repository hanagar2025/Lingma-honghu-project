/**
 * V2 决策架构自检。
 *
 * 守的全是否定式约束。否定式在重构时不会报错，只会静默消失，故必须每次跑。
 *
 *   1. 不加新指标：judge / strategy 不 import 均线、雷达、估值计算
 *   2. R4 不能被 PE 或技术复核填上
 *   3. 技术复核不能单独产生卖出资格
 *   4. R1 不把核心持有降成减仓阶段
 *   5. 三种卖出 / 五个出口不能混
 *   6. 海光：值得拥有 + 组合减仓，不是公司变坏
 *   7. 兆易：战略证伪 + 不因技术卖
 *   8. 无 score / rank / weight
 */

import { readFileSync } from 'node:fs'
import { judgeOne, type JudgeInput } from './judge'
import { RISK_CAN_PRODUCE } from './lifecycle'
import { R4_STATUS_TEXT, STRATEGIC_TEXT, TACTICAL_TEXT } from './strategy'
import { buildDecisionCockpit, renderDecisionCockpit } from './cockpitV2'
import type { Action } from '../cockpit/types'
import type { Dashboard } from '../cockpit/dashboard'

let pass = 0
let fail = 0
const ok = (name: string, cond: boolean, extra = ''): void => {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name} ${extra}`) }
}

console.log('\n═══ V2 决策架构自检 ═══\n')

const haiguang: JudgeInput = {
  code: '688041', name: '海光信息', held: true, posPct: 0.132,
  accounting: ['POSITION_LIMIT'],
  reviewTriggers: ['20日相对主线转弱', '收盘在 MA60 下方', 'PE 三年分位 90%'],
  valuationGateUsable: true,
  node: {
    node: 'CPU/DCU', levelShare: 1, delta4Q: -3.2,
    medianNpYoy: 0.4, npAbsDeltaSum: 1.2e8,
  },
  company: { shareWithinNode: 1, npAbsDelta: 8e7, netProfitYoy: 0.55 },
}

const zhaoyi: JudgeInput = {
  code: '603986', name: '兆易创新', held: true, posPct: 0.022,
  accounting: [],
  reviewTriggers: ['多项技术复核', '相对强弱转弱', '放量下跌'],
  valuationGateUsable: true,
  node: {
    node: '存储', levelShare: 1, delta4Q: 8.4,
    medianNpYoy: 0.8, npAbsDeltaSum: 2e8,
  },
  company: { shareWithinNode: 1, npAbsDelta: 5e7, netProfitYoy: 0.26 },
}

const zhongwei: JudgeInput = {
  code: '688012', name: '中微公司', held: true, posPct: 0.044,
  accounting: [],
  reviewTriggers: [],
  valuationGateUsable: true,
  node: {
    node: '刻蚀/MOCVD', levelShare: 0.22, delta4Q: 4.1,
    medianNpYoy: 0.6, npAbsDeltaSum: 3e8,
  },
  company: { shareWithinNode: 0.7, npAbsDelta: 2e8, netProfitYoy: 0.4 },
}

const tianfu: JudgeInput = {
  code: '300394', name: '天孚通信', held: false, posPct: null,
  accounting: [],
  reviewTriggers: [],
  valuationGateUsable: false,
  node: {
    node: '光器件/光引擎', levelShare: 0.08, delta4Q: 2.2,
    medianNpYoy: 0.3, npAbsDeltaSum: 8e7,
  },
  company: { shareWithinNode: 0.5, npAbsDelta: 3e7, netProfitYoy: 0.3 },
}

const techOnly: JudgeInput = {
  code: '300308', name: '中际旭创', held: true, posPct: 0.105,
  accounting: [],
  reviewTriggers: ['跌破 MA20', 'RSI 超买', '10日涨幅 40%'],
  valuationGateUsable: true,
  node: {
    node: '光模块', levelShare: 0.67, delta4Q: -0.4,
    medianNpYoy: 0.5, npAbsDeltaSum: 5e8,
  },
  company: { shareWithinNode: 0.67, npAbsDelta: 4e8, netProfitYoy: 0.8 },
}

// ══════════════════════════════════════════════════════════════
// 一、海光：值得拥有，减的是组合
// ══════════════════════════════════════════════════════════════
{
  const j = judgeOne(haiguang)
  ok('海光战略仍成立（节点份额下降 ≠ 战略证伪）', j.strategic === 'HOLDS', j.strategic)
  ok('海光仍值得拥有', j.worthOwning === 'YES')
  ok('海光生命线仍是核心持有（R1 不降级）', j.lifecycle === 'P3', j.lifecycle)
  ok('海光战术阶段是核心持有，不是减仓', j.tactical === 'CORE', j.tactical)
  ok('海光风险只有 R1', j.risks.length === 1 && j.risks[0] === 'R1_PORTFOLIO', j.risks.join(','))
  ok('海光卖出资格只有组合减仓',
    j.acts.sellKinds.length === 1 && j.acts.sellKinds[0] === 'PORTFOLIO_REDUCE')
  ok('海光出口是组合强制调整', j.exit === 'PORTFOLIO_FORCE', j.exit)
  ok('海光说明写明「不是公司价值恶化」', j.whyAct.includes('不是公司价值恶化'))
  ok('海光仍拥有的理由提到战略允许与盈利',
    j.whyStillOwn.includes('战略层允许') && j.whyStillOwn.includes('盈利'))
  ok('海光不因技术复核增加卖出种类',
    !j.acts.sellKinds.includes('TACTICAL_REDUCE')
    && !j.acts.sellKinds.includes('VALUE_EXIT'))
  ok('海光 Ownership 是战略核心', j.ownership === 'STRATEGIC_CORE')
  ok('海光生命线仍是核心持有（猎人段）', j.hunter === 'CORE', j.hunter)
  ok('海光资本动作是减少暴露', j.capitalAction === 'REDUCE_EXPOSURE')
  ok('海光唯一理由写明组合超限不是公司恶化',
    j.oneReason.includes('组合超限') && j.oneReason.includes('不是公司价值恶化'))
}

// ══════════════════════════════════════════════════════════════
// 二、兆易：产业漂亮，战略禁止，不因技术卖
// ══════════════════════════════════════════════════════════════
{
  const j = judgeOne(zhaoyi)
  ok('兆易战略证伪（C级清退）', j.strategic === 'FALSIFIED', j.strategic)
  ok('兆易不值得拥有（产业好 ≠ 可以买/必须持有）', j.worthOwning === 'NO')
  ok('兆易战略层不允许', j.strategyAllows === false)
  ok('兆易生命线是退出评估', j.lifecycle === 'X', j.lifecycle)
  ok('兆易技术复核再多也不产生卖出资格', j.acts.sellKinds.length === 0, j.acts.sellKinds.join(','))
  ok('兆易说明点明冠军替换、不因技术卖',
    j.whyAct.includes('冠军替换') && j.whyNotSell.includes('不因技术指标减仓'))
  ok('兆易资本流向是禁止', j.lane === 'FORBID')
  ok('兆易节点份额上升不能推翻清退',
    j.strategicWhy.some(x => x.includes('C级清退')))
  ok('兆易 Ownership 是清退', j.ownership === 'RETIRED')
  ok('兆易猎人段是价值退出', j.hunter === 'VALUE_EXIT')
  ok('兆易资本动作是退出', j.capitalAction === 'EXIT')
}

// ══════════════════════════════════════════════════════════════
// 三、中微：事实强化 → 加仓资格，不是「涨了所以买」
// ══════════════════════════════════════════════════════════════
{
  const j = judgeOne(zhongwei)
  ok('中微战略增强或成立', j.strategic === 'STRENGTHENED' || j.strategic === 'HOLDS', j.strategic)
  ok('中微被事实强化', j.factsStrengthening === true)
  ok('中微出口是增加资本或维持（无 R1/R2）',
    j.exit === 'ADD_CAPITAL' || j.exit === 'HOLD', j.exit)
  ok('中微加仓理由写明来自事实强化、不是价格本身',
    j.whyAct.includes('事实强化') && j.whyAct.includes('不是价格本身'))
  ok('中微资本流向是增强', j.lane === 'ENHANCE')
}

// ══════════════════════════════════════════════════════════════
// 四、天孚：战略允许但盈利未核 → 观察，不是候选买入
// ══════════════════════════════════════════════════════════════
{
  const j = judgeOne(tianfu)
  ok('天孚战略观察（盈利验证未完成）', j.strategic === 'WATCH', j.strategic)
  ok('天孚资本流向是观察', j.lane === 'OBSERVE', j.lane)
  ok('天孚未持仓且证据不齐 → 不在建仓窗口', j.tactical !== 'ENTRY', j.tactical)
  ok('天孚不允许建仓动作（未到 O1）', !j.acts.allowed.includes('OPEN'))
}

// ══════════════════════════════════════════════════════════════
// 五、技术数据不能创造投资逻辑
// ══════════════════════════════════════════════════════════════
{
  const j = judgeOne(techOnly)
  ok('只有技术复核时卖出资格为空', j.acts.sellKinds.length === 0)
  ok('技术角色是复核，不是减仓理由', j.technicalRole === 'REVIEW')
  ok('R4 仍是尚未可测（PE 90% 不能填 R4）', j.r4 === 'NOT_YET_MEASURABLE')
  ok('风险轴不含 R4', !j.risks.includes('R4_EXPECTATION'))
  ok('出口是维持', j.exit === 'HOLD', j.exit)
  ok('不卖的理由点明回测证伪', j.whyNotSell.includes('回测'))
}

// ══════════════════════════════════════════════════════════════
// 六、R4 表仍为空；五个出口互不相同
// ══════════════════════════════════════════════════════════════
ok('R4 可产生卖出集仍为空', RISK_CAN_PRODUCE.R4_EXPECTATION.length === 0)
ok('R4 文案拒绝用 PE 或均线代替',
  R4_STATUS_TEXT.NOT_YET_MEASURABLE.includes('不得用 PE')
  && R4_STATUS_TEXT.NOT_YET_MEASURABLE.includes('均线'))

{
  const exits = [
    judgeOne(haiguang).exit,
    judgeOne(zhaoyi).exit,
    judgeOne(zhongwei).exit,
    judgeOne(techOnly).exit,
  ]
  ok('海光/兆易/中微/中际走出了不同出口（四种处境不得压成一个卖出）',
    new Set(exits).size >= 3, exits.join(','))
}

// ══════════════════════════════════════════════════════════════
// 七、三条判断拆开
// ══════════════════════════════════════════════════════════════
{
  const j = judgeOne(haiguang)
  ok('海光：价值=值得拥有，预算=超限，出口=组合强制 —— 三轴同时成立且不互相改写',
    j.worthOwning === 'YES'
    && j.positionBudget === 'OVER'
    && j.exit === 'PORTFOLIO_FORCE'
    && j.lifecycle === 'P3')
}

// ══════════════════════════════════════════════════════════════
// 八、源码不引入新指标、不出现评分
// ══════════════════════════════════════════════════════════════
{
  const files = ['strategy.ts', 'judge.ts', 'cockpitV2.ts', 'hunter.ts', 'evidence.ts', 'triaxis.ts', 'migrate.ts']
  for (const f of files) {
    const src = readFileSync(new URL(`./${f}`, import.meta.url), 'utf-8')
    const code = src.split('\n').filter(l => {
      const t = l.trim()
      return !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*')
    }).join('\n')
    for (const banned of ['score', 'Score', 'rank', 'Rank', 'weight', 'Weight']) {
      ok(`${f} 不出现「${banned}」`, !new RegExp(`\\b${banned}\\b`).test(code))
    }
    const imports = src.split('\n').filter(l => l.trimStart().startsWith('import')).join('\n')
    ok(`${f} 不 import 均线/雷达/估值计算`,
      !/sma|evaluateMomentum|runMsr|pePercentile|valuationFetch/i.test(imports),
      imports)
    ok(`${f} 不 import makeAction（输出资格，不生产动作）`,
      !imports.includes('makeAction'))
  }
}

// ══════════════════════════════════════════════════════════════
// 九、装配层：六问 + 三块 + 海光/兆易对照
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

  const v2 = buildDecisionCockpit(dashLike)
  ok('产品名是鸿鹄理财', v2.productName === '鸿鹄理财')
  ok('产品模型是资本生命线', v2.productModel === '资本生命线')
  ok('版本是 V3', v2.version === 'V3')
  ok('六问正好 6 条且编号 1–6',
    v2.questions.length === 6 && v2.questions.every((q, i) => q.no === i + 1))
  ok('六句话覆盖委员会钉死的原话',
    v2.questions[0]!.question.includes('战略有没有变')
    && v2.questions[1]!.question.includes('仍然值得拥有')
    && v2.questions[2]!.question.includes('证据正在强化')
    && v2.questions[3]!.question.includes('风险正在增加')
    && v2.questions[4]!.question.includes('生命线哪一段')
    && v2.questions[5]!.question.includes('唯一合法理由'))

  const hg = v2.holdings.find(h => h.code === '688041')
  const zy = v2.holdings.find(h => h.code === '603986')
  ok('持仓块有海光', !!hg)
  ok('海光决策写明组合风险不是公司恶化',
    !!hg && hg.decision.includes('组合风险') && hg.decision.includes('不是公司价值恶化'))
  ok('兆易决策写明不因技术减仓',
    !!zy && zy.decision.includes('不因技术指标减仓'))
  ok('兆易在禁止栏', v2.capital.forbid.some(r => r.code === '603986'))
  ok('海光因组合强制调整不进增强栏', !v2.capital.enhance.some(r => r.code === '688041'))
  ok('电力主线数据不足仍输出观察，不编造成立',
    v2.strategy.find(s => s.mainlineId === 'power')?.strategic === 'WATCH')

  const txt = renderDecisionCockpit(v2)
  ok('渲染含五块首屏',
    txt.includes('【① 战略】')
    && txt.includes('【② 资本应该往哪里走】')
    && txt.includes('【③ 当前持仓生命线】')
    && txt.includes('【④ 风险】')
    && txt.includes('【⑤ 今天真正需要投资人做的事】'))
  ok('渲染声明第一层看决策', txt.includes('第一层看决策'))
  ok('渲染只在禁令里提到评分，不把它当成输出',
    txt.includes('不输出综合评分') && !/综合评分\s*\d|第\s*\d+\s*名/.test(txt))
  ok('渲染不含预测措辞', !/见顶|要跌|将涨|底部已现/.test(txt))
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
    walk(v2, 'v2')
    return keys.length === 0
  })())
}

// ══════════════════════════════════════════════════════════════
// 十、战术阶段文案不含「现在应该买」
// ══════════════════════════════════════════════════════════════
ok('ENTRY 叫建仓资格窗口，不叫买入', TACTICAL_TEXT.ENTRY.includes('资格'))
ok('战略五种状态文案互不相同', new Set(Object.values(STRATEGIC_TEXT)).size === 5)

console.log(`\n═══ 结果：${pass} 通过 / ${fail} 失败 ═══\n`)
if (fail > 0) process.exit(1)
