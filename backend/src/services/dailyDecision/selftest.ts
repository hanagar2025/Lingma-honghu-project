/**
 * 每日执行单自检。守这几条：
 *   ① 数据核对不通过就不出股数，也不动指令簿；
 *   ② 卖出只由资金分和趋势触发：资金 0 分清仓、收盘跌破 60 日线且融资在降清仓、资金分连续 2 天 ≤1 减半；
 *      占比再高也不卖；
 *   ③ 缺数据核对不了的条件不算成立；融资没公布时的初算只提示，定稿才成指令；
 *   ④ 系统自己不生成买入；策略方登记的买入逐条过规则（三条线、准入、证据分上限、相关环节 30%、备用目标）；
 *   ⑤ 指令触发后有效 4 个交易日，账本显示到位就结束；
 *   ⑥ 证据分的算法、规则里的数，与定时汇总那一套逐项一致。
 */
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import type { SeriesView, ViewRow } from '../chain/view'
import { lineStatus, parseLines } from '../chain/watch'
import type { StockSeries } from '../chain/types'
import { buildAgentPack, demoteHeadings, renderSitePage } from './agentPack'
import { cancelOrder, EMPTY_BOOK, publicBook, registerOrder, setBackup, type Instruction, type OrderBook } from './book'
import { buildCard, buildFailureCard, SYSTEM_NAME, type DecisionCard } from './card'
import { buildEvidence, scoreAt, sellCheck, type StockData } from './evidence'
import { markdownToHtml, renderCardPage } from './html'
import { configuredChannels, pushAll } from './notify'
import { buildDecisionInput, fetchLastBars } from './input'
import type { LedgerFile } from './ledger'
import { buildPlan } from './plan'
import { computeLines, nextCheckpoint, PLAN, sharesForBuyValue, sharesForFraction, sharesForSellValue, stopLine } from './rules'
import type { DecisionInput, DecisionSession, PlanFacts } from './types'
import { parseRunLog, RUN_LOG_HEADER, summarize } from './runLog'
import { resolveSession } from './schedule'
import { fetchSinaRaw, parseSinaRaw, sinaSymbol, verifyInput, type SinaRaw } from './verify'

let pass = 0
let fail = 0
function ok(cond: boolean, name: string): void {
  if (cond) { pass++; process.stdout.write(`  ✓ ${name}\n`) } else { fail++; process.stdout.write(`  ✗ ${name}\n`) }
}

// ── 合成数据。全部是编出来的数，不是任何真实账户 ──

/** 截至 end（含）的 n 个工作日，旧的在前 */
function weekdays(n: number, end: string): string[] {
  const out: string[] = []
  const d = new Date(`${end}T00:00:00Z`)
  while (out.length < n) {
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) out.unshift(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() - 1)
  }
  return out
}

const END = '2026-11-24'
const NEXT = '2026-11-25'
const DAYS = weekdays(70, END)
const N = DAYS.length

type Shape = { close?: (k: number) => number; main?: (k: number) => number | null; margin?: (k: number) => number | null; amount?: number; pct?: number }

/** k = 距最后一天的天数（0 是最后一天） */
function rows(shape: Shape, dates: readonly string[] = DAYS): ViewRow[] {
  return dates.map((date, i) => {
    const k = dates.length - 1 - i
    return {
      date, close: shape.close?.(k) ?? 100, amount: shape.amount ?? 2_000_000_000, pct: k === 0 ? shape.pct ?? 0.01 : 0.01,
      main: shape.main ? shape.main(k) : 1e7, margin: shape.margin ? shape.margin(k) : 1e9 * (1 + 0.01 * (dates.length - k)),
    }
  })
}

// 资金 4 分、趋势 2 分：价格一路向上，主力天天流入，融资一路增加
const STRONG: Shape = { close: k => 200 - k }
// 资金 0 分：主力天天流出，融资一路减少。价格走平，趋势 0 分
const ZERO: Shape = { main: () => -1e7, margin: k => 1e9 * (1 + 0.01 * k) }
// 资金 1 分（连续两天）：融资在降；主力 5 天里 4 天流入，但合计为负
const WEAK: Shape = { main: k => (k === 2 || k === 7 ? -1e8 : 1e6), margin: k => 1e9 * (1 + 0.01 * k) }
// 资金 2 分，最后一天收盘从 60 日线上方跌到下方，融资在降
const BROKE: Shape = { close: k => (k === 0 ? 90 : k === 1 ? 101 : 100), margin: k => 1e9 * (1 + 0.01 * k) }
// 资金 2 分、趋势 0 分：什么条件都不成立
const FLAT: Shape = { margin: k => 1e9 * (1 + 0.01 * k) }

const SEGMENTS = [
  { layer: '光通信', segment: '光模块', codes: ['300308', '300502'] },
  { layer: '光通信', segment: 'PCB', codes: ['002463'] },
  { layer: '半导体', segment: '半导体设备', codes: ['002371', '688012'] },
  { layer: '半导体', segment: '晶圆代工', codes: ['688347'] },
]
const NAMES: Record<string, string> = {
  '300308': '中际旭创', '300502': '新易盛', '002463': '沪电股份', '002371': '北方华创', '688012': '中微公司', '688347': '华虹公司',
}

function makeView(shapes: Record<string, Shape>, opts: { dates?: readonly string[]; dropLastMargin?: boolean; earnings?: Record<string, number> } = {}): SeriesView {
  const dates = opts.dates ?? DAYS
  const stocks: SeriesView['stocks'] = {}
  for (const [code, shape] of Object.entries(shapes)) {
    const r = rows(shape, dates)
    if (opts.dropLastMargin) r[r.length - 1]!.margin = null
    const np = opts.earnings?.[code]
    stocks[code] = {
      name: NAMES[code] ?? code, rows: r, forecast: null,
      earning: { report: '2026-09-30', notice: '2026-10-28', revYoy: 0.1, npYoy: np ?? 0.2 },
    }
  }
  const market = (opts.dropLastMargin ? dates.slice(0, -1) : dates).map(date => ({ date, balance: 1e12 }))
  return {
    generatedAt: `${NEXT} 08:45:00`, asOf: dates[dates.length - 1]!, marginAsOf: market[market.length - 1]!.date,
    segments: SEGMENTS, stocks, marketMargin: market, flags: [], gaps: [], lastRuns: [],
  }
}

/** 合成账本：总资产 100 万。weights 是各持仓占总资产的比例，按 view 里最后一个收盘价折成股数 */
function makeLedger(view: SeriesView, weights: Record<string, number>, asOf = END): LedgerFile {
  const positions = Object.entries(weights).map(([code, w]) => {
    const close = view.stocks[code]!.rows.slice(-1)[0]!.close
    return { code, name: NAMES[code] ?? code, quantity: Math.round((w * 1_000_000) / close / 100) * 100, cost: close }
  })
  const value = positions.reduce((s, p) => s + p.quantity * view.stocks[p.code]!.rows.slice(-1)[0]!.close, 0)
  return { asOf, cash: 1_000_000 - value, peakAssets: 0, positions }
}

function sinaFor(input: DecisionInput, mutate: (s: Record<string, SinaRaw>) => void = () => {}): Record<string, SinaRaw> {
  const s: Record<string, SinaRaw> = { sh000001: { prevClose: 3000, price: 3010, date: input.date } }
  for (const h of input.holdings) s[sinaSymbol(h.code)] = { prevClose: 1, price: h.close!, date: h.barDate! }
  mutate(s)
  return s
}

