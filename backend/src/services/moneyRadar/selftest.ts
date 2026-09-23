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
  THRESHOLDS, WATCHLIST, NATIONAL_TEAM_ETFS,
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

  ok('10 日份额仍高但 10 日价格不涨，连续 3 日 → 衰竭（放量滞涨）',
    last([...trend, ...seq({ ...trendDay, s10: 0.013, a2Inflow: true, ret10: -0.01 }, 6)]).state === 'EXHAUST')
  ok('份额高且价格仍在推进 → 不判衰竭',
    last([...trend, ...seq({ ...trendDay, s10: 0.013, a2Inflow: true, ret10: 0.03 }, 6)]).state === 'TREND')
  ok('衰竭后价格重新推进 → 回到趋势',
    last([...trend, ...seq({ ...trendDay, s10: 0.013, a2Inflow: true, ret10: -0.01 }, 6),
      ...seq({ ...trendDay, s10: 0.013, a2Inflow: true, ret10: 0.03 }, 6)]).state === 'TREND')
  ok('融资余额当日未发布时，用最近已发布日判断方向（T+1 发布）', (() => {
    const ds = synthDataSet(300, [{
      code: 'A', share: () => 0.01, price: () => 10,
      margin: t => (t === 299 ? null : 1e9 + t * 1e6),
    }])
    const m = computeMetrics(rawSeries(one('A'), ds), ds.market.map(d => d.totalAmount))
    return m[299]!.margin === null && m[299]!.marginDelta10 !== null && m[299]!.a2Inflow === true
  })())
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
  ok('观察仓全部在册', WATCHLIST.every(w => basketOf(w.code) !== null))
  ok('英维克使用正确代码 002837', WATCHLIST.some(w => w.name === '英维克' && w.code === '002837'))
  ok('股票池中英维克已纠正为 002837（2026-09-23 委员会授权）',
    findMember('002837')?.member.name === '英维克' && findMember('688292') === null)
  ok('观察仓名称与股票池登记一致', WATCHLIST.every(w => findMember(w.code)?.member.name === w.name))

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

// ─────────────────────────── ⑦ 真实数据对齐规则 ───────────────────────────
console.log('\n【真实数据对齐】')
{
  const { alignStock, industryObjects, INDUSTRY_MIN_COVERAGE } = await import('./live')
  const { exchangeOf, inShSzUniverse } = await import('./fetch')
  const dates = ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04']
  const bars = [
    { date: '2026-09-02', close: 10, amount: 1e8 },
    { date: '2026-09-04', close: 11, amount: 2e8 },
  ]
  const margin = { '2026-09-04': { X: 5e8 }, '2026-09-03': null }
  const al = alignStock('X', bars, dates, margin)
  ok('上市前的日子记为缺失（null），不是 0', al[0]!.amount === null && al[0]!.close === null)
  ok('上市后腾讯不出行的日子按停牌：成交额 0、价格沿用前值', al[2]!.amount === 0 && al[2]!.close === 10)
  ok('正常交易日原样保留', al[3]!.amount === 2e8 && al[3]!.close === 11)
  ok('融资余额未发布的日子为 null', al[2]!.marginBalance === null && al[3]!.marginBalance === 5e8)

  ok('交易所识别：沪市 6/5 开头、深市 0/3/1 开头、北交所 4/8/92 开头',
    exchangeOf('600183') === 'sh' && exchangeOf('510300') === 'sh' && exchangeOf('002837') === 'sz'
    && exchangeOf('159915') === 'sz' && exchangeOf('920071') === 'bj' && exchangeOf('830799') === 'bj')
  ok('北交所不纳入两市份额计算', !inShSzUniverse('920071') && inShSzUniverse('300308'))

  const objs = industryObjects([
    { id: 'industry:a', code: 'a', name: '甲', members: ['1', '2', '3'], coverage: 1, usable: true },
    { id: 'industry:b', code: 'b', name: '乙', members: ['4'], coverage: 0.5, usable: false },
  ])
  ok('覆盖率不足的行业不进入入口③', objs.length === 1 && objs[0]!.entry === 3 && objs[0]!.kind === 'INDUSTRY')
  ok('行业覆盖率门槛为 95%', INDUSTRY_MIN_COVERAGE === 0.95)

  const n = 300
  const ds = synthDataSet(n, [
    { code: 'A', share: t => 0.01 + wobble(t, 0.0003), price: t => 10 + t * 0.01 },
  ])
  ds.aggregates = {
    'industry:z': ds.dates.map((date, t) => ({ date, code: 'industry:z', close: 100 + t, amount: 0.05 * SYNTH_MARKET_TOTAL, marginBalance: null })),
  }
  const agg = rawSeries({ id: 'industry:z', name: 'z', kind: 'INDUSTRY', entry: 3, codes: ['A'], themeEtfs: [] }, ds)
  ok('行业对象优先读预汇总序列', Math.abs((agg.share[10] ?? 0) - 0.05) < 1e-9 && agg.close[10] === 110)
}

