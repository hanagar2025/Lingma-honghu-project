/**
 * 资金驾驶舱（R-01）· 指标层
 *
 * 全部是纯函数：输入对齐好的序列，输出同样对齐的序列。不联网、不读文件。
 *
 * 缺失的传播规则：
 *   · 成分股任一只成交额缺失 → 该对象当日成交额为 null（停牌应由数据源给 0，缺失才是 null）；
 *   · 窗口内任一值为 null → 该窗口的均值为 null；
 *   · 分位数只用非 null 值计算，样本不足则整组为 null，并标"样本不足"。
 * 宁可算不出，也不用默认值糊过去。
 */

import { THRESHOLDS as T } from './config'
import type { DataSet, MoneyObject } from './types'

export type Num = number | null

export function rollingMean(xs: readonly Num[], n: number): Num[] {
  return xs.map((_, t) => {
    if (t < n - 1) return null
    let s = 0
    for (let i = t - n + 1; i <= t; i++) {
      const v = xs[i]
      if (v === null || v === undefined) return null
      s += v
    }
    return s / n
  })
}

export function quantile(values: readonly Num[], q: number): Num {
  const xs = values.filter((v): v is number => v !== null && Number.isFinite(v)).sort((a, b) => a - b)
  if (!xs.length) return null
  const pos = (xs.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  const a = xs[lo]!
  const b = xs[hi]!
  return a + (b - a) * (pos - lo)
}

/** 有序数组的增删（二分定位），用于滚动窗口分位数，避免每天整体重排 */
function sortedInsert(xs: number[], v: number): void {
  let lo = 0
  let hi = xs.length
  while (lo < hi) { const mid = (lo + hi) >> 1; if (xs[mid]! < v) lo = mid + 1; else hi = mid }
  xs.splice(lo, 0, v)
}

function sortedRemove(xs: number[], v: number): void {
  let lo = 0
  let hi = xs.length
  while (lo < hi) { const mid = (lo + hi) >> 1; if (xs[mid]! < v) lo = mid + 1; else hi = mid }
  if (xs[lo] === v) xs.splice(lo, 1)
}

function sortedQuantile(xs: readonly number[], q: number): number | null {
  if (!xs.length) return null
  const pos = (xs.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return xs[lo]! + (xs[hi]! - xs[lo]!) * (pos - lo)
}

function trailing<T>(xs: readonly T[], t: number, w: number): T[] {
  return xs.slice(Math.max(0, t - w + 1), t + 1)
}

/**
 * ETF 每日净申赎（元）与规模（元），能识别份额折算 / 合并。
 *
 * 份额折算（如 1 拆 3）当天份额翻 3 倍、不复权价跌到 1/3，钱一分没进来；
 * 只拿"份额差 × 价格"会把它记成一笔等于全部规模的申购。
 * 识别办法：不复权价 ÷ 复权价 这个因子在分红时只动几个百分点，折算时成倍跳变 ——
 * 跳变日 p 的倍数 k 即折算比例。交易所份额与行情价格的折算日可能错开一天，
 * 所以在 p−1、p、p+1 里找份额比最接近 k 的那天 d，作为份额侧的折算日。
 *
 * 之后按"份额单位"和"价格单位"各自已经折算过几次，把价格换成与份额同一单位：
 *   P_t = 不复权价_t × u价(t) ÷ u份(t)
 *   净申赎_t = (份额_t − 份额_{t−1} × u份(t)/u份(t−1)) × P_t，规模_t = 份额_t × P_t
 *
 * 首个有份额的日子（上市或数据起点）不算申购；之后某天份额缺失 → 当天为 null。
 * 没有不复权价时（合成数据）按无折算处理。
 */
export interface EtfFlow {
  flow: Num[]
  aum: Num[]
  splits: { priceDay: number; shareDay: number; k: number }[]
  /** 第一个有份额的下标；之前视为尚未上市（-1 = 从未有份额） */
  first: number
}

export function etfFlowSeries(share: readonly Num[], raw: readonly Num[], adj: readonly Num[]): EtfFlow {
  const n = share.length
  const splits: { priceDay: number; shareDay: number; k: number }[] = []
  let prevF: number | null = null
  for (let t = 0; t < n; t++) {
    const r = raw[t] ?? null
    const a = adj[t] ?? null
    if (r === null || a === null || r <= 0 || a <= 0) continue
    const f = r / a
    if (prevF !== null) {
      const g = f / prevF
      if (g < 0.8 || g > 1.25) {
        const k = 1 / g
        let best = t
        let bestErr = Infinity
        for (const d of [t - 1, t, t + 1]) {
          const s1 = share[d] ?? null
          const s0 = share[d - 1] ?? null
          if (s1 === null || s0 === null || s0 <= 0 || s1 <= 0) continue
          const err = Math.abs(Math.log(s1 / s0) - Math.log(k))
          if (err < bestErr) { bestErr = err; best = d }
        }
        splits.push({ priceDay: t, shareDay: bestErr < Math.log(1.3) ? best : t, k })
      }
    }
    prevF = f
  }
  const uShare = (t: number) => splits.reduce((m, s) => (s.shareDay <= t ? m * s.k : m), 1)
  const uPrice = (t: number) => splits.reduce((m, s) => (s.priceDay <= t ? m * s.k : m), 1)

  const flow: Num[] = []
  const aum: Num[] = []
  let first = -1
  for (let t = 0; t < n; t++) {
    const s = share[t] ?? null
    const r = raw[t] ?? adj[t] ?? null
    if (s === null || r === null) {
      flow.push(null)
      aum.push(null)
      continue
    }
    const px = r * uPrice(t) / uShare(t)
    aum.push(s * px)
    const sp = t > 0 ? share[t - 1] ?? null : null
    if (first < 0) { flow.push(0); first = t; continue }
    if (sp === null) { flow.push(null); continue }
    flow.push((s - sp * uShare(t) / uShare(t - 1)) * px)
  }
  return { flow, aum, splits, first }
}

/** 多只 ETF 按日汇总：尚未上市的不计；已上市的某天缺失 → 当天整体为 null，不当 0 */
export function sumEtfFlows(xs: readonly EtfFlow[], n: number, dayMissing: (t: number) => boolean = () => false): { flow: Num[]; aum: Num[] } {
  const flow: Num[] = []
  const aum: Num[] = []
  for (let t = 0; t < n; t++) {
    if (dayMissing(t)) { flow.push(null); aum.push(null); continue }
    let f: Num = 0
    let a: Num = 0
    for (const x of xs) {
      if (x.first < 0 || t < x.first) continue
      const v = x.flow[t] ?? null
      const m = x.aum[t] ?? null
      if (v === null || m === null) { f = null; a = null; break }
      f += v
      a += m
    }
    flow.push(f)
    aum.push(a)
  }
  return { flow, aum }
}

/** 某只 ETF 在数据集里的净申赎序列 */
export function etfFlowOf(ds: DataSet, code: string): EtfFlow {
  const days = ds.etfs[code] ?? []
  return etfFlowSeries(days.map(d => d.share), days.map(d => (d.rawClose === undefined ? d.close : d.rawClose)), days.map(d => d.close))
}

/** 原始序列：把成分股按日期汇总成对象的成交额、价格、融资、ETF 净申赎、机构净买 */
export interface RawSeries {
  amount: Num[]
  share: Num[]
  close: Num[]
  margin: Num[]
  etfFlow: Num[]
  instNet: Num[]
  anomaly: boolean[]
}

export function rawSeries(obj: MoneyObject, ds: DataSet): RawSeries {
  const agg = ds.aggregates?.[obj.id]
  if (agg) return seriesFromAggregate(agg, obj, ds)
  const n = ds.dates.length
  const amount: Num[] = []
  const margin: Num[] = []
  const instNet: Num[] = []
  const etfFlow: Num[] = []
  const close: Num[] = []
  let index = 100
  const themeFlow = obj.themeEtfs.length ? sumEtfFlows(obj.themeEtfs.map(c => etfFlowOf(ds, c)), n).flow : null

  for (let t = 0; t < n; t++) {
    let a: Num = 0
    let m: Num = 0
    let inst: Num = null
    const rets: number[] = []
    for (const code of obj.codes) {
      const d = ds.stocks[code]?.[t]
      if (!d || d.amount === null) a = null
      else if (a !== null) a += d.amount
      if (!d || d.marginBalance === null) m = null
      else if (m !== null) m += d.marginBalance
      const iv = ds.inst[code]?.[t]?.netBuy ?? null
      if (iv !== null) inst = (inst ?? 0) + iv
      const prev = t > 0 ? ds.stocks[code]?.[t - 1]?.close ?? null : null
      if (d && d.close !== null && prev !== null && prev > 0) rets.push(d.close / prev - 1)
    }
    amount.push(a)
    margin.push(m)
    instNet.push(inst)

    etfFlow.push(themeFlow ? themeFlow[t] ?? null : null)

    if (obj.codes.length === 1) {
      close.push(ds.stocks[obj.codes[0]!]?.[t]?.close ?? null)
    } else if (t === 0) {
      close.push(index)
    } else if (rets.length * 2 < obj.codes.length) {
      close.push(null)
    } else {
      index *= 1 + rets.reduce((x, y) => x + y, 0) / rets.length
      close.push(index)
    }
  }

  const share = amount.map((a, t) => {
    const total = ds.market[t]?.totalAmount ?? null
    return a === null || total === null || total <= 0 ? null : a / total
  })
  const anomaly = ds.market.map(d => d.anomaly === true)
  return { amount, share, close, margin, etfFlow, instNet, anomaly }
}

function seriesFromAggregate(agg: DataSet['stocks'][string], obj: MoneyObject, ds: DataSet): RawSeries {
  const amount = agg.map(d => d.amount)
  const share = amount.map((a, t) => {
    const total = ds.market[t]?.totalAmount ?? null
    return a === null || total === null || total <= 0 ? null : a / total
  })
  const instNet = ds.dates.map((_, t) => {
    let s: Num = null
    for (const code of obj.codes) {
      const v = ds.inst[code]?.[t]?.netBuy ?? null
      if (v !== null) s = (s ?? 0) + v
    }
    return s
  })
  return {
    amount, share,
    close: agg.map(d => d.close),
    margin: agg.map(d => d.marginBalance),
    etfFlow: ds.dates.map(() => null),
    instNet,
    anomaly: ds.market.map(d => d.anomaly === true),
  }
}

export type BaselineBasis = 'FULL' | 'SHORT' | 'INSUFFICIENT'

/** 每个交易日的完整指标。分位数都是"该对象自身"的历史分位 */
export interface DayMetrics {
  s5: Num
  s10: Num
  s20: Num
  median: Num
  q25: Num
  q75: Num
  q95: Num
  basis: BaselineBasis
  /**
   * 堆积期累计超额成交额（元）。成交额是流量，同一笔钱每天被反复买卖，
   * 累加值不代表"池子里有这么多钱"，只用来和该对象自己的历史比较高低（背离判定第 1 项）。
   * 要表达"资金量有多少"，看 amount20（日均资金）对比 baseLevel20（水位）。
   */
  pool: number
  /** 20 日日均成交额（元/日）：当前的资金量 */
  amount20: Num
  /** 水位对应的日均成交额（元/日）= 份额中位数 × 两市 20 日日均成交额 */
  baseLevel20: Num
  /** 10 日涨幅 */
  ret10: Num
  /** 当前连续高于水位的天数 */
  persist: number
  /** 此前历史上最长的连续天数（不含当前这一段） */
  maxPersistBefore: number
  poolQ90: Num
  close: Num
  ret20: Num
  ret20Q90: Num
  high60: Num
  margin: Num
  marginDelta10: Num
  etfNet10: Num
  instNet10: Num
  /** A2 同向流入：融资增加或 ETF 净申购。两项都缺 → null（不可判定） */
  a2Inflow: boolean | null
  /** A2 反向流出：融资减少或 ETF 净赎回 */
  a2Outflow: boolean | null
  anomaly: boolean
}

function sumWindow(xs: readonly Num[], t: number, w: number, allowPartial: boolean): Num {
  if (t < w - 1) return null
  let s = 0
  let seen = 0
  for (let i = t - w + 1; i <= t; i++) {
    const v = xs[i]
    if (v === null || v === undefined) {
      if (!allowPartial) return null
      continue
    }
    s += v
    seen++
  }
  return allowPartial && seen === 0 ? null : s
}

export function computeMetrics(raw: RawSeries, marketAmount: readonly Num[]): DayMetrics[] {
  const s5 = rollingMean(raw.share, 5)
  const s10 = rollingMean(raw.share, 10)
  const s20 = rollingMean(raw.share, 20)
  const a20 = rollingMean(raw.amount, 20)
  const m20 = rollingMean(marketAmount, 20)
  const out: DayMetrics[] = []
  let pool = 0
  let persist = 0
  let maxPersist = 0
  const poolHist: number[] = []
  const poolSorted: number[] = []
  const ret20Sorted: number[] = []
  const s5Sorted: number[] = []

  const n = raw.share.length
  for (let t = 0; t < n; t++) {
    const add5 = s5[t]
    if (add5 !== null && add5 !== undefined) sortedInsert(s5Sorted, add5)
    const drop5 = t - T.baselineWindow >= 0 ? s5[t - T.baselineWindow] : null
    if (drop5 !== null && drop5 !== undefined) sortedRemove(s5Sorted, drop5)
    const hist = s5Sorted
    const basis: BaselineBasis = hist.length >= T.baselineWindow ? 'FULL'
      : hist.length >= T.baselineMinWindow ? 'SHORT' : 'INSUFFICIENT'
    const ok = basis !== 'INSUFFICIENT'
    const median = ok ? sortedQuantile(hist, 0.5) : null
    const q25 = ok ? sortedQuantile(hist, T.bandLow) : null
    const q75 = ok ? sortedQuantile(hist, T.bandHigh) : null
    const q95 = ok ? sortedQuantile(hist, T.burstQuantile) : null

    const cur5 = s5[t] ?? null
    const daily = raw.share[t] ?? null
    const mkt = marketAmount[t] ?? null
    if (median !== null && cur5 !== null && cur5 >= median) {
      persist++
      if (daily !== null && mkt !== null) pool = Math.max(0, pool + (daily - median) * mkt)
    } else {
      if (persist > maxPersist) maxPersist = persist
      persist = 0
      pool = 0
    }
    poolHist.push(pool)
    if (pool > 0) sortedInsert(poolSorted, pool)
    const dropPool = t - T.divergencePoolHistoryDays >= 0 ? poolHist[t - T.divergencePoolHistoryDays]! : 0
    if (dropPool > 0) sortedRemove(poolSorted, dropPool)

    const close = raw.close[t] ?? null
    const c20 = t >= 20 ? raw.close[t - 20] ?? null : null
    const c10 = t >= 10 ? raw.close[t - 10] ?? null : null
    const ret20 = close !== null && c20 !== null && c20 > 0 ? close / c20 - 1 : null
    const ret10 = close !== null && c10 !== null && c10 > 0 ? close / c10 - 1 : null
    const cur10 = s10[t] ?? null

    const highs = trailing(raw.close, t, T.divergenceHighWindow).filter((v): v is number => v !== null)
    const high60 = highs.length ? Math.max(...highs) : null

    // 融资余额 T+1 发布：当日未发布时，用最近 2 个交易日内已发布的那一天做方向判断
    const m = raw.margin[t] ?? null
    let mj = t
    while (mj > t - 3 && mj >= 0 && (raw.margin[mj] ?? null) === null) mj--
    const mLast = mj > t - 3 && mj >= 0 ? raw.margin[mj] ?? null : null
    const m10 = mLast !== null && mj >= T.a2WindowDays ? raw.margin[mj - T.a2WindowDays] ?? null : null
    const marginDelta10 = mLast !== null && m10 !== null ? mLast - m10 : null
    const etfNet10 = sumWindow(raw.etfFlow, t, T.a2WindowDays, false)
    const instNet10 = sumWindow(raw.instNet, t, T.a2WindowDays, true)

    const a2Known = [marginDelta10, etfNet10].filter((v): v is number => v !== null)
    const a2Inflow = a2Known.length ? a2Known.some(v => v > 0) : null
    const a2Outflow = a2Known.length ? a2Known.some(v => v < 0) : null

    const mkt20 = m20[t] ?? null
    out.push({
      s5: cur5, s10: cur10, s20: s20[t] ?? null,
      median, q25, q75, q95, basis,
      pool, persist, maxPersistBefore: maxPersist,
      amount20: a20[t] ?? null,
      baseLevel20: median !== null && mkt20 !== null ? median * mkt20 : null,
      ret10,
      poolQ90: sortedQuantile(poolSorted, T.divergencePoolQuantile),
      close, ret20,
      ret20Q90: sortedQuantile(ret20Sorted, T.burstReturnQuantile),
      high60,
      margin: m, marginDelta10, etfNet10, instNet10,
      a2Inflow, a2Outflow,
      anomaly: raw.anomaly[t] ?? false,
    })
    if (ret20 !== null) sortedInsert(ret20Sorted, ret20)
  }
  return out
}

/** 最近 k 日是否全部满足（遇到 null 视为不满足） */
export function lastKDays(ms: readonly DayMetrics[], t: number, k: number, pred: (m: DayMetrics, i: number) => boolean | null): boolean {
  if (t - k + 1 < 0) return false
  for (let i = t - k + 1; i <= t; i++) {
    if (pred(ms[i]!, i) !== true) return false
  }
  return true
}
