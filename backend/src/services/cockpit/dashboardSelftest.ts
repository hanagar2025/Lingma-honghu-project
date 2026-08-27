// 五层驾驶舱自检
//
// 只测四件事，全部是"系统会不会越权"，不测"判断准不准"：
//   一、禁止综合评分 —— 遍历整个 JSON，任何一行不得带总分/星级字段
//   二、「不可判断」是合法输出 —— 数据不足的主线，即使价格在涨也不得输出强弱结论
//   三、装配层不生产动作 —— 四张研究表与动作区严格隔离
//   四、战略层闸门 —— 全部在册标的被清退的节点，不得被输出为"最值得研究"
//
// 运行：npx tsx backend/src/services/cockpit/dashboardSelftest.ts

import { readFileSync } from 'node:fs'
import type { DailyBar, Position } from '../tios/types'
import { runMsr } from '../msr'
import { MAINLINES } from '../msr/universe'
import { buildProfitMap, type ProfitMap } from '../research/profitRadar'
import {
  buildDashboard, findProfitNodeMismatches, judgeStructure,
  type Dashboard, type DashboardInput, type NodeStructureRow,
} from './dashboard'
import { renderDashboard } from './renderDashboard'
import { buildVerdict } from './verdict'
import { renderVerdict } from './renderVerdict'
import { ACTION_TEXT, FORBIDDEN_REASON_PHRASES } from './types'
import { buildLookoutView, renderLookout } from './lookout'

let failed = 0
let passed = 0

function ok(name: string, cond: boolean, extra = ''): void {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.error(`  ✗ ${name} ${extra}`) }
}

function seqDate(i: number): string {
  return new Date(Date.UTC(2025, 0, 6) + i * 86400000).toISOString().slice(0, 10)
}

function bars(n: number, from: number, drift: number, vol = 1_000_000): DailyBar[] {
  const out: DailyBar[] = []
  let px = from
  for (let i = 0; i < n; i++) {
    const prev = px
    px = px * (1 + drift)
    out.push({
      date: seqDate(i), open: prev, high: Math.max(prev, px) * 1.01,
      low: Math.min(prev, px) * 0.99, close: px, volume: vol,
    })
  }
  return out
}

console.log('\n═══ 五层驾驶舱自检 ═══\n')

// ── 构造输入 ──
const barsByCode: Record<string, DailyBar[]> = {}
for (const ml of MAINLINES) {
  for (const m of ml.members) barsByCode[m.code] = bars(200, 20, 0.002)
}
const indexBarsByCode: Record<string, DailyBar[]> = {}
for (const ml of MAINLINES) indexBarsByCode[ml.benchmark] = bars(200, 1000, 0.001)
indexBarsByCode['sz399006'] = bars(200, 2000, 0.0005)

const positions: Position[] = [
  { code: '300308', name: '中际旭创', sector: '通信设备', theme: 'AI', cost: 300000, marketValue: 400000 },
  { code: '688041', name: '海光信息', sector: '半导体', theme: 'AI', cost: 500000, marketValue: 900000 },
  { code: '603986', name: '兆易创新', sector: '半导体', theme: 'AI', cost: 100000, marketValue: 90000 },
]
const portfolioTotal = 3_000_000

const msr = runMsr({
  date: '2026-08-13', barsByCode, indexBarsByCode, pendingSellCount: 7, marketAllows: false,
})

let profit: ProfitMap | null = null
try { profit = buildProfitMap('2026-08-13') } catch { /* 需先跑 profit:fetch */ }

const baseInput: DashboardInput = {
  date: '2026-08-13', session: 'POST_CLOSE', positions, portfolioTotal,
  barsByCode, indexBarsByCode, marketBars: indexBarsByCode['sz399006'],
  momentumRows: [
    {
      code: '300308', name: '中际旭创', reviewTriggers: ['收于MA20下方', '20日跑输行业14.4%'],
      legalReason: null, metrics: [], triggerCount: 2,
    },
    {
      code: '688041', name: '海光信息', reviewTriggers: ['收于MA60下方'],
      legalReason: '仓位19.0% > 上限12.0%，超出7.0pct', metrics: [], triggerCount: 1,
    },
    {
      code: '603986', name: '兆易创新',
      reviewTriggers: ['C级清退标的仍在持仓，退出须走冠军替换四步程序（战略层裁定，非本系统自动执行）'],
      legalReason: null, metrics: [], triggerCount: 1,
    },
  ],
  msr, profit, actions: [], pendingSellCount: 7,
  noNewEntryReasons: ['执行债务未清：7条卖出指令未执行'],
  // 家庭刚性支出已于 2026-08-15 裁定排除，不再是数据缺口。
  // 换成一个真实仍缺的项，以确保"缺口机制本身"仍被测到。
  dataGaps: ['3只标的PE分位不可用（TTM亏损或PE极端）'],
}

const dash = buildDashboard(baseInput)

// ───────────────────────────────────────────────────────────────
console.log('【不变量一】禁止综合评分')

/** 递归找出所有疑似"合成分数"的键 */
function findScoreKeys(obj: unknown, path = ''): string[] {
  const bad: string[] = []
  if (Array.isArray(obj)) {
    obj.forEach((v, i) => bad.push(...findScoreKeys(v, `${path}[${i}]`)))
    return bad
  }
  if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      if (/^(score|totalScore|rating|stars|综合分|总分|星级)$/i.test(k)) bad.push(`${path}.${k}`)
      bad.push(...findScoreKeys(v, `${path}.${k}`))
    }
  }
  return bad
}
const scoreKeys = findScoreKeys(dash)
ok('驾驶舱 JSON 不含任何 score/rating/总分/星级 字段', scoreKeys.length === 0, scoreKeys.join(', '))
ok('随报告输出"不做综合评分"的声明', dash.noCompositeScoreNote.includes('不输出主线综合评分'))
ok('主线表每列独立呈现（趋势/相对强度/成交/利润/龙头/完整度各自成列）',
  dash.mainlines.every(m =>
    'trend' in m && 'relStrength' in m && 'volumeProxy' in m &&
    'profitStructure' in m && 'leaderStatus' in m && 'completeness' in m))

// ───────────────────────────────────────────────────────────────
console.log('\n【不变量二】「不可判断」是合法输出')

if (profit) {
  const power = dash.mainlines.find(m => m.mainlineId === 'power')
  ok('AI电力三项验证0/6 → judgable=false', power?.judgable === false)
  ok('不可判断时 verdict 明写"不具备机会判断资格"',
    !!power?.verdict.includes('不具备机会判断资格'), power?.verdict)
  ok('不可判断时 verdict 不含"主线未失效"等强弱结论',
    !power?.verdict.includes('未失效') && !power?.verdict.includes('更强'), power?.verdict)
  ok('不可判断时利润结构列显示 ? 而非方向箭头', power?.profitStructure === '?')
  ok('不可判断的主线进入"禁止动作"区',
    dash.actionZone.forbidden.some(f => f.label.includes('AI电力') && f.label.includes('禁止做主线切换判断')))
}

// 即使趋势为 ↑↑，不可判断的主线也不得输出"正在成为下一主线"
const risingPower: DashboardInput = {
  ...baseInput,
  indexBarsByCode: { ...indexBarsByCode, ...Object.fromEntries(
    MAINLINES.filter(m => m.id === 'power').map(m => [m.benchmark, bars(200, 1000, 0.01)])
  ) },
}
const dash2 = buildDashboard(risingPower)
const power2 = dash2.mainlines.find(m => m.mainlineId === 'power')
if (profit) {
  ok('注入强上涨后 AI电力趋势变为向上', power2?.trend === '↑↑' || power2?.trend === '↑', power2?.trend)
  ok('趋势向上但数据不足 → 仍然不可判断（价格不能替代产业验证）', power2?.judgable === false)
  ok('趋势向上但数据不足 → verdict 里没有"下一主线"字样',
    !power2?.verdict.includes('下一主线'), power2?.verdict)
}

// 缺失一律显示"缺失"，不显示 0
const noProfit = buildDashboard({ ...baseInput, profit: null })
ok('利润地图缺失时 completeness 为 null（不是0）',
  noProfit.mainlines.every(m => m.completeness === null))
