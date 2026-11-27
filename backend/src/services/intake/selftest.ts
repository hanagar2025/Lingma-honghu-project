/**
 * 输入框自检。全部用合成数据，不含真实金额。
 *
 * 守五条：
 *   ① 认不出的文字当留言，不猜；
 *   ② 识别结果必须过勾稽核对，读错一位数字要拦得住；
 *   ③ 图片识别结果不经委员会确认不生效；
 *   ④ 账本只被持仓快照整份替换，成交不改账本；
 *   ⑤ 意向按收到时刻登记，只定性、不阻止。
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseAmount, parseText } from './parseText'
import { checksPassed, classifyIntent, reconcileHoldings } from './reconcile'
import { attachParsed, confirm, reject, submitImage, submitText, validateParsed } from './service'
import { decodeImage, Store } from './store'
import type { HoldingsSnapshot } from './types'

let passed = 0
let failed = 0
function ok(cond: boolean, name: string): void {
  if (cond) passed++
  else failed++
  process.stdout.write(`  ${cond ? '✓' : '✗'} ${name}\n`)
}

const BOOK = { 中际旭创: '300308', 海光信息: '688041', 沪电股份: '002463' }
const TODAY = '2026-11-11'

process.stdout.write('\n【文字句式】\n')
{
  const intent = parseText('计划卖出 中际旭创 600股 单票归位', BOOK, TODAY)
  ok(intent.parsed.kind === 'INTENT' && intent.parsed.intent.side === 'SELL' && intent.parsed.intent.quantity === 600
    && intent.parsed.intent.reason === '单票归位', '下单前一行字：方向、股票、股数、理由')
  const plain = parseText('计划卖出 中际旭创 600 超过上限', BOOK, TODAY)
  ok(plain.parsed.kind === 'INTENT' && plain.parsed.intent.quantity === 600 && plain.parsed.intent.reason === '超过上限', '股数后面不写「股」也读得出')
  const bare = parseText('打算买入 002463', BOOK, TODAY)
  ok(bare.parsed.kind === 'INTENT' && bare.parsed.intent.name === '沪电股份' && bare.parsed.intent.quantity === null, '可以只写代码、不写股数')
  const trade = parseText('卖出 中际旭创 600股 509.89\n买入 沪电股份 1000 @ 61.5', BOOK, TODAY)
  ok(trade.parsed.kind === 'TRADE' && trade.parsed.trades.length === 2 && trade.parsed.trades[0]!.price === 509.89
    && trade.parsed.trades[1]!.side === 'BUY', '成交可以多行，带成交价')
  const noPrice = parseText('已购 沪电股份 100股', BOOK, TODAY)
  ok(noPrice.parsed.kind === 'TRADE' && noPrice.parsed.trades[0]!.price === null, '没写成交价也记录，价格留空')
  const wide = parseText('卖出　中际旭创　６００股　５０９．８９', BOOK, TODAY)
  ok(wide.parsed.kind === 'TRADE' && wide.parsed.trades[0]!.quantity === 600, '全角数字与空格照样读')
  const holdings = parseText('持仓\n中际旭创 400\n海光信息 650 成本 180.5\n现金 62万', BOOK, TODAY)
  ok(holdings.parsed.kind === 'HOLDINGS' && holdings.parsed.holdings.cash === 620_000
    && holdings.parsed.holdings.positions[1]!.cost === 180.5 && !holdings.errors.length, '持仓：每行一只，现金可写「万」')
  ok(parseText('持仓\n中际旭创 400', BOOK, TODAY).errors.some(e => e.includes('现金')), '持仓缺现金 → 不生效')
  ok(parseText('计划卖出 不存在的股票 100股', BOOK, TODAY).errors.length === 1, '不认识的名称 → 要求写代码，不猜')
  const fresh = parseText('持仓\n宁德时代 300750 200\n中际旭创 400\n现金 62万', BOOK, TODAY)
  ok(fresh.parsed.kind === 'HOLDINGS' && !fresh.errors.length && fresh.parsed.holdings.positions[0]!.code === '300750'
    && fresh.parsed.holdings.positions[0]!.name === '宁德时代' && fresh.parsed.holdings.positions[0]!.quantity === 200, '名单外的股票写成「名称 代码 股数」')
  const outside = parseText('卖出 宁德时代 300750 200股 246.6', BOOK, TODAY)
  ok(outside.parsed.kind === 'TRADE' && outside.parsed.trades[0]!.code === '300750' && outside.parsed.trades[0]!.quantity === 200 && outside.parsed.trades[0]!.price === 246.6, '成交同样可以带代码')
  ok(parseText('计划卖出 中际旭创 688041 100股', BOOK, TODAY).errors[0]!.includes('对不上'), '名称与代码对不上 → 不猜')
  const big = parseText('持仓\n中际旭创 300308\n现金 1万', BOOK, TODAY)
  ok(big.parsed.kind === 'HOLDINGS' && big.parsed.holdings.positions[0]!.quantity === 300308, '「名称 数字」里的数字是股数，不当代码')
  ok(parseText('今天感觉要反弹', BOOK, TODAY).parsed.kind === 'NOTE', '认不出的句子当留言')
  ok(parseText('卖出 中际旭创 600\n顺便问一下明天怎么看', BOOK, TODAY).parsed.kind === 'NOTE', '混着闲话的不当成交，整条当留言')
  ok(parseAmount('872,401.30元') === 872401.3 && parseAmount('1.2亿') === 120_000_000 && parseAmount('很多') === null, '金额写法')
}

/** 合成截图：总资产 100 万 */
function shot(): HoldingsSnapshot {
  return {
    asOf: TODAY, cash: 620_000, totalAssets: 1_000_000, totalMarketValue: 380_000,
    positions: [
      { code: '300308', name: '中际旭创', quantity: 400, price: 500, marketValue: 200_000 },
      { code: '688041', name: '海光信息', quantity: 650, price: 200, marketValue: 130_000 },
      { code: '300750', name: '宁德时代', quantity: 200, price: 250, marketValue: 50_000 },
    ],
  }
}

