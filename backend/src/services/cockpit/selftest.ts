import { readFileSync } from 'node:fs'
// 驾驶舱自检 —— 核心是三条不变量，全部围绕同一件事：
//   **未经检验的指标不可能产生动作。**
//
// 前十次教训里最贵的一条是"看见了却没有执行"。但紧随其后的一条是
// "用一个没被验证过的信号执行了" —— 后者在回测里已经被证明会花钱（择时贡献 -14.5pct）。
// 所以这里的测试不测"模型准不准"，只测"没被验证的东西有没有权限动手"。
//
// 运行：npx tsx backend/src/services/cockpit/selftest.ts

import type { DailyBar, Position, AccountSnapshot } from '../tios/types'
import { runCockpit } from './index'
import { evaluateSafety, findLimitBreaches, worstLight } from './safety'
import { evaluateMomentum } from './momentum'
import { evaluateNodes, findUnclaimedMembers, NODE_TAXONOMY } from './nodes'
import {
  makeAction, IllegalActionError, FORBIDDEN_REASON_PHRASES, LEGAL_REASON_TEXT,
  type Action, type LegalReason,
} from './types'
import { MAINLINES } from '../msr/universe'

let failed = 0
let passed = 0

function ok(name: string, cond: boolean, extra = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.error(`  ✗ ${name} ${extra}`) }
}

function throws(name: string, fn: () => unknown) {
  try { fn(); failed++; console.error(`  ✗ ${name}（本应抛错但没有）`) }
  catch (e) {
    if (e instanceof IllegalActionError) { passed++; console.log(`  ✓ ${name}`) }
    else { failed++; console.error(`  ✗ ${name} 抛出了非预期错误：${String(e)}`) }
  }
}

function nonEmpty<T>(name: string, arr: T[]): T[] {
  ok(`${name} 非空`, arr.length > 0, `实际长度 ${arr.length}`)
  return arr
}

/** 生成严格递增的日期，避免重复日期导致聚合结果错乱（第9次教训的测试版） */
function seqDate(i: number): string {
  const base = Date.UTC(2025, 0, 6)
  const d = new Date(base + i * 86400000)
  return d.toISOString().slice(0, 10)
}

function bars(n: number, from: number, dailyDrift: number, vol = 1_000_000): DailyBar[] {
  const out: DailyBar[] = []
  let px = from
  for (let i = 0; i < n; i++) {
    const prev = px
    px = px * (1 + dailyDrift)
    out.push({
      date: seqDate(i), open: prev, high: Math.max(prev, px) * 1.01,
      low: Math.min(prev, px) * 0.99, close: px, volume: vol,
    })
  }
  return out
}

const baseAction: Action = {
  code: '300308', name: '中际旭创', kind: 'REDUCE', reason: 'POSITION_LIMIT',
  reasonDetail: '仓位16.2% > 上限12.0%，超出4.2pct',
  notReason: ['不是因为对该标的的股价判断'],
  reviewTriggers: ['收于MA20下方'],
  size: { display: '约200股', value: 200, note: '超出市值 ÷ 现价' },
  metrics: [],
}

console.log('\n═══ 驾驶舱自检 ═══\n')

// ───────────────────────────────────────────────────────────────
console.log('【不变量一】预测性理由不可能产生动作')
// ───────────────────────────────────────────────────────────────

throws('减仓动作不接受"技术结构恶化"作为理由细节', () =>
  makeAction({ ...baseAction, reasonDetail: '技术结构恶化，20日跑输行业8%' }))

throws('减仓动作不接受"要跌"这类预测措辞', () =>
  makeAction({ ...baseAction, reasonDetail: '仓位超限，且判断后续要跌' }))

throws('非理由栏也不许夹带预测措辞', () =>
  makeAction({ ...baseAction, notReason: ['不是因为看空', '主要还是因为会跌'] }))

