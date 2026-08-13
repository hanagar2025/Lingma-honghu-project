// 治理层自检 —— 守两条不变量：
//
//   ① 规则漂移必须能被发现。否则"没有偷偷新增规则"只是一句承诺。
//   ② E3 不得用盈亏评判模型。否则事后归因会从后门回来。
//
// 委员会 2026-08-13：「不要因为结果赚钱就证明模型正确，也不要因为结果亏钱就证明模型错误。」
// 这一条与"技术指标不得产生动作"同源：都是防止用结果替代规则。
//
// 运行：npm run audit:selftest

import { buildRuleRegistry, detectDrift, fingerprint, type FreezeBaseline } from './ruleRegistry'
import { loadBaseline } from './freeze'
import { buildAudit, computeE3, computeKpis, renderAuditMarkdown, type CostSnapshot, type E3Input } from './audit'
import {
  snapshotOf, diffSnapshots, renderChanges,
  updateDiscovery, stageAdvances, renderDiscovery,
} from './changeLog'
import { LEGAL_REASON_TEXT } from '../cockpit/types'
import type { CockpitReport } from '../cockpit/types'
import type { Dashboard } from '../cockpit/dashboard'
import { readFileSync } from 'node:fs'

let failed = 0
let passed = 0

function ok(name: string, cond: boolean, extra = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.error(`  ✗ ${name} ${extra}`) }
}

console.log('\n═══ 治理层自检 ═══\n')

// ───────────────────────────────────────────────────────────────
console.log('【不变量一】规则漂移必须能被发现')
// ───────────────────────────────────────────────────────────────

const reg = buildRuleRegistry()
const fp = fingerprint(reg)

ok('登记册非空', reg.length > 0, String(reg.length))
ok('指纹稳定（同一输入两次同值）', fingerprint(reg).hash === fp.hash)
ok('指纹与登记项顺序无关',
  fingerprint([...reg].reverse()).hash === fp.hash)
ok('每条登记项都写明定义位置', reg.every(e => e.definedIn.length > 0))
ok('每条登记项都带证据等级',
  reg.every(e => ['ACCOUNTING', 'VALIDATED', 'OBSERVATION'].includes(e.tier)))

// 关键：改任一决策参数都必须导致指纹变化
const tampered = reg.map(e =>
  e.domain === 'POSITION_LIMIT' && e.key === 'singleStock' ? { ...e, value: 0.15 } : e
)
ok('把单票上限从12%改成15% → 指纹变化',
  fingerprint(tampered).hash !== fp.hash)
ok('该改动被定位到 POSITION_LIMIT 域',
  fingerprint(tampered).byDomain.POSITION_LIMIT !== fp.byDomain.POSITION_LIMIT)
ok('未改动的域指纹保持不变',
  fingerprint(tampered).byDomain.LEGAL_REASON === fp.byDomain.LEGAL_REASON)

// 新增一条法定理由（即"偷偷新增规则"的典型形态）必须被发现
const addedReason = [...reg, {
  domain: 'LEGAL_REASON' as const, key: 'TECHNICAL_BREAKDOWN', value: true,
  tier: 'OBSERVATION' as const, definedIn: '假想的越权改动',
}]
const addedFp = fingerprint(addedReason)
ok('新增一条规则 → 指纹变化且条数+1',
  addedFp.hash !== fp.hash && addedFp.entryCount === fp.entryCount + 1)

const fakeBaseline: FreezeBaseline = {
  frozenAt: '2026-08-13', tradingDays: 30,
  hash: fp.hash, entryCount: fp.entryCount, byDomain: fp.byDomain, tierCounts: fp.tierCounts,
  note: 'test',
}
const drift = detectDrift(fakeBaseline, addedFp)
ok('漂移检测报告 drifted=true', drift.drifted)
ok('漂移检测算出条数增量', drift.entryDelta === 1, String(drift.entryDelta))
ok('漂移检测识别出 OBSERVATION 等级规则增加',
  (drift.tierDelta.OBSERVATION ?? 0) === 1, JSON.stringify(drift.tierDelta))
ok('未漂移时报告 drifted=false', detectDrift(fakeBaseline, fp).drifted === false)

