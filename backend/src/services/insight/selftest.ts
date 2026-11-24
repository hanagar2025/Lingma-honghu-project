/**
 * 简报、记分牌、定时推送、设置、截图自动识别的自检。全部用合成数据，不含真实金额，不联网。
 *
 * 守六条：
 *   ① 简报不产生买卖指令，也不另起口径：资金分、卖出条件、三条线都取自执行单的决策输入；
 *   ② 只用已收盘的交易日判定；取不到的数据照实写出来；
 *   ③ 旧的机会闸门、回撤熔断、单票 12% 不再出现；
 *   ④ 自动识别与人工识别同一条路：过不了勾稽核对不进待确认，不经确认不改账本；
 *   ⑤ 密钥只进不出；服务器只去请求公网 https 地址；
 *   ⑥ 周末与窗口之外不推送，同一时段一天只跑一次。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runDaily } from '../daily'
import { buildCard, type DecisionCard } from '../dailyDecision/card'
import { buildDecisionInput } from '../dailyDecision/input'
import type { LedgerFile } from '../dailyDecision/ledger'
import type { ProducedCard } from '../dailyDecision/produce'
import type { DecisionInput, EvidenceRow, PlanFacts } from '../dailyDecision/types'
import { sinaSymbol, verifyInput, type SinaRaw } from '../dailyDecision/verify'
import { autoRecognize, confirm, submitImage } from '../intake/service'
import { Store } from '../intake/store'
import { noteCodes, toPayload } from '../intake/vision'
import { collectMarket, completedOnly, completedOnlyUs, type Bar, type MarketData } from '../market/data'
import { journalOf, scoreMarkdown, type JournalDay } from '../scoreboard/score'
import { dueSlots } from '../scheduler'
import { publicHttps, Settings } from '../settings'
import { buildBrief, composite, lowState } from './brief'
import { LOW_WINDOW } from './config'

let passed = 0
let failed = 0
function ok(cond: boolean, name: string): void {
  if (cond) passed++
  else failed++
  process.stdout.write(`  ${cond ? '✓' : '✗'} ${name}\n`)
}

/** 连续的工作日，旧的在前，最后一天是 end */
function days(end: string, count: number): string[] {
  const out: string[] = []
  const d = new Date(`${end}T00:00:00Z`)
  while (out.length < count) {
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) out.unshift(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() - 1)
  }
  return out
}

const END = '2026-11-13'
const TODAY = '2026-11-16'
const DATES = days(END, 100)
/** 先跌到第 lowAt 天（从末尾数），之后回升 */
function vShape(lowFromEnd: number, base = 100): Bar[] {
  const lowIndex = DATES.length - 1 - lowFromEnd
  return DATES.map((date, i) => ({ date, close: base * (1 + Math.abs(i - lowIndex) * 0.01) }))
}
const rising = (base = 100): Bar[] => DATES.map((date, i) => ({ date, close: base * (1 + i * 0.002) }))

const TRACKED = ['300308', '002463', '002916']

function market(over: Partial<MarketData> = {}): MarketData {
  const bars: Record<string, Bar[]> = { sh000001: rising(3000), sz399006: rising(2000), sh000688: rising(1000) }
  for (const code of TRACKED) bars[code] = vShape(20)
  bars['688041'] = vShape(20, 200)
  const margin = Object.fromEntries(TRACKED.map(code => [code, DATES.slice(-25).reverse().map((date, i) => ({ date, balance: 100 + i }))]))
  return {
    fetchedAt: `${TODAY} 08:50`,
    bars,
    us: {
      NVDA: { bars: vShape(20, 150), verified: true, note: '' },
      LITE: { bars: vShape(20, 500), verified: true, note: '' },
      COHR: { bars: vShape(20, 200), verified: true, note: '' },
    },
    margin,
    marketMargin: DATES.slice(-25).reverse().map((date, i) => ({ date, balance: 20000 + i })),
    failed: [],
    ...over,
  }
}

function ledger(over: Partial<LedgerFile> = {}): LedgerFile {
  return {
    asOf: END, cash: 900_000, externalCash: 0, peakAssets: 0,
    positions: [{ code: '002463', name: '沪电股份', quantity: 500, cost: 60 }],
    ...over,
  }
}

