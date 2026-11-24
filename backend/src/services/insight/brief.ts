/**
 * 每日简报：把账户、行情和登记的预判对到一起，接在执行单后面。
 *
 *   持仓  每只的占比、资金分与趋势分、卖出条件成立没有、卖压读数。
 *   进度  净值指数走到哪、离三条线和下一个进度线多远。
 *
 * 本模块不产生任何买卖指令，也不另起口径：资金分、证据分、卖出条件和三条线都取自执行单的决策输入
 * （《半年计划》第〇、二节）。这里只把读数摆出来。
 */
import type { DecisionCard } from '../dailyDecision/card'
import { nextCheckpoint, PLAN } from '../dailyDecision/rules'
import type { DecisionInput, EvidenceRow } from '../dailyDecision/types'
import { INDEXES, type Bar, type MarketData, type MarginRow } from '../market/data'
import { findMember } from '../msr/universe'
import { FORECAST_FROM, FORECASTS, LOW_WINDOW } from './config'

export interface LowState {
  asOf: string
  /** 最新一个收盘价是 60 日内最低 */
  isLow: boolean
  /** 最近一次收盘创 60 日新低的日期；数据范围内没有则为 null */
  lastLowDate: string | null
  /** 距那一天过了几个交易日；数据范围内没有新低时等于可判定的天数 */
  daysSince: number
}

export function lowState(bars: readonly Bar[] | undefined, window: number = LOW_WINDOW): LowState | null {
  if (!bars || bars.length < window) return null
  const last = bars.length - 1
  for (let i = last; i >= window - 1; i--) {
    let min = Infinity
    for (let j = i - window + 1; j <= i; j++) min = Math.min(min, bars[j]!.close)
    if (bars[i]!.close <= min) return { asOf: bars[last]!.date, isLow: i === last, lastLowDate: bars[i]!.date, daysSince: last - i }
  }
  return { asOf: bars[last]!.date, isLow: false, lastLowDate: null, daysSince: last - window + 2 }
}

export function change(bars: readonly Bar[] | undefined, days: number): number | null {
  if (!bars || bars.length <= days) return null
  return bars[bars.length - 1]!.close / bars[bars.length - 1 - days]!.close - 1
}

function changeSince(bars: readonly Bar[] | undefined, date: string): number | null {
  const base = bars?.filter(b => b.date <= date).pop()
  const last = bars?.[bars.length - 1]
  return base && last && last.date > base.date ? last.close / base.close - 1 : null
}

/** 两条日线的等权组合：各自除以共同起点的收盘价再取平均 */
export function composite(a: readonly Bar[] | undefined, b: readonly Bar[] | undefined): Bar[] {
  if (!a?.length || !b?.length) return []
  const other = new Map(b.map(x => [x.date, x.close]))
  const common = a.filter(x => other.has(x.date))
  const first = common[0]
  if (!first) return []
  const b0 = other.get(first.date)!
  return common.map(x => ({ date: x.date, close: (x.close / first.close + other.get(x.date)! / b0) / 2 }))
}

function marginRate(rows: readonly MarginRow[] | undefined, days: number): number | null {
  return rows && rows.length > days ? rows[0]!.balance / rows[days]!.balance - 1 : null
}

function pct(v: number, digits = 1): string {
  const text = (v * 100).toFixed(digits)
  return Number(text) === 0 ? `${(0).toFixed(digits)}%` : `${v > 0 ? '+' : ''}${text}%`
}
const share = (v: number): string => `${(v * 100).toFixed(1)}%`
const pp = (v: number): string => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)} 个百分点`
const md = (d: string): string => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`

function marginText(code: string, market: MarketData): string | null {
  const own = market.margin[code]
  const all = market.marketMargin
  const r5 = marginRate(own, 5)
  const m5 = marginRate(all, 5)
  if (r5 === null || m5 === null || own![0]!.date !== all[0]!.date) return null
  const r20 = marginRate(own, 20)
  return `融资余额 5 日 ${pct(r5)}，全市场 ${pct(m5, 2)}，差 ${pp(r5 - m5)}${r20 === null ? '' : `；20 日 ${pct(r20)}`}（截至 ${md(own![0]!.date)}）`
}

