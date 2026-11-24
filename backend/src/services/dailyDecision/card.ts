/**
 * 每日执行单：只写今天要做什么、做多少、不做什么。
 *
 * 规则出自《半年计划》第二、三节：卖出只由资金分和趋势触发；单票 20%、相关环节 30% 只限制加仓；
 * 总仓位由观察线 95、预警线 90、停手线 85 三条线管。
 * 顺序：先卖后买。数据核对不通过时不出股数 —— 宁可今天不下单，也不按错数下单。
 * 本模块只排版决策输入里已有的指令，不新增任何判定。系统不下单，执行单是给她本人看的下单计划。
 */
import type { Instruction } from './book'
import { PLAN } from './rules'
import type { DecisionInput, DecisionSession, PlanFacts, Verification } from './types'

/** 推送标题的前缀。资金哨兵看市场资金往哪走；本系统只管自己的账户按规则该做什么 */
export const SYSTEM_NAME = '纪律执行官'

export interface ExecLine {
  code: string
  name: string
  side: 'SELL' | 'BUY'
  shares: number | null
  all: boolean
  refPrice: number | null
  amount: number | null
  reason: string
  /** 成交后的持有股数：卖出是最多持有，买入是买后持有 */
  keep: number
}

export interface DecisionCard {
  ok: boolean
  title: string
  /** 推送用正文：短，手机一屏能看完 */
  push: string
  /** 存档用全文：推送正文 + 核对明细 */
  markdown: string
  lines: ExecLine[]
}