/** 合成的证据分读数。简报只照着读，不自己算 */
function row(code: string, name: string, weight: number, over: Partial<EvidenceRow> = {}): EvidenceRow {
  return {
    code, name, segment: 'PCB', weight, c: 3, cUnknown: 0, cUnknownWhy: [], t: 1, deduction: 0, deductionWhy: null, e: 4,
    provisional: false, addCap: 0.1, sellNote: '未成立', ...over,
  }
}

function planOf(rows: EvidenceRow[], over: Partial<PlanFacts> = {}): PlanFacts {
  return {
    asOf: END, marginAsOf: END, synced: true, rows, relatedWeight: 0, instructions: [], rolled: {}, buys: [], events: [], notices: [], backup: null, ...over,
  }
}

function produce(pf: LedgerFile, mk: MarketData, nav: number | null = 104, plan: PlanFacts | null = null): { input: DecisionInput; card: DecisionCard } {
  const lastBars = Object.fromEntries(pf.positions.map(p => {
    const b = mk.bars[p.code] ?? vShape(20)
    return [p.code, b[b.length - 1]!]
  }))
  const total = pf.cash + pf.positions.reduce((s, p) => s + p.quantity * lastBars[p.code]!.close, 0)
  const input = buildDecisionInput(pf, lastBars, [], TODAY, nav === null ? null : { totalAssets: total / (nav / 100), at: '2026-11-24 09:37', highIndex: 105 })
  input.plan = plan
  const sina: Record<string, SinaRaw> = { sh000001: { prevClose: 3000, price: 3010, date: END } }
  for (const h of input.holdings) sina[sinaSymbol(h.code)] = { prevClose: 1, price: h.close!, date: h.barDate! }
  return { input, card: buildCard(input, verifyInput(input, sina, 'PRE_OPEN'), 'PRE_OPEN', { today: TODAY }) }
}

process.stdout.write('\n【是否创 60 日新低】\n')
{
  const today = lowState(vShape(0))
  ok(today?.isLow === true && today.daysSince === 0, '最后一天最低 → 今日创新低')
  const five = lowState(vShape(5))
  ok(five?.isLow === false && five.daysSince === 5 && five.lastLowDate === DATES[DATES.length - 6], '5 天前最低 → 距上次新低 5 个交易日')
  const never = lowState(rising())
  ok(never !== null && never.lastLowDate === null && never.daysSince === DATES.length - LOW_WINDOW + 1, '一路上涨 → 数据范围内没有新低')
  ok(lowState(vShape(0).slice(0, 30)) === null, '日线不足 60 根 → 无法判定')
  const combo = composite(vShape(3, 500), vShape(3, 200))
  ok(combo.length === DATES.length && lowState(combo)?.daysSince === 3, '两只等权组合按共同日期合成')
}

process.stdout.write('\n【只用已收盘的交易日】\n')
{
  const bars = [...vShape(20), { date: TODAY, close: 1 }]
  ok(completedOnly(bars, new Date('2026-11-16T03:00:00Z')).length === bars.length - 1, '北京时间 11:00，当天那一根不算')
  ok(completedOnly(bars, new Date('2026-11-16T07:05:00Z')).length === bars.length, '北京时间 15:05，当天那一根算')
  const us = [...vShape(20), { date: '2026-11-16', close: 1 }]
  ok(completedOnlyUs(us, new Date('2026-11-16T15:00:00Z')).length === us.length - 1, '纽约时间上午，美股当天那一根不算')
  ok(completedOnlyUs(us, new Date('2026-11-16T22:00:00Z')).length === us.length, '纽约时间 17:00，美股当天那一根算')
}