interface Run { card: DecisionCard; input: DecisionInput; plan: PlanFacts; book: OrderBook; saved: number }

/** 走一遍服务器出单的路：账本 + 价格 → 两源核对 → 套规则 → 执行单 */
function run(view: SeriesView, ledger: LedgerFile, opts: {
  book?: OrderBook; nav?: number | null; navHigh?: number; session?: DecisionSession; today?: string
  watch?: unknown[]; badPrice?: boolean
} = {}): Run {
  const session = opts.session ?? 'PRE_OPEN'
  const today = opts.today ?? NEXT
  const asOf = view.asOf!
  const bars = Object.fromEntries(ledger.positions.map(p => [p.code, { date: asOf, close: view.stocks[p.code]?.rows.slice(-1)[0]!.close ?? p.cost! }]))
  const nav = opts.nav === undefined ? 100 : opts.nav
  const base = nav === null ? null : { totalAssets: 1_000_000 / (nav / 100), at: '2026-11-24 09:37', highIndex: opts.navHigh ?? 100 }
  const input = buildDecisionInput(ledger, bars, [], today, base)
  const sina = sinaFor(input, s => { if (opts.badPrice) s[sinaSymbol(ledger.positions[0]!.code)]!.price *= 1.05 })
  const v = verifyInput(input, sina, 'POST_CLOSE')
  let book = opts.book ?? EMPTY_BOOK
  let saved = 0
  const lines = parseLines(opts.watch ?? [])
  if (typeof lines === 'string') throw new Error(lines)
  const series = (code: string): StockSeries => {
    const r = view.stocks[code]!.rows
    return {
      code, name: NAMES[code] ?? code, revisions: [], updatedAt: '',
      bars: r.map(x => ({ date: x.date, open: x.close, close: x.close, high: x.close, low: x.close, amount: x.amount, pct: x.pct })),
      flow: r.filter(x => x.main !== null).map(x => ({ date: x.date, main: x.main as number })),
      margin: r.filter(x => x.margin !== null).map(x => ({ date: x.date, balance: x.margin as number, buy: 0, repay: 0 })),
    }
  }
  const plan = buildPlan(input, session, {
    view, book, watch: lines.map(l => lineStatus(l, series(l.code), null)),
    saveBook: b => { book = b; saved++ },
  }, { sync: v.ok, now: `${today} 09:20:00` })
  input.plan = plan
  return { card: buildCard(input, v, session, { today }), input, plan, book, saved }
}

const open = (r: Run): Instruction[] => r.book.instructions.filter(i => i.status === 'OPEN')
const line = (r: Run, code: string): DecisionCard['lines'][number] | undefined => r.card.lines.find(l => l.code === code)

