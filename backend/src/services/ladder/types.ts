/**
 * 名单治理（L-01）· 类型层
 *
 * 委员会 2026-10-16 裁定：研究资格、买入资格、持仓资格是三种不同的权限。
 * 观察信号再强，也不能越级变成买入信号。
 *
 * 六级梯子：每只股票只有一个当前层级，可以有多个来源标签。
 * 层级由各级条件逐级计算，不能由任何一份名单直接指定。
 */

export type LadderLevel = 1 | 2 | 3 | 4 | 5 | 6

export const LEVEL_NAME: Record<LadderLevel, string> = {
  1: '全市场',
  2: '研究池',
  3: '观察池',
  4: '备选池',
  5: '可申请建仓',
  6: '持仓',
}

/** 每一级的权限。只有第 5 级能「申请」，且申请不代表批准；第 6 级按执行单管理 */
export const LEVEL_PERMISSION: Record<LadderLevel, string> = {
  1: '仅扫描',
  2: '可建产业档案，不可买',
  3: '观察、研究',
  4: '进入候选，不可直接买',
  5: '只能申请，不代表批准',
  6: '按执行单管理',
}

/** 买入权限：除第 5 级的「只能申请」外，一律为无 */
export type BuyPermission = 'NONE' | 'APPLY_ONLY' | 'EXECUTION_CARD'

/** 战略归属：取自 msr/universe.ts 与 CTC 冻结令，名单来源不能改变它 */
export type StrategyScope =
  | 'COMBAT'          // 作战主线成员
  | 'RESEARCH_ONLY'   // 只研究、仓位为零的主线（AI 电力）
  | 'OUT_OF_UNIVERSE' // 未进入 MSR 股票池：没有产业档案，也不在作战主线的节点下

export const SCOPE_TEXT: Record<StrategyScope, string> = {
  COMBAT: '作战主线',
  RESEARCH_ONLY: '只研究，仓位为零',
  OUT_OF_UNIVERSE: '未进股票池（无产业档案）',
}

/** 名单来源。committee = 委员会点名；只能触发研究，不能指定买入资格 */
export type SourceId =
  | 'HOLDING'        // 账本持仓
  | 'MSR_UNIVERSE'   // MSR 股票池
  | 'R01_WATCH'      // 资金哨兵入口② 起始 7 只
  | 'R01_RADAR'      // 资金哨兵入口② 左侧雷达
  | 'R02_PRESELECT'  // R-02 第一批
  | 'R02_NEXT'       // R-02 第二批
  | 'MAP_V1'         // 全景图观察名单初稿（总纲第三章）

export interface SourceTag {
  source: SourceId
  /** 来源内的分组，如左侧雷达方向、R-02 分组、全景图赛道 */
  group: string | null
  /** 该来源的确认日期 */
  since: string
  by: '账本' | '委员会' | '研究档案' | '总纲初稿'
}

/** 观察目的。不同目的有不同的复核周期 */
export type ObservePurpose = 'MONEY' | 'EARNINGS' | 'INDUSTRY'

export const PURPOSE_TEXT: Record<ObservePurpose, string> = {
  MONEY: '资金异动观察',
  EARNINGS: '盈利验证观察',
  INDUSTRY: '产业验证观察',
}

export interface ObservePlan {
  purpose: ObservePurpose
  /** 由哪个来源提供这份计划 */
  source: SourceId
  /** 监测指标 */
  metrics: string
  /** 复核期限（含当日） */
  reviewBy: string
  /** 期限如何算 */
  periodRule: string
  /** 退出条件 */
  exitWhen: string
}

/** 一道条件的检查结果。每道单独列出，不合并成「研究通过」 */
export interface GateCheck {
  id: string
  label: string
  pass: boolean | null
  detail: string
}

export interface LadderEntry {
  code: string
  name: string
  level: LadderLevel
  sources: SourceTag[]
  scope: StrategyScope
  mainline: string | null
  node: string | null
  evidence: string | null
  champion: boolean
  retiredC: boolean
  /** 研究问题（第 2 级进入条件） */
  researchQuestion: string | null
  /** 观察计划（第 3 级进入条件）；可能有多份，取最早到期的复核 */
  plans: ObservePlan[]
  /** 第 4 级的三道条件，以及第 5 级的闸门 */
  gates: GateCheck[]
  /** 停在当前层级的原因（向上一级差什么） */
  ceiling: string
  /** 进入当前层级的原因 */
  entryReason: string
  /** 退出当前层级的条件 */
  exitCondition: string
  /** 最近一次复核期限；null = 不需要定期复核 */
  reviewBy: string | null
  /** 复核期限已过、尚未作出续留 / 升级 / 降级 / 移出决定 */
  reviewOverdue: boolean
  buyPermission: BuyPermission
  /** 权限锁（如左侧雷达只观察）；可以有多把 */
  locks: string[]
  /** 违规或不一致提示，只提示、不出动作 */
  flags: string[]
}

/** 账户层的买入权限状态。任何一项关闭，第 5 级就为空 */
export interface BuyPermissionState {
  open: boolean
  reasons: string[]
}

export interface LadderView {
  id: 'L-01'
  asOf: string
  generatedAt: string
  entries: LadderEntry[]
  buyPermission: BuyPermissionState
  counts: Record<LadderLevel, number>
  /** 全市场只计数，不逐只列出 */
  marketCount: number | null
  notes: string[]
}
