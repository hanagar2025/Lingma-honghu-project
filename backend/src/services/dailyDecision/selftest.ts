/**
 * 每日执行单自检。守四条：
 *   ① 数据核对不通过就不出股数（fail-closed）；
 *   ② 顺序固定：C 级清退 → 单票归位 → 熔断 → 新增投资；
 *   ③ 执行单不新增判定 —— 只排序驾驶舱动作与委员会已登记的指令；
 *   ④ 熔断待核验时第③步不出现在执行列表里，也不消失。
 */
import { buildAgentPack, demoteHeadings, renderSitePage } from './agentPack'
import { buildCard, buildFailureCard, SYSTEM_NAME } from './card'
import { markdownToHtml, renderCardPage } from './html'
import { configuredChannels, pushAll } from './notify'
import type { CommitteeOrder } from './orders'
import type { DecisionInput } from './types'
import { parseRunLog, RUN_LOG_HEADER, summarize } from './runLog'
import { resolveSession } from './schedule'
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
  ok(card.title.startsWith(`${SYSTEM_NAME} `) && !card.title.includes('鸿鹄执行单'), '推送标题以系统名开头')
  ok(card.lines.map(l => l.code).join(',') === '688008,603986,688041', 'C 级清退在前、单票归位在后')
  ok(card.lines.filter(l => l.code === '688008').length === 1, '委员会已清仓的股票不再重复出单票归位指令')
  ok(card.lines[0]!.shares === 1300 && card.lines[0]!.all, 'C 级清退 = 账本全部股数')
  ok(card.lines[2]!.shares === 700, '单票归位股数取驾驶舱动作，不在执行单里重算')
  ok(card.push.includes('不买入任何股票'), '二级熔断 → 写明不买入')
  ok(card.push.includes('待账本核验') && !card.lines.some(l => l.code === 'PORTFOLIO'), '熔断待核验：第③步不进执行列表，也不消失')
  ok(!card.push.includes('*'.repeat(2)), '推送正文无 Markdown 星号')
  ok(card.markdown.includes('核对明细') && !card.push.includes('核对明细'), '核对明细只进存档，不进推送')
}

process.stdout.write('\n【委员会 10/12 修正：计划 ≠ 成交，熔断确认 ≠ 待核验】\n')
{
  const input = baseInput()
  const card = buildCard(input, verifyInput(input, sinaFor(input), 'POST_CLOSE'), 'POST_CLOSE', { orders: ORDERS })
  ok(card.push.includes('下单计划，不是成交记录'), '写明是下单计划，以成交回报为准')
  ok(card.push.includes('待核验峰值') && !card.push.includes('二级熔断（只卖不买'), '峰值待核验时不把二级熔断写成已确认')
  ok(card.push.includes('只卖不买照常执行'), '只卖不买仍照常执行（10/10 裁定）')
  ok(card.push.includes('熔断补足（不是今日指令）'), '熔断补足与今日指令分开')
  ok(card.push.includes('卖后持有不超过 1800 股'), '单票归位写出卖后最多持有股数，价格变了也能照做')
  ok(card.push.includes('按实时价重算'), '提示按实时价重算，不照搬参考价股数')
  ok(card.push.includes('不重复挂单'), '下单前先查委托与成交，不重复下单')
  const verified = baseInput()
  verified.snapshot.peakVerified = true
  const vc = buildCard(verified, verifyInput(verified, sinaFor(verified), 'POST_CLOSE'), 'POST_CLOSE', { orders: ORDERS })
  ok(vc.push.includes('二级熔断（只卖不买'), '峰值已核实时才写二级熔断成立')
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
  const card = buildCard(input, verifyInput(input, live(0), 'INTRADAY'), 'INTRADAY', { orders: ORDERS, today: '2026-10-12', time: '14:08' })
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
  ok(card.title.includes('10/12 开盘') && card.push.includes('按 10/9 收盘价计算'), '标题是执行日，正文写明数据日')
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

process.stdout.write('\n【执行单网页】\n')
{
  const input = baseInput()
  const card = buildCard(input, verifyInput(input, sinaFor(input), 'POST_CLOSE'), 'POST_CLOSE', { orders: ORDERS })
  const page = renderCardPage(card.markdown, { ok: card.ok, title: card.title, generatedAt: '2026-10-09 15:45', cockpitHref: 'cockpit.html' })
  const firstItem = page.indexOf('<ol>')
  ok(firstItem > 0 && firstItem < page.indexOf('核对明细'), '第一屏是执行清单，核对明细在后')
  ok(page.includes('<li>卖出 澜起科技 688008') && page.includes('<table>'), '编号清单与核对表都渲染成 HTML')
  ok(page.includes('href="cockpit.html"'), '完整驾驶舱在第二页')
  ok(!/(src|href)="https?:\/\//.test(page.replace(/<a href="https?:[^"]*">/g, '')), '页面不加载任何外部资源')
  ok(markdownToHtml('- a<b>').includes('a&lt;b&gt;'), '正文转义 HTML')
  const bad = buildCard(input, verifyInput(input, null, 'POST_CLOSE'), 'POST_CLOSE', { orders: ORDERS })
  ok(renderCardPage(bad.markdown, { ok: bad.ok, title: bad.title, generatedAt: '' }).includes('#cf222e'), '不下单时页面顶部标红')
}

process.stdout.write('\n【给 Agent 的数据包】\n')
{
  const input = baseInput()
  const card = buildCard(input, verifyInput(input, sinaFor(input), 'POST_CLOSE'), 'POST_CLOSE', { orders: ORDERS })
  const brief = '# 驾驶舱摘要\n\n## 持仓\n\n| 名称 | 仓位 |\n|---|---|\n| 海光信息 | 12% |'
  const pack = buildAgentPack({ card: card.markdown, brief, generatedAt: '2026-10-12 16:10', siteUrl: 'https://x.io/p' })
  ok(pack.indexOf('读者须知') < pack.indexOf('第一部分') && pack.indexOf('第一部分') < pack.indexOf('第二部分'), '须知在最前，执行单在摘要之前')
  ok(pack.includes('核对明细') && pack.includes('卖出 澜起科技 688008'), '数据包含执行单全文与核对明细')
  ok(pack.includes('不是成交记录') && pack.includes('第一部分含股数、现金与总资产'), '须知写明计划≠成交，且如实说明哪部分未脱敏')
  ok(!/^# /m.test(pack.split('\n').slice(1).join('\n')) && pack.includes('### 驾驶舱摘要'), '嵌入文档的标题下沉，不与分部标题同级')
  ok(pack.includes('https://x.io/p/agent.md'), '写明纯文本地址')
  ok(buildAgentPack({ card: card.markdown, brief: null, generatedAt: '' }).includes('驾驶舱摘要没有生成'), '摘要缺失照样出包并说明')
  ok(demoteHeadings('```\n# 不是标题\n```\n# 是标题') === '```\n# 不是标题\n```\n### 是标题', '代码块里的 # 不动')
  const page = renderSitePage(card.markdown, { title: card.title, ok: card.ok, generatedAt: '' }, brief, 'https://x.io/p/')
  const embedded = /<textarea id="agent" readonly>([\s\S]*?)<\/textarea>/.exec(page)?.[1] ?? ''
  ok(embedded.includes('第二部分') && !embedded.includes('<td>'), '首页嵌入完整数据包（转义后的纯文本）')
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
  const r = await pushAll('t', 'x', {})
  ok(r.length === 0, '无通道时不发请求')
  process.stdout.write(`\n每日执行单自检：${pass} 通过，${fail} 失败\n`)
  if (fail) process.exit(1)
})()
