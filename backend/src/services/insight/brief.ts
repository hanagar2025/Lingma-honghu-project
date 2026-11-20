/**
 * 每日简报：把账户、行情和登记的战略对到一起，回答两个问题。
 *
 *   风险  持仓各自处在什么状态，哪些按规则要卖，哪些拿住，降仓时先动谁。
 *   机会  可买范围内的股票，六项前提各自成立了没有，还差什么。
 *
 * 本模块不产生任何买卖指令。卖出指令只来自执行单的三条规则；买入只在六项前提成立、
 * 委员会登记之后才有。这里只把读数和登记的结论摆出来。
 */
import type { DecisionCard } from '../dailyDecision/card'
import type { DecisionInput } from '../dailyDecision/types'
import { INDEXES, US_ANCHORS, type Bar, type MarketData, type MarginRow } from '../market/data'
import { findMember } from '../msr/universe'
import { BUYABLE, FORECAST_FROM, FORECASTS, GATE, HOLD_VOID_IF, OVERSEAS_DRIVEN, PENDING, REGISTERED, STOCK_VIEWS, type StockView } from './config'

export interface LowState {
  asOf: string
  /** 最新一个收盘价是 60 日内最低 */
  isLow: boolean
  /** 最近一次收盘创 60 日新低的日期；数据范围内没有则为 null */
  lastLowDate: string | null
  /** 距那一天过了几个交易日；数据范围内没有新低时等于可判定的天数 */
  daysSince: number
}

