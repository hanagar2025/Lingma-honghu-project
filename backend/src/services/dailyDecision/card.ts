/**
 * 每日执行单：只写今天要做什么、做多少、不做什么。
 *
 * 顺序按委员会 10/10 裁定：风险预算 → 规则减仓（C 级清退、单票归位）→ 熔断 → 新增投资。
 * 数据核对不通过时不出股数（fail-closed）—— 宁可今天不下单，也不按错数下单。
 * 本模块只排序与换算驾驶舱已产生的动作，不新增任何判定。
 */
import { LIMITS } from '../cockpit/safety'
import { COMMITTEE_ORDERS, type CommitteeOrder } from './orders'
import type { DecisionInput, DecisionSession, Verification } from './types'

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
  /** 卖后最多持有的股数 */
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

function committeeLines(input: DecisionInput, orders: readonly CommitteeOrder[]): ExecLine[] {
  const out: ExecLine[] = []
  for (const o of orders) {
    const h = input.holdings.find(x => x.code === o.code)
    if (!h || h.quantity <= 0) continue
    out.push({
      code: o.code, name: o.name, side: 'SELL', shares: h.quantity, all: true,
      refPrice: h.close, amount: h.close === null ? null : h.close * h.quantity, reason: o.reason, keep: 0,
    })
  }
  return out
}

function limitLines(input: DecisionInput, cleared: Set<string>): { lines: ExecLine[]; problems: string[] } {
  const lines: ExecLine[] = []
  const problems: string[] = []
  for (const a of input.actions.filter(x => x.kind === 'REDUCE' && x.reason === 'POSITION_LIMIT')) {
    if (cleared.has(a.code)) continue
    const h = input.holdings.find(x => x.code === a.code)
    if (a.size.value === null || !h || h.close === null) {
      problems.push(`${a.name} 超过单票上限，但缺价格无法换算股数`)
      continue
    }
    const shares = Math.min(a.size.value, h.quantity)
    lines.push({
      code: a.code, name: a.name, side: 'SELL', shares, all: shares >= h.quantity,
      refPrice: h.close, amount: shares * h.close, keep: h.quantity - shares,
      reason: `单票超 ${pct(LIMITS.singleStock)} 上限，卖后回到上限以内`,
    })
  }
  return { lines, problems }
}

interface After { stockPct: number; cashPct: number; top: { name: string; pct: number } | null }

function projectAfter(input: DecisionInput, sells: ExecLine[]): After | null {
  const total = input.snapshot.portfolioTotal
  if (!(total > 0)) return null
  let stock = 0
  let top: After['top'] = null
  for (const h of input.holdings) {
    if (h.close === null) return null
    const sold = sells.filter(l => l.code === h.code).reduce((s, l) => s + (l.shares ?? 0), 0)
    const mv = Math.max(0, h.quantity - sold) * h.close
    stock += mv
    if (mv > 0 && (!top || mv / total > top.pct)) top = { name: h.name, pct: mv / total }
  }
  return { stockPct: stock / total, cashPct: 1 - stock / total, top }
}

function circuitText(input: DecisionInput): string {
  const c = input.circuit
  const dd = c.drawdown === null ? '' : `自峰值回撤 ${pct(c.drawdown)}，`
  const pending = input.snapshot.peakVerified === false
  if (c.level === 'LEVEL2') {
    return pending
      ? `${dd}按待核验峰值 ${wan(input.snapshot.peakAssets)} 计达二级线；只卖不买照常执行，降到股票上限 ${pct(c.equityCap!)} 的补足待账本核验`
      : `${dd}二级熔断（只卖不买，股票上限 ${pct(c.equityCap!)}）`
  }
  if (c.level === 'LEVEL1') {
    return pending
      ? `${dd}按待核验峰值 ${wan(input.snapshot.peakAssets)} 计达一级线；降到股票上限 ${pct(c.equityCap!)} 的补足待账本核验`
      : `${dd}一级熔断（股票上限 ${pct(c.equityCap!)}）`
  }
  if (c.level === 'NORMAL') return `${dd}未触发`
  return '不可判定（峰值口径不可比）'
}