export interface HoldingView {
  code: string
  name: string
  weight: number | null
  /** 执行单上对它的指令 */
  order: string | null
  /** 资金分、趋势分、证据分与卖出条件；链上数据没接入时为 null */
  evidence: EvidenceRow | null
  low: LowState | null
  /** 盘中现价已低于 60 日最低收盘价 */
  breaking: string | null
  change20: number | null
  relative20: number | null
  margin: string | null
}

function holdingViews(input: DecisionInput, card: DecisionCard, market: MarketData): HoldingView[] {
  const total = input.snapshot.portfolioTotal
  const views = input.holdings.filter(h => h.quantity > 0).map((h): HoldingView => {
    const bars = market.bars[h.code]
    const own = change(bars, 20)
    const bench = change(market.bars[findMember(h.code)?.mainline.benchmark ?? INDEXES.chinext], 20)
    const line = card.lines.find(l => l.code === h.code)
    return {
      code: h.code, name: h.name,
      weight: h.close !== null && total > 0 && !input.priceFailed.length ? h.quantity * h.close / total : null,
      order: line ? `${line.side === 'SELL' ? '卖出' : '买入'} ${line.shares} 股（${line.reason.split('（')[0]}）` : null,
      evidence: input.plan?.rows.find(r => r.code === h.code) ?? null,
      low: lowState(bars),
      breaking: breakingText(h, bars),
      change20: own,
      relative20: own !== null && bench !== null ? own - bench : null,
      margin: marginText(h.code, market),
    }
  })
  return views.sort((a, b) => Number(!!b.order) - Number(!!a.order) || (b.weight ?? 0) - (a.weight ?? 0))
}

/** 盘中价比最近一个收盘价更新，且低于此前 60 日的最低收盘价：收盘不回升就是新低 */
function breakingText(h: { close: number | null; barDate: string | null }, bars: readonly Bar[] | undefined): string | null {
  const last = bars?.[bars.length - 1]
  if (!bars || !last || h.close === null || !h.barDate || h.barDate <= last.date || bars.length < LOW_WINDOW - 1) return null
  const floor = Math.min(...bars.slice(-(LOW_WINDOW - 1)).map(b => b.close))
  return h.close < floor ? `盘中 ${h.close.toFixed(2)} 低于此前 ${LOW_WINDOW} 日最低收盘价 ${floor.toFixed(2)}，收盘不回升就是新低` : null
}

function evidenceText(r: EvidenceRow | null): string {
  if (!r) return '资金分、趋势分算不出（链上数据没有接入）。卖出条件核对不了'
  if (r.c === null) return `没有资金分读数。卖出条件：${r.sellNote}`
  const lack = r.cUnknown ? `（缺${r.cUnknownWhy.join('、')}，缺的按 0 分）` : ''
  const cap = r.addCap > 0 ? `加仓上限 ${share(r.addCap)}` : '不加仓'
  return `资金分 C=${r.c}${lack}${r.provisional ? '（初算）' : ''}，趋势分 T=${r.t}${r.deduction ? `，基本面扣 1 分（${r.deductionWhy}）` : ''}，证据分 E=${r.e}；${cap}。卖出条件：${r.sellNote}`
}

function events(input: DecisionInput | null, market: MarketData): string[] {
  const out: string[] = []
  for (const h of input?.holdings.filter(x => x.quantity > 0) ?? []) {
    const s = lowState(market.bars[h.code])
    if (s?.isLow) out.push(`${h.name} ${md(s.asOf)} 收盘创 ${LOW_WINDOW} 日新低`)
  }
  for (const e of input?.plan?.events ?? []) out.push(e)
  return out
}

