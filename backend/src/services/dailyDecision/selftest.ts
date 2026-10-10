/**
 * 每日执行单自检。守四条：
 *   ① 数据核对不通过就不出股数（fail-closed）；
 *   ② 顺序固定：C 级清退 → 单票归位 → 熔断 → 新增投资；
 *   ③ 执行单不新增判定 —— 只排序驾驶舱动作与委员会已登记的指令；
 *   ④ 熔断待核验时第③步不出现在执行列表里，也不消失。
 */
import { buildCard, buildFailureCard } from './card'
import { configuredChannels, pushAll } from './notify'
import type { CommitteeOrder } from './orders'
import type { DecisionInput } from './types'
import { parseSinaRaw, sinaSymbol, verifyInput, type SinaRaw } from './verify'
import type { Action } from '../cockpit/types'

let pass = 0
let fail = 0
function ok(cond: boolean, name: string): void {
  if (cond) { pass++; process.stdout.write(`  ✓ ${name}\n`) } else { fail++; process.stdout.write(`  ✗ ${name}\n`) }
}

const ORDERS: CommitteeOrder[] = [
  { code: '688008', name: '澜起科技', sell: 'ALL', reason: 'C 级清退', source: 'test' },
  { code: '603986', name: '兆易创新', sell: 'ALL', reason: 'C 级清退', source: 'test' },
]

function limitAction(code: string, name: string, shares: number | null): Action {
  return {
    code, name, kind: 'REDUCE', reason: 'POSITION_LIMIT', reasonDetail: '', notReason: [], reviewTriggers: [],
    size: { display: '', value: shares, note: '' }, metrics: [],
  }
}

function baseInput(over: Partial<DecisionInput> = {}): DecisionInput {
  const holdings = [
    { code: '688041', name: '海光信息', quantity: 2500, close: 200, barDate: '2026-10-09' },
    { code: '688008', name: '澜起科技', quantity: 1300, close: 100, barDate: '2026-10-09' },
    { code: '603986', name: '兆易创新', quantity: 200, close: 300, barDate: '2026-10-09' },
    { code: '300502', name: '新易盛', quantity: 1000, close: 50, barDate: '2026-10-09' },
  ]
  const positionsValue = holdings.reduce((s, h) => s + h.quantity * h.close, 0)
  const cash = 1_200_000 - positionsValue
  return {
    date: '2026-10-09',
    ledgerAsOf: '2026-10-09',
    account: { stale: false, staleDays: 1, gaps: [] },
    snapshot: {
      date: '2026-10-09', brokerTotal: 1_200_000, cash, positionsValue, externalCash: 0,
      portfolioTotal: 1_200_000, peakAssets: 4_300_000, peakBasis: 'PORTFOLIO', peakVerified: false,
    } as DecisionInput['snapshot'],
    circuit: { drawdown: 1 - 300 / 430, equityCap: 0.30, sellOnly: true, level: 'LEVEL2' },
    holdings,
    priceFailed: [],
    actions: [limitAction('688041', '海光信息', 700), limitAction('688008', '澜起科技', 100)],
    noNewEntry: { verdict: true, reasons: [] },
    dataGaps: [],
    ...over,
  }
}

function sinaFor(input: DecisionInput, mutate: (s: Record<string, SinaRaw>) => void = () => {}): Record<string, SinaRaw> {
  const s: Record<string, SinaRaw> = { sh000001: { prevClose: 3000, price: 3010, date: '2026-10-09' } }
  for (const h of input.holdings) s[sinaSymbol(h.code)] = { prevClose: 1, price: h.close!, date: h.barDate! }
  mutate(s)
  return s
}

process.stdout.write('\n【核对通过：顺序与股数】\n')
{
  const input = baseInput()
  const v = verifyInput(input, sinaFor(input), 'POST_CLOSE')
  const card = buildCard(input, v, 'POST_CLOSE', { orders: ORDERS })
  ok(v.ok && card.ok, '两源一致 → 出执行单')
  ok(card.lines.map(l => l.code).join(',') === '688008,603986,688041', 'C 级清退在前、单票归位在后')
  ok(card.lines.filter(l => l.code === '688008').length === 1, '委员会已清仓的股票不再重复出单票归位指令')
  ok(card.lines[0]!.shares === 1300 && card.lines[0]!.all, 'C 级清退 = 账本全部股数')
  ok(card.lines[2]!.shares === 700, '单票归位股数取驾驶舱动作，不在执行单里重算')
  ok(card.push.includes('不买入任何股票'), '二级熔断 → 写明不买入')
  ok(card.push.includes('待账本核验') && !card.lines.some(l => l.code === 'PORTFOLIO'), '熔断待核验：第③步不进执行列表，也不消失')
  ok(!card.push.includes('*'.repeat(2)), '推送正文无 Markdown 星号')
  ok(card.markdown.includes('核对明细') && !card.push.includes('核对明细'), '核对明细只进存档，不进推送')
}

process.stdout.write('\n【已执行的指令自动消项】\n')
{
  const input = baseInput()
  input.holdings = input.holdings.map(h => (h.code === '603986' ? { ...h, quantity: 0 } : h))
  const v = verifyInput(input, sinaFor(input), 'POST_CLOSE')
  const card = buildCard(input, v, 'POST_CLOSE', { orders: ORDERS })
  ok(!card.lines.some(l => l.code === '603986'), '账本股数为 0 → 指令不再出现')
}

