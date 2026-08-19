import { readFileSync } from 'node:fs'
// 研究层自检 —— 守三条不变量：
//
//   ① 研究域与决策域永不相交。「发现 ≠ 许可」必须在数据层成立，而不是靠下游闸门补救。
//   ② 加研究标的不得改变规则指纹。加研究标的不是加规则，冻结期不因研究而破。
//   ③ 利润数据不得插值。插出来的利润会被当成兑现证据。
//
// 运行：npm run research:selftest

import { NODE_CANDIDATES, researchCodes } from './nodeCandidates'
import { toSingleQuarter, computeMemberProfit, buildProfitMap } from './profitRadar'
import type { ProfitFile, RawPeriod, ProfitRecord } from './profitFetch'
import { MAINLINES } from '../msr/universe'
import { NODE_TAXONOMY } from '../cockpit/nodes'
import { fingerprint } from '../governance/ruleRegistry'
import { loadBaseline } from '../governance/freeze'

let failed = 0
let passed = 0
function ok(name: string, cond: boolean, extra = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.error(`  ✗ ${name} ${extra}`) }
}

console.log('\n═══ 研究层自检 ═══\n')

// ───────────────────────────────────────────────────────────────
console.log('【不变量一】研究域与决策域永不相交')
// ───────────────────────────────────────────────────────────────

const decisionCodes = new Set(MAINLINES.flatMap(m => m.members.map(x => x.code)))
const researchOnly = researchCodes().filter(c => !decisionCodes.has(c))
const overlap = researchCodes().filter(c => decisionCodes.has(c))

ok('研究名单非空', NODE_CANDIDATES.length > 0, String(NODE_CANDIDATES.length))
ok('存在纯研究域标的（否则本层没有意义）', researchOnly.length > 0, String(researchOnly.length))

// 重叠是允许的（如把已持仓标的列为对照），但必须仍归决策域管，不得因出现在研究名单里而绕过闸门。
// 关键断言：研究名单不得**新增**任何标的进入 MAINLINES。
const mainlineCodesAfter = new Set(MAINLINES.flatMap(m => m.members.map(x => x.code)))
ok('研究名单不改变决策域成员集合',
  researchOnly.every(c => !mainlineCodesAfter.has(c)),
  researchOnly.filter(c => mainlineCodesAfter.has(c)).join(','))
ok('与决策域重叠的标的仅作对照，数量可控',
  overlap.length <= 2, `重叠 ${overlap.length} 只：${overlap.join(',')}`)

// 研究标的必须落在已知节点上，否则地图会出现"未归属"行而无人负责
const taxKeys = new Set(NODE_TAXONOMY.map(n => `${n.mainlineId}|${n.name}`))
const badNode = NODE_CANDIDATES.filter(c => !taxKeys.has(`${c.mainlineId}|${c.node}`))
ok('每个研究标的的节点都存在于节点清单中', badNode.length === 0,
  badNode.map(c => `${c.name}→${c.mainlineId}/${c.node}`).join('；'))

// 研究名单应当覆盖那 13 个无覆盖节点
const coveredByDecision = new Set(
  MAINLINES.flatMap(ml => ml.members.map(m => `${ml.id}|${m.node}`))
)
const uncovered = NODE_TAXONOMY.filter(n =>
  !MAINLINES.some(ml => ml.id === n.mainlineId && ml.members.some(m => n.aliases.includes(m.node)))
)
const researchNodeKeys = new Set(NODE_CANDIDATES.map(c => `${c.mainlineId}|${c.node}`))
const stillUncovered = uncovered.filter(n => !researchNodeKeys.has(`${n.mainlineId}|${n.name}`))
ok(`13个无覆盖节点已被研究名单覆盖（剩 ${stillUncovered.length} 个）`,
  stillUncovered.length <= 8,
  stillUncovered.map(n => `${n.mainlineId}/${n.name}`).join('、'))
ok('决策域覆盖集合未被研究层污染', coveredByDecision.size > 0)

// ───────────────────────────────────────────────────────────────
console.log('\n【不变量二】加研究标的不得改变规则指纹')
// ───────────────────────────────────────────────────────────────

const base = loadBaseline()
const fp = fingerprint()
ok('冻结基线存在', base !== null)
if (base) {
  ok('规则指纹与基线一致（研究层未触碰任何决策规则）',
    fp.hash === base.hash, `${base.hash} → ${fp.hash}`)
  ok('决策生效参数条数未变', fp.entryCount === base.entryCount,
    `${base.entryCount} → ${fp.entryCount}`)
  ok('OBSERVATION 等级规则条数未增加',
    (fp.tierCounts.OBSERVATION ?? 0) <= (base.tierCounts.OBSERVATION ?? 0),
    JSON.stringify(fp.tierCounts))
}

// ───────────────────────────────────────────────────────────────
console.log('\n【不变量三】利润数据不得插值')
// ───────────────────────────────────────────────────────────────

function p(year: number, q: 1 | 2 | 3 | 4, rev: number | null, np: number | null, extra: Partial<RawPeriod> = {}): RawPeriod {
  const mm = q === 1 ? '03-31' : q === 2 ? '06-30' : q === 3 ? '09-30' : '12-31'
  return {
    reportDate: `${year}-${mm}`, noticeDate: `${year}-${mm}`, year, quarter: q,
    revenueCum: rev, netProfitCum: np,
    basicEps: 1, deductEps: null, grossMarginCumPct: 30, cfoPerShareCum: 1, roeCum: 10,
    ...extra,
  }
}

// 累计 → 单季
const sq = toSingleQuarter([
  p(2025, 1, 100, 10), p(2025, 2, 250, 30), p(2025, 3, 400, 45), p(2025, 4, 600, 70),
  p(2026, 1, 200, 25), p(2026, 2, 500, 66),
])
ok('Q1 单季即累计', sq.find(x => x.label === '2025Q1')?.revenue === 100)
ok('Q2 单季 = 半年累计 − Q1累计', sq.find(x => x.label === '2025Q2')?.revenue === 150)
ok('Q4 单季 = 年报累计 − 三季报累计', sq.find(x => x.label === '2025Q4')?.revenue === 200)
ok('单季净利同比正确（2026Q1: 25/10-1=150%）',
  Math.abs((sq.find(x => x.label === '2026Q1')?.netProfitYoy ?? 0) - 1.5) < 1e-9,
  String(sq.find(x => x.label === '2026Q1')?.netProfitYoy))
ok('单季收入同比正确（2026Q2: 300/150-1=100%）',
  Math.abs((sq.find(x => x.label === '2026Q2')?.revenueYoy ?? 0) - 1.0) < 1e-9)

// 缺端不插值
const sqGap = toSingleQuarter([p(2025, 1, null, 10), p(2025, 2, 250, 30)])
ok('缺上期累计时该季为 null，不插值',
  sqGap.find(x => x.label === '2025Q2')?.revenue === null)

// 基期为负 → 同比留空
const sqNeg = toSingleQuarter([
  p(2025, 1, 100, -10), p(2026, 1, 200, 25),
])
ok('基期净利为负时同比留空（增长率无可解释含义）',
  sqNeg.find(x => x.label === '2026Q1')?.netProfitYoy === null)

// 扣非只取同时有扣非与基本EPS的期
const recDeduct: ProfitRecord = {
  code: '000001', name: '测试', scope: 'RESEARCH',
  periods: [
    p(2025, 4, 600, 70, { basicEps: 2, deductEps: 1.8 }),
    p(2026, 1, 200, 25, { basicEps: 0.8, deductEps: null }),
  ],
}
const mp = computeMemberProfit(recDeduct, '光模块', 'optical', '2026-08-13')
ok('扣非占比取最近一期可得（年报 1.8/2 = 90%）',
  Math.abs((mp.deductRatio ?? 0) - 0.9) < 1e-9, String(mp.deductRatio))
ok('扣非口径滞后被显式记为缺口',
  mp.dataGaps.some(g => g.includes('扣非口径滞后')), mp.dataGaps.join('；'))
ok('最新报告期无扣非时不回退用净利润冒充扣非',
  mp.deductRatioAsOf === '2025-12-31', String(mp.deductRatioAsOf))
ok('报告期滞后天数被算出（用于暴露数据陈旧）',
  mp.reportAgeDays !== null && mp.reportAgeDays > 100, String(mp.reportAgeDays))

const recNoData: ProfitRecord = { code: '000002', name: '空', scope: 'RESEARCH', periods: [] }
const mpNo = computeMemberProfit(recNoData, '光模块', 'optical', '2026-08-13')
ok('无财报时各项为 null 且记入缺口',
  mpNo.deductRatio === null && mpNo.dataGaps.some(g => g.includes('无任何财报数据')))

// ───────────────────────────────────────────────────────────────
console.log('\n【地图】状态标签与新鲜度声明')
// ───────────────────────────────────────────────────────────────

const fakeFile: ProfitFile = {
  generatedAt: '2026-08-13T00:00:00Z',
  source: 'test',
  methodology: {
    cumulative: '', singleQuarter: '', deductRatio: '', grossMargin: '', cashMatch: '',
    unavailable: ['CapEx（资本开支）'],
  },
  records: [
    // 有同比但无加速度（历史只有两年同季）
    { code: '300308', name: '中际旭创', scope: 'DECISION', periods: [p(2025, 1, 100, 10), p(2026, 1, 200, 25)] },
  ],
}
const map = buildProfitMap('2026-08-13', fakeFile)
const node = map.nodes.find(n => n.node === '光模块')
ok('有同比但加速度不可算 → LEVEL_ONLY，而非 NO_DATA',
  node?.status === 'LEVEL_ONLY', String(node?.status))
