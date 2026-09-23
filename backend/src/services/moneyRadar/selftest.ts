/**
 * 资金驾驶舱（R-01）· 自检
 *
 *   npm run money:selftest
 *
 * 框架阶段没有真实数据，所以每一条判定都用合成数据验证：
 *   ① 指标层：缺失不当 0、水位样本不足时不出状态、资金池只在高于水位时累计；
 *   ② 状态机：连续确认、最短保持、异常日不跃迁、A2 缺失时挂"待确认"而不放行；
 *   ③ 背离：四项全满足才成立，缺方向性数据时只到"待确认"，方向性数据显示无流出时判为缩量上涨；
 *   ④ 迁移、核心股切换、国家队温度计；
 *   ⑤ 治理边界：不 import 动作构造器、不接 C 级、不改规则指纹。
 */

import { readdirSync, readFileSync } from 'node:fs'
import { findMember } from '../msr/universe'
import {
  THRESHOLDS, WATCHLIST, NATIONAL_TEAM_ETFS, UNIVERSE_CODE_DEFECTS,
  holdingCodes, basketOf, thresholdTransitionAllowed,
} from './config'
import { dm, synthDataSet, wobble, SYNTH_MARKET_TOTAL } from './fixtures'
import { computeMetrics, rawSeries, quantile, rollingMean, type DayMetrics } from './metrics'
import { PROVIDER_CANDIDATES, ROUTING, anyRealProviderWired } from './providers'
import { buildMoneyCockpitView, renderMoneyCockpit, entryObjects } from './radar'
import {
  checkDivergence, checkMigration, checkCoreSwitch, classifyNationalTeam, nationalTeamFlow,
} from './signals'
import { runStateMachine, type MoneyState } from './stateMachine'
import { DATA_GRADE_TEXT, DATA_KIND_GRADE, type DataKind, type MoneyObject } from './types'

let passed = 0
let failed = 0
const fails: string[] = []
function ok(name: string, cond: boolean, detail = '') {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; fails.push(`${name} ${detail}`); console.log(`  ✗ ${name} ${detail}`) }
}

const one = (code: string): MoneyObject => ({ id: `stock:${code}`, name: code, kind: 'STOCK', entry: 1, codes: [code], themeEtfs: [] })

console.log('\n═══ 资金驾驶舱 R-01 自检 ═══\n')

// ─────────────────────────── ① 指标层 ───────────────────────────
console.log('【指标层】')
{
  ok('滚动均值：窗口不足为 null', rollingMean([1, 2, 3], 5).every(v => v === null))
  ok('滚动均值：窗口内有 null 则为 null', rollingMean([1, null, 3, 4, 5], 3)[3] === null)
  ok('滚动均值：正常计算', rollingMean([1, 2, 3, 4, 5], 5)[4] === 3)
  ok('分位数忽略 null', quantile([null, 1, 2, 3, null], 0.5) === 2)
  ok('分位数：全 null 返回 null', quantile([null, null], 0.5) === null)

  const ds = synthDataSet(30, [
    { code: 'A', share: t => (t === 10 ? null : 0.01), price: () => 10 },
    { code: 'B', share: () => 0.02, price: () => 10 },
  ])
  const ra = rawSeries(one('A'), ds)
  ok('缺失成交额 → 当日份额为 null，不是 0', ra.share[10] === null && ra.amount[10] === null)
  const basket: MoneyObject = { id: 'basket:x', name: 'x', kind: 'BASKET', entry: 1, codes: ['A', 'B'], themeEtfs: [] }
  const rb = rawSeries(basket, ds)
  ok('篮子任一成分缺失 → 篮子当日成交额为 null，不用其余成分凑数', rb.amount[10] === null)
  ok('篮子正常日成交额为成分之和', Math.abs((rb.amount[11] ?? 0) - 0.03 * SYNTH_MARKET_TOTAL) < 1)

  const ds2 = synthDataSet(300, [{ code: 'A', share: t => 0.01 + wobble(t, 0.0005), price: () => 10 }])
  const m2 = computeMetrics(rawSeries(one('A'), ds2), ds2.market.map(d => d.totalAmount))
  ok('水位样本不足 120 日时标 INSUFFICIENT，不出分位', m2[100]!.basis === 'INSUFFICIENT' && m2[100]!.median === null)
  ok('样本 120–249 日时标 SHORT', m2[200]!.basis === 'SHORT')
  ok('样本满 250 日时标 FULL', m2[299]!.basis === 'FULL')

  const ds3 = synthDataSet(320, [{
    code: 'A', share: t => (t < 280 ? 0.01 + wobble(t, 0.0003) : 0.02), price: t => 10 + t * 0.01,
  }])
  const m3 = computeMetrics(rawSeries(one('A'), ds3), ds3.market.map(d => d.totalAmount))
  ok('资金池只在高于水位时累计', m3[319]!.pool > 0 && m3[319]!.persist >= 30)
  ok('资金池存量 ≈ 超额份额 × 全市场成交额（数量级正确）',
    m3[319]!.pool > 0.3 * 0.01 * SYNTH_MARKET_TOTAL && m3[319]!.pool < 50 * 0.01 * SYNTH_MARKET_TOTAL)
}