ok('利润地图缺失时全部主线判为不可判断',
  noProfit.mainlines.every(m => !m.judgable))
ok('利润地图缺失时市场结构判断为 UNKNOWN', noProfit.marketStructure.kind === 'UNKNOWN')
ok('利润地图缺失时禁止做主线切换判断',
  noProfit.marketStructure.switchEvidence.includes('禁止做主线切换判断'))

// ───────────────────────────────────────────────────────────────
console.log('\n【不变量三】装配层不生产动作')

const src = (await import('node:fs')).readFileSync(
  new URL('./dashboard.ts', import.meta.url), 'utf-8'
)
ok('dashboard.ts 不调用 makeAction（装配层无权造动作）', !/\bmakeAction\s*\(/.test(src))
ok('动作区的动作全部来自入参 actions',
  dash.actionZone.mustExecute.filter(m => !m.label.startsWith('执行债务')).length === 0,
  '入参 actions 为空时不应出现减仓项')
ok('下一观察层每行 actionAllowed 恒为 false',
  dash.nextLayer.every(r => r.actionAllowed === false))
ok('下一观察层每行都写明阻断项', dash.nextLayer.every(r => r.actionBlockedBy.length > 0))
ok('下一观察层阶段词只有"观察"或"研究"（无"候选"以上级别）',
  dash.nextLayer.every(r => r.stage === '观察' || r.stage === '研究'))
ok('市场结构判断不得产生动作', dash.marketStructure.canGenerateAction === false)
ok('执行债务>0 时每个观察节点都列出债务阻断',
  dash.nextLayer.every(r => r.actionBlockedBy.some(b => b.includes('执行债务'))))
ok('Money Radar 恒为不可得（不用价格代理冒充资金验证）',
  dash.nextLayer.every(r => r.money === '?' && r.gates.moneyRadar === null))

// 预测性措辞不得出现在任何输出文本里
const allText = JSON.stringify(dash)
const leaked = FORBIDDEN_REASON_PHRASES.filter(p => allText.includes(p))
ok('驾驶舱全文不含预测性措辞', leaked.length === 0, leaked.join('、'))

// ───────────────────────────────────────────────────────────────
console.log('\n【不变量四】战略层闸门（兆易创新案例）')

if (profit) {
  const storage = dash.nextLayer.find(r => r.node === '存储')
  ok('存储节点被识别（份额在扩大）', storage !== undefined)
  ok('存储节点唯一在册标的为C级清退 → strategyAllows=false',
    storage?.strategyAllows === false, JSON.stringify(storage?.retiredMembers))
  ok('清退标的被具名列出', storage?.retiredMembers.includes('兆易创新') === true)
  ok('战略层不允许时列入阻断项',
    storage?.actionBlockedBy.some(b => b.includes('战略层不允许')) === true)
  ok('清退节点不进入"允许研究"清单',
    !dash.actionZone.allowedResearch.some(r => r.label.startsWith('存储')))
  ok('清退节点不被输出为"今日最值得研究"',
    !dash.headline.mostWorthResearching.includes('兆易创新'), dash.headline.mostWorthResearching)
  ok('清退节点改为记入"禁止动作"（覆盖缺口，不是藏起来）',
    dash.actionZone.forbidden.some(f => f.label.includes('存储') && f.detail.includes('冠军替换')))
  // 覆盖缺口 ≠ 战略否决：两者需要的后续动作完全不同（补标的 vs 走冠军替换）
  const noMember = dash.nextLayer.filter(r => r.members.length === 0)
  ok('存在无在册标的的节点（覆盖缺口）', noMember.length > 0)
  ok('无在册标的的节点阻断原因写"无在册标的"而非"战略层不允许"',
    noMember.every(r =>
      r.actionBlockedBy.some(b => b.includes('无在册标的')) &&
      !r.actionBlockedBy.some(b => b.includes('战略层不允许'))))
  const rendered = renderDashboard(dash)
  ok('文本渲染把覆盖缺口与战略否决标成两种不同标记',
    rendered.includes('⚠无在册标的') && rendered.includes('⚠战略层不允许'))
  ok('允许研究项均通过战略层闸门',
    dash.nextLayer.filter(r => dash.actionZone.allowedResearch.some(a => a.label.startsWith(r.node)))
      .every(r => r.strategyAllows))
}

// ───────────────────────────────────────────────────────────────
console.log('\n【节点命名一致性】')

ok('全部在册标的都能在利润结构地图中找到对应节点',
  findProfitNodeMismatches(profit).length === 0,
  findProfitNodeMismatches(profit).join('；'))

// ───────────────────────────────────────────────────────────────
console.log('\n【产业结构表 A/B/C 三变量】')

if (profit) {
  const optical = dash.nodeStructure['optical']
  ok('光通信产业结构表非空', (optical?.length ?? 0) > 0)
  ok('每行同时给出 A利润规模 / B存量份额 / C份额变化 三列',
    optical.every(r => 'npLevel' in r && 'levelShare' in r && 'delta4Q' in r))
  ok('按存量份额降序（回答"钱现在在哪里"）',
    optical.every((r, i) => i === 0 || (optical[i - 1].levelShare ?? -1) >= (r.levelShare ?? -1)))
  const mod = optical.find(r => r.node === '光模块')
  ok('首位节点是光模块', optical[0].node === '光模块', optical[0].node)
  ok('光模块份额四季扩大（+10.2pct 量级）', (mod?.delta4Q ?? 0) > 5, String(mod?.delta4Q))
  ok('光模块列出节点内领先公司及其份额',
    (mod?.leaders.length ?? 0) >= 2 && mod!.leaders[0].shareWithinNode !== null)
  ok('节点内领先公司按份额降序',
    mod!.leaders.every((l, i) => i === 0 || (mod!.leaders[i - 1].shareWithinNode ?? 0) >= (l.shareWithinNode ?? 0)))
  const cw = optical.find(r => r.node === '光芯片/CW激光器')
  ok('份额扩大但水平极低的节点标为"↑早期"', cw?.direction === '↑早期', cw?.direction)
  ok('源杰所在节点份额仍在个位数以下', (cw?.levelShare ?? 1) < 0.05, String(cw?.levelShare))
}

// ───────────────────────────────────────────────────────────────
console.log('\n【市场结构判断：深化 vs 切换】')

if (profit) {
  ok('识别为主线内部深化', dash.marketStructure.kind === 'DEEPENING', dash.marketStructure.kind)
  ok('结论明写"而非主线切换"', dash.marketStructure.headline.includes('而非主线切换'))
  ok('给出逐节点份额证据', dash.marketStructure.evidence.length >= 5)
  ok('证据里同时含份额水平与四季变化',
    dash.marketStructure.evidence.every(e => e.includes('份额') && e.includes('四季')))
  ok('主线切换结论指出数据完整度不足者不具备切换判断资格',
    dash.marketStructure.switchEvidence.includes('不具备切换判断资格'))
}

// 首位节点份额缩小 → DIFFUSING（符号比较，无可调阈值）
const shrink: Record<string, NodeStructureRow[]> = {
  optical: [
    {
      mainlineId: 'optical', node: '光模块', npLevel: 100, levelShare: 0.6, delta4Q: -8,
      leaders: [], direction: '↓↓', researchOnly: false, maxReportAgeDays: 135,
    },
  ],
}
const diff = judgeStructure(profit ?? ({ quality: [] } as unknown as ProfitMap), shrink)
ok('首位节点份额缩小 → 判为 DIFFUSING', diff.kind === 'DIFFUSING', diff.kind)
ok('DIFFUSING 措辞是"须核查"而非"要切换"',
  diff.headline.includes('须核查') && !diff.headline.includes('切换到'))
ok('DIFFUSING 同样不得产生动作', diff.canGenerateAction === false)

// ───────────────────────────────────────────────────────────────
console.log('\n【盘前/盘后输出差异】')

const pre = buildDashboard({ ...baseInput, session: 'PRE_OPEN' })
const preText = renderDashboard(pre)
const postText = renderDashboard(dash)
ok('盘前不输出产业结构表', !preText.includes('③ 产业结构表'))
ok('盘前不输出主线表', !preText.includes('② 主线表'))
ok('盘前输出必办动作', preText.includes('【盘前必办】'))
ok('盘前输出执行债务', preText.includes('执行债务 7 笔'))
ok('盘前明写为何不给趋势/利润结构', preText.includes('须盘后收盘价才能算准'))
ok('盘后输出四张表',
  postText.includes('① 持仓表') && postText.includes('② 主线表') &&
  postText.includes('③ 产业结构表') && postText.includes('④ 下一观察层'))
ok('盘后动作区与研究表之间有隔离线', postText.includes('█'.repeat(20)))
ok('盘前也给出首页一句话', preText.includes('【今日市场状态】'))

// ───────────────────────────────────────────────────────────────
console.log('\n【持仓表：观察项与法定理由分离】')

const zj = dash.holdings.find(h => h.code === '603986')
const hg = dash.holdings.find(h => h.code === '688041')
const zj2 = dash.holdings.find(h => h.code === '300308')
ok('有法定理由者状态为"超限"', hg?.status === '超限', hg?.status)
ok('有法定理由者系统动作为减仓', hg?.systemAction.startsWith('减仓') === true)
ok('无法定理由但有观察项者状态为"观察"', zj2?.status === '观察', zj2?.status)
ok('无法定理由者系统动作明写"不动作，仅复核"',
  zj2?.systemAction.includes('不动作，仅复核') === true, zj2?.systemAction)
ok('无法定理由者 legalReason 为 null（不得编造理由）', zj2?.legalReason === null)
ok('C级清退持仓的复核项被保留显示（不隐藏）',
  zj?.reviewTriggers.some(t => t.includes('C级清退')) === true)
// 注意断言写法：'无法定减仓理由' 这句本身含"减仓"二字，
// 用 includes('减仓') 判会误报。只能判是否以"不动作"开头。
ok('C级清退持仓不因清退而自动生成减仓动作',
  zj?.systemAction.startsWith('不动作') === true, zj?.systemAction)
ok('持仓表列出节点内利润份额', dash.holdings.some(h => h.shareWithinNode !== null))
ok('持仓表列出所属节点', dash.holdings.every(h => h.industryPosition.length > 0))
ok('仓位由市值除总资产算出，不用手抄',
  Math.abs((hg?.posPct ?? 0) - 900000 / 3_000_000) < 1e-9, String(hg?.posPct))

// ───────────────────────────────────────────────────────────────
console.log('\n【首页一句话】')

const h = dash.headline
ok('首页含主线/结构/核心/深化/切换/行动/数据完整度/最值得研究 八项',
  [h.mainline, h.structure, h.core, h.deepening, h.switching, h.action, h.dataCompleteness,
    h.mostWorthResearching].every(x => typeof x === 'string' && x.length > 0))
ok('行动一句里写明今日新增建仓数', h.action.includes('今日新增建仓 0'))
ok('最值得研究一句明写"观察，不买"',
  h.mostWorthResearching === '无' || h.mostWorthResearching.includes('观察，不买'), h.mostWorthResearching)
if (profit) {
  ok('核心一句把价格势能与产业利润分开表述',
    h.core.includes('价格势能下降') && h.core.includes('产业利润份额未恶化'), h.core)
  ok('数据完整度一句给出可判主线数', h.dataCompleteness.includes('可判主线'))
}

// 措辞随份额水平变化：大份额节点不得被称为"早期"
if (profit) {
  const big = dash.nextLayer.find(r => (r.nodeShare ?? 0) > 0.05 && r.stage === '观察' && r.strategyAllows)
  if (big) {
    ok('份额>5%的节点不被措辞为"早期改善"',
      !dash.headline.deepening.includes('早期改善') || (dash.nextLayer.find(
        r => dash.headline.deepening.startsWith(r.node))?.nodeShare ?? 1) < 0.05,
      dash.headline.deepening)
  }
}

// ───────────────────────────────────────────────────────────────
// 离线网页快照 —— 字段契约
//
// 前端同一个页面会从两个源读数据（接口 / 离线快照）。若两边字段名漂移，
// 症状是**某些卡片只在某个模式下出现** —— 页面不报错，只是静默少一块，
// 而少掉的那块很可能正是执行债务或外围现金口径。故用源码级断言把契约钉住。
console.log('\n【离线网页快照字段契约】')

const webSnapSrc = readFileSync(new URL('./webSnapshot.ts', import.meta.url), 'utf-8')
const routeSrc = readFileSync(new URL('../../routes/cockpit.ts', import.meta.url), 'utf-8')

// 接口 res.json 的 data 段里出现的顶层字段，快照必须同样给出
const CONTRACT = [
  'dashboard', 'changes', 'discovery', 'provisional', 'audit', 'auditMarkdown',
  'freeze', 'marketStage', 'missing', 'limits', 'lightText', 'actionText',
  'legalReasonText', 'evidenceTierText', 'valuationUsable', 'valuationLoaded',
  'decisionV2',
]
for (const f of CONTRACT) {
  ok(`快照提供接口同名字段 ${f}`, new RegExp(`\\b${f}\\s*[:,]`).test(webSnapSrc))
  ok(`接口确实有字段 ${f}（契约两端都在）`, new RegExp(`\\b${f}\\s*[:,]`).test(routeSrc))
}

ok('快照不产生动作（无 makeAction 调用）', !/\bmakeAction\s*\(/.test(webSnapSrc))
ok('快照层不含阈值数字字面量比较（只搬运，不判断）',
  !/[<>]=?\s*0\.\d/.test(webSnapSrc), '出现了阈值比较')
ok('拿不到的东西显式列为 unavailable，而不是省略',
  /unavailable:\s*\[/.test(webSnapSrc))
ok('执行债务明细缺失用 null 表示，与空数组区分',
  /pendingSells:\s*null/.test(webSnapSrc))
ok('KPI 在离线模式下为 null，不用 0 冒充',
  /kpi:\s*null/.test(webSnapSrc))

// 前端必须把 null 与 [] 区别对待，否则"不知道"会被显示成"已清零"
const cockpitPageSrc = readFileSync(
  new URL('../../../../frontend/src/pages/Cockpit.tsx', import.meta.url), 'utf-8'
)
ok('前端区分"拿不到明细"与"确实已清零"',
  /pendingSells\s*===\s*null/.test(cockpitPageSrc))
ok('前端在离线模式隐藏需要后端的复跑按钮',
  /!offline\.on\s*&&/.test(cockpitPageSrc))
ok('前端显示外围现金口径待裁定',
  /externalCash/.test(cockpitPageSrc) && /未计入仓位上限分母/.test(cockpitPageSrc))
ok('前端先渲染看台，决策大表收在详细数据里',
  /LookoutBoard/.test(cockpitPageSrc)
  && /DecisionCockpit/.test(cockpitPageSrc)
  && /data\.decisionV2/.test(cockpitPageSrc)
  && cockpitPageSrc.indexOf('<LookoutBoard') >= 0
  && cockpitPageSrc.indexOf('<DecisionCockpit') >= 0
  && cockpitPageSrc.indexOf('<LookoutBoard') < cockpitPageSrc.indexOf('<DecisionCockpit'))

const lookoutSrc = readFileSync(
  new URL('../../../../frontend/src/components/LookoutBoard.tsx', import.meta.url), 'utf-8',
)
const lookoutAsmSrc = readFileSync(
  new URL('./lookout.ts', import.meta.url), 'utf-8',
)
ok('看台不含 score/rank/weight',
  !/\bscore\b|\brank\b|\bweight\b/i.test(lookoutSrc)
  && !/"(score|rank|weight)"/i.test(lookoutAsmSrc))
ok('看台价格复核不构成动作', lookoutSrc.includes('不构成动作'))
ok('看台允许零动作日写成维持', lookoutAsmSrc.includes('今日维持是经过验证的决策'))
ok('看台按四轴呈现，不只显示动作',
  lookoutSrc.includes('Ownership') && lookoutSrc.includes('Evidence')
  && lookoutSrc.includes('Exposure') && lookoutSrc.includes('oneReason'))
ok('看台维持用各自行的理由，不统一写成有能力加仓',
  lookoutAsmSrc.includes('oneReason')
  && !lookoutSrc.includes('有能力加仓，证据未到迁移标准，维持'))
ok('看台生命线读法标明不是新规则',
  lookoutAsmSrc.includes('不是新规则') && lookoutAsmSrc.includes('战术减仓与价值退出仍然有效'))
ok('看台装配层不调用 makeAction', !/\bmakeAction\s*\(/.test(lookoutAsmSrc))
ok('驾驶舱把看台视图传入第一屏', /lookout=\{data\.lookout\}/.test(cockpitPageSrc))
ok('看台装配组合读法与今日不做什么',
  lookoutAsmSrc.includes('今日组合读法')
  && lookoutAsmSrc.includes('今日明确不做什么')
  && lookoutSrc.includes('今日组合读法')
  && lookoutSrc.includes('今日明确不做什么'))
ok('组合读法标明观察且不构成动作',
  lookoutAsmSrc.includes('观察，不构成动作')
  && lookoutSrc.includes('不构成动作'))
ok('驾驶舱三层：看台、依据、研究',
  lookoutSrc.includes('第一层 · 看台')
  && cockpitPageSrc.includes('第二层 · 依据')
  && cockpitPageSrc.includes('第三层 · 研究'))
ok('研究区拆成当前焦点 / 上一轮观察 / 结构表',
  cockpitPageSrc.includes("researchPane={pane}")
  && cockpitPageSrc.includes("'focus'")
  && cockpitPageSrc.includes("'older'")
  && cockpitPageSrc.includes("'tables'")
  && cockpitPageSrc.includes("useState<string[]>(['focus'])"))
{
  const lookV = buildLookoutView({ date: '2026-08-25', cockpit: null })
  ok('组合读法来自第二阶段观察，不发令',
    lookV.portfolio.stance.includes('去弱留强') && lookV.wontDo.length === 4)
  ok('看台 JSON 不含 score/rank/weight',
    !/"(score|rank|weight)"/i.test(JSON.stringify(lookV)))
  ok('渲染含组合读法与今日不做什么',
    renderLookout(lookV).includes('今日组合读法')
    && renderLookout(lookV).includes('今日明确不做什么'))
  ok('组合读法不改写已冻结规则',
    lookV.portfolio.note.includes('不得改写已冻结规则'))
}
ok('快照搬运看台与哲学参考',
  /lookout/.test(webSnapSrc) && /ownershipPhilosophy/.test(webSnapSrc))

const fiveLayerSrc = readFileSync(
  new URL('../../../../frontend/src/components/FiveLayerDashboard.tsx', import.meta.url), 'utf-8',
)
ok('研究区渲染哲学参考且不产生操作入口',
  /ownershipPhilosophy/.test(fiveLayerSrc)
  && fiveLayerSrc.includes('长期验证 Ownership')
  && fiveLayerSrc.includes('不产生任何操作入口'))
ok('研究区渲染 AI 第二阶段且不产生操作入口',
  /aiPhaseTwo/.test(fiveLayerSrc)
  && fiveLayerSrc.includes('去弱留强')
  && fiveLayerSrc.includes('不产生任何操作入口'))
ok('研究区渲染融资质量观察且不产生操作入口',
  /aiFinancingQuality/.test(fiveLayerSrc)
  && fiveLayerSrc.includes('融资质量')
  && fiveLayerSrc.includes('发债不是泡沫')
  && fiveLayerSrc.includes('不产生任何操作入口'))
ok('研究区渲染达利欧压力测试且不产生操作入口',
  /dalioPressureTest/.test(fiveLayerSrc)
  && fiveLayerSrc.includes('宏观判断不能直接指挥资本')
  && fiveLayerSrc.includes('不产生任何操作入口'))
ok('达利欧压力测试在当前焦点里排在融资质量前面',
  fiveLayerSrc.indexOf('showFocus && dalioPressureTest')
    < fiveLayerSrc.indexOf('showFocus && aiFinancingQuality')
  && fiveLayerSrc.indexOf('showFocus && dalioPressureTest') > 0)
ok('融资质量在当前焦点里排在第二阶段前面',
  fiveLayerSrc.indexOf('showFocus && aiFinancingQuality')
    < fiveLayerSrc.indexOf('showFocus && aiPhaseTwo')
  && fiveLayerSrc.indexOf('showFocus && aiFinancingQuality') > 0)
ok('驾驶舱把第二阶段传入研究区',
  /aiPhaseTwo=\{data\.aiPhaseTwo\}/.test(cockpitPageSrc))
ok('驾驶舱把融资质量传入研究区',
  /aiFinancingQuality=\{data\.aiFinancingQuality\}/.test(cockpitPageSrc))
ok('驾驶舱把达利欧压力测试传入研究区',
  /dalioPressureTest=\{data\.dalioPressureTest\}/.test(cockpitPageSrc))
ok('当前焦点改成宏观判断不能直接指挥资本，融资质量与第二阶段仍留在焦点层',
  cockpitPageSrc.includes('当前焦点 · 宏观判断不能直接指挥资本')
  && cockpitPageSrc.includes('aiFinancingQuality={data.aiFinancingQuality}')
  && cockpitPageSrc.includes('aiPhaseTwo={data.aiPhaseTwo}'))
ok('快照搬运第二阶段观察', /aiPhaseTwo/.test(webSnapSrc))
ok('快照搬运融资质量观察', /aiFinancingQuality/.test(webSnapSrc))
ok('快照搬运达利欧压力测试', /dalioPressureTest/.test(webSnapSrc))
ok('看台第一屏不把融资质量写成必须处理',
  !lookoutAsmSrc.includes('F-01')
  && !lookoutAsmSrc.includes('融资质量恶化')
  && !lookoutSrc.includes('F-01'))
ok('看台第一屏不把达利欧压力测试写成必须处理',
  !lookoutAsmSrc.includes('T-01')
  && !lookoutAsmSrc.includes('达利欧')
  && !lookoutSrc.includes('T-01')
  && !lookoutSrc.includes('达利欧'))
const htmlRenderSrc = readFileSync(
  new URL('./renderHtml.ts', import.meta.url), 'utf-8',
)
const runSrc = readFileSync(
  new URL('./run.ts', import.meta.url), 'utf-8',
)
ok('HTML 看台仍在仪表盘和 AI 第二阶段之前',
  htmlRenderSrc.indexOf('看台 —— 投资人前台只看这一问')
    < htmlRenderSrc.indexOf('<h2>仪表盘</h2>')
  && htmlRenderSrc.indexOf('看台 —— 投资人前台只看这一问')
    < htmlRenderSrc.indexOf('AI 第二阶段观察 —— 去弱留强，等证据'))
ok('HTML 融资质量观察在第二阶段之前',
  htmlRenderSrc.indexOf('AI 融资质量观察 —— 信用周期待验证，发债不是泡沫')
    < htmlRenderSrc.indexOf('AI 第二阶段观察 —— 去弱留强，等证据')
  && htmlRenderSrc.indexOf('AI 融资质量观察 —— 信用周期待验证，发债不是泡沫') > 0)
ok('HTML 达利欧压力测试在融资质量之前',
  htmlRenderSrc.indexOf('达利欧反向压力测试 —— 宏观判断不能直接指挥资本')
    < htmlRenderSrc.indexOf('AI 融资质量观察 —— 信用周期待验证，发债不是泡沫')
  && htmlRenderSrc.indexOf('达利欧反向压力测试 —— 宏观判断不能直接指挥资本') > 0)
ok('CLI 仍先打看台再打决策驾驶舱',
  /renderLookout\(lookoutForHtml\)/.test(runSrc)
  && runSrc.indexOf('renderLookout(lookoutForHtml)') < runSrc.indexOf('renderDecisionCockpit(v2)'))
ok('CLI 先打融资质量再打第二阶段',
  runSrc.indexOf('renderAiFinancingQuality()')
    < runSrc.indexOf('renderAiPhaseTwo()')
  && runSrc.indexOf('renderAiFinancingQuality()') > 0)
ok('CLI 先打达利欧压力测试再打融资质量',
  runSrc.indexOf('renderDalioPressureTest()')
    < runSrc.indexOf('renderAiFinancingQuality()')
  && runSrc.indexOf('renderDalioPressureTest()') > 0)
ok('研究区渲染组合防守层且不产生操作入口',
  /portfolioDefense/.test(fiveLayerSrc)
  && fiveLayerSrc.includes('组合防守层')
  && fiveLayerSrc.includes('不产生任何操作入口'))
ok('驾驶舱把组合防守层传入研究区',
  /portfolioDefense=\{data\.portfolioDefense\}/.test(cockpitPageSrc))
ok('快照搬运组合防守层', /portfolioDefense/.test(webSnapSrc))

// ───────────────────────────────────────────────────────────────
// 资产层（委员会 2026-08-15 指定为第一层）
//
// 它必须存在且三个分母同屏。以前第一眼看到的是券商 App 的 82.5%，
// 而那不是资产配置指标 —— 一个数字放错位置，就能让人得出
// "仓位太重要减仓"的结论，而真实组合是股票 51.6% / 现金 48.4%。
console.log('\n【资产层】')

ok('驾驶舱含资产层', !!dash.assets)
ok('资产层同时给出组合口径与账户口径（不允许只印一个）',
  dash.assets.portfolioTotal >= 0 && dash.assets.brokerTotal >= 0
  && 'brokerPositionPct' in dash.assets && 'equityPct' in dash.assets)
ok('资产层区分"可直接下单现金"与"组合现金"',
  'tradableCash' in dash.assets && 'externalCash' in dash.assets)

// 熔断口径不可比时必须是 INCOMPARABLE，不是 NORMAL ——
// 后者意味着"已检查没问题"，前者意味着"无法检查"。
const noBreakdown = buildDashboard({ ...baseInput, assetBreakdown: undefined })
ok('缺少资产分项时熔断判为 INCOMPARABLE，而非 NORMAL',
  noBreakdown.assets.circuitState === 'INCOMPARABLE',
  noBreakdown.assets.circuitState)
ok('INCOMPARABLE 时给出理由且明写不得显示为正常',
  noBreakdown.assets.circuitReason.includes('不可比')
  && noBreakdown.assets.circuitReason.includes('不得'))
ok('缺少分项时百分比为 null，不用 0 冒充',
  noBreakdown.assets.equityPct === null && noBreakdown.assets.cashPct === null)

const renderedAssets = renderDashboard(dash)
ok('CLI 渲染把资产层印在四张表之前',
  renderedAssets.indexOf('资产层') < renderedAssets.indexOf('① 持仓表'),
  `资产层@${renderedAssets.indexOf('资产层')} 持仓表@${renderedAssets.indexOf('① 持仓表')}`)
ok('CLI 渲染明写账户口径不参与上限判定',
  renderedAssets.includes('不参与上限判定'))

// ───────────────────────────────────────────────────────────────
// 今日结论层
//
// 这一层最危险：它是唯一"给结论"的地方，所以最容易在此把观察指标偷偷升级成动作，
// 或者为了让页面好看而给出一个"看起来像答案"的择时判断。逐条钉住。
console.log('\n【今日结论层】')

const verdict = buildVerdict({
  dashboard: dash,
  actions: [],
  actionText: ACTION_TEXT,
  drift: [],
  driftSnapshotCount: 1,
})

ok('结论层不含综合评分字段',
  !/"(score|总分|rating|星级|grade|rank|weight)"/i.test(JSON.stringify(verdict)))

// 焦点必须能收敛。二十行的"焦点"等于没有焦点。
ok('焦点名单不超过 8 条', verdict.focus.length <= 8, String(verdict.focus.length))
ok('焦点条目不重复同一标的',
  new Set(verdict.focus.filter(f => f.code).map(f => f.code)).size
    === verdict.focus.filter(f => f.code).length)
ok('每条焦点都写明凭哪条规则入列', verdict.focus.every(f => f.because.length > 0))
ok('每条焦点都给出可执行的今日动作', verdict.focus.every(f => f.todo.length > 0))

// 法定理由与复核项在措辞上不可互换
const mustText = JSON.stringify(verdict.mustDo)
ok('必须执行档的理由不含预测性措辞',
  !FORBIDDEN_REASON_PHRASES.some(p => mustText.includes(p)),
  FORBIDDEN_REASON_PHRASES.filter(p => mustText.includes(p)).join('、'))
ok('必须执行档每条都有法定理由', verdict.mustDo.every(h => !!h.legalReason))
ok('复核档每条都明确无法定理由', verdict.reviewNoAction.every(h => h.legalReason === null))
ok('复核档在渲染文本里明写"法定减仓理由：无"',
  !verdict.reviewNoAction.length || renderVerdict(verdict).includes('法定减仓理由：无'))

// 答不了的问题必须存在且带实测依据 —— 空着等于默认"没说不能就是能"
ok('列出系统答不了的问题', verdict.cannotAnswer.length >= 4)
ok('包含"是不是阶段性顶底"这一条',
  verdict.cannotAnswer.some(c => c.question.includes('阶段性')))
ok('包含"现在能不能建仓"这一条',
  verdict.cannotAnswer.some(c => c.question.includes('能不能建仓')))
ok('每条都给出为什么答不了，且引用实测而非仅表态',
  verdict.cannotAnswer.every(c => c.why.length > 30))
ok('明说减仓不是因为要跌',
  verdict.cannotAnswer.some(c => c.question.includes('要跌') && c.why.startsWith('不是')))

// 样本不足必须显式告知，不能拿 1 天的档冒充趋势
ok('归档不足时明说无法计算累计趋势',
  verdict.driftNote.includes('无法计算') || verdict.driftNote.includes('样本太短'),
  verdict.driftNote)

// 一堆待核验节点不等于一堆机会 —— 这是最容易读反的地方
ok('研究覆盖判断把"待核验"说成覆盖不足而非机会',
  verdict.coverageVerdict.includes('不是') || verdict.coverageVerdict.includes('均已补齐'),
  verdict.coverageVerdict)

const verdictSrc = readFileSync(new URL('./verdict.ts', import.meta.url), 'utf-8')
ok('结论层不调用 makeAction（不生产动作）', !/\bmakeAction\s*\(/.test(verdictSrc))

/**
 * 剥掉注释与字符串字面量再查逻辑。
 *
 * 必须这么做的原因很具体：`cannotAnswer` 里要写清"10 日涨幅 >50% 这条护栏"
 * 才能让人知道为什么系统答不了顶底，而那段解释性文案会被"含价格阈值"的正则命中。
 * 若不区分代码与文案，就会逼着人删掉解释来讨好自检 —— 本末倒置。
 */
function codeOnly(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, '``')
}

ok('结论层不含价格阈值比较（不做择时）',
  !/(ret10|涨幅|drawdown|pePercentile)\s*[<>]/.test(codeOnly(verdictSrc)))
ok('结论层不引入新的数值阈值常量',
  !/[<>]=?\s*0\.\d/.test(codeOnly(verdictSrc)))

console.log('\n【外发摘要脱敏】')
//
// 实测踩过：摘要开头声称"不含股数"，而焦点区照抄了动作原文「减仓 约800股」。
// 800 股 × 280.62 元 = 22.4 万，正是超限的 6.6pct，反推总资产 ≈ 340 万，
// 与真实 377 万只差 10%。**声称脱敏却泄漏，比不声称脱敏更糟** —— 它给了虚假保证。
// 故把"声称与内容一致"钉成不变量。
{
  const { buildBrief } = await import('./share')
  const fakeDash = {
    ...dash,
    holdings: dash.holdings.map(h => ({
      ...h, systemAction: '减仓 约800股（约22.4万）', reviewTriggers: ['跌破MA20', '需卖出 1200 股'],
    })),
  }
  const fakeVerdict = {
    ...buildVerdict({ dashboard: fakeDash, actions: [], actionText: ACTION_TEXT, drift: [], driftSnapshotCount: 1 }),
    focus: [{ name: '海光信息', code: '688041', held: true, because: '超出6.6pct', todo: '执行 减仓 约800股，约 22.4万' }],
  }

  const redacted = buildBrief({ dashboard: fakeDash, verdict: fakeVerdict, includeAmounts: false })
  ok('脱敏摘要不含任何"数字+股"', !/\d[\d,]*\s*股(?!数)/.test(redacted),
    (/\d[\d,]*\s*股(?!数)/.exec(redacted) ?? [''])[0])
  ok('脱敏摘要不含"数字+万"', !/\d[\d,]*(\.\d+)?\s*万/.test(redacted),
    (/\d[\d,]*(\.\d+)?\s*万/.exec(redacted) ?? [''])[0])
  ok('脱敏摘要仍保留仓位百分比（脱敏不等于把信息删空）', /仓位/.test(redacted) && /%/.test(redacted))
  ok('脱敏摘要明示已脱敏', /本摘要已脱敏/.test(redacted))

  const full = buildBrief({ dashboard: fakeDash, verdict: fakeVerdict, includeAmounts: true })
  ok('含金额版本不声称已脱敏（避免自相矛盾）', !/本摘要已脱敏/.test(full))

  // 约束前言是这份摘要能否安全外发的前提：没有它，外部模型读完就会给择时建议
  for (const [must, label] of [
    ['不要给出买卖时点建议', '禁止择时建议'],
    ['技术指标只能触发复核', '观察指标不得产生动作'],
    ['不要输出综合评分', '禁止综合评分'],
    ['「不可判断」是合法', '不可判断是合法结论'],
  ] as [string, string][]) {
    ok(`摘要前言包含约束：${label}`, redacted.includes(must))
  }
  ok('摘要体积可控（1.5 万字符以内，能进任何模型上下文）',
    [...redacted].length < 15000, String([...redacted].length))
}

// ───────────────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════
// 8/15 两项裁定：峰值采用情形 B、安全垫裁定排除
// ══════════════════════════════════════════════════════════════
{
  const { SAFETY_NET_POLICY, worstLight, LIMITS } = await import('./safety')
  const { PEAK_HISTORY } = await import('../governance/peakBasis')
  const { LEGAL_REASON_TEXT, makeAction } = await import('./types')

  // ── 裁定排除 ≠ 数据缺失 ──
  ok('安全垫已裁定排除', SAFETY_NET_POLICY.mode === 'EXCLUDED_BY_STRATEGY')
  ok('EXCLUDED 不参与三色灯取严（否则"不纳入模型"退化成永久亮灯的待办）',
    worstLight(['EXCLUDED', 'GREEN']) === 'GREEN'
    && worstLight(['EXCLUDED']) === 'GREEN')
  ok('EXCLUDED 不被当成 UNKNOWN（前者系统完整，后者系统不完整）',
    worstLight(['EXCLUDED', 'GREEN']) !== 'UNKNOWN')
  ok('UNKNOWN 仍按必须处理对待 —— 排除的是安全垫这一维，不是"缺数据可以不管"',
    worstLight(['UNKNOWN', 'GREEN']) === 'UNKNOWN')

  // 直接推论：不纳入模型的维度不能再产生减仓的法定理由
  let safetyNetRejected = false
  try {
    makeAction({
      code: '688041', name: '海光信息', kind: 'REDUCE', reason: 'FAMILY_SAFETY_NET',
      reasonDetail: '安全垫不足', notReason: [], reviewTriggers: [], metrics: [],
      size: { display: '1万', value: 10_000, note: '测试用' },
    })
  } catch { safetyNetRejected = true }
  ok('FAMILY_SAFETY_NET 已退出减仓白名单（不纳入模型的维度不能产生法定理由）',
    safetyNetRejected)
  ok('枚举值本身保留 —— 8/15 前的审计档引用过它，删枚举会让历史档无法解析',
    typeof LEGAL_REASON_TEXT.FAMILY_SAFETY_NET === 'string')

  // ── 峰值情形 B ──
  const pv1 = PEAK_HISTORY.find(r => r.basis === 'portfolio_basis_v1')
  ok('组合口径峰值已认定为 630 万（情形 B）', pv1?.peak === 6_300_000)
  const legacy = PEAK_HISTORY.find(r => r.basis === 'legacy_account_basis')
  ok('券商口径 430 万仍保留 —— 它是 7/17–8/14 全部判定的依据', legacy?.peak === 4_300_000)

  // ── 熔断：一级成立，且降仓额与显示层同源 ──
  const dashB = buildDashboard({
    ...baseInput,
    portfolioTotal: 5_342_513,
    assetBreakdown: {
      positionsValue: 2_759_613, brokerCash: 582_900, externalCash: 2_000_000,
      brokerTotal: 3_342_513, peakBasis: 'PORTFOLIO', peak: 6_300_000,
    },
  })
  ok('一级熔断成立', dashB.assets.circuitState === 'LEVEL1')
  ok('回撤约 15.2%',
    dashB.assets.drawdown !== null && Math.abs(dashB.assets.drawdown - 0.152) < 0.002,
    `实为 ${dashB.assets.drawdown}`)
  ok('股票上限 50%', dashB.assets.equityCap === 0.50)
  ok('降仓额约 8.84 万（用同一套精确数：275.96 − 534.25×50%）',
    dashB.assets.circuitExcess !== null
    && Math.abs(dashB.assets.circuitExcess - 88_357) < 2_000,
    `实为 ${dashB.assets.circuitExcess}`)

  // 恒等式：组合总资产 − 账内现金 − 账户外现金 = 股票市值。
  // 8.1 万那个数就是违反这条恒等式的产物 —— 用了 275.2 万配 534.25 万。
  const a = dashB.assets
  ok('三个分项与组合总资产自洽（恒等式成立，故降仓额唯一）',
    Math.abs(a.portfolioTotal - a.positionsValue - a.brokerCash - a.externalCash) < 1,
    `差 ${a.portfolioTotal - a.positionsValue - a.brokerCash - a.externalCash}`)

  // ── 峰值口径不可比时，绝不能显示为正常/0% ──
  const dashMismatch = buildDashboard({
    ...baseInput,
    portfolioTotal: 5_342_513,
    assetBreakdown: {
      positionsValue: 2_759_613, brokerCash: 582_900, externalCash: 2_000_000,
      brokerTotal: 3_342_513, peakBasis: 'BROKER', peak: 4_300_000,
    },
  })
  ok('峰值口径不可比 → INCOMPARABLE', dashMismatch.assets.circuitState === 'INCOMPARABLE')
  ok('不可比时回撤为 null，不是 0（0% 读作"没跌过"，null 读作"算不出"）',
    dashMismatch.assets.drawdown === null)
  ok('不可比时上限为 null，不是无约束', dashMismatch.assets.equityCap === null)

  // ── 风控四层 ──
  const ids = dashB.riskLayers.map(r => r.id)
  ok('风控四层顺序为 L1→L4', ids.join(',') === 'L1,L2,L3,L4')
  const l4 = dashB.riskLayers.find(r => r.id === 'L4')!
  ok('L4 技术/产业/估值不可产生动作（越权正是"研究替代执行"的入口）',
    l4.canGenerateActions === false)
  const l3 = dashB.riskLayers.find(r => r.id === 'L3')!
  ok('L3 安全垫标为 EXCLUDED 且不可产生动作',
    l3.light === 'EXCLUDED' && l3.canGenerateActions === false)
  ok('L3 文案为"不纳入 TIOS 风控模型"，不得出现"数据缺失"',
    l3.state.includes('不纳入') && !l3.state.includes('缺失'), l3.state)
  const l1 = dashB.riskLayers.find(r => r.id === 'L1')!
  ok('L1 明确降仓不指定卖哪一只', l1.note.includes('不指定卖哪一只'))
  const l2 = dashB.riskLayers.find(r => r.id === 'L2')!
  ok('L2 明确与 L1 是两套独立理由，不得合并计算',
    l2.note.includes('独立') && l2.note.includes('不得合并'))

  // ── 组合层降仓不得落到个股头上 ──
  // 熔断类必办项的标签必须是"组合整体"，不能是某只股票的名字。
  // 若哪天变成"海光信息：熔断降仓 8.8万"，就是把组合层义务落到了个股头上，
  // 而承担持仓本应由委员会指派。
  const circuitItems = dashB.actionZone.mustExecute.filter(x => x.detail.includes('熔断')
    || x.detail.includes('自峰值回撤'))
  ok('熔断类必办项指向组合整体，不指向某只股票',
    circuitItems.every(x => x.label.includes('组合')),
    circuitItems.map(x => x.label).join(',') || '（本 fixture 未触发熔断动作，由 cockpit selftest 覆盖）')

  // ── 家庭支出不得再出现在数据缺口里 ──
  ok('数据缺口不再包含家庭刚性支出（裁定排除不是待办）',
    !dashB.dataGaps.some(g => g.includes('家庭')),
    dashB.dataGaps.filter(g => g.includes('家庭')).join(';'))
  ok('JSON 全文不出现"安全垫：数据缺失"这类表述',
    !JSON.stringify(dashB).includes('安全垫无法判定'))
  void LIMITS
}

// 峰值对照表：裁定后必须标出采纳项，且不得把已裁定的峰值再叠加一次
{
  const { peakScenarios, renderPeakScenarios, ADOPTED_SCENARIO, PEAK_HISTORY } =
    await import('../governance/peakBasis')
  const legacy = PEAK_HISTORY.find(r => r.basis === 'legacy_account_basis')?.peak ?? 0
  const rows = peakScenarios(5_342_513, 2_759_613, legacy, 2_000_000)
  const b = rows.find(r => r.id === 'B_INCLUDED_AT_PEAK')!
  ok('对照表已采纳 B', ADOPTED_SCENARIO === 'B_INCLUDED_AT_PEAK')
  ok('情形 B 峰值为 630 万，而非 830 万（不得把已裁定的组合峰值再加一次外部现金）',
    b.peak === 6_300_000, String(b.peak))
  ok('情形 B 触发一级熔断、须减约 8.84 万',
    b.circuit === 'LEVEL1' && b.requiredReduction !== null
    && Math.abs(b.requiredReduction - 88_357) < 2_000,
    `${b.circuit} / ${b.requiredReduction}`)
  const txt = renderPeakScenarios(rows)
  ok('渲染标出"已采纳"，否则读者会以为问题还开着', txt.includes('★ 已采纳'))
  ok('未采纳项显式标注', txt.includes('（未采纳）'))
}

// ══════════════════════════════════════════════════════════════
// 回撤只能有一个计算入口
// ══════════════════════════════════════════════════════════════
//
// 同一公式曾散在五处，两处用了 brokerTotal → 算出 46.9% →
// 一处误判二级熔断索要 175.7 万降仓，一处误判"只卖不买"封死全部买入。
// 两次都是**偏严**方向，所以没人质疑 —— 偏严的错误看起来像谨慎。
{
  const { computeCircuit } = await import('./safety')
  const base = { portfolioTotal: 5_342_513, peakAssets: 6_300_000, peakBasis: 'PORTFOLIO' as const }
  const c = computeCircuit(base)
  ok('统一入口：一级熔断，回撤 15.2%，上限 50%，非只卖不买',
    c.level === 'LEVEL1' && c.equityCap === 0.50 && !c.sellOnly
    && Math.abs((c.drawdown ?? 0) - 0.152) < 0.002,
    `${c.level} / ${c.drawdown} / ${c.equityCap}`)

  // 若误用券商口径，会得到 46.9% 与二级熔断 —— 钉住这个差异，
  // 让将来任何人改回去时立刻看到后果
  const wrong = computeCircuit({ ...base, portfolioTotal: 3_342_513 })
  ok('用券商口径会误判二级熔断（钉住这个差异，防止有人改回去）',
    wrong.level === 'LEVEL2' && wrong.sellOnly === true,
    `${wrong.level} / 回撤 ${((wrong.drawdown ?? 0) * 100).toFixed(1)}%`)

  ok('口径不可比 → INCOMPARABLE 且回撤为 null，不是 0',
    computeCircuit({ ...base, peakBasis: 'BROKER' }).level === 'INCOMPARABLE'
    && computeCircuit({ ...base, peakBasis: 'BROKER' }).drawdown === null)
  ok('峰值为 0 视同不可比，不得算出 100% 回撤',
    computeCircuit({ ...base, peakAssets: 0 }).level === 'INCOMPARABLE')

  // 源码层面：公式只允许出现在 computeCircuit 内
  const { readFileSync: rf } = await import('node:fs')
  const files = [
    '../cockpit/index.ts', '../cockpit/safety.ts', '../tios/executionEngine.ts',
    '../governance/reaudit.ts', '../cockpit/dashboard.ts',
  ]
  const offenders: string[] = []
  for (const f of files) {
    const src = rf(new URL(f, import.meta.url), 'utf-8')
    // 排除注释行与 formula 展示字符串（后者用全角 − ，不是运算）
    for (const line of src.split('\n')) {
      const t = line.trim()
      if (t.startsWith('*') || t.startsWith('//') || t.startsWith('|')) continue
      if (/1 - [^/]*\/ *[a-zA-Z.]*peakAssets/.test(t)
        && !t.includes('const drawdown =')) offenders.push(`${f}: ${t.slice(0, 60)}`)
    }
  }
  ok('回撤公式只出现在 computeCircuit 内（其余一律走统一入口）',
    offenders.length === 0, offenders.join(' ｜ '))
}

// ══════════════════════════════════════════════════════════════
// 外发简报：口径已裁定 + 盘中必须自报
// ══════════════════════════════════════════════════════════════
//
// 两个真实故障，都是 2026-08-17 盘中那份摘要暴露出来的：
//
// ① 简报里还留着「仓位分母口径（未裁定）」与「以券商账户总资产为分母」。
//    8/15 裁定后我从 HTML 渲染器删了这段，**漏了简报**。
//    于是同一份文件里自相矛盾：一边说"分母未裁定、用券商口径"，
//    一边报"组合回撤 15.6% → 一级熔断"（后者只有用组合口径峰值才算得出来）。
//    「一份自相矛盾的简报比一份缺信息的简报更糟」—— 外部模型会各取一句往下推。
//
// ② 简报没有盘中标记。它偏偏是最需要这个标记的产物：
//    会被贴进外部大模型，而那些模型看不到运行时刻，
//    只会照字面把「盘后」当成收盘数据用。
{
  const { buildBrief } = await import('./share')

  const closed = buildBrief({ dashboard: dash, verdict: null })
  const live = buildBrief({ dashboard: dash, verdict: null, intraday: true })

  // ── ① 口径已裁定 ──
  //
  // 「检查限定在它管辖的小节内，不扫整篇」——
  // 这是第三次被自己的文档绊倒后定下的规矩：
  //   第一次 lint 抓到注释里的 Markdown 星号
  //   第二次禁字检查抓到注释里"本模块不导出 aiRevenue"这句说明
  //   第三次「怎么问」小节引用历史矛盾作为实证，引用文本含被禁字样
  // 三次的共同点是：**文档合法地会引用它所禁止的东西。**
  // 扫整篇必然把"说明"与"违规"混为一谈，于是正确的文档反而通不过检查。
  const section = (t: string, title: string): string => {
    const i = t.indexOf(title)
    if (i < 0) return ''
    const j = t.indexOf('\n## ', i + title.length)
    return t.slice(i, j < 0 ? undefined : j)
  }
  const denomSection = section(closed, '### 仓位分母口径')
  ok('简报存在分母口径小节', denomSection.length > 0)
  for (const banned of ['未裁定', '以券商账户总资产为分母', '从严口径', '请勿代为裁定']) {
    ok(`分母口径小节中不出现旧文案「${banned}」`, !denomSection.includes(banned))
  }
  ok('简报写明分母是组合总资产', closed.includes('分母是「组合总资产」'))
  ok('简报写明券商口径不参与上限判定',
    closed.includes('不参与任何上限判定'))
  ok('简报提醒两个口径不要混用', closed.includes('不要与本表混用'))

  // 自相矛盾检测：不得同时出现"分母未裁定"与"一级熔断"
  const contradiction = (t: string) =>
    (t.includes('未裁定') || t.includes('券商账户总资产为分母'))
    && (t.includes('一级熔断') || t.includes('二级熔断'))
  // 矛盾检测同样限定小节：整篇里「熔断成立」出现在动作区，
  // 而「未裁定」若出现只可能出现在分母口径小节 —— 混扫会永远报矛盾。
  ok('分母口径小节不声称未裁定（与同一份文件里的熔断结论矛盾）',
    !contradiction(denomSection + '\n一级熔断'))

  // ── ② 盘中必须自报，且必须在最前 ──
  ok('盘后运行不出现盘中横幅', !closed.includes('盘中生成'))
  ok('盘中运行出现横幅', live.includes('盘中生成'))
  ok('横幅在标题之前（贴进模型时常只取前半段，放后面等于没放）',
    live.indexOf('盘中生成') < live.indexOf('# 《鸿鹄理财》数据摘要'))
  ok('横幅说明读数为临时值，且说明失真类不会自动变准',
    live.includes('临时值') && live.includes('换一个数'))
  ok('横幅说明本次未归档', live.includes('未归档'))
  ok('标题本身带盘中标记（标题是被摘录时唯一一定会带上的那一行）',
    live.split('\n').find(l => l.startsWith('# '))?.includes('盘中运行') === true,
    live.split('\n').find(l => l.startsWith('# ')))
  ok('盘后标题不带盘中标记',
    closed.split('\n').find(l => l.startsWith('# '))?.includes('盘中运行') === false)
}

// ── 外发简报必须自带提问模板 ──
//
// 来自一次真实提问:「分享给 ChatGPT/豆包/DeepSeek 判断走势做决策,能做到吗?」
// 答案是不能 —— 摘要的前瞻性内容为零。但光在开头写"请勿预测"不够:
// 「约束容易被忽略,而任务会被执行」。故把提问模板与数据一起交付,
// 把外部模型放进它真正能胜任的角色(审稿人,不是分析师)。
{
  const { buildBrief } = await import('./share')
  const b = buildBrief({ dashboard: dash, verdict: null })

  ok('简报自带「怎么问」小节', b.includes('把这份数据交给外部模型时，请这样问'))
  ok('明说不能用来回答买卖与走势',
    b.includes('不能') && b.includes('走势往哪走'))
  ok('给出前瞻性内容为零这个事实依据', b.includes('前瞻性内容为零'))
  ok('指出走势结论来自模型自己的先验，不来自数据',
    b.includes('先验') && b.includes('不来自这份数据'))
  ok('把外部模型定位为审稿人而非分析师',
    b.includes('审稿人') && b.includes('不是分析师'))

  // 模板必须覆盖五件事，且都是可核验的动作，不含预测
  for (const task of ['找矛盾', '验算术', '指出证据不足', '指出缺什么', '挑战归因']) {
    ok(`提问模板包含「${task}」`, b.includes(task))
  }
  ok('模板要求给出出处，否则无法核验',
    b.includes('出处'))
  ok('模板允许"找不到问题"作为合法回答（否则模型会为了有输出而编）',
    b.includes('不要为了有输出而编一条'))

  // 模板本身不得含任何邀请预测的措辞
  const tpl = b.slice(b.indexOf('请这样问'))
  for (const banned of ['走势判断如何', '会不会涨', '目标价', '建议买入', '建议卖出', '择时']) {
    ok(`模板不出现「${banned}」`, !tpl.includes(banned))
  }
  ok('模板附实证：曾靠"找矛盾"查出口径与熔断并存的错误',
    b.includes('审稿这件事，外部模型确实做得到'))
}

// ── 盘中读数分级：三类必须分开，不能一起打折 ──
//
// 来自委员会的提问：「盘中更新一次，数据是什么样子？能不能当研判依据？」
// 只给一个"仅供参考"的横幅是不够的 —— 那会让三类读数被一起怀疑，
// 于是完全可靠的那些（持仓、利润份额、执行债务）也被打折，
// 而真正会误导人的那类（用不完整 K 线算的相对强度）反倒没被单独点出来。
{
  const { FIELD_GRADES, byGrade, intradayVerdict, GRADE_TEXT } =
    await import('./intradayFields')
  const { buildBrief } = await import('./share')

  ok('分级表覆盖三档', new Set(FIELD_GRADES.map(f => f.grade)).size === 3)
  ok('三档文案各不相同（否则读者无法区分）',
    new Set(Object.values(GRADE_TEXT)).size === 3)
  ok('每一项都写明理由（无理由的分级等于拍脑袋）',
    FIELD_GRADES.every(f => f.why.length >= 10))
  // 「同上」会在按档筛选与逗号连排后指向别的项 —— 每条理由必须自足
  ok('理由中不出现「同上」（按档筛选后它会指向别的项）',
    FIELD_GRADES.every(f => !f.why.includes('同上')),
    FIELD_GRADES.filter(f => f.why.includes('同上')).map(f => f.field).join('、'))

  // 关键分类必须落在正确的档里
  const gradeOf = (kw: string) => FIELD_GRADES.find(f => f.field.includes(kw))?.grade
  ok('持仓与现金 = 可直接用', gradeOf('持仓股数') === 'STABLE')
  ok('节点利润份额 = 可直接用（来自季报，与盘中无关）',
    gradeOf('存量份额') === 'STABLE')
  ok('战略资格 = 可直接用（战略层裁定，非数据推出）',
    gradeOf('战略资格') === 'STABLE')
  ok('回撤与熔断 = 临时值（阈值附近会翻转）',
    gradeOf('自峰值回撤') === 'PROVISIONAL')
  ok('单票仓位 = 临时值', gradeOf('单票仓位') === 'PROVISIONAL')
  ok('涨跌量比 = 系统性失真（用不完整成交量算）',
    gradeOf('涨跌量比') === 'DISTORTED')
  ok('MA 距离 = 系统性失真（未完成的今日价进了均线）',
    gradeOf('MA20') === 'DISTORTED')
  ok('相对强度 = 系统性失真', gradeOf('相对强度') === 'DISTORTED')
  ok('市场阶段 = 系统性失真', gradeOf('市场阶段') === 'DISTORTED')

  // 熔断那条必须附实测证据，否则"会翻转"只是一句断言
  ok('熔断项引用了同一上午翻转的实测',
    FIELD_GRADES.find(f => f.field.includes('熔断'))!.why.includes('翻转'))

  // 结论刻意不给二元答案
  const v = intradayVerdict()
  ok('结论不是"能/不能"的二元答案，而是逐类说明',
    v.includes('可直接用') && v.includes('临时值') && v.includes('系统性失真'))
  ok('结论明确指出系统性失真那类不可用于研判', v.includes('不可用于研判'))

  // 盘中横幅必须带上三类
  const live = buildBrief({ dashboard: dash, verdict: null, intraday: true })
  ok('盘中横幅逐类点明三档',
    live.includes('可直接用（') && live.includes('临时值（')
    && live.includes('系统性失真（'))
  ok('横幅说明未完成 K 线是"假装已完成"的日线',
    live.includes('假装已完成'))
  ok('横幅点明失真类等收盘不会收敛而是换一个数',
    live.includes('换一个数'))
  ok('横幅里的类数与分级表一致（写死数字会与表脱节）',
    live.includes(`可直接用（${byGrade('STABLE').length} 类）`)
    && live.includes(`系统性失真（${byGrade('DISTORTED').length} 类`))

  // 产品名
  ok('简报标题使用《鸿鹄理财》', live.includes('《鸿鹄理财》数据摘要'))
  ok('简报落款使用《鸿鹄理财》', live.includes('本摘要由《鸿鹄理财》驾驶舱导出'))
}

console.log(`\n═══ 结果：${passed} 通过 / ${failed} 失败 ═══\n`)
if (failed > 0) process.exit(1)
