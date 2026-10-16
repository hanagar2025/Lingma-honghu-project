/**
 * 全链路审计（委员会 2026-10-16 裁定 · 执行顺序第 5 步）
 *
 *   npm -w backend run ladder:audit
 *
 * 逐条核对四件事，并确认裁定列明「不处理」的事项没有被顺手改掉：
 *   一、没有重复名单：六份名单合并进一张主表，一只股票一行、来源全部保留；
 *   二、没有越级：层级由条件计算，来源、委员会点名、资金信号都不授予层级；
 *   三、没有隐藏买入权限：每日执行单不读名单主表、模拟层和资金哨兵，也不会出买入行；
 *   四、没有未经批准的自动卖出：执行单的卖出只来自 C 级清退指令与单票归位，均线规则不在调用链里；
 *   五、未触碰：熔断补足仍待峰值核验，板块 / 主题上限只显示，冠军与主线不变，规则指纹不变。
 *
 * 静态检查看 import 关系（含传递依赖），行为检查把「最想越权」的输入喂进去，看输出有没有变。
 * 任何一条失败，进程以 1 退出。
 */
import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, normalize, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findLimitBreaches } from '../cockpit/safety'
import { buildCard } from '../dailyDecision/card'
import { COMMITTEE_ORDERS } from '../dailyDecision/orders'
import type { DecisionInput } from '../dailyDecision/types'
import { sinaSymbol, verifyInput, type SinaRaw } from '../dailyDecision/verify'
import type { Action } from '../cockpit/types'
import { fingerprint } from './ruleRegistry'
import { loadBaseline } from './freeze'
import { findRenderedResearchLeaks } from './researchIsolation'
import { LEFT_RADAR } from '../moneyRadar/config'
import { COMBAT_MAINLINE_IDS, MAINLINES, RESEARCH_ONLY_MAINLINE_IDS, findMember } from '../msr/universe'
import { simulationProducesAction } from '../simulation/ma60'
import { loadLadderLedger } from '../ladder/ledger'
import { buildLadder, buyPermissionOf, ladderProducesAction } from '../ladder/registry'
import { renderLadder } from '../ladder/render'
import { SNAPSHOT_JSON, SNAPSHOT_TAG } from '../ladder/snapshot'
import { collectSources, loadPortfolio, type PortfolioLite, type SourcedName } from '../ladder/sources'
import type { GateCheck, LadderView } from '../ladder/types'

const HERE = dirname(fileURLToPath(import.meta.url))
const SERVICES = join(HERE, '..')
const SRC = join(SERVICES, '..')
const ROOT = join(SRC, '..', '..')

export const AUDIT_ID = 'AUD-1016'

type Group = 'DEDUP' | 'NO_SKIP' | 'NO_HIDDEN_BUY' | 'NO_AUTO_SELL' | 'UNTOUCHED'
export const GROUP_TEXT: Record<Group, string> = {
  DEDUP: '一、没有重复名单',
  NO_SKIP: '二、没有越级',
  NO_HIDDEN_BUY: '三、没有隐藏买入权限',
  NO_AUTO_SELL: '四、没有未经批准的自动卖出',
  UNTOUCHED: '五、裁定列明不处理的事项未被改动',
}

export interface AuditCheck {
  group: Group
  name: string
  /** null = 本环境无法核对（如没有 git 标签），不计失败但单独列出 */
  pass: boolean | null
  detail: string
  how: 'STATIC' | 'BEHAVIOR' | 'DATA'
}

// ─────────────────────────── import 关系 ───────────────────────────

function tsFiles(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true })
    .flatMap(e => e.isDirectory() ? tsFiles(join(dir, e.name)) : e.name.endsWith('.ts') ? [join(dir, e.name)] : [])
}