const HERE = dirname(fileURLToPath(import.meta.url))
const BOT_LIB = join(HERE, '..', '..', '..', '..', 'agents', 'honghu-digest', 'bot', 'lib')
/** 定时汇总那一套代码在后端的编译范围之外，运行时按路径读进来比对 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const botModule = (name: string): Promise<any> => import(pathToFileURL(join(BOT_LIB, name)).href)

async function parityTests(): Promise<void> {
  process.stdout.write('\n【规则里的数与定时汇总一致】\n')
  const plan = await botModule('plan.ts')
  const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)
  for (const k of ['lines', 'ratchets', 'checkpoints', 'addCap', 'related', 'entry'] as const) {
    ok(same(PLAN[k], plan.PLAN[k]), `${k} 两处相同`)
  }
  ok([null, 100, 121, 146.9, 147, 180].every(h => stopLine(h) === plan.stopLine(h)), '停手线上移的算法两处相同')
  ok(same(nextCheckpoint('2026-12-21'), plan.nextCheckpoint('2026-12-21')), '下一个进度线两处相同')

  process.stdout.write('\n【证据分与定时汇总逐项一致】\n')
  const bot = await botModule('score.ts')
  let seed = 20261124
  const rnd = (): number => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
  let scores = 0
  let checks = 0
  let diff = 0
  const seen = { zero: 0, halve: 0, trend: 0, unsure: 0, provisional: 0 }
  for (let n = 0; n < 300; n++) {
    const len = 62 + Math.floor(rnd() * 12)
    const dates = weekdays(len, END)
    const noMargin = rnd() < 0.15
    const drift = (rnd() - 0.5) * 0.02
    const flowBias = rnd() - 0.5
    const marginDrift = (rnd() - 0.5) * 0.02
    let close = 50 + rnd() * 100
    let margin = 1e9
    const data: StockData = {
      name: `样本${n}`,
      rows: dates.map((date, i) => {
        close *= 1 + drift + (rnd() - 0.5) * 0.04
        margin *= 1 + marginDrift + (rnd() - 0.5) * 0.01
        const lastTwo = i >= len - 2
        return {
          date, close, amount: 5e8 + rnd() * 2e9, pct: (rnd() - 0.5) * 0.1,
          main: rnd() < 0.04 ? null : (rnd() - 0.5 + flowBias * 0.6) * 1e8,
          margin: noMargin || (lastTwo && rnd() < 0.35) || rnd() < 0.02 ? null : margin,
        }
      }),
      earning: rnd() < 0.2 ? null : { report: '2026-09-30', notice: '2026-10-28', revYoy: null, npYoy: rnd() < 0.1 ? null : rnd() - 0.4 },
    }
    // 每 8 个样本里造一个“昨天在 60 日线上方、今天跌到下方”的
    if (n % 8 === 0) {
      const ma = data.rows.slice(len - 61, len - 1).reduce((t, r) => t + r.close, 0) / 60
      data.rows[len - 2]!.close = ma * 1.08
      data.rows[len - 1]!.close = ma * 0.8
    }
    const market = new Map(dates.filter(() => rnd() > 0.02).map((d, i) => [d, 1e12 * (1 + 0.0005 * i)]))
    const flags = rnd() < 0.1 ? [{ code: 'X', name: '', reason: '供应冲击', source: 't', since: dates[len - 10]!, until: rnd() < 0.5 ? null : dates[len - 2]! }] : []
    const mine = [scoreAt('X', '光模块', data, len - 1, market, flags), scoreAt('X', '光模块', data, len - 2, market, flags)]
    const theirs = [bot.scoreAt('X', '光模块', data, len - 1, market, flags), bot.scoreAt('X', '光模块', data, len - 2, market, flags)]
    scores += 2
    if (!same(mine, theirs)) diff++
    const a = sellCheck(mine[0]!, mine[1])
    const b = bot.sellCheck(theirs[0], theirs[1])
    checks++
    if (!same(a, { halve: b.halve, clearByC: b.clearByC, clearByTrend: b.clearByTrend, provisional: b.provisional, note: b.note, unsure: b.unsure })) diff++
    if (a.clearByC) seen.zero++
    if (a.halve) seen.halve++
    if (a.clearByTrend) seen.trend++
    if (a.unsure) seen.unsure++
    if (a.provisional) seen.provisional++
  }
  ok(diff === 0, `${scores} 次打分、${checks} 次卖出核对，两处结果逐项相同`)
  ok(Object.values(seen).every(x => x > 0), `样本里各种情形都出现过（清仓 ${seen.zero}、减半 ${seen.halve}、破线 ${seen.trend}、核对不了 ${seen.unsure}、初算 ${seen.provisional}）`)
}

process.stdout.write('\n【三条线】\n')
{
  ok(computeLines(100, 100).level === 'NORMAL' && !computeLines(100, 100).buyBlocked, '100：都没触及')
  const watch = computeLines(95, 100)
  ok(watch.level === 'WATCH' && watch.newEntryBlocked && !watch.buyBlocked && watch.equityCap === null, '95：触及观察线，不开新股票，已有持仓照规则')
  const warn = computeLines(90, 100)
  ok(warn.level === 'WARN' && warn.equityCap === 0.5 && warn.newEntryBlocked, '90：触及预警线，股票降到 50% 以内')
  const stop = computeLines(85, 100)
  ok(stop.level === 'STOP' && stop.buyBlocked && stop.equityCap === 0.3, '85：触及停手线，停止一切买入，股票降到 30% 以内')
  ok(computeLines(99, 121).stop === 100 && computeLines(99, 121).level === 'STOP', '到过 121 → 停手线上移到 100，99 就是停手')
  ok(computeLines(126, 147).stop === 125 && computeLines(124, 147).level === 'STOP', '到过 147 → 停手线上移到 125')
  ok(computeLines(178, 178).level === 'TARGET' && computeLines(178, 178).equityCap === 0.3, '178：到目标，股票降到 30%')
  const none = computeLines(null, null)
  ok(none.level === 'NO_BASE' && none.buyBlocked, '净值指数算不出 → 核对不了，不买；不当作没触线')
}

process.stdout.write('\n【股数】\n')
{
  ok(sharesForFraction('300308', 500, 0.5) === 300 && sharesForFraction('300308', 400, 0.5) === 200, '减半按一手取整：500 股卖 300，400 股卖 200')
  ok(sharesForFraction('300308', 100, 0.5) === 100, '只有一手：减半就是全卖')
  ok(sharesForFraction('300308', 600, 1 / 3) === 200 && sharesForFraction('688012', 650, 1 / 3) === 217, '三分之一：主板按手，科创板可以到 1 股')
  ok(sharesForFraction('688012', 300, 0.5) === 200, '科创板单笔不少于 200 股')
  ok(sharesForBuyValue('300308', 50_000, 480) === 100 && sharesForBuyValue('300308', 40_000, 480) === 0, '买入向下取整，不够一手就不买')
  ok(sharesForBuyValue('688347', 50_000, 100) === 500 && sharesForBuyValue('688347', 15_000, 100) === 0, '科创板买入不少于 200 股')
  ok(sharesForSellValue('300308', 80_000, 500, 400) === 200 && sharesForSellValue('688012', 10_000, 200, 650) === 200, '按金额卖出向上取整')
}

process.stdout.write('\n【占比再高也不卖；什么条件都不成立就不交易】\n')
{
  const view = makeView({ '300308': STRONG, '002463': FLAT })
  const r = run(view, makeLedger(view, { '300308': 0.45, '002463': 0.2 }))
  ok(r.card.ok && r.card.lines.length === 0 && r.card.title.includes('不交易'), '单票 45%、相关环节合计 65%：没有任何卖出指令')
  ok(r.card.push.includes('不因为占比高而卖出') && !r.card.push.includes('12%'), '执行单写明不因占比卖出；旧的 12% 不再出现')
  ok(!r.card.push.includes('熔断') && !r.card.push.includes('闸门'), '旧的回撤熔断和机会闸门不再出现')
  ok(r.card.push.includes('净值指数 100.0') && r.card.push.includes('都没有触及'), '三条线的读数写在抬头')
  const row = r.plan.rows.find(x => x.code === '300308')!
  ok(row.c === 4 && row.t === 2 && row.e === 6 && row.addCap === 0.2, '资金 4 分、趋势 2 分 → E=6，加仓上限 20%')
  ok(r.plan.relatedWeight > 0.6 && r.card.markdown.includes('只限制加仓，超过不卖'), '相关环节合计写出来，写明只限加仓')
  ok(r.card.markdown.includes('| 中际旭创 |') && !r.card.push.includes('| 中际旭创 |'), '逐只读数只进全文，不进推送')
  ok(r.saved === 0, '指令簿没有变化就不写盘')
}

process.stdout.write('\n【资金 0 分 → 清仓】\n')
{
  const view = makeView({ '002371': ZERO, '300308': STRONG })
  const ledger = makeLedger(view, { '002371': 0.1, '300308': 0.1 })
  const r = run(view, ledger)
  const l = line(r, '002371')
  ok(r.card.lines.length === 1 && l?.side === 'SELL' && l.all && l.shares === 1000, '资金 0 分的那只：全部卖出；另一只不动')
  ok(l!.reason.includes('资金 0 分') && l!.reason.includes('《半年计划》第二节'), '理由写条件和出处')
  ok(l!.reason.includes('11/24 触发，现在是第 1 个交易日') && l!.reason.includes('还可顺延 3 个交易日'), '写明哪天触发、还能顺延几天')
  ok(r.card.title.includes('卖出 1 笔，不买入') && r.card.push.includes('下单计划，不是成交记录') && r.card.push.includes('系统不下单'), '标题与性质')
  ok(open(r).length === 1 && open(r)[0]!.origin === 'RULE_ZERO' && r.saved === 1, '指令记进指令簿')

  const again = run(view, ledger, { book: r.book })
  ok(again.saved === 0 && again.card.lines.length === 1, '同样的数据再算一遍：不重复生成，指令簿不变')

  const sold = run(view, makeLedger(view, { '300308': 0.1 }), { book: r.book })
  ok(open(sold).length === 0 && sold.book.instructions[0]!.status === 'DONE' && sold.card.lines.length === 0, '账本显示已清仓 → 指令自动结束')
  ok(sold.plan.events.some(e => e.includes('已卖到位')), '结束写进指令变动')
}

process.stdout.write('\n【资金分连续 2 天 ≤1 → 减半，一轮只减一次】\n')
{
  const view = makeView({ '688012': WEAK })
  const ledger = makeLedger(view, { '688012': 0.13 })
  const held = ledger.positions[0]!.quantity
  const r = run(view, ledger)
  const l = line(r, '688012')
  ok(r.plan.rows[0]!.c === 1 && l?.shares === Math.round(held / 2) && !l.all, '资金分两天都是 1 → 卖一半')
  ok(r.card.push.includes(`卖后持有不超过 ${held - l!.shares!} 股`), '写出卖后最多持有多少股')
  const half = { ...ledger, positions: [{ ...ledger.positions[0]!, quantity: held - l!.shares! }] }
  const after = run(view, half, { book: r.book })
  ok(open(after).length === 0 && after.card.lines.length === 0, '减半完成 → 指令结束')
  ok(after.plan.notices.some(n => n.includes('条件仍成立') && n.includes('不重复生成')), '资金分还是 ≤1：不再减第二次，照实写出来')

  // 资金分回到 2 分以上，之后再次连续 2 天 ≤1：重新生成
  const recovered = run(makeView({ '688012': FLAT }), half, { book: after.book })
  ok(Object.keys(recovered.book.fired).length === 0, '资金分回到 2 分 → 这一轮结束')
  const second = run(view, half, { book: recovered.book })
  ok(open(second).length === 1 && open(second)[0]!.origin === 'RULE_HALVE', '再次连续 2 天 ≤1 → 重新生成减半')
}

process.stdout.write('\n【收盘跌破 60 日线且融资在降 → 清仓】\n')
{
  const view = makeView({ '002463': BROKE })
  const ledger = makeLedger(view, { '002463': 0.12 })
  const r = run(view, ledger)
  ok(r.plan.rows[0]!.c === 2 && line(r, '002463')?.all === true, '资金分 2 分，但收盘破线且融资在降 → 清仓')
  ok(open(r)[0]!.origin === 'RULE_TREND' && open(r)[0]!.reason.includes('跌破 60 日线'), '理由写破线和融资读数')
  // 一直在线下方不是“跌破”：只有从线上到线下的那一天算
  const below = makeView({ '002463': { close: k => (k <= 3 ? 90 : 100), margin: k => 1e9 * (1 + 0.01 * k) } })
  ok(run(below, makeLedger(below, { '002463': 0.12 })).card.lines.length === 0, '已经在 60 日线下方好几天 → 不是跌破，不生成')
  const rising = makeView({ '002463': { close: k => (k === 0 ? 90 : k === 1 ? 101 : 100) } })
  ok(run(rising, makeLedger(rising, { '002463': 0.12 })).card.lines.length === 0, '破线但融资在增 → 不成立')
}

process.stdout.write('\n【缺数据、初算：只提示，不成指令】\n')
{
  // 主力净流入整段取不到：资金分已得 0 分，但补齐后可能不是 0
  const blind = makeView({ '002371': { main: () => null, margin: k => 1e9 * (1 + 0.01 * k) } })
  const r = run(blind, makeLedger(blind, { '002371': 0.1 }))
  ok(r.card.ok && r.card.lines.length === 0 && open(r).length === 0, '缺主力净流入时资金分算出 0：不生成清仓')
  ok(r.plan.notices.some(n => n.includes('核对不了') && n.includes('不算成立，也不算不成立')), '写明核对不了：不算成立，也不算不成立')
  ok(r.plan.rows[0]!.sellNote.includes('核对不了') && r.card.markdown.includes('（缺主力净流入）'), '读数表里标出缺什么')

  // 融资还没公布：按前一天的融资初算出 0 分
  const early = makeView({ '002371': ZERO }, { dropLastMargin: true })
  const ledger = makeLedger(early, { '002371': 0.1 })
  const p = run(early, ledger, { session: 'POST_CLOSE', today: END })
  ok(p.card.lines.length === 0 && open(p).length === 0, '融资没公布：初算成立也不生成指令')
  ok(p.plan.notices.some(n => n.includes('初算成立') && n.includes('定稿仍成立才生成指令')), '写明初算成立，待定稿')
  ok(p.card.push.includes('带“初算”的要等融资公布后定稿'), '抬头写明读数是初算')
  const final = run(makeView({ '002371': ZERO }), ledger, { book: p.book })
  ok(final.card.lines.length === 1 && open(final)[0]!.triggerDate === END, '次日融资公布、定稿仍是 0 分 → 生成清仓，触发日是那个收盘日')

  // 不是两融标的：没有融资数据是确定的 0 分，不算缺
  const noMargin = makeView({ '002371': { main: () => -1e7, margin: () => null } })
  ok(run(noMargin, makeLedger(noMargin, { '002371': 0.1 })).card.lines.length === 1, '不是两融标的、主力天天流出 → 资金 0 分成立')

  // 持仓不在链上数据里
  const missing = makeView({ '300308': STRONG })
  const m = run(missing, { asOf: END, cash: 930_000, peakAssets: 0, positions: [{ code: '300308', name: '中际旭创', quantity: 100, cost: 200 }, { code: '300750', name: '宁德时代', quantity: 200, cost: 250 }] })
  ok(m.card.ok && m.card.lines.length === 0 && m.plan.notices.some(n => n.includes('宁德时代') && n.includes('没有资金分读数')), '持仓没有链上数据 → 卖出条件核对不了，不生成指令')
  ok(m.card.push.includes('宁德时代 300750 不在 AI 全链名单内'), '名单外的持仓只提示')
}

process.stdout.write('\n【指令有效期：执行日加顺延 3 个交易日】\n')
{
  const view = makeView({ '002371': ZERO })
  const ledger = makeLedger(view, { '002371': 0.1 })
  const first = run(view, ledger)
  const after = weekdays(12, '2026-12-08').filter(d => d > END)
  /** 触发日之后又收了 n 个交易日的数据 */
  const later = (n: number): SeriesView => makeView({ '002371': ZERO }, { dates: weekdays(70, after[n - 1]!) })
  // 触发日之后又收了 3 个交易日：第 4 个交易日，最后一天
  const d3 = later(3)
  const r3 = run(d3, makeLedger(d3, { '002371': 0.1 }, d3.asOf!), { book: first.book, today: after[3]! })
  ok(open(r3).length === 1 && line(r3, '002371')!.reason.includes('第 4 个交易日') && line(r3, '002371')!.reason.includes('过后作废'), '顺延到第 4 个交易日：仍有效，写明是最后一天')
  const d4 = later(4)
  const r4 = run(d4, makeLedger(d4, { '002371': 0.1 }, d4.asOf!), { book: first.book, today: after[4]! })
  ok(open(r4).length === 0 && r4.book.instructions[0]!.status === 'EXPIRED' && r4.card.lines.length === 0, '第 4 个交易日收盘仍未完成 → 作废')
  ok(r4.plan.notices.some(n => n.includes('条件仍成立') && n.includes('已顺延期满作废') && n.includes('由策略方登记')), '作废后条件还在：不自动重发，写明由策略方决定')
}