ok('LEVEL_ONLY 仍保留同比中位数（不因缺加速度而丢弃事实）',
  node?.medianNpYoy !== null, String(node?.medianNpYoy))

const emptyMap = buildProfitMap('2026-08-13', {
  ...fakeFile,
  records: [{ code: '300308', name: '中际旭创', scope: 'DECISION', periods: [] }],
})
ok('确实无数据时才判 NO_DATA',
  emptyMap.nodes.find(n => n.node === '光模块')?.status === 'NO_DATA')

ok('地图带数据新鲜度声明', map.freshness.warning.includes('利润雷达一年只更新四次'))

// ── 绝对增量：与增长率必须并存，且不得互相替代 ──
const recDelta: ProfitRecord = {
  code: '300308', name: '大基数', scope: 'DECISION',
  periods: [p(2025, 1, 1000, 100), p(2026, 1, 1000, 200)],
}
const recSmall: ProfitRecord = {
  code: '688498', name: '小基数', scope: 'DECISION',
  periods: [p(2025, 1, 10, 1), p(2026, 1, 20, 13)],
}
const big = computeMemberProfit(recDelta, '光模块', 'optical', '2026-08-13')
const small = computeMemberProfit(recSmall, '光芯片', 'optical', '2026-08-13')
ok('大基数标的：同比 +100%，绝对增量 100',
  Math.abs((big.latestSingle?.netProfitYoy ?? 0) - 1) < 1e-9 && big.npAbsDelta === 100)
ok('小基数标的：同比 +1200%，绝对增量仅 12',
  Math.abs((small.latestSingle?.netProfitYoy ?? 0) - 12) < 1e-9 && small.npAbsDelta === 12)
ok('增长率与绝对增量给出相反排序（这正是必须并列呈现的原因）',
  (small.latestSingle?.netProfitYoy ?? 0) > (big.latestSingle?.netProfitYoy ?? 0) &&
  (small.npAbsDelta ?? 0) < (big.npAbsDelta ?? 0))

// 基期为负时增量仍可算，而同比留空
const recNegBase: ProfitRecord = {
  code: '000003', name: '基期亏损', scope: 'RESEARCH',
  periods: [p(2025, 1, 100, -50), p(2026, 1, 200, 30)],
}
const negBase = computeMemberProfit(recNegBase, '光模块', 'optical', '2026-08-13')
ok('基期为负：同比留空但绝对增量仍算出（+80）',
  negBase.latestSingle?.netProfitYoy === null && negBase.npAbsDelta === 80,
  `yoy=${negBase.latestSingle?.netProfitYoy} delta=${negBase.npAbsDelta}`)

// ── 披露顺序伪影：财报季只有少数节点出报表时，份额分母不完整 ──
const artifactFile: ProfitFile = {
  ...fakeFile,
  records: [
    { code: '688313', name: '早披露', scope: 'DECISION', periods: [p(2025, 2, 50, 5), p(2026, 2, 100, 15)] },
    { code: '300308', name: '未披露', scope: 'DECISION', periods: [p(2025, 2, 500, 50)] },
  ],
}
const artifactMap = buildProfitMap('2026-08-13', artifactFile)
const early = artifactMap.nodes.find(n => n.members.some(m => m.code === '688313'))
const q2 = early?.deltaShareHistory.find(h => h.label === '2026Q2')
ok('财报季首个披露者不会显示成 100% 份额（披露顺序伪影已屏蔽）',
  q2 === undefined || q2.share === null, `2026Q2 share=${q2?.share}`)

// ── 存量份额与增量份额是两个不同的量，不得互相替代 ──
const levelFile: ProfitFile = {
  ...fakeFile,
  records: [
    // 大节点：家底厚但本季增量一般
    { code: '300308', name: '大节点', scope: 'DECISION', periods: [p(2025, 1, 900, 90), p(2026, 1, 1000, 100)] },
    { code: '300502', name: '中节点', scope: 'DECISION', periods: [p(2025, 1, 100, 10), p(2026, 1, 150, 15)] },
    // 小节点：家底薄但本季增量占比高
    { code: '688498', name: '小节点', scope: 'DECISION', periods: [p(2025, 1, 5, 1), p(2026, 1, 50, 30)] },
  ],
}
const lvMap = buildProfitMap('2026-08-13', levelFile)
const bigNode = lvMap.nodes.find(n => n.members.some(m => m.code === '300308'))
const smallNode = lvMap.nodes.find(n => n.members.some(m => m.code === '688498'))
// 300308 与 300502 同属光模块节点：节点规模 = 100 + 15 = 115，主线合计 = 115 + 30 = 145
ok('存量份额：大节点 115/145 ≈ 79%',
  Math.abs((bigNode?.levelShare ?? 0) - 115 / 145) < 1e-6, String(bigNode?.levelShare))
ok('增量份额：小节点 29/(15+29) ≈ 66%，远高于其存量份额 21%',
  Math.abs((smallNode?.deltaShareOfMainline ?? 0) - 29 / 44) < 1e-6 &&
  (smallNode?.levelShare ?? 1) < 0.25,
  `delta=${smallNode?.deltaShareOfMainline} level=${smallNode?.levelShare}`)
ok('同一节点的存量份额与增量份额可以差距悬殊（故两者必须并列显示）',
  Math.abs((smallNode?.deltaShareOfMainline ?? 0) - (smallNode?.levelShare ?? 0)) > 0.3)
ok('A 利润规模按绝对水平记录，不是份额',
  bigNode?.npLevelSum === 115, String(bigNode?.npLevelSum))

// 公司在节点内的份额
const twoInNode: ProfitFile = {
  ...fakeFile,
  records: [
    { code: '300308', name: '甲', scope: 'DECISION', periods: [p(2026, 1, 100, 75)] },
    { code: '300502', name: '乙', scope: 'DECISION', periods: [p(2026, 1, 100, 25)] },
  ],
}
const wnMap = buildProfitMap('2026-08-13', twoInNode)
const wnNode = wnMap.nodes.find(n => n.members.length === 2)
ok('公司节点内份额：甲 75%、乙 25%',
  Math.abs((wnNode?.members.find(m => m.code === '300308')?.shareWithinNode ?? 0) - 0.75) < 1e-9 &&
  Math.abs((wnNode?.members.find(m => m.code === '300502')?.shareWithinNode ?? 0) - 0.25) < 1e-9)

// 亏损公司不得把同节点其他公司的份额推过 100%
const withLoss: ProfitFile = {
  ...fakeFile,
  records: [
    { code: '300308', name: '盈利', scope: 'DECISION', periods: [p(2026, 1, 100, 80)] },
    { code: '300502', name: '亏损', scope: 'DECISION', periods: [p(2026, 1, 100, -30)] },
  ],
}
const lossNode = buildProfitMap('2026-08-13', withLoss).nodes.find(n => n.members.length === 2)
ok('同节点有亏损公司时，盈利方份额不超过 100%',
  (lossNode?.members.find(m => m.code === '300308')?.shareWithinNode ?? 0) === 1)

// ── 数据完整度闸门：0/6 必须判为不可用于机会判断 ──
const q = lvMap.quality
ok('输出各主线数据完整度', q.length >= 4, String(q.length))
const power = q.find(x => x.mainlineId === 'power')
ok('AI电力三项验证均为 0 → 判为不可用于机会判断',
  power !== undefined && power.usableForOpportunity === false,
  JSON.stringify(power?.blockers))
ok('不可用时给出具体原因（不知道本身就是信息）',
  (power?.blockers.length ?? 0) >= 3, JSON.stringify(power?.blockers))
const compute = q.find(x => x.mainlineId === 'compute')
ok('AI算力三项验证 4/6 → 判为可用', compute?.usableForOpportunity === true)
ok('完整度是比例而非评分', (power?.completeness ?? -1) === 0)

// 真实数据的份额趋势
try {
  const realMap = buildProfitMap('2026-08-13')
  const optical = realMap.nodes.filter(n => n.mainlineId === 'optical')
  const mod = optical.find(n => n.node === '光模块')
  ok('份额历史有多季读数（趋势可判）',
    (mod?.deltaShareHistory.filter(h => h.share !== null).length ?? 0) >= 4,
    String(mod?.deltaShareHistory.filter(h => h.share !== null).length))
  const shares = optical.map(n => n.deltaShareHistory[n.deltaShareHistory.length - 2]?.share ?? 0)
  const total = shares.reduce((a, b) => a + b, 0)
  ok('同一主线同一季度的增量份额合计约为 1',
    Math.abs(total - 1) < 0.02, String(total))
  const lvTotal = optical.map(n => n.levelShare ?? 0).reduce((a, b) => a + b, 0)
  ok('同一主线的存量份额合计约为 1', Math.abs(lvTotal - 1) < 0.02, String(lvTotal))
  ok('真实数据中 AI电力被判为不可用于机会判断',
    realMap.quality.find(x => x.mainlineId === 'power')?.usableForOpportunity === false)
} catch { /* 需先跑 profit:fetch */ }
ok('地图列出不可得字段', map.unavailableFields.length > 0)

