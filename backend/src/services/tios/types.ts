// TIOS 领域类型定义 —— 与《交易操作系统V1.0》《主线龙头体系V2.0》条款一一对应

export interface DailyBar {
  date: string // YYYY-MM-DD
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface Position {
  code: string
  name: string
  /** 板块（申万一级口径，用于板块30%上限） */
  sector: string
  /** 主题（如 "AI"，用于主题45%上限） */
  theme: string
  cost: number
  marketValue: number
}

export interface AccountSnapshot {
  date: string
  totalAssets: number
  cash: number
  positionsValue: number
  /** 历史最高净值，用于组合熔断判定 */
  peakAssets: number
}

export interface RuleCard {
  code: string
  /** 硬止损阈值（自成本回撤比例），默认 0.25 */
  hardStopPct: number
  /** 单日熔断阈值（当日跌幅），默认 0.12 */
  crashPct: number
  /** 是否处于禁买名单（如澜起调查期） */
  banBuy: boolean
  banReason?: string
  /** 历史已触发但尚未执行的熔断次数（补执行位） */
  pendingCrashExecutions: number
}

export type MarketStage = 'uptrend' | 'range' | 'downtrend'

export interface StageResult {
  /** 当日按标准计算出的候选阶段 */
  candidate: MarketStage
  /** 连续2日确认后的正式阶段 */
  confirmed: MarketStage
  /** 阶段对应的总仓位上限 */
  positionCap: number
  detail: string
}

export type TriggerAction =
  | 'EXIT_ALL' // 全部退出
  | 'REDUCE_TO_40' // 减至原仓位40%以下
  | 'REDUCE_30' // 减30%
  | 'REDUCE_20' // 减20%
  | 'NONE'

export interface TriggerEvent {
  code: string
  name: string
  /** 条款编号，如 "V1.0-2.1-硬止损" */
  clause: string
  action: TriggerAction
  detail: string
}

export type FreezeReason =
  | 'STAGE_DOWNTREND' // 下跌期冻结
  | 'STOCK_CAP_12' // 单股超12%
  | 'SECTOR_CAP_30' // 板块超30%
  | 'THEME_CAP_45' // 主题超45%
  | 'CASH_FLOOR_10' // 现金低于10%
  | 'BAN_LIST' // 禁买名单
  | 'SELLING_IN_PROGRESS' // 卖出条款执行中
  | 'NO_STOP_FALL' // 止跌三要素未达成
  | 'RR_TOO_LOW' // 赔率不足

export interface BuyGateResult {
  code: string
  allowed: boolean
  freezeReasons: FreezeReason[]
  detail: string
}

export interface PortfolioCircuitResult {
  drawdownPct: number
  /** 触发的仓位上限（1 表示无约束） */
  positionCap: number
  sellOnly: boolean
  detail: string
}

export interface DailyReport {
  date: string
  stage: StageResult
  portfolioCircuit: PortfolioCircuitResult
  /** 问1：触发买入 */
  buys: BuyGateResult[]
  /** 问2：触发减仓/卖出 */
  sells: TriggerEvent[]
  /** 问3：保持持有 */
  holds: string[]
  /** 问4：禁止操作 */
  banned: { code: string; reasons: FreezeReason[] }[]
  conclusion: string
}