process.stdout.write('\n【盯线：写了卖出档位的收盘线才成指令】\n')
{
  // 收盘 <417.2 且当天主力净流出 → 卖三分之一
  const shape: Shape = { close: k => (k === 0 ? 410 : 430), main: k => (k === 0 ? -1e8 : 2e7) }
  const view = makeView({ '300308': shape })
  const ledger = makeLedger(view, { '300308': 0.14 })
  const rule = { code: '300308', name: '中际旭创', basis: 'close', op: 'below', level: 417.2, and: 'main_out', action: '次日卖三分之一', source: '《半年计划》第三节' }
  const reading = run(view, ledger, { watch: [rule] })
  ok(reading.card.lines.length === 0, '线没有写卖出档位：越线只是读数，不成指令')
  const r = run(view, ledger, { watch: [{ ...rule, sell: 'THIRD' }] })
  const held = ledger.positions[0]!.quantity
  ok(line(r, '300308')?.shares === sharesForFraction('300308', held, 1 / 3) && open(r)[0]!.origin === 'WATCH', '写了卖三分之一 → 生成指令，股数是持仓的三分之一')
  ok(line(r, '300308')!.reason.includes('《半年计划》第三节') && line(r, '300308')!.reason.includes('次日卖三分之一'), '理由带规则原文和出处')
  ok(run(view, ledger, { watch: [{ ...rule, sell: 'THIRD' }], book: r.book }).saved === 0, '同一条线不重复触发')
  const inflow = makeView({ '300308': { ...shape, main: () => 2e7 } })
  ok(run(inflow, makeLedger(inflow, { '300308': 0.14 }), { watch: [{ ...rule, sell: 'THIRD' }] }).card.lines.length === 0, '跌破但主力没有流出 → 附加条件不成立，不生成')
  const noFlow = makeView({ '300308': { ...shape, main: k => (k === 0 ? null : 2e7) } })
  const unsure = run(noFlow, makeLedger(noFlow, { '300308': 0.14 }), { watch: [{ ...rule, sell: 'THIRD' }] })
  ok(unsure.card.lines.length === 0 && unsure.plan.notices.some(n => n.includes('附加条件缺数据')), '当天主力净流入取不到 → 核对不了，不生成')
  ok(typeof parseLines([{ ...rule, basis: 'price', sell: 'THIRD' }]) === 'string', '盘中判定的线不能带卖出档位')

  // 同一只先触发盯线卖三分之一，又触发减半：并成一条，在卖剩的基础上再减半
  const both = makeView({ '300308': { close: k => (k === 0 ? 410 : 430), main: k => (k === 0 ? -1e8 : k === 2 || k === 7 ? -1e8 : 1e6), margin: k => 1e9 * (1 + 0.01 * k) } })
  const bl = makeLedger(both, { '300308': 0.14 })
  const merged = run(both, bl, { watch: [{ ...rule, sell: 'THIRD' }] })
  const q = bl.positions[0]!.quantity
  const afterHalf = q - sharesForFraction('300308', q, 0.5)
  ok(open(merged).length === 1 && open(merged)[0]!.keep === afterHalf - sharesForFraction('300308', afterHalf, 1 / 3), '两个条件同时成立 → 一条指令，先减半、剩下的再卖三分之一')
}

