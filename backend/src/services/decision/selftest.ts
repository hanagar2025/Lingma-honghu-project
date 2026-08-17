/**
 * 决策语义层自检。
 *
 * 这一层是委员会 2026-08-17 裁定的核心，也是最容易被"顺手简化"掉的一层 ——
 * 因为它的约束都是**否定式**的（不能因技术信号减仓、状态变化不等于动作），
 * 而否定式约束在重构时不会报错，只会静默消失。
 */

import {
  STATES, specOf, allows, judgeActs, technicalCanReduce,
  RISK_CAN_PRODUCE, EVIDENCE_CAN_REDUCE, SELL_KIND_TEXT, RISK_TEXT, ACT_TEXT,
  renderAxes,
  type Axes, type LifecycleState, type RiskCategory, type SellKind, type Act,
} from './lifecycle'

let pass = 0
let fail = 0
const ok = (name: string, cond: boolean, extra = ''): void => {
  if (cond) { pass++; console.log(`  ✓ ${name}`) } else {
    fail++; console.log(`  ✗ ${name} ${extra}`)
  }
}

console.log('\n═══ 决策语义层自检 ═══\n')

// ══════════════════════════════════════════════════════════════
// 一、技术数据不能单独产生减仓
// ══════════════════════════════════════════════════════════════
//
// 系统自己的回测已证伪价格窗口：按 10 日涨幅分档后，
// "红灯"日的后续收益反而高于"绿灯"日（置信区间跨 0）。
// 若允许「跌破 MA60 → 减仓」重新进来，等于把被数据推翻的东西请回决策层。
ok('技术类证据不能构成减仓理由（恒为 false）', technicalCanReduce() === false)
ok('账务事实可以构成减仓理由', EVIDENCE_CAN_REDUCE.ACCOUNTING === true)
ok('基本面可以构成减仓理由', EVIDENCE_CAN_REDUCE.FUNDAMENTAL === true)

// R4 是技术/预期数据的天花板：它的可产生卖出集必须为空
ok('R4 预期/价格风险不产生任何卖出资格（这是整张表最重要的一格）',
  RISK_CAN_PRODUCE.R4_EXPECTATION.length === 0)
ok('R1 组合风险只产生组合减仓',
  RISK_CAN_PRODUCE.R1_PORTFOLIO.length === 1
  && RISK_CAN_PRODUCE.R1_PORTFOLIO[0] === 'PORTFOLIO_REDUCE')
ok('R2 公司风险可产生战术减仓与价值退出',
  RISK_CAN_PRODUCE.R2_COMPANY.includes('TACTICAL_REDUCE')
  && RISK_CAN_PRODUCE.R2_COMPANY.includes('VALUE_EXIT'))
ok('R3 主线风险可产生战术减仓与价值退出（公司是冠军也可能要减）',
  RISK_CAN_PRODUCE.R3_MAINLINE.includes('TACTICAL_REDUCE')
  && RISK_CAN_PRODUCE.R3_MAINLINE.includes('VALUE_EXIT'))
ok('没有任何风险类别能同时产生全部三种卖出（否则分类失去意义）',
  Object.values(RISK_CAN_PRODUCE).every((v: readonly SellKind[]) => v.length < 3))

// ══════════════════════════════════════════════════════════════
// 二、状态变化 ≠ 自动卖出
// ══════════════════════════════════════════════════════════════
//
// 状态只能把标的送进「评估」，真正的卖出仍须有法定理由。
// 故任何状态的 allows 里都不得出现 REDUCE / EXIT 这类终局动作 ——
// 只有 REDUCE_EVAL / EXIT_EVAL。
{
  const allActs = new Set<Act>(STATES.flatMap(s => [...s.allows]))
  ok('没有任何状态直接允许「减仓」或「退出」这类终局动作',
    !([...allActs] as string[]).some(a => a === 'REDUCE' || a === 'EXIT'),
    [...allActs].join(','))
  ok('风险状态只把标的送进评估',
    allows('RISK_R2', 'REDUCE_EVAL') && !allows('RISK_R2', 'ADD'))
  ok('评估动作的文案明说「评估 ≠ 减仓」',
    ACT_TEXT.REDUCE_EVAL.includes('评估 ≠ 减仓')
    && ACT_TEXT.EXIT_EVAL.includes('评估 ≠ 退出'))
}

// R4 状态只能停止追加
ok('R4 状态允许「持有不追加」', allows('RISK_R4', 'STOP_ADDING'))
ok('R4 状态不允许任何评估性减仓',
  !allows('RISK_R4', 'REDUCE_EVAL') && !allows('RISK_R4', 'EXIT_EVAL'))