/** 一个文件直接 import 的本地模块（绝对路径）；含 `export … from` 与动态 import */
export function localImports(file: string): string[] {
  const text = readFileSync(file, 'utf-8').replace(/\/\*[\s\S]*?\*\//g, '')
  const specs = [
    ...text.matchAll(/^\s*(?:import|export)\b[^'"]*?from\s+['"]([^'"]+)['"]/gm),
    ...text.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm),
    ...text.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g),
  ].map(m => m[1]!)
  const out: string[] = []
  for (const s of specs) {
    if (!s.startsWith('.')) continue
    const base = normalize(join(dirname(file), s))
    const hit = [`${base}.ts`, join(base, 'index.ts'), base].find(p => p.endsWith('.ts') && existsSync(p))
    if (hit) out.push(hit)
  }
  return out
}

/** 传递依赖闭包 */
export function closure(entry: string): Set<string> {
  const seen = new Set<string>()
  const stack = [entry]
  while (stack.length) {
    const f = stack.pop()!
    if (seen.has(f)) continue
    seen.add(f)
    stack.push(...localImports(f))
  }
  return seen
}

const rel = (f: string) => relative(SERVICES, f).replace(/\\/g, '/')

// ─────────────────────────── 行为检查用的执行单输入 ───────────────────────────

function cardInput(over: Partial<DecisionInput> = {}): DecisionInput {
  const holdings = [
    { code: '688041', name: '海光信息', quantity: 2500, close: 200, barDate: '2026-10-09' },
    { code: '300502', name: '新易盛', quantity: 1000, close: 50, barDate: '2026-10-09' },
    { code: '002463', name: '沪电股份', quantity: 1000, close: 60, barDate: '2026-10-09' },
  ]
  const positionsValue = holdings.reduce((s, h) => s + h.quantity * h.close, 0)
  const cash = 3_000_000 - positionsValue
  return {
    date: '2026-10-09',
    ledgerAsOf: '2026-10-09',
    account: { stale: false, staleDays: 1, gaps: [] },
    snapshot: {
      date: '2026-10-09', brokerTotal: 3_000_000, cash, positionsValue, externalCash: 0,
      portfolioTotal: 3_000_000, peakAssets: 4_300_000, peakBasis: 'PORTFOLIO', peakVerified: false,
    } as DecisionInput['snapshot'],
    circuit: { drawdown: 1 - 300 / 430, equityCap: 0.30, sellOnly: false, level: 'NORMAL' },
    holdings,
    priceFailed: [],
    actions: [],
    noNewEntry: { verdict: false, reasons: [] },
    dataGaps: [],
    ...over,
  } as DecisionInput
}

function action(code: string, name: string, kind: Action['kind'], reason: string, value: number | null = 100): Action {
  return {
    code, name, kind, reason: reason as Action['reason'], reasonDetail: '', notReason: [], reviewTriggers: [],
    size: { display: '', value, note: '' }, metrics: [],
  } as Action
}

function verified(input: DecisionInput) {
  const s: Record<string, SinaRaw> = { sh000001: { prevClose: 3000, price: 3010, date: input.date } }
  for (const h of input.holdings) s[sinaSymbol(h.code)] = { prevClose: 1, price: h.close!, date: h.barDate! }
  return verifyInput(input, s, 'POST_CLOSE')
}

// ─────────────────────────── 审计 ───────────────────────────

export interface AuditInput {
  portfolio: PortfolioLite
  view: LadderView
  asOf: string
}