process.stdout.write('\n【买入：系统不生成；策略方登记的逐条过规则】\n')
{
  const view = makeView({ '688347': STRONG, '300308': STRONG, '002463': STRONG, '002371': FLAT, '300502': FLAT })
  const ledger = makeLedger(view, { '300308': 0.14, '002463': 0.12, '002371': 0.1 })
  const ctx = { now: `${NEXT} 08:50:00`, triggerDate: END, holdings: ledger.positions }
  const reg = (book: OrderBook, raw: Record<string, unknown>): OrderBook => {
    const out = registerOrder(book, { reason: 'E=6，资金与趋势都成立', source: '《半年计划》第四节第 2 步', ...raw }, ctx)
    if (typeof out === 'string') throw new Error(out)
    return out.book
  }
  ok(run(view, ledger).card.lines.length === 0, '证据分再高，系统自己也不生成买入')

  const b1 = reg(EMPTY_BOOK, { code: '688347', name: '华虹公司', side: 'BUY', targetWeight: 0.05 })
  const r1 = run(view, ledger, { book: b1 })
  const l1 = line(r1, '688347')
  const px = view.stocks['688347']!.rows.slice(-1)[0]!.close
  ok(l1?.side === 'BUY' && l1.shares === Math.floor(50_000 / px) && r1.card.title.includes('买入 1 笔'), '新开仓 E=6：买到总资产 5%，股数向下取整')
  ok(l1!.reason.includes('当天涨幅须不超过 3.0%') && l1!.reason.includes('E=6 对应上限 20.0%'), '写明下单时的涨幅条件和证据分上限')
  ok(r1.card.push.includes('宁少买一手、不多买一手'), '提示下单时按实时价重算，不超过上限')

  // 单票上限：E=6 → 20%
  const big = run(view, ledger, { book: reg(EMPTY_BOOK, { code: '002371', name: '北方华创', side: 'BUY', targetWeight: 0.2 }) })
  ok(big.card.lines.length === 0 && big.card.push.includes('E=2，不加'), '已持有但 E=2 → 不加')

  // 相关环节：光模块加 PCB 已 26%，只剩 4% 的额度
  const rel = run(view, ledger, { book: reg(EMPTY_BOOK, { code: '300308', name: '中际旭创', side: 'BUY', targetWeight: 0.2 }) })
  const lr = line(rel, '300308')!
  const w = rel.plan.rows.find(x => x.code === '300308')!.weight
  const relatedAfter = rel.plan.relatedWeight + (lr.shares! * lr.refPrice!) / 1_000_000
  ok(lr.side === 'BUY' && relatedAfter <= 0.3 + 1e-9 && w + (lr.shares! * lr.refPrice!) / 1_000_000 < 0.2, '相关环节合计 30% 封顶：买入被压到剩余额度以内')
  ok(lr.reason.includes('相关环节合计'), '写明是相关环节的额度限制')
  const full = makeLedger(view, { '300308': 0.18, '002463': 0.13 })
  const blockedRel = run(view, full, { book: reg(EMPTY_BOOK, { code: '300308', name: '中际旭创', side: 'BUY', targetWeight: 0.2 }) })
  ok(blockedRel.card.lines.length === 0 && blockedRel.card.push.includes('已到 30.0%，不加'), '相关环节已超 30% → 不加；也没有卖出')

  // 新开仓准入
  const weak = run(view, ledger, { book: reg(EMPTY_BOOK, { code: '300502', name: '新易盛', side: 'BUY', targetWeight: 0.05 }) })
  ok(weak.card.lines.length === 0 && weak.card.push.includes('新开仓要 E≥5'), 'E<5 → 不开仓')
  const thin = makeView({ '688347': { ...STRONG, amount: 6e8 } })
  ok(run(thin, makeLedger(thin, {}), { book: b1 }).card.push.includes('不到 10 亿'), '日成交不到 10 亿 → 不开仓')
  const loss = makeView({ '688347': STRONG }, { earnings: { '688347': -0.3 } })
  ok(run(loss, makeLedger(loss, {}), { book: b1 }).card.push.includes('新开仓要 E≥5') || run(loss, makeLedger(loss, {}), { book: b1 }).card.push.includes('有基本面扣分'), '净利同比为负 → 扣 1 分，过不了准入')
  const prov = makeView({ '688347': STRONG }, { dropLastMargin: true })
  ok(run(prov, makeLedger(prov, {}), { book: b1 }).card.push.includes('证据分还是初算'), '证据分是初算 → 不出买入股数')

  // 三条线
  ok(run(view, ledger, { book: b1, nav: 94 }).card.push.includes('触及观察线 95，不开新股票'), '观察线以下：新开仓被挡')
  const b2 = reg(EMPTY_BOOK, { code: '688347', name: '华虹公司', side: 'BUY', targetWeight: 0.15 })
  const addAtWatch = run(view, makeLedger(view, { '688347': 0.03 }), { book: b2, nav: 94 })
  ok(line(addAtWatch, '688347')?.side === 'BUY', '观察线以下：已有持仓照规则，可以加')
  const stopped = run(view, makeLedger(view, { '688347': 0.03 }), { book: b2, nav: 84 })
  ok(stopped.card.lines.length === 0 && stopped.card.push.includes('停止一切买入'), '停手线以下：一切买入都停')
  const noBase = run(view, ledger, { book: b1, nav: null })
  ok(noBase.card.lines.length === 0 && noBase.card.push.includes('三条线核对不了') && noBase.card.push.includes('净值基准还没填'), '净值基准没填：核对不了，不买')

  // 现金
  const poor = makeLedger(view, { '300308': 0.5, '002371': 0.42 })
  const lp = line(run(view, poor, { book: reg(EMPTY_BOOK, { code: '688347', name: '华虹公司', side: 'BUY', targetWeight: 0.1 }) }), '688347')!
  ok(lp.shares! * lp.refPrice! <= poor.cash && lp.reason.includes('按账内现金封顶'), '现金不够：按账内现金封顶')

  // 买到位 → 结束
  const bought = makeLedger(view, { '300308': 0.14, '002463': 0.12, '002371': 0.1, '688347': 0.05 })
  ok(open(run(view, bought, { book: b1 })).length === 0, '账本显示已买到目标占比 → 指令结束')

  // 登记的校验
  ok(typeof registerOrder(EMPTY_BOOK, { code: '688347', name: '华虹公司', side: 'BUY', targetWeight: 0.25, reason: 'x', source: 'y' }, ctx) === 'string', '目标占比超过 20% → 不收')
  ok(typeof registerOrder(EMPTY_BOOK, { code: '688347', name: '华虹公司', side: 'BUY', targetWeight: 0.05, reason: '买 500 股', source: 'y' }, ctx) === 'string', '理由里写股数 → 不收')
  ok(typeof registerOrder(b1, { code: '688347', name: '华虹公司', side: 'BUY', targetWeight: 0.05, reason: 'x', source: 'y' }, ctx) === 'string', '同一只已有未结束的买入 → 不收')
  ok(typeof registerOrder(EMPTY_BOOK, { code: '688347', name: '华虹公司', side: 'SELL', sell: 'ALL', reason: 'x', source: 'y' }, ctx) === 'string', '没有持仓的卖出 → 不收')
  const s1 = reg(EMPTY_BOOK, { code: '002371', side: 'SELL', sell: 'THIRD', reason: '触及预警线后降仓', source: '《半年计划》第〇节' })
  const sr = run(view, ledger, { book: s1 })
  ok(line(sr, '002371')?.side === 'SELL' && line(sr, '002371')!.shares === sharesForFraction('002371', ledger.positions[2]!.quantity, 1 / 3), '策略方登记的卖出：进入执行清单')
  ok(!('keep' in publicBook(s1).instructions[0]!), '接口返回的指令簿不带股数')
  const cancelled = cancelOrder(s1, s1.instructions[0]!.id, '委员会', `${NEXT} 09:00:00`)
  ok(typeof cancelled !== 'string' && run(view, ledger, { book: cancelled }).card.lines.length === 0, '委员会否决 → 指令撤销，不再出现')
  ok(cancelOrder(s1, 'nope', '策略方', '') === '没有这条指令', '撤销不存在的指令 → 报错')

  // 先卖后买
  const mixed = run(view, ledger, { book: reg(s1, { code: '688347', name: '华虹公司', side: 'BUY', targetWeight: 0.05 }) })
  ok(mixed.card.lines.map(l => l.side).join() === 'SELL,BUY' && mixed.card.title.includes('卖出 1 笔，买入 1 笔'), '有卖有买：先卖后买')
  // SHOW_CARD=1：把这张合成数据的样单打出来看排版
  if (process.env.SHOW_CARD === '1') process.stdout.write(`\n${mixed.card.markdown}\n`)
}