// ─────────────────────────── ② 状态机 ───────────────────────────
console.log('\n【状态机】')
const seq = (base: Partial<DayMetrics>, n: number) => Array.from({ length: n }, () => dm(base))
const run = (ms: DayMetrics[]) => runStateMachine(ms)
const last = (ms: DayMetrics[]) => { const r = run(ms); return { state: r.days.at(-1)!.state, pending: r.days.at(-1)!.pending, tr: r.transitions } }
{
  const warm = seq({}, 6)
  const hi = { s5: 0.012, s20: 0.0105 }

  ok('样本不足时状态为 NO_BASELINE', run([dm({ basis: 'INSUFFICIENT' })]).days[0]!.state === 'NO_BASELINE')
  ok('连续 3 日 5 日份额高于 75% 分位 → 启动', last([...warm, ...seq(hi, 3)]).state === 'START')
  ok('只有 2 日 → 不启动（连续确认）', last([...warm, ...seq(hi, 2), dm()]).state === 'LATENT')
  ok('5 日份额不高于 20 日份额 → 不启动',
    last([...warm, ...seq({ s5: 0.012, s20: 0.013 }, 3)]).state === 'LATENT')
  ok('异常日不跃迁', last([...warm, ...seq({ ...hi, anomaly: true }, 3)]).state === 'LATENT')

  const started = [...warm, ...seq(hi, 3)]
  ok('启动后最短保持 5 日：立即回落也不跃迁',
    last([...started, ...seq({ s5: 0.008 }, 4)]).state === 'START')
  const failedRun = last([...started, ...seq({ s5: 0.008 }, 8)])
  ok('启动后未站稳即回落 → 失败分支，回到潜伏',
    failedRun.state === 'LATENT' && failedRun.tr.some(t => t.from === 'START' && t.failed))

  const trendDay = { s5: 0.013, s20: 0.012, persist: 12 }
  ok('A2 同向流入 → 趋势', last([...started, ...seq({ ...trendDay, a2Inflow: true }, 6)]).state === 'TREND')
  const pend = last([...started, ...seq({ ...trendDay, a2Inflow: null }, 6)])
  ok('A2 缺失 → 停在启动并挂"待 A2 确认"，不放行', pend.state === 'START' && pend.pending === 'TREND_NEEDS_A2')
  const noFlow = last([...started, ...seq({ ...trendDay, a2Inflow: false }, 6)])
  ok('A2 明确无流入 → 停在启动，不挂待确认', noFlow.state === 'START' && noFlow.pending === null)

  const trend = [...started, ...seq({ ...trendDay, a2Inflow: true }, 6)]
  const fall = { s5: 0.008, s20: 0.009 }
  ok('趋势中份额跌破中位数 + A2 反向流出 → 撤离',
    last([...trend, ...seq({ ...fall, a2Outflow: true }, 6)]).state === 'RETREAT')
  const pr = last([...trend, ...seq({ ...fall, a2Outflow: null }, 6)])
  ok('A2 缺失 → 不判撤离，挂"待 A2 确认"', pr.state === 'TREND' && pr.pending === 'RETREAT_NEEDS_A2')
  ok('份额回落但无方向性流出 → 回到潜伏，不判撤离',
    last([...trend, ...seq({ ...fall, a2Outflow: false }, 6)]).state === 'LATENT')

  ok('份额仍高但价格响应衰减 → 衰竭',
    last([...trend, ...seq({ ...trendDay, a2Inflow: true, pr10: 0.2, pr10Mean60: 1 }, 6)]).state === 'EXHAUST')
  ok('5 日份额高于 95% 分位且涨幅处于自身 90% 分位以上 → 爆发',
    last([...trend, ...seq({ ...trendDay, a2Inflow: true, s5: 0.02, ret20: 0.3, ret20Q90: 0.2 }, 6)]).state === 'BURST')

  // 端到端：从合成行情一路算到状态
  const n = 320
  const ds = synthDataSet(n, [{
    code: 'A',
    share: t => (t < 280 ? 0.01 + wobble(t, 0.0003) : 0.02),
    price: t => 10 + t * 0.01,
    margin: t => 1e9 + (t < 280 ? 0 : (t - 279) * 1e7),
  }])
  const ms = computeMetrics(rawSeries(one('A'), ds), ds.market.map(d => d.totalAmount))
  const r = runStateMachine(ms)
  const path = r.transitions.map(x => x.to).join('→')
  ok('端到端：合成行情经历 潜伏 → 启动 → 趋势', /LATENT→START→TREND/.test(path), path)

  const dsNoA2 = synthDataSet(n, [{
    code: 'A', share: t => (t < 280 ? 0.01 + wobble(t, 0.0003) : 0.02), price: t => 10 + t * 0.01,
  }])
  const r2 = runStateMachine(computeMetrics(rawSeries(one('A'), dsNoA2), dsNoA2.market.map(d => d.totalAmount)))
  ok('端到端：没有 A2 数据时停在启动、挂待确认',
    r2.days.at(-1)!.state === 'START' && r2.days.at(-1)!.pending === 'TREND_NEEDS_A2')
}