process.stdout.write('\n【简报】\n')
{
  const mk = market()
  const pf = ledger({
    cash: 300_000,
    positions: [
      { code: '002463', name: '沪电股份', quantity: 1000, cost: 60 },
      { code: '688041', name: '海光信息', quantity: 1000, cost: 200 },
      { code: '300750', name: '宁德时代', quantity: 100, cost: 240 },
    ],
  })
  const plan = planOf([
    row('002463', '沪电股份', 0.2, { c: 4, t: 2, e: 6, addCap: 0.2 }),
    row('688041', '海光信息', 0.4, { c: 0, cUnknown: 2, cUnknownWhy: ['主力净流入'], t: 0, deduction: 1, deductionWhy: '2026-09 报告期净利同比 -8%', e: -1, addCap: 0, sellNote: '缺数据，核对不了' }),
    row('300750', '宁德时代', 0.05, { c: 1, t: 0, e: 1, addCap: 0, provisional: true, sellNote: '减半条件初算成立，待定稿' }),
  ], { events: ['宁德时代：生成卖出指令（一半）—— 资金分连续 2 天 ≤1'] })
  const { input, card } = produce(pf, mk, 104, plan)
  const brief = buildBrief(input, card, mk, TODAY)
  const risk = brief.sections.find(s => s.id === 'risk')!.markdown
  const all = brief.sections.map(s => s.markdown).join('\n') + brief.push
  ok(risk.includes('### 沪电股份') && risk.includes('资金分 C=4，趋势分 T=2，证据分 E=6；加仓上限 20.0%。卖出条件：未成立'), '每只持仓写资金分、趋势分、证据分、加仓上限和卖出条件')
  ok(/海光信息[\s\S]*缺主力净流入，缺的按 0 分[\s\S]*基本面扣 1 分[\s\S]*不加仓。卖出条件：缺数据，核对不了/.test(risk), '缺数据和扣分照实写；核对不了就写核对不了')
  ok(/宁德时代[\s\S]*（初算）[\s\S]*待定稿/.test(risk), '初算的读数标明初算')
  ok(risk.includes('不因占比高卖出') && risk.includes('资金分与趋势分截至 11/13 收盘'), '写明卖出只看资金分和趋势，以及读数截至哪天')
  ok(!/^\s*\d+\.\s*买入/m.test(all) && !all.includes('建议买入') && !all.includes('拿住') && !all.includes('须委员会指派'), '简报里没有买入指令，也没有旧的登记结论')
  ok(!/闸门|熔断|12%|峰值|四条主线/.test(all), '旧的机会闸门、回撤熔断、单票 12%、峰值不再出现')
  ok(!brief.sections.some(s => (s.id as string) === 'gate'), '没有机会闸门这一块')
  const goal = brief.sections.find(s => s.id === 'goal')!.markdown
  ok(goal.includes('净值指数 104.0') && goal.includes('目标 178，还要上涨 71.2%') && goal.includes('最高到过 105.0'), '进度按净值指数写：现在多少、离目标多远')
  ok(goal.includes('下一个进度线：12/20 要到 110，现在还差 5.8%'), '下一个进度线和差距')
  ok(goal.includes('观察线 95 +9.5%') && goal.includes('停手线 85 +22.4%'), '净值相对三条线的距离')
  ok(brief.changes.some(c => c.includes('生成卖出指令')), '指令变动列在今天的变化里')
  ok(brief.asOf === END, '写明行情截止日')

  const noBase = produce(pf, mk, null, plan)
  const nb = buildBrief(noBase.input, noBase.card, mk, TODAY)
  ok(nb.sections.find(s => s.id === 'goal')!.markdown.includes('净值基准还没填') && nb.todo.some(t => t.includes('净值基准还没填')), '净值基准没填 → 进度算不出，列进需要您做的')

  const bare = produce(pf, mk)
  ok(buildBrief(bare.input, bare.card, mk, TODAY).sections.find(s => s.id === 'risk')!.markdown.includes('资金分、趋势分算不出（链上数据没有接入）'), '链上数据没接入 → 写明算不出，不编读数')

  const down = market({ failed: ['全市场融资余额'], marketMargin: [] })
  const b2 = buildBrief(input, card, down, TODAY)
  ok(b2.todo.some(t => t.includes('全市场融资余额')), '取不到的数据写出来，不悄悄略过')

  const breaking = produce(pf, mk)
  breaking.input.holdings[0] = { ...breaking.input.holdings[0]!, close: 1, barDate: TODAY }
  ok(buildBrief(breaking.input, breaking.card, mk, TODAY).changes.some(c => c.includes('沪电股份') && c.includes('收盘不回升就是新低')), '盘中跌破 60 日最低收盘价 → 列在今天的变化里')

  const failedInput = { ...input, priceFailed: ['002463'] }
  const fb = buildBrief(failedInput, { ...card, ok: false }, mk, TODAY)
  ok(fb.todo[0]!.includes('持仓价格取不到') && fb.sections.find(s => s.id === 'goal')!.markdown.includes('算不出进度')
    && !fb.sections.find(s => s.id === 'risk')!.markdown.includes('占总资产'), '持仓价格取不到 → 不用成本价冒充占比与进度')

  const none = buildBrief(null, { ok: false, title: 't', push: '', markdown: '', lines: [] }, mk, TODAY)
  ok(none.todo[0]!.includes('上传一张持仓截图'), '没有账本 → 第一件事是上传持仓截图')
}

