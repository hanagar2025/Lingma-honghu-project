/**
 * 委员会通过输入框交来的东西，只有四种：
 *   持仓（账户此刻是什么样）、成交（买了或卖了什么）、意向（下单前的一行字）、留言。
 * 文字按固定句式解析；图片由识别方读出同样的结构，再由委员会本人确认。
 */

export type IntakeKind = 'HOLDINGS' | 'TRADE' | 'INTENT' | 'NOTE'

export interface SnapshotPosition {
  code: string
  name: string
  quantity: number
  /** 截图上的现价。文字输入时没有 */
  price?: number
  /** 截图上的市值。文字输入时没有 */
  marketValue?: number
  cost?: number
}

export interface HoldingsSnapshot {
  /** 截图或输入对应的日期 YYYY-MM-DD */
  asOf: string
  cash: number
  totalAssets?: number
  totalMarketValue?: number
  positions: SnapshotPosition[]
}

export interface TradeRecord {
  date: string
  side: 'BUY' | 'SELL'
  code: string
  name: string
  quantity: number
  /** 成交均价。没写时为空，等成交截图补上 */
  price: number | null
}

export interface Intent {
  side: 'BUY' | 'SELL'
  code: string
  name: string
  /** 没写股数时为空 */
  quantity: number | null
  reason: string
}

export type Parsed =
  | { kind: 'HOLDINGS'; holdings: HoldingsSnapshot }
  | { kind: 'TRADE'; trades: TradeRecord[] }
  | { kind: 'INTENT'; intent: Intent }
  | { kind: 'NOTE' }

export interface Check {
  name: string
  /** null = 没有条件核对（例如文字持仓没有金额），不算通过也不算失败 */
  ok: boolean | null
  detail: string
}

/**
 * RECORDED        已记录（文字输入，本人所写，直接生效）
 * PENDING_PARSE   图片已收到，等待识别
 * PENDING_CONFIRM 已识别，等委员会本人确认
 * NEEDS_FIX       内容自相矛盾，没有生效，需要重发
 * CONFIRMED       已确认并生效
 * REJECTED        已撤销或识别结果被否决
 */
export type SubmissionStatus = 'RECORDED' | 'PENDING_PARSE' | 'PENDING_CONFIRM' | 'NEEDS_FIX' | 'CONFIRMED' | 'REJECTED'

export interface Submission {
  id: string
  /** 服务器收到的时刻，北京时间 YYYY-MM-DD HH:mm:ss。意向登记以它为准 */
  receivedAt: string
  source: 'TEXT' | 'IMAGE'
  text?: string
  imageFile?: string
  status: SubmissionStatus
  parsed?: Parsed
  parsedBy?: 'RULE' | 'AGENT'
  checks?: Check[]
  /** 给提交人看的一句话：系统把这条理解成了什么 */
  summary?: string
  /** 意向登记时对照现行规则的结论 */
  verdict?: string
  settledAt?: string
}