// ─────────────────────────── ③ 高位背离 ───────────────────────────
console.log('\n【高位背离】')
{
  const base = {
    pool: 500e8, poolQ90: 400e8, persist: 58, maxPersistBefore: 40,
    s5: 0.018, s20: 0.02, ret20: 0.09, close: 99, high60: 100,
  }
  const mk = (margins: (number | null)[], extra: Partial<DayMetrics> = {}) =>
    margins.map(margin => dm({ ...base, margin, ...extra }))

  const falling = [110, 108, 106, 104, 102, 100]
  ok('四项全满足 → 高位背离', checkDivergence(mk(falling), 5).verdict === 'DIVERGENCE')
  ok('方向性数据全缺 → 只到"背离待 A2 确认"',
    checkDivergence(mk([null, null, null, null, null, null]), 5).verdict === 'DIVERGENCE_PENDING_A2')
  ok('方向性数据显示无流出 → 缩量上涨（可能锁仓），不升为背离',
    checkDivergence(mk([100, 101, 102, 103, 104, 105], { etfNet10: 5e8 }), 5).verdict === 'LOW_VOLUME_RISE')
  ok('融资未降但 ETF 净赎回 → 方向性确认成立',
    checkDivergence(mk([100, 101, 102, 103, 104, 105], { etfNet10: -5e8 }), 5).verdict === 'DIVERGENCE')
  ok('龙虎榜机构净卖出也可作为方向性确认',
    checkDivergence(mk([null, null, null, null, null, null], { instNet10: -3e8 }), 5).verdict === 'DIVERGENCE')
  ok('价格已不在高位 → 不是背离', checkDivergence(mk(falling, { close: 90 }), 5).verdict === 'NONE')
  ok('资金池不高、堆积也不长 → 不是背离',
    checkDivergence(mk(falling, { pool: 100e8, persist: 10 }), 5).verdict === 'NONE')
  ok('首段堆积（没有历史可比）不按持续天数判高位',
    checkDivergence(mk(falling, { pool: 100e8, maxPersistBefore: 0 }), 5).c1PoolHigh === false)
  ok('历史最长只是噪音级别（2 日）时，不按持续天数判"创纪录"',
    checkDivergence(mk(falling, { pool: 100e8, persist: 102, maxPersistBefore: 2 }), 5).c1PoolHigh === false)
  ok('历史上有过真实堆积（40 日）时，持续 58 日判为高位',
    checkDivergence(mk(falling, { pool: 100e8, persist: 58, maxPersistBefore: 40 }), 5).c1PoolHigh === true)
  ok('背离判定逐项写出依据', checkDivergence(mk(falling), 5).detail.length >= 4)
}

