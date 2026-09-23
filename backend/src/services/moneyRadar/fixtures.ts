/**
 * 资金驾驶舱（R-01）· 合成数据
 *
 * 只用于自检和示意渲染。生成的 DataSet 永远以 FIXTURE 模式进入视图，
 * 渲染时会写明"合成数据（示意，非真实行情）"。
 */

import type { DataSet, EtfDay, InstDay, MarketDay, StockDay } from './types'
import type { DayMetrics } from './metrics'

export const SYNTH_MARKET_TOTAL = 1e12

export function tradingDates(n: number, start = '2023-01-02'): string[] {
  const out: string[] = []
  const d = new Date(`${start}T00:00:00Z`)
  while (out.length < n) {
    const wd = d.getUTCDay()
    if (wd !== 0 && wd !== 6) out.push(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return out
}

export interface SynthStock {
  code: string
  /** 当日成交额占全市场比例；返回 null 表示当日缺失 */
  share: (t: number) => number | null
  price: (t: number) => number
  margin?: (t: number) => number | null
  inst?: (t: number) => number | null
}

export interface SynthEtf {
  code: string
  share: (t: number) => number | null
  close: (t: number) => number
}

export function synthDataSet(
  n: number,
  stocks: readonly SynthStock[],
  etfs: readonly SynthEtf[] = [],
  anomaly: (t: number) => boolean = () => false,
): DataSet {
  const dates = tradingDates(n)
  const market: MarketDay[] = dates.map((date, t) => ({
    date, totalAmount: SYNTH_MARKET_TOTAL, marginTotal: null, anomaly: anomaly(t),
  }))
  const s: Record<string, StockDay[]> = {}
  const inst: Record<string, InstDay[]> = {}
  for (const st of stocks) {
    s[st.code] = dates.map((date, t) => {
      const sh = st.share(t)
      return {
        date, code: st.code, close: st.price(t),
        amount: sh === null ? null : sh * SYNTH_MARKET_TOTAL,
        marginBalance: st.margin ? st.margin(t) : null,
      }
    })
    if (st.inst) inst[st.code] = dates.map((date, t) => ({ date, code: st.code, netBuy: st.inst!(t) }))
  }
  const e: Record<string, EtfDay[]> = {}
  for (const et of etfs) {
    e[et.code] = dates.map((date, t) => ({ date, code: et.code, share: et.share(t), close: et.close(t) }))
  }
  return {
    dates, market, stocks: s, etfs: e, inst,
    provenance: [{ kind: 'STOCK_AMOUNT', source: 'FIXTURE', asOf: dates.at(-1) ?? '', status: 'OK' }],
  }
}

/** 确定性的小幅扰动，避免自检依赖随机数 */
export const wobble = (t: number, amp: number) => amp * Math.sin(t * 1.7) * Math.cos(t * 0.31)

/** 手工构造一天的指标，用于逐条验证状态机与背离判定 */
export function dm(p: Partial<DayMetrics> = {}): DayMetrics {
  return {
    s5: 0.01, s10: 0.01, s20: 0.01,
    median: 0.01, q25: 0.009, q75: 0.011, q95: 0.015, basis: 'FULL',
    pool: 0, persist: 0, maxPersistBefore: 0, poolQ90: null,
    close: 100, ret20: 0, ret20Q90: 0.2,
    pr10: null, pr10Mean60: null, high60: 100,
    margin: null, marginDelta10: null, etfNet10: null, instNet10: null,
    a2Inflow: null, a2Outflow: null, anomaly: false,
    ...p,
  }
}