throws('执行量备注里同样不许夹带预测', () =>
  makeAction({ ...baseAction, size: { display: '约200股', value: 200, note: '趁见顶前卖出' } }))

throws('减仓动作不接受买入侧理由', () =>
  makeAction({ ...baseAction, reason: 'S3_PASSED_ALL_GATES' }))

throws('减仓动作不接受 NO_LEGAL_TRIGGER', () =>
  makeAction({ ...baseAction, reason: 'NO_LEGAL_TRIGGER' }))

throws('买入动作只能用 S3_PASSED_ALL_GATES', () =>
  makeAction({ ...baseAction, kind: 'BUY', reason: 'POSITION_LIMIT' }))

ok('合法减仓动作可以构造', (() => {
  try { makeAction(baseAction); return true } catch { return false }
})())

ok('技术观察项进 reviewTriggers 是允许的（不是理由，只是提示）',
  makeAction({ ...baseAction, reviewTriggers: ['技术结构恶化', '创60日新低'] }).reviewTriggers.length === 2)

// 法定理由枚举里不得出现预测性成员 —— 防止有人"顺手"加一条
const reasonKeys = Object.keys(LEGAL_REASON_TEXT) as LegalReason[]
ok('法定理由枚举不含任何预测性成员',
  reasonKeys.every(k => !FORBIDDEN_REASON_PHRASES.some(p => LEGAL_REASON_TEXT[k].includes(p))),
  reasonKeys.filter(k => FORBIDDEN_REASON_PHRASES.some(p => LEGAL_REASON_TEXT[k].includes(p))).join(','))

ok('法定理由枚举不含"技术"字样',
  reasonKeys.every(k => !LEGAL_REASON_TEXT[k].includes('技术')))

// ───────────────────────────────────────────────────────────────
console.log('\n【不变量二】第①问只用账务事实，且缺数据不糊默认值')
// ───────────────────────────────────────────────────────────────

const snapshot: AccountSnapshot = {
  date: '2026-08-13', totalAssets: 3_500_000, cash: 400_000,
  externalCash: 0, portfolioTotal: 3_500_000, peakBasis: 'PORTFOLIO' as const,
  positionsValue: 3_100_000, peakAssets: 4_300_000,
}
const positions: Position[] = [
  { code: '300308', name: '中际旭创', sector: '通信设备', theme: 'AI', cost: 400_000, marketValue: 567_000 },
  { code: '300502', name: '新易盛', sector: '通信设备', theme: 'AI', cost: 400_000, marketValue: 560_000 },
  { code: '002371', name: '北方华创', sector: '半导体', theme: 'AI', cost: 300_000, marketValue: 300_000 },
]

const safety = evaluateSafety({ snapshot, positions, asOf: '2026-08-13' })
ok('第①问全部指标均为 ACCOUNTING 等级',
  safety.metrics.every(m => m.tier === 'ACCOUNTING'),
  safety.metrics.filter(m => m.tier !== 'ACCOUNTING').map(m => m.label).join(','))

ok('每个指标都带来源与计算过程',
  safety.metrics.every(m => m.source.length > 0 && m.formula.length > 0))

ok('未提供家庭年支出时安全垫判为数据缺失而非0',
  safety.rows.find(r => r.label === '家庭安全垫')?.light === 'UNKNOWN')

ok('安全垫缺失时必须写明缺失原因',
  !!safety.metrics.find(m => m.label === '安全垫年数')?.missingReason)

const breaches = findLimitBreaches({ snapshot, positions, asOf: '2026-08-13' })
ok('两只超12%被识别为法定超限', breaches.length === 2, `实际 ${breaches.length}`)
ok('超限按仓位降序', breaches[0].currentPct >= breaches[1].currentPct)
ok('超限给出应减市值', breaches.every(b => b.excessValue > 0))