// ─────────────────────────── ④ 迁移、核心股、国家队 ───────────────────────────
console.log('\n【迁移 · 核心股 · 国家队】')
{
  const S = (s: MoneyState, n: number) => Array<MoneyState>(n).fill(s)
  const mm = (n: number, p: Partial<DayMetrics> = {}) => Array.from({ length: n }, () => dm(p))
  const n = 12
  const mig = checkMigration({ states: S('EXHAUST', n), metrics: mm(n) }, { states: S('TREND', n), metrics: mm(n) }, n - 1)
  ok('一出一进持续 10 日 → 迁移', mig.verdict === 'MIGRATION' && mig.days === 12)
  ok('没有 A2 两头同向 → 迁移只是推断', mig.confirmation === 'INFERRED')
  const conf = checkMigration(
    { states: S('RETREAT', n), metrics: mm(n, { a2Outflow: true }) },
    { states: S('TREND', n), metrics: mm(n, { a2Inflow: true }) }, n - 1)
  ok('A2 两头同向 → 迁移确认', conf.confirmation === 'CONFIRMED')
  ok('只出不进 → 退潮', checkMigration({ states: S('RETREAT', n), metrics: mm(n) }, { states: S('LATENT', n), metrics: mm(n) }, n - 1).verdict === 'EBB')
  ok('只进不出 → 扩散', checkMigration({ states: S('TREND', n), metrics: mm(n) }, { states: S('START', n), metrics: mm(n) }, n - 1).verdict === 'DIFFUSION')
  ok('不足 10 日 → 不判', checkMigration({ states: S('EXHAUST', 8), metrics: mm(8) }, { states: S('TREND', 8), metrics: mm(8) }, 7).verdict === 'NONE')

  const len = 60
  const members = {
    OLD1: Array.from({ length: len }, (_, t) => (t < 49 ? 100 : 40)),
    OLD2: Array.from({ length: len }, () => 80),
    NEW: Array.from({ length: len }, (_, t) => (t < 49 ? 20 : 1000)),
  }
  const cs = checkCoreSwitch(members, len - 1)
  ok('新股进入前 2 名并持续 10 日 → 核心股切换', cs.entrants.includes('NEW') && !cs.entrants.includes('OLD2'))
  ok('龙头集中度可计算', cs.concentrationNow !== null && cs.concentrationBefore !== null)

  const days = 300
  const codes = NATIONAL_TEAM_ETFS.map(e => e.code)
  const etfs = codes.map(code => ({
    code,
    share: (t: number) => 1e9 + t * 1e5 + (t === 280 ? 5e8 : 0) + (t >= 290 ? -3e8 : 0) + wobble(t, 1e5),
    close: () => 4,
  }))
  const ds = synthDataSet(days, [], etfs)
  const flow = nationalTeamFlow(ds, codes)
  const cls = classifyNationalTeam(flow)
  ok('国家队大额申购日 → 托底', cls[280] === 'RESCUE')
  ok('国家队大额赎回日 → 降温', cls[290] === 'COOL')
  const ds2 = synthDataSet(days, [], etfs.map((e, i) => (i === 0 ? { ...e, share: (t: number) => (t === 200 ? null : e.share(t)) } : e)))
  ok('任一只 ETF 当日缺数据 → 当日合计为 null，不用其余几只凑数', nationalTeamFlow(ds2, codes)[200] === null)
}