const wan = (v: number): string => `${(v / 1e4).toFixed(2)}万`
const pct = (v: number): string => `${(v * 100).toFixed(1)}%`
const md = (d: string): string => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`

function linesText(input: DecisionInput): string {
  const l = input.lines
  if (l.level === 'NO_BASE' || l.navIndex === null) {
    return `净值指数算不出（${l.baseAt ? '有持仓取不到价格' : '净值基准还没填'}），三条线核对不了。核对不了时不买入`
  }
  const head = `净值指数 ${l.navIndex.toFixed(1)}（基准 ${l.baseAt} = 100，最高到过 ${(l.navHigh ?? l.navIndex).toFixed(1)}）。`
  if (l.level === 'TARGET') return `${head}已到目标 ${PLAN.lines.target}：股票降到 ${pct(PLAN.equityCap.target)}，结算`
  if (l.level === 'STOP') return `${head}已触及停手线 ${l.stop}：停止一切买入；两个交易日内股票降到 ${pct(PLAN.equityCap.stop)} 以内；临时复核，复核前不恢复买入`
  if (l.level === 'WARN') return `${head}已触及预警线 ${PLAN.lines.warn}：股票降到 ${pct(PLAN.equityCap.warn)} 以内；切换备用目标；不开新股票`
  if (l.level === 'WATCH') return `${head}已触及观察线 ${PLAN.lines.watch}：不开新股票，已有持仓照规则`
  return `${head}观察线 ${PLAN.lines.watch}、预警线 ${PLAN.lines.warn}、停手线 ${l.stop} 都没有触及`
}

/** 指令还剩几天：触发后的下一个交易日执行，没成交顺延 3 个交易日，之后作废 */
function validity(i: Instruction, rolled: number): string {
  const day = Math.min(rolled + 1, PLAN.validTradingDays)
  const left = PLAN.validTradingDays - day
  return `${md(i.triggerDate)} 触发，现在是第 ${day} 个交易日，${left > 0 ? `没成交还可顺延 ${left} 个交易日` : '这是最后一个交易日，过后作废'}`
}

function sellLines(input: DecisionInput, plan: PlanFacts): ExecLine[] {
  const out: ExecLine[] = []
  for (const i of plan.instructions.filter(x => x.side === 'SELL')) {
    const h = input.holdings.find(x => x.code === i.code)
    const keep = i.keep ?? 0
    if (!h || h.quantity <= keep) continue
    const shares = h.quantity - keep
    out.push({
      code: i.code, name: i.name, side: 'SELL', shares, all: keep === 0,
      refPrice: h.close, amount: h.close === null ? null : h.close * shares, keep,
      reason: `${i.reason}（${i.source}）。${validity(i, plan.rolled[i.id] ?? 0)}`,
    })
  }
  return out
}

function buyLines(input: DecisionInput, plan: PlanFacts): { lines: ExecLine[]; blocked: string[] } {
  const lines: ExecLine[] = []
  const blocked: string[] = []
  for (const g of plan.buys) {
    const i = plan.instructions.find(x => x.id === g.id)
    if (!i) continue
    if (g.blocked) { blocked.push(`买入 ${i.name} ${i.code}（目标占比 ${pct(i.targetWeight ?? 0)}）：${g.blocked}。${validity(i, plan.rolled[i.id] ?? 0)}`); continue }
    const h = input.holdings.find(x => x.code === i.code)
    lines.push({
      code: i.code, name: i.name, side: 'BUY', shares: g.shares, all: false,
      refPrice: g.refPrice, amount: g.refPrice === null ? null : g.refPrice * g.shares, keep: (h?.quantity ?? 0) + g.shares,
      reason: `${i.reason}（${i.source}）。买后占比约 ${pct(g.allowedWeight)}；${g.notes.join('；')}。${validity(i, plan.rolled[i.id] ?? 0)}`,
    })
  }
  return { lines, blocked }
}

interface After { stockPct: number; cashPct: number; top: { name: string; pct: number } | null }

function projectAfter(input: DecisionInput, lines: ExecLine[]): After | null {
  const total = input.snapshot.portfolioTotal
  if (!(total > 0)) return null
  let stock = 0
  let top: After['top'] = null
  const seen = new Set<string>()
  const add = (name: string, mv: number): void => {
    stock += mv
    if (mv > 0 && (!top || mv / total > top.pct)) top = { name, pct: mv / total }
  }
  for (const h of input.holdings) {
    if (h.close === null) return null
    seen.add(h.code)
    const delta = lines.filter(l => l.code === h.code).reduce((s, l) => s + (l.side === 'SELL' ? -(l.shares ?? 0) : l.shares ?? 0), 0)
    add(h.name, Math.max(0, h.quantity + delta) * h.close)
  }
  for (const l of lines) if (l.side === 'BUY' && !seen.has(l.code)) add(l.name, l.amount ?? 0)
  return { stockPct: stock / total, cashPct: 1 - stock / total, top }
}

/** 触线后股票占比要降到多少以内。卖哪几只不由系统定 */
function reduction(input: DecisionInput, plan: PlanFacts | null, after: After | null): string[] {
  const l = input.lines
  const cap = Math.min(l.equityCap ?? 1, plan?.backup ? PLAN.backup.equityCap : 1)
  const s = input.snapshot
  if (cap >= 1 || !(s.portfolioTotal > 0)) return []
  const now = s.positionsValue / s.portfolioTotal
  const then = after?.stockPct ?? now
  const why = l.level === 'STOP' ? `触及停手线 ${l.stop}，两个交易日内`
    : l.level === 'TARGET' ? `已到目标 ${PLAN.lines.target}`
      : l.level === 'WARN' ? `触及预警线 ${PLAN.lines.warn}` : `已切换备用目标（${plan?.backup?.why ?? ''}）`
  if (then <= cap) return [`- ${why}，股票要降到 ${pct(cap)} 以内。现在 ${pct(now)}${then < now ? `，清单全部成交后 ${pct(then)}` : ''}，已在上限以内`]
  return [
    `- ${why}，股票要降到 ${pct(cap)} 以内。现在 ${pct(now)}${then < now ? `，清单全部成交后 ${pct(then)}` : ''}，还要再减 ${pct(then - cap)}（约 ${wan((then - cap) * s.portfolioTotal)}）`,
    '- 减哪几只、各减多少，规则没有写。由策略方登记卖出指令，登记后进入执行清单；委员会可否决',
  ]
}

function evidenceTable(plan: PlanFacts): string[] {
  const out = [
    '| 持仓 | 占比 | 资金分 C | 趋势分 T | 扣分 | 证据分 E | 加仓上限 | 卖出条件 |',
    '|---|---|---|---|---|---|---|---|',
  ]
  for (const r of plan.rows) {
    const c = r.c === null ? '—' : `${r.c}${r.cUnknown ? `（缺${r.cUnknownWhy.join('、')}）` : ''}${r.provisional ? '（初算）' : ''}`
    out.push(`| ${r.name} | ${pct(r.weight)} | ${c} | ${r.t ?? '—'} | ${r.deduction ?? '—'} | ${r.e ?? '—'} | ${r.e === null ? '—' : r.addCap > 0 ? pct(r.addCap) : '不加'} | ${r.sellNote} |`)
  }
  return out
}

export function buildCard(
  input: DecisionInput,
  v: Verification,
  session: DecisionSession,
  opts: { url?: string; today?: string; time?: string } = {},
): DecisionCard {
  const today = md(opts.today ?? input.date)
  const intra = session === 'INTRADAY'
  const when = session === 'PRE_OPEN'
    ? `今日开盘（按 ${md(input.date)} 收盘价计算）`
    : intra
      ? `今日盘中（按 ${opts.time ?? ''} 实时价计算）`
      : `下一交易日开盘（按 ${md(input.date)} 收盘价计算）`
  const label = session === 'PRE_OPEN' ? `${today} 开盘` : intra ? `${today} 盘中复核` : `${md(input.date)} 收盘后`
  const plan = input.plan
  const problems = [...v.problems]
  const ok = problems.length === 0
  const s = input.snapshot
  const total = s.portfolioTotal
  const checked = v.checks.filter(c => c.ok).length

  const head: string[] = []
  const body: string[] = []

  if (!ok) {
    const title = `⛔ ${SYSTEM_NAME} ${label}：数据未通过核对，不下单`
    head.push(`# ${title}`, '')
    body.push('## 今日动作', '', '不下单。数据核对恢复后重新出单。', '', '## 未通过的项目', '')
    problems.forEach(p => body.push(`- ${p}`))
    const pending = (plan?.instructions ?? []).map(i => `${i.side === 'SELL' ? '卖出' : '买入'} ${i.name}`)
    if (pending.length) body.push('', `核对恢复后待执行：${pending.join('、')}（股数以恢复当日为准；有效期不因停单延长）`)
    const sourceDown = v.marketDate === null && v.checks.length > 0 && v.checks.every(c => c.secondary === null)
    body.push('', sourceDown
      ? '这是行情数据源取不到，不是账本问题，也不代表持仓有变化。下一轮会自动重试。'
      : '账本问题的处理：把最新持仓截图发给委员会，账本更新后自动恢复。')
    return finish(title, head, body, [], v, opts.url, false, [])
  }

  const sells = plan ? sellLines(input, plan) : []
  const buys = plan ? buyLines(input, plan) : { lines: [], blocked: [] }
  const lines = [...sells, ...buys.lines]
  const what = !plan ? '卖出条件核对不了，不出指令'
    : !lines.length ? '不交易'
      : [sells.length ? `卖出 ${sells.length} 笔` : '', buys.lines.length ? `买入 ${buys.lines.length} 笔` : '不买入'].filter(Boolean).join('，')
  const title = `${SYSTEM_NAME} ${label}：${what}`
  head.push(`# ${title}`, '')
  head.push(`执行时点：${when}`)
  head.push('性质：下单计划，不是成交记录。系统不下单，由您本人在券商下单；是否完成以券商成交回报为准。')
  head.push(`数据核对：✅ ${checked}/${v.checks.length} 只持仓${intra ? '实时价' : '收盘价'}两源一致（腾讯/新浪），股数与现金取自账本 ${input.ledgerAsOf ?? '无日期'}`)
  head.push(
    `账户${intra ? '（盘中市值，非收盘基准）' : ''}：总资产 ${wan(total)}，股票 ${pct(s.positionsValue / total)}，现金 ${pct((s.cash + s.externalCash) / total)}`,
  )
  head.push(`三条线：${linesText(input)}`)
  if (plan) {
    const final = plan.rows.every(r => !r.provisional)
    head.push(`证据分：截至 ${plan.asOf ? md(plan.asOf) : '（还没有日线）'} 收盘，融资余额到 ${plan.marginAsOf ? md(plan.marginAsOf) : '（没有）'}${final ? '' : '；带“初算”的要等融资公布后定稿'}`)
    if (plan.backup) head.push(`备用目标：已切换（${md(plan.backup.since)}，${plan.backup.why}）。单票上限 ${pct(PLAN.backup.singleCap)}，股票不超过 ${pct(PLAN.backup.equityCap)}`)
  } else {
    head.push('证据分：链上数据没有接入，资金分和趋势分算不出。卖出条件核对不了：不算成立，也不算不成立')
  }
  head.push('')

  body.push('## 执行清单（先卖后买，按顺序）', '')
  if (!lines.length) body.push('无卖出、无买入。')
  lines.forEach((l, i) => {
    const qty = l.all ? `${l.shares} 股（全部）` : `${l.shares} 股`
    const ref = l.refPrice === null ? '' : `，参考价 ${l.refPrice.toFixed(2)}，约 ${wan(l.amount!)}`
    const keep = l.side === 'BUY' || l.all ? '' : `；卖后持有不超过 ${l.keep} 股`
    body.push(`${i + 1}. ${l.side === 'SELL' ? '卖出' : '买入'} ${l.name} ${l.code}：${qty}${ref} —— ${l.reason}${keep}`)
  })
  if (buys.lines.length) body.push('', '买入的股数按参考价算出，向下取整。下单时按实时价重算：买后占比不超过写明的上限，宁少买一手、不多买一手。')

  const after = projectAfter(input, lines)
  if (lines.length && after) {
    body.push('', `按参考价全部成交后：股票 ${pct(after.stockPct)}，现金 ${pct(after.cashPct)}`
      + (after.top ? `，单票最高 ${after.top.name} ${pct(after.top.pct)}` : ''))
  }

  if (buys.blocked.length) {
    body.push('', '## 被规则挡住的买入（今天不买）', '')
    buys.blocked.forEach(b => body.push(`- ${b}`))
  }

  const reduce = reduction(input, plan, lines.length ? after : null)
  if (reduce.length) body.push('', '## 触线后的降仓要求', '', ...reduce)

  if (plan?.notices.length) {
    body.push('', '## 核对不了的和待定稿的（不是指令）', '')
    plan.notices.forEach(n => body.push(`- ${n}`))
  }

  // 逐只读数只进全文，不进推送：推送要一屏看完
  const extra: string[] = []
  if (plan?.rows.length) {
    extra.push('', '## 持仓读数', '', ...evidenceTable(plan), '')
    extra.push(`相关环节（光模块加 PCB）合计 ${pct(plan.relatedWeight)}，上限 ${pct(PLAN.related.cap)}。单票 ${pct(PLAN.addCap[6]!)} 和这条上限都只限制加仓，超过不卖。`)
  }

  if (plan?.events.length) {
    body.push('', '## 指令变动', '')
    plan.events.forEach(e => body.push(`- ${e}`))
  }

  if (input.outsideChain.length) {
    body.push('', '## 提示（不是指令）', '')
    input.outsideChain.forEach(o => body.push(`- ${o.name} ${o.code} 不在 AI 全链名单内。通用卖出规则对它照样适用；没有环节读数`))
  }

  body.push('', '## 不做', '')
  body.push('- 清单以外的买卖都不做。清单以外的成交记为偏离，当天截图入账（《半年计划》第六节）')
  body.push(`- 不因为占比高而卖出：单票超过 ${pct(PLAN.addCap[6]!)}、相关环节超过 ${pct(PLAN.related.cap)}，只是不加`)
  if (input.lines.buyBlocked) body.push('- 不买入任何股票，不追跌、不抢反弹')
  else if (input.lines.newEntryBlocked) body.push('- 不开新股票')
  body.push('- 卖出所得现金留在账户，不转出、不另作他用')

  body.push('', '## 下单前与成交后', '')
  body.push('- 下单前先查当日委托与成交：已成交的不再下，已挂未成交的改价，不重复挂单')
  body.push('- 成交后把成交回报和持仓截图发给委员会；账本按真实成交更新后，已完成的指令自动结束')
  return finish(title, head, body, extra, v, opts.url, true, lines)
}

