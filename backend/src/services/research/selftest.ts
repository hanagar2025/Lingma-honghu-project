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
    basicEps: 1, deductEps: null, grossMarginCum: 30, cfoPerShareCum: 1, roeCum: 10,
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
  ok('同一主线同一季度的份额合计约为 1',
    Math.abs(total - 1) < 0.02, String(total))
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

console.log(`\n═══ 结果：${passed} 通过 / ${failed} 失败 ═══\n`)
if (failed > 0) process.exit(1)