// 冻结基线必须已提交，否则冻结期无从核对
const realBaseline = loadBaseline()
ok('冻结基线文件存在', realBaseline !== null)
if (realBaseline) {
  ok('当前规则与已提交基线一致',
    detectDrift(realBaseline, fp).drifted === false,
    detectDrift(realBaseline, fp).detail)
  ok('基线记录了冻结起始日与天数',
    realBaseline.frozenAt.length === 10 && realBaseline.tradingDays > 0)
}

// 指纹须覆盖全部关键域
for (const d of ['LEGAL_REASON', 'POSITION_LIMIT', 'PRICE_WINDOW', 'VALUATION', 'UNIVERSE', 'GUARD']) {
  ok(`指纹覆盖 ${d} 域`, d in fp.byDomain)
}

// ───────────────────────────────────────────────────────────────
console.log('\n【不变量二】E3 不得用盈亏评判模型')
// ───────────────────────────────────────────────────────────────

// 类型层保证：E3Input 的成本快照字段里不含任何价格/盈亏字段。
// 这里用运行期断言兜底 —— 若将来有人往 CostSnapshot 加了 marketValue/pnl，测试会红。
const sampleCost: CostSnapshot = { code: '300308', name: '中际旭创', totalCost: 387000 }
const costKeys = Object.keys(sampleCost)
const forbiddenFields = ['marketValue', 'pnl', 'profitLoss', 'return', 'ret', 'price', 'changeRate', 'profitLossRate']
ok('成本快照不含市值/盈亏/收益率字段',
  !costKeys.some(k => forbiddenFields.some(f => k.toLowerCase().includes(f.toLowerCase()))),
  costKeys.join(','))

const e3Empty = computeE3({ audits: [] })
ok('E3 方法论明写不使用盈亏',
  e3Empty.methodology.includes('不使用盈亏'), e3Empty.methodology)

// 未授权买入检出：禁止建仓日总成本上升
const e3Input: E3Input = {
  audits: [
    {
      date: '2026-08-13', buyFrozen: true, allActionsHadLegalReason: true, ruleDrifted: false,
      costSnapshot: [{ code: '300308', name: '中际旭创', totalCost: 387000 }],
    },
    {
      date: '2026-08-14', buyFrozen: true, allActionsHadLegalReason: true, ruleDrifted: false,
      costSnapshot: [{ code: '300308', name: '中际旭创', totalCost: 587000 }],
    },
  ],
}
const e3 = computeE3(e3Input)
ok('禁止建仓期间成本上升 → 检出未授权买入',
  e3.unauthorizedBuys.length === 1 && e3.unauthorizedBuys[0].code === '300308',
  JSON.stringify(e3.unauthorizedBuys))
ok('未授权买入使该项检查不通过',
  e3.checks.find(c => c.name.includes('未授权买入'))?.passed === false)
ok('E3 合规率因此低于1', (e3.complianceRate ?? 1) < 1, String(e3.complianceRate))

// 价格波动不得被误判为买入（成本不变，市值随便变）
const e3PriceMove = computeE3({
  audits: [
    { date: '2026-08-13', buyFrozen: true, allActionsHadLegalReason: true, ruleDrifted: false,
      costSnapshot: [{ code: '300308', name: '中际旭创', totalCost: 387000 }] },
    { date: '2026-08-14', buyFrozen: true, allActionsHadLegalReason: true, ruleDrifted: false,
      costSnapshot: [{ code: '300308', name: '中际旭创', totalCost: 387000 }] },
  ],
})
ok('成本不变时不误报未授权买入', e3PriceMove.unauthorizedBuys.length === 0)
ok('无违规时 E3 合规率为1', e3PriceMove.complianceRate === 1)

// 允许建仓日的买入不算违规
const e3Allowed = computeE3({
  audits: [
    { date: '2026-08-13', buyFrozen: false, allActionsHadLegalReason: true, ruleDrifted: false,
      costSnapshot: [{ code: '300308', name: '中际旭创', totalCost: 387000 }] },
    { date: '2026-08-14', buyFrozen: false, allActionsHadLegalReason: true, ruleDrifted: false,
      costSnapshot: [{ code: '300308', name: '中际旭创', totalCost: 587000 }] },
  ],
})
ok('未处于禁止建仓状态时买入不算违规', e3Allowed.unauthorizedBuys.length === 0)