process.stdout.write('\n【勾稽核对】\n')
{
  ok(reconcileHoldings(shot()).every(c => c.ok === true), '三条等式全部对上')
  const wrongQty = shot()
  wrongQty.positions[0]!.quantity = 4000
  ok(!checksPassed(reconcileHoldings(wrongQty)), '股数多读一个零 → 市值对不上')
  const wrongCash = shot()
  wrongCash.cash = 602_000
  ok(!checksPassed(reconcileHoldings(wrongCash)), '现金两位数字读反 → 总资产对不上')
  const missing = shot()
  missing.positions.pop()
  ok(!checksPassed(reconcileHoldings(missing)), '漏读一只持仓 → 总市值对不上')
  const ranges = { '300308': { low: 480, high: 510 }, '688041': { low: 195, high: 205 }, '300750': { low: 240, high: 260 } }
  ok(reconcileHoldings(shot(), ranges).every(c => c.ok === true), '现价都在当日区间内')
  ok(!checksPassed(reconcileHoldings(shot(), { ...ranges, '300308': { low: 520, high: 540 } })), '现价不在当日区间 → 不通过')
  const partial = reconcileHoldings(shot(), { '300308': ranges['300308'] })
  ok(checksPassed(partial) && partial.some(c => c.ok === null), '行情取不到是「没核对」，不冒充通过')
  const dup = shot()
  dup.positions[1]!.code = '300308'
  ok(!checksPassed(reconcileHoldings(dup)), '代码重复 → 不通过')
}

process.stdout.write('\n【意向定性】\n')
{
  const sell = { side: 'SELL' as const, code: '300308', name: '中际旭创', reason: '' }
  const held = { '300308': 400 }
  ok(classifyIntent({ ...sell, quantity: 200 }, { '300308': 200 }, held).startsWith('规则内。与执行单一致'), '与执行单一致 → 规则内')
  ok(classifyIntent({ ...sell, quantity: 100 }, { '300308': 200 }, held).includes('不足'), '卖少了 → 规则内但不足')
  ok(classifyIntent({ ...sell, quantity: 300 }, { '300308': 200 }, held).includes('多出的 100 股在规则外'), '卖多了 → 多出部分在规则外')
  ok(classifyIntent({ ...sell, quantity: 100 }, {}, held).startsWith('规则外'), '执行单没有这条指令 → 规则外')
  ok(classifyIntent({ ...sell, quantity: 100 }, {}, {}).includes('没有'), '账本里没有这只 → 规则外')
  ok(classifyIntent({ ...sell, quantity: 100 }, null, held).includes('无法判断'), '执行单停单时不对卖出定性，不冒充「规则外」')
  const buy = classifyIntent({ side: 'BUY', code: '300750', name: '宁德时代', quantity: 100, reason: '' }, {}, {})
  ok(buy.startsWith('规则外') && buy.includes('不在四条主线内') && buy.includes('已按收到时刻登记'), '买入一律规则外；主线外另行写明；照样登记')
}

