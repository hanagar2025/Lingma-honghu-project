/**
 * 链上数据与定时汇总自检。全部离线：行情源用假的，脚本用假的，账本是编的。守六条：
 *   ① 环节与核心股名单同 scripts/ai-mainline-map.py 一致，不另起一份；
 *   ② 主力净流入、融资余额只增不改，改了留修订记录；盘中那一根日线不入库；
 *   ③ 给 bot 的仓位只有占比和净值指数，没有股数和金额；带股数和金额的汇总拒收；
 *   ④ bot 口令只能读链上数据、写汇总；决定只有策略方能写，否决只有委员会能做；
 *   ⑤ 盯线只报读数；附加条件缺数据时不算触发；
 *   ⑥ 脚本原样调用、原样留存；跑不成时说清原因，不编结果。
 */
import express from 'express'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Auth, type Role } from '../auth/auth'
import type { LedgerFile } from '../dailyDecision/ledger'
import { collectDaily, collectEarnings, collectIntraday, collectMargin, earningsDue } from './collect'
import { acceptDigest, DIGEST_SLOTS, listDigests, setDecision, setVeto, type DigestDoc } from './digest'
import { mountChain } from './routes'
import { ScriptRunner, mainlineIncomplete, type Spawn } from './scripts'
import { buildDecisionInput } from '../dailyDecision/input'
import { buildPlan } from '../dailyDecision/plan'
import { CHAIN_TASKS, ChainService, dueChainTasks, watchDue } from './service'
import { ChainStore } from './store'
import type { WatchLine } from './types'
import { CORE_CODES, OUTSIDE_SEGMENT, SEGMENTS, withHoldings } from './universe'
import { portfolioView, seriesView } from './view'
import { lineStatus, newlyBeyond, parseLines } from './watch'

let passed = 0
let failed = 0
function ok(cond: boolean, name: string): void {
  if (cond) passed++
  else failed++
  process.stdout.write(`  ${cond ? '✓' : '✗'} ${name}\n`)
}

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..', '..', '..', '..')
const dir = mkdtempSync(join(tmpdir(), 'honghu-chain-'))
const at = (bj: string): Date => new Date(`${bj.replace(' ', 'T')}:00+08:00`)

// ── 假行情源：80 个交易日，11/24（周二）是最新一天 ──

function tradingDays(end: string, n: number): string[] {
  const out: string[] = []
  const d = new Date(`${end}T00:00:00Z`)
  while (out.length < n) {
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) out.unshift(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() - 1)
  }
  return out
}
const DAYS = tradingDays('2026-11-24', 80)
const TODAY = '2026-11-24'
const priceOf = (code: string, i: number): number => 50 + (Number(code) % 17) + i * 0.1
/** 可调的假数据开关 */
const fake = { marginThrough: '2026-11-23', flowValue: 1_000_000, downCodes: new Set<string>(), tencentShift: 0, calls: 0, tencentBars: false, flowDown: false }

const json = (body: unknown): Response => new Response(JSON.stringify(body), { status: 200 })
const fakeFetch = (async (input: string | URL | Request): Promise<Response> => {
  fake.calls++
  const url = new URL(String(input))
  const q = url.searchParams
  const code = (q.get('secid') ?? '').split('.')[1] ?? ''
  if (url.pathname.endsWith('/stock/kline/get')) {
    if (fake.downCodes.has(code)) return new Response('', { status: 502 })
    const n = Number(q.get('lmt'))
    return json({ data: { name: `股票${code}`, klines: DAYS.slice(-n).map((d, k) => {
      const i = DAYS.length - Math.min(n, DAYS.length) + k
      const close = priceOf(code, i)
      return `${d},${close - 0.2},${close},${close + 0.5},${close - 0.5},${2_000_000_000 + i},1.00`
    }) } })
  }
  if (url.pathname.endsWith('/fflow/daykline/get')) {
    if (fake.flowDown) return new Response('', { status: 502 })
    return json({ data: { klines: DAYS.slice(-60).map((d, i) => `${d},${fake.flowValue + i}`) } })
  }
  if (url.pathname.endsWith('/ulist.np/get')) {
    if (url.hostname === 'push2.eastmoney.com') return new Response('', { status: 302 })
    return json({ data: { diff: (q.get('secids') ?? '').split(',').map(s => ({ f2: 60.5, f3: 1.25, f6: 900_000_000, f12: s.split('.')[1], f62: -30_000_000, f124: Date.parse('2026-11-24T11:30:00+08:00') / 1000 })) } })
  }
  if (url.hostname === 'web.ifzq.gtimg.cn' && fake.tencentBars) {
    const [sym, , , , n] = (q.get('param') ?? '').split(',')
    const c = sym!.slice(2)
    const rows = DAYS.slice(-Number(n)).map((d, k) => {
      const close = priceOf(c, DAYS.length - Math.min(Number(n), DAYS.length) + k)
      return [d, String(close - 0.2), String(close), String(close + 0.5), String(close - 0.5), '1000.00', {}, '1.00', '200000.00', '']
    })
    return json({ code: 0, data: { [sym!]: { qfqday: rows, qt: { [sym!]: ['51', `股票${c}`, c] } } } })
  }
  if (url.hostname === 'qt.gtimg.cn') {
    const body = url.pathname.replace('/q=', '').split(',').map(sym => {
      const c = sym.slice(2)
      const f = new Array<string>(40).fill('')
      f[3] = String(priceOf(c, DAYS.length - 1) + fake.tencentShift)
      f[4] = String(priceOf(c, DAYS.length - 2))
      f[30] = '20261124150003'
      return `v_${sym}="${f.join('~')}";`
    }).join('\n')
    return new Response(body, { status: 200 })
  }
  if (url.hostname === 'datacenter-web.eastmoney.com') {
    const report = q.get('reportName')
    const days = DAYS.filter(d => d <= fake.marginThrough).reverse().slice(0, Number(q.get('pageSize')))
    if (report === 'RPTA_WEB_RZRQ_GGMX') {
      const c = /SCODE="(\d{6})"/.exec(q.get('filter') ?? '')?.[1] ?? ''
      // 000977 假装不是两融标的
      return json({ result: { pages: 1, data: c === '000977' ? [] : days.map((d, i) => ({ DATE: `${d} 00:00:00`, RZYE: 1e9 - i * 1e6, RZMRE: 1e7, RZCHE: 9e6 })) } })
    }
    if (report === 'RPTA_RZRQ_LSHJ') return json({ result: { pages: 1, data: days.map((d, i) => ({ DIM_DATE: `${d} 00:00:00`, RZYE: 2e12 - i * 1e9, RZMRE: 1e11, RZCHE: 1e11 })) } })
    if (report === 'RPT_LICO_FN_CPD') return json({ result: { pages: 1, data: [
      { SECURITY_CODE: '300308', REPORTDATE: '2026-06-30 00:00:00', NOTICE_DATE: '2026-08-20 00:00:00', YSTZ: 10, SJLTZ: 20 },
      { SECURITY_CODE: '300308', REPORTDATE: '2026-09-30 00:00:00', NOTICE_DATE: '2026-10-25 00:00:00', YSTZ: 35.5, SJLTZ: -12.5 },
    ] } })
    if (report === 'RPT_PUBLIC_OP_NEWPREDICT') return json({ result: { pages: 1, data: [
      { SECURITY_CODE: '300308', REPORT_DATE: '2026-12-31 00:00:00', NOTICE_DATE: '2026-11-20 00:00:00', PREDICT_FINANCE: '扣除非经常性损益后的净利润', ADD_AMP_LOWER: 1, ADD_AMP_UPPER: 2 },
      { SECURITY_CODE: '300308', REPORT_DATE: '2026-12-31 00:00:00', NOTICE_DATE: '2026-11-20 00:00:00', PREDICT_FINANCE: '归属于上市公司股东的净利润', ADD_AMP_LOWER: 30, ADD_AMP_UPPER: 50 },
    ] } })
  }
  return new Response('', { status: 404 })
}) as typeof fetch
const SRC = { doFetch: fakeFetch, attempts: 1, backoffMs: 1 }

