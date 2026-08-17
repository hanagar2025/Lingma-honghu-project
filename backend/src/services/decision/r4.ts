/**
 * R4：市场价格隐含增长 vs 证据支持的增长。
 *
 * 这是鸿鹄目前最大的决策缺口，也是最容易被填错的一格。
 *
 * ── R4 测量的是什么 ──
 *
 *   市场价格要求公司未来做到什么？
 *   现有证据支持公司未来做到什么？
 *   两者之差，才是预期风险 / 预期机会。
 *
 * ── R4 不是什么 ──
 *
 * PE 历史分位不是隐含增长。
 * 历史利润增速不是可证明的未来增长。
 * 均线、相对强弱、RSI 更不是。
 *
 * 本函数即使收到 pePercentile / peTtm，也必须丢掉。
 * 自检会传入一个很高的 PE 分位，要求结论仍是 UNKNOWN。
 *
 * ── 测不到时 ──
 *
 * 输出 UNKNOWN，并写明「不允许进行预期风险判断」。
 * UNKNOWN 不产生卖出，也不单独产生加仓。
 * 只有两端未来 CAGR 都在时，才允许给出 OPPORTUNITY / ALIGNED / STRETCHED。
 *
 * STRETCHED 的唯一资本后果是停止追加，不是减仓。
 * RISK_CAN_PRODUCE.R4 仍必须为空。
 */

export type ExpectationVerdict = 'UNKNOWN' | 'OPPORTUNITY' | 'ALIGNED' | 'STRETCHED'

export const EXPECTATION_TEXT: Record<ExpectationVerdict, string> = {
  UNKNOWN: '未测',
  OPPORTUNITY: '预期差有利',
  ALIGNED: '预期大致匹配',
  STRETCHED: '市场隐含高于可证明增长',
}

export interface ExpectationInput {
  /** 价格隐含的未来盈利 CAGR。缺 = 不可测。 */
  impliedGrowth: number | null
  /** 证据支持的未来盈利 CAGR。缺 = 不可测。历史增速不得填到这里。 */
  supportedGrowth: number | null
  /** 若传入，必须被忽略。PE 分位不是隐含增长。 */
  pePercentile?: number | null
  peTtm?: number | null
}

export interface ExpectationGap {
  measurable: boolean
  impliedGrowth: number | null
  supportedGrowth: number | null
  /** supported − implied。正 = 证据高于市场要求。 */
  gap: number | null
  verdict: ExpectationVerdict
  why: string
  /** 缺哪一端。投资人「不可判断」区直接引用。 */
  blockedBy: readonly string[]
}

/** 两端都有值且差距小于此，视为大致匹配。这是分档，不是评分。 */
export const ALIGNED_BAND = 0.05

export function measureExpectation(input: ExpectationInput): ExpectationGap {
  // 显式丢弃价格代理，防止后人「顺手」把 PE 当成隐含增长。
  void input.pePercentile
  void input.peTtm

  const implied = finiteOrNull(input.impliedGrowth)
  const supported = finiteOrNull(input.supportedGrowth)
  const blockedBy: string[] = []
  if (implied === null) blockedBy.push('缺少价格隐含的未来增长（不是 PE 分位）')
  if (supported === null) blockedBy.push('缺少证据支持的未来增长（不是历史利润增速）')

  if (implied === null || supported === null) {
    return {
      measurable: false,
      impliedGrowth: implied,
      supportedGrowth: supported,
      gap: null,
      verdict: 'UNKNOWN',
      why: 'R4 尚未可测。不允许进行预期风险判断。'
        + '历史利润增速不是可证明的未来增长，PE 分位也不是市场价格隐含的增长。',
      blockedBy,
    }
  }

  const gap = supported - implied
  const verdict: ExpectationVerdict = Math.abs(gap) < ALIGNED_BAND
    ? 'ALIGNED'
    : gap > 0 ? 'OPPORTUNITY' : 'STRETCHED'
  const why = verdict === 'STRETCHED'
    ? `市场隐含 ${(implied * 100).toFixed(0)}%，证据支持 ${(supported * 100).toFixed(0)}%。`
      + '公司可以很好，但不值得继续增加资本。这不是减仓理由。'
    : verdict === 'OPPORTUNITY'
      ? `证据支持 ${(supported * 100).toFixed(0)}%，市场只隐含 ${(implied * 100).toFixed(0)}%。`
        + '预期差本身不能加仓，还须有独立证据族增加。'
      : `两端差距小于 ${(ALIGNED_BAND * 100).toFixed(0)} 个百分点，预期大致匹配。`

  return {
    measurable: true,
    impliedGrowth: implied,
    supportedGrowth: supported,
    gap,
    verdict,
    why,
    blockedBy: [],
  }
}

function finiteOrNull(v: number | null | undefined): number | null {
  return v === null || v === undefined || !Number.isFinite(v) ? null : v
}

/** PE 能不能冒充 R4。恒为 false。 */
export function peCanFillR4(): boolean {
  return false
}

/** R4 不是估值排名。PE 高 ≠ STRETCHED，PE 低 ≠ OPPORTUNITY。 */
export const R4_IS_NOT_A_PE_RANKING = true

/** 市场低估 ≠ 公司值得拥有，更不等于应该加仓。 */
export const OPPORTUNITY_CANNOT_ADD = true

/** 贵 ≠ 必须卖。STRETCHED 只停新资本进入。 */
export const STRETCHED_CANNOT_SELL = true