ok('R4 状态不允许追加（这是它存在的目的）', !allows('RISK_R4', 'TOP_UP'))
ok('R4 状态说明点明"允许它减仓等于把被证伪的技术卖出规则放回来"',
  specOf('RISK_R4').note.includes('被回测证伪'))

// ══════════════════════════════════════════════════════════════
// 三、三种卖出严格区分
// ══════════════════════════════════════════════════════════════
ok('三种卖出的文案各不相同（否则投资人看到"减仓"不知道为什么）',
  new Set(Object.values(SELL_KIND_TEXT)).size === 3)
ok('价值退出文案说明"公司已不值得继续拥有"',
  SELL_KIND_TEXT.VALUE_EXIT.includes('不值得继续拥有'))
ok('组合减仓文案说明"公司本身没问题"',
  SELL_KIND_TEXT.PORTFOLIO_REDUCE.includes('公司本身没问题'))
ok('战术减仓文案说明"仍值得拥有但风险收益结构变了"',
  SELL_KIND_TEXT.TACTICAL_REDUCE.includes('仍值得拥有')
  && SELL_KIND_TEXT.TACTICAL_REDUCE.includes('风险收益结构'))
ok('四类风险文案各不相同（不能统统叫"风险"）',
  new Set(Object.values(RISK_TEXT)).size === 4)

// ══════════════════════════════════════════════════════════════
// 四、战略否决优先于一切证据
// ══════════════════════════════════════════════════════════════
{
  const base: Axes = {
    code: 'X', name: '测试标的', qualification: 'S3',
    lifecycle: 'P2', risks: [], strategyAllows: true,
  }
  ok('战略允许时 P2 可加仓', judgeActs(base).allowed.includes('ADD'))

  const vetoed = judgeActs({ ...base, strategyAllows: false })
  ok('战略否决时 P2 不可加仓（资格进度 S3 也不放行）',
    !vetoed.allowed.includes('ADD'))
  ok('并给出理由：研究证据链 ≠ 投资资格链',
    vetoed.blocked.some(b => b.why.includes('研究证据链 ≠ 投资资格链')))

  // 即便资格全过、生命线到 P4、无任何风险，战略否决仍不放行
  const allGreenButVetoed = judgeActs({
    ...base, qualification: 'CANDIDATE', lifecycle: 'P4',
    risks: [], strategyAllows: false,
  })
  ok('资格 CANDIDATE + P4 + 无风险，战略否决仍不允许追加',
    !allGreenButVetoed.allowed.includes('TOP_UP'))
  ok('但仍允许持有（否决建仓不等于强制清仓）',
    allGreenButVetoed.allowed.includes('HOLD'))
}

// ══════════════════════════════════════════════════════════════
// 五、R4 单独成立时不得出现卖出资格（运行时也要拦）
// ══════════════════════════════════════════════════════════════
{
  const r4only = judgeActs({
    code: 'X', name: 'T', qualification: 'S3',
    lifecycle: 'RISK_R4', risks: ['R4_EXPECTATION'], strategyAllows: true,
  })
  ok('R4 单独成立 → 卖出资格为空', r4only.sellKinds.length === 0)
  ok('说明里点明「R4 单独成立 → 唯一动作是停止追加，不减仓」',
    r4only.reasoning.includes('唯一动作是停止追加'))

  // R4 与 R1 同时成立时，卖出资格只能来自 R1
  const both = judgeActs({
    code: 'X', name: 'T', qualification: 'S3',
    lifecycle: 'RISK_R4', risks: ['R4_EXPECTATION', 'R1_PORTFOLIO'], strategyAllows: true,
  })
  ok('R4 与 R1 并存时，卖出资格只有组合减仓（不因 R4 而增加）',
    both.sellKinds.length === 1 && both.sellKinds[0] === 'PORTFOLIO_REDUCE')
}