process.stdout.write('\n【触线之后】\n')
{
  const view = makeView({ '300308': STRONG, '002371': FLAT, '688347': STRONG })
  const ledger = makeLedger(view, { '300308': 0.4, '002371': 0.35, '688347': 0.03 })
  const r = run(view, ledger, { nav: 89.5 })
  ok(r.card.push.includes('已触及预警线 90') && r.card.push.includes('股票要降到 50.0% 以内'), '预警线：写明股票要降到 50% 以内')
  ok(r.card.lines.length === 0 && r.card.push.includes('减哪几只、各减多少，规则没有写') && r.card.push.includes('由策略方登记卖出指令'), '降哪几只不由系统挑')
  ok(r.book.backup !== null && r.card.push.includes('备用目标：已切换'), '触及预警线 → 切换备用目标')
  const book = registerOrder(r.book, { code: '688347', name: '华虹公司', side: 'BUY', targetWeight: 0.15, reason: 'E=6', source: 't' }, { now: '', triggerDate: END, holdings: ledger.positions })
  const lowCash = makeLedger(view, { '300308': 0.2, '688347': 0.03 })
  const capped = run(view, lowCash, { book: typeof book === 'string' ? EMPTY_BOOK : book.book, nav: 96 })
  const lc = line(capped, '688347')
  ok(lc !== undefined && capped.plan.rows.find(x => x.code === '688347')!.weight + (lc.shares! * lc.refPrice!) / 1_000_000 <= 0.1 + 1e-9 && lc.reason.includes('备用目标，单票上限 10.0%'), '切换后回到观察线以上：单票上限仍是 10%')
  ok(capped.book.backup !== null, '备用目标不自动切回')
  const back = setBackup(capped.book, false, '委员会复核后撤回', `${NEXT} 10:00:00`)
  ok(typeof back !== 'string' && back.backup === null && typeof setBackup(capped.book, true, '', '') === 'string', '撤回要写原因')
  const stop = run(view, ledger, { nav: 84 })
  ok(stop.card.push.includes('两个交易日内') && stop.card.push.includes('30.0% 以内') && stop.card.push.includes('不买入任何股票'), '停手线：两个交易日内降到 30% 以内，不买入')
  const high = run(view, ledger, { nav: 122 })
  ok(high.input.lines.navHigh === 122 && high.input.lines.stop === 100, '净值指数到过 121 → 停手线上移到 100')
}

process.stdout.write('\n【fail-closed】\n')
{
  const view = makeView({ '002371': ZERO })
  const ledger = makeLedger(view, { '002371': 0.1 })
  const first = run(view, ledger)
  const bad = run(view, ledger, { book: first.book, badPrice: true })
  ok(!bad.card.ok && bad.card.lines.length === 0 && bad.card.title.includes('不下单'), '收盘价两源差 5% → 不出股数')
  ok(bad.saved === 0 && bad.card.push.includes('核对恢复后待执行：卖出 北方华创'), '核对没通过：不动指令簿，原有指令列为待执行')
  const fresh = run(view, ledger, { badPrice: true })
  ok(fresh.book.instructions.length === 0, '核对没通过时不生成新指令')
  const stale = run(view, { ...ledger, asOf: '2026-11-10' })
  ok(!stale.card.ok && stale.card.push.includes('落后'), '账本落后超过 5 天 → 不下单')
  const input = buildDecisionInput(ledger, {}, ['002371'], NEXT, { totalAssets: 1_000_000, at: 'x', highIndex: 100 })
  ok(input.lines.level === 'NO_BASE' && !buildCard(input, verifyInput(input, sinaFor({ ...input, holdings: [] }), 'POST_CLOSE'), 'POST_CLOSE').ok, '持仓取不到价格 → 净值指数不算，不下单')
  const cli = buildDecisionInput(ledger, { '002371': { date: END, close: 100 } }, [], NEXT)
  const cliCard = buildCard(cli, verifyInput(cli, sinaFor(cli), 'POST_CLOSE'), 'POST_CLOSE')
  ok(cliCard.ok && cliCard.lines.length === 0 && cliCard.title.includes('卖出条件核对不了') && cliCard.push.includes('不算成立，也不算不成立'), '没有接入链上数据：写明卖出条件核对不了，不出指令')
  ok(buildEvidence(null) === null, '没有日线时不打分')
}

/** 给下面几段与规则无关的检查用：一张带一条清仓指令的执行单输入 */
function baseInput(over: Partial<DecisionInput> = {}): DecisionInput {
  const view = makeView({ '002371': ZERO, '300308': STRONG }, { dates: weekdays(70, '2026-10-09') })
  const r = run(view, makeLedger(view, { '002371': 0.1, '300308': 0.1 }, '2026-10-09'), { today: '2026-10-12' })
  return { ...r.input, ...over }
}

process.stdout.write('\n【执行单的写法】\n')
{
  const input = baseInput()
  const v = verifyInput(input, sinaFor(input), 'POST_CLOSE')
  const card = buildCard(input, v, 'POST_CLOSE')
  ok(v.ok && card.ok && card.title.startsWith(`${SYSTEM_NAME} `), '两源一致 → 出执行单；标题以系统名开头')
  ok(!card.push.includes('*'.repeat(2)), '推送正文无 Markdown 星号')
  ok(card.markdown.includes('核对明细') && !card.push.includes('核对明细'), '核对明细只进存档，不进推送')
  ok(card.push.includes('不重复挂单') && card.push.includes('清单以外的成交记为偏离'), '下单前先查委托；清单以外的成交记为偏离')
  const blind = buildCard(input, verifyInput(input, null, 'POST_CLOSE'), 'POST_CLOSE')
  ok(!blind.ok && blind.lines.length === 0, '第二数据源取不到 → 不出股数')
  ok(!buildCard(baseInput({ priceFailed: ['300308'] }), verifyInput(baseInput({ priceFailed: ['300308'] }), sinaFor(input), 'POST_CLOSE'), 'POST_CLOSE').ok, '持仓行情拉取失败 → 不出股数')
}