export function runAudit({ portfolio, view, asOf }: AuditInput): AuditCheck[] {
  const C: AuditCheck[] = []
  const add = (group: Group, how: AuditCheck['how'], name: string, pass: boolean | null, detail = '') => C.push({ group, how, name, pass, detail })
  const E = view.entries
  const radarCodes = new Set(LEFT_RADAR.flatMap(g => g.members.map(m => m.code)))
  const held = new Set(portfolio.positions.map(p => p.code))

  // ── 一、没有重复名单 ──
  const sources = collectSources(portfolio)
  const codes = E.map(e => e.code)
  add('DEDUP', 'DATA', '名单主表每只股票只出现一行（一个当前层级）', new Set(codes).size === codes.length,
    `${codes.length} 行，${new Set(codes).size} 只`)
  const sourceCodes = new Set([...sources.map(s => s.code), ...held])
  const missing = [...sourceCodes].filter(c => !codes.includes(c))
  add('DEDUP', 'DATA', '六份名单与账本持仓的每只股票都在主表里', missing.length === 0, missing.length ? `缺 ${missing.join('、')}` : `${sourceCodes.size} 只全覆盖`)
  const lost = E.filter(e => {
    const n = sources.filter(s => s.code === e.code).length
    return e.sources.length !== n
  })
  add('DEDUP', 'DATA', '合并重复时保留全部来源标签（不丢来源）', lost.length === 0,
    lost.length ? lost.map(e => e.name).join('、') : `${E.filter(e => e.sources.length > 1).length} 只多来源股票逐一保留`)
  add('DEDUP', 'DATA', '层级取值唯一且在 1–6 之间', E.every(e => Number.isInteger(e.level) && e.level >= 1 && e.level <= 6))
  const ledger = loadLadderLedger()
  const entered = new Set((ledger?.events ?? []).filter(x => x.kind === 'ENTER').map(x => x.code))
  add('DEDUP', 'DATA', '留痕台账覆盖主表每只股票，每条记录有规则、日期、来源、批准人', !!ledger
    && E.every(e => entered.has(e.code))
    && ledger.events.every(x => !!x.rule && !!x.date && Array.isArray(x.sources) && !!x.approver),
    ledger ? `台账 ${ledger.events.length} 条` : '台账不存在')

  // ── 二、没有越级 ──
  const l4 = E.filter(e => e.level === 4)
  add('NO_SKIP', 'DATA', '第 4 级（备选池）每只：作战主线、产业证据 / 盈利核验 / 主线归因三道分开且全过、有非资金观察计划',
    l4.every(e => e.scope === 'COMBAT' && e.gates.length === 3 && e.gates.every(g => g.pass === true) && e.plans.some(p => p.purpose !== 'MONEY')),
    l4.map(e => e.name).join('、') || '无')
  add('NO_SKIP', 'DATA', '三道闸门分开判定：产业证据、盈利核验、主线归因各有一项（不合并成「研究通过」）',
    E.filter(e => e.gates.length).every(e => ['INDUSTRY', 'EARNINGS', 'ATTRIBUTION'].every(id => e.gates.some(g => g.id === id))))
  add('NO_SKIP', 'DATA', '买入权限关闭时第 5 级为空', view.buyPermission.open || E.every(e => e.level !== 5))
  add('NO_SKIP', 'DATA', '未进股票池的股票最高到第 3 级', E.filter(e => e.scope === 'OUT_OF_UNIVERSE' && !held.has(e.code)).every(e => e.level <= 3))
  add('NO_SKIP', 'DATA', '只研究主线（AI电力）的股票最高到第 3 级、仓位为零', E.filter(e => e.scope === 'RESEARCH_ONLY').every(e => e.level <= 3 && !held.has(e.code)))
  add('NO_SKIP', 'DATA', 'C 级清退的股票最高到第 2 级', E.filter(e => e.retiredC && !held.has(e.code)).every(e => e.level <= 2))
  const radarOnly = E.filter(e => radarCodes.has(e.code) && !findMember(e.code))
  add('NO_SKIP', 'DATA', '只来自左侧雷达（无股票池档案）的股票全部停在第 3 级以内', radarOnly.every(e => e.level <= 3), `${radarOnly.length} 只`)
  const radarHigh = E.filter(e => radarCodes.has(e.code) && e.level >= 4 && e.level < 6)
  add('NO_SKIP', 'DATA', '雷达股票若在第 4 级，资格来自股票池核验，不来自雷达',
    radarHigh.every(e => { const m = findMember(e.code)?.member; return !!m && !!m.earningsVerified && m.mainlineAttributionVerified !== false }),
    radarHigh.map(e => e.name).join('、') || '无')
  // 行为：委员会点名、资金雷达、全景图都给一只虚构股票，看它能升到哪
  const fake: SourcedName[] = (['R02_PRESELECT', 'R01_RADAR', 'R01_WATCH', 'MAP_V1'] as const)
    .map(source => ({ code: '000000', name: '虚构股', tag: { source, group: '审计', since: asOf, by: '委员会' } }))
  const openAll = buildLadder({
    asOf, generatedAt: asOf, portfolio, decisions: [],
    buyPermission: { open: true, reasons: [] },
    s3Gates: Object.fromEntries([...sourceCodes, '000000'].map(c => [c, [{ id: 'S3', label: '第四级闸门（审计假设全过）', pass: true, detail: '' } as GateCheck]])),
    collect: p => [...collectSources(p), ...fake],
  })
  const f = openAll.entries.find(e => e.code === '000000')
  add('NO_SKIP', 'BEHAVIOR', '委员会点名 + 雷达 + 观察名单 + 全景图同时命中、且买入权限强制打开：未进股票池的股票仍停在第 3 级',
    !!f && f.level <= 3 && f.buyPermission === 'NONE', f ? `第 ${f.level} 级` : '未出现')

  // ── 三、没有隐藏买入权限 ──
  add('NO_HIDDEN_BUY', 'DATA', '账户买入权限关闭（生产买入未批准、交易所日历未接入、峰值待核验、执行债务）',
    !view.buyPermission.open && view.buyPermission.reasons.length >= 2, view.buyPermission.reasons.map(r => r.split('：')[0]).join('；'))
  add('NO_HIDDEN_BUY', 'DATA', '第 1–4 级买入权限全部为「无」；只有持仓按执行单管理',
    E.every(e => (e.level <= 4 ? e.buyPermission === 'NONE' : e.level === 5 ? e.buyPermission === 'APPLY_ONLY' : e.buyPermission === 'EXECUTION_CARD')))
  const lv5Open = openAll.entries.filter(e => e.level === 5)
  add('NO_HIDDEN_BUY', 'BEHAVIOR', '买入权限强制打开、第四级闸门全部假设通过时：第 5 级只给「只能申请」，且全部是作战主线、三道条件全过的股票池成员，没有雷达独有股',
    lv5Open.length > 0 && lv5Open.every(e => e.buyPermission === 'APPLY_ONLY' && e.scope === 'COMBAT' && !!findMember(e.code) && e.gates.every(g => g.pass === true)),
    lv5Open.map(e => e.name).join('、') || '第 5 级为空（检查空转）')
  const entries = ['dailyDecision/run.ts', 'cockpit/run.ts'].map(f => join(SERVICES, f))
  const chain = new Set(entries.flatMap(e => [...closure(e)]).map(rel))
  const forbidden = [...chain].filter(f => /^(ladder|simulation|moneyRadar)\//.test(f))
  const researchInChain = [...chain].filter(f => f.startsWith('research/')).length
  add('NO_HIDDEN_BUY', 'STATIC', '执行单调用链（dailyDecision/run.ts 与 cockpit/run.ts 的全部传递依赖）不含名单主表、模拟层、资金哨兵',
    forbidden.length === 0, forbidden.length ? forbidden.join('、')
      : `调用链 ${chain.size} 个模块；其中 ${researchInChain} 个研究模块是驾驶舱的阅读区，由 8/16 研究层隔离的行为证明覆盖（audit:selftest）`)
  const actionDirs = ['dailyDecision', 'cockpit', 'decision', 'tios', 'msr']
  const leaks = actionDirs.flatMap(d => tsFiles(join(SERVICES, d)))
    .filter(f => localImports(f).some(i => /^(ladder|simulation)\//.test(rel(i))))
  add('NO_HIDDEN_BUY', 'STATIC', '执行单、驾驶舱、决策层、交易操作系统、MSR 都不 import 名单主表与模拟层', leaks.length === 0, leaks.map(rel).join('、'))
  const buyIn = cardInput({ actions: [action('300394', '天孚通信', 'BUY', 'NEW_ENTRY'), action('688256', '寒武纪', 'BUY', 'NEW_ENTRY')] })
  const buyCard = buildCard(buyIn, verified(buyIn), 'POST_CLOSE', { orders: [] })
  add('NO_HIDDEN_BUY', 'BEHAVIOR', '即使驾驶舱给出买入动作且买入未锁，执行单也不出买入行（只写「规模由委员会定，未定前不买」）',
    buyCard.lines.every(l => l.side === 'SELL') && !/买入 \S+ \d+ 股/.test(buyCard.markdown))
  const outputs = ['share/decision/latest.md', 'share/decision/latest.json'].map(f => join(ROOT, f)).filter(existsSync)
  const markers = ['名单主表', 'L-01', 'SIM-MA60', 'MA60 模拟对照', '只观察，不具备建仓权限', '战略冻结期', '左侧雷达', '资金哨兵']
  const hit = outputs.flatMap(f => markers.filter(m => readFileSync(f, 'utf-8').includes(m)).map(m => `${relative(ROOT, f)}:${m}`))
  add('NO_HIDDEN_BUY', 'DATA', '最近一次执行单输出不含名单主表、模拟层、雷达锁的字样', outputs.length > 0 && hit.length === 0,
    outputs.length ? (hit.join('、') || `${outputs.length} 个文件`) : '找不到执行单输出')
  add('NO_HIDDEN_BUY', 'STATIC', '隔离表已登记名单主表与模拟层的字样，执行单出现即判泄漏',
    findRenderedResearchLeaks('{"x":"名单主表"}').length > 0 && findRenderedResearchLeaks('{"x":"MA60 模拟对照"}').length > 0)

  // ── 四、没有未经批准的自动卖出 ──
  const sellIn = cardInput({
    actions: [
      action('688041', '海光信息', 'REDUCE', 'POSITION_LIMIT', 700),
      action('300502', '新易盛', 'REDUCE', 'SECTOR_LIMIT', 300),
      action('002463', '沪电股份', 'REDUCE', 'THEME_LIMIT', 300),
      action('300502', '新易盛', 'REDUCE', 'MA60_BREAK', 600),
      action('002463', '沪电股份', 'REDUCE', 'HARD_STOP', 1000),
    ],
  })
  const sellCard = buildCard(sellIn, verified(sellIn), 'POST_CLOSE', { orders: [] })
  add('NO_AUTO_SELL', 'BEHAVIOR', '把板块超限、主题超限、跌破 MA60、硬止损动作喂给执行单：只出单票归位一笔',
    sellCard.lines.length === 1 && sellCard.lines[0]!.code === '688041', sellCard.lines.map(l => `${l.name}:${l.reason}`).join('；'))
  add('NO_AUTO_SELL', 'DATA', '委员会登记的执行单指令只有 C 级清退', COMMITTEE_ORDERS.every(o => o.reason.startsWith('C 级清退')),
    COMMITTEE_ORDERS.map(o => `${o.name}:${o.reason}`).join('；'))
  const ma = chain.has('tios/executionEngine.ts') || chain.has('tios/dailyReport.ts')
  add('NO_AUTO_SELL', 'STATIC', 'V1.0 均线卖出（tios/executionEngine.ts）不在执行单调用链里', !ma)
  const engineUsers = tsFiles(SERVICES).filter(f => localImports(f).some(i => rel(i) === 'tios/executionEngine.ts')).map(rel)
  add('NO_AUTO_SELL', 'STATIC', 'V1.0 均线卖出只被交易操作系统日报与自检引用', engineUsers.every(f => f.startsWith('tios/')), engineUsers.join('、'))
  const simUsers = tsFiles(SERVICES).filter(f => !rel(f).startsWith('simulation/') && rel(f) !== 'governance/ladderAudit.ts')
    .filter(f => localImports(f).some(i => rel(i).startsWith('simulation/'))).map(rel)
  add('NO_AUTO_SELL', 'STATIC', 'MA60 模拟层没有被任何业务模块引用', simUsers.length === 0, simUsers.join('、'))
  add('NO_AUTO_SELL', 'STATIC', '模拟层、名单主表声明不产生动作', simulationProducesAction() === false && ladderProducesAction() === false)
  const momentum = readFileSync(join(SERVICES, 'cockpit', 'momentum.ts'), 'utf-8')
  add('NO_AUTO_SELL', 'STATIC', '8/13 裁定仍生效：持仓势能模块不 import 动作构造器',
    !/import[^\n]*\b(makeAction|evaluateActions)\b/.test(momentum))

  // ── 五、未触碰 ──
  add('UNTOUCHED', 'DATA', '峰值仍待核验、执行债务未清（熔断降仓未标记完成）', portfolio.peakVerified === false && portfolio.pendingSells > 0,
    `peakVerified=${portfolio.peakVerified}，pendingSells=${portfolio.pendingSells}`)
  const cirIn = cardInput({ circuit: { drawdown: 0.3, equityCap: 0.1, sellOnly: true, level: 'LEVEL2' } as DecisionInput['circuit'] })
  const cirCard = buildCard(cirIn, verified(cirIn), 'POST_CLOSE', { orders: [] })
  add('UNTOUCHED', 'BEHAVIOR', '二级熔断 + 峰值待核验：执行单写「今日不执行、不撤销」，不出熔断卖出行，不恢复买入',
    cirCard.markdown.includes('今日不执行、不撤销') && cirCard.lines.length === 0 && cirCard.markdown.includes('不买入任何股票'))
  const conc = findLimitBreaches({
    snapshot: { portfolioTotal: 1_000_000 } as never,
    positions: Array.from({ length: 9 }, (_, i) => ({ code: `30000${i}`, name: `电子${i}`, marketValue: 100_000, sector: '电子', theme: 'AI' })) as never,
    asOf,
  })
  add('UNTOUCHED', 'BEHAVIOR', '板块 90%、主题 90% 但单票都不超 12%：风控闸门不生成减仓（上限只显示）', conc.length === 0)
  const riskMd = renderLadder(view, { pricedAt: 'x', sectors: [{ label: '电子', pct: 0.35, limit: 0.3 }], themes: [{ label: 'AI', pct: 0.5, limit: 0.45 }], note: '' })
  add('UNTOUCHED', 'BEHAVIOR', '独立风险提示保留：超限照常标出「超限（只显示，不自动出卖单）」', (riskMd.match(/超限（只显示，不自动出卖单）/g) ?? []).length === 2)
  const champs = MAINLINES.flatMap(m => m.members.filter(x => x.champion).map(x => x.code)).sort()
  const expected = ['002371', '002463', '002916', '300308', '300502', '603019', '688012', '688041']
  add('UNTOUCHED', 'DATA', '冻结冠军 8 只不变', champs.join() === expected.join(), champs.join('、'))
  add('UNTOUCHED', 'DATA', '作战主线与只研究主线不变', COMBAT_MAINLINE_IDS.join() === 'optical,semi,compute' && RESEARCH_ONLY_MAINLINE_IDS.join() === 'power')
  const snap = existsSync(SNAPSHOT_JSON) ? JSON.parse(readFileSync(SNAPSHOT_JSON, 'utf-8')) as { lists: { id: string; members: { code: string }[] }[] } : null
  const nowLists: Record<string, string[]> = {
    MSR_UNIVERSE: MAINLINES.flatMap(m => m.members.map(x => x.code)),
    R01_RADAR: LEFT_RADAR.flatMap(g => g.members.map(m => m.code)),
  }
  const drift = snap ? Object.entries(nowLists).filter(([id, cs]) => {
    const s = snap.lists.find(l => l.id === id)
    return !s || s.members.map(m => m.code).sort().join() !== [...cs].sort().join()
  }).map(([id]) => id) : ['快照不存在']
  add('UNTOUCHED', 'DATA', '股票池与左侧雷达名单与 10/16 规则快照一致（没有借名单治理增删股票）', drift.length === 0, drift.join('、'))
  const base = loadBaseline()
  const fp = fingerprint()
  add('UNTOUCHED', 'STATIC', '决策规则指纹与冻结基线一致', !!base && fp.hash === base.hash, `${base?.hash} → ${fp.hash}`)
  let tagOk: boolean | null = null
  let tagDetail = ''
  try {
    const sha = execSync(`git rev-parse ${SNAPSHOT_TAG}^{commit}`, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
    tagOk = sha.length > 0
    tagDetail = `${SNAPSHOT_TAG} → ${sha.slice(0, 8)}`
  } catch {
    tagDetail = '本环境没有该标签（浅克隆或未拉取标签），未核对'
  }
  add('UNTOUCHED', 'STATIC', '规则快照回滚标签存在', tagOk, tagDetail)
  return C
}

export function renderAudit(checks: AuditCheck[], asOf: string, commit: string): string {
  const failed = checks.filter(c => c.pass === false)
  const skipped = checks.filter(c => c.pass === null)
  const L: string[] = []
  L.push(`# 全链路审计 ${AUDIT_ID}（${asOf}）`, '')
  L.push(`> 委员会 2026-10-16 裁定执行顺序第 5 步。由 \`npm -w backend run ladder:audit\` 生成，代码版本 \`${commit}\`。`)
  L.push('> 静态检查看 import 关系（含传递依赖）；行为检查把最想越权的输入喂给执行单与名单主表，看输出是否变化。', '')
  L.push(`结论：${failed.length ? `${failed.length} 项未通过` : '全部通过'}（共 ${checks.length} 项，通过 ${checks.filter(c => c.pass === true).length}${skipped.length ? `，未能核对 ${skipped.length}` : ''}）`, '')
  for (const g of Object.keys(GROUP_TEXT) as Group[]) {
    L.push(`## ${GROUP_TEXT[g]}`, '')
    L.push('| 结果 | 检查 | 方式 | 说明 |', '|---|---|---|---|')
    for (const c of checks.filter(x => x.group === g)) {
      const r = c.pass === true ? '通过' : c.pass === false ? '未通过' : '未核对'
      const how = { STATIC: '静态', BEHAVIOR: '行为', DATA: '数据' }[c.how]
      L.push(`| ${r} | ${c.name} | ${how} | ${(c.detail || '—').replace(/\|/g, '/')} |`)
    }
    L.push('')
  }
  L.push('## 边界', '')
  L.push('- 本审计只证明「新加的名单主表、MA60 模拟、雷达权限锁没有接进执行单」，不替代线上验收：GitHub Actions 定时运行与 Pages 页面要在合并后另行核对。')
  L.push('- 不处理事项保持原状：二级熔断补足待峰值核验；板块 30% / 主题 45% 只显示；不换冠军、不调主线、不新增买入。')
  return `${L.join('\n')}\n`
}

async function main(): Promise<void> {
  const portfolio = loadPortfolio()
  const bj = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)
  const asOf = process.env.ASOF ?? bj
  const view = buildLadder({
    asOf, generatedAt: new Date().toISOString(), portfolio, decisions: [],
    buyPermission: buyPermissionOf(portfolio, { productionBuyApproved: false, exchangeCalendar: false }),
  })
  const checks = runAudit({ portfolio, view, asOf })
  let commit = 'unknown'
  try { commit = execSync('git rev-parse --short HEAD', { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() } catch { /* 无 git */ }
  const md = renderAudit(checks, asOf, commit)
  mkdirSync(join(ROOT, 'share', 'ladder'), { recursive: true })
  writeFileSync(join(ROOT, 'share', 'ladder', 'audit.json'), `${JSON.stringify({ id: AUDIT_ID, asOf, commit, checks }, null, 1)}\n`)
  writeFileSync(join(ROOT, '战略组合2026-2030', `全链路审计-${asOf}.md`), md)
  process.stdout.write(md)
  const failed = checks.filter(c => c.pass === false)
  process.stderr.write(`\n已写 share/ladder/audit.json 与 战略组合2026-2030/全链路审计-${asOf}.md：${checks.length} 项，未通过 ${failed.length}\n`)
  if (failed.length) process.exit(1)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(e => { process.stderr.write(`审计运行失败：${e instanceof Error ? e.stack : String(e)}\n`); process.exit(1) })
}
