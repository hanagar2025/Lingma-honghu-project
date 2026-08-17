/**
 * 战略状态与战术阶段 —— 决策链的前两层取值。
 *
 * 委员会 2026-08-17 把鸿鹄的产品定义从「投资风险驾驶舱」升级为
 * 「战略—战术投资决策驾驶舱」。本文件只定义**状态的取值与含义**，
 * 不含任何判据、阈值、评分。把已有证据翻译成这些状态的工作在 judge.ts。
 *
 * ── 为什么状态不是评分 ──
 *
 * 评分可比较、可排序、可加权，于是会被拿去挑"哪只最好"。
 * 战略增强并不"高于"战略成立，它们是不同处境。
 * 本文件禁止出现 score / rank / weight。
 *
 * ── 为什么战术阶段不复用生命线枚举 ──
 *
 * 仓位生命线（O0/P1/P3/X）回答"这项投资走到哪一步"。
 * 战术阶段（RADAR→EXIT）是投资人驾驶舱上的那几个词。
 * 两条轴取值不同，避免把"资格 S3"读成"应该重仓"。
 */

/** 战略层最终只输出这五种。不是分数。 */
export type StrategicState =
  | 'STRENGTHENED'  // 战略增强
  | 'HOLDS'         // 战略成立
  | 'WATCH'         // 战略观察
  | 'WEAKENED'      // 战略削弱
  | 'FALSIFIED'     // 战略证伪

export const STRATEGIC_TEXT: Record<StrategicState, string> = {
  STRENGTHENED: '战略增强',
  HOLDS: '战略成立',
  WATCH: '战略观察',
  WEAKENED: '战略削弱',
  FALSIFIED: '战略证伪',
}

export const STRATEGIC_DOT: Record<StrategicState, string> = {
  STRENGTHENED: '🟢',
  HOLDS: '🟢',
  WATCH: '🟡',
  WEAKENED: '🔴',
  FALSIFIED: '⛔',
}

/**
 * 战术层：仓位生命阶段。
 *
 * 阶段**不是由价格决定的**。由
 * 战略状态 × 盈利兑现 × 预期/估值 × 风险状态 × 证据完整度 决定。
 * 把 MA20/MA60/相对强弱重新包装成阶段切换条件，
 * 等于把已被回测证伪的价格窗口请回决策层。
 */
export type TacticalStage =
  | 'RADAR'
  | 'OBSERVE'
  | 'RESEARCH'
  | 'ENTRY'
  | 'ADD'
  | 'CORE'
  | 'REDUCE'
  | 'EXIT'

export const TACTICAL_TEXT: Record<TacticalStage, string> = {
  RADAR: '战略雷达',
  OBSERVE: '观察',
  RESEARCH: '研究',
  ENTRY: '建仓资格窗口',
  ADD: '加仓',
  CORE: '核心持有',
  REDUCE: '减仓评估',
  EXIT: '退出评估',
}

/**
 * 五个决策出口。**不能压成一个「卖出」。**
 *
 * 组合强制调整 ≠ 公司变坏。
 * 价值退出 ≠ 战术减仓。
 * 维持 ≠ 没有看法，而是逻辑仍成立。
 */
export type DecisionExit =
  | 'ADD_CAPITAL'       // 🟢 增加资本：事实强化
  | 'HOLD'              // ⚪ 维持：逻辑成立
  | 'TACTICAL_REDUCE'   // 🟡 降低暴露：公司/主线风险
  | 'VALUE_EXIT'        // 🔴 退出：投资逻辑失效
  | 'PORTFOLIO_FORCE'   // 🔵 组合强制调整：仓位/熔断

export const EXIT_TEXT: Record<DecisionExit, string> = {
  ADD_CAPITAL: '增加资本 —— 事实正在强化原判断',
  HOLD: '维持 —— 投资逻辑仍成立，今日不动作',
  TACTICAL_REDUCE: '降低暴露 —— 公司或主线风险上升，进入战术减仓评估',
  VALUE_EXIT: '退出 —— 投资逻辑已失效，须走战略层程序',
  PORTFOLIO_FORCE: '组合强制调整 —— 公司本身没问题，是组合暴露过高',
}

export const EXIT_DOT: Record<DecisionExit, string> = {
  ADD_CAPITAL: '🟢',
  HOLD: '⚪',
  TACTICAL_REDUCE: '🟡',
  VALUE_EXIT: '🔴',
  PORTFOLIO_FORCE: '🔵',
}

/**
 * 资本流向分档。不是排名。
 *
 * 「增强 / 观察 / 禁止」回答的是资本长期该不该属于它，
 * 不是"今天谁涨得最好"。
 */
export type CapitalLane = 'ENHANCE' | 'OBSERVE' | 'FORBID'

export const LANE_TEXT: Record<CapitalLane, string> = {
  ENHANCE: '增强',
  OBSERVE: '观察',
  FORBID: '禁止',
}

/**
 * R4 的可测性。
 *
 * 委员会明确：R4 叫「预期—估值错配」，不是「技术风险」。
 * 当前系统只有 PE 历史分位，没有「价格隐含增长 vs 公司可证明增长」。
 * 因此 R4 **尚未可测** —— 不得用 PE 分位或均线去填。
 */
export type R4Status = 'NOT_YET_MEASURABLE'

export const R4_STATUS_TEXT: Record<R4Status, string> = {
  NOT_YET_MEASURABLE:
    'R4 预期—估值错配尚未可测：系统只有 PE 历史分位，'
    + '没有「当前价格隐含的盈利预期 vs 公司已证明的增长」。'
    + '不得用 PE 高低或均线位置代替。',
}

/** 技术数据被允许承担的三种角色。没有第四种「创造投资逻辑」。 */
export type TechnicalRole = 'STATUS' | 'REVIEW' | 'EXECUTION' | 'NONE'

export const TECHNICAL_ROLE_TEXT: Record<TechnicalRole, string> = {
  STATUS: '状态确认（记录，不产生动作）',
  REVIEW: '风险复核（触发重新检查基本面，不构成减仓理由）',
  EXECUTION: '执行辅助（已决定减仓后降低冲击，不创造逻辑）',
  NONE: '未使用',
}
