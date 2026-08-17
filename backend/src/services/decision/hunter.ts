/**
 * 猎人型资本生命线 —— 《鸿鹄 V3》的产品模型。
 *
 * 委员会把终局定义成这一条线，而不是「仓位超过 12% 就卖」：
 *
 *   发现 → 观察 → 建仓 → 加仓 → 追加 → 核心持有
 *        → 战术减仓 → 价值退出 → 退出后重新观察
 *
 * ── 它回答的问题 ──
 *
 * 每一段只回答一个问题。涨了不能成为加仓理由，跌了也不能成为减仓理由。
 * 真正的理由是：证据发生了什么变化。
 *
 * ── 它不是什么 ──
 *
 * 不是 S0–S3（那是投资资格进度）。
 * 不是 R1–R4（那是风险类别）。
 * 不是 Ownership（值不值得拥有）或 Exposure（该拥有多少）。
 *
 * 组合超限不能把「核心持有」改写成「战术减仓」。
 * 海光 13.2% > 12% 仍是核心持有 —— 动作是降暴露，生命线不动。
 *
 * 本文件只定义取值与含义，不含判据。迁移规则在 migrate.ts。
 */

export type HunterStage =
  | 'DISCOVER'
  | 'OBSERVE'
  | 'ENTRY'
  | 'ADD'
  | 'TOP_UP'
  | 'CORE'
  | 'TACTICAL_REDUCE'
  | 'VALUE_EXIT'
  | 'REOBSERVE'

export const HUNTER_TEXT: Record<HunterStage, string> = {
  DISCOVER: '发现',
  OBSERVE: '观察',
  ENTRY: '建仓',
  ADD: '加仓',
  TOP_UP: '追加',
  CORE: '核心持有',
  TACTICAL_REDUCE: '战术减仓',
  VALUE_EXIT: '价值退出',
  REOBSERVE: '退出后重新观察',
}

export const HUNTER_QUESTION: Record<HunterStage, string> = {
  DISCOVER: '产业有没有出现值得研究的变化？',
  OBSERVE: '证据是不是逐渐成立？',
  ENTRY: '是否达到战略资格 + 战术闸门？',
  ADD: '原来的判断是否被进一步验证？',
  TOP_UP: '新证据是否继续强化，而不是单纯涨了？',
  CORE: '为什么这家公司值得持续占用资本？',
  TACTICAL_REDUCE: '哪一项证据开始恶化到需要降低暴露？',
  VALUE_EXIT: '战略/公司基本逻辑被证伪了吗？',
  REOBSERVE: '风险释放后，是否重新获得战略资格？',
}

/**
 * 前向路径。反向（减仓/退出/再观察）不是这条路上的「更高一段」，
 * 而是另一条分支。禁止用下标比较 CORE 与 TACTICAL_REDUCE 谁更高。
 */
export const HUNTER_FORWARD: readonly HunterStage[] = [
  'DISCOVER', 'OBSERVE', 'ENTRY', 'ADD', 'TOP_UP', 'CORE',
]

export const HUNTER_REVERSE: readonly HunterStage[] = [
  'TACTICAL_REDUCE', 'VALUE_EXIT', 'REOBSERVE',
]

export function isForward(s: HunterStage): boolean {
  return (HUNTER_FORWARD as readonly string[]).includes(s)
}

export function isReverse(s: HunterStage): boolean {
  return (HUNTER_REVERSE as readonly string[]).includes(s)
}
