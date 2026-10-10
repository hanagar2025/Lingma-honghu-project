import type { CircuitCalc } from '../cockpit/safety'
import type { Action } from '../cockpit/types'
import type { AccountSnapshot } from '../tios/types'

export interface DecisionHolding {
  code: string
  name: string
  quantity: number
  /** 主数据源（腾讯日 K）最新收盘价；取不到为 null */
  close: number | null
  barDate: string | null
}

/** 驾驶舱一次运行导出给每日执行单的全部输入。执行单不得再自行计算仓位或回撤 */
export interface DecisionInput {
  date: string
  ledgerAsOf: string | null
  account: { stale: boolean; staleDays: number | null; gaps: string[] }
  snapshot: AccountSnapshot
  circuit: CircuitCalc
  holdings: DecisionHolding[]
  priceFailed: string[]
  actions: Action[]
  noNewEntry: { verdict: boolean; reasons: string[] }
  dataGaps: string[]
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

export type DecisionSession = 'PRE_OPEN' | 'POST_CLOSE'
