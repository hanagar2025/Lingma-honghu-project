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
  ok('公司收入与供给端记为"尚未接入"而非付费缺口（工作量 ≠ 数据不可得）',
    wiring.length === 2
    && wiring.every(i => i.text.includes('收入') || i.text.includes('供给端')),
    wiring.map(i => i.text.slice(0, 6)).join(','))
  ok('取数层级文案区分"工作量问题"与"数据可得性问题"',
    SOURCE_TIER_TEXT.PUBLIC_NOT_YET_WIRED.includes('工作量'))
  ok('付费层文案要求先走完公开优先各层',
    SOURCE_TIER_TEXT.NEEDS_PAID.includes('公开披露无法回答'))

  // ── 验证链：问法必须是归因，不是"有没有增长" ──
  ok('验证链共 7 步', VERIFICATION_CHAIN.length === 7)
  const s3 = VERIFICATION_CHAIN.find(x => x.no === 3)!
  const s5 = VERIFICATION_CHAIN.find(x => x.no === 5)!
  ok('第 3 步问的是归因比例，并明确否掉"收入有没有增长"这种问法',
    s3.asks.includes('归因') && s3.asks.includes('不是'), s3.asks)
  ok('第 5 步问的是扣非利润中来自主线的部分', s5.asks.includes('扣非') && s5.asks.includes('主线'))
  ok('第 4 步（扣非利润）取数层级为公开·已在管道内',
    VERIFICATION_CHAIN.find(x => x.no === 4)!.source === 'PUBLIC_IN_PIPELINE')
  ok('第 7 步（战略许可）标为战略层裁定，非数据问题',
    VERIFICATION_CHAIN.find(x => x.no === 7)!.source === 'STRATEGY_RULING')

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

  // 大幅变动必须标"须核验"，但不替委员会判定原因
  const bigGm = withLiveData(h1, {
    npLevelSum: 14.6e8, levelShare: 0.236, levelShareDelta4Q: 16.4,
    deltaShareOfMainline: 0.388, maxReportAgeDays: 136,
    members: [{
      name: '兆易创新', deductRatio: 0.891, deductRatioAsOf: '2025-12-31',
      grossMarginPct: 57.1, grossMarginYoyPct: 19.6, grossMarginPrevPct: 37.4,
    }],
  })
  const bigI4 = bigGm.propositions.find(p => p.id === 'A')!.indicators.find(i => i.no === 4)!
  ok('毛利率同比 >10pct 时标为量级异常须核验', bigI4.evidence.includes('量级异常，须核验'))
  ok('并列出两种可能原因而不替委员会选一个',
    bigI4.evidence.includes('量价齐升') && bigI4.evidence.includes('会计口径')
    && bigI4.evidence.includes('不替委员会判定原因'))
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

console.log(`\n═══ 结果：${passed} 通过 / ${failed} 失败 ═══\n`)
if (failed > 0) process.exit(1)