// 规则漂移也计入 E3
const e3Drift = computeE3({
  audits: [
    { date: '2026-08-13', buyFrozen: true, allActionsHadLegalReason: true, ruleDrifted: false, costSnapshot: [] },
    { date: '2026-08-14', buyFrozen: true, allActionsHadLegalReason: true, ruleDrifted: true, costSnapshot: [] },
  ],
})
ok('冻结期内规则漂移使 E3 检查不通过',
  e3Drift.checks.find(c => c.name.includes('漂移'))?.passed === false)

// ───────────────────────────────────────────────────────────────
console.log('\n【KPI】E1 执行率 / E2 数据完整度 / E4 延迟')
// ───────────────────────────────────────────────────────────────

const kpi = computeKpis({
  today: '2026-08-20',
  requiredActions: [
    { id: 1, reportDate: '2026-08-13', code: '688041', clause: '单票超限', requiredAction: 'REDUCE_TO_12', executed: true, executedAt: '2026-08-15' },
    { id: 2, reportDate: '2026-08-13', code: '300502', clause: '单票超限', requiredAction: 'REDUCE_TO_12', executed: true, executedAt: '2026-08-18' },
    { id: 3, reportDate: '2026-07-17', code: '688008', clause: '熔断减仓', requiredAction: 'REDUCE_30', executed: false, executedAt: null },
  ],
  dataChecks: [
    { name: '家庭年度刚性支出', present: false },
    { name: '净值峰值', present: true },
    { name: 'PE历史分位', present: true },
    { name: '资金结构数据', present: false },
  ],
  e3: { audits: [] },
})

ok('E1 执行率 = 2/3', Math.abs((kpi.e1.rate ?? 0) - 2 / 3) < 1e-9, String(kpi.e1.rate))
ok('E1 列出未执行项', kpi.e1.pending.length === 1 && kpi.e1.pending[0].code === '688008')
ok('E1 按挂账天数降序，最久者在前', kpi.e1.pending[0].ageDays === 34, String(kpi.e1.pending[0].ageDays))
ok('E2 数据完整度 = 2/4', Math.abs((kpi.e2.rate ?? 0) - 0.5) < 1e-9, String(kpi.e2.rate))
ok('E2 列出缺失项名称', kpi.e2.missing.includes('家庭年度刚性支出'))
ok('E4 延迟中位 = 3.5天（2天与5天）',
  kpi.e4.medianDays === 3.5, String(kpi.e4.medianDays))
ok('E4 最长延迟 = 5天', kpi.e4.maxDays === 5, String(kpi.e4.maxDays))
ok('E4 单列未执行项最久挂账天数（比中位数更能说明问题）',
  kpi.e4.oldestPendingDays === 34, String(kpi.e4.oldestPendingDays))

// 无 executed_at 时不得静默算出 0 延迟
const kpiNoTimestamp = computeKpis({
  today: '2026-08-20',
  requiredActions: [
    { id: 1, reportDate: '2026-08-13', code: '688041', clause: '单票超限', requiredAction: 'REDUCE', executed: true, executedAt: null },
  ],
  dataChecks: [], e3: { audits: [] },
})
ok('缺执行时间戳时 E4 判为无样本而非0天',
  kpiNoTimestamp.e4.medianDays === null && kpiNoTimestamp.e4.samples === 0)

// ───────────────────────────────────────────────────────────────
console.log('\n【审计记录】必含「为什么」与「为什么没有买」')
// ───────────────────────────────────────────────────────────────