// 回撤 1 - 350/430 = 18.6% → 触发一级熔断，仓位上限50%，当前88.6% → RED
ok('18.6%回撤触发一级熔断且识别出仓位超上限',
  safety.rows.find(r => r.label === '仓位是否超熔断上限')?.light === 'RED')

ok('第①问整体为 RED', safety.light === 'RED', safety.light)

ok('灯色取最严', worstLight(['GREEN', 'YELLOW', 'RED']) === 'RED' &&
  worstLight(['GREEN', 'UNKNOWN']) === 'UNKNOWN' && worstLight(['GREEN', 'GREEN']) === 'GREEN')

// 缺失峰值时不得静默按0回撤处理
const noPeak = evaluateSafety({
  snapshot: { ...snapshot, peakAssets: 0 }, positions, asOf: '2026-08-13',
})
ok('峰值缺失时回撤判为 UNKNOWN 而非 0%',
  noPeak.rows.find(r => r.label === '组合回撤/熔断')?.light === 'UNKNOWN')

// ───────────────────────────────────────────────────────────────
console.log('\n【不变量三】第②问全部是观察项，且不产生动作')
// ───────────────────────────────────────────────────────────────

const barsByCode: Record<string, DailyBar[]> = {
  '300308': bars(140, 100, -0.002),  // 走弱
  '300502': bars(140, 100, -0.001),
  '002371': bars(140, 100, 0.004),   // 走强
}
for (const ml of MAINLINES) for (const m of ml.members) {
  if (!barsByCode[m.code]) barsByCode[m.code] = bars(140, 50, 0.001)
}
const indexBarsByCode: Record<string, DailyBar[]> = {
  sz399006: bars(140, 2000, 0.001),
  sh000688: bars(140, 1000, 0.001),
  sh000001: bars(140, 3000, 0.0005),
}

const mom = evaluateMomentum({
  positions, barsByCode, indexBarsByCode, marketBars: indexBarsByCode.sz399006,
  breaches, asOf: '2026-08-13',
})

const techMetrics = mom.rows.flatMap(r => r.metrics)
  .filter(m => !['PE历史分位'].includes(m.label))
ok('第②问技术类指标全部为 OBSERVATION 等级',
  techMetrics.every(m => m.tier === 'OBSERVATION'),
  techMetrics.filter(m => m.tier !== 'OBSERVATION').map(m => m.label).join(','))

const weak = nonEmpty('走弱标的', mom.rows.filter(r => r.triggerCount > 0))
ok('走弱标的确实产生了复核触发项', weak.length >= 1)

const zj = mom.rows.find(r => r.code === '300308')!
ok('超限标的的减仓理由写的是仓位超限，不是技术结构',
  !!zj.legalReason && zj.legalReason.includes('仓位') && !zj.legalReason.includes('技术'),
  String(zj.legalReason))

const zjRow = mom.answer.rows.find(r => r.label === '中际旭创')!
ok('第②问对超限标的的表述为"当前减仓理由仍然是：仓位…"',
  zjRow.decision.includes('当前减仓理由仍然是') && zjRow.decision.includes('仓位'),
  zjRow.decision)

const bfhc = mom.rows.find(r => r.code === '002371')!
ok('走强且未超限的标的无法定减仓理由', bfhc.legalReason === null)

// ───────────────────────────────────────────────────────────────
console.log('\n【第③问】节点聚合与研究缺口')
// ───────────────────────────────────────────────────────────────

const nodes = evaluateNodes({ barsByCode, indexBarsByCode, asOf: '2026-08-13' })
ok('节点分类表覆盖委员会列出的全部节点', NODE_TAXONOMY.length >= 28, String(NODE_TAXONOMY.length))

// 关键不变量：节点清单与扫描域是两份独立配置，对不上会让标的静默消失
const unclaimed = findUnclaimedMembers()
ok('扫描域内每个标的都被某个节点认领（无静默丢失）',
  unclaimed.length === 0,
  unclaimed.map(u => `${u.name}@${u.mainline}/${u.node}`).join('、'))