export function lowState(bars: readonly Bar[] | undefined, window: number = GATE.lowWindow): LowState | null {
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
const CN = ['', '一', '二', '三', '四', '五', '六']

export interface Premise { no: number; name: string; ok: boolean; reading: string }
export interface GateStock { code: string; name: string; premises: Premise[]; okCount: number }
export interface Gate { open: boolean; shared: Premise[]; stocks: GateStock[] }

function quietText(s: LowState | null, what: string): { ok: boolean; text: string } {
  if (!s) return { ok: false, text: `${what}日线不足或取不到，按不成立` }
  if (s.isLow) return { ok: false, text: `${what}${md(s.asOf)} 收盘创 ${GATE.lowWindow} 日新低` }
  const reached = GATE.candidates.filter(n => s.daysSince >= n)
  const since = s.lastLowDate ? `距上次新低（${md(s.lastLowDate)}）已 ${s.daysSince} 个交易日` : `近 ${s.daysSince} 个交易日没有创新低`
  const bar = reached.length === GATE.candidates.length ? '候选门槛 5、10、15 日均已达到'
    : reached.length ? `达到候选门槛 ${reached.join('、')} 日，未达到 ${GATE.quietDays} 日` : '候选门槛 5、10、15 日均未达到'
  return { ok: s.daysSince >= GATE.quietDays, text: `${what}${since}；${bar}` }
}

/** 今天之前最近的一个交易日。账本不早于它才算"账户干净" */
function previousTradingDay(market: MarketData, today: string): string | null {
  return market.bars[INDEXES.shanghai]?.filter(b => b.date < today).pop()?.date ?? null
}

function accountPremise(input: DecisionInput | null, card: DecisionCard, market: MarketData, today: string): Premise {
  const miss: string[] = []
  const prev = previousTradingDay(market, today)
  if (!input) miss.push('没有账本')
  else {
    if (!prev) miss.push('取不到交易日历')
    else if (!input.ledgerAsOf || input.ledgerAsOf < prev) miss.push(`账本停在 ${input.ledgerAsOf ?? '无日期'}，早于上一交易日 ${prev}`)
    if (!card.ok) miss.push('执行单因数据未通过核对而停单')
    if (card.lines.length) miss.push(`有 ${card.lines.length} 笔卖出指令未完成（${card.lines.map(l => l.name).join('、')}）`)
    const s = input.snapshot
    const cap = input.circuit.equityCap
    if (cap !== null && s.portfolioTotal > 0 && s.positionsValue / s.portfolioTotal > cap) {
      miss.push(`熔断要求股票不超过 ${share(cap)}，现在 ${share(s.positionsValue / s.portfolioTotal)}`)
    }
  }
  return { no: 1, name: '账户干净', ok: !miss.length, reading: miss.length ? miss.join('；') : '账本是最新的，没有未完成的卖出指令' }
}

function overseasPremise(market: MarketData): Premise {
  const nv = market.us.NVDA
  const lite = market.us.LITE
  const cohr = market.us.COHR
  const parts: string[] = []
  let ok = true
  const a = quietText(nv ? lowState(nv.bars) : null, '英伟达：')
  parts.push(a.text)
  ok &&= a.ok
  const b = quietText(lite && cohr ? lowState(composite(lite.bars, cohr.bars)) : null, 'Lumentum 与 Coherent 等权：')
  parts.push(b.text)
  ok &&= b.ok
  const unverified = US_ANCHORS.filter(x => market.us[x.key] && !market.us[x.key]!.verified).map(x => `${x.name}${market.us[x.key]!.note}`)
  if (unverified.length) {
    ok = false
    parts.push(`美股行情未通过第二数据源核对（${unverified.join('；')}），按不成立`)
  }
  return { no: 4, name: '海外链条止跌', ok, reading: parts.join('。') }
}

function roomPremise(code: string, input: DecisionInput | null): Premise {
  const name = '仓位有空间'
  if (!input || !(input.snapshot.portfolioTotal > 0)) return { no: 6, name, ok: false, reading: '没有账本，无法试算' }
  if (input.priceFailed.length) return { no: 6, name, ok: false, reading: `持仓价格取不到（${input.priceFailed.join('、')}），无法试算` }
  const s = input.snapshot
  const total = s.portfolioTotal
  const value = (c: string): number => {
    const h = input.holdings.find(x => x.code === c)
    return h && h.close !== null ? h.quantity * h.close : 0
  }
  const miss: string[] = []
  if (input.circuit.sellOnly) miss.push('二级熔断，只卖不买')
  if (input.circuit.level === 'INCOMPARABLE') miss.push('回撤不可判定')
  const b = GATE.batchPct
  const stock = s.positionsValue / total
  const cap = Math.min(input.circuit.equityCap ?? 1, 1 - GATE.cashFloor)
  if (stock + b > cap) miss.push(`股票 ${share(stock)}，买一批（总资产 ${share(b)}）后超过上限 ${share(cap)}`)
  const own = value(code) / total
  if (own + b > GATE.singleCap) miss.push(`该股已占 ${share(own)}，买一批后超过单票 ${share(GATE.singleCap)}`)
  const line = findMember(code)?.mainline.id
  const sumOf = (ok: (id: string | undefined) => boolean): number =>
    input.holdings.filter(h => ok(findMember(h.code)?.mainline.id)).reduce((t, h) => t + value(h.code), 0) / total
  const sector = sumOf(id => id === line)
  if (sector + b > GATE.sectorCap) miss.push(`所在主线合计 ${share(sector)}，买一批后超过 ${share(GATE.sectorCap)}`)
  const theme = sumOf(id => id !== undefined && GATE.aiMainlines.includes(id))
  if (GATE.aiMainlines.includes(line ?? '') && theme + b > GATE.themeCap) miss.push(`AI 主题合计 ${share(theme)}，买一批后超过 ${share(GATE.themeCap)}`)
  return { no: 6, name, ok: !miss.length, reading: miss.length ? miss.join('；') : `买一批（总资产 ${share(b)}）后各项上限仍有余量` }
}

function marginText(code: string, market: MarketData): string | null {
  const own = market.margin[code]
  const all = market.marketMargin
  const r5 = marginRate(own, 5)
  const m5 = marginRate(all, 5)
  if (r5 === null || m5 === null || own![0]!.date !== all[0]!.date) return null
  const r20 = marginRate(own, 20)
  return `融资余额 5 日 ${pct(r5)}，全市场 ${pct(m5, 2)}，差 ${pp(r5 - m5)}${r20 === null ? '' : `；20 日 ${pct(r20)}`}（截至 ${md(own![0]!.date)}）`
}

export function buildGate(input: DecisionInput | null, card: DecisionCard, market: MarketData, today: string): Gate {
  const account = accountPremise(input, card, market, today)
  const overseas = overseasPremise(market)
  const stocks: GateStock[] = BUYABLE.map(b => {
    const quiet = quietText(lowState(market.bars[b.code]), '')
    const premises: Premise[] = [
      account,
      { no: 2, name: '个股止跌', ok: quiet.ok, reading: quiet.text },
      { no: 3, name: '去杠杆结束', ok: false, reading: `${marginText(b.code, market) ?? '融资余额取不到'}。参数未裁定，按不成立` },
      OVERSEAS_DRIVEN.includes(b.code) ? overseas : { no: 4, name: '海外链条止跌', ok: true, reading: '不适用：盈利不来自海外资本开支' },
      { no: 5, name: '盈利没有掉头', ok: b.earningsOk, reading: b.earningsBasis },
      roomPremise(b.code, input),
    ]
    return { code: b.code, name: b.name, premises, okCount: premises.filter(p => p.ok).length }
  })
  return { open: stocks.some(s => s.okCount === 6), shared: [account, overseas], stocks }
}

export interface HoldingView {
  code: string
  name: string
  weight: number | null
  /** 执行单上对它的卖出指令 */
  order: string | null
  view: StockView | null
  outside: boolean
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
    const member = findMember(h.code)
    const bars = market.bars[h.code]
    const own = change(bars, 20)
    const bench = change(market.bars[member?.mainline.benchmark ?? INDEXES.chinext], 20)
    const line = card.lines.find(l => l.code === h.code)
    return {
      code: h.code, name: h.name,
      weight: h.close !== null && total > 0 && !input.priceFailed.length ? h.quantity * h.close / total : null,
      order: line ? `卖出 ${line.shares} 股（${line.reason.split('，')[0]}）` : null,
      view: STOCK_VIEWS.find(v => v.code === h.code) ?? null,
      outside: member === null,
      low: lowState(bars),
      breaking: breakingText(h, bars),
      change20: own,
      relative20: own !== null && bench !== null ? own - bench : null,
      margin: marginText(h.code, market),
    }
  })
  const rank = (v: HoldingView): number =>
    v.order ? 0 : v.view?.stance === 'TRIM' ? 1 + (v.view.order ?? 9) / 10 : v.outside ? 2 : v.view?.stance === 'WATCH' ? 3 : 4
  return views.sort((a, b) => rank(a) - rank(b) || (b.weight ?? 0) - (a.weight ?? 0))
}

