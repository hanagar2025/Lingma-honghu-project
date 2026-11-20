import type { CircuitCalc } from './rules'

export interface DecisionHolding {
  code: string
  name: string
  quantity: number
  /** 主数据源（腾讯日 K）最新收盘价；取不到为 null */
  close: number | null
  barDate: string | null
}

export interface DecisionSnapshot {
  date: string
  /** 券商账户内合计 = cash + positionsValue */
  brokerTotal: number
  cash: number
  positionsValue: number
  externalCash: number
  /** 组合总资产 = positionsValue + cash + externalCash。所有仓位上限的分母 */
  portfolioTotal: number
  peakAssets: number
  peakBasis: 'BROKER' | 'PORTFOLIO'
  peakVerified: boolean
}

/** 法定动作。reason 只有 POSITION_LIMIT（单票超限）与 CIRCUIT_BREAKER（熔断降仓）两种会被执行单读取 */
export interface DecisionAction {
  code: string
  name: string
  kind: string
  reason: string
  /** 单票超限为股数，熔断降仓为金额；缺价格时为 null */
  size: { value: number | null }
}

/** 执行单的全部输入。执行单不得再自行计算仓位或回撤 */
export interface DecisionInput {
  date: string
  ledgerAsOf: string | null
  account: { stale: boolean; staleDays: number | null; gaps: string[] }
  snapshot: DecisionSnapshot
  circuit: CircuitCalc
  holdings: DecisionHolding[]
  priceFailed: string[]
  actions: DecisionAction[]
  noNewEntry: { verdict: boolean; reasons: string[] }
  dataGaps: string[]
  /** 不在四条主线内的持仓。只提示，不产生指令 */
  outsideMainline?: { code: string; name: string }[]
}

export interface PriceCheck {
  code: string
  name: string
  primary: number | null
  secondary: number | null
  ok: boolean
  note: string
}

export interface Verification {
  ok: boolean
  /** 新浪上证指数的行情日期，用于判断今天是否开市；取不到为 null */
  marketDate: string | null
  checks: PriceCheck[]
  problems: string[]
}

/** INTRADAY = 交易时段内按实时价复核，市值不是收盘基准 */
export type DecisionSession = 'PRE_OPEN' | 'INTRADAY' | 'POST_CLOSE'