// ─────────────────────────── ⑤ 配置与数据源 ───────────────────────────
console.log('\n【配置 · 数据源】')
{
  const holdings = holdingCodes()
  ok('入口① 持仓读自账本，共 8 只', holdings.length === 8)
  ok('入口② 观察仓起始 7 只', WATCHLIST.length === 7)
  ok('观察仓全部在册（按已登记的代码更正）', WATCHLIST.every(w => basketOf(w.code) !== null))
  ok('英维克使用正确代码 002837', WATCHLIST.some(w => w.name === '英维克' && w.code === '002837'))

  const d = UNIVERSE_CODE_DEFECTS[0]!
  const stillWrong = findMember(d.registered)?.member.name === d.name
  ok('股票池代码缺陷仍在 universe.ts 中 —— 委员会修正后须删除 UNIVERSE_CODE_DEFECTS 这一条', stillWrong,
    stillWrong ? '' : '（universe.ts 已修正，请删除更正条目）')

  ok('国家队观察名单 18 只，代码为 6 位且不重复',
    NATIONAL_TEAM_ETFS.length === 18
    && NATIONAL_TEAM_ETFS.every(e => /^\d{6}$/.test(e.code))
    && new Set(NATIONAL_TEAM_ETFS.map(e => e.code)).size === 18)
  ok('国家队名单与持仓、观察仓不重叠',
    NATIONAL_TEAM_ETFS.every(e => !holdings.some(h => h.code === e.code) && !WATCHLIST.some(w => w.code === e.code)))

  ok('阈值状态为预登记，登记日 2026-09-23', THRESHOLDS.status === 'PRE_REGISTERED' && THRESHOLDS.registeredOn === '2026-09-23')
  ok('阈值状态只能向前：预登记 → 校准 → 冻结',
    thresholdTransitionAllowed('PRE_REGISTERED', 'CALIBRATED')
    && thresholdTransitionAllowed('CALIBRATED', 'FROZEN')
    && !thresholdTransitionAllowed('FROZEN', 'CALIBRATED')
    && !thresholdTransitionAllowed('PRE_REGISTERED', 'FROZEN'))
  ok('进入阈值高于退出阈值（滞后）', THRESHOLDS.bandHigh > 0.5)
  ok('每条规则裁定前至少 30 次触发', THRESHOLDS.minTriggersForVerdict >= 30)

  ok('数据分级没有 C 级', !Object.keys(DATA_GRADE_TEXT).includes('C'))
  ok('每一种数据都有分级', (Object.keys(ROUTING) as DataKind[]).every(k => DATA_KIND_GRADE[k] !== undefined))
  ok('东方财富登记中写明主力净流入不接入',
    PROVIDER_CANDIDATES.some(p => p.id === 'EASTMONEY_PUBLIC' && p.note.includes('不接入')))
  ok('Tushare 状态为等待 token（委员会推迟决定）',
    PROVIDER_CANDIDATES.some(p => p.id === 'TUSHARE' && p.status === 'PENDING_TOKEN'))
  ok('框架阶段没有真实数据源接好', anyRealProviderWired() === false)
  const weak = (Object.entries(ROUTING) as [DataKind, (typeof ROUTING)[DataKind]][]).filter(([, r]) => {
    const ids = [r.primary, ...r.check].filter((x): x is NonNullable<typeof x> => x !== null)
    const firstHand = ids.some(id => PROVIDER_CANDIDATES.find(p => p.id === id)?.firstHand)
    return !firstHand && new Set(ids).size < 2
  }).map(([k]) => k)
  ok('每一类数据要么有一手来源，要么有两个相互独立的来源交叉校验', weak.length === 0, weak.join(','))
  ok('没有一类数据的取数路线是空的',
    Object.values(ROUTING).every(r => r.primary !== null || r.check.length > 0))
}

