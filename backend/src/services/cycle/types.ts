/**
 * 研究层 · CY-01 AI 基建周期拐点监控 V1.0 · 类型层
 *
 * 委员会 2026-10-17 硬约束：
 *   - 监控只触发复核，不触发仓位动作。C0–C3 是产业周期状态，不是熔断等级，也不是卖出信号。
 *     现行卖出规则只有 C 级清退、单票归位、熔断三类；TPO 仍是诊断工具，MA60 仍在模拟层。
 *   - 总表是映射与证据汇总，不是平行研究模块：已有模块负责计算，这里只引用字段、标缺口、呈现证据与复核事项。
 *   - 每个产业节点独立判定，不加权、不合成总分。
 *   - 缺数据是独立的证据状态：既不解释为风险恶化，也不解释为风险解除。
 *   - 新闻事实与市场解读分栏，各带来源与日期；分析师观点不填进经营或供需字段。
 *   - 未经裁定的参数标「待裁定」，不生效。
 */

/** 五层，每层只回答一个问题 */
export type LayerId = 'L1' | 'L2' | 'L3' | 'L4' | 'L5'

export const LAYERS: Record<LayerId, { name: string; question: string }> = {
  L1: { name: '宏观与资金成本', question: '市场的估值地基是否正在变差？' },
  L2: { name: 'AI 总需求与资本开支', question: '云厂商还在花钱吗？花出去的钱能产生回报吗？' },
  L3: { name: '产业链供需与利润', question: '新增供给是否开始破坏价格和利润？' },
  L4: { name: '股价与市场结构', question: '资金是否正在先于业绩撤退？' },
  L5: { name: '组合风险与 TPO', question: '即使主线没死，组合是否仍需要降低风险？' },
}

/** 产业节点。各自独立判定 */
export type NodeId = 'OPTICAL' | 'PCB' | 'COMPUTE' | 'SEMI_EQUIP' | 'STORAGE' | 'POWER'

/** 两条线：价格预期线、经营兑现线；宏观与资本开支是背景，组合是另一层 */
export type EvidenceLine = 'PRICE' | 'OPERATING' | 'CONTEXT' | 'PORTFOLIO'

export const LINE_TEXT: Record<EvidenceLine, string> = {
  PRICE: '价格预期线',
  OPERATING: '经营兑现线',
  CONTEXT: '背景（宏观、资本开支、供需）',
  PORTFOLIO: '组合风险',
}

/**
 * 证据可得性。缺数据是独立状态，不参与任何方向推断。
 *   AVAILABLE    系统数据，在更新周期内
 *   STALE        系统数据，已超过更新周期（照样列出，标明距今天数）
 *   TRANSCRIBED  委员会转录或研究模块里的手填数字，没有接入数据源
 *   MISSING      没有数据（没有数据源，或数据源里该字段为空）
 */
export type Availability = 'AVAILABLE' | 'STALE' | 'TRANSCRIBED' | 'MISSING'

export const AVAILABILITY_TEXT: Record<Availability, string> = {
  AVAILABLE: '可用',
  STALE: '已过时',
  TRANSCRIBED: '转录（未接数据源）',
  MISSING: '缺数据',
}

/** 按数值符号的变化方向，只是事实描述；不是「恶化条件」，恶化条件须裁定 */
export type Change = 'UP' | 'DOWN' | 'FLAT'

export const CHANGE_TEXT: Record<Change, string> = { UP: '上升', DOWN: '下降', FLAT: '持平' }

/** 证据性质：系统量测、委员会核实的事实、市场解读，三者分栏 */
export type EvidenceKind = 'MEASURED' | 'TRANSCRIBED' | 'FACT' | 'INTERPRETATION'

export interface SourceRef {
  /** 现有模块编号，如 R-02、R-01、L-01、M-01 */
  module: string
  /** 文件路径（相对仓库根）或源码文件 */
  path: string
  /** 字段路径 */
  field: string
}

export interface Evidence {
  /** 指标编号:对象，如 L3-04:300308 */
  id: string
  indicator: string
  layer: LayerId
  line: EvidenceLine
  node: NodeId | null
  code: string | null
  name: string | null
  kind: EvidenceKind
  value: number | string | null
  display: string
  /** 数据本身的日期（报告期、行情日、转录日） */
  asOf: string | null
  ageDays: number | null
  availability: Availability
  change: Change | null
  changeBasis: string | null
  source: SourceRef
  note: string | null
}

/** 参数裁定状态 */
export type RulingStatus = 'PENDING' | 'APPROVED' | 'EXISTING_RULE'