/** 盘中价比最近一个收盘价更新，且低于此前 60 日的最低收盘价：收盘不回升就是新低 */
function breakingText(h: { close: number | null; barDate: string | null }, bars: readonly Bar[] | undefined): string | null {
  const last = bars?.[bars.length - 1]
  if (!bars || !last || h.close === null || !h.barDate || h.barDate <= last.date || bars.length < GATE.lowWindow - 1) return null
  const floor = Math.min(...bars.slice(-(GATE.lowWindow - 1)).map(b => b.close))
  return h.close < floor ? `盘中 ${h.close.toFixed(2)} 低于此前 ${GATE.lowWindow} 日最低收盘价 ${floor.toFixed(2)}，收盘不回升就是新低` : null
}

function stanceText(v: HoldingView): string {
  if (v.outside) return `主线外。${PENDING.outside}`
  if (!v.view) return '没有登记结论。按现行规则，没有卖出指令就不动'
  if (v.view.stance === 'HOLD') return `拿住。${v.view.basis}`
  if (v.view.stance === 'TRIM') return `熔断降仓时建议第 ${v.view.order} 位卖出，须委员会指派，指派前不是指令。${v.view.basis}`
  return `观察。${v.view.basis}`
}

function events(input: DecisionInput | null, market: MarketData): string[] {
  const out: string[] = []
  const note = (name: string, s: LowState | null): void => {
    if (!s) return
    if (s.isLow) out.push(`${name} ${md(s.asOf)} 收盘创 ${GATE.lowWindow} 日新低`)
    else if (GATE.candidates.includes(s.daysSince)) out.push(`${name} 已连续 ${s.daysSince} 个交易日没有创 ${GATE.lowWindow} 日新低`)
  }
  const names = new Map<string, string>([
    ...BUYABLE.map(b => [b.code, b.name] as [string, string]),
    ...(input?.holdings.filter(h => h.quantity > 0).map(h => [h.code, h.name] as [string, string]) ?? []),
  ])
  for (const [code, name] of names) note(name, lowState(market.bars[code]))
  note('英伟达', market.us.NVDA ? lowState(market.us.NVDA.bars) : null)
  note('Lumentum 与 Coherent 等权', lowState(composite(market.us.LITE?.bars, market.us.COHR?.bars)))
  return out
}