// ─────────────────────────── ⑧ 校准 · 冻结 · 影子运行 ───────────────────────────
console.log('\n【校准 · 冻结 · 影子运行】')
{
  const bt = await import('./backtest')
  const sh = await import('./shadow')
  const { CALIBRATION } = await import('./config')

  ok('超额收益 = 对象涨幅 − 基准涨幅', Math.abs(bt.excessReturn([10, 11, 12], [100, 100, 105], 0, 2)! - (0.2 - 0.05)) < 1e-12)
  ok('未到期或缺数据时超额收益为 null', bt.excessReturn([10, 11], [100, 101], 0, 5) === null
    && bt.excessReturn([10, null, 12], [100, 100, 100], 1, 1) === null)

  const same = [{ date: 'd1', v: 0.1 }, { date: 'd1', v: 0.3 }]
  const ci1 = bt.clusteredBootstrap(same)
  ok('按交易日分组抽样：只有一个交易日时区间退化为该日均值', !!ci1 && Math.abs(ci1[0] - 0.2) < 1e-12 && Math.abs(ci1[1] - 0.2) < 1e-12)
  const spread = Array.from({ length: 60 }, (_, i) => ({ date: `d${i}`, v: i % 2 ? 0.02 : -0.02 }))
  ok('分组抽样结果可复现（确定性随机数）', JSON.stringify(bt.clusteredBootstrap(spread)) === JSON.stringify(bt.clusteredBootstrap(spread)))
  ok('均值为 0 的样本置信区间含 0', (() => { const c = bt.clusteredBootstrap(spread)!; return c[0] < 0 && c[1] > 0 })())

  const sp = bt.splitWindow(800)
  ok('样本切分：从水位满 250 日之后开始，样本内与样本外不重叠且首尾相接',
    sp.inSample[0] === THRESHOLDS.baselineWindow + 20 && sp.inSample[1] === sp.outOfSample[0] && sp.outOfSample[1] === 800)

  const h0 = bt.thresholdsHash()
  ok('阈值指纹稳定', h0 === bt.thresholdsHash())
  ok('阈值指纹不受状态字段影响', bt.thresholdsHash({ ...THRESHOLDS, status: 'FROZEN' }) === h0)
  ok('任何阈值取值改动都会改变指纹', bt.thresholdsHash({ ...THRESHOLDS, startConfirmDays: 4 }) !== h0)

  ok('卫生标准先于数据登记，且含六项', bt.HYGIENE_CRITERIA.registeredOn === '2026-09-23'
    && bt.hygiene([], 0, 1).length === 6)
  ok('每条规则都事先声明了预期方向', Object.values(bt.RULE_HYPOTHESIS).every(h => h.sign === 1 || h.sign === -1))

  // 端到端：合成数据上跑卫生检查与事件研究
  const n = 400
  const ds = synthDataSet(n, [
    { code: 'A', share: t => (t < 320 ? 0.01 + wobble(t, 0.0003) : 0.02), price: t => 10 + t * 0.01, margin: t => 1e9 + t * 1e6 },
    { code: 'B', share: t => 0.005 + wobble(t + 7, 0.0002), price: t => 10 + wobble(t, 0.1), margin: t => 5e8 },
  ])
  ds.market.forEach((m, t) => { m.close = 100 + t * 0.01 })
  const objs = bt.replayObjects(ds, [one('A'), one('B')])
  const hy = bt.hygiene(objs, 270, 335)
  ok('卫生检查逐项给出实测值', hy.every(h => typeof h.pass === 'boolean'))
  const ev = bt.collectEvents(objs, ds, 270, n)
  ok('事件研究能从回放中收集到规则事件', ev.some(e => e.rule === 'START'))
  const res = bt.eventStudy(ev, objs, ds)
  ok('触发少于 30 次的规则判为样本不足，不下结论',
    res.every(r => r.n >= THRESHOLDS.minTriggersForVerdict || r.verdict === 'INSUFFICIENT_SAMPLE'))

  // 影子台账
  const start = ds.dates[315]!
  const l1 = sh.updateLedger(null, objs, ds, start, h0)
  ok('影子台账只记录冻结日之后的事件', l1.events.every(e => e.date >= start))
  ok('影子台账记录了冻结后的启动事件', l1.events.some(e => e.rule === 'START' || e.rule === 'TREND'))
  const l2 = sh.updateLedger(JSON.parse(JSON.stringify(l1)), objs, ds, start, h0)
  ok('同一数据重跑不产生重复事件（幂等）', l2.events.length === l1.events.length)
  const firstFilled = l1.events.find(e => e.h20 !== null)
  const tampered = JSON.parse(JSON.stringify(l1)) as typeof l1
  if (firstFilled) tampered.events.find(e => e.key === firstFilled.key)!.h20 = 0.123
  const l3 = sh.updateLedger(tampered, objs, ds, start, h0)
  ok('已回填的结果不被重算覆盖（只增不改）', !firstFilled || l3.events.find(e => e.key === firstFilled.key)!.h20 === 0.123)
  ok('未到期的结果保持为空', l1.events.filter(e => ds.dates.indexOf(e.date) + 20 >= n).every(e => e.h20 === null))
  const sum = sh.summarize(l1)
  ok('台账摘要按规则汇总，并给出距 30 次触发还差多少', sum.rows.length === 7 && sum.rows.every(r => r.toVerdict >= 0))

  // 冻结完整性
  if (THRESHOLDS.status === 'FROZEN') {
    ok('阈值已冻结：必须有冻结记录', CALIBRATION !== null)
    ok('阈值已冻结：当前阈值指纹与冻结记录一致（冻结后未被改动）', CALIBRATION?.thresholdsHash === h0,
      `${CALIBRATION?.thresholdsHash} vs ${h0}`)
  } else {
    ok('阈值尚未冻结时不存在冻结记录', CALIBRATION === null)
  }
}

// ─────────────────────────── ⑨ 治理边界 ───────────────────────────
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
  ok('当前规则与冻结基线一致（资金驾驶舱不新增决策规则）', !!base && fp.hash === base.hash, `${base?.hash} → ${fp.hash}`)
}

console.log(`\n═══ 结果：${passed} 通过 / ${failed} 失败 ═══\n`)
if (failed > 0) {
  for (const f of fails) console.log(`  ✗ ${f}`)
  process.exit(1)
}