process.stdout.write('\n【盘中复核】\n')
{
  const input = baseInput()
  input.holdings = input.holdings.map(h => ({ ...h, barDate: '2026-10-12' }))
  const live = (bump: number) => sinaFor(input, x => {
    x.sh000001 = { prevClose: 3000, price: 2990, date: '2026-10-12' }
    for (const h of input.holdings) x[sinaSymbol(h.code)] = { prevClose: 1, price: h.close! * (1 + bump), date: '2026-10-12' }
  })
  ok(verifyInput(input, live(0.003), 'INTRADAY').ok, '盘中两源差 0.3% → 通过（取价有先后）')
  ok(!verifyInput(input, live(0.003), 'POST_CLOSE').ok, '收盘后同样差 0.3% → 不通过')
  ok(!verifyInput(input, live(0.01), 'INTRADAY').ok, '盘中两源差 1% → 不通过')
  const card = buildCard(input, verifyInput(input, live(0), 'INTRADAY'), 'INTRADAY', { today: '2026-10-12', time: '14:08' })
  ok(card.title.includes('10/12 盘中复核') && card.push.includes('按 14:08 实时价计算'), '标题与时点写明盘中')
  ok(card.push.includes('盘中市值，非收盘基准'), '盘中市值不当收盘基准')
  const stale = baseInput()
  ok(!verifyInput(stale, live(0), 'INTRADAY').ok, '盘中主数据源仍停在上一交易日 → 不通过')
}

process.stdout.write('\n【定时延迟校正】\n')
{
  const t = (h: number, m: number) => h * 60 + m
  ok(resolveSession('pre', t(7, 5)) === 'PRE_OPEN', '07:00 盘前按时到 → 盘前单')
  ok(resolveSession('pre', t(9, 40)) === 'INTRADAY', '盘前拖到开盘后 → 改按实时价出盘中复核')
  ok(resolveSession('intra', t(14, 20)) === 'INTRADAY', '13:30 盘中复核延迟一小时仍在盘中 → 照常')
  ok(resolveSession('intra', t(15, 10)) === null, '盘中复核拖到收盘后 → 不发，避免与收盘后重复')
  ok(resolveSession('post', t(16, 30)) === 'POST_CLOSE', '收盘后一轮延迟 → 照常')
}

process.stdout.write('\n【盘前：新浪现价为 0，用昨收核对】\n')
{
  const input = baseInput()
  const s = sinaFor(input, x => {
    for (const h of input.holdings) x[sinaSymbol(h.code)] = { prevClose: h.close!, price: 0, date: '2026-10-12' }
    x.sh000001 = { prevClose: 3000, price: 0, date: '2026-10-12' }
  })
  const v = verifyInput(input, s, 'PRE_OPEN')
  ok(v.ok, '盘前昨收与腾讯最新收盘一致 → 通过')
  const card = buildCard(input, v, 'PRE_OPEN', { today: '2026-10-12' })
  ok(card.title.includes('10/12 开盘') && card.push.includes('按 10/9 收盘价计算'), '标题是执行日，正文写明数据日')
}

process.stdout.write('\n【解析与推送】\n')
{
  const f = Array(33).fill('0')
  f[0] = '海光信息'; f[2] = '219.00'; f[3] = '219.59'; f[30] = '2026-10-09'
  const parsed = parseSinaRaw(`var hq_str_sh688041="${f.join(',')}";`)
  ok(parsed.sh688041?.price === 219.59 && parsed.sh688041?.prevClose === 219, '新浪行情解析现价与昨收')
  ok(sinaSymbol('688041') === 'sh688041' && sinaSymbol('300502') === 'sz300502', '沪深代码前缀')
  ok(configuredChannels({}).length === 0, '未配置通道 → 无推送目标')
  const fc = buildFailureCard('2026-10-12', '账本读不出')
  ok(!fc.ok && fc.title.includes('不下单'), '采集失败也出一张「不下单」')
}

process.stdout.write('\n【执行单网页】\n')
{
  const input = baseInput()
  const card = buildCard(input, verifyInput(input, sinaFor(input), 'POST_CLOSE'), 'POST_CLOSE')
  const page = renderCardPage(card.markdown, { ok: card.ok, title: card.title, generatedAt: '2026-10-09 15:45' })
  const firstItem = page.indexOf('<ol>')
  ok(firstItem > 0 && firstItem < page.indexOf('核对明细'), '第一屏是执行清单，核对明细在后')
  ok(page.includes('<li>卖出 北方华创 002371') && page.includes('<table>'), '编号清单与核对表都渲染成 HTML')
  ok(!/(src|href)="https?:\/\//.test(page.replace(/<a href="https?:[^"]*">/g, '')), '页面不加载任何外部资源')
  ok(markdownToHtml('- a<b>').includes('a&lt;b&gt;'), '正文转义 HTML')
  const bad = buildCard(input, verifyInput(input, null, 'POST_CLOSE'), 'POST_CLOSE')
  ok(renderCardPage(bad.markdown, { ok: bad.ok, title: bad.title, generatedAt: '' }).includes('#cf222e'), '不下单时页面顶部标红')
}

process.stdout.write('\n【新浪间歇拒绝】\n')
{
  const input = baseInput()
  const down = buildCard(input, verifyInput(input, null, 'INTRADAY'), 'INTRADAY')
  ok(down.markdown.includes('不是账本问题') && !down.markdown.includes('把最新持仓截图'), '数据源取不到时不误导成账本问题')
  const sina = sinaFor(input)
  delete sina[sinaSymbol('002371')]
  const partial = buildCard(input, verifyInput(input, sina, 'POST_CLOSE'), 'POST_CLOSE')
  ok(!partial.ok && !partial.markdown.includes('不是账本问题'), '只缺个别股票时不套用「数据源取不到」的说法')
}

async function sinaFetchTests(): Promise<void> {
  {
    let n = 0
    const kline = (async (url: string) => {
      n++
      const symbol = /param=(\w+),/.exec(String(url))![1]!
      if (symbol === 'sh688041' && n < 3) return new Response('busy', { status: 503 })
      if (symbol === 'sz300750') return new Response('busy', { status: 503 })
      return new Response(JSON.stringify({ code: 0, data: { [symbol]: { qfqday: [['2026-11-10', '1', '200.5', '1', '1', '1']] } } }))
    }) as typeof fetch
    const got = await fetchLastBars(['688041', '300750'], { doFetch: kline, backoffMs: 1 })
    ok(got.bars['688041']?.close === 200.5 && got.bars['688041']?.date === '2026-11-10', '日 K 先被拒后成功：重试拿到收盘价')
    ok(got.failed.length === 1 && got.failed[0] === '300750', '日 K 试满 3 次仍取不到 → 记为失败，由核对环节停单')
  }
  const f = new Array(33).fill('0')
  f[0] = '海光信息'; f[2] = '219.00'; f[3] = '219.59'; f[30] = '2026-10-15'
  const body = new TextEncoder().encode(`var hq_str_sh688041="${f.join(',')}";`)
  const urls: string[] = []
  const flaky = (async (url: string) => {
    urls.push(String(url))
    return urls.length < 3 ? new Response('Forbidden', { status: 403 }) : new Response(body)
  }) as typeof fetch
  const got = await fetchSinaRaw(['sh688041'], { backoffMs: 1, fetchImpl: flaky })
  ok(Boolean(got.sh688041) && urls.length === 3, '先 403 后成功：重试拿到行情')
  ok(urls.some(u => u.startsWith('http://')) && urls.some(u => u.startsWith('https://')), '重试轮换 https/http 入口')
  let calls = 0
  const dead = (async () => { calls++; throw new TypeError('fetch failed') }) as typeof fetch
  const err = await fetchSinaRaw(['sh688041'], { backoffMs: 1, fetchImpl: dead }).then(() => '', e => String(e))
  ok(calls === 6 && err.includes('6 次'), '一直失败：试满 6 次后才判取不到，并记下每次原因')
  const forbidden = (async () => new Response('Forbidden')) as typeof fetch
  const err2 = await fetchSinaRaw(['sh688041'], { backoffMs: 1, fetchImpl: forbidden }).then(() => '', e => String(e))
  ok(err2.includes('没有行情'), '返回 200 但正文不是行情也算失败')
}