export function buildCard(
  input: DecisionInput,
  v: Verification,
  session: DecisionSession,
  opts: { url?: string; orders?: readonly CommitteeOrder[]; today?: string; time?: string } = {},
): DecisionCard {
  const orders = opts.orders ?? COMMITTEE_ORDERS
  const today = md(opts.today ?? input.date)
  const intra = session === 'INTRADAY'
  const when = session === 'PRE_OPEN'
    ? `今日开盘（按 ${md(input.date)} 收盘价计算）`
    : intra
      ? `今日盘中（按 ${opts.time ?? ''} 实时价计算）`
      : `下一交易日开盘（按 ${md(input.date)} 收盘价计算）`
  const label = session === 'PRE_OPEN' ? `${today} 开盘` : intra ? `${today} 盘中复核` : `${md(input.date)} 收盘后`
  const committee = committeeLines(input, orders)
  const cleared = new Set(committee.map(l => l.code))
  const limits = limitLines(input, cleared)
  const problems = [...v.problems, ...limits.problems]
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
    const pending = [...committee, ...limits.lines].map(l => l.name)
    if (pending.length) body.push('', `核对恢复后待执行：${pending.join('、')}（股数以恢复当日为准）`)
    const sourceDown = v.marketDate === null && v.checks.length > 0 && v.checks.every(c => c.secondary === null)
    body.push('', sourceDown
      ? '这是行情数据源取不到，不是账本问题，也不代表持仓有变化。下一轮会自动重试；需要立即出单时，在 Actions 手动运行一次。'
      : '账本问题的处理：把最新持仓截图发给委员会，账本更新后自动恢复。')
    return finish(title, head, body, v, opts.url, false, [])
  }

  const lines = [...committee, ...limits.lines]
  const title = lines.length
    ? `${SYSTEM_NAME} ${label}：卖出 ${lines.length} 笔，不买入`
    : `${SYSTEM_NAME} ${label}：不交易`
  head.push(`# ${title}`, '')
  head.push(`执行时点：${when}`)
  head.push('性质：下单计划，不是成交记录。是否完成以券商成交回报为准。')
  head.push(`数据核对：✅ ${checked}/${v.checks.length} 只持仓${intra ? '实时价' : '收盘价'}两源一致（腾讯/新浪），股数与现金取自账本 ${input.ledgerAsOf ?? '无日期'}`)
  head.push(
    `账户${intra ? '（盘中市值，非收盘基准）' : ''}：总资产 ${wan(total)}，股票 ${pct(s.positionsValue / total)}，现金 ${pct((s.cash + s.externalCash) / total)}`,
  )
  head.push(`熔断：${circuitText(input)}`)
  head.push('')

  body.push('## 执行清单（按顺序）', '')
  if (!lines.length) body.push('无卖出、无买入。')
  lines.forEach((l, i) => {
    const qty = l.all ? `${l.shares} 股（全部）` : `${l.shares} 股`
    const ref = l.refPrice === null ? '' : `，参考价 ${l.refPrice.toFixed(2)}，约 ${wan(l.amount!)}`
    const keep = l.all ? '' : `；卖后持有不超过 ${l.keep} 股`
    body.push(`${i + 1}. 卖出 ${l.name} ${l.code}：${qty}${ref} —— ${l.reason}${keep}`)
  })
  if (limits.lines.length) {
    body.push('', `单票归位的股数按参考价算出。下单时按实时价重算：卖后市值不超过总资产的 ${pct(LIMITS.singleStock)}，宁多卖一股、不少卖一股。`)
  }

  const after = projectAfter(input, lines)
  if (lines.length && after) {
    body.push('', `按参考价全部成交后：股票 ${pct(after.stockPct)}，现金 ${pct(after.cashPct)}`
      + (after.top ? `，单票最高 ${after.top.name} ${(after.top.pct * 100).toFixed(2)}%` : ''))
  }

  const circuitAct = input.actions.find(a => a.reason === 'CIRCUIT_BREAKER')
  const capped = input.circuit.equityCap !== null && s.positionsValue / total > input.circuit.equityCap
  if (circuitAct) {
    body.push('', '## 熔断降仓（须委员会指派标的）', '', `- 组合股票须再降约 ${wan(circuitAct.size.value ?? 0)}；由哪只承担由委员会指派，指派后进入执行单`)
  } else if (capped && s.peakVerified === false) {
    body.push('', '## 熔断补足（不是今日指令）', '', `- 降到股票上限 ${pct(input.circuit.equityCap!)} 所需的额外卖出：待账本核验，今日不执行、不撤销（委员会 10/10 裁定）`)
  }

  const buys = input.actions.filter(a => a.kind === 'BUY')
  body.push('', '## 不做', '')
  if (input.circuit.sellOnly) body.push('- 不买入任何股票，不追跌、不抢反弹（只卖不买照常执行）')
  else if (input.noNewEntry.verdict || !buys.length) body.push('- 不新开仓、不加仓')
  else buys.forEach(b => body.push(`- 买入候选 ${b.name}：规模由委员会按仓位预算定，未定前不买`))
  body.push('- 卖出所得现金留在账户，不转出、不另作他用')

  body.push('', '## 下单前与成交后', '')
  body.push('- 下单前先查当日委托与成交：已成交的不再下，已挂未成交的改价，不重复挂单')
  body.push('- 成交后把成交回报和持仓截图发给委员会；账本按真实成交更新后，已完成的指令自动消失')
  return finish(title, head, body, v, opts.url, true, lines)
}

/** 驾驶舱本身没跑完、拿不到决策输入时的执行单 */
export function buildFailureCard(today: string, reason: string, url?: string): DecisionCard {
  const title = `⛔ ${SYSTEM_NAME} ${md(today)}：数据采集失败，不下单`
  const lines = [`# ${title}`, '', '## 今日动作', '', '不下单。采集恢复后重新出单。', '', '## 原因', '', `- ${reason}`]
  if (url) lines.push('', `执行单与完整驾驶舱：${url}`)
  const text = lines.join('\n')
  return { ok: false, title, push: text, markdown: `${text}\n`, lines: [] }
}

function finish(
  title: string, head: string[], body: string[], v: Verification, url: string | undefined, ok: boolean, lines: ExecLine[],
): DecisionCard {
  const tail = url ? ['', `执行单全文、核对明细、完整驾驶舱与「一键复制给 Agent」：${url}`] : []
  const push = [...head, ...body, ...tail].join('\n')
  const detail = ['', '---', '', '## 核对明细', '', '| 持仓 | 腾讯 | 新浪 | 结果 |', '|---|---|---|---|']
  for (const c of v.checks) {
    detail.push(`| ${c.name} ${c.code} | ${c.primary?.toFixed(2) ?? '—'} | ${c.secondary?.toFixed(2) ?? '—'} | ${c.ok ? '✅' : `⛔ ${c.note}`} |`)
  }
  detail.push('', `市场日期（新浪上证指数）：${v.marketDate ?? '取不到'}`)
  return { ok, title, push, markdown: `${[...head, ...body].join('\n')}\n${detail.join('\n')}\n`, lines }
}