process.stdout.write('\n【fail-closed】\n')
{
  const input = baseInput()
  const v = verifyInput(input, sinaFor(input, s => { s.sh688041!.price = 210 }), 'POST_CLOSE')
  const card = buildCard(input, v, 'POST_CLOSE', { orders: ORDERS })
  ok(!v.ok && !card.ok && card.lines.length === 0, '收盘价两源差 5% → 不出股数')
  ok(card.title.includes('不下单') && card.push.includes('海光信息'), '标题写不下单，正文点名哪只没对上')
}
{
  const input = baseInput({ account: { stale: true, staleDays: 9, gaps: [] } })
  const card = buildCard(input, verifyInput(input, sinaFor(input), 'POST_CLOSE'), 'POST_CLOSE', { orders: ORDERS })
  ok(!card.ok && card.lines.length === 0 && card.push.includes('落后 9 天'), '账本超期 → 不出股数')
}
{
  const input = baseInput()
  const card = buildCard(input, verifyInput(input, null, 'POST_CLOSE'), 'POST_CLOSE', { orders: ORDERS })
  ok(!card.ok && card.lines.length === 0, '第二数据源取不到 → 不出股数')
}
{
  const input = baseInput({ priceFailed: ['300502'] })
  const card = buildCard(input, verifyInput(input, sinaFor(input), 'POST_CLOSE'), 'POST_CLOSE', { orders: ORDERS })
  ok(!card.ok, '持仓行情拉取失败 → 不出股数')
}
{
  const input = baseInput({ actions: [limitAction('688041', '海光信息', null)] })
  const card = buildCard(input, verifyInput(input, sinaFor(input), 'POST_CLOSE'), 'POST_CLOSE', { orders: ORDERS })
  ok(!card.ok, '超限但换算不出股数 → 不出执行单')
}
{
  const input = baseInput()
  const s = sinaFor(input, x => {
    x.sh000001!.date = '2026-10-12'
    for (const k of Object.keys(x)) x[k]!.date = '2026-10-12'
  })
  const v = verifyInput(input, s, 'POST_CLOSE')
  ok(!v.ok, '收盘后主数据源停在前一日 → 不通过')
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
  const card = buildCard(input, v, 'PRE_OPEN', { orders: ORDERS, today: '2026-10-12' })
  ok(card.title.includes('10/12 开盘') && card.push.includes('按 10/9 收盘核对'), '标题是执行日，正文写明数据日')
}

process.stdout.write('\n【熔断已核实：降仓须委员会指派】\n')
{
  const circuitAct: Action = {
    code: 'PORTFOLIO', name: '组合整体', kind: 'REDUCE', reason: 'CIRCUIT_BREAKER', reasonDetail: '', notReason: [],
    reviewTriggers: [], size: { display: '', value: 500_000, note: '' }, metrics: [],
  }
  const input = baseInput({ actions: [circuitAct] })
  input.snapshot.peakVerified = true
  const card = buildCard(input, verifyInput(input, sinaFor(input), 'POST_CLOSE'), 'POST_CLOSE', { orders: ORDERS })
  ok(card.push.includes('须委员会指派') && card.push.includes('50.00万'), '组合降仓写金额与指派要求')
  ok(!card.lines.some(l => l.code === 'PORTFOLIO'), '组合降仓不自己挑股票')
}

process.stdout.write('\n【无动作】\n')
{
  const input = baseInput({ actions: [], circuit: { drawdown: 0.05, equityCap: null, sellOnly: false, level: 'NORMAL' } })
  input.holdings = input.holdings.filter(h => h.code === '688041')
  const card = buildCard(input, verifyInput(input, sinaFor(input), 'POST_CLOSE'), 'POST_CLOSE', { orders: ORDERS })
  ok(card.ok && card.lines.length === 0 && card.title.includes('不交易'), '无法定理由 → 不交易')
  ok(card.push.includes('不新开仓'), '未熔断但无新增建仓 → 写不新开仓')
}

process.stdout.write('\n【解析与推送】\n')
{
  const f = Array(33).fill('0')
  f[0] = '海光信息'; f[2] = '219.00'; f[3] = '219.59'; f[30] = '2026-10-09'
  const parsed = parseSinaRaw(`var hq_str_sh688041="${f.join(',')}";`)
  ok(parsed.sh688041?.price === 219.59 && parsed.sh688041?.prevClose === 219, '新浪行情解析现价与昨收')
  ok(sinaSymbol('688041') === 'sh688041' && sinaSymbol('300502') === 'sz300502', '沪深代码前缀')
  ok(configuredChannels({}).length === 0, '未配置通道 → 无推送目标')
  const fc = buildFailureCard('2026-10-12', '驾驶舱运行失败')
  ok(!fc.ok && fc.title.includes('不下单'), '采集失败也出一张「不下单」')
}

void (async () => {
  const r = await pushAll('t', 'x', {})
  ok(r.length === 0, '无通道时不发请求')
  process.stdout.write(`\n每日执行单自检：${pass} 通过，${fail} 失败\n`)
  if (fail) process.exit(1)
})()