function goalLines(input: DecisionInput | null, today: string): string[] {
  if (!input) return ['没有账本，算不出进度。']
  if (input.priceFailed.length) return [`持仓价格取不到（${input.priceFailed.join('、')}），市值只能按成本价估，今天算不出进度。`]
  const l = input.lines
  const s = input.snapshot
  if (l.navIndex === null) return [`净值基准还没填，净值指数算不出，三条线今天核对不了。目标是净值指数 ${PLAN.lines.target}。`]
  const nav = l.navIndex
  const gap = (level: number): string => pct(nav / level - 1)
  const out = [
    `- 净值指数 ${nav.toFixed(1)}（基准 ${l.baseAt} = 100），最高到过 ${(l.navHigh ?? nav).toFixed(1)}。目标 ${PLAN.lines.target}，还要上涨 ${share(PLAN.lines.target / nav - 1)}。`,
  ]
  const next = nextCheckpoint(today)
  if (next) out.push(`- 下一个进度线：${md(next.date)} 要到 ${next.index}，现在${nav >= next.index ? `已高出 ${share(nav / next.index - 1)}` : `还差 ${share(next.index / nav - 1)}`}。`)
  out.push(`- 净值相对三条线：观察线 ${PLAN.lines.watch} ${gap(PLAN.lines.watch)}，预警线 ${PLAN.lines.warn} ${gap(PLAN.lines.warn)}，停手线 ${l.stop} ${gap(l.stop)}。`)
  if (s.portfolioTotal > 0) out.push(`- 股票占 ${share(s.positionsValue / s.portfolioTotal)}，现金 ${share(1 - s.positionsValue / s.portfolioTotal)}。总仓位不设上限，由三条线管。`)
  if (input.plan?.backup) out.push(`- 已切换备用目标（${md(input.plan.backup.since)}，${input.plan.backup.why}）：单票上限 ${share(PLAN.backup.singleCap)}，股票不超过 ${share(PLAN.backup.equityCap)}。`)
  return out
}

function forecastLines(market: MarketData): string[] {
  const out: string[] = []
  const lowsAfter = (bars: readonly Bar[] | undefined): string[] => {
    const hit: string[] = []
    if (!bars) return hit
    for (let end = LOW_WINDOW; end <= bars.length; end++) {
      const s = lowState(bars.slice(0, end))
      if (s?.isLow && s.asOf > '2026-11-11') hit.push(md(s.asOf))
    }
    return hit
  }
  for (const f of FORECASTS) {
    let now = '到期对照'
    if (f.no === '二') {
      const nv = lowsAfter(market.us.NVDA?.bars)
      const combo = lowsAfter(composite(market.us.LITE?.bars, market.us.COHR?.bars))
      const hits = [nv.length ? `英伟达 ${nv.join('、')}` : '', combo.length ? `Lumentum 与 Coherent 等权 ${combo.join('、')}` : ''].filter(Boolean)
      now = hits.length ? `11/11 之后收盘创 60 日新低：${hits.join('；')}。美股链条尚未止跌` : '11/11 之后美股链条没有再创 60 日新低'
    }
    if (f.no === '三') {
      const hg = changeSince(market.bars['688041'], FORECAST_FROM)
      const hd = changeSince(market.bars['002463'], FORECAST_FROM)
      if (hg !== null && hd !== null) {
        now = `${md(FORECAST_FROM)} 收盘以来：海光信息 ${pct(hg)}，沪电股份 ${pct(hd)}，沪电股份${hd >= hg ? '领先' : '落后'} ${Math.abs((hd - hg) * 100).toFixed(1)} 个百分点`
      }
    }
    out.push(`- 判断${f.no}（把握${f.confidence}）：${f.text}。复核点：${f.review}。目前：${now}。`)
  }
  return out
}

export interface BriefSection { id: 'risk' | 'goal' | 'forecast' | 'score' | 'todo'; title: string; markdown: string }

export interface Brief {
  /** 行情截止的交易日 */
  asOf: string | null
  generatedAt: string
  changes: string[]
  todo: string[]
  sections: BriefSection[]
  /** 推送用：接在执行单后面的几行 */
  push: string
}