ok('液冷节点归属 AI电力，且英维克被它认领',
  nodes.nodes.some(n => n.node === '液冷' && n.mainlineId === 'power' &&
    n.members.some(m => m.name === '英维克')))

const covered = nonEmpty('有覆盖的节点', nodes.nodes.filter(n => n.coverage === 'COVERED'))
ok('节点势能分数在 0–10 之间', covered.every(n => n.score !== null && n.score >= 0 && n.score <= 10))
ok('节点分数全部可拆解追溯', covered.every(n => n.breakdown.length === 5))
ok('节点指标全部为 OBSERVATION 等级',
  covered.flatMap(n => n.metrics).every(m => m.tier === 'OBSERVATION'))

const gaps = nonEmpty('无覆盖节点', nodes.nodes.filter(n => n.coverage === 'NO_MEMBER'))
ok('无覆盖节点被显式保留为研究缺口，而不是被隐去',
  gaps.every(n => n.note.includes('研究缺口')))
ok('EML/硅光/CPO 等未覆盖节点确实出现在输出里',
  ['EML', '硅光', '光纤'].every(name => nodes.nodes.some(n => n.node === name)))

const retired = nodes.nodes.filter(n => n.coverage === 'RETIRED')
ok('C级清退节点不参与势能评分', retired.every(n => n.score === null))

const highScore = covered.filter(n => (n.score ?? 0) >= 7)
ok('高分节点的决策措辞是"进入研究序列"而非"买入"',
  nodes.answer.rows.filter(r => r.status.includes('势能')).every(r => !r.decision.includes('买入')),
  nodes.answer.rows.filter(r => r.decision.includes('买入')).map(r => r.label).join(','))
ok('第③问结论明写"分数不构成买入依据"',
  nodes.answer.headline.includes('不构成买入依据') || highScore.length === 0,
  nodes.answer.headline)

// ───────────────────────────────────────────────────────────────
console.log('\n【全链路】六问编排与动作合法性')
// ───────────────────────────────────────────────────────────────

const report = runCockpit({
  date: '2026-08-13', snapshot, positions, barsByCode, indexBarsByCode,
  pendingSellCount: 3, marketAllows: true,
})

ok('输出恰好六问', report.answers.length === 6)
ok('六问编号为 1..6', report.answers.map(a => a.no).join(',') === '1,2,3,4,5,6')

// 最关键的一条：遍历全部动作，重跑构造校验
let allLegal = true
let illegalDetail = ''
for (const a of report.actions) {
  try { makeAction(a) } catch (e) { allLegal = false; illegalDetail = String(e); break }
}
ok('报告中每一个动作都能通过法定理由校验', allLegal, illegalDetail)

ok('动作种类只有 买入/持有/减仓/不动作 四种',
  report.actions.every(a => ['BUY', 'HOLD', 'REDUCE', 'NONE'].includes(a.kind)))

const reduces = nonEmpty('减仓动作', report.actions.filter(a => a.kind === 'REDUCE'))
ok('全部减仓动作的理由都是风险预算类',
  reduces.every(a => ['POSITION_LIMIT', 'SECTOR_LIMIT', 'THEME_LIMIT', 'CIRCUIT_BREAKER',
    'FAMILY_SAFETY_NET', 'HARD_STOP', 'STRATEGY_FALSIFIED'].includes(a.reason)))
ok('减仓动作都写明了"非理由"', reduces.every(a => a.notReason.length > 0))
ok('减仓动作给出可执行的股数或金额', reduces.every(a => a.size.display !== '—'))

ok('执行债务>0 时不产生任何买入动作',
  report.actions.filter(a => a.kind === 'BUY').length === 0)
ok('执行债务>0 时第⑥问判定为今日无新增建仓', report.noNewEntry.verdict === true)
ok('第⑥问逐条列出禁止建仓原因', report.noNewEntry.reasons.length > 0)
ok('禁止建仓原因里包含执行债务',
  report.noNewEntry.reasons.some(r => r.includes('执行债务')))