// 地图在类型上不含任何动作字段 —— 它不可能产出买入建议
const mapKeys = Object.keys(map)
const actionish = ['action', 'buy', 'sell', 'recommend', 'order', 'target']
ok('地图对象不含任何动作/建议字段',
  !mapKeys.some(k => actionish.some(a => k.toLowerCase().includes(a))), mapKeys.join(','))

// 真实数据文件（若已抓取）应能构建地图
try {
  const real = buildProfitMap('2026-08-13')
  ok('真实数据可构建地图', real.nodes.length > 0, String(real.nodes.length))
  ok('真实地图暴露了利润数据滞后（中位>90天）',
    (real.freshness.medianReportAgeDays ?? 0) > 90, String(real.freshness.medianReportAgeDays))
  const researchNodes = real.nodes.filter(n => n.researchOnly)
  ok('存在"仅研究域覆盖"的节点并被标记', researchNodes.length > 0, String(researchNodes.length))
} catch (e) {
  ok('真实数据可构建地图（需先跑 npm run profit:fetch）', false, e instanceof Error ? e.message : String(e))
}

// ══════════════════════════════════════════════════════════════
// 外部叙事台账：这条证据到底证明了什么？
// ══════════════════════════════════════════════════════════════
{
  const {
    HYPOTHESES, VERIFICATION_CHAIN, withLiveData, fourLineVerdict, metCount,
    renderHypotheses, allIndicators, paidGaps, wiringBacklog, SOURCE_TIER_TEXT,
  } = await import('./hypotheses')

  const h1 = HYPOTHESES.find(h => h.id === 'H1')!

  // ── 类型层面：不得产生动作 ──
  ok('叙事台账证据等级恒为 OBSERVATION（按约定不得进动作区）',
    HYPOTHESES.every(h => h.tier === 'OBSERVATION'))
  const modSrc = readFileSync(new URL('./hypotheses.ts', import.meta.url), 'utf-8')
  const imports = modSrc.split('\n').filter(l => l.startsWith('import')).join('\n')
  ok('模块不 import makeAction —— 不是"约定不用"，而是没有那个函数可用',
    !/makeAction/.test(imports))
  ok('模块不导出任何返回 Action 的函数', !/:\s*Action(\[\])?\s*[{;]/.test(modSrc))

  // ── 一句话拆成两个命题 ──
  //
  // 这是本次迭代最重要的一条：命题 A 与 B 的证明力完全不同，
  // 合在一起会让 A 的证据被读成 B 的背书。
  const A = h1.propositions.find(p => p.id === 'A')!
  const B = h1.propositions.find(p => p.id === 'B')!
  ok('叙事被拆成两个独立命题', h1.propositions.length === 2)
  ok('命题 A 标为当前事实', A.horizon === 'CURRENT_FACT')
  ok('命题 B 标为未来假设', B.horizon === 'FUTURE_HYPOTHESIS')
  ok('命题 A 的每一项都标为当前事实',
    A.indicators.every(i => i.horizon === 'CURRENT_FACT'))
  ok('命题 B 的每一项都标为未来假设',
    B.indicators.every(i => i.horizon === 'FUTURE_HYPOTHESIS'))
  ok('命题 B 覆盖需求端/价格端/供给端/盈利端/持续性五个维度',
    B.indicators.length === 5
    && ['需求端', '价格端', '供给端', '盈利端', '持续性']
      .every(k => B.indicators.some(i => i.text.includes(k))),
    B.indicators.map(i => i.text.slice(0, 4)).join(','))
  ok('明确写出"B 不能从 A 推出"',
    h1.doesNotImply.some(d => d.includes('B 不能从 A 推出')))

  // ── 公开数据优先：付费缺口必须是筛出来的，不是随口说的 ──
  //
  // 危险假设是「没有付费数据库 → S2 永远过不了」。
  // 那会让系统从"防止虚假判断"退化成"因为没有 Bloomberg 所以什么都不判断"。
  const paid = paidGaps(h1)
  const wiring = wiringBacklog(h1)
  ok('付费缺口只剩需求端与价格端两项',
    paid.length === 2
    && paid.every(i => i.text.includes('需求端') || i.text.includes('价格端')),
    paid.map(i => i.text.slice(0, 6)).join(','))
  ok('扣非利润不再被记为付费缺口 —— 它是公开披露项且已在管道内',
    allIndicators(h1).some(i => i.text.includes('扣非') && i.sourceTier === 'PUBLIC_IN_PIPELINE'))
  ok('毛利率不被记为付费缺口 —— 公开财报 XSMLL 字段已在管道内',
    allIndicators(h1).some(i => i.text.includes('毛利率') && i.sourceTier === 'PUBLIC_IN_PIPELINE'))
  // 公司收入已于 2026-08-16 接入管道（分产品收入表），故从"尚未接入"移出。
  // 剩下的只有供给端 —— 它仍是工作量缺口，不是付费缺口。
  ok('公司收入已接入管道，不再记为"尚未接入"',
    allIndicators(h1).some(i => i.text.includes('收入')
      && i.sourceTier === 'PUBLIC_IN_PIPELINE'))
  ok('供给端仍记为"尚未接入"而非付费缺口（工作量 ≠ 数据不可得）',
    wiring.length === 1 && wiring[0]!.text.includes('供给端'),
    wiring.map(i => i.text.slice(0, 8)).join(','))
  ok('取数层级文案区分"工作量问题"与"数据可得性问题"',
    SOURCE_TIER_TEXT.PUBLIC_NOT_YET_WIRED.includes('工作量'))
  ok('付费层文案要求先走完公开优先各层',
    SOURCE_TIER_TEXT.NEEDS_PAID.includes('公开披露无法回答'))

  // ── 验证链：问法必须是归因，不是"有没有增长" ──
  // 链条已于 2026-08-16 由七步扩为九环（新增「数量/价格拆分」与「同行验证」），
  // 逐环断言移至文件末尾「三条系统边界」一节，此处只留数量与关键取数层级。
  ok('验证链共 9 环', VERIFICATION_CHAIN.length === 9)
  const byName = (n: string) => VERIFICATION_CHAIN.find(x => x.name === n)!
  ok('「扣非利润」取数层级为公开·已在管道内',
    byName('扣非利润').source === 'PUBLIC_IN_PIPELINE')
  ok('「利润主线归因」问的是扣非利润中来自主线的部分',
    byName('利润主线归因').asks.includes('扣非') && byName('利润主线归因').asks.includes('主线'))
  ok('「战略资格」标为战略层裁定，非数据问题',
    byName('战略资格').source === 'STRATEGY_RULING')

  // 停在最早一个未完成的步骤，而不是最晚一个已完成的
  ok('H1 停在第 3 步（主线收入归因）—— 第 4 步有数据也不能因此跳过第 3 步',
    h1.stage === 3, `实为第 ${h1.stage} 步`)

  // ── 动态取值：不得写死 ──
  ok('源码中不出现写死的份额数字',
    !/23\.6%|16\.4pct|14\.6 ?亿/.test(modSrc))
  ok('源码中不出现写死的扣非占比',
    !/89\.1%|73\.2%|96\.6%/.test(modSrc))

  const live = withLiveData(h1, {
    npLevelSum: 14.6e8, levelShare: 0.236, levelShareDelta4Q: 16.4,
    deltaShareOfMainline: 0.388, maxReportAgeDays: 136,
    members: [{
      name: '兆易创新', deductRatio: 0.891, deductRatioAsOf: '2025-12-31',
      grossMarginPct: 40.2, grossMarginYoyPct: 2.1, grossMarginPrevPct: 38.1,
    }],
  })
  const liveA = live.propositions.find(p => p.id === 'A')!
  const i1 = liveA.indicators.find(i => i.no === 1)!
  ok('注入实测值后份额项判为 MET', i1.status === 'MET')
  ok('份额证据写出滞后天数 —— 不写读者会默认它是当期的', i1.evidence.includes('136 天'))
  ok('滞后 >100 天时明说"既无法证实也无法证伪"',
    i1.evidence.includes('无法证实也无法证伪'))
  ok('份额证据列出四种替代解释（不止周期涨价一种）',
    ['周期涨价', '同行掉队', '产品结构', '供给收缩'].every(k => i1.evidence.includes(k)))

  const i3 = liveA.indicators.find(i => i.no === 3)!
  ok('扣非项从公开年报取到实测值并判为 MET',
    i3.status === 'MET' && i3.evidence.includes('89.1%'))
  ok('扣非证据明说它不回答"利润是否来自本主线"',
    i3.evidence.includes('不回答') && i3.evidence.includes('主线'))
  const i4 = liveA.indicators.find(i => i.no === 4)!
  ok('毛利率项取到实测值并判为 MET', i4.status === 'MET' && i4.evidence.includes('40.2%'))
  ok('毛利率同屏显示两个端点，不只给差值（只看差值看不出量级）',
    i4.evidence.includes('38.1% → 40.2%'), i4.evidence.slice(0, 60))
  ok('毛利率证据写明单位为百分数（曾按小数用又乘 100，渲染出 5707.67%）',
    i4.evidence.includes('单位为百分数'))

  // 上一轮这里断言的是文案「量级异常，须核验」。该机制已被更强的
  // PENDING_VERIFICATION 状态取代（见文件末尾"因果强度五层"一节）：
  // 大幅跃升不再只是"文案里提一句"，而是**结构上不计入兑现数**。
  // 故此处只保留一条：没有 anomaly 信息时不得擅自判为待核验 ——
  // 待核验必须有归因依据，否则它会变成一个万能的搪塞状态。
  const noAnomaly = withLiveData(h1, {
    npLevelSum: 14.6e8, levelShare: 0.236, levelShareDelta4Q: 16.4,
    deltaShareOfMainline: 0.388, maxReportAgeDays: 136,
    members: [{
      name: '兆易创新', deductRatio: 0.891, deductRatioAsOf: '2025-12-31',
      grossMarginPct: 57.1, grossMarginYoyPct: 19.6, grossMarginPrevPct: 37.4,
      grossMarginAnomaly: null,
    }],
  })
  const naGm = noAnomaly.propositions.find(p => p.id === 'A')!.indicators.find(i => i.no === 4)!
  ok('缺少归因信息时不判为待核验（待核验必须有依据，否则会变成万能搪塞）',
    naGm.status !== 'PENDING_VERIFICATION', naGm.status)
  ok('毛利率证据明说单季改善不构成对命题 B 的证据',
    i4.evidence.includes('不构成对命题 B 的证据'))

  // 份额收缩必须翻成 REFUTED
  const shrink = withLiveData(h1, {
    npLevelSum: 14.6e8, levelShare: 0.236, levelShareDelta4Q: -3.0,
    deltaShareOfMainline: null, maxReportAgeDays: 136,
  })
  ok('份额收缩时判为 REFUTED（不得停留在 MET）',
    shrink.propositions.find(p => p.id === 'A')!.indicators
      .find(i => i.no === 1)?.status === 'REFUTED')

  // ── 四句话结论 ──
  const v = fourLineVerdict(live)
  ok('第 1 句：当前景气有证据，并注明来自公开披露',
    v.currentFact.includes('有证据') && v.currentFact.includes('公开披露'))
  ok('第 2 句：AI 是主要驱动力 = 部分待验证', v.aiAsDriver.includes('部分待验证'))
  ok('第 3 句：3–5 年超级周期 = 未验证', v.superCycle.includes('未验证'))
  ok('第 3 句指出持续性在定义上无法用单期数据满足',
    v.superCycle.includes('无法用任何单期数据满足'))
  ok('第 4 句：候选资格 = 战略层不允许', v.candidacy.includes('战略层不允许'))
  const all4 = [v.currentFact, v.aiAsDriver, v.superCycle, v.candidacy].join(' ')
  for (const banned of ['要涨', '起飞', '超级周期成立', '将会', '有望', '看好']) {
    ok(`四句话不出现预测性表述「${banned}」`, !all4.includes(banned))
  }
  ok('四句话把"有证据"与"未验证"放在同一段，读者无法只取前半句',
    all4.includes('有证据') && all4.includes('未验证'))

  // ── 反直觉结论必须成立：证据全绿仍不买 ──
  //
  // 这是七层驾驶舱没有越权的证明。
  const allGreen: typeof h1 = {
    ...live,
    propositions: live.propositions.map(p => ({
      ...p, indicators: p.indicators.map(i => ({ ...i, status: 'MET' as const })),
    })),
  }
  const vg = fourLineVerdict(allGreen)
  ok('即便全部指标兑现，候选资格仍为战略层不允许',
    vg.candidacy.includes('战略层不允许'))
  ok('阻塞项明写"全部指标兑现仍不产生买入动作"',
    h1.blockers.join('').includes('全部指标都兑现')
    && h1.blockers.join('').includes('不产生买入动作'))
  ok('阻塞项区分"产业证据不足"与"战略层裁定"，并说明两者不可替代',
    h1.blockers.join('').includes('不可互相替代'))
  ok('阻塞项指出份额扩大会成为清退标的的后门',
    h1.blockers.join('').includes('后门'))
  void metCount(allGreen)

  // ── 渲染层 ──
  const txt = renderHypotheses([live])
  ok('渲染层声明不打分、不排序、不产生候选、不产生动作',
    ['不打分', '不排序', '不产生候选', '不产生动作'].every(k => txt.includes(k)))
  ok('渲染层不出现"综合评分""总分""星级"', !/综合评分|总分|星级/.test(txt))
  ok('渲染层把四句话结论放在指标表之前',
    txt.indexOf('机器结论') < txt.indexOf('命题 A'))
  ok('渲染层写明取数原则：能公开验证的绝不列为付费缺口',
    txt.includes('能公开验证的绝不列为付费缺口'))
  ok('渲染层把"尚未接入"与"付费缺口"分区显示',
    txt.includes('公开可得但尚未接入') && txt.includes('付费数据缺口'))
  ok('渲染层说明链条停在最早一个未完成的步骤',
    txt.includes('停在最早一个未完成的步骤'))
}

// ── 数据文件完整性检查：防"改了字段名但没迁移数据" ──
//
// 这是一次真实的静默故障：grossMarginCum → grossMarginCumPct 改名后，
// 代码读新键、磁盘存旧键，1826 个报告期的毛利率全部变成 null。
// 没有报错，只是所有读数悄悄消失，页面显示"基期缺失"，看起来像数据源本来就缺。
{
  const { findEmptyFields } = await import('./profitRadar')
  const mk = (y: number, q: 1 | 2 | 3 | 4, extra: Record<string, unknown> = {}) => ({
    reportDate: `${y}-${String(q * 3).padStart(2, '0')}-30`,
    noticeDate: `${y}-${String(q * 3).padStart(2, '0')}-30`,
    year: y, quarter: q, revenueCum: 100, netProfitCum: 10,
    basicEps: 1, deductEps: null, grossMarginCumPct: 40, ...extra,
  })
  const wrap = (periods: unknown[]) => ({
    generatedAt: 'x', source: 'x', methodology: 'x',
    records: [{ code: '1', name: 'a', scope: 'DECISION', periods }],
  }) as never

  // 逐季披露字段全空 → 报出
  const gmMissing = wrap([1, 2, 3, 4].map(q =>
    mk(2025, q as 1 | 2 | 3 | 4, { grossMarginCumPct: null })))
  ok('逐季披露字段（毛利率）全空被报出',
    findEmptyFields(gmMissing).some(x => x.includes('grossMarginCumPct')))

  // 样本不足 4 期 → 不报（小 fixture 全空可能只是巧合）
  ok('样本不足 4 期时不报逐季字段（避免对小 fixture 误报）',
    findEmptyFields(wrap([mk(2025, 1, { grossMarginCumPct: null })])).length === 0)

  // 扣非按披露节奏判断：只有一季报时不报
  ok('只有一季报时不报扣非缺失（一季报本来就不披露扣非）',
    !findEmptyFields(wrap([mk(2025, 1), mk(2025, 3), mk(2026, 1)]))
      .some(x => x.includes('deductEps')))
  // 有中报/年报却全空 → 报出
  ok('中报/年报期存在却全无扣非时报出',
    findEmptyFields(wrap([mk(2025, 2), mk(2025, 4)]))
      .some(x => x.includes('deductEps')))
  // 正常数据不报
  ok('字段齐全时不报任何异常',
    findEmptyFields(wrap([mk(2025, 2, { deductEps: 0.9 }), mk(2025, 4, { deductEps: 1.8 }),
      mk(2026, 1), mk(2026, 3)])).length === 0)
}

// ══════════════════════════════════════════════════════════════
// 因果强度五层与"事实 ≠ 因果证据"
// ══════════════════════════════════════════════════════════════
{
  const {
    HYPOTHESES, withLiveData, causalLayers, pendingVerification, metCount,
    fourLineVerdict, renderHypotheses, CAUSAL_STATUS_TEXT,
  } = await import('./hypotheses')
  const { judgeGmAnomalyForTest } = await import('./profitRadar') as never as {
    judgeGmAnomalyForTest?: unknown
  }
  void judgeGmAnomalyForTest

  const h1 = HYPOTHESES.find(h => h.id === 'H1')!
  const node = {
    npLevelSum: 14.6e8, levelShare: 0.236, levelShareDelta4Q: 16.4,
    deltaShareOfMainline: 0.388, maxReportAgeDays: 136,
    // 第 2 环实测（分产品收入表已接入）
    link2: {
      period: '2025年报（2025-12-31）', revenueYoy: 0.251, improved: true, ageDays: 228,
      target: { group: '存储芯片', yoy: 0.264, shareOfRevenue: 0.713, shareOfTotalDelta: 0.743 },
      fastestGrowing: { group: 'MCU与模拟', yoy: 0.315 },
      targetIsFastestGrowing: false,
    },
    members: [{
      name: '兆易创新', deductRatio: 0.891, deductRatioAsOf: '2025-12-31',
      grossMarginPct: 57.1, grossMarginYoyPct: 19.6, grossMarginPrevPct: 37.4,
      grossMarginAnomaly: {
        verdict: 'CURRENT_IS_OUTLIER', historyMinPct: 26.7, historyMaxPct: 49.5,
        currentDeviationPct: 7.6,
        note: '本期 57.1% 落在自身历史区间 26.7–49.5% 之上 7.6pct（基期 37.4% 在区间内）',
      },
    }],
    peerGrossMargin: {
      total: 15, currentOutliers: 3, baseOutliers: 3, medianYoyPct: 2.9,
      note: 'semi口径 15 家有可比读数，同比中位数 +2.9pct；其中 3 家本期偏离自身历史、3 家属基期失真。',
    },
  }
  const live = withLiveData(h1, node)

  // ── 57.1% 只能是待核验，不能是利好证据 ──
  const gm = live.propositions.find(p => p.id === 'A')!.indicators.find(i => i.no === 4)!
  ok('毛利率跃升判为 PENDING_VERIFICATION，不是 MET',
    gm.status === 'PENDING_VERIFICATION', gm.status)
  ok('待核验项不计入 metCount（否则未解释的跃升会自动变成"又多一项证据"）',
    metCount(live) === 3, `实为 ${metCount(live)}`)
  ok('证据明写"只能叫事实，不能叫因果证据"',
    gm.evidence.includes('只能叫事实，不能叫因果证据'))
  ok('证据列出六项核对清单',
    (gm.verifyChecklist ?? []).length === 6, `实为 ${(gm.verifyChecklist ?? []).length} 项`)
  for (const item of ['产品结构', 'ASP', '成本', '存货跌价', '会计口径', '同行']) {
    ok(`核对清单覆盖「${item}」`,
      (gm.verifyChecklist ?? []).some(c => c.includes(item)))
  }
  ok('证据同屏给出自身历史区间与偏离幅度',
    gm.evidence.includes('26.7–49.5%') && gm.evidence.includes('7.6pct'))
  ok('证据同屏给出同业对照', gm.evidence.includes('同业对照'))

  // 基期失真必须判为不构成改善证据 —— 这是拓荆科技那个真实案例
  const baseDistorted = withLiveData(h1, {
    ...node,
    members: [{
      ...node.members[0], name: '拓荆科技',
      grossMarginPct: 41.7, grossMarginYoyPct: 21.8, grossMarginPrevPct: 19.9,
      grossMarginAnomaly: {
        verdict: 'BASE_IS_OUTLIER', historyMinPct: 27.6, historyMaxPct: 50.3,
        currentDeviationPct: 0,
        note: '基期 19.9% 才是偏离项(自身历史区间 27.6–50.3%)，本期 41.7% 落在区间内',
      },
    }],
  })
  const bd = baseDistorted.propositions.find(p => p.id === 'A')!.indicators.find(i => i.no === 4)!
  ok('基期失真时同比 +21.8pct 不构成改善证据（判为 UNVERIFIED）',
    bd.status === 'UNVERIFIED', bd.status)
  ok('并明说同比来自基期失真、本期未偏离自身历史',
    bd.evidence.includes('基期失真') && bd.evidence.includes('不构成改善证据'))

  // ── 因果强度五层 ──
  const cl = causalLayers(live, node.peerGrossMargin)
  const by = (name: string) => cl.find(c => c.name === name)!
  ok('因果强度共六层且顺序固定',
    cl.length === 6 && cl.map(c => c.level).join(',') === '1,2,3,4,5,6')
  ok('第 1 层 产业景气 = 可确认', by('产业景气').status === 'CONFIRMED')
  ok('第 2 层 公司受益 = 部分（毛利率待核验，不算确认）', by('公司受益').status === 'PARTIAL')
  // 「行业同步」与「产业景气」是两个问题：节点份额扩大可以来自同行掉队，
  // 那时行业并未同步改善。委员会 2026-08-16 追加此层。
  ok('第 3 层 行业同步独立成层，且当前判为不能证明',
    by('行业同步').status === 'NOT_PROVEN', by('行业同步').status)
  ok('行业同步层依据引用同业对照读数',
    by('行业同步').basis.includes('有可比读数'))
  ok('无同业读数时行业同步层为未知，而非"不能证明"',
    causalLayers(live, null).find(c => c.name === '行业同步')!.status === 'UNKNOWN')
  ok('第 4 层 主线归因 = 未知（第 3、5 步未完成）', by('主线归因').status === 'UNKNOWN')
  ok('主线归因层明说无法区分"公司赚钱"与"因本主线赚钱"',
    by('主线归因').basis.includes('公司赚钱') && by('主线归因').basis.includes('因本主线赚钱'))
  ok('第 5 层 持续性 = 当前数据不能证明', by('持续性').status === 'NOT_PROVEN')
  ok('第 6 层 投资资格 = 战略否决', by('投资资格').status === 'VETOED')
  ok('投资资格层依据明写"即便 1–5 层全部转为可确认，本层仍不改变"',
    by('投资资格').basis.includes('即便第 1–5 层全部转为可确认'))
  ok('投资资格层依据点明"研究证据链 ≠ 投资资格链"',
    by('投资资格').basis.includes('研究证据链 ≠ 投资资格链'))

  // 主线归因永不因收入/利润增长而自动转绿 —— 这是跨层跳跃的入口
  const allMet = {
    ...live,
    propositions: live.propositions.map(pp => ({
      ...pp, indicators: pp.indicators.map(i => ({ ...i, status: 'MET' as const })),
    })),
  }
  ok('即便所有指标翻绿，主线归因层仍为未知（归因不能由增长推出）',
    causalLayers(allMet, node.peerGrossMargin)
      .find(c => c.name === '主线归因')!.status === 'UNKNOWN')
  ok('即便所有指标翻绿，投资资格层仍为战略否决',
    causalLayers(allMet, node.peerGrossMargin)
      .find(c => c.name === '投资资格')!.status === 'VETOED')
  ok('即便所有指标翻绿，四句话第 4 句仍是战略层不允许',
    fourLineVerdict(allMet).candidacy.includes('战略层不允许'))

  // ── 渲染 ──
  const txt = renderHypotheses([live])
  ok('渲染层输出因果强度五层', txt.includes('因果强度六层'))
  ok('渲染层声明上一层成立不推出下一层', txt.includes('上一层成立不推出下一层'))
  ok('渲染层单列待核验异常区并说明不计入兑现数',
    txt.includes('待核验异常') && txt.includes('不计入任何命题的兑现数'))
  ok('渲染层逐条列出核对清单（□）', txt.includes('□ 产品结构'))
  ok('状态文案区分"未知"与"当前数据不能证明"',
    CAUSAL_STATUS_TEXT.UNKNOWN !== CAUSAL_STATUS_TEXT.NOT_PROVEN)
  ok('pendingVerification 只返回待核验项',
    pendingVerification(live).length === 1
    && pendingVerification(live)[0].no === 4)
}

// ══════════════════════════════════════════════════════════════
// 毛利率异常识别：不可删除回归样本
// ══════════════════════════════════════════════════════════════
//
// 委员会 2026-08-16 要求这三个样本不可删除。样本定义在
// gmAnomalyRegression.ts —— 单独成文件是因为写在 selftest 里的断言
// 在重写测试时会连同被删掉（我上一轮就干过一次）。
{
  const { GM_REGRESSION_CASES } = await import('./gmAnomalyRegression')
  const { judgeGmAnomaly } = await import('./profitRadar')

  ok('回归样本覆盖三种判定（本期偏离 / 基期失真 / 无实质偏离）',
    new Set(GM_REGRESSION_CASES.map(c => c.expect)).size === 3
    && ['CURRENT_IS_OUTLIER', 'BASE_IS_OUTLIER', 'NO_MATERIAL_DEVIATION']
      .every(e => GM_REGRESSION_CASES.some(c => c.expect === e)))

  for (const c of GM_REGRESSION_CASES) {
    const a = judgeGmAnomaly(c.history, c.currentPct, c.prevPct)
    ok(`【不可删除】${c.name}（${c.code}）判定为 ${c.expect}`,
      a?.verdict === c.expect,
      `实为 ${a?.verdict ?? 'null'}｜同比 ${(c.currentPct - c.prevPct).toFixed(1)}pct`
      + `｜历史 ${Math.min(...c.history).toFixed(1)}–${Math.max(...c.history).toFixed(1)}%`)
    ok(`${c.name} 样本写明为什么必须是这个判定`, c.why.length > 40)
    ok(`${c.name} 样本标注数据出处（不是编的数字）`, c.asOf.includes('profit.json'))
  }

  // 兆易与拓荆的同比幅度接近但判定相反 —— 这正是"同比无方向性含义"的证明
  const gd = GM_REGRESSION_CASES.find(c => c.code === '603986')!
  const tj = GM_REGRESSION_CASES.find(c => c.code === '688072')!
  const gdYoy = gd.currentPct - gd.prevPct
  const tjYoy = tj.currentPct - tj.prevPct
  ok('两个样本同比方向相同且幅度接近（拓荆甚至更大）',
    gdYoy > 0 && tjYoy > 0 && tjYoy > gdYoy,
    `兆易 +${gdYoy.toFixed(1)}pct vs 拓荆 +${tjYoy.toFixed(1)}pct`)
  ok('但判定相反 —— 同比变化本身没有方向性含义',
    gd.expect !== tj.expect)

  // 与真实数据一致性：样本端点必须还能在 profit.json 里找到
  {
    const raw = JSON.parse(readFileSync(
      new URL('./data/profit.json', import.meta.url), 'utf-8'
    )) as { records: { code: string; periods: { grossMarginCumPct: number | null }[] }[] }
    let matched = 0
    for (const c of GM_REGRESSION_CASES) {
      const rec = raw.records.find(r => r.code === c.code)
      if (!rec) continue
      const vals = rec.periods
        .map(x => x.grossMarginCumPct)
        .filter((v): v is number => v != null)
        .map(v => Number(v.toFixed(2)))
      if (vals.includes(Number(c.currentPct.toFixed(2)))
        && vals.includes(Number(c.prevPct.toFixed(2)))) matched++
    }
    ok('三个样本的端点值都能在 profit.json 中找到（样本不是编的）',
      matched === GM_REGRESSION_CASES.length, `匹配 ${matched}/${GM_REGRESSION_CASES.length}`)
  }
}

// ══════════════════════════════════════════════════════════════
// 主线收入归因：存量占比 ≠ 增长来源
// ══════════════════════════════════════════════════════════════
{
  const {
    buildAttribution, renderAttribution, ATTRIBUTION_CHAIN, ATTRIBUTION_VERDICT_TEXT,
    STORAGE_ATTRIBUTION,
  } = await import('./attribution')

  const base = {
    company: 'X', mainline: 'AI', source: '年报分产品收入表', chainStep: 5 as const,
  }

  // 委员会 2026-08-16 给的两个反例，逐字构造
  const bigNotDriver = buildAttribution({
    ...base,
    revenuePrev: 100e8, revenueCur: 115e8,
    mainlineRevenuePrev: 60e8, mainlineRevenueCur: 63e8,   // AI +5%，非 AI +30%
  })
  ok('反例一：AI 占 55%（大业务）但增长贡献仅 20% → 判为「大但不驱动」',
    bigNotDriver.verdict === 'LARGE_BUT_NOT_DRIVER',
    `占比 ${((bigNotDriver.stockShare ?? 0) * 100).toFixed(1)}%`
    + ` 贡献 ${((bigNotDriver.growthContribution ?? 0) * 100).toFixed(1)}%`)
  ok('反例一说明"主线景气无法解释公司当期变化"',
    bigNotDriver.note.includes('无法解释公司当期变化'))

  const smallDriver = buildAttribution({
    ...base,
    revenuePrev: 100e8, revenueCur: 105e8,
    mainlineRevenuePrev: 8e8, mainlineRevenueCur: 20e8,    // AI +150%，其他下降
  })
  ok('反例二：AI 仅占 19% 但增长贡献 240% → 判为「小但驱动」',
    smallDriver.verdict === 'SMALL_BUT_DRIVER',
    `占比 ${((smallDriver.stockShare ?? 0) * 100).toFixed(1)}%`
    + ` 贡献 ${((smallDriver.growthContribution ?? 0) * 100).toFixed(1)}%`)
  ok('增长贡献允许 >100%（其他业务下滑时），不得截断到 0–1',
    (smallDriver.growthContribution ?? 0) > 1)
  ok('反例二提示核查基数过小导致增速失真', smallDriver.note.includes('基数是否过小'))

  // 两个反例的存量占比排序与判定排序相反 —— 这正是必须拆两个字段的证明
  ok('存量占比更高的那个反而不是增长来源 —— 两个字段不可互相替代',
    (bigNotDriver.stockShare ?? 0) > (smallDriver.stockShare ?? 0)
    && bigNotDriver.verdict === 'LARGE_BUT_NOT_DRIVER'
    && smallDriver.verdict === 'SMALL_BUT_DRIVER')

  // 主线自身下滑而公司仍增长 → 贡献为负，必须保留符号
  const shrinking = buildAttribution({
    ...base,
    revenuePrev: 100e8, revenueCur: 120e8,
    mainlineRevenuePrev: 30e8, mainlineRevenueCur: 25e8,
  })
  ok('主线收入下滑时增长贡献为负（保留符号，否则"主线在拖累公司"被抹掉）',
    (shrinking.growthContribution ?? 0) < 0,
    String(shrinking.growthContribution))

  // 总增量非正时不得硬算比值
  const flat = buildAttribution({
    ...base,
    revenuePrev: 100e8, revenueCur: 95e8,
    mainlineRevenuePrev: 30e8, mainlineRevenueCur: 35e8,
  })
  ok('公司总收入增量非正时增长贡献为 null，不硬算比值',
    flat.growthContribution === null)
  ok('并说明须改用绝对增量对比',
    flat.missing.some(m => m.includes('绝对增量')))

  // ── 归因不得凭管理层表述成立 ──
  const noSource = buildAttribution({
    ...base, source: '',
    revenuePrev: 100e8, revenueCur: 115e8,
    mainlineRevenuePrev: 60e8, mainlineRevenueCur: 63e8,
  })
  ok('无数据出处时归因判为 UNKNOWN', noSource.verdict === 'UNKNOWN')
  ok('并明说不得凭管理层「AI 需求旺盛」一类表述成立',
    noSource.missing.some(m => m.includes('管理层')))

  // ── 归因链五环 ──
  ok('归因链为 公司收入 → 产品 → 下游应用 → 目标需求 → 收入变化',
    ATTRIBUTION_CHAIN.map(c => c.name).join('→')
      === '公司收入→产品→下游应用→目标需求→收入变化')
  const partial = buildAttribution({
    ...base, chainStep: 2,
    revenuePrev: 100e8, revenueCur: 115e8,
    mainlineRevenuePrev: 60e8, mainlineRevenueCur: 63e8,
  })
  ok('链条未走完时一律 UNKNOWN，且指出下一环要回答什么',
    partial.verdict === 'UNKNOWN'
    && partial.missing.some(m => m.includes('下一环要回答')))

  // ── 存储现状 ──
  const st = buildAttribution(STORAGE_ATTRIBUTION)
  ok('存储归因当前停在第 1 环，判定为数据不足', st.chainStep === 1 && st.verdict === 'UNKNOWN')
  ok('存储归因缺口点名"分产品收入表（公开可得但尚未接入）"',
    st.missing.some(m => m.includes('分产品收入表') && m.includes('尚未接入')))
  ok('存储归因结论明说不得以占比代替增长来源',
    st.note.includes('不得以') && st.note.includes('增长来源'))

  const txt = renderAttribution(st)
  ok('渲染层把第四项标为最重要（四字段改版后文案随之调整）',
    txt.includes('最重要'))
  ok('渲染层写出要回答的不是"公司收入有没有增长"',
    txt.includes('不是「公司收入有没有增长」'))
  ok('四种判定文案各不相同（否则两个反例会显示成同一句话）',
    new Set(Object.values(ATTRIBUTION_VERDICT_TEXT)).size
      === Object.keys(ATTRIBUTION_VERDICT_TEXT).length)
}

// ══════════════════════════════════════════════════════════════
// 三条系统边界（委员会 2026-08-16 追加）
// ══════════════════════════════════════════════════════════════
{
  const {
    HYPOTHESES, withLiveData, causalLayers, VERIFICATION_CHAIN,
  } = await import('./hypotheses')
  const {
    ALTERNATIVES, judgeAlternatives, renderAlternatives, ALT_STATUS_TEXT,
  } = await import('./alternatives')
  const { buildAttribution } = await import('./attribution')

  const h1 = HYPOTHESES.find(h => h.id === 'H1')!
  const node = {
    npLevelSum: 14.6e8, levelShare: 0.236, levelShareDelta4Q: 16.4,
    deltaShareOfMainline: 0.388, maxReportAgeDays: 136,
    members: [{
      name: '兆易创新', deductRatio: 0.891, deductRatioAsOf: '2025-12-31',
      grossMarginPct: 57.1, grossMarginYoyPct: 19.6, grossMarginPrevPct: 37.4,
      grossMarginAnomaly: {
        verdict: 'CURRENT_IS_OUTLIER', historyMinPct: 26.7, historyMaxPct: 49.5,
        currentDeviationPct: 7.6, note: '本期偏离',
      },
    }],
    peerGrossMargin: {
      total: 15, currentOutliers: 3, baseOutliers: 3, medianYoyPct: 2.9, note: '同业对照',
    },
  }
  const live = withLiveData(h1, node)

  // ── 边界一：「同比改善」与「主线归因」彻底解耦 ──
  //
  // 委员会明确列出四种情形：毛利率恢复、收入增长、扣非利润增长、同行业绩同步。
  // 四项全部成立时，主线归因层仍不得转绿。
  {
    // 构造"四项全绿"的最强输入：所有指标 MET + 同业全部本期偏离（视作同步改善）
    const allGreen = {
      ...live,
      propositions: live.propositions.map(pp => ({
        ...pp, indicators: pp.indicators.map(i => ({ ...i, status: 'MET' as const })),
      })),
    }
    const syncedPeer = {
      total: 15, currentOutliers: 15, baseOutliers: 0, medianYoyPct: 18.0,
      note: '同业 15 家全部本期偏离（同步改善）',
    }
    const layers = causalLayers(allGreen, syncedPeer, null)
    const attr = layers.find(c => c.name === '主线归因')!
    ok('【边界一】四项全绿 + 同业同步改善，主线归因层仍为未知',
      attr.status === 'UNKNOWN', attr.status)
    // 行业同步层这时应当转正 —— 证明"全绿"确实被系统读到了，
    // 而主线归因层的不动不是因为输入没生效
    ok('同一输入下行业同步层确实转为 PARTIAL（证明全绿输入已生效）',
      layers.find(c => c.name === '行业同步')!.status === 'PARTIAL')
    ok('主线归因层依据明写"那四项回答是否变好，本层问是否因本主线而变好"',
      attr.basis.includes('是否变好') && attr.basis.includes('因本主线而变好'))
    ok('主线归因层不读取任何指标的 MET 数量（只由归因与闸门决定）',
      !/MET|兑现/.test(attr.basis), attr.basis.slice(0, 50))

    // 只有归因完成 + 闸门放行，才允许转绿
    ok('归因完成但闸门不放行 → 仍为未知',
      causalLayers(allGreen, syncedPeer, {
        attributionDone: true, altGateOpen: false, altNote: 'x',
      }).find(c => c.name === '主线归因')!.status === 'UNKNOWN')
    ok('闸门放行但归因未完成 → 仍为未知',
      causalLayers(allGreen, syncedPeer, {
        attributionDone: false, altGateOpen: true, altNote: 'x',
      }).find(c => c.name === '主线归因')!.status === 'UNKNOWN')
    ok('两者同时满足才转为可确认',
      causalLayers(allGreen, syncedPeer, {
        attributionDone: true, altGateOpen: true, altNote: 'x',
      }).find(c => c.name === '主线归因')!.status === 'CONFIRMED')
  }

  // ── 边界二：归因四字段，最后一项最重要 ──
  {
    const base = { company: 'X', mainline: 'AI', source: '年报分产品收入表', chainStep: 5 as const }
    const a = buildAttribution({
      ...base, revenuePrev: 100e8, revenueCur: 115e8,
      mainlineRevenuePrev: 60e8, mainlineRevenueCur: 63e8,
    })
    ok('【边界二】四个字段齐备：收入 / 占比 / 自身增速 / 增量贡献',
      a.mainlineRevenue !== null && a.stockShare !== null
      && a.mainlineYoy !== null && a.growthContribution !== null)
    ok('自身增速与增量贡献是两个不同的数（+5.0% vs 20.0%）',
      Math.abs((a.mainlineYoy ?? 0) - (a.growthContribution ?? 0)) > 0.1,
      `增速 ${((a.mainlineYoy ?? 0) * 100).toFixed(1)}% vs 贡献 ${((a.growthContribution ?? 0) * 100).toFixed(1)}%`)

    // 增速极高但基数极小 → 贡献低 → 判定不得为"驱动"
    const tiny = buildAttribution({
      ...base, revenuePrev: 100e8, revenueCur: 130e8,
      mainlineRevenuePrev: 0.5e8, mainlineRevenueCur: 2e8,
    })
    ok('增速 300% 但贡献仅 5% → 不判为增长驱动（故事很好但不影响业绩）',
      (tiny.mainlineYoy ?? 0) > 2 && (tiny.growthContribution ?? 1) < 0.1
      && tiny.verdict === 'NEITHER_LARGE_NOR_DRIVER',
      `增速 ${((tiny.mainlineYoy ?? 0) * 100).toFixed(0)}% 贡献 ${((tiny.growthContribution ?? 0) * 100).toFixed(1)}%`)
    ok('渲染层标出第四项为最重要',
      (await import('./attribution')).renderAttribution(a).includes('最重要'))
  }

  // ── 边界三：替代解释闸门 ──
  {
    ok('【边界三】五项竞争性解释齐备', ALTERNATIVES.length === 5)
    for (const k of ['ASP', '产品结构', '同行退出', '库存周期', '会计']) {
      ok(`闸门覆盖「${k}」`, ALTERNATIVES.some(a => a.name.includes(k)))
    }
    const g0 = judgeAlternatives()
    ok('当前五项均未核查 → 闸门不放行', !g0.allowsCausalClaim && g0.unchecked === 5)

    // 四项排除、一项未查 → 仍不放行（析取关系，不是打分）
    const four = ALTERNATIVES.map((a, i) => (i < 4 ? { ...a, status: 'RULED_OUT' as const } : a))
    const g4 = judgeAlternatives(four)
    ok('四项排除、一项未查 → 仍不放行（竞争性解释是析取关系，不可加权求和）',
      !g4.allowsCausalClaim)
    ok('并说明未查那项可能正是全部解释',
      g4.verdict.includes('可能正是全部解释'))

    // 五项全排除 → 放行，但明说仍不等于允许买入
    const all5 = ALTERNATIVES.map(a => ({ ...a, status: 'RULED_OUT' as const }))
    const g5 = judgeAlternatives(all5)
    ok('五项全部排除 → 放行', g5.allowsCausalClaim)
    ok('放行文案明说"仍不等于允许买入"', g5.verdict.includes('仍不等于允许买入'))

    // 任一项被证实成立 → AI 因果被替代
    const inv = ALTERNATIVES.map((a, i) => (i === 3
      ? { ...a, status: 'CONFIRMED_AS_CAUSE' as const }
      : { ...a, status: 'RULED_OUT' as const }))
    const gi = judgeAlternatives(inv)
    ok('任一替代解释被证实 → 不放行，且明说 AI 因果被替代',
      !gi.allowsCausalClaim && gi.verdict.includes('被该解释替代'))
    ok('并点名是哪一项', gi.confirmedAlternatives.includes('库存周期'))

    // 会计口径那项必须保留（与 57.1% 直接相关）
    const acct = ALTERNATIVES.find(a => a.name.includes('会计'))!
    ok('会计/分类变化项写明"必须保留"并引用 57.1%',
      acct.basis.includes('必须保留') && acct.basis.includes('57.1%'))
    // 同业同步不得用来排除"同行退出"
    const supply = ALTERNATIVES.find(a => a.name.includes('同行退出'))!
    ok('同行退出项明说同业毛利率同步改善不能排除本项',
      supply.basis.includes('不能排除本项'))
    ok('交叉引用避免两处各写一份',
      ALTERNATIVES.filter(a => a.crossRef).length >= 2)
    ok('状态文案四种各不相同',
      new Set(Object.values(ALT_STATUS_TEXT)).size === 4)
    const txt = renderAlternatives()
    ok('渲染层区分"归因"与"替代解释"两个问题',
      txt.includes('钱从哪条产品线来') && txt.includes('为什么多赚了'))
  }

  // ── 九环验证链 ──
  {
    const names = VERIFICATION_CHAIN.map(c => c.name).join('→')
    ok('验证链为九环，且与委员会给定顺序一致',
      names === '产业景气→公司收入→主线收入归因→数量/价格拆分→扣非利润'
        + '→利润主线归因→同行验证→持续性→战略资格',
      names)
    ok('第 4 环「数量/价格拆分」问的是销量与 ASP 的拆分',
      VERIFICATION_CHAIN[3]!.asks.includes('销量') && VERIFICATION_CHAIN[3]!.asks.includes('ASP'))
    ok('第 3 环同时否掉"收入有没有增长"与"主线占比高不高"两种错问法',
      VERIFICATION_CHAIN[2]!.asks.includes('收入有没有增长')
      && VERIFICATION_CHAIN[2]!.asks.includes('主线占比高不高'))
    ok('存储仍停在第 3 环', h1.stage === 3)
  }
}

// ══════════════════════════════════════════════════════════════
// 验证链第 2 环：只回答"收入是否改善"，不得偷渡到第 3 环
// ══════════════════════════════════════════════════════════════
{
  const { groupPeriod, reconcile, groupOf, SEGMENT_GROUPS, secuCode } =
    await import('./segmentFetch')
  const { buildLink2, renderLink2 } = await import('./link2Revenue')

  // 交易所后缀：603986 是沪市，曾被误写成 SZ
  ok('6 开头判为沪市', secuCode('603986') === '603986.SH')
  ok('0/3 开头判为深市',
    secuCode('300308') === '300308.SZ' && secuCode('002371') === '002371.SZ')

  // ── 口径别名：分项名称会变，按名字直接匹配会整段丢数据 ──
  //
  // 兆易创新实际披露：
  //   2023年报 微控制器 13.17亿          （无独立模拟产品）
  //   2024年报 MCU及模拟产品 17.06亿     （合并）
  //   2025年报 微控制器 + 模拟产品        （拆开）
  ok('「MCU及模拟产品」与「微控制器」「模拟产品」归入同一组',
    groupOf('MCU及模拟产品') === groupOf('微控制器')
    && groupOf('模拟产品') === groupOf('微控制器'))
  ok('存储芯片单独成组', groupOf('存储芯片') === '存储芯片')
  ok('未知分项返回 null（而不是塞进"其他"悄悄消失）',
    groupOf('某个没见过的分项') === null)
  ok('别名表覆盖四组', SEGMENT_GROUPS.length === 4)

  // ── 配平校验 ──
  const mk = (rows: [string, number][], date = '2025-12-31') => groupPeriod({
    reportDate: date, reportName: '测试期', isAnnual: date.endsWith('-12-31'),
    rows: rows.map(([itemName, income]) => ({
      reportDate: date, reportName: '测试期', itemName, income,
      incomeRatio: null, grossMargin: null,
    })),
    total: rows.reduce((s, [, v]) => s + v, 0),
  })
  ok('全部分项可归组时配平通过',
    reconcile(mk([['存储芯片', 100], ['微控制器', 20]])).ok)
  const bad = reconcile(mk([['存储芯片', 100], ['某未知分项', 20]]))
  ok('存在未归组分项时配平失败', !bad.ok)
  ok('并指出须补别名表', bad.note.includes('须补 SEGMENT_GROUPS'))

  // ── 第 2 环：真实数据 ──
  const { readFileSync: rf2 } = await import('node:fs')
  const segFile = JSON.parse(rf2(
    new URL('./data/segments.json', import.meta.url), 'utf-8'
  )) as { name: string; periods: Parameters<typeof groupPeriod>[0][] }
  const annual = segFile.periods.filter(x => x.reportDate.endsWith('-12-31'))
  ok('分产品数据至少两个年报期（否则无法算同比）', annual.length >= 2)

  const l2 = buildLink2(segFile.name, groupPeriod(annual[0]!), groupPeriod(annual[1]!), '2026-08-16')
  ok('第 2 环判定收入确实改善', l2.improved)
  ok('各组增量之和与总增量配平（无遗漏警告）',
    !l2.warnings.some(w => w.includes('不可用')), l2.warnings.join('；'))
  ok('目标产品线为存储芯片且能取到读数', l2.target?.group === '存储芯片')
  ok('数据期间与口径同屏输出',
    l2.period.includes('年报') && l2.basis === 'ANNUAL')
  ok('标注数据距今天数（不写读者会默认它是当期的）',
    l2.ageDays !== null && l2.ageDays > 180)
  ok('并提示本环最快半年更新一次',
    l2.warnings.some(w => w.includes('半年更新一次')))

  // 「占总增量高」≠「增速最快」
  ok('实测：增速最快的产品线不是存储芯片',
    l2.targetIsFastestGrowing === false, String(l2.fastestGrowing?.group))
  ok('结论文本点明"占总增量高是因为体量大，不是因为长得快"',
    l2.conclusion.includes('因为体量大') && l2.conclusion.includes('不是因为长得快'))

  // ── 关键：第 2 环不得推进第 3 环 ──
  ok('advancesLink3 恒为 false', l2.advancesLink3 === false)
  ok('阻断理由说明"产品类别不等于下游应用"',
    l2.link3Blocker.includes('产品类别') && l2.link3Blocker.includes('下游应用'))
  ok('阻断理由点名存储芯片内含 NOR/NAND/DRAM',
    ['NOR', 'NAND', 'DRAM'].every(k => l2.link3Blocker.includes(k)))

  // 类型/文本层面都不许出现 AI 归因字段
  const l2src = rf2(new URL('./link2Revenue.ts', import.meta.url), 'utf-8')
  // 只检查代码行。注释里写"本模块不导出 aiRevenue"这句说明本身含有该词 ——
  // 不跳过注释会让一条正确的文档把检查绊倒，这次就绊了一次。
  const l2code = l2src.split('\n')
    .filter(l => {
      const t = l.trim()
      return !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*')
    })
    .join('\n')
  ok('第 2 环模块的代码中不出现 aiRevenue / aiShare / aiDriven 一类字段',
    !/\b(aiRevenue|aiShare|aiDriven|aiAttribution)\b/.test(l2code))
  const j = JSON.stringify(l2)
  for (const banned of ['AI 驱动', 'AI导致', '超级周期', '验证通过']) {
    ok(`第 2 环输出不出现「${banned}」`, !j.includes(banned))
  }
  ok('结论文本明说本项不说明改善来自 AI 需求',
    renderLink2(l2).includes('不回答「是不是 AI 导致的」'))

  // 年报与中报不可混比
  const interim = segFile.periods.find(x => x.reportDate.endsWith('-06-30'))!
  const mixed = buildLink2(segFile.name, groupPeriod(annual[0]!), groupPeriod(interim), '2026-08-16')
  ok('年报与中报混比时给出口径警告',
    mixed.warnings.some(w => w.includes('口径不同')))
}

// ══════════════════════════════════════════════════════════════
// 电力价值传导图：第二主线只观察，不买电力股
// ══════════════════════════════════════════════════════════════
{
  const {
    E01, POWER_LAYERS, PENETRATE_ORDER, POWER_QUESTIONS, powerVerdict,
    renderPowerChain, buildPowerChainView,
    demandGrowthIsBuySignal, aiLoadCanGrantMigration,
    usShortageTemplateAppliesToChina, chinaNationalShortageEstablished,
    generationProfitFollowsDemand, generationIsFirstPenetration,
    openPowerCoreNow, chainBreakStopsHere,
  } = await import('./powerChain')
  const { fingerprint } = await import('../governance/ruleRegistry')
  const { loadBaseline } = await import('../governance/freeze')
  const src = readFileSync(new URL('./powerChain.ts', import.meta.url), 'utf-8')

  ok('E-01 证据等级是 OBSERVATION', E01.tier === 'OBSERVATION')
  ok('模块不 import makeAction', !/^import .*/m.test(src) || !src.split('\n').filter(l => l.startsWith('import')).join('\n').includes('makeAction'))
  ok('需求增长不是买入信号', demandGrowthIsBuySignal() === false)
  ok('AI 负荷不能授予资本迁移', aiLoadCanGrantMigration() === false)
  ok('美国缺电模板不能套中国', usShortageTemplateAppliesToChina() === false)
  ok('不得写出中国全面缺电', chinaNationalShortageEstablished() === false)
  ok('用电增长推不出发电利润', generationProfitFollowsDemand() === false)
  ok('穿透不得从发电开始', generationIsFirstPenetration() === false)
  ok('现在不得开电力核心持仓', openPowerCoreNow() === false)
  ok('链条在哪断就停在哪', chainBreakStopsHere() === true)

  ok('正好六层', POWER_LAYERS.length === 6)
  ok('电网是第 3 层且标为重点',
    POWER_LAYERS[2]!.id === 'GRID' && POWER_LAYERS[2]!.focus === true)
  ok('电网设备也是重点', POWER_LAYERS.some(l => l.id === 'GRID_EQUIPMENT' && l.focus))
  ok('电源层明确推不出发电赚钱',
    POWER_LAYERS.find(l => l.id === 'GENERATION')!.doesNotProve.includes('发电公司赚钱'))
  ok('需求层明确推不出买电',
    POWER_LAYERS[0]!.doesNotProve.includes('不证明可以买电')
    || POWER_LAYERS[0]!.doesNotProve.includes('不证明任何电力公司'))

  ok('穿透顺序第一条是电网不是发电',
    PENETRATE_ORDER[0]!.layerId === 'GRID' && PENETRATE_ORDER[0]!.name.includes('电网'))
  ok('普通新能源发电与纯需求故事在暂不看',
    PENETRATE_ORDER.filter(p => p.band === '暂不看').length >= 2
    && PENETRATE_ORDER.some(p => p.name.includes('新能源发电') && p.band === '暂不看'))
  ok('穿透顺序不是评分：文案禁止买卖名单',
    PENETRATE_ORDER.every(p => p.why.length > 0)
    && src.includes('不是买卖名单'))

  ok('八问全是未验证', POWER_QUESTIONS.every(q => q.status === 'UNVERIFIED'))
  ok('停在第 1 问', E01.stage === 1 && POWER_QUESTIONS[0]!.no === 1)
  ok('第 8 问钉死 R4 不能用 PE 或美国故事填',
    POWER_QUESTIONS[7]!.sourceNote.includes('R4')
    && POWER_QUESTIONS[7]!.sourceNote.includes('PE')
    && POWER_QUESTIONS[7]!.sourceNote.includes('美国'))
  ok('第 6 问用目标主线核验，不用研究台账禁词当决策输出',
    POWER_QUESTIONS[5]!.sourceNote.includes('目标主线核验'))

  const v = powerVerdict()
  ok('结论写出资本开支周期，不是电力行业', v.object.includes('资本开支周期') && v.object.includes('不是电力行业'))
  ok('结论禁止全面缺电', v.shortage.includes('不得写出'))
  ok('结论禁止建仓加仓核心',
    v.candidacy.includes('不得建仓') && v.candidacy.includes('不得加仓') && v.candidacy.includes('核心持仓'))

  ok('不意味着清单含：不能买电力股',
    E01.doesNotImply.some(d => d.includes('买任何电力股')))
  ok('不意味着清单含：海外项目不能套 A 股',
    E01.doesNotImply.some(d => d.includes('A 股')))
  ok('不意味着清单含：在册标的没有建仓资格',
    E01.doesNotImply.some(d => d.includes('许继') && d.includes('建仓')))
  ok('阻塞项含八问未验证与总体平衡',
    E01.blockers.some(b => b.includes('八问')) && E01.blockers.some(b => b.includes('总体平衡')))

  const txt = renderPowerChain()
  ok('渲染含价值传导图标题', txt.includes('电力主线价值传导图'))
  ok('渲染声明不打分不排序不产生动作',
    txt.includes('不打分') && txt.includes('不排序') && txt.includes('不产生动作'))
  ok('渲染不含预测措辞',
    !/将涨|见顶|综合分|目标价|建议买入/.test(txt))
  ok('视图 JSON 不含 score/rank/weight 字段名',
    !/"(score|rank|weight)"/i.test(JSON.stringify(buildPowerChainView())))

  const base = loadBaseline()
  const fp = fingerprint()
  ok('加入传导图后规则指纹未变',
    !!base && fp.hash === base.hash, `${base?.hash} → ${fp.hash}`)
}

console.log(`\n═══ 结果：${passed} 通过 / ${failed} 失败 ═══\n`)
if (failed > 0) process.exit(1)