/** 编的账本：两只链内股票、一只链外，数字与任何真实账户无关 */
const LEDGER: LedgerFile = {
  asOf: '2026-11-24', cash: 123_457, externalCash: 0, peakAssets: 0,
  positions: [
    { code: '300308', name: '甲', quantity: 1300, cost: 50 },
    { code: '002463', name: '乙', quantity: 2700, cost: 40 },
    { code: '300750', name: '丙', quantity: 700, cost: 30 },
    { code: '688981', name: '丁', quantity: 0, cost: 30 },
  ],
}
const PRIVATE_WORDS = /quantity|shares|"cash"|"cost"|totalAssets|marketValue|peakAssets|123457/

async function main(): Promise<void> {
  process.stdout.write('\n【名单】\n')
  ok(SEGMENTS.length === 15 && CORE_CODES.length === 75 && new Set(CORE_CODES).size === 75, '15 个环节、75 只核心股，没有重复')
  let same = false
  try {
    execFileSync('python3', [join(REPO, 'scripts', 'chain-universe.py'), '--check'], { stdio: 'pipe' })
    same = true
  } catch { same = false }
  ok(same, '名单与 scripts/ai-mainline-map.py 逐只一致')
  const withOut = withHoldings(['300308', '300750'])
  ok(withOut.length === 16 && withOut[15]!.segment === OUTSIDE_SEGMENT && withOut[15]!.codes.join() === '300750', '持仓里不在名单内的股票并入「链外持仓」')
  ok(withHoldings(['300308']).length === 15, '持仓都在名单内时不多出环节')

  process.stdout.write('\n【累积存储】\n')
  const store = new ChainStore(dir)
  const t0 = at('2026-11-23 15:40')
  store.mergeSeries('300308', { name: '甲', bars: [{ date: '2026-11-20', open: 1, close: 10, high: 1, low: 1, amount: 1, pct: 0 }, { date: '2026-11-23', open: 1, close: 11, high: 1, low: 1, amount: 1, pct: 0.1 }], flow: [{ date: '2026-11-20', main: 5 }, { date: '2026-11-23', main: -7 }] }, t0)
  store.mergeSeries('300308', { flow: [{ date: '2026-11-23', main: -9 }, { date: '2026-11-24', main: 3 }] }, at('2026-11-24 15:40'))
  let s = store.series('300308')!
  ok(s.flow.length === 3 && s.flow[0]!.main === 5, '更早的主力净流入保留，不因源头不再给而丢失')
  ok(s.flow[1]!.main === -9 && s.revisions.length === 1 && s.revisions[0]!.from === -7 && s.revisions[0]!.to === -9, '同一天数值变了：新值生效，旧值进修订记录')
  ok(s.bars.length === 2 && s.name === '甲', '只并入主力时，日线和名称不动')
  store.mergeSeries('300308', { bars: [{ date: '2026-11-23', open: 1, close: 5.5, high: 1, low: 1, amount: 1, pct: 0.1 }, { date: '2026-11-24', open: 1, close: 6, high: 1, low: 1, amount: 1, pct: 0.09 }] }, at('2026-11-24 15:40'))
  s = store.series('300308')!
  ok(s.bars.map(b => b.close).join() === '10,5.5,6' && s.revisions.some(r => r.kind === 'bars'), '日线按源头最新一段覆盖（除权后前复权价会变），并留修订记录')
  ok(statSync(join(dir, 'chain', 'series', '300308.json')).mode % 0o1000 === 0o600, '数据文件只有服务账号能读')
  rmSync(join(dir, 'chain'), { recursive: true })

  process.stdout.write('\n【拉数】\n')
  const chainStore = new ChainStore(dir)
  const codes = ['300308', '002463', '000977', '300750']
  fake.downCodes.add('300750')
  let run = await collectDaily(chainStore, codes, { ...SRC, now: at('2026-11-24 11:35') })
  ok(run.asOf === '2026-11-23' && chainStore.series('300308')!.bars.slice(-1)[0]!.date === '2026-11-23', '盘中拉数：今天那一根是实时价，不入库')
  ok(run.ok === 3 && run.failed.length === 1 && run.failed[0]!.startsWith('300750 日线'), '取不到的记成缺，不补不猜；其余照常入库')
  fake.downCodes.clear()
  run = await collectDaily(chainStore, codes, { ...SRC, now: at('2026-11-24 15:35') })
  ok(run.asOf === TODAY && run.ok === 4 && run.failed.length === 0 && run.notes.length === 0, '收盘后拉数：到今天，四只都齐，两源收盘价一致')
  ok(chainStore.series('300308')!.bars.length === 80 && chainStore.series('300308')!.flow.length === 60, '首次拉取补足历史')
  fake.tencentShift = 1
  run = await collectDaily(chainStore, codes, { ...SRC, now: at('2026-11-24 15:36') })
  ok(run.notes.filter(n => n.includes('两源不一致')).length === 4, '第二来源的收盘价对不上：写进记录')
  fake.tencentShift = 0
  for (const c of codes) fake.downCodes.add(c)
  fake.tencentBars = true
  run = await collectDaily(chainStore, codes, { ...SRC, now: at('2026-11-24 15:37'), backfill: true })
  const viaTencent = chainStore.series('300308')!.bars
  ok(run.ok === 4 && run.failed.length === 0 && run.notes.length === 1 && run.notes[0]!.includes('4 只取自腾讯'), '东方财富日线取不到时改用腾讯，照实写明，不再拿腾讯核对它自己')
  ok(viaTencent.slice(-1)[0]!.date === TODAY && viaTencent.slice(-1)[0]!.amount === 2_000_000_000 && Math.abs(viaTencent.slice(-1)[0]!.pct - (priceOf('300308', 79) / priceOf('300308', 78) - 1)) < 1e-12 && viaTencent.length === 80, '腾讯日线：成交额换成元，涨跌幅用相邻收盘价算')
  fake.downCodes.clear()
  fake.tencentBars = false
  await collectDaily(chainStore, codes, { ...SRC, now: at('2026-11-24 15:38'), backfill: true })
  let before = fake.calls
  run = await collectDaily(chainStore, codes, { ...SRC, now: at('2026-11-24 15:39') })
  ok(run.ok === 4 && run.asOf === TODAY && fake.calls - before === 2, '已经齐到今天的不重拉：只拉第一只的日线定日期，再核一次第二来源')
  const many = ['300308', '002463', '000977', '300750', '688981', '002371', '688012', '688041']
  fake.flowDown = true
  before = fake.calls
  run = await collectDaily(chainStore, many, { ...SRC, now: at('2026-11-24 15:40'), backfill: true, concurrency: 1 })
  ok(run.ok === 0 && run.failed.length === 8 && run.failed.filter(f => f.includes('本轮不再试')).length === 5 && fake.calls - before === 8 + 3 + 1, '主力净流入连着三只取不到，这一轮不再去碰那个来源')
  fake.flowDown = false
  before = fake.calls
  run = await collectDaily(chainStore, many, { ...SRC, now: at('2026-11-24 15:45'), concurrency: 1 })
  // 第一只的日线 1 次；流向还缺的 4 只各 1 次；第二来源 1 次
  ok(run.ok === 8 && run.failed.length === 0 && fake.calls - before === 1 + 4 + 1, '下一轮只补缺的：日线不重拉，只补主力净流入')
  let margin = await collectMargin(chainStore, codes, { ...SRC, now: at('2026-11-24 08:20') })
  ok(margin.asOf === '2026-11-23' && chainStore.series('300308')!.margin.slice(-1)[0]!.date === '2026-11-23', '融资拉到上一交易日')
  ok(margin.notes.some(n => n.startsWith('000977 没有融资数据')) && chainStore.series('000977')!.margin.length === 0, '不是两融标的：记一笔，不算失败')
  fake.marginThrough = TODAY
  margin = await collectMargin(chainStore, codes, { ...SRC, now: at('2026-11-25 08:20') })
  ok(margin.asOf === TODAY && chainStore.market().margin.slice(-1)[0]!.date === TODAY, '次日早间：融资补到昨天')
  const snap = await collectIntraday(chainStore, codes, { ...SRC, now: at('2026-11-24 11:35') })
  ok(snap.ok === 4 && snap.notes[0]!.includes('push2delay') && chainStore.intraday(TODAY)[0]!.quotes['300308']!.main === -30_000_000, '盘中快照：实时入口不通就换备用入口')
  ok(chainStore.intraday(TODAY)[0]!.sourceAt === '2026-11-24 11:30:00', '快照带行情源自己报的时刻')
  const earn = await collectEarnings(chainStore, codes, { ...SRC, now: at('2026-11-24 08:20') })
  const e = chainStore.earnings()
  ok(e.earnings['300308']!.report === '2026-09-30' && Math.abs(e.earnings['300308']!.npYoy! + 0.125) < 1e-9, '业绩取最新一期，同比换成小数')
  ok(e.forecasts['300308']!.item.startsWith('归属于') && e.forecasts['300308']!.lower === 0.3, '业绩预告取归母净利那一条')
  ok(earn.notes[0]!.includes('002463'), '没有业绩报表的股票写进记录')
  ok(earningsDue(at('2026-10-14 08:20')) && !earningsDue(at('2026-11-24 08:20')) && earningsDue(at('2026-11-23 08:20')), '财报期每天拉业绩，其余时间只在周一拉')
  ok(chainStore.runs().length === 12 && chainStore.runs().every(r => r.task && r.at), '每次拉数留一行记录')

  process.stdout.write('\n【给 bot 的数据】\n')
  const segs = withHoldings(['300308', '002463', '300750']).map(x => ({ ...x, codes: x.codes.filter(c => codes.includes(c)) })).filter(x => x.codes.length)
  chainStore.saveDoc('flags', [
    { code: '300308', name: '甲', reason: '过期的登记', source: '自检', since: '2026-01-01', until: '2026-06-30' },
    { code: '002463', name: '乙', reason: '生效的登记', source: '自检', since: '2026-11-01', until: null },
  ])
  const view = seriesView(chainStore, segs, 70, at('2026-11-25 08:40'))
  const row = view.stocks['300308']!.rows.slice(-1)[0]!
  ok(view.asOf === TODAY && view.marginAsOf === TODAY && view.stocks['300308']!.rows.length === 70, '日线、融资各到哪一天写清楚')
  ok(row.date === TODAY && row.main !== null && row.margin !== null && view.stocks['000977']!.rows.slice(-1)[0]!.margin === null, '主力和融资按日期并到日线上，没有的那天是空')
  ok(view.flags.length === 1 && view.flags[0]!.code === '002463', '过期的供给冲击登记不再生效')
  ok(view.stocks['300308']!.earning?.report === '2026-09-30' && view.stocks['002463']!.earning === null, '业绩并入；没有的照实为空')
  ok(view.gaps.length === 0, '数据齐全时没有缺口')
  const partial = new ChainStore(mkdtempSync(join(tmpdir(), 'honghu-chain-b-')))
  ok(seriesView(partial, segs, 70).gaps.length === 4 && seriesView(partial, segs, 70).asOf === null, '一点数据都没有时：每只都写进缺口，不报日期')

  const prices = { '300308': 62, '002463': 55.5, '300750': 71 }
  const stocksValue = 1300 * 62 + 2700 * 55.5 + 700 * 71
  const total = stocksValue + 123_457
  let pv = portfolioView(LEDGER, prices, null, at('2026-11-24 16:20'))
  ok(pv.view.positions.length === 3 && Math.abs(pv.view.positions.reduce((a, p) => a + p.weight, 0) + pv.view.cashWeight - 1) < 1e-9, '占比加现金占比等于 100%；零股数的不算持仓')
  ok(Math.abs(pv.view.stockWeight - stocksValue / total) < 1e-9, '股票仓位算得对')
  ok(pv.view.navIndex === null && pv.view.gaps.some(g => g.includes('基准')), '净值基准没填：指数为空，并说明原因')
  pv = portfolioView(LEDGER, prices, { totalAssets: total / 1.05, at: '2026-11-24 09:37', highIndex: 100, setAt: '' }, at('2026-11-24 16:20'))
  ok(Math.abs(pv.view.navIndex! - 105) < 1e-6 && Math.abs(pv.newHigh! - 105) < 1e-6 && Math.abs(pv.view.navHigh! - 105) < 1e-6, '净值指数 = 现总资产 ÷ 基准 × 100；创新高时记下')
  ok(!PRIVATE_WORDS.test(JSON.stringify(pv.view)), '仓位视图里没有股数、现金和总资产')
  pv = portfolioView(LEDGER, { '300308': 62, '002463': 55.5 }, { totalAssets: total, at: '2026-11-24 09:37', highIndex: 108, setAt: '' })
  ok(pv.view.navIndex === null && pv.newHigh === null && pv.view.navHigh === 108 && pv.view.gaps.some(g => g.includes('丙')), '有持仓取不到价格：不出指数，不动最高值')
  ok(portfolioView(null, {}, null).view.gaps[0] === '还没有账本', '没有账本时照实说')

  process.stdout.write('\n【盯线】\n')
  const series = chainStore.series('300308')!
  const lastClose = series.bars.slice(-1)[0]!.close
  const line = (over: Partial<WatchLine>): WatchLine => ({ id: 'x', code: '300308', name: '甲', basis: 'close', op: 'below', level: lastClose + 1, and: null, action: '次日卖三分之一', source: '自检', ...over })
  let st = lineStatus(line({}), series, null)
  ok(st.beyond === true && st.hit === true && st.distance! < 0, '收盘价在固定价位下方：越线')
  st = lineStatus(line({ and: 'main_out' }), series, null)
  ok(st.beyond === true && st.andMet === false && st.hit === false, '越线但当天主力是净流入：附加条件不成立，不算触发')
  st = lineStatus(line({ and: 'main_out' }), series, { price: lastClose - 2, main: -1 })
  ok(st.andMet === true && st.hit === true && st.price === lastClose - 2, '盘中用现价和当日主力判定')
  st = lineStatus(line({ and: 'main_out' }), series, { price: lastClose - 2, main: null })
  ok(st.beyond === true && st.andMet === null && st.hit === null, '附加条件缺数据：不算触发，也不算没触发')
  const closes = series.bars.map(b => b.close)
  st = lineStatus(line({ level: 'ma20', op: 'above' }), series, null)
  ok(Math.abs(st.levelValue! - closes.slice(-20).reduce((a, b) => a + b, 0) / 20) < 1e-9 && st.beyond === true, '20 日线 = 最近 20 个收盘价的均值')
  st = lineStatus(line({ level: 'ma60' }), series, { price: 1, main: 0 })
  ok(Math.abs(st.levelValue! - (closes.slice(-59).reduce((a, b) => a + b, 0) + 1) / 60) < 1e-9 && st.beyond === true, '盘中的 60 日线把现价当作最新一根')
  st = lineStatus(line({ level: 'low60' }), series, { price: Math.min(...closes.slice(-59)), main: 0 })
  ok(st.beyond === true, '现价不高于此前的 60 日最低收盘价：创新低')
  st = lineStatus(line({ level: 'ma60' }), { ...series, bars: series.bars.slice(-30) }, null)
  ok(st.levelValue === null && st.beyond === null && st.hit === null, '日线不够 60 根：算不出，不猜')
  st = lineStatus(line({ and: 'margin_down' }), series, null)
  ok(st.andMet === false, '5 日融资没有下降：附加条件不成立')
  ok(lineStatus(line({}), null, null).beyond === null, '没有数据的股票：算不出')
  const parsed = parseLines([{ code: '300308', name: '甲', basis: 'close', op: 'below', level: 417.2, and: 'main_out', action: '次日卖三分之一', source: '半年计划第三节' }])
  ok(typeof parsed !== 'string' && parsed[0]!.id === '300308-417.2-below-close', '登记的线校验通过')
  ok(typeof parseLines([{ code: '300308', basis: 'close', op: 'below', level: 417.2, source: 'x' }]) === 'string', '不写规则原文的动作不收')
  ok(typeof parseLines([{ code: '300308', basis: 'close', op: 'below', level: 'ma30', action: 'a', source: 'x' }]) === 'string', '不认识的线不收')
  const withSell = parseLines([{ code: '300308', name: '甲', basis: 'close', op: 'below', level: 417.2, action: '次日卖三分之一', source: '半年计划第三节', sell: 'THIRD' }])
  ok(typeof withSell !== 'string' && withSell[0]!.sell === 'THIRD', '收盘跌破的线可以写卖出档位')
  ok(typeof parseLines([{ code: '300308', basis: 'close', op: 'below', level: 417.2, action: 'a', source: 'x', sell: 'QUARTER' }]) === 'string', '卖出档位只有全部、一半、三分之一')
  ok(typeof parseLines([{ code: '300308', basis: 'price', op: 'below', level: 417.2, action: 'a', source: 'x', sell: 'HALF' }]) === 'string' && typeof parseLines([{ code: '300308', basis: 'close', op: 'above', level: 417.2, action: 'a', source: 'x', sell: 'HALF' }]) === 'string', '盘中触价的线、向上突破的线不能带卖出档位')
  st = lineStatus(line({ sell: 'HALF' }), series, null)
  ok(st.sell === 'HALF' && st.barDate === series.bars.slice(-1)[0]!.date && lineStatus(line({ sell: 'HALF' }), series, { price: lastClose, main: 0 }).barDate === null, '线的状态带上卖出档位和收盘日；盘中的状态没有收盘日')
  const beyond = [lineStatus(line({ id: 'a' }), series, null), lineStatus(line({ id: 'b', level: 1 }), series, null)]
  ok(newlyBeyond(beyond, {}, TODAY).length === 1 && newlyBeyond(beyond, { a: TODAY }, TODAY).length === 0 && newlyBeyond(beyond, { a: '2026-11-23' }, TODAY).length === 1, '同一条线一天只报一次')

  process.stdout.write('\n【汇总留存】\n')
  const good = { date: TODAY, slot: 'close', title: '收盘汇总', generatedAt: '2026-11-24 16:20:05', asOf: TODAY, markdown: '# 收盘汇总\n\n读数', data: { holdings: [{ code: '300308', weight: 0.139, c: 3 }] }, source: 'honghu-digest' }
  let doc = acceptDigest(chainStore, good, at('2026-11-24 16:20'))
  ok(typeof doc !== 'string' && doc.revision === 1 && doc.decision === null && doc.veto === null, '收下一份汇总')
  ok(typeof acceptDigest(chainStore, { ...good, data: { holdings: [{ code: '300308', quantity: 1300 }] } }) === 'string', '带股数的汇总拒收')
  ok(typeof acceptDigest(chainStore, { ...good, data: { account: { deep: [{ totalAssets: 1 }] } } }) === 'string', '嵌在深处的总资产也拒收')
  ok(typeof acceptDigest(chainStore, { ...good, slot: 'order' }) === 'string' && typeof acceptDigest(chainStore, { ...good, markdown: ' ' }) === 'string', '不认识的时点、空正文都拒收')
  ok(typeof setDecision(chainStore, TODAY, 'close', '按规则不动') !== 'string' && typeof setVeto(chainStore, TODAY, 'close', '否决第 2 条') !== 'string', '策略方写决定，委员会写否决')
  doc = acceptDigest(chainStore, { ...good, markdown: '# 收盘汇总\n\n重算' }, at('2026-11-24 16:30'))
  ok(typeof doc !== 'string' && doc.revision === 2 && doc.decision?.text === '按规则不动' && doc.veto?.note === '否决第 2 条' && doc.markdown.includes('重算'), '重推只换内容，不抹掉已写的决定和否决')
  ok(setDecision(chainStore, TODAY, 'pre', 'x') === '没有这份汇总' && typeof setVeto(chainStore, TODAY, 'close', '') === 'string', '没有的汇总写不了决定；空的否决不收')
  const heads = listDigests(chainStore)
  ok(heads.length === 1 && heads[0]!.decided && heads[0]!.vetoed, '清单里看得到有没有决定和否决')
  ok(DIGEST_SLOTS.map(x => x.at).join() === '08:40,11:40,16:20,16:40,16:50' && DIGEST_SLOTS[4]!.weekday === 5, '五个时点：08:40、11:40、16:20、16:40，周五 16:50')

  process.stdout.write('\n【到点】\n')
  const ids = (now: Date, done: Record<string, string> = {}, tried: Record<string, number> = {}): string => dueChainTasks(now, done, tried).map(t => t.id).join()
  ok(ids(at('2026-11-24 08:19')) === '' && ids(at('2026-11-24 08:20')) === 'margin', '08:20 拉融资')
  ok(ids(at('2026-11-24 08:30'), {}, { margin: at('2026-11-24 08:25').getTime() }) === '' && ids(at('2026-11-24 08:35'), {}, { margin: at('2026-11-24 08:25').getTime() }) === 'margin', '融资没公布：隔 10 分钟再试')
  ok(ids(at('2026-11-24 08:56'), { margin: TODAY }) === 'alert-pre', '08:55 还没收到盘前汇总就提醒')
  ok(ids(at('2026-11-24 11:36')) === 'intraday' && ids(at('2026-11-24 15:36')) === 'daily' && ids(at('2026-11-24 16:23'), { daily: TODAY }) === 'scan', '11:35 盘中快照，15:35 日线，16:22 全市场扫描')
  ok(!ids(at('2026-11-24 17:06')).includes('alert-weekly') && ids(at('2026-11-27 17:06')).includes('alert-weekly'), '周度汇总只在周五催')
  ok(ids(at('2026-11-28 15:36')) === '' && ids(at('2026-11-24 15:36'), { daily: TODAY }) === '', '周末不做；做完的当天不重做')
  ok(CHAIN_TASKS.length === 9, '四项拉数加五个时点的未到提醒')
  ok(watchDue(at('2026-11-24 09:30'), 0) && watchDue(at('2026-11-24 14:59'), 0) && !watchDue(at('2026-11-24 12:00'), 0) && !watchDue(at('2026-11-24 15:01'), 0), '盯线只在连续竞价时段')
  ok(!watchDue(at('2026-11-24 10:04'), at('2026-11-24 10:00').getTime()) && watchDue(at('2026-11-24 10:05'), at('2026-11-24 10:00').getTime()), '盯线每 5 分钟一次')

  process.stdout.write('\n【调用脚本】\n')
  const calls: { command: string; args: string[]; env: Record<string, string>; cwd: string }[] = []
  let outcome: 'ok' | 'short' | 'fail' | 'nosave' | 'nopython' = 'ok'
  const fakeSpawn: Spawn = async (command, args, opts) => {
    calls.push({ command, args, env: opts.env, cwd: opts.cwd })
    if (outcome === 'nopython') return { code: null, stdout: '', stderr: 'spawn python3 ENOENT' }
    if (outcome === 'fail') return { code: 1, stdout: '', stderr: 'Traceback: 行情源不通' }
    if (outcome === 'ok' || outcome === 'short') {
      const kind = args[0]!.endsWith('ai-mainline-map.py') ? 'AI主线' : '全市场扫描'
      const out = join(opts.cwd, '战略组合2026-2030', '数据', kind)
      mkdirSync(out, { recursive: true })
      const missing = { kline: [], kline_backup: ['甲'], flow: outcome === 'short' ? ['甲', '乙'] : [], margin: ['丙'], earnings: false, ranking_from: outcome === 'short' ? '2026-11-23' : null, flow_short: outcome === 'short' }
      writeFileSync(join(out, `${args[2]}.json`), JSON.stringify({ last: args[2], triggers: { S1: { hit: false } }, missing }))
    }
    return { code: 0, stdout: '| 名次 | 环节 |\n', stderr: '' }
  }
  process.env.SECRET_FOR_SELFTEST = 'must-not-leak'
  const runner = new ScriptRunner(chainStore, { pyHome: REPO, spawn: fakeSpawn })
  ok(runner.ensure('mainline', TODAY).state === 'running', '没有输出就开始跑，不让请求等着')
  ok(runner.job('mainline', TODAY)?.state === 'running' && runner.job('scan', TODAY) === null, '在跑的任务查得到，查的人不用再触发一次')
  const job = await runner.runNow('mainline', TODAY)
  const work = join(dir, 'chain', 'py')
  ok(job?.state === 'done' && runner.ensure('mainline', TODAY).state === 'ready', '跑完后同一天不再重跑')
  ok(readFileSync(join(work, 'scripts', 'ai-mainline-map.py'), 'utf-8') === readFileSync(join(REPO, 'scripts', 'ai-mainline-map.py'), 'utf-8'), '脚本原样拷到私有目录运行，一个字不改')
  ok(existsSync(join(work, '战略组合2026-2030', '数据', 'AI主线', '2026-11-23.json')), '随包带来的历史读数补进去，连续天数接得上')
  ok(calls[0]!.command === 'python3' && calls[0]!.args.slice(1).join(' ') === `--last ${TODAY} --save` && calls[0]!.cwd === work, '按脚本自己的参数调用')
  ok(!JSON.stringify(calls[0]!.env).includes('must-not-leak') && Object.keys(calls[0]!.env).join() === 'PATH,LANG,PYTHONIOENCODING,PYTHONDONTWRITEBYTECODE', '脚本进程拿不到任何口令')
  const saved = chainStore.scriptOutput('mainline', TODAY) as { triggers?: unknown }
  ok(!!saved.triggers && chainStore.scriptText('mainline', TODAY)!.startsWith('| 名次'), '脚本存下的读数和打印的表格原样留存')
  await runner.runNow('scan', TODAY)
  ok(calls[1]!.args.includes('--cache') && calls[1]!.args[calls[1]!.args.indexOf('--cache') + 1] === join(work, 'cache'), '全市场扫描的缓存放在私有目录')
  outcome = 'fail'
  let bad = await runner.runNow('mainline', '2026-11-25')
  ok(bad?.state === 'failed' && bad.error!.includes('行情源不通') && chainStore.scriptOutput('mainline', '2026-11-25') === null, '脚本报错：留下原因，不存结果')
  ok(runner.ensure('mainline', '2026-11-25').state === 'failed' && calls.length === 3, '刚失败过不立刻重跑')
  outcome = 'nosave'
  bad = await runner.runNow('mainline', '2026-11-26')
  ok(bad?.error?.includes('没有存出') === true, '脚本没存出这一天的读数：照实说')
  outcome = 'nopython'
  bad = await runner.runNow('scan', '2026-11-26')
  ok(bad?.error?.includes('Python') === true, '服务器上没有 Python：说清要装什么')
  ok(new ScriptRunner(chainStore, { pyHome: null, spawn: fakeSpawn }).ensure('scan', '2026-11-27').state === 'running', '找不到脚本时也不让请求出错')
  ok(chainStore.runs(20).filter(r => r.task.startsWith('script-')).length >= 5, '每次调用脚本留一行记录')
  delete process.env.SECRET_FOR_SELFTEST
  outcome = 'ok'
  const dir2 = mkdtempSync(join(tmpdir(), 'honghu-chain-c-'))
  const lone = new ChainService({ dataDir: dir2, readLedger: () => null, notify: async () => undefined, isTrading: async () => true, log: () => undefined, source: SRC, spawn: fakeSpawn, pyHome: REPO })
  lone.store.mergeSeries('300308', { name: '甲', bars: [{ date: TODAY, open: 1, close: 10, high: 1, low: 1, amount: 1, pct: 0 }] })
  ok(lone.runner.prepare() === null && (lone.store.scriptOutput('mainline', '2026-11-23') as { triggers?: unknown } | null)?.triggers !== undefined, '随包带来的主线读数（含 triggers）启动后直接可查')
  ok(lone.ensureScript('mainline', '2026-11-20').error!.includes('只能生成最新收盘日'), '脚本没有“截至某日”的参数：不是最新收盘日的读数不去跑')
  ok(lone.ensureScript('mainline', TODAY, at('2026-11-24 14:00')).state === 'failed' && lone.ensureScript('mainline', TODAY, at('2026-11-25 10:00')).error!.includes('盘中价'), '盘中不跑主线脚本：那时最新一根日线是盘中价')
  ok(lone.ensureScript('scan', TODAY, at('2026-11-25 10:00')).state === 'running', '全市场扫描自带截止日参数，不受这条限制')
  ok(lone.ensureScript('mainline', TODAY, at('2026-11-25 08:40')).state === 'running', '收盘后到次日开盘前可以跑')
  await lone.runner.runNow('mainline', TODAY)
  await lone.runner.runNow('scan', TODAY)
  ok(lone.ensureScript('mainline', TODAY, at('2026-11-25 10:00')).state === 'ready', '已有的读数任何时候都能查')
  const dir3 = mkdtempSync(join(tmpdir(), 'honghu-chain-short-'))
  const logs: string[] = []
  const short = new ChainService({ dataDir: dir3, readLedger: () => null, notify: async () => undefined, isTrading: async () => true, log: m => { logs.push(m) }, source: SRC, spawn: fakeSpawn, pyHome: REPO })
  outcome = 'short'
  let spawned = calls.length
  ok((await short.runMainline(TODAY, false)) === false && calls.length - spawned === 1 && mainlineIncomplete(short.store.scriptOutput('mainline', TODAY)), '脚本带着缺项存了一份：照样留存，但记为不全')
  ok((await short.runMainline(TODAY, false)) === false && calls.length - spawned === 1, '后端自己的拉数还有缺（来源还断着）：不重跑脚本')
  ok((await short.runMainline(TODAY, true)) === false && calls.length - spawned === 2, '后端的拉数齐了（来源恢复）：重跑一次')
  outcome = 'ok'
  ok((await short.runMainline(TODAY, true)) === true && calls.length - spawned === 3 && !mainlineIncomplete(short.store.scriptOutput('mainline', TODAY)), '重跑拿到齐的读数，盖掉带缺项的那份')
  spawned = calls.length
  ok((await short.runMainline(TODAY, true)) === true && calls.length === spawned, '读数齐了就不再跑')
  outcome = 'short'
  await short.runMainline('2026-11-25', true)
  await short.runMainline('2026-11-25', true)
  await short.runMainline('2026-11-25', true)
  spawned = calls.length
  ok((await short.runMainline('2026-11-25', true)) === false && calls.length === spawned && logs.filter(l => l.includes('2026-11-25') && l.includes('重跑')).length === 2, '带缺项的读数一天最多重跑 2 次')
  outcome = 'ok'
  ok(!mainlineIncomplete({ last: TODAY }) && !mainlineIncomplete({ missing: { kline: [], flow: [], margin: ['丙'], flow_short: false } }) && mainlineIncomplete({ missing: { kline: ['300308'], flow: [], flow_short: false } }), '旧存档没有 missing 字段算齐；只缺融资不算不全（不是两融标的本来就没有）')
  rmSync(dir3, { recursive: true, force: true })
  const callsBefore = fake.calls
  const [p1, p2] = [lone.pullDaily(at('2026-11-24 15:35')), lone.pullDaily(at('2026-11-24 15:36'))]
  const [r1, r2] = [await p1, await p2]
  const callsOnce = fake.calls - callsBefore
  ok(r1 === r2 && lone.store.runs().filter(r => r.task === 'daily').length === 1, '两分钟内重复催日线：交回同一次的结果，不另拉一遍')
  await lone.pullDaily(at('2026-11-24 15:39'))
  ok(lone.store.runs().filter(r => r.task === 'daily').length === 2 && fake.calls - callsBefore - callsOnce < callsOnce / 10, '隔够时间再催才真拉，而且只补缺的')
  rmSync(dir2, { recursive: true, force: true })

  process.stdout.write('\n【权限】\n')
  const COMMITTEE = 'committee-token-000000000001'
  const AGENT = 'agent-token-0000000000000001'
  const BOT = 'bot-token-00000000000000000000000001'
  const authority = new Auth(join(dir, 'auth.json'), { committee: COMMITTEE, agent: AGENT, bot: BOT })
  ok(authority.roleFor(BOT) === 'BOT' && authority.roleFor(AGENT) === 'AGENT' && authority.roleFor(COMMITTEE) === 'COMMITTEE', '三种口令各是各的身份')
  ok(new Auth(join(dir, 'auth2.json'), { committee: COMMITTEE }).roleFor(BOT) === null, '没配 bot 口令时，它进不来')
  const pushed: string[] = []
  const service = new ChainService({
    dataDir: dir, readLedger: () => LEDGER, notify: async title => { pushed.push(title) }, isTrading: async () => true,
    log: () => undefined, source: SRC, spawn: fakeSpawn, pyHome: REPO,
  })
  const app = express()
  app.use(express.json())
  const auth = (...allowed: Role[]) => (req: express.Request, res: express.Response, next: express.NextFunction): void => {
    const role = authority.roleFor(/^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1] ?? '')
    if (!role) res.status(401).json({ error: '口令不对' })
    else if (!allowed.includes(role)) res.status(403).json({ error: '这个口令不能做这件事' })
    else { res.locals.role = role; next() }
  }
  // 账本接口照 index.ts 的权限写一份：bot 口令必须读不到
  app.get('/api/records', auth('AGENT', 'COMMITTEE'), (_req, res) => { res.json({ ledger: LEDGER }) })
  mountChain(app, { auth, chain: service, isTrading: async () => true, notify: async title => { pushed.push(title) } })
  const server = app.listen(0, '127.0.0.1')
  await new Promise(r => server.once('listening', r))
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  const call = async (token: string, method: string, path: string, body?: unknown): Promise<{ status: number; text: string }> => {
    const res = await fetch(`${base}${path}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) })
    return { status: res.status, text: await res.text() }
  }
  try {
    ok((await call('wrong', 'GET', '/api/chain/series')).status === 401, '没有口令读不了')
    ok((await call(BOT, 'GET', '/api/records')).status === 403, 'bot 口令读不到账本')
    const seriesRes = await call(BOT, 'GET', '/api/chain/series?days=30')
    ok(seriesRes.status === 200 && (JSON.parse(seriesRes.text) as { segments: unknown[] }).segments.length === 16, 'bot 读得到链上数据，持仓里链外的那只也在')
    const pf = await call(BOT, 'GET', '/api/chain/portfolio')
    ok(pf.status === 200 && !PRIVATE_WORDS.test(pf.text) && (JSON.parse(pf.text) as { positions: unknown[] }).positions.length === 3, 'bot 拿到的仓位只有占比')
    ok((await call(AGENT, 'PUT', '/api/chain/base', { totalAssets: 1, at: '2026-11-24 09:37' })).status === 403, '净值基准只有委员会能填')
    const baseRes = await call(COMMITTEE, 'PUT', '/api/chain/base', { totalAssets: 250_000, at: '2026-11-24 09:37' })
    ok(baseRes.status === 200 && !baseRes.text.includes('250000') && readFileSync(join(dir, 'chain', 'base.json'), 'utf-8').includes('250000'), '基准金额只落在服务器，不回显')
    const pf2 = JSON.parse((await call(BOT, 'GET', '/api/chain/portfolio')).text) as { navIndex: number | null }
    ok(typeof pf2.navIndex === 'number' && pf2.navIndex > 0, '填了基准后有净值指数')
    ok((await call(COMMITTEE, 'PUT', '/api/chain/base', { totalAssets: -1, at: '2026-11-24 09:37' })).status === 400, '基准不是正数不收')
    ok((await call(BOT, 'PUT', '/api/chain/watch', { lines: [] })).status === 403, 'bot 不能登记盯线')
    const lines = [{ code: '300308', name: '甲', basis: 'close', op: 'below', level: 9999, and: null, action: '次日卖三分之一', source: '自检' }]
    ok((await call(AGENT, 'PUT', '/api/chain/watch', { lines })).status === 200, '策略方登记盯线')
    const watch = JSON.parse((await call(BOT, 'GET', '/api/chain/watch')).text) as { statuses: { beyond: boolean; action: string }[] }
    ok(watch.statuses.length === 1 && watch.statuses[0]!.beyond === true && watch.statuses[0]!.action === '次日卖三分之一', 'bot 读得到线的状态和规则原文的动作')
    ok((await call(COMMITTEE, 'POST', '/api/digest', good)).status === 403, '委员会口令不能推汇总')
    ok((await call(AGENT, 'POST', '/api/digest', { ...good, slot: 'scan' })).status === 200 && (JSON.parse((await call(BOT, 'GET', `/api/digest/${TODAY}/scan`)).text) as DigestDoc).by === 'AGENT', '机器人缺席时策略方可以手动补推，并记下是谁推的')
    const posted = await call(BOT, 'POST', '/api/digest', { ...good, slot: 'pre', push: '盘前核对' })
    ok(posted.status === 200 && pushed.includes('收盘汇总'), 'bot 推汇总；带短讯时推到手机')
    await call(BOT, 'POST', '/api/digest', { ...good, slot: 'pre', push: '盘前核对' })
    ok(pushed.filter(p => p === '收盘汇总').length === 1, '重推不重复打扰')
    ok((await call(BOT, 'POST', '/api/digest', { ...good, data: { cash: 1 } })).status === 400, '带现金的汇总拒收')
    ok((await call(BOT, 'POST', `/api/digest/${TODAY}/pre/decision`, { text: 'x' })).status === 403 && (await call(COMMITTEE, 'POST', `/api/digest/${TODAY}/pre/decision`, { text: 'x' })).status === 403, '决定只有策略方能写')
    ok((await call(AGENT, 'POST', `/api/digest/${TODAY}/pre/decision`, { text: '按规则不动' })).status === 200, '策略方写决定')
    ok((await call(BOT, 'POST', `/api/digest/${TODAY}/pre/veto`, { note: 'x' })).status === 403 && (await call(AGENT, 'POST', `/api/digest/${TODAY}/pre/veto`, { note: 'x' })).status === 403, '否决只有委员会能做')
    ok((await call(COMMITTEE, 'POST', `/api/digest/${TODAY}/pre/veto`, { note: '否决' })).status === 200, '委员会否决')
    const got = JSON.parse((await call(COMMITTEE, 'GET', `/api/digest/${TODAY}/pre`)).text) as DigestDoc
    ok(got.decision?.text === '按规则不动' && got.veto?.note === '否决' && got.by === 'BOT', '汇总、决定、否决存在一处')
    ok((await call(BOT, 'GET', '/api/digest/2026-11-24/order')).status === 404 && (await call(BOT, 'POST', '/api/chain/jobs/order')).status === 404, '没有下单接口')
    // 执行单的指令簿
    ok((await call(BOT, 'GET', '/api/orders')).status === 403 && (await call(BOT, 'POST', '/api/orders', {})).status === 403, 'bot 读不到指令簿，也登记不了指令')
    ok((await call(COMMITTEE, 'POST', '/api/orders', { code: '300308', side: 'SELL', sell: 'HALF', reason: 'x', source: 'x' })).status === 403, '委员会不登记指令，只否决')
    const sellBody = { code: '300308', side: 'SELL', sell: 'HALF', reason: '资金分连续 2 天 ≤1', source: '半年计划第三节' }
    ok((await call(AGENT, 'POST', '/api/orders', { ...sellBody, reason: '先卖 500 股' })).status === 400, '理由里带股数的不收')
    ok((await call(AGENT, 'POST', '/api/orders', { ...sellBody, sell: 'QUARTER' })).status === 400 && (await call(AGENT, 'POST', '/api/orders', { ...sellBody, code: '600000', name: '丁' })).status === 400, '档位不对、没有持仓的卖出不收')
    const made = await call(AGENT, 'POST', '/api/orders', sellBody)
    const madeId = (JSON.parse(made.text) as { instruction: { id: string; portion: string; origin: string } }).instruction
    ok(made.status === 200 && madeId.origin === 'STRATEGY' && madeId.portion === '一半' && !PRIVATE_WORDS.test(made.text) && !made.text.includes('"keep"'), '策略方登记卖出：回执里只有档位，没有股数')
    ok(readFileSync(join(dir, 'chain', 'orders.json'), 'utf-8').includes('"keep"'), '按股数算出的目标只落在服务器')
    ok((await call(AGENT, 'POST', '/api/orders', sellBody)).status === 400, '同一只股票同一方向只留一条未结束的指令')
    ok((await call(AGENT, 'POST', '/api/orders', { code: '002463', side: 'BUY', targetWeight: 0.25, reason: 'E=6', source: '半年计划第四节' })).status === 400, '买入目标占比超过单票上限的不收')
    ok((await call(AGENT, 'POST', '/api/orders', { code: '002463', side: 'BUY', targetWeight: 0.15, reason: 'E=6，资金与趋势都成立', source: '半年计划第四节' })).status === 200, '策略方登记买入：写目标占比')
    const listed = await call(COMMITTEE, 'GET', '/api/orders')
    ok(listed.status === 200 && (JSON.parse(listed.text) as { instructions: unknown[] }).instructions.length === 2 && !listed.text.includes('"keep"'), '委员会看得到全部指令')
    const vetoed = await call(COMMITTEE, 'DELETE', `/api/orders/${madeId.id}`)
    ok(vetoed.status === 200 && vetoed.text.includes('由委员会撤销') && (await call(COMMITTEE, 'DELETE', `/api/orders/${madeId.id}`)).status === 400, '委员会否决一条指令；已结束的不能再撤')
    ok((await call(BOT, 'PUT', '/api/orders/backup', { on: true, why: 'x' })).status === 403 && (await call(AGENT, 'PUT', '/api/orders/backup', { on: true })).status === 400, '备用目标：bot 不能切，不写原因不收')
    const backup = await call(AGENT, 'PUT', '/api/orders/backup', { on: true, why: '1/20 净值指数低于 110' })
    ok(backup.status === 200 && (JSON.parse(backup.text) as { backup: { why: string } | null }).backup?.why === '1/20 净值指数低于 110', '策略方切到备用目标，留下原因')
    ok((JSON.parse((await call(COMMITTEE, 'PUT', '/api/orders/backup', { on: false, why: '委员会决定回到主目标' })).text) as { backup: unknown }).backup === null, '委员会可以撤回')
    // 执行单从这里取链上数据和指令簿
    const src = service.planSource()
    const ctx = src.context()
    const lastBars = Object.fromEntries(LEDGER.positions.filter(p => p.quantity > 0).map(p => {
      const bar = ctx.view!.stocks[p.code]!.rows.slice(-1)[0]!
      return [p.code, { date: bar.date, close: bar.close }]
    }))
    const input = buildDecisionInput(LEDGER, lastBars, [], TODAY, src.base())
    const plan = buildPlan(input, 'PRE_OPEN', ctx, { sync: true, now: '2026-11-25 09:20:00' })
    ok(plan.rows.map(r => r.code).sort().join() === '002463,300308,300750' && plan.rows.every(r => r.c !== null) && plan.asOf === ctx.view!.asOf, '执行单拿到每只持仓的证据分，链外的那只也有')
    ok(plan.buys.length === 0 && plan.events.some(e => e.includes('乙') && e.includes('已买到位')) && service.book().instructions.every(i => i.status !== 'OPEN'), '登记的买入对着账本核：占比已到目标的自动结束')
    const persisted = JSON.parse(readFileSync(join(dir, 'chain', 'orders.json'), 'utf-8')) as { updatedAt: string }
    ok(plan.synced && persisted.updatedAt === service.book().updatedAt, '指令簿的变动落在私有目录')
    ctx.saveHigh?.(999)
    ok(service.store.base()?.highIndex === 999 && (ctx.saveHigh?.(500), service.store.base()?.highIndex === 999), '净值指数创新高时记下最高值，只升不降')
    ok((await call(AGENT, 'POST', '/api/orders/execute', {})).status === 404 && (await call(AGENT, 'POST', '/api/broker/order', {})).status === 404, '没有向券商下单的接口')
    outcome = 'ok'
    const ml = JSON.parse((await call(BOT, 'GET', `/api/chain/mainline?date=${TODAY}`)).text) as { state: string; data: { triggers?: unknown } }
    ok(ml.state === 'ready' && !!ml.data.triggers, 'bot 读得到脚本存下的 triggers')
  } finally {
    server.close()
  }
}

main()
  .catch(e => { failed++; process.stderr.write(`自检出错：${e instanceof Error ? e.stack : String(e)}\n`) })
  .finally(() => {
    rmSync(dir, { recursive: true, force: true })
    process.stdout.write(`\n链上数据与定时汇总自检：通过 ${passed}，失败 ${failed}\n`)
    process.exit(failed ? 1 : 0)
  })
