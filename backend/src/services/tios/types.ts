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

/**
 * 账户与组合快照。
 *
 * ── 委员会 2026-08-15 口径裁定：三个仓位分母必须分开 ──
 *
 * 此前只有一个 `totalAssets`（券商账户内的现金 + 持仓），单票 12% 上限也用它做分母。
 * 后果是一个不符合经济实质的风控：同一笔钱放在券商账户外，系统认为股票风险变大；
 * 转进券商账户，系统认为风险变小。而钱的用途没有变。
 *
 * 裁定后：
 *   · `brokerTotal`    券商账户内合计 —— 只回答"账户里还有多少现金可以直接下单"
 *   · `portfolioTotal` 正式股票投资组合 = 持仓 + 账内现金 + 专用于股票的账户外现金
 *                      —— 单票上限、板块上限、主题上限、现金比例都用它
 *
 * 两者不可混用。混用过一次的代价：8/14 系统报出"海光超限 6.6pct、新易盛超限 2.9pct"，
 * 而按正确分母海光只超 1.1pct、新易盛根本不超限。
 */
export interface AccountSnapshot {
  date: string
  /**
   * 券商账户内合计 = cash + positionsValue。**仅用于账户内操作口径。**
   *
   * 原名 totalAssets，2026-08-15 改名。改名不是整理代码 ——
   * 旧名字不说明它是哪个分母，于是被当成"总资产"用在了熔断上：
   * 显示层已迁到组合口径（回撤 15.2%、上限 50%），
   * 而动作层仍用 totalAssets 算出回撤 46.9%、上限 30%、需减 175.7 万。
   * 两层各说各话且互不报错。叫 brokerTotal 之后，
   * 任何把它当上限分母的写法在阅读时就是显式错误。
   */
  brokerTotal: number
  /** 券商账户内现金 */
  cash: number
  positionsValue: number
  /**
   * 专用于股票投资的账户外现金储备。
   * 委员会已裁定：它计入组合分母，但**不计入家庭安全垫** ——
   * 委员会明确它"不是家庭日常生活资产"，故按其自身定义排除。
   */
  externalCash: number
  /** 正式股票投资组合总资产 = positionsValue + cash + externalCash */
  portfolioTotal: number
  /**
   * 历史最高净值，用于组合熔断判定。
   *
   * **必须与 portfolioTotal 同口径。** 旧值 430 万记的是券商账户口径；
   * 换算到组合口径前，回撤不可比 —— 若直接沿用，新口径总资产 531 万
   * 会大于旧峰值 430 万，回撤算成 0，熔断静默失效。
   * 故用 `peakBasis` 标明它属于哪个口径，未换算时回撤输出"不可比"而非 0。
   */
  peakAssets: number
  /** 峰值所属口径。'BROKER' 表示尚未按组合口径重新认定 */
  peakBasis: 'BROKER' | 'PORTFOLIO'
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
  /** null = 峰值与当前值不同口径，回撤不可计算。**不得当成 0 处理。** */
  drawdownPct: number | null
  /** 触发的仓位上限（1 表示无约束；null = 回撤不可计算，故上限待定） */
  positionCap: number | null
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
