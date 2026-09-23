/**
 * 资金驾驶舱（R-01）· 类型层
 *
 * 这一层只描述"资金数据长什么样"。它不 import 任何能产生动作的东西，
 * 证据等级恒为 OBSERVATION —— 资金规则通过样本外检验并由委员会冻结之前，
 * 它拿到的只是复核优先级。
 *
 * 两条贯穿全模块的纪律写在类型里：
 *   ① 缺失是 null，不是 0。成交额缺一天就当那天不可比，而不是当那天没人交易。
 *   ② 没有 C 级。主力 / 大单净流入是软件按单笔金额分档估算出来的，
 *      DataKind 里根本没有它的位置 —— 想接进来，得先改这个类型。
 */

/** 数据可信度分级。刻意没有 'C'：估算数据不进入本模块。 */
export type DataGrade = 'A1' | 'A2' | 'B1' | 'B2'

export const DATA_GRADE_TEXT: Record<DataGrade, string> = {
  A1: '真实流量·无方向（成交额）',
  A2: '真实存量·有方向（融资余额、ETF 份额），T+1 发布',
  B1: '真实披露·只覆盖局部（龙虎榜、大宗交易、北向成交额）',
  B2: '真实披露·季度（基金持仓、ETF 持有人）',
}

/** 本模块需要的数据种类。每一种都能追溯到交易所或登记托管机构的记账。 */
export type DataKind =
  | 'STOCK_AMOUNT'        // 个股日成交额（元）与收盘价
  | 'MARKET_AMOUNT'       // 全市场日成交额
  | 'SW_INDUSTRY'         // 申万 2021 行业成分（含纳入 / 剔除日期）
  | 'MARGIN'              // 个股与全市场融资余额
  | 'ETF_SHARE'           // ETF 每日份额
  | 'TOP_INST'            // 龙虎榜机构席位买卖
  | 'BLOCK_TRADE'         // 大宗交易
  | 'NORTHBOUND_TURNOVER' // 北向每日成交总额（无方向）
  | 'ETF_HOLDERS'         // ETF 季报持有人（核对国家队份额）

export const DATA_KIND_GRADE: Record<DataKind, DataGrade> = {
  STOCK_AMOUNT: 'A1',
  MARKET_AMOUNT: 'A1',
  SW_INDUSTRY: 'A1',
  MARGIN: 'A2',
  ETF_SHARE: 'A2',
  TOP_INST: 'B1',
  BLOCK_TRADE: 'B1',
  NORTHBOUND_TURNOVER: 'B1',
  ETF_HOLDERS: 'B2',
}

/** 数据可得状态。PENDING 专指"按发布时间还没到"（例如 T 日 16:30 时的两融） */
export type Availability = 'OK' | 'PENDING' | 'MISSING'

export interface StockDay {
  date: string
  code: string
  close: number | null
  /** 成交额（元）。null = 缺失，不是 0 */
  amount: number | null
  /** 融资余额（元）。null = 缺失或未发布 */
  marginBalance: number | null
}

export interface EtfDay {
  date: string
  code: string
  /** 份额（份）。null = 缺失或未发布 */
  share: number | null
  close: number | null
}

export interface InstDay {
  date: string
  code: string
  /** 龙虎榜机构席位净买入（元）。只在上榜日有值；未上榜 = null，表示"没观察到"，不是 0 */
  netBuy: number | null
}

export interface MarketDay {
  date: string
  /** 全市场成交额（元） */
  totalAmount: number | null
  /** 全市场融资余额（元） */
  marginTotal: number | null
  /** 异常日：指数调仓、季末、ETF 集中申赎。状态机在这些日子不跃迁 */
  anomaly?: boolean
}

export type ObjectKind = 'MARKET' | 'INDUSTRY' | 'BASKET' | 'STOCK'

/** 三个资金入口。null = 背景层（全市场、国家队） */
export type EntryNo = 1 | 2 | 3

export const ENTRY_TEXT: Record<EntryNo, string> = {
  1: '入口① 持仓主线',
  2: '入口② 观察仓主线',
  3: '入口③ 市场自选方向',
}

export interface MoneyObject {
  id: string
  name: string
  kind: ObjectKind
  entry: EntryNo | null
  /** 成分股代码。个股对象只有自己一只 */
  codes: string[]
  /** 与该对象相关的主题 ETF（用于 A2 方向性确认）。没有就是空数组 */
  themeEtfs: string[]
}

/** 一次完整的数据装载。日期升序，所有序列按 dates 对齐 */
export interface DataSet {
  dates: string[]
  market: MarketDay[]
  stocks: Record<string, StockDay[]>
  etfs: Record<string, EtfDay[]>
  inst: Record<string, InstDay[]>
  /** 每一类数据来自哪个数据源、截至何时 */
  provenance: { kind: DataKind; source: string; asOf: string; status: Availability }[]
}