process.stdout.write('\n【记分牌】\n')
{
  const day = (date: string, close: number, qty: number, order: boolean): JournalDay => ({
    date, ledgerAsOf: date, total: 500_000 + qty * close, cash: 500_000,
    positions: [{ code: '300308', name: '中际旭创', quantity: qty, close }],
    bench: 2000, orders: order ? [{ code: '300308', name: '中际旭创', shares: 600, refPrice: close, reason: '资金 0 分' }] : [],
  })
  const journal = [day('2026-11-11', 500, 1100, true), day('2026-11-12', 480, 1100, true), day('2026-11-13', 450, 1100, true)]
  const text = scoreMarkdown(journal, [], {})
  ok(text.includes('自 11/11 起已挂 3 个交易日未完成') && text.includes('-10.0%'), '执行差：挂了几天、这几天价格怎么走')
  ok(text.includes('多亏了约占总资产'), '执行差：没卖的那部分的代价')
  ok(text.includes('账户 -5.2%') && text.includes('不交易 -5.2%'), '净值：账户与不交易对照')
  const sold = [...journal, day('2026-11-16', 430, 500, false)]
  ok(scoreMarkdown(sold, [], {}).includes('现在没有未完成的指令') && scoreMarkdown(sold, [], {}).includes('共 1 次'), '卖出后指令消失并计入已执行')
  const trades = [
    { id: 'a', date: '2026-11-12', side: 'SELL' as const, code: '300308', name: '中际旭创', quantity: 600, price: 480 },
    { id: 'b', date: '2026-11-12', side: 'BUY' as const, code: '600183', name: '生益科技', quantity: 100, price: 70 },
    { id: 'c', date: '2026-11-12', side: 'BUY' as const, code: '002463', name: '沪电股份', quantity: 100, price: 80 },
    { id: 'c', void: true },
  ]
  const scored = scoreMarkdown(journal, trades, { '600183': 63 })
  ok(scored.includes('卖出 中际旭创 600 股') && scored.includes('规则内') && scored.includes('避开了之后的下跌'), '规则内的卖出记分')
  ok(scored.includes('买入 生益科技 100 股') && scored.includes('规则外（执行单上没有，记为偏离）') && scored.includes('-10.0%'), '执行单上没有的买入记为偏离，照样记分')
  ok(!scored.includes('沪电股份'), '已撤销的成交不记分')
  ok(scoreMarkdown([], [], {}).includes('留底不足两个交易日'), '没有留底时写明还不能比')

  const mk = market()
  const { input, card } = produce(ledger(), mk)
  ok(journalOf(input, card, END, 2000)?.date === END, '价格是收盘价 → 留底')
  ok(journalOf(input, card, TODAY, 2000) === null, '价格不是当日收盘价 → 不留底')
  ok(journalOf(input, { ...card, ok: false }, END, 2000) === null, '执行单停单 → 不留底')
}