const fakeReport: CockpitReport = {
  date: '2026-08-13',
  table: [
    { item: '执行债务', todayStatus: '7项未执行', light: 'RED', decision: '优先执行' },
  ],
  coreDecision: '优先清偿执行债务（7条未执行卖出指令），今日无新增建仓。',
  answers: [],
  actions: [
    {
      code: '688041', name: '海光信息', kind: 'REDUCE', reason: 'POSITION_LIMIT',
      reasonDetail: '仓位19.0% > 上限12.0%，超出7.0pct，需卖出约26.4万',
      notReason: ['不是因为对该标的的股价判断'],
      reviewTriggers: ['收于MA20下方'],
      size: { display: '约900股', value: 900, note: '换算' }, metrics: [],
    },
    {
      code: '300308', name: '中际旭创', kind: 'NONE', reason: 'NO_LEGAL_TRIGGER',
      reasonDetail: '有6项观察触发复核，但无任何法定理由成立 → 不动作',
      notReason: ['观察项不构成减仓理由'],
      reviewTriggers: ['收于MA20下方', '收于MA60下方', '20日跑输行业', '60日跑输行业', '20日跑输大盘', '下跌放量'],
      size: { display: '—', value: null, note: '无动作' }, metrics: [],
    },
  ],
  noNewEntry: { verdict: true, reasons: ['执行债务未清：7条卖出指令未执行', 'AI算力：TAIL_CHASE'] },
  disclosure: { headline: '本系统不预测涨跌', items: [] },
  dataGaps: ['家庭年度刚性支出未提供 → 安全垫无法判定'],
}

const audit = buildAudit({
  report: fakeReport,
  costSnapshot: [{ code: '688041', name: '海光信息', totalCost: 775000 }],
})

ok('审计记录执行债务条数', audit.actions.executionDebt === 7, String(audit.actions.executionDebt))
ok('审计记录新增建仓为0', audit.actions.newEntries === 0)
ok('审计记录法定减仓标的', audit.actions.legalReduces.map(r => r.name).join() === '海光信息')
ok('审计单列「技术复核但不动作」',
  audit.actions.reviewedNoAction.length === 1 && audit.actions.reviewedNoAction[0].name === '中际旭创')
ok('该类记录带观察项条数', audit.actions.reviewedNoAction[0].triggerCount === 6)
ok('审计含「为什么」逐条理由', audit.why.length === 2)
ok('减仓理由带具体数字', audit.why[0].includes('19.0%') && audit.why[0].includes('12.0%'))
ok('审计含「为什么没有买」', audit.whyNoBuy.length === 2)
ok('审计含数据缺口', audit.dataGaps.length === 1)
ok('审计带规则指纹', audit.rules.fingerprint.hash.length === 12)
ok('审计记录当日禁止建仓状态', audit.buyFrozen === true)
ok('审计带成本快照供次日比对', audit.costSnapshot.length === 1)

const md = renderAuditMarkdown(audit, kpi)
ok('Markdown 含「为什么？」小节', md.includes('### 为什么？'))
ok('Markdown 含「为什么没有买？」小节', md.includes('### 为什么没有买？'))
ok('Markdown 含数据缺口小节', md.includes('### 数据缺口'))
ok('Markdown 含规则指纹', md.includes(audit.rules.fingerprint.hash))
ok('Markdown 含 E3 方法论声明（防止后人用盈亏解读）',
  md.includes('不使用盈亏'))
ok('Markdown 含今日核心决策', md.includes(audit.coreDecision))
ok('Markdown 记下中际是「技术复核但不动作」',
  md.includes('技术复核但不动作') && md.includes('中际旭创'))

// 无 KPI 时不得静默省略小节 —— 省略会让三个月后的读者以为当天没统计过
const mdNoKpi = renderAuditMarkdown(audit)
ok('缺 KPI 时仍写出 KPI 小节并说明缺在哪里',
  mdNoKpi.includes('### KPI') && mdNoKpi.includes('需要执行台账'))

// 法定理由文本表不得出现在审计里被改写
ok('审计中的法定理由取自枚举文本表',
  audit.actions.legalReduces[0].reason === LEGAL_REASON_TEXT.POSITION_LIMIT)

// ───────────────────────────────────────────────────────────────
console.log('\n【变化台账】把核心输出从「谁可以买」改成「谁正在发生变化」')
// ───────────────────────────────────────────────────────────────