ok('今日核心决策优先指向清偿执行债务',
  report.coreDecision.includes('执行债务'), report.coreDecision)

// 首页单表
ok('首页单表包含总组合风险/现金/执行债务三行',
  ['总组合风险', '现金', '执行债务'].every(k => report.table.some(r => r.item === k)))
ok('首页单表包含全部四条主线',
  MAINLINES.every(ml => report.table.some(r => r.item === ml.name)))
ok('首页每行都有状态与决策', report.table.every(r => r.todayStatus.length > 0 && r.decision.length > 0))

// 能力披露
ok('报告强制附带模型能力披露', report.disclosure.items.length >= 5)
ok('MSR 被标注为观察指标',
  report.disclosure.items.find(i => i.model.includes('MSR'))?.tier === 'OBSERVATION')
ok('TPO 被标注为观察指标',
  report.disclosure.items.find(i => i.model.includes('TPO'))?.tier === 'OBSERVATION')
ok('10日涨幅>50% 是唯一被标注 VALIDATED 的价格判据',
  report.disclosure.items.filter(i => i.tier === 'VALIDATED').length === 1)
ok('仓位上限类被标注 ACCOUNTING',
  report.disclosure.items.find(i => i.model.includes('仓位上限'))?.tier === 'ACCOUNTING')
ok('披露语明写不预测涨跌', report.disclosure.headline.includes('不预测'))

// 数据缺口
ok('数据缺口被显式列出', report.dataGaps.length > 0)
ok('资金结构缺失被列为缺口',
  report.dataGaps.some(g => g.includes('资金结构')))
ok('家庭年支出缺失被列为缺口',
  report.dataGaps.some(g => g.includes('家庭年度刚性支出')))

// ── 执行债务清零后的对照：仍不得因为"分数高"而买 ──
const cleared = runCockpit({
  date: '2026-08-13', snapshot, positions, barsByCode, indexBarsByCode,
  pendingSellCount: 0, marketAllows: true,
})
let clearedLegal = true
for (const a of cleared.actions) { try { makeAction(a) } catch { clearedLegal = false } }
ok('债务清零后全部动作仍合法', clearedLegal)
ok('债务清零后买入仍须过S3（PE分位缺失 → 依然为0买入）',
  cleared.actions.filter(a => a.kind === 'BUY').length === 0,
  `实际买入 ${cleared.actions.filter(a => a.kind === 'BUY').length} 项`)
ok('债务清零但无S3通过时，核心决策为什么都不要做或仅减仓',
  cleared.coreDecision.includes('什么都不要做') || cleared.coreDecision.includes('减仓'),
  cleared.coreDecision)

// ── 回归：确保没人偷偷把技术判据接进减仓理由 ──
console.log('\n【回归】已删除的规则不得复活')
const allReasonTexts = report.actions.map(a => a.reasonDetail).join('|')
ok('没有任何动作理由包含"技术结构"',
  !allReasonTexts.includes('技术结构'), allReasonTexts.slice(0, 200))
ok('没有任何动作理由包含"跑输"（跑输只能是观察项）',
  !allReasonTexts.includes('跑输'))
ok('观察项里确实保留了跑输/均线等诊断信息',
  report.actions.some(a => a.reviewTriggers.some(t => t.includes('跑输') || t.includes('MA'))))

// ── 仓位口径（委员会 2026-08-15 裁定）──
//
// 这一组是整套风控里最容易被悄悄改错的地方：只要有人把某处分母换回账户口径，
// 页面上的百分比看着都正常，只是超限结论变了。故逐条钉住。
console.log('\n【仓位口径】上限一律用组合口径')