// ══════════════════════════════════════════════════════════════
// 六、三条轴不能混
// ══════════════════════════════════════════════════════════════
//
// 混在一起的后果是：一只 S3 全过的标的会被读成"应该重仓"，
// 而资格只说明它可以进入候选，与该持多少无关。
{
  const src = await import('node:fs').then(fs => fs.readFileSync(
    new URL('./lifecycle.ts', import.meta.url), 'utf-8'
  ))
  ok('Axes 同时保留三个独立字段（资格 / 生命线 / 风险）',
    /qualification[:?]/.test(src) && /lifecycle[:?]/.test(src) && /risks[:?]/.test(src))

  // 资格进度不得出现在生命线状态枚举里
  const lifecycleStates: LifecycleState[] = STATES.map(s => s.state)
  ok('生命线状态里不含 S0/S1/S2/S3（两条轴不共用取值）',
    !lifecycleStates.some(s => /^S[0-3]$/.test(s)), lifecycleStates.join(','))

  // 高资格不自动等于高仓位状态
  const s3o0 = judgeActs({
    code: 'X', name: 'T', qualification: 'S3',
    lifecycle: 'O0', risks: [], strategyAllows: true,
  })
  ok('资格 S3 但生命线仍在 O0 时，只允许研究，不允许建仓',
    !s3o0.allowed.includes('OPEN') && s3o0.allowed.includes('RESEARCH'))
}

// ══════════════════════════════════════════════════════════════
// 七、状态是状态，不是评分
// ══════════════════════════════════════════════════════════════
{
  const src = await import('node:fs').then(fs => fs.readFileSync(
    new URL('./lifecycle.ts', import.meta.url), 'utf-8'
  ))
  const code = src.split('\n')
    .filter(l => {
      const t = l.trim()
      return !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*')
    })
    .join('\n')
  for (const banned of ['score', 'Score', 'rank', 'Rank', 'weight', 'Weight']) {
    ok(`代码中不出现「${banned}」（状态不可比较、不可排序、不可加权）`,
      !new RegExp(`\\b${banned}\\b`).test(code))
  }
  // 每个状态都必须写明"进入条件"与"说明"，否则状态会退化成标签
  ok('每个状态都有进入条件与说明',
    STATES.every(s => s.entry.length > 8 && s.note.length > 8))
  ok('状态定义里包含委员会的四条再定义（观察/建仓/加仓/追加各自不是什么）',
    STATES.find(s => s.state === 'O0')!.note.includes('证据正在形成')
    && STATES.find(s => s.state === 'P1')!.note.includes('第一笔风险')
    && STATES.find(s => s.state === 'P2')!.note.includes('新增证据')
    && STATES.find(s => s.state === 'P4')!.note.includes('错误概率'))
}

// ══════════════════════════════════════════════════════════════
// 八、不新增指标
// ══════════════════════════════════════════════════════════════
//
// 委员会明确：「先停掉加指标。缺的不是第 37 个指标，而是决策语义层。」
{
  const src = await import('node:fs').then(fs => fs.readFileSync(
    new URL('./lifecycle.ts', import.meta.url), 'utf-8'
  ))
  const imports = src.split('\n').filter(l => l.trimStart().startsWith('import')).join('\n')
  ok('本模块不 import 任何数据源（只消费已有证据的翻译结果）',
    !/marketData|profitRadar|valuation|fetch/i.test(imports), imports.trim() || '（无 import）')
  ok('本模块不 import makeAction（它输出资格，不输出动作）',
    !imports.includes('makeAction'))
}

// ══════════════════════════════════════════════════════════════
// 九、渲染层
// ══════════════════════════════════════════════════════════════
{
  const txt = renderAxes([{
    code: '688041', name: '海光信息', qualification: 'S3',
    lifecycle: 'P3', risks: ['R1_PORTFOLIO'], strategyAllows: true,
  }])
  ok('渲染层声明「允许 ≠ 应该」', txt.includes('允许 ≠ 应该'))
  ok('渲染层把三条轴分开列出',
    txt.includes('资格进度') && txt.includes('风险') && txt.includes('允许动作'))
  ok('渲染层写出卖出资格的具体种类（不是笼统的"减仓"）',
    txt.includes('组合减仓 —— 公司本身没问题'))
  ok('渲染层不出现"评分""排名"', !/评分|排名|总分/.test(txt))
}

// 全部风险类别都必须在 RISK_CAN_PRODUCE 里有条目 —— 漏一个等于该风险无声失效
{
  const cats: RiskCategory[] =
    ['R1_PORTFOLIO', 'R2_COMPANY', 'R3_MAINLINE', 'R4_EXPECTATION']
  ok('四类风险都在可产生卖出表中登记（漏登记等于该风险无声失效）',
    cats.every(c => c in RISK_CAN_PRODUCE))
  ok('四类风险都有文案', cats.every(c => typeof RISK_TEXT[c] === 'string'))
}

console.log(`\n═══ 结果：${pass} 通过 / ${fail} 失败 ═══\n`)
if (fail > 0) process.exit(1)