process.stdout.write('\n【给 Agent 的数据包】\n')
{
  const input = baseInput()
  const card = buildCard(input, verifyInput(input, sinaFor(input), 'POST_CLOSE'), 'POST_CLOSE')
  const pack = buildAgentPack({ card: card.markdown, generatedAt: '2026-10-12 16:10', siteUrl: 'https://x.io/p' })
  ok(pack.indexOf('读者须知') < pack.indexOf('## 执行单'), '须知在最前，执行单在后')
  ok(pack.includes('核对明细') && pack.includes('卖出 北方华创 002371'), '数据包含执行单全文与核对明细')
  ok(pack.includes('不是成交记录') && pack.includes('执行单含股数、现金与总资产'), '须知写明计划≠成交，且如实说明含金额')
  ok(!/^# /m.test(pack.split('\n').slice(1).join('\n')) && pack.includes('#### 核对明细'), '嵌入文档的标题下沉，不与数据包标题同级')
  ok(pack.includes('https://x.io/p/agent.md'), '写明纯文本地址')
  ok(demoteHeadings('```\n# 不是标题\n```\n# 是标题') === '```\n# 不是标题\n```\n### 是标题', '代码块里的 # 不动')
  const page = renderSitePage(card.markdown, { title: card.title, ok: card.ok, generatedAt: '' }, 'https://x.io/p/')
  const embedded = /<textarea id="agent" readonly>([\s\S]*?)<\/textarea>/.exec(page)?.[1] ?? ''
  ok(embedded.includes('核对明细') && !embedded.includes('<td>'), '首页嵌入完整数据包（转义后的纯文本）')
  ok(page.indexOf('一键复制给 Agent') < page.indexOf('class="card"'), '复制按钮在第一屏')
  ok(page.includes("execCommand('copy')") && page.includes('长按'), '剪贴板被拦截时有退路')
  ok(!renderCardPage(card.markdown, { ok: true, title: 't', generatedAt: '' }).includes('copyAgent'), '没有数据包时不出按钮')
}

process.stdout.write('\n【定时运行台账】\n')
{
  const csv = [
    RUN_LOG_HEADER,
    '2026-10-12,post,schedule,15:40,2026-10-12 16:08:59,29,success,1,1',
    '2026-10-13,pre,schedule,07:00,2026-10-13 07:20:00,20,success,1,2',
    '2026-10-13,post,schedule,15:40,2026-10-13 17:00:00,80,failure,0,3',
    '2026-10-13,post,manual,,2026-10-13 17:05:00,,success,1,4',
  ].join('\n')
  const rows = parseRunLog(csv)
  ok(rows.length === 4 && rows[3].delayMin === null && rows[3].trigger === 'manual', '台账解析：手动运行没有计划时刻')
  // 北京 10/13 17:00：盘中 13:30 已过 3 小时仍无记录 → 漏跑；收盘后 15:40 有记录
  const s = summarize(rows, new Date('2026-10-13T09:00:00Z'))
  ok(s.missing.length === 1 && s.missing[0].session === 'intra' && s.missing[0].date === '2026-10-13', '没有记录的应有轮次算漏跑')
  ok(s.expected === 3, '应有轮次只从各自启用日起算')
  const post = s.stats.find(x => x.session === 'post')!
  ok(post.runs === 2 && post.max === 80 && post.over60 === 1, '延迟分布只统计定时运行')
  ok(s.failures.length === 1 && s.manual === 1, '失败与手动运行分开计数')
  const early = summarize(rows, new Date('2026-10-13T06:00:00Z'))
  ok(!early.missing.some(m => m.session === 'intra'), '计划时刻未过 3 小时不算漏跑')
  // 北京 10/16 周五 20:00：收盘后 10/12–16 共 5 轮，盘前、盘中 10/13–16 各 4 轮
  const empty = summarize(parseRunLog(RUN_LOG_HEADER), new Date('2026-10-16T12:00:00Z'))
  ok(empty.expected === 13 && empty.missing.length === 13, '空台账：应有轮次全部算漏跑')
  ok(s.missing[0].cause === 'UNCHECKED', '不给 GitHub 运行列表时，无记录只记「未核对」')
  // 10/13 盘中：GitHub 有一次 14:10 的定时运行但台账没有 → 留痕失败；收盘后已记录的运行 3 不影响
  const gh = [
    { databaseId: 9, event: 'schedule', createdAt: '2026-10-13T06:10:00Z', conclusion: 'failure' },
    { databaseId: 3, event: 'schedule', createdAt: '2026-10-13T09:00:00Z', conclusion: 'success' },
  ]
  const withGh = summarize(rows, new Date('2026-10-13T09:00:00Z'), gh)
  ok(withGh.missing.length === 1 && withGh.missing[0].cause === 'STARTED_NO_RECORD' && withGh.missing[0].run?.databaseId === 9,
    '已启动但未留痕，与未启动分开')
  ok(summarize(rows, new Date('2026-10-13T09:00:00Z'), []).missing[0].cause === 'NOT_STARTED', 'GitHub 也没有这次运行 → 调度漏跑')
  // 16:00 的未留痕运行落在盘中（13:30）与收盘后（15:40）两个窗口里，归到更近的收盘后
  const overlap = summarize(rows.filter(r => r.session !== 'post'), new Date('2026-10-13T12:00:00Z'),
    [{ databaseId: 7, event: 'schedule', createdAt: '2026-10-13T08:00:00Z', conclusion: 'failure' }])
  const on13 = (session: string) => overlap.missing.find(m => m.date === '2026-10-13' && m.session === session)?.cause
  ok(on13('post') === 'STARTED_NO_RECORD' && on13('intra') === 'NOT_STARTED', '窗口重叠时归到之前最近的一轮')
  const weekend = summarize([], new Date('2026-10-18T12:00:00Z'))
  ok(weekend.missing.every(m => ![0, 6].includes(new Date(`${m.date}T00:00:00Z`).getUTCDay())), '周末不算应有轮次')
}

void (async () => {
  await parityTests()
  process.stdout.write('\n【新浪重试】\n')
  await sinaFetchTests()
  const r = await pushAll('t', 'x', {})
  ok(r.length === 0, '无通道时不发请求')
  process.stdout.write(`\n每日执行单自检：${pass} 通过，${fail} 失败\n`)
  if (fail) process.exit(1)
})()
