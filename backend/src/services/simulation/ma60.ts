/**
 * MA60 模拟对照（委员会 2026-10-16 裁定二）——纯计算，只统计，不产生任何动作。
 *
 * 三种方案：
 *   A 单日确认：收盘跌破 MA60 当日即触发，次日开盘减到该股自身持仓的 40%（V1.0 原条款，对照组）
 *   B 两日确认：连续两日收盘低于 MA60 才触发，减仓口径同 A（10/12 委员会模拟候选参数）
 *   C 仅触发复核：触发条件同 B，只记录信号、不交易（8/13 裁定的现行口径）
 *
 * 「40%」一律指该股票自身持仓（减掉 60%），不是组合总资产的 40%。
 * 统计结果只说明「这条规则在历史上值不值得」，不授予任何卖出权限；
 * 每日执行单不 import 本模块，卖出纪律仍以已生效的 C 级清退 → 单票归位 → 熔断为准。
 */

export interface Bar { date: string; open: number; close: number; high: number; low: number }

export type VariantId = 'A_SINGLE' | 'B_TWO_DAY' | 'C_REVIEW'

export interface Variant { id: VariantId; name: string; confirmDays: 1 | 2; trades: boolean; note: string }

export const VARIANTS: Variant[] = [
  { id: 'A_SINGLE', name: '方案 A：单日确认即减仓', confirmDays: 1, trades: true, note: 'V1.0 原条款「单日跌破 MA60 减到 40%」，保留为对照组，执行单不调用' },
  { id: 'B_TWO_DAY', name: '方案 B：连续两日确认后减仓', confirmDays: 2, trades: true, note: '10/12 委员会模拟阶段候选参数' },
  { id: 'C_REVIEW', name: '方案 C：仅触发复核', confirmDays: 2, trades: false, note: '8/13 裁定现行口径：技术指标只触发复核，不单独产生卖出' },
]

export const MA_DAYS = 60
/** 减仓后保留该股自身持仓的比例。 */
export const KEEP_FRACTION = 0.4
export const HORIZONS = [5, 20, 60] as const
/** 信号后多少个交易日内收盘重新站上 MA60 记为「来回打脸」。 */
export const WHIPSAW_DAYS = 10

export const COSTS = {
  commission: 0.00025,
  slippage: 0.001,
  stampBefore20230828: 0.001,
  stampFrom20230828: 0.0005,
}

export function sellCost(date: string): number {
  return COSTS.commission + COSTS.slippage + (date >= '2023-08-28' ? COSTS.stampFrom20230828 : COSTS.stampBefore20230828)
}
export const BUY_COST = COSTS.commission + COSTS.slippage

/** 涨跌停幅度：科创板 20%；创业板 2020-08-24 起 20%；其余 10%（不处理 ST）。 */
export function priceLimit(code: string, date: string): number {
  if (code.startsWith('688')) return 0.2
  if (code.startsWith('300') || code.startsWith('301')) return date >= '2020-08-24' ? 0.2 : 0.1
  return 0.1
}

export function movingAverage(bars: Bar[], days = MA_DAYS): (number | null)[] {
  const out: (number | null)[] = []
  let sum = 0
  for (let i = 0; i < bars.length; i++) {
    sum += bars[i]!.close
    if (i >= days) sum -= bars[i - days]!.close
    out.push(i >= days - 1 ? sum / days : null)
  }
  return out
}

/** 跌停开盘无法卖出，顺延到下一个能卖的交易日。 */
export function limitDownOpen(code: string, bars: Bar[], i: number): boolean {
  if (i <= 0) return false
  const prev = bars[i - 1]!.close
  return bars[i]!.open <= prev * (1 - priceLimit(code, bars[i]!.date)) * 1.002
}

/** 第 i 日是否恰好是一段「收盘低于 MA60」的第 confirmDays 天（前一段必须在 MA60 上方）。 */
export function triggers(below: boolean[], i: number, confirmDays: 1 | 2): boolean {
  if (i - confirmDays < 0) return false
  for (let k = 0; k < confirmDays; k++) if (!below[i - k]) return false
  return !below[i - confirmDays]
}