const basePos: Position[] = [
  { code: '688041', name: '海光信息', sector: '电子', theme: 'AI', cost: 700_000, marketValue: 700_000 },
  { code: '300308', name: '中际旭创', sector: '通信', theme: 'AI', cost: 560_000, marketValue: 560_000 },
]
const mkSnap = (cash: number, ext: number, peakBasis: 'BROKER' | 'PORTFOLIO' = 'PORTFOLIO'): AccountSnapshot => {
  const pv = basePos.reduce((s, p) => s + p.marketValue, 0)
  return {
    date: '2026-08-15', totalAssets: cash + pv, cash, positionsValue: pv,
    externalCash: ext, portfolioTotal: cash + pv + ext,
    peakAssets: 6_000_000, peakBasis,
  }
}

// 核心不变量：**同一笔钱放在账户内还是账户外，不得改变任何单票权重。**
// 这正是委员会的论证 —— 用账户口径做分母，等于"把钱转进账户就认为风险变小"。
const outside = mkSnap(583_000, 2_000_000)
const inside = mkSnap(583_000 + 2_000_000, 0)
const wOut = findLimitBreaches({ snapshot: outside, positions: basePos, asOf: '2026-08-15' })
const wIn = findLimitBreaches({ snapshot: inside, positions: basePos, asOf: '2026-08-15' })
ok('把账户外现金转进账户，组合总资产不变',
  outside.portfolioTotal === inside.portfolioTotal)
ok('把账户外现金转进账户，超限清单完全相同（钱的位置不改变股票风险）',
  JSON.stringify(wOut) === JSON.stringify(wIn),
  `外置 ${wOut.length} 条 / 内置 ${wIn.length} 条`)
ok('券商账户口径与组合口径确实不同（否则这组测试是空的）',
  outside.totalAssets !== outside.portfolioTotal,
  `${outside.totalAssets} vs ${outside.portfolioTotal}`)

// 分母选错的具体后果：同一持仓在两个口径下一个超限一个不超限
const bigPos: Position[] = [
  { code: 'X', name: '测试股', sector: '电子', theme: 'AI', cost: 0, marketValue: 400_000 },
]
const snapMixed: AccountSnapshot = {
  date: '2026-08-15', totalAssets: 2_000_000, cash: 1_600_000, positionsValue: 400_000,
  externalCash: 2_000_000, portfolioTotal: 4_000_000,
  peakAssets: 5_000_000, peakBasis: 'PORTFOLIO',
}
ok('该持仓按账户口径为 20%（超 12%），按组合口径为 10%（不超）',
  Math.abs(400_000 / snapMixed.totalAssets - 0.20) < 1e-9
  && Math.abs(400_000 / snapMixed.portfolioTotal - 0.10) < 1e-9)
ok('超限清单按组合口径判定 → 不产生减仓',
  findLimitBreaches({ snapshot: snapMixed, positions: bigPos, asOf: '2026-08-15' }).length === 0)

// 峰值口径不可比时，回撤必须是 null，不能是 0 ——
// 后者会让熔断静默失效，而页面上一切正常。
const brokerPeak = mkSnap(583_000, 2_000_000, 'BROKER')
const ansBroker = evaluateSafety({ snapshot: brokerPeak, positions: basePos, asOf: '2026-08-15' })
const ddRowB = ansBroker.rows.find(r => r.label.includes('回撤'))
ok('峰值口径为 BROKER 时，回撤判为数据缺失而非 0',
  ddRowB?.light === 'UNKNOWN' && ddRowB.status.includes('缺失'),
  `${ddRowB?.light} / ${ddRowB?.status}`)
const ddMetric = ansBroker.metrics.find(x => x.label === '自峰值回撤')
ok('回撤缺失原因写明"口径不可比"，而非笼统的数据缺失',
  (ddMetric?.missingReason ?? '').includes('不可比'), ddMetric?.missingReason ?? '')

