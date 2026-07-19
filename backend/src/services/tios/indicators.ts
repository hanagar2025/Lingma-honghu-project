// 基础指标计算 —— 纯函数，无外部依赖

import type { DailyBar } from './types'

/** 简单移动平均：取最近 n 根K线收盘价均值；数据不足返回 null */
export function sma(bars: DailyBar[], n: number, endIndex?: number): number | null {
  const end = endIndex ?? bars.length - 1
  if (end + 1 < n) return null
  let sum = 0
  for (let i = end - n + 1; i <= end; i++) sum += bars[i].close
  return sum / n
}

/** 当日涨跌幅（相对前一交易日收盘） */
export function dayChangePct(bars: DailyBar[], index?: number): number | null {
  const i = index ?? bars.length - 1
  if (i < 1) return null
  return bars[i].close / bars[i - 1].close - 1
}

/** 均线斜率方向：当前均线值与 k 日前均线值比较 */
export function maRising(bars: DailyBar[], n: number, k = 3): boolean | null {
  const now = sma(bars, n)
  const before = sma(bars, n, bars.length - 1 - k)
  if (now === null || before === null) return null
  return now > before
}

/** 连续收于 n 日均线下方的天数（从最新一天往回数） */
export function consecutiveDaysBelowMA(bars: DailyBar[], n: number): number {
  let count = 0
  for (let i = bars.length - 1; i >= n - 1; i--) {
    const ma = sma(bars, n, i)
    if (ma === null) break
    if (bars[i].close < ma) count++
    else break
  }
  return count
}

/** 缩量判断：最近 days 日成交量均低于5日均量的 ratio 倍 */
export function volumeShrinking(bars: DailyBar[], days = 2, ratio = 0.7): boolean {
  if (bars.length < 5 + days) return false
  for (let i = bars.length - 1; i > bars.length - 1 - days; i--) {
    let avg5 = 0
    for (let j = i - 5; j < i; j++) avg5 += bars[j].volume
    avg5 /= 5
    if (bars[i].volume >= avg5 * ratio) return false
  }
  return true
}

/** 近 n 日未创调整新低（最新收盘价高于此前 n 日最低收盘价） */
export function noNewLow(bars: DailyBar[], n = 3): boolean {
  if (bars.length < n + 1) return false
  const latest = bars[bars.length - 1].close
  let minPrev = Infinity
  for (let i = bars.length - 1 - n; i < bars.length - 1; i++) {
    minPrev = Math.min(minPrev, bars[i].close)
  }
  return latest > minPrev
}