process.stdout.write('\n【收件、确认、生效】\n')
{
  const dir = mkdtempSync(join(tmpdir(), 'intake-'))
  try {
    const store = new Store(dir)
    const at = (hms: string) => new Date(`2026-11-11T${hms}+08:00`)

    const first = submitText({ store, now: at('09:00:00') }, '持仓\n中际旭创 400\n海光信息 650\n现金 62万')
    ok(first.status === 'RECORDED' && store.readLedger()?.positions.length === 2 && store.readLedger()?.asOf === TODAY, '文字持仓读得出 → 直接成为账本')
    ok(first.summary!.includes('截图更可靠'), '文字持仓没有金额可勾稽，如实提示')
    ok(store.readLedger()?.peakVerified === false && store.readLedger()?.peakBasis === 'BROKER', '第一份账本没有峰值 → 标为未核实、口径不可比')

    const intent = submitText({ store, now: at('09:25:10'), instructed: { '300308': 200 } }, '计划卖出 中际旭创 200股')
    ok(intent.receivedAt === '2026-11-11 09:25:10' && intent.verdict!.startsWith('规则内'), '意向按服务器收到的时刻登记并定性')
    ok(store.readLog('intents').length === 1, '意向进入只追加的记录')

    const trade = submitText({ store, now: at('09:31:00') }, '卖出 中际旭创 200股 501.2')
    ok(trade.status === 'RECORDED' && store.readLog('trades').length === 1, '成交进入记录')
    ok(store.readLedger()?.positions.find(p => p.code === '300308')?.quantity === 400, '成交不改账本，账本只认持仓快照')

    const note = submitText({ store, now: at('09:40:00') }, '下午可能没时间看盘')
    ok(note.status === 'RECORDED' && note.parsed?.kind === 'NOTE', '留言照收')

    const broken = submitText({ store, now: at('09:41:00') }, '持仓\n中际旭创 四百\n现金 62万')
    ok(broken.status === 'NEEDS_FIX' && store.readLedger()?.positions.length === 2, '读不出的持仓不生效，账本不动')

    const png = `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array<number>(16).fill(0)]).toString('base64')}`
    ok(decodeImage('data:image/png;base64,AAAAAAAAAAAAAAAAAAAAAAAA') === null, '文件头不是图片 → 不收')
    ok(typeof submitImage({ store }, 'data:text/html;base64,PGI+') === 'string', '不是图片类型 → 不收')
    const img = submitImage({ store, now: at('15:05:00') }, png)
    ok(typeof img !== 'string' && img.status === 'PENDING_PARSE' && store.imagePath(img) !== null, '图片存入私有目录，等待识别')
    const id = (img as { id: string }).id

    ok(typeof confirm({ store }, id) === 'string', '还没识别的图片不能确认')
    const wrong = shot()
    wrong.positions[0]!.quantity = 4000
    const bad = attachParsed({ store }, id, { kind: 'HOLDINGS', holdings: wrong })
    ok(typeof bad !== 'string' && bad.status === 'NEEDS_FIX' && typeof confirm({ store }, id) === 'string', '识别结果对不上账 → 不能确认')
    const noAmounts = attachParsed({ store }, id, { kind: 'HOLDINGS', holdings: { asOf: TODAY, cash: 1, positions: [{ code: '300308', name: '中际旭创', quantity: 100 }] } })
    ok(typeof noAmounts !== 'string' && noAmounts.status === 'NEEDS_FIX', '识别结果没有金额可勾稽 → 不能确认')
    ok(typeof attachParsed({ store }, id, { kind: 'HOLDINGS', holdings: { asOf: TODAY } }) === 'string', '识别结果缺字段 → 拒收')
    ok(typeof validateParsed({ kind: 'INTENT', intent: {} }) === 'string', '意向不能由图片识别代填，必须本人写')

    const good = attachParsed({ store, now: at('15:20:00') }, id, { kind: 'HOLDINGS', holdings: shot() })
    ok(typeof good !== 'string' && good.status === 'PENDING_CONFIRM' && good.summary!.includes('中际旭创') && good.summary!.includes('新增 宁德时代'), '通过核对 → 待确认，并列出与上一份账本的差别')
    ok(store.readLedger()?.positions.length === 2, '确认之前账本不动')
    const done = confirm({ store, now: at('15:30:00') }, id)
    ok(typeof done !== 'string' && done.status === 'CONFIRMED' && store.readLedger()?.positions.length === 3 && store.readLedger()?.cash === 620_000, '确认之后账本整份替换')
    ok(typeof attachParsed({ store }, id, { kind: 'HOLDINGS', holdings: shot() }) === 'string', '已确认的不能再被识别结果覆盖')
    ok(typeof reject({ store }, id) === 'string', '已生效的账本不能撤销，只能用新的持仓覆盖')

    const old = submitText({ store, now: at('15:35:00') }, '持仓 2026-11-10\n中际旭创 400\n现金 62万')
    ok(old.status === 'NEEDS_FIX' && old.summary!.includes('早于当前账本') && store.readLedger()?.positions.length === 3, '旧日期的持仓不能盖掉更新的账本')
    const lateImg = submitImage({ store, now: at('15:36:00') }, png) as { id: string }
    const lateShot = attachParsed({ store }, lateImg.id, { kind: 'HOLDINGS', holdings: { ...shot(), asOf: '2026-11-10' } })
    ok(typeof lateShot !== 'string' && lateShot.status === 'NEEDS_FIX', '旧日期的截图识别结果同样不能进入待确认')
    const sameDay = submitText({ store, now: at('15:37:00') }, '持仓\n中际旭创 400\n海光信息 650\n宁德时代 200\n现金 62万')
    ok(sameDay.status === 'RECORDED', '同一天重发的持仓可以覆盖，后发的为准')

    const undo = reject({ store, now: at('15:40:00') }, trade.id)
    ok(typeof undo !== 'string' && undo.status === 'REJECTED' && store.readLog('trades').length === 2, '撤销成交：追加一条撤销记录，原记录不删')
    ok(store.get('../ledger/portfolio') === null && store.list().length === 9, '提交编号不能用来读别的文件')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

process.stdout.write(`\n输入框自检：${passed} 通过，${failed} 失败\n`)
if (failed) process.exit(1)