const portPeak = mkSnap(583_000, 2_000_000, 'PORTFOLIO')
const ansPort = evaluateSafety({ snapshot: portPeak, positions: basePos, asOf: '2026-08-15' })
ok('峰值口径为 PORTFOLIO 时回撤可算出',
  ansPort.metrics.find(x => x.label === '自峰值回撤')?.value !== null)

// 家庭安全垫只计账内现金：委员会明确账户外那笔不是家庭日常生活资产
const ansNet = evaluateSafety({
  snapshot: mkSnap(583_000, 2_000_000), positions: basePos,
  householdAnnualExpense: 400_000, asOf: '2026-08-15',
})
const netMetric = ansNet.metrics.find(x => x.label === '家庭安全垫年数')
  ?? ansNet.metrics.find(x => x.label.includes('安全垫'))
ok('安全垫用账内现金 58.3万 ÷ 40万 ≈ 1.46 年（若误并入 200 万会变成 6.46 年）',
  netMetric !== undefined && Math.abs((netMetric.value ?? 0) - 583_000 / 400_000) < 0.01,
  String(netMetric?.value))

const safetySrc = readFileSync(new URL('./safety.ts', import.meta.url), 'utf-8')
ok('safety.ts 里不存在名为 total 的裸变量（防止两个口径再被混用）',
  !/\bconst total\b|\blet total\b/.test(safetySrc))
ok('12% 判据只有一份实现（singleNameWeight），不再各写一遍',
  (safetySrc.match(/> LIMITS\.singleStock/g) ?? []).length <= 2
  && /export function singleNameWeight/.test(safetySrc))

// ── 熔断口径（委员会 2026-08-15 要求两套历史，不粗暴覆盖）──
console.log('\n【熔断口径】不可比必须与正常区分')
{
  const { judgeCircuit, PEAK_HISTORY } = await import('../governance/peakBasis')

  const cur = judgeCircuit(5_335_000)
  ok('组合口径峰值未建立时判为 INCOMPARABLE，而非 NORMAL',
    cur.state === 'INCOMPARABLE', cur.state)
  ok('不可比时回撤为 null，不得为 0',
    cur.drawdown === null, String(cur.drawdown))
  ok('不可比的理由明写不得判为"回撤0%"或"无熔断"',
    cur.reason.includes('回撤 0%') && cur.reason.includes('无熔断'))

  // 旧口径历史永不删除：它是 7/17–8/14 全部熔断判定的依据
  const legacy = PEAK_HISTORY.find(h => h.basis === 'legacy_account_basis')
  ok('旧口径峰值 430 万仍在册（删掉会让那段历史无法复核）',
    legacy?.peak === 4_300_000, String(legacy?.peak))
  const v1 = PEAK_HISTORY.find(h => h.basis === 'portfolio_basis_v1')
  ok('组合口径峰值标为尚未建立，而不是填上今天的 533 万',
    v1?.peak === null, String(v1?.peak))

  // 一旦峰值建立，判定必须真的能算出来
  const withPeak = judgeCircuit(5_335_000, [
    { basis: 'legacy_account_basis', peak: 4_300_000, peakDate: null, reliableFrom: null, note: '' },
    { basis: 'portfolio_basis_v1', peak: 6_000_000, peakDate: '2026-07-01', reliableFrom: '2026-06-01', note: '' },
  ])
  ok('峰值建立后可算出回撤（600万 → 533.5万 ≈ 11.1%）',
    withPeak.drawdown !== null && Math.abs(withPeak.drawdown - (1 - 5_335_000 / 6_000_000)) < 1e-9)
  ok('11.1% 回撤未触发熔断（一级线 15%）', withPeak.state === 'NORMAL')
  const deep = judgeCircuit(4_000_000, [
    { basis: 'legacy_account_basis', peak: 4_300_000, peakDate: null, reliableFrom: null, note: '' },
    { basis: 'portfolio_basis_v1', peak: 6_000_000, peakDate: '2026-07-01', reliableFrom: '2026-06-01', note: '' },
  ])
  ok('33% 回撤触发二级熔断', deep.state === 'LEVEL2', deep.state)
}

