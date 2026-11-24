/**
 * AI 主线全链的逐日数据。全部是公开行情，按日期累积在私有目录 <DATA_DIR>/chain/ 里，不进仓库。
 * 金额单位：元。对外的汇总只写百分比和指数。
 */

export interface BarRow {
  date: string
  open: number
  /** 前复权收盘价。最新一根与不复权价相同 */
  close: number
  high: number
  low: number
  /** 成交额 */
  amount: number
  /** 当日涨跌幅，小数（0.0312 = +3.12%） */
  pct: number
}

/** 主力净流入（东方财富口径：超大单加大单的净额） */
export interface FlowRow { date: string; main: number }

export interface MarginRow {
  date: string
  /** 融资余额 */
  balance: number
  /** 融资买入额 */
  buy: number
  /** 融资偿还额 */
  repay: number
}

export interface Revision {
  /** 北京时间 YYYY-MM-DD HH:mm:ss */
  at: string
  kind: 'bars' | 'flow' | 'margin'
  date: string
  from: number
  to: number
}

export interface StockSeries {
  code: string
  name: string
  /** 旧的在前 */
  bars: BarRow[]
  flow: FlowRow[]
  margin: MarginRow[]
  /** 同一天重拉时数值变了，旧值记在这里 */
  revisions: Revision[]
  updatedAt: string
}

export interface MarketFile {
  /** 全市场融资余额，旧的在前 */
  margin: MarginRow[]
  updatedAt: string
}

export interface Earning {
  /** 报告期，如 2026-09-30 */
  report: string
  notice: string
  /** 营收同比、归母净利同比，小数；源头没有时为 null */
  revYoy: number | null
  npYoy: number | null
}

export interface Forecast {
  report: string
  notice: string
  /** 预告指标名，如「归属于上市公司股东的净利润」 */
  item: string
  /** 预告净利同比的下限与上限，小数 */
  lower: number | null
  upper: number | null
}

export interface EarningsFile {
  earnings: Record<string, Earning>
  forecasts: Record<string, Forecast>
  updatedAt: string
}

export interface Quote {
  price: number
  /** 当日涨跌幅，小数 */
  pct: number
  amount: number
  /** 当日主力净流入；取不到为 null */
  main: number | null
}

export interface IntradaySnapshot {
  /** 北京时间 YYYY-MM-DD HH:mm:ss，取数时刻 */
  at: string
  /** 行情源自己报的时刻；取不到为 null */
  sourceAt: string | null
  quotes: Record<string, Quote>
  failed: string[]
}

/** 每次拉数留一行 */
export interface RunRecord {
  task: string
  at: string
  /** 这次拉到的最新数据日 */
  asOf: string | null
  ok: number
  failed: string[]
  notes: string[]
}

/** 策略方登记的供应、监管冲击。登记后该股证据分扣 1 分 */
export interface ShockFlag {
  code: string
  name: string
  reason: string
  /** 出处：文档或公告 */
  source: string
  since: string
  /** 解除日；未解除为 null */
  until: string | null
}

export type LineLevel = number | 'ma20' | 'ma60' | 'low60'

/** 盯的线。全部由策略方登记，页面只读 */
export interface WatchLine {
  id: string
  code: string
  name: string
  /** close = 只在收盘时判定；price = 盘中现价越线就算 */
  basis: 'close' | 'price'
  op: 'below' | 'above'
  /** 固定价位，或 20 日线、60 日线、60 日最低收盘价 */
  level: LineLevel
  /** 附加条件：当天主力净流出、5 日融资变化为负 */
  and: 'main_out' | 'margin_down' | null
  /** 规则原文写的动作 */
  action: string
  source: string
  /**
   * 这条线成立后要卖多少：全部、一半、三分之一。只有收盘判定的线能带。
   * 带了，成立后执行单生成一条卖出指令；不带，越线只是读数。
   */
  sell?: 'ALL' | 'HALF' | 'THIRD'
}

export interface BaseFile {
  /** 净值基准（指数 100 对应的总资产）。只存服务器，任何接口都不返回 */
  totalAssets: number
  /** 基准时点，如 2026-11-24 09:37 */
  at: string
  /** 基准以来到过的最高指数。停手线只上移，要用它 */
  highIndex: number
  setAt: string
}