export interface SignalRecord {
  code: string
  variant: VariantId
  signalDate: string
  signalClose: number
  ma60: number
  execDate: string | null
  execPrice: number | null
  /** 因跌停开盘顺延的交易日数。 */
  deferredDays: number
  /** 从成交价起 H 日后的个股收益。 */
  fwd: Record<number, number | null>
  /** 同期沪深 300 收益。 */
  bench: Record<number, number | null>
  /** 成交后 60 日最大不利波动（以最低价计）。 */
  mae60: number | null
  /** 信号后 WHIPSAW_DAYS 日内收盘重新站上 MA60。 */
  whipsaw: boolean
  /** 不同退出时点相对信号日收盘的价格变化：T+1 开盘、T+3 收盘、T+5 收盘。 */
  exitTiming: { t1Open: number | null; t3Close: number | null; t5Close: number | null }
}

export function findSignals(code: string, bars: Bar[], variant: Variant, benchClose: Map<string, number>, from = ''): SignalRecord[] {
  const ma = movingAverage(bars)
  const below = bars.map((b, i) => ma[i] != null && b.close < ma[i]!)
  const valid = bars.map((_, i) => ma[i] != null)
  const out: SignalRecord[] = []
  for (let i = 1; i < bars.length; i++) {
    if (!valid[i - variant.confirmDays] || bars[i]!.date < from) continue
    if (!triggers(below, i, variant.confirmDays)) continue
    let e = i + 1
    while (e < bars.length && limitDownOpen(code, bars, e)) e++
    const has = e < bars.length
    const execPrice = has ? bars[e]!.open : null
    const fwd: Record<number, number | null> = {}
    const bench: Record<number, number | null> = {}
    for (const h of HORIZONS) {
      const j = e + h
      fwd[h] = has && j < bars.length ? bars[j]!.close / execPrice! - 1 : null
      const b0 = has ? benchClose.get(bars[e]!.date) : undefined
      const b1 = j < bars.length ? benchClose.get(bars[j]!.date) : undefined
      bench[h] = b0 && b1 ? b1 / b0 - 1 : null
    }
    let mae60: number | null = null
    if (has && e + 60 < bars.length) {
      let lo = Infinity
      for (let j = e; j <= e + 60; j++) lo = Math.min(lo, bars[j]!.low)
      mae60 = lo / execPrice! - 1
    }
    let whipsaw = false
    for (let j = i + 1; j <= Math.min(bars.length - 1, i + WHIPSAW_DAYS); j++) if (!below[j]) { whipsaw = true; break }
    const c = bars[i]!.close
    const rel = (j: number, k: 'open' | 'close') => j < bars.length ? bars[j]![k] / c - 1 : null
    out.push({
      code, variant: variant.id, signalDate: bars[i]!.date, signalClose: c, ma60: ma[i]!,
      execDate: has ? bars[e]!.date : null, execPrice, deferredDays: e - (i + 1),
      fwd, bench, mae60, whipsaw,
      exitTiming: { t1Open: rel(i + 1, 'open'), t3Close: rel(i + 3, 'close'), t5Close: rel(i + 5, 'close') },
    })
  }
  return out
}

export interface PathResult {
  code: string
  variant: VariantId
  from: string
  to: string
  totalReturn: number
  maxDrawdown: number
  sells: number
  buys: number
  costPaid: number
}

/**
 * 单票净值路径。起点满仓；A/B 触发后次日开盘减到 40%（跌停顺延）。
 * 回补是计算回撤所必需的假设，不是规则建议：减仓后收盘连续两日站上 MA60，次日开盘买回满仓。
 * C 为一直持有。
 */