// 最小驾驶舱替身：只含变化检测会读到的字段
function fakeDash(over: Partial<Record<string, unknown>> = {}): Dashboard {
  const base = {
    date: '2026-08-13', session: 'POST_CLOSE' as const, sessionNote: '',
    headline: {} as Dashboard['headline'],
    marketStructure: {
      kind: 'DEEPENING' as const, headline: '', evidence: [], switchEvidence: '',
      tier: 'ACCOUNTING' as const, canGenerateAction: false as const,
    },
    holdings: [{
      code: '300308', name: '中际旭创', posPct: 0.098, ret1: 0, ret5: 0, ret20: -0.172,
      relMainline: -0.144, aboveMa20: false, aboveMa60: false, pePercentile: 0.6, peUsable: true,
      nodeShareArrow: '↑↑' as const, shareWithinNode: 0.673, industryPosition: '光模块',
      reviewTriggers: ['a', 'b'], legalReason: null, status: '观察' as const,
      systemAction: '不动作，仅复核', metrics: [],
    }],
    mainlines: [{
      mainlineId: 'optical', name: 'AI光通信', trend: '↓' as const, relStrength: '→' as const,
      volumeProxy: '↓' as const, profitStructure: '↑↑' as const, leaderStatus: '龙头承压',
      completeness: 0.33, verdict: '主线未失效', judgable: true, blockers: [], metrics: [],
    }],
    nodeStructure: {
      optical: [{
        mainlineId: 'optical', node: '光模块', npLevel: 8.51e9, levelShare: 0.687, delta4Q: 10.2,
        leaders: [], direction: '↑↑' as const, researchOnly: false, maxReportAgeDays: 135,
      }],
    },
    nextLayer: [{
      mainlineId: 'optical', node: '光芯片/CW激光器', members: [{ code: '688498', name: '源杰科技' }],
      strategyAllows: true, retiredMembers: [],
      industryTrend: '↓↓' as const, profitTrend: '↑↑' as const, nodeShare: 0.014,
      money: '?' as const, relStrength: '↓↓' as const, valuation: '历史分位 46%', evidenceTier: 'A',
      gates: { s0Discovered: true, s1Industry: false, s2Earnings: false, s3Valuation: true, moneyRadar: null },
      stage: '观察' as const, actionAllowed: false as const,
      actionBlockedBy: ['执行债务 7 笔未清偿', 'S1产业验证未完成'],
    }],
    actionZone: { mustExecute: [{ label: 'x', detail: 'y' }], allowedResearch: [], forbidden: [], newEntryCount: 0 },
    dataGaps: [], noCompositeScoreNote: '',
  }
  return { ...base, ...over } as unknown as Dashboard
}

const s1 = snapshotOf(fakeDash())
ok('快照覆盖五个 scope',
  new Set(s1.readings.map(r => r.scope)).size === 5,
  String(new Set(s1.readings.map(r => r.scope)).size))
ok('快照记录节点存量份额', s1.readings.some(r => r.field === '存量份额' && r.value === 0.687))
ok('快照记录S闸门通过数（缺失不计为通过）',
  s1.readings.find(r => r.field === 'S闸门')?.value === 2,
  String(s1.readings.find(r => r.field === 'S闸门')?.value))
ok('快照记录战略层许可', s1.readings.some(r => r.field === '战略层许可' && r.display === '允许'))

// 同一份数据求差 → 无变化
ok('相同快照求差结果为空', diffSnapshots(s1, s1).length === 0)

// 份额上升 0.014 → 0.030（委员会关心的 0→1→2→5 爬升）
const d2 = fakeDash({ date: '2026-08-14' })
d2.nextLayer[0].nodeShare = 0.03
d2.nodeStructure.optical[0].levelShare = 0.70
const s2 = snapshotOf(d2)
const ch = diffSnapshots(s1, s2)
ok('检出节点存量份额变化', ch.some(c => c.field === '存量份额' && c.from === '68.7%' && c.to === '70.0%'))
ok('数值变化附带 delta', ch.find(c => c.field === '存量份额')?.delta !== null)
ok('小幅份额爬升不被阈值过滤（1.6pct 级别也报出）',
  ch.some(c => c.field === '节点份额' && c.to === '3.0%'), JSON.stringify(ch.map(c => c.field)))

