// 五层驾驶舱自检
//
// 只测四件事，全部是"系统会不会越权"，不测"判断准不准"：
//   一、禁止综合评分 —— 遍历整个 JSON，任何一行不得带总分/星级字段
//   二、「不可判断」是合法输出 —— 数据不足的主线，即使价格在涨也不得输出强弱结论
//   三、装配层不生产动作 —— 四张研究表与动作区严格隔离
//   四、战略层闸门 —— 全部在册标的被清退的节点，不得被输出为"最值得研究"
//
// 运行：npx tsx backend/src/services/cockpit/dashboardSelftest.ts

import type { DailyBar, Position } from '../tios/types'
import { runMsr } from '../msr'
import { MAINLINES } from '../msr/universe'
import { buildProfitMap, type ProfitMap } from '../research/profitRadar'
import {
  buildDashboard, findProfitNodeMismatches, judgeStructure,
  type Dashboard, type DashboardInput, type NodeStructureRow,
} from './dashboard'
import { renderDashboard } from './renderDashboard'
import { FORBIDDEN_REASON_PHRASES } from './types'

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
const totalAssets = 3_000_000

const msr = runMsr({
  date: '2026-08-13', barsByCode, indexBarsByCode, pendingSellCount: 7, marketAllows: false,
})

let profit: ProfitMap | null = null
try { profit = buildProfitMap('2026-08-13') } catch { /* 需先跑 profit:fetch */ }

const baseInput: DashboardInput = {
  date: '2026-08-13', session: 'POST_CLOSE', positions, totalAssets,
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
  dataGaps: ['家庭年度刚性支出未提供'],
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
console.log(`\n═══ 结果：${passed} 通过 / ${failed} 失败 ═══\n`)
if (failed > 0) process.exit(1)