export function simulatePath(code: string, bars: Bar[], variant: Variant, from = ''): PathResult | null {
  const ma = movingAverage(bars)
  let start = bars.findIndex((b, i) => ma[i] != null && b.date >= from)
  if (start < 0 || start >= bars.length - 1) return null
  const below = bars.map((b, i) => ma[i] != null && b.close < ma[i]!)
  let shares = 1 / bars[start]!.close
  let cash = 0
  let reduced = false
  let pendingSell = false
  let pendingBuy = false
  let peak = 1
  let mdd = 0
  let sells = 0
  let buys = 0
  let costPaid = 0
  for (let i = start + 1; i < bars.length; i++) {
    const b = bars[i]!
    if (pendingSell && !limitDownOpen(code, bars, i)) {
      const qty = shares * (1 - KEEP_FRACTION)
      const gross = qty * b.open
      const cost = gross * sellCost(b.date)
      cash += gross - cost
      costPaid += cost
      shares -= qty
      reduced = true
      pendingSell = false
      sells++
    } else if (pendingBuy) {
      const cost = cash * BUY_COST
      shares += (cash - cost) / b.open
      costPaid += cost
      cash = 0
      reduced = false
      pendingBuy = false
      buys++
    }
    if (variant.trades && !reduced && !pendingSell && triggers(below, i, variant.confirmDays)) pendingSell = true
    if (reduced && !pendingBuy && i >= 2 && !below[i] && !below[i - 1] && ma[i - 1] != null) pendingBuy = true
    const eq = shares * b.close + cash
    peak = Math.max(peak, eq)
    mdd = Math.min(mdd, eq / peak - 1)
  }
  const last = bars[bars.length - 1]!
  return {
    code, variant: variant.id, from: bars[start]!.date, to: last.date,
    totalReturn: shares * last.close + cash - 1, maxDrawdown: mdd, sells, buys, costPaid,
  }
}

export interface SignalStats {
  signals: number
  stockYears: number
  perStockYear: number
  /** 卖出后 H 日个股收益仍高于卖出成本（卖错了）的比例。 */
  falseSell: Record<number, number | null>
  meanFwd: Record<number, number | null>
  meanExcess: Record<number, number | null>
  /** 按 60% 卖出份额计、扣成本后，每次信号相对一直持有省下的该股持仓比例。 */
  savedPerSignal: Record<number, number | null>
  meanMae60: number | null
  whipsawRate: number | null
  deferred: number
  exitTiming: { t1Open: number | null; t3Close: number | null; t5Close: number | null }
}

const mean = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null

export function summarizeSignals(rows: SignalRecord[], stockYears: number): SignalStats {
  const falseSell: Record<number, number | null> = {}
  const meanFwd: Record<number, number | null> = {}
  const meanExcess: Record<number, number | null> = {}
  const savedPerSignal: Record<number, number | null> = {}
  for (const h of HORIZONS) {
    const done = rows.filter(r => r.fwd[h] != null)
    falseSell[h] = done.length ? done.filter(r => r.fwd[h]! > sellCost(r.execDate!)).length / done.length : null
    meanFwd[h] = mean(done.map(r => r.fwd[h]!))
    meanExcess[h] = mean(done.filter(r => r.bench[h] != null).map(r => r.fwd[h]! - r.bench[h]!))
    savedPerSignal[h] = mean(done.map(r => (1 - KEEP_FRACTION) * (-r.fwd[h]! - sellCost(r.execDate!))))
  }
  const pick = (k: keyof SignalRecord['exitTiming']) => mean(rows.map(r => r.exitTiming[k]).filter((x): x is number => x != null))
  return {
    signals: rows.length,
    stockYears,
    perStockYear: stockYears > 0 ? rows.length / stockYears : 0,
    falseSell, meanFwd, meanExcess, savedPerSignal,
    meanMae60: mean(rows.map(r => r.mae60).filter((x): x is number => x != null)),
    whipsawRate: rows.length ? rows.filter(r => r.whipsaw).length / rows.length : null,
    deferred: rows.filter(r => r.deferredDays > 0).length,
    exitTiming: { t1Open: pick('t1Open'), t3Close: pick('t3Close'), t5Close: pick('t5Close') },
  }
}

export interface PathStats {
  stocks: number
  meanReturn: number | null
  medianReturn: number | null
  meanMdd: number | null
  medianMdd: number | null
  meanSells: number | null
  meanCost: number | null
}

export function median(xs: number[]): number | null {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2
}

export function summarizePaths(rows: PathResult[]): PathStats {
  return {
    stocks: rows.length,
    meanReturn: mean(rows.map(r => r.totalReturn)),
    medianReturn: median(rows.map(r => r.totalReturn)),
    meanMdd: mean(rows.map(r => r.maxDrawdown)),
    medianMdd: median(rows.map(r => r.maxDrawdown)),
    meanSells: mean(rows.map(r => r.sells)),
    meanCost: mean(rows.map(r => r.costPaid)),
  }
}

/** 模拟层永远不产生动作；审计与自检据此确认它没有被接入执行单。 */
export function simulationProducesAction(): false { return false }