function goalLines(input: DecisionInput | null): string[] {
  if (!input) return ['没有账本，算不出进度。']
  if (input.priceFailed.length) return [`持仓价格取不到（${input.priceFailed.join('、')}），市值只能按成本价估，今天算不出进度。`]
  const c = input.circuit
  const s = input.snapshot
  if (c.drawdown === null || !(s.portfolioTotal > 0)) return ['峰值口径不可比，算不出进度。', `待您裁定：${PENDING.goal}`]
  const need = 1 / (1 - c.drawdown) - 1
  const years = [0.10, 0.15, 0.20, 0.30].map(r => `${(r * 100).toFixed(0)}% 约 ${(Math.log(1 + need) / Math.log(1 + r)).toFixed(1)} 年`)
  const stock = s.positionsValue / s.portfolioTotal
  const out = [
    `- 自峰值回撤 ${share(c.drawdown)}${s.peakVerified ? '' : '（峰值待核验）'}。回到峰值，总资产需要上涨 ${share(need)}。`,
    `- 按年化复利算回到峰值的时间：${years.join('，')}。这是算术，不是预测。`,
  ]
  if (stock > 0) out.push(`- 现在股票占 ${share(stock)}。现金不动的话，股票部分要上涨 ${share(need / stock)} 才能让总资产回到峰值。`)
  if (c.equityCap !== null && c.equityCap < stock) {
    out.push(`- 按熔断上限把股票降到 ${share(c.equityCap)} 之后，股票部分要上涨 ${share(need / c.equityCap)}。上限保住本金，也拉长回到峰值的时间。`)
  }
  out.push(`- 待您裁定：${PENDING.goal}。填了之后，这里才能给出"目标是多少、到哪一天、现在走到哪"。`)
  return out
}