// 缺失↔有值 的转变须与数值变化区分
const d3 = fakeDash({ date: '2026-08-15' })
d3.holdings[0].peUsable = false
d3.holdings[0].pePercentile = null
const chMiss = diffSnapshots(s1, snapshotOf(d3))
ok('由有值变为不可用 → 标记为 DISAPPEARED',
  chMiss.find(c => c.field === 'PE历史分位')?.kind === 'DISAPPEARED')
const chBack = diffSnapshots(snapshotOf(d3), s1)
ok('由不可用变为有值 → 标记为 APPEARED',
  chBack.find(c => c.field === 'PE历史分位')?.kind === 'APPEARED')

// 状态类变化（非数值）不得伪造 delta
const d4 = fakeDash({ date: '2026-08-16' })
d4.mainlines[0].trend = '↑'
const chState = diffSnapshots(s1, snapshotOf(d4))
ok('箭头类变化标记为 STATE 且 delta 为 null',
  chState.find(c => c.field === '趋势')?.kind === 'STATE' &&
  chState.find(c => c.field === '趋势')?.delta === null)

// 新标的出现 / 消失
const d5 = fakeDash({ date: '2026-08-17' })
d5.holdings = []
const chGone = diffSnapshots(s1, snapshotOf(d5))
ok('持仓消失被检出', chGone.some(c => c.scope === 'HOLDING' && c.to === '（已消失）'))

// 渲染
ok('无前一日快照时明说无基准',
  renderChanges([], null, '2026-08-13').includes('无可比较基准'))
ok('无变化时明说"不是故障"',
  renderChanges([], '2026-08-12', '2026-08-13').includes('不是故障'))

// ── 发现台账 ──
let ledger = updateDiscovery({ updatedAt: '', entries: [] }, fakeDash())
ok('首次记录写入 firstSeen', ledger.entries[0].firstSeen === '2026-08-13')
ok('首次记录写入一条历史', ledger.entries[0].history.length === 1)

// 读数未变 → 不重复追加（否则30天后台账里90%是噪声）
ledger = updateDiscovery(ledger, fakeDash({ date: '2026-08-14' }))
ok('读数未变时不追加历史', ledger.entries[0].history.length === 1)
ok('但 lastSeen 前进', ledger.entries[0].lastSeen === '2026-08-14')

// 闸门跃迁 S1 核验完成
const adv = fakeDash({ date: '2026-08-28' })
adv.nextLayer[0].gates.s1Industry = true
adv.nextLayer[0].actionBlockedBy = ['执行债务 7 笔未清偿']
ledger = updateDiscovery(ledger, adv)
ok('闸门变化时追加历史', ledger.entries[0].history.length === 2)
const advances = stageAdvances(ledger)
ok('检出闸门跃迁（S0→S1）', advances.length === 1 && advances[0].to === 3,
  JSON.stringify(advances))
ok('跃迁记录带日期，供30天后回溯', advances[0].date === '2026-08-28')
ok('台账渲染写出跃迁记录',
  renderDiscovery(ledger, '2026-08-28').includes('通过闸门 2 → 3'))
ok('无跃迁时明说"这本身是信息"',
  renderDiscovery({ updatedAt: '', entries: [{
    key: 'k', mainlineId: 'optical', node: 'n', firstSeen: 'x', lastSeen: 'x', history: [],
  }] }, 'x').includes('这本身是信息'))

// 同日重跑覆盖而不重复
const rerun = updateDiscovery(ledger, adv)
ok('同日重跑不产生重复历史行', rerun.entries[0].history.length === 2)

// 变化台账不得产生动作，也不得引入阈值
const src = readFileSync(new URL('./changeLog.ts', import.meta.url), 'utf-8')
ok('changeLog.ts 不调用 makeAction', !/\bmakeAction\s*\(/.test(src))
ok('changeLog.ts 不 import 动作类型', !/from '\.\.\/cockpit\/types'/.test(src))

// 规则指纹不因变化台账而改变 —— 审计不是决策规则
ok('新增变化台账后规则指纹仍为冻结基线值',
  loadBaseline() === null || fingerprint().hash === loadBaseline()!.hash,
  `${fingerprint().hash} vs ${loadBaseline()?.hash}`)

console.log(`\n═══ 结果：${passed} 通过 / ${failed} 失败 ═══\n`)
if (failed > 0) process.exit(1)