export const RULING_TEXT: Record<RulingStatus, string> = {
  PENDING: '待裁定（不生效）',
  APPROVED: '已裁定',
  EXISTING_RULE: '现行规则（由执行单或驾驶舱执行，本表只引用）',
}

export interface Param {
  status: RulingStatus
  /** 候选口径或现行规则原文 */
  text: string
  /** 出处 */
  ref: string | null
}

/** 数据缺口的类型 */
export type GapType = 'SOURCE' | 'UPDATE' | 'NORMAL_RANGE' | 'DETERIORATION'

export const GAP_TEXT: Record<GapType, string> = {
  SOURCE: '缺数据源',
  UPDATE: '缺更新（数据过时或手工转录）',
  NORMAL_RANGE: '正常区间待裁定',
  DETERIORATION: '恶化条件待裁定',
}

export type UpdateFreq = 'DAILY' | 'QUARTERLY' | 'EVENT' | 'MANUAL'

export const FREQ_TEXT: Record<UpdateFreq, string> = {
  DAILY: '每个交易日',
  QUARTERLY: '每季（定期报告）',
  EVENT: '事件驱动',
  MANUAL: '人工录入',
}

/** 周期状态。研究标签，不是熔断等级，不是卖出信号 */
export type CycleState = 'C0' | 'C1' | 'C2' | 'C3'

export const CYCLE_STATE: Record<CycleState, { name: string; evidence: string; conclusion: string }> = {
  C0: { name: '扩张', evidence: '需求、订单、盈利兑现和股价趋势相互验证', conclusion: '保持跟踪，继续验证' },
  C1: { name: '拥挤', evidence: '估值和成交集中度升高，股价明显领先盈利', conclusion: '提高 TPO 复核优先级' },
  C2: { name: '盈利拐点', evidence: '订单放缓、价格或毛利率恶化、盈利预期下修相互印证', conclusion: '重新评估产业链节点和冠军竞争力' },
  C3: { name: '系统性退潮', evidence: '需求和盈利恶化，同时融资收紧、市场结构破坏', conclusion: '启动组合风险复核，按现有有效纪律执行' },
}

export interface Indicator {
  id: string
  layer: LayerId
  line: EvidenceLine
  /** null = 各节点共用的背景 */
  nodes: NodeId[] | null
  name: string
  question: string
  /** 引用的现有模块字段；null = 现有模块没有 */
  source: SourceRef | null
  /** 数据源现状 */
  dataSource: string
  freq: UpdateFreq
  normal: Param
  deterioration: Param
  /** 恶化条件成立时的复核动作。只有复核，没有交易 */
  reviewAction: string
  gaps: GapType[]
  note?: string
}

/** 委员会核实的事实与市场解读（人工录入，只增不改） */
export interface FactEntry {
  id: string
  recordedOn: string
  recordedBy: string
  eventDate: string
  source: string
  sourceDate: string
  url: string | null
  layer: LayerId
  nodes: NodeId[] | null
  /** 已核实的事实（原始口径） */
  fact: string
  /** 报道中的市场解读，与事实分栏 */
  interpretation: string | null
  /** 不能直接推出的结论 */
  cannotInfer: string
  status: 'VERIFIED_FACT' | 'HYPOTHESIS'
  /** 更正以新条目追加，写明被更正的编号 */
  supersedes?: string | null
}

export interface NodeView {
  node: NodeId
  name: string
  members: { code: string; name: string; champion: boolean; held: boolean; universeNode: string | null; scope: string }[]
  scope: string
  price: Evidence[]
  operating: Evidence[]
  gaps: { indicator: string; name: string; gap: GapType[] }[]
  facts: string[]
  /** 总表不自动给出 C0–C3：判定条件待裁定 */
  cycleState: { state: CycleState | null; status: 'NOT_DETERMINED' | 'DETERMINED'; reason: string }
  counts: Record<Availability, number>
}

export interface EvidencePackage {
  id: 'CY-01'
  kind: 'EVIDENCE_PACKAGE'
  version: 'V1.0'
  asOf: string
  generatedAt: string
  /** 读取的现有输出及其日期 */
  inputs: { module: string; path: string; asOf: string | null; ageDays: number | null; availability: Availability }[]
  context: Evidence[]
  nodes: NodeView[]
  portfolio: Evidence[]
  facts: FactEntry[]
  /** R-02 覆盖、但不属于任何产业节点的股票：列出，不归入节点 */
  unmapped: { code: string; name: string; group: string }[]
  cycleRules: { status: 'PENDING'; note: string }
  permissions: string[]
  constraints: string[]
  producesAction: false
}