function forecastLines(market: MarketData): string[] {
  const out: string[] = []
  const lowsAfter = (bars: readonly Bar[] | undefined): string[] => {
    const hit: string[] = []
    if (!bars) return hit
    for (let end = GATE.lowWindow; end <= bars.length; end++) {
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

export interface BriefSection { id: 'risk' | 'gate' | 'goal' | 'forecast' | 'score' | 'todo'; title: string; markdown: string }

export interface Brief {
  /** 行情截止的交易日 */
  asOf: string | null
  generatedAt: string
  gateOpen: boolean
  changes: string[]
  todo: string[]
  sections: BriefSection[]
  /** 推送用：接在执行单后面的几行 */
  push: string
}

export function buildBrief(input: DecisionInput | null, card: DecisionCard, market: MarketData, today: string): Brief {
  const gate = buildGate(input, card, market, today)
  const holdings = input ? holdingViews(input, card, market) : []
  const changes = [...holdings.filter(v => v.breaking).map(v => `${v.name} ${v.breaking}`), ...events(input, market)]
  const asOf = market.bars[INDEXES.shanghai]?.slice(-1)[0]?.date ?? null
  const risk: string[] = [`结论登记于 ${md(REGISTERED.date)}，依据${REGISTERED.basis}，估值是 11/10 的读数；下次更新：${REGISTERED.nextReview}。两次更新之间不因涨跌改动。`, '']
  if (!holdings.length) risk.push('没有账本，或账本里没有持仓。')
  for (const v of holdings) {
    risk.push(`### ${v.name}${v.order ? `　${v.order}` : ''}`, '')
    if (v.weight !== null) risk.push(`- 占总资产 ${share(v.weight)}`)
    risk.push(`- ${stanceText(v)}`)
    const press = v.low === null ? '日线取不到' : v.low.isLow ? `${md(v.low.asOf)} 收盘创 ${GATE.lowWindow} 日新低`
      : v.low.lastLowDate ? `距上次 ${GATE.lowWindow} 日新低（${md(v.low.lastLowDate)}）已 ${v.low.daysSince} 个交易日` : `近 ${v.low.daysSince} 个交易日没有创新低`
    const rel = v.change20 === null ? '' : `；近 20 日 ${pct(v.change20)}${v.relative20 === null ? '' : `，相对基准指数 ${pp(v.relative20)}`}`
    risk.push(`- 卖压：${press}${rel}`)
    if (v.breaking) risk.push(`- ${v.breaking}`)
    if (v.margin) risk.push(`- ${v.margin}`)
    risk.push('')
  }
  if (holdings.some(v => v.view?.stance === 'HOLD')) risk.push(`「拿住」作废的条件：${HOLD_VOID_IF}。`)

  const mark = (p: Premise): string => `- ${p.ok ? '✓' : '✗'} 前提${CN[p.no]}　${p.name}：${p.reading}`
  const gateMd: string[] = [
    gate.open ? '六项前提在下列股票上全部成立，可以提请委员会登记第一批。买入权限仍须委员会打开。'
      : '闸门关闭：没有一只股票六项前提全部成立。现在不买。',
    '', `参数出处：${GATE.version}。止跌天数取候选里最保守的 ${GATE.quietDays} 个交易日。`, '',
    '### 共同前提', '', ...gate.shared.map(mark), '',
  ]
  for (const s of gate.stocks) {
    gateMd.push(`### ${s.name}　成立 ${s.okCount}/6`, '', ...s.premises.filter(p => !gate.shared.includes(p)).map(mark), '')
  }

  const todo: string[] = []
  if (input && asOf && (!input.ledgerAsOf || input.ledgerAsOf < asOf)) todo.push(`上传 ${md(asOf)} 收盘后的持仓截图。账本现在停在 ${input.ledgerAsOf ?? '无日期'}`)
  if (!input) todo.push('上传一张持仓截图，建立账本')
  if (input) {
    const s = input.snapshot
    const over = input.circuit.equityCap !== null && s.portfolioTotal > 0 && s.positionsValue / s.portfolioTotal > input.circuit.equityCap
    if (!s.peakVerified && input.circuit.level !== 'NORMAL') todo.push(PENDING.peak)
    if (over) todo.push(PENDING.circuit)
    for (const o of input.outsideMainline ?? []) todo.push(`${o.name}：${PENDING.outside}`)
  }
  if (input?.priceFailed.length) todo.unshift(`持仓价格取不到：${input.priceFailed.join('、')}。占比、回撤、进度今天都不可用；执行单已停单`)
  todo.push(PENDING.gate)
  if (market.failed.length) todo.push(`今天取不到的数据（已按不成立处理）：${market.failed.join('、')}`)

  const sections: BriefSection[] = [
    { id: 'risk', title: '持仓：风险与去留', markdown: risk.join('\n') },
    { id: 'gate', title: '机会闸门', markdown: gateMd.join('\n') },
    { id: 'goal', title: '目标与进度', markdown: goalLines(input).join('\n') },
    { id: 'forecast', title: '预判对照', markdown: forecastLines(market).join('\n') },
    { id: 'todo', title: '需要您做的', markdown: todo.map(t => `- ${t}`).join('\n') },
  ]

  const push: string[] = []
  if (changes.length) push.push('## 今天的变化', '', ...changes.map(c => `- ${c}`), '')
  const closest = [...gate.stocks].sort((a, b) => b.okCount - a.okCount)[0]
  push.push('## 机会闸门', '', gate.open ? '- 六项前提已全部成立，可以提请登记第一批'
    : `- 关闭，不买。最接近的是${closest?.name ?? '—'}：成立 ${closest?.okCount ?? 0}/6，还差${closest?.premises.filter(p => !p.ok).map(p => p.name).join('、') ?? ''}`, '')
  push.push('## 需要您做的', '', ...todo.slice(0, 4).map(t => `- ${t}`))

  return { asOf, generatedAt: market.fetchedAt, gateOpen: gate.open, changes, todo, sections, push: push.join('\n') }
}

/** 简报要用到哪些股票的行情：持仓、可买范围、预判里点名的 */
export function briefCodes(input: DecisionInput | null): string[] {
  return [...new Set([
    ...(input?.holdings.filter(h => h.quantity > 0).map(h => h.code) ?? []),
    ...BUYABLE.map(b => b.code), '688041', '002463',
  ])]
}