process.stdout.write('\n【定时推送】\n')
{
  const at = (iso: string): Date => new Date(iso)
  ok(dueSlots(at('2026-11-16T07:52:00Z'), {}).map(s => s.id).join() === 'post', '周一 15:52 → 收盘后那一轮（排在日线和主力净流入拉取之后）')
  ok(dueSlots(at('2026-11-16T07:12:00Z'), {}).length === 0, '15:12 日线还没拉，不出收盘后那一单')
  ok(dueSlots(at('2026-11-16T07:52:00Z'), { post: '2026-11-16' }).length === 0, '当天跑过就不再跑')
  ok(dueSlots(at('2026-11-16T07:52:00Z'), { post: '2026-11-13' }).length === 1, '上一个交易日跑过不影响今天')
  ok(dueSlots(at('2026-11-15T07:52:00Z'), {}).length === 0, '周日不跑')
  ok(dueSlots(at('2026-11-16T08:20:00Z'), {}).length === 0, '过了窗口不补发')
  ok(dueSlots(at('2026-11-16T01:21:00Z'), {}).map(s => s.id).join() === 'pre', '09:21 → 开盘前那一轮')
}

const dir = mkdtempSync(join(tmpdir(), 'honghu-insight-'))
try {
  const store = new Store(dir)

  process.stdout.write('\n【设置】\n')
  {
    const settings = new Settings(store, {})
    ok(publicHttps('https://api.day.app/abc') && !publicHttps('http://api.day.app/abc'), '只收 https 地址')
    ok(!publicHttps('https://localhost/x') && !publicHttps('https://127.0.0.1/x') && !publicHttps('https://100.100.100.200/x') && !publicHttps('https://[::1]/x'), '不收本机与 IP 地址')
    ok(settings.set('BARK_URL', 'http://10.0.0.1/') !== null && settings.set('NOPE', 'x') !== null, '不合规的地址与不认识的设置项被拒')
    ok(settings.set('PUSHPLUS_TOKEN', 'secret-token-1') === null && settings.pushConfigured, '填了一个通道就算已配置')
    ok(!JSON.stringify(settings.view()).includes('secret-token-1'), '页面读不回密钥')
    ok(settings.vision() === null, '没填识别密钥 → 不自动识别')
    settings.set('VISION_API_KEY', 'k')
    ok(settings.vision()?.url.startsWith('https://dashscope.aliyuncs.com') === true, '识别地址有缺省值')
    ok(settings.set('PUSHPLUS_TOKEN', '') === null && !settings.pushConfigured, '空值即清除')
  }

  process.stdout.write('\n【截图自动识别】\n')
  {
    const raw = {
      kind: 'HOLDINGS', totalAssets: 1_000_000, totalMarketValue: 150_000, available: 850_000,
      positions: [
        { name: '沪电股份', code: null, quantity: 1000, price: 80, marketValue: 80_000, cost: 60 },
        { name: '某某股份', code: null, quantity: 1000, price: 70, marketValue: 70_000 },
      ],
    }
    const book = { 沪电股份: '002463', ...noteCodes('某某股份 600000 是新买的') }
    const { payload } = toPayload(raw, TODAY, book) as { payload: { holdings: { cash: number; positions: { code: string }[] } } }
    ok(payload.holdings.cash === 850_000 && payload.holdings.positions.map(p => p.code).join() === '002463,600000', '名称查代码；说明里的「名称 代码」可以补充')
    let threw = ''
    try { toPayload(raw, TODAY, { 沪电股份: '002463' }) } catch (e) { threw = (e as Error).message }
    ok(threw.includes('某某股份') && threw.includes('6位代码'), '查不到代码 → 不猜，写明怎么补')
    threw = ''
    try { toPayload({ ...raw, totalAssets: null }, TODAY, book) } catch (e) { threw = (e as Error).message }
    ok(threw.includes('总资产'), '关键数字没读出来 → 不凑数')

    const png = `data:image/png;base64,${Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(32)]).toString('base64')}`
    const cfg = { url: 'https://vision.example.com/v1', model: 'm', key: 'k' }
    const reply = (content: unknown): typeof fetch => (async () => new Response(JSON.stringify({ choices: [{ message: { content } }] }))) as typeof fetch
    const good = { ...raw, positions: [raw.positions[0], { ...raw.positions[1], name: '生益科技' }] }

    const a = submitImage({ store }, png) as { id: string }
    const done = await autoRecognize(store, a.id, cfg, async () => undefined, reply('```json\n' + JSON.stringify(good) + '\n```'))
    ok(done?.status === 'PENDING_CONFIRM' && done.parsedBy === 'VISION', '读对了 → 进入等您确认')
    ok(store.readLedger() === null, '确认之前账本不变')
    confirm({ store }, a.id)
    ok(store.readLedger()?.positions.length === 2 && store.readLedger()?.asOf === done?.receivedAt.slice(0, 10), '确认之后账本更新')

    const b = submitImage({ store }, png) as { id: string }
    const wrong = { ...good, positions: [{ ...good.positions[0], quantity: 7000 }, good.positions[1]] }
    const bad = await autoRecognize(store, b.id, cfg, async () => undefined, reply(JSON.stringify(wrong)))
    ok(bad?.status === 'NEEDS_FIX', '读错一位数字 → 勾稽核对拦住，不能确认')

    const c = submitImage({ store }, png) as { id: string }
    const denied = await autoRecognize(store, c.id, cfg, async () => undefined, (async () => new Response('', { status: 401 })) as typeof fetch)
    ok(denied?.status === 'PENDING_PARSE' && denied.summary!.includes('自动识别没有成功') && denied.summary!.includes('密钥'), '识别服务出错 → 留给人工识别，并写明原因')

    const d = submitImage({ store }, png) as { id: string }
    const other = await autoRecognize(store, d.id, cfg, async () => undefined, reply('{"kind":"OTHER"}'))
    ok(other?.status === 'RECORDED' && store.readLedger()?.positions.length === 2, '不是持仓也不是成交 → 当留言，不动账本')
  }

  process.stdout.write('\n【一整套：执行单 → 简报 → 留底】\n')
  {
    const pf = ledger()
    const mk = market()
    const { input, card } = produce(pf, mk)
    const produced: ProducedCard = { card, input, session: 'PRE_OPEN', generatedAt: `${TODAY} 08:50` }
    const text = (body: string): Response => new Response(body)
    const rows = (bars: Bar[]): string[][] => bars.map(b => [b.date, '0', String(b.close), '0', '0', '0'])
    const fake = (async (url: string | URL | Request) => {
      const u = String(url)
      const m = /param=([\w.]+),day/.exec(u)
      if (m) {
        const code = m[1]!.replace(/^(sh|sz)(\d{6})$/, '$2')
        const bars = mk.bars[code] ?? mk.bars[m[1]!] ?? mk.us[m[1]!.replace(/^us(\w+)\..*$/, '$1')]?.bars
        return text(JSON.stringify({ code: 0, data: { [m[1]!]: { qfqday: rows(bars ?? []) } } }))
      }
      if (u.includes('US_MinKService')) {
        const key = /symbol=(\w+)/.exec(u)![1]!.toUpperCase()
        const last = mk.us[key]!.bars.slice(-1)[0]!
        return text(`var _x=([{"d":"${last.date}","o":"1","h":"1","l":"1","c":"${last.close}","v":"1"}]);`)
      }
      if (u.includes('RPTA_RZRQ_LSHJ')) return text(JSON.stringify({ result: { data: mk.marketMargin.map(r => ({ DIM_DATE: r.date, RZYE: r.balance })) } }))
      if (u.includes('RPTA_WEB_RZRQ_GGMX')) return text(JSON.stringify({ result: { data: mk.marketMargin.map(r => ({ DATE: r.date, RZYE: r.balance })) } }))
      return new Response('', { status: 404 })
    }) as typeof fetch
    const now = new Date('2026-11-16T00:50:00Z')
    const collected = await collectMarket(['002463'], { now, doFetch: fake })
    ok(collected.failed.length === 0 && collected.us.NVDA?.verified === true && collected.bars['002463']?.length === DATES.length, '行情、融资、美股两源核对都取到')
    const daily = await runDaily(store, produced, { now, doFetch: fake })
    ok(daily.brief.sections.map(s => s.id).join() === 'risk,goal,forecast,score,todo', '简报五块齐全，记分牌在其中')
    ok((store.listJournal() as JournalDay[]).map(j => j.date).join() === END, '开盘前补上一交易日的留底')
    await runDaily(store, produced, { now, doFetch: fake })
    ok(store.listJournal().length === 1, '同一天不重复留底')
  }
} finally {
  rmSync(dir, { recursive: true, force: true })
}

process.stdout.write(`\n简报自检：${passed} 通过，${failed} 失败\n`)
if (failed) process.exit(1)