/** 账本读不出、拿不到决策输入时的执行单 */
export function buildFailureCard(today: string, reason: string, url?: string): DecisionCard {
  const title = `⛔ ${SYSTEM_NAME} ${md(today)}：数据采集失败，不下单`
  const lines = [`# ${title}`, '', '## 今日动作', '', '不下单。采集恢复后重新出单。', '', '## 原因', '', `- ${reason}`]
  if (url) lines.push('', `执行单：${url}`)
  const text = lines.join('\n')
  return { ok: false, title, push: text, markdown: `${text}\n`, lines: [] }
}

function finish(
  title: string, head: string[], body: string[], extra: string[], v: Verification, url: string | undefined, ok: boolean, lines: ExecLine[],
): DecisionCard {
  const tail = url ? ['', `执行单全文、核对明细与「一键复制给 Agent」：${url}`] : []
  const push = [...head, ...body, ...tail].join('\n')
  const detail = ['', '---', '', '## 核对明细', '', '| 持仓 | 腾讯 | 新浪 | 结果 |', '|---|---|---|---|']
  for (const c of v.checks) {
    detail.push(`| ${c.name} ${c.code} | ${c.primary?.toFixed(2) ?? '—'} | ${c.secondary?.toFixed(2) ?? '—'} | ${c.ok ? '✅' : `⛔ ${c.note}`} |`)
  }
  detail.push('', `市场日期（新浪上证指数）：${v.marketDate ?? '取不到'}`)
  return { ok, title, push, markdown: `${[...head, ...body, ...extra].join('\n')}\n${detail.join('\n')}\n`, lines }
}
