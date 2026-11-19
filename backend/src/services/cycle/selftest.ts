/**
 * CY-01 自检：登记表、节点映射、证据采集、证据包、档案只增不改、研判与验证格式。不联网。
 *
 *   npm -w backend run cycle:selftest
 */
import { execFileSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  availabilityOf, changeOf, loadInputs, nextDisclosureDeadline,
  type R02View, type RawInputs,
} from './collect'
import { buildPackage, allEvidence, renderPackage } from './package'
import { NODE_ORDER, nodeMembers, unmappedUniverseNodes } from './nodes'
import { INDICATORS, CYCLE_RULES } from './registry'
import { archivePackage, archiveRecord, checkArchive, gitAppendOnlyProblems, readIndex, serialize, sha256 } from './archive'
import { validateJudgment, type JudgmentRecord, type VerificationRecord } from './judgment'
import { renderMappingDoc, renderRegisterDoc } from './render'
import { MAPPING_DOC, REGISTER_DOC } from './docPaths'
import { MAINLINES } from '../msr/universe'
import { RESEARCH_MODULES } from '../governance/researchIsolation'
import type { EvidencePackage } from './types'

let pass = 0
let fail = 0
function ok(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`) } else { fail++; console.log(`  ✗ ${name}${detail ? `：${detail}` : ''}`) }
}
const section = (s: string) => console.log(`\n【${s}】`)
const STARS = '*'.repeat(2)

const HERE = fileURLToPath(new URL('.', import.meta.url))
const ROOT = join(HERE, '..', '..', '..', '..')

section('一、登记表')
const ids = INDICATORS.map(i => i.id)
ok('指标编号唯一', new Set(ids).size === ids.length)
ok('五层齐全，每层至少一项', ['L1', 'L2', 'L3', 'L4', 'L5'].every(l => INDICATORS.some(i => i.layer === l)))
ok('现行规则只出现在组合层（L5），其余参数一律待裁定',
  INDICATORS.every(i => i.layer === 'L5' || (i.normal.status === 'PENDING' && i.deterioration.status === 'PENDING')))
ok('没有任何参数标为已裁定（委员会尚未裁定）', INDICATORS.every(i => i.normal.status !== 'APPROVED' && i.deterioration.status !== 'APPROVED'))
ok('现有模块没有的指标都标「缺数据源」', INDICATORS.filter(i => i.source == null).every(i => i.gaps.includes('SOURCE')))
ok('待裁定参数都在缺口里写明', INDICATORS.every(i => (i.normal.status !== 'PENDING' || i.gaps.includes('NORMAL_RANGE')) && (i.deterioration.status !== 'PENDING' || i.layer === 'L5' || i.gaps.includes('DETERIORATION'))))
ok('复核动作不含交易指令', INDICATORS.every(i => !/(?<!不)(买入|卖出|减仓|加仓)\s*\d/.test(i.reviewAction)))
ok('周期状态判定条件待裁定', CYCLE_RULES.status === 'PENDING')

section('二、产业节点')
ok('股票池每个成员都映射到节点（新增成员不会被静默漏掉）', unmappedUniverseNodes().length === 0, unmappedUniverseNodes().join('、'))
const members = nodeMembers()
const champions = MAINLINES.flatMap(m => m.members).filter(m => m.champion).map(m => m.code)
ok('八只冠军都在节点里', champions.length === 8 && champions.every(c => members.some(m => m.code === c)))
ok('每只股票只属于一个节点', new Set(members.map(m => m.code)).size === members.length)
ok('六个节点都有成员', NODE_ORDER.every(n => members.some(m => m.node === n)))
ok('电力节点只研究、仓位为零', members.filter(m => m.node === 'POWER').every(m => /只研究|研究对照/.test(m.scope)))

section('三、采集口径')
ok('半年报的下一期截止日是 10/31，三季报是次年 4/30', nextDisclosureDeadline('2026-06-30') === '2026-10-31' && nextDisclosureDeadline('2026-09-30') === '2027-04-30')
ok('季频：10/17 时半年报仍可用，11/1 时已过时', availabilityOf('QUARTERLY', '2026-06-30', '2026-10-17') === 'AVAILABLE' && availabilityOf('QUARTERLY', '2026-06-30', '2026-11-01') === 'STALE')
ok('日频：距今 7 天可用，8 天已过时', availabilityOf('DAILY', '2026-10-10', '2026-10-17') === 'AVAILABLE' && availabilityOf('DAILY', '2026-10-09', '2026-10-17') === 'STALE')
ok('没有日期即缺数据', availabilityOf('DAILY', null, '2026-10-17') === 'MISSING')
ok('变化方向只在两期都有时给出', changeOf(1, null) === null && changeOf(2, 1) === 'UP' && changeOf(1, 2) === 'DOWN' && changeOf(1, 1) === 'FLAT')

const view = (code: string, over: Partial<R02View> = {}): R02View => ({
  code, name: code, pePercentile3y: 0.5,
  latest: { reportDate: '2026-06-30', revenueYoy: 50, deductNetProfitYoy: 40 },
  quarters: [{ reportDate: '2026-06-30', netProfitYoy: 0.5, grossMargin: 30 }, { reportDate: '2026-03-31', netProfitYoy: 0.4, grossMargin: 29 }],
  cashConversion: 0.8,
  balanceYoy: { reportDate: '2026-06-30', inventory: 0.2, receivables: 0.3, contractLiab: 0.1, constructionInProgress: 0.5 },
  consensusPace: { ratio: 1, basis: '归母' },
  ret20: 0.05, ret60: 0.1, rs20: 0.01, rs60: 0.02, drawdown250: -0.1, ...over,
})
const synth = (views: R02View[], over: Partial<RawInputs> = {}): RawInputs => ({
  today: '2026-10-17',
  rerating: [{ file: 'R02.json', asOf: '2026-10-15', priceDate: '2026-10-15', views }],
  money: { file: 'money.json', asOf: '2026-10-16', objects: [{ id: 'stock:300308', name: '中际旭创', state: 'TREND', stateText: '趋势', divergence: 'NONE', dataStatus: 'OK' }] },
  ladderRisk: { file: 'ladder.json', risk: { pricedAt: '2026-10-16 16:00', sectors: [{ label: '电子', pct: 0.32, limit: 0.3, holdings: [{ code: '688041', name: '海光信息', pct: 0.113 }] }], themes: [] } },
  portfolio: { file: 'pf.json', asOf: '2026-10-12', pendingSells: 3, peakVerified: false },
  card: { file: 'card.md', marketDate: '2026-10-16', account: '账户：总资产 255.00万，股票 53.0%，现金 47.0%', circuit: '熔断：自峰值回撤 40.7%，按待核验峰值 430.00万 计达二级线' },
  facts: JSON.parse(readFileSync(join(HERE, 'data', 'facts.json'), 'utf8')).entries,
  ...over,
})
const GEN = '2026-10-17T10:00:00.000Z'
const base = buildPackage(synth([view('300308'), view('002463'), view('688041'), view('002371')]), GEN)
const evBase = allEvidence(base)

section('四、证据包')
ok('证据编号唯一', new Set(evBase.map(e => e.id)).size === evBase.length)
ok('每条证据都有出处与可得性', evBase.every(e => !!e.source.module && !!e.availability))
ok('六个节点逐一列出，每个都「未判定」，不自动给出 C0–C3', base.nodes.length === 6 && base.nodes.every(n => n.cycleState.state === null && n.cycleState.status === 'NOT_DETERMINED'))
ok('证据包声明不产生动作', base.producesAction === false)
const keys = JSON.stringify(base).match(/"(\w+)":/g)?.map(k => k.slice(1, -2)) ?? []
ok('证据包没有总分、权重、综合分字段', !keys.some(k => /^(score|totalScore|weight|weights|composite|overall)$/i.test(k)))
ok('R-02 未覆盖的股票逐项标「缺」，不补值', evBase.filter(e => e.code === '300502').every(e => e.availability === 'MISSING' && e.value === null))
ok('R-01 超过 7 天的资金状态标已过时，照样列出', (() => {
  const p = buildPackage(synth([view('300308')], { money: { file: 'm', asOf: '2026-09-29', objects: [{ id: 'stock:300308', name: '', state: 'TREND', stateText: '趋势', divergence: 'NONE', dataStatus: 'OK' }] } }), GEN)
  const e = allEvidence(p).find(x => x.id === 'L4-05:300308')
  return e?.availability === 'STALE' && e.value === 'TREND'
})())

const worse = buildPackage(synth([
  view('300308', { ret20: -0.5, ret60: -0.6, rs20: -0.4, rs60: -0.5, drawdown250: -0.7, latest: { reportDate: '2026-06-30', revenueYoy: -30, deductNetProfitYoy: -60 }, quarters: [{ reportDate: '2026-06-30', netProfitYoy: -0.8, grossMargin: 10 }, { reportDate: '2026-03-31', netProfitYoy: 0.4, grossMargin: 29 }] }),
  view('002463'), view('688041'), view('002371'),
]), GEN)
const strip = (p: EvidencePackage, node: string) => JSON.stringify(p.nodes.find(n => n.node === node))
ok('节点独立：光连接数据全面恶化，PCB、算力、设备、存储、电力的证据逐字节不变',
  ['PCB', 'COMPUTE', 'SEMI_EQUIP', 'STORAGE', 'POWER'].every(n => strip(base, n) === strip(worse, n)))
ok('节点独立：光连接恶化也不给出任何节点状态', worse.nodes.every(n => n.cycleState.state === null))

const blank = buildPackage(synth([], { money: null, ladderRisk: null, portfolio: null, card: null }), GEN)
ok('缺数据中性：全部输入缺失时，状态与有数据时相同（都未判定），不推出恶化也不推出解除',
  JSON.stringify(blank.nodes.map(n => n.cycleState)) === JSON.stringify(base.nodes.map(n => n.cycleState)))
ok('缺数据中性：缺数据条目没有变化方向', allEvidence(blank).filter(e => e.availability === 'MISSING').every(e => e.change === null))

const md = renderPackage(base, 'abc')
ok('证据包文本不含 Markdown 星号', !md.includes(STARS))
ok('证据包不显示金额（执行单的万元数字不进入证据包）', !/\d+(\.\d+)?\s*万(?!张)/.test(md.replace(/亿美元|万张/g, '')))
ok('证据包写明 JSON 指纹与边界', md.includes('SHA-256') && md.includes('不是熔断等级'))

section('五、事实与解读分栏')
const facts = synth([]).facts
ok('事实台账每条都有事件日期、来源日期、适用层、不能推出', facts.every(f => /^\d{4}-\d{2}-\d{2}$/.test(f.eventDate) && /^\d{4}-\d{2}-\d{2}$/.test(f.sourceDate) && !!f.layer && !!f.cannotInfer))
ok('事实与市场解读分在两栏，事实栏不含「担忧」「认为」', facts.every(f => !/担忧|认为|可能削弱/.test(f.fact)))
ok('「领先约 8 个月」登记为待检验假设，不是事实', facts.some(f => f.status === 'HYPOTHESIS' && f.interpretation?.includes('8 个月')))
ok('事实只挂在适用节点上：韩国存储只挂存储节点', base.nodes.filter(n => n.facts.includes('F-20261017-03')).map(n => n.node).join() === 'STORAGE')
ok('事实编号不重复', new Set(facts.map(f => f.id)).size === facts.length)

section('六、档案只增不改')
const tmp = mkdtempSync(join(tmpdir(), 'cy01-'))
const e1 = archivePackage(tmp, base)
ok('首份证据包落档，写 JSON 与可读文本并登记指纹', !!e1 && existsSync(join(tmp, e1.file)) && existsSync(join(tmp, e1.mdFile!)) && sha256(readFileSync(join(tmp, e1.file))) === e1.sha256)
ok('同日再生成不覆盖', archivePackage(tmp, { ...base, generatedAt: '2026-10-17T11:00:00.000Z' }) === null)
const e2 = archivePackage(tmp, { ...base, generatedAt: '2026-10-17T11:00:00.000Z' }, true)
ok('显式修订写 -r2，原件不动', e2?.file.endsWith('2026-10-17-r2.json') === true && sha256(readFileSync(join(tmp, e1!.file))) === e1!.sha256)
ok('档案校验通过（无 git）', checkArchive(tmp, { git: false }).problems.length === 0, checkArchive(tmp, { git: false }).problems.join('；'))

const pkgFile = e1!.file
const judgment = (over: Partial<JudgmentRecord> = {}): JudgmentRecord => ({
  id: 'J-2026-10-17-01', kind: 'JUDGMENT', version: 'V1.0', recordedAt: '', recordedBy: '自检',
  package: { file: pkgFile, sha256: e1!.sha256, asOf: '2026-10-17' },
  currentJudgment: '光连接价格线转弱、经营线仍强，先查估值与拥挤度',
  evidence: {
    supporting: [{ evidenceId: 'L3-04:300308', reading: '单季毛利率仍上升' }],
    opposing: [{ evidenceId: 'L4-02:300308:60', reading: '60 日跑输沪深 300' }],
    noise: [{ evidenceId: 'F-20261017-03', reading: '韩国存储不外推到光连接' }],
    missingConsidered: ['L3-10:OPTICAL'],
  },
  nodes: NODE_ORDER.map(n => n === 'OPTICAL'
    ? { node: n, state: 'C1' as const, reason: '价格领先回落、经营仍强', evidenceIds: ['L3-04:300308', 'L4-02:300308:60'] }
    : { node: n, state: 'UNDETERMINABLE' as const, reason: '证据不足', evidenceIds: [] }),
  confidence: { level: 'LOW', reason: '只有一只股票有完整数据' },
  scenarios: [
    { name: '判断成立', ifHolds: '三季报毛利率维持', earliestFalsifier: '三季报毛利率环比下降' },
    { name: '判断错误', ifHolds: '盈利预期开始下修', earliestFalsifier: '一致预期节奏跌破上一快照' },
  ],
  review: { conditions: ['三季报披露'], date: '2026-10-31' },
  decisions: [
    { scope: 'RESEARCH_ONLY', rule: null, text: '提高光连接 TPO 复核优先级；买入权限仍关闭' },
    { scope: 'EXISTING_AUTHORIZED_PROCESS', rule: '单票归位', text: '海光超限由执行单按单票归位处理' },
  ],
  verification: { status: 'PENDING', due: '2026-11-07' },
  producesAction: false, ...over,
})
const NOW = '2026-10-17T12:00:00.000Z'
const lookup = (f: string) => f === pkgFile ? { file: f, sha256: e1!.sha256, pkg: base } : null
ok('合规的研判通过校验', validateJudgment({ ...judgment(), recordedAt: NOW }, lookup).length === 0, validateJudgment({ ...judgment(), recordedAt: NOW }, lookup).join('；'))
const bad = (name: string, j: JudgmentRecord, needle: string) => {
  const errs = validateJudgment({ ...j, recordedAt: j.recordedAt || NOW }, lookup)
  ok(name, errs.some(e => e.includes(needle)), errs.join('；') || '未拦住')
}
bad('拦住：复核日期不晚于记录日（先落档，后看结果）', judgment({ review: { conditions: ['x'], date: '2026-10-17' } }), '复核日期必须晚于记录日')
bad('拦住：研判早于证据包生成', judgment({ recordedAt: '2026-10-17T09:00:00.000Z' }), '早于证据包生成')
bad('拦住：证据包指纹不符', judgment({ package: { file: pkgFile, sha256: 'x', asOf: '2026-10-17' } }), '指纹与档案不符')
bad('拦住：缺一个节点（六个节点须逐一给出）', judgment({ nodes: judgment().nodes.slice(1) }), '逐一给出')
bad('拦住：缺数据条目被引为支持', judgment({ evidence: { ...judgment().evidence, supporting: [{ evidenceId: 'L3-10:OPTICAL', reading: 'x' }] } }), '缺数据的条目不能')
bad('拦住：引用证据包里不存在的编号', judgment({ evidence: { ...judgment().evidence, supporting: [{ evidenceId: 'L9-99:x', reading: 'x' }] } }), '不在证据包里')
bad('拦住：给出 C2 却不引证据', judgment({ nodes: judgment().nodes.map(n => n.node === 'PCB' ? { ...n, state: 'C2' as const, evidenceIds: [] } : n) }), '须引用证据编号')
bad('拦住：C3 只有单层证据', judgment({ nodes: judgment().nodes.map(n => n.node === 'OPTICAL' ? { ...n, state: 'C3' as const, evidenceIds: ['L4-02:300308:60', 'L4-01:300308:60'] } : n) }), '多层证据')
bad('拦住：进入授权流程却挂非现行规则（MA60）', judgment({ decisions: [{ scope: 'EXISTING_AUTHORIZED_PROCESS', rule: 'MA60' as never, text: '跌破 60 日线减仓' }] }), '只限 C 级清退')
bad('拦住：建议含买入', judgment({ decisions: [{ scope: 'RESEARCH_ONLY', rule: null, text: '光连接回调可加仓' }] }), '买入类指令')
bad('拦住：建议写股数', judgment({ decisions: [{ scope: 'EXISTING_AUTHORIZED_PROCESS', rule: '单票归位', text: '卖出海光 100 股' }] }), '不写股数')
bad('拦住：只有一个情景', judgment({ scenarios: judgment().scenarios.slice(0, 1) }), '至少两个')
bad('拦住：研判里预填验证结论', judgment({ verification: { status: 'DONE' as never, due: '2026-11-07' } }), '只能是待验证')

const rec = archiveRecord(tmp, { ...judgment(), recordedAt: '2026-10-01T00:00:00.000Z' }, NOW)
ok('落档研判：记录时刻取落档时刻（不接受倒填）', rec.errors.length === 0 && JSON.parse(readFileSync(join(tmp, rec.entry!.file), 'utf8')).recordedAt === NOW, rec.errors.join('；'))
ok('同一编号不能重复落档', archiveRecord(tmp, judgment(), NOW).errors.some(e => e.includes('编号已存在')))
ok('编号日期须为落档日', archiveRecord(tmp, judgment({ id: 'J-2026-10-16-02' }), NOW).errors.some(e => e.includes('落档日')))

const v = (over: Partial<VerificationRecord> = {}): VerificationRecord => ({
  id: 'V-2026-11-07-01', kind: 'VERIFICATION', version: 'V1.0', recordedAt: '', recordedBy: '自检',
  judgment: { id: 'J-2026-10-17-01', file: rec.entry!.file, sha256: rec.entry!.sha256 },
  packages: [], outcome: 'FALSIFIED', nodes: [{ node: 'OPTICAL', outcome: 'FALSIFIED', observed: '毛利率下降' }],
  observed: '三季报毛利率环比下降', errorSources: ['LOGIC'], errorNote: '把价格回落读成拥挤，实为盈利拐点',
  lessons: '经营线先于价格线的情形需单列', producesAction: false, ...over,
})
ok('拦住：验证早于原研判', archiveRecord(tmp, v({ id: 'V-2026-10-17-01' }), '2026-10-17T11:59:00.000Z').errors.some(e => e.includes('晚于原研判')))
ok('拦住：证伪却不写错误来源', archiveRecord(tmp, v({ errorSources: [] }), '2026-11-07T08:00:00.000Z').errors.some(e => e.includes('错误来源')))
ok('拦住：回指研判的指纹不符', archiveRecord(tmp, v({ judgment: { id: 'J-2026-10-17-01', file: rec.entry!.file, sha256: 'x' } }), '2026-11-07T08:00:00.000Z').errors.some(e => e.includes('指纹')))
const vr = archiveRecord(tmp, v(), '2026-11-07T08:00:00.000Z')
ok('合规的验证落档，原研判文件不变', vr.errors.length === 0 && sha256(readFileSync(join(tmp, rec.entry!.file))) === rec.entry!.sha256, vr.errors.join('；'))
ok('档案校验通过：证据包 2、研判 1、验证 1', (() => { const r = checkArchive(tmp, { git: false }); return r.problems.length === 0 && r.counts.PACKAGE === 2 && r.counts.JUDGMENT === 1 && r.counts.VERIFICATION === 1 })())

const copy = (src: string) => {
  const d = mkdtempSync(join(tmpdir(), 'cy01-t-'))
  execFileSync('cp', ['-r', `${src}/.`, d])
  return d
}
const t1 = copy(tmp)
appendFileSync(join(t1, rec.entry!.file), ' ')
ok('篡改研判文件 → 指纹不符', checkArchive(t1, { git: false }).problems.some(p => p.includes('指纹不符')))
const t2 = copy(tmp)
const idx = readIndex(t2)
idx.entries[2]!.recordedAt = '2026-10-17T13:00:00.000Z'
writeFileSync(join(t2, 'share/cycle/index.json'), serialize(idx))
ok('改写索引历史条目 → 哈希链校验失败', checkArchive(t2, { git: false }).problems.some(p => p.includes('索引条目被改动')))
const t3 = copy(tmp)
writeFileSync(join(t3, 'share/cycle/judgments/J-2026-10-18-01.json'), '{}')
ok('绕过索引直接放文件 → 未登记索引', checkArchive(t3, { git: false }).problems.some(p => p.includes('未登记索引')))

const g = copy(tmp)
const sh = (...args: string[]) => execFileSync('git', args, { cwd: g, stdio: 'ignore' })
sh('init', '-q'); sh('config', 'user.email', 'x@y'); sh('config', 'user.name', 'x')
sh('add', '.'); sh('commit', '-qm', 'a')
ok('git 只增不改：正常追加无问题', gitAppendOnlyProblems(g).problems.length === 0 && gitAppendOnlyProblems(g).checked)
appendFileSync(join(g, e1!.file), ' ')
sh('commit', '-qam', 'b')
ok('git 只增不改：提交里修改已归档证据包 → 报出', gitAppendOnlyProblems(g).problems.some(p => p.includes('修改或删除了已归档文件')))

section('七、实际输入')
const real = buildPackage(loadInputs(ROOT, '2026-10-17'), GEN)
const realEv = allEvidence(real)
ok('读取 R-02 两个研究池', real.inputs.filter(i => i.module.startsWith('R-02 价格')).length === 2)
ok('实际证据编号唯一', new Set(realEv.map(e => e.id)).size === realEv.length)
ok('实际证据包不显示金额', !/\d+(\.\d+)?\s*万(?!张)/.test(renderPackage(real).replace(/亿美元|万张/g, '')))
ok('实际证据包六个节点都未判定', real.nodes.every(n => n.cycleState.state === null))

section('八、文档与隔离')
ok('映射表文档与登记表同步（改登记表后须运行 cycle:docs）', existsSync(join(ROOT, MAPPING_DOC)) && readFileSync(join(ROOT, MAPPING_DOC), 'utf8') === renderMappingDoc())
ok('指标登记表文档与登记表同步', existsSync(join(ROOT, REGISTER_DOC)) && readFileSync(join(ROOT, REGISTER_DOC), 'utf8') === renderRegisterDoc())
ok('文档不含 Markdown 星号', !renderMappingDoc().includes(STARS) && !renderRegisterDoc().includes(STARS))
const cycleFiles = ['types', 'nodes', 'registry', 'collect', 'package', 'judgment', 'archive', 'render', 'docPaths', 'run'].map(f => `cycle/${f}.ts`)
ok('cycle/ 模块全部登记在研究层隔离表', cycleFiles.every(f => (RESEARCH_MODULES as readonly string[]).includes(f)), cycleFiles.filter(f => !(RESEARCH_MODULES as readonly string[]).includes(f)).join('、'))
const src = cycleFiles.map(f => readFileSync(join(HERE, '..', f), 'utf8')).join('\n')
ok('cycle/ 不 import 动作构造器与风控闸门', !/import[^\n]*\b(makeAction|findLimitBreaches|computeCircuit|evaluateActions|buildCard)\b/.test(src))
ok('cycle/ 只读账本，不写账本', !/writeFileSync\([^)]*portfolio/.test(src))

console.log(`\n═══ 结果：${pass} 通过 / ${fail} 失败 ═══`)
if (fail) process.exit(1)