export function buildBrief(input: DecisionInput | null, card: DecisionCard, market: MarketData, today: string): Brief {
  const holdings = input ? holdingViews(input, card, market) : []
  const changes = [...holdings.filter(v => v.breaking).map(v => `${v.name} ${v.breaking}`), ...events(input, market)]
  const asOf = market.bars[INDEXES.shanghai]?.slice(-1)[0]?.date ?? null
  const plan = input?.plan ?? null
  const risk: string[] = [
    plan?.asOf
      ? `资金分与趋势分截至 ${md(plan.asOf)} 收盘，融资余额到 ${plan.marginAsOf ? md(plan.marginAsOf) : '（没有）'}。卖出只由资金分和趋势触发，不因占比高卖出。`
      : '卖出只由资金分和趋势触发，不因占比高卖出。',
    '',
  ]
  if (!holdings.length) risk.push('没有账本，或账本里没有持仓。')
  for (const v of holdings) {
    risk.push(`### ${v.name}${v.order ? `　${v.order}` : ''}`, '')
    if (v.weight !== null) risk.push(`- 占总资产 ${share(v.weight)}`)
    risk.push(`- ${evidenceText(v.evidence)}`)
    const press = v.low === null ? '日线取不到' : v.low.isLow ? `${md(v.low.asOf)} 收盘创 ${LOW_WINDOW} 日新低`
      : v.low.lastLowDate ? `距上次 ${LOW_WINDOW} 日新低（${md(v.low.lastLowDate)}）已 ${v.low.daysSince} 个交易日` : `近 ${v.low.daysSince} 个交易日没有创新低`
    const rel = v.change20 === null ? '' : `；近 20 日 ${pct(v.change20)}${v.relative20 === null ? '' : `，相对基准指数 ${pp(v.relative20)}`}`
    risk.push(`- 卖压：${press}${rel}`)
    if (v.breaking) risk.push(`- ${v.breaking}`)
    if (v.margin) risk.push(`- ${v.margin}`)
    risk.push('')
  }

  const todo: string[] = []
  if (input && asOf && (!input.ledgerAsOf || input.ledgerAsOf < asOf)) todo.push(`上传 ${md(asOf)} 收盘后的持仓截图。账本现在停在 ${input.ledgerAsOf ?? '无日期'}`)
  if (!input) todo.push('上传一张持仓截图，建立账本')
  if (input?.priceFailed.length) todo.unshift(`持仓价格取不到：${input.priceFailed.join('、')}。占比、净值指数今天都不可用；执行单已停单`)
  if (input && !input.lines.baseAt) todo.push('净值基准还没填。填了之后净值指数和三条线才算得出；没填之前执行单不出买入')
  if (card.ok && card.lines.length) todo.push(`按执行单下单（${card.lines.map(l => `${l.side === 'SELL' ? '卖出' : '买入'}${l.name}`).join('、')}），成交后发成交回报和持仓截图`)
  if (market.failed.length) todo.push(`今天取不到的数据：${market.failed.join('、')}`)

  const sections: BriefSection[] = [
    { id: 'risk', title: '持仓：读数与卖出条件', markdown: risk.join('\n') },
    { id: 'goal', title: '目标与进度', markdown: goalLines(input, today).join('\n') },
    { id: 'forecast', title: '预判对照', markdown: forecastLines(market).join('\n') },
    { id: 'todo', title: '需要您做的', markdown: todo.length ? todo.map(t => `- ${t}`).join('\n') : '今天没有需要您做的。' },
  ]

  const push: string[] = []
  if (changes.length) push.push('## 今天的变化', '', ...changes.map(c => `- ${c}`), '')
  if (todo.length) push.push('## 需要您做的', '', ...todo.slice(0, 4).map(t => `- ${t}`))

  return { asOf, generatedAt: market.fetchedAt, changes, todo, sections, push: push.join('\n').trimEnd() }
}

/** 简报要用到哪些股票的行情：持仓、预判里点名的 */
export function briefCodes(input: DecisionInput | null): string[] {
  return [...new Set([
    ...(input?.holdings.filter(h => h.quantity > 0).map(h => h.code) ?? []),
    '688041', '002463',
  ])]
}