// ─────────────────────────── ⑥ 装配与渲染 ───────────────────────────
console.log('\n【装配 · 渲染】')
{
  const objs = entryObjects()
  ok('入口① 含 8 只持仓与其主线篮子', objs[1].filter(o => o.kind === 'STOCK').length === 8 && objs[1].some(o => o.kind === 'BASKET'))
  ok('入口② 含 7 只观察股', objs[2].filter(o => o.kind === 'STOCK').length === 7)
  ok('同一篮子不在两个入口重复出现',
    objs[2].filter(o => o.kind === 'BASKET').every(b => !objs[1].some(a => a.id === b.id)))
  ok('入口③ 在行业数据源接入前为空', objs[3].length === 0)

  const v0 = buildMoneyCockpitView(null)
  ok('无数据时视图为 NOT_WIRED，全部对象标"数据源未接入"',
    v0.dataMode === 'NOT_WIRED' && v0.entries.flatMap(e => e.objects).every(o => o.dataStatus === 'NOT_WIRED'))
  ok('无数据时复核队列为空', v0.reviewQueue.length === 0)
  ok('证据等级为 OBSERVATION', v0.tier === 'OBSERVATION')
  ok('flags 全部为 false', Object.values(v0.flags).every(x => x === false))
  ok('视图 JSON 不含 score/rank/weight 字段名', !/"(score|rank|weight)"/i.test(JSON.stringify(v0)))

  const txt0 = renderMoneyCockpit(v0)
  ok('渲染写明数据源未接入、不产生动作', txt0.includes('数据源未接入') && txt0.includes('不产生动作'))
  ok('渲染登记英维克代码缺陷', txt0.includes('英维克') && txt0.includes('688292') && txt0.includes('002837'))

  // 合成一只背离的持仓，其余对象给平稳数据
  const all = [...new Set(Object.values(objs).flat().flatMap(o => o.codes))]
  const n = 400
  const target = holdingCodes()[0]!.code
  const stocks = all.map(code => code === target
    ? {
      code,
      share: (t: number) => (t < 300 ? 0.01 + wobble(t, 0.0003) : t < 385 ? 0.03 : 0.022),
      price: (t: number) => 10 + t * 0.02,
      margin: (t: number) => (t < 390 ? 1e9 + t * 1e6 : 1e9 + 390e6 - (t - 389) * 5e6),
    }
    : { code, share: (t: number) => 0.002 + wobble(t + code.length, 0.0001), price: () => 10 })
  const v1 = buildMoneyCockpitView(synthDataSet(n, stocks), 'FIXTURE')
  const tv = v1.entries[0]!.objects.find(o => o.id === `stock:${target}`)!
  ok('合成背离样本：判定为高位背离', tv.divergence === 'DIVERGENCE', `${tv.divergence} ${tv.stateText}`)
  ok('合成背离样本：排在复核队列第一位',
    v1.reviewQueue[0]?.id === `stock:${target}` && v1.reviewQueue[0]?.reviewClass === 'DIVERGENCE')
  ok('合成数据视图标为 FIXTURE', v1.dataMode === 'FIXTURE' && renderMoneyCockpit(v1).includes('合成数据'))
}

// ─────────────────────────── ⑦ 治理边界 ───────────────────────────
console.log('\n【治理边界】')
{
  const dir = new URL('./', import.meta.url)
  const files = readdirSync(dir).filter(f => f.endsWith('.ts') && f !== 'selftest.ts')
  const banned = ['makeAction', 'findLimitBreaches', 'computeCircuit', 'evaluateActions']
  const leaks = files.filter(f => {
    const imports = readFileSync(new URL(f, dir), 'utf-8').split('\n').filter(l => l.trimStart().startsWith('import')).join('\n')
    return banned.some(b => imports.includes(b))
  })
  ok('资金驾驶舱全部模块不 import 动作构造器与风控闸门', leaks.length === 0, leaks.join(','))
  ok('模块中不出现 C 级字段（主力 / 大单净流入）',
    files.every(f => !/mainNetInflow|bigOrder|superLarge/i.test(readFileSync(new URL(f, dir), 'utf-8'))))

  const { fingerprint } = await import('../governance/ruleRegistry')
  const { loadBaseline } = await import('../governance/freeze')
  const base = loadBaseline()
  const fp = fingerprint()
  ok('加入资金驾驶舱框架后规则指纹未变', !!base && fp.hash === base.hash, `${base?.hash} → ${fp.hash}`)
}

console.log(`\n═══ 结果：${passed} 通过 / ${failed} 失败 ═══\n`)
if (failed > 0) {
  for (const f of fails) console.log(`  ✗ ${f}`)
  process.exit(1)
}
