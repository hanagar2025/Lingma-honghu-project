import type { BackupMode, Instruction } from './book'
import type { LinesCalc } from './rules'

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
  /** 总资产 = positionsValue + cash + externalCash。所有占比的分母 */
  portfolioTotal: number
}

/** 一只持仓的证据分读数 */
export interface EvidenceRow {
  code: string
  name: string
  segment: string
  /** 占总资产，小数 */
  weight: number
  /** 没有读数时以下各项为 null */
  c: number | null
  cUnknown: number
  cUnknownWhy: string[]
  t: number | null
  deduction: number | null
  deductionWhy: string | null
  e: number | null
  /** 融资比日线晚一天：资金分是初算 */
  provisional: boolean
  /** 证据分对应的加仓上限，小数；E≤3 为 0 */
  addCap: number
  /** 卖出条件核对的结果，一句话 */
  sellNote: string
}

/** 一条买入指令过规则之后的结果 */
export interface BuyGate {
  id: string
  /** 可以买的股数；被挡住为 0 */
  shares: number
  /** 算股数用的参考价 */
  refPrice: number | null
  /** 被哪条规则挡住；null = 没被挡 */
  blocked: string | null
  /** 实际放行到占总资产多少（目标与各上限里最小的那个） */
  allowedWeight: number
  /** 写在清单上的附带条件与说明 */
  notes: string[]
}

/** 《半年计划》各条规则在今天的读数。只在链上数据接入、且价格核对通过时才有 */
export interface PlanFacts {
  /** 证据分截至哪个收盘日 */
  asOf: string | null
  marginAsOf: string | null
  /** 指令簿是否按今天的数据核对过。价格核对没通过时只把原有指令列出来 */
  synced: boolean
  rows: EvidenceRow[]
  /** 相关环节（光模块加 PCB）合计占比 */
  relatedWeight: number
  /** 未结束的指令 */
  instructions: Instruction[]
  /** 每条未结束指令已顺延了几个交易日（触发日之后已收盘的交易日数） */
  rolled: Record<string, number>
  buys: BuyGate[]
  events: string[]
  notices: string[]
  backup: BackupMode | null
}

/** 执行单的全部输入。执行单只排版，不再自行判定 */
export interface DecisionInput {
  date: string
  ledgerAsOf: string | null
  account: { stale: boolean; staleDays: number | null; gaps: string[] }
  snapshot: DecisionSnapshot
  holdings: DecisionHolding[]
  priceFailed: string[]
  dataGaps: string[]
  /** 净值指数与三条线 */
  lines: LinesCalc & { baseAt: string | null }
  /** null = 链上数据没有接入（命令行单独运行时），卖出条件核对不了 */
  plan: PlanFacts | null
  /** 不在 AI 全链名单内的持仓。只提示 */
  outsideChain: { code: string; name: string }[]
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