// ── 执行债务重审（四种终态，不允许模糊的"建议卖"）──
console.log('\n【执行债务重审】')
{
  const { loadDebts, reauditDebts } = await import('../governance/reaudit')
  const debts = loadDebts()
  ok('债务台账重建出 7 条', debts.length === 7, String(debts.length))
  ok('每条都带出处行号（凭记忆分类等于重新编一遍）',
    debts.every(d => typeof d.sourceLine === 'number' && d.sourceLine > 0))

  const snap: AccountSnapshot = {
    date: '2026-08-15', totalAssets: 3_335_000, cash: 583_000, positionsValue: 2_752_000,
    externalCash: 2_000_000, portfolioTotal: 5_335_000,
    peakAssets: 4_300_000, peakBasis: 'BROKER',
  }
  const pos: Position[] = [
    { code: '300308', name: '中际旭创', sector: '通信', theme: 'AI', cost: 0, marketValue: 560_000 },
    { code: '300502', name: '新易盛', sector: '通信', theme: 'AI', cost: 0, marketValue: 565_000 },
    { code: '688008', name: '澜起科技', sector: '电子', theme: '半导体', cost: 0, marketValue: 275_000 },
    { code: '603986', name: '兆易创新', sector: '电子', theme: '半导体', cost: 0, marketValue: 83_000 },
  ]
  const rows = reauditDebts(debts, snap, pos)
  const by = (id: string) => rows.find(r => r.debt.id === id)!

  ok('D5 中际旭创（纯仓位超限）判为因口径变更失效',
    by('D5').verdict === 'INVALIDATED_BY_BASIS_CHANGE', by('D5').verdict)
  ok('D6 新易盛 12%纠偏 判为因口径变更失效',
    by('D6').verdict === 'INVALIDATED_BY_BASIS_CHANGE', by('D6').verdict)
  ok('D3 新易盛原趋势指令（状态类，与分母无关）不因此失效',
    by('D3').verdict === 'PENDING_CONFIRMATION', by('D3').verdict)
  ok('同一标的的两条指令终态可以不同（新易盛 D3 保留、D6 失效）',
    by('D3').verdict !== by('D6').verdict)
  ok('D1 C级清退不因资产口径修正被顺手消掉',
    by('D1').verdict === 'PENDING_CONFIRMATION', by('D1').verdict)
  ok('D2 硬止损不因资产口径修正被顺手消掉',
    by('D2').verdict === 'PENDING_CONFIRMATION', by('D2').verdict)
  ok('D4 熔断类判为需重算，且理由指向峰值口径不可比',
    by('D4').verdict === 'RECALC_REQUIRED' && by('D4').reasoning.includes('不可比'),
    by('D4').verdict)
  ok('D4 不因"现在看着没超"而被消掉',
    by('D4').reasoning.includes('不得因'))

  ok('终态只出现在四种之内，不含模糊的"建议卖"',
    rows.every(r => ['VALID', 'INVALIDATED_BY_BASIS_CHANGE', 'RECALC_REQUIRED', 'PENDING_CONFIRMATION']
      .includes(r.verdict)))
  ok('E1 分母由 7 修正为 5（失效的 2 条不计入）',
    rows.filter(r => r.countsTowardE1).length === 5,
    String(rows.filter(r => r.countsTowardE1).length))

  const reauditSrc = readFileSync(new URL('../governance/reaudit.ts', import.meta.url), 'utf-8')
  ok('重审层不调用 makeAction（不生成交易指令）', !/\bmakeAction\s*\(/.test(reauditSrc))
  ok('重审层不含股数计算（撤销与执行属执行层）', !/quantity|股数\s*=/.test(reauditSrc))
}

console.log(`\n═══ 结果：${passed} 通过 / ${failed} 失败 ═══\n`)
if (failed > 0) process.exit(1)
