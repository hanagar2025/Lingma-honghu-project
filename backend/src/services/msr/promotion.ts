// 四阶段晋级制 + 价格窗口 —— 把"发现新势能"与"允许建仓"在类型层面强制分离
// 委员会 2026-08-13 第十节：Stage0 雷达发现 → Stage1 产业验证 → Stage2 盈利验证 → Stage3 价格窗口
//
// 核心不变量：只有 STAGE_3_PRICE_WINDOW 才可能 actionable。
// Stage0/1/2 无论评分多高、涨幅多大、资金多强，一律不可建仓。
// 目的：防止 MSR 退化为"漂亮的追涨机器"（委员会 2026-08-13 原话）。

import type { RadarResult } from './radar'
import type { UniverseMember } from './universe'
import type { DailyBar } from '../tios/types'

export type PromotionStage =
  | 'STAGE_0_RADAR'        // 只有价格/资金/相对强度 —— 不能买
  | 'STAGE_1_INDUSTRY'     // 客户、产品、订单、竞争格局已建档 —— 仍不能买
  | 'STAGE_2_EARNINGS'     // 扣非利润/现金流/毛利率已验证 —— 进入候选池
  | 'STAGE_3_PRICE_WINDOW' // 价格合理 + 技术结构健康 + 市场环境允许 —— 才允许建仓

export const STAGE_TEXT: Record<PromotionStage, string> = {
  STAGE_0_RADAR: 'S0雷达发现·不能买',
  STAGE_1_INDUSTRY: 'S1产业验证·不能买',
  STAGE_2_EARNINGS: 'S2盈利验证·入候选池',
  STAGE_3_PRICE_WINDOW: 'S3价格窗口·可建仓',
}

export type PriceWindow = 'GREEN' | 'YELLOW' | 'RED'

export const WINDOW_COLOR_TEXT: Record<PriceWindow, string> = {
  GREEN: '绿灯·候选',
  YELLOW: '黄灯·观察',
  RED: '红灯·禁止追入',
}

export interface PriceWindowResult {
  color: PriceWindow
  /** 触发红灯的具体项，用于复盘 */
  redFlags: string[]
  greenFlags: string[]
  detail: string
}

/**
 * 价格窗口判定。
 *
 * 与"禁用涨幅否决法"条款（2026-08-13）的关系必须说清楚，二者不冲突：
 *   - 被禁止的是把涨幅当作**否决候选资格**的理由（研究/战略层）——"它涨了60%所以不是好资产"。
 *   - 本函数是**战术层时点工具**，输出为"等窗口"，不是"淘汰"。红灯标的仍完整保留在
 *     Stage2 候选池里，价格回到绿灯即可买入，资格不受损。
 *
 * 实测代价（2026-08-13 以中际旭创三段主升浪回测，脚本 scripts/analysis-0813-greengate-cost.py）：
 *   第一段 2025-04-07 起点 RED（长上影），3日后首个绿灯 79.29（+8.3%）→ 放弃 14.5pct / 88.6%
 *   第二段 2025-07-04 起点 YELLOW，3日后首个绿灯 133.75（**低于起点 3.1%**）→ 反而多得 9.6pct / 198.7%
 *   第三段 2026-02-04 起点即 GREEN → 代价 0
 *   三段合计净代价约 4.9pct，样本内绿灯日占比 36.2%。
 *
 *   注意：立项时曾假设"绿灯闸门会错过第二段"，实测否证 —— 急涨段内部通常会出现回踩绿灯窗口，
 *   等待成本远低于直觉。该假设已删除，勿再引用。
 */
export function evaluatePriceWindow(bars: DailyBar[], r: RadarResult): PriceWindowResult {
  const m = r.metrics
  const redFlags: string[] = []
  const greenFlags: string[] = []

  const last = bars[bars.length - 1]
  const vol20 = bars.slice(-20).reduce((a, b) => a + b.volume, 0) / 20
  const volSpike = vol20 > 0 ? last.volume / vol20 : null
  // 长上影：当日收盘显著低于最高价
  const upperShadow = last.high > 0 ? last.close / last.high - 1 : 0

  if (m.distMa20 !== null && m.distMa20 > 0.15) redFlags.push(`距MA20 +${(m.distMa20 * 100).toFixed(1)}%（严重偏离）`)
  if (m.ret10 !== null && m.ret10 > 0.3) redFlags.push(`10日涨幅 +${(m.ret10 * 100).toFixed(1)}%（极大）`)
  if (volSpike !== null && volSpike > 2.5) redFlags.push(`当日量为20日均量${volSpike.toFixed(1)}倍（爆量）`)
  if (upperShadow < -0.04 && last.close > 0) redFlags.push(`长上影 收盘距当日最高${(upperShadow * 100).toFixed(1)}%`)
  if (m.excess10 !== null && m.excess10 > 0.25) redFlags.push(`10日超额 +${(m.excess10 * 100).toFixed(1)}pct（情绪极热）`)

  if (m.distMa20 !== null && Math.abs(m.distMa20) <= 0.08) greenFlags.push(`贴近MA20（${(m.distMa20 * 100).toFixed(1)}%）`)
  if (m.distMa60 !== null && Math.abs(m.distMa60) <= 0.1) greenFlags.push(`贴近MA60（${(m.distMa60 * 100).toFixed(1)}%）`)
  if (m.upDownVolumeRatio !== null && m.upDownVolumeRatio >= 1) greenFlags.push(`上涨放量（涨跌量比${m.upDownVolumeRatio.toFixed(2)}）`)
  if (m.excess20 !== null && m.excess20 > 0 && m.excess10 !== null && m.excess10 <= 0.25) {
    greenFlags.push(`相对强度刚启动（20日超额+${(m.excess20 * 100).toFixed(1)}pct 且10日未过热）`)
  }
  if (m.pullbackDepths.length >= 2) {
    const [a, b] = m.pullbackDepths.slice(-2)
    if (Math.abs(b) < Math.abs(a)) greenFlags.push('回调递浅')
  }

  const color: PriceWindow =
    redFlags.length > 0 ? 'RED' : greenFlags.length >= 3 ? 'GREEN' : 'YELLOW'

  return {
    color,
    redFlags,
    greenFlags,
    detail:
      color === 'RED'
        ? `红灯：${redFlags.join('；')} → 禁止追入（资格保留，等窗口）`
        : color === 'GREEN'
          ? `绿灯：${greenFlags.join('；')}`
          : `黄灯：绿灯项${greenFlags.length}/3未达标${greenFlags.length > 0 ? `（${greenFlags.join('；')}）` : ''} → 观察`,
  }
}

export interface PromotionResult {
  stage: PromotionStage
  priceWindow: PriceWindowResult
  /** 阻止晋级到下一阶段的原因 */
  blockedBy: string[]
}

export interface PromotionContext {
  /** 市场阶段是否允许建仓（下跌期/熔断期为 false） */
  marketAllows: boolean
  /** 执行台账是否清零 */
  executionCleared: boolean
}

/**
 * 晋级判定。逐级校验，任一级不过即停在该级 —— 不允许跳级。
 * 雷达势能只能决定"是否进入 Stage0"，不能决定任何更高阶段。
 */
export function evaluatePromotion(
  m: UniverseMember,
  r: RadarResult,
  bars: DailyBar[],
  ctx: PromotionContext
): PromotionResult {
  const priceWindow = evaluatePriceWindow(bars, r)
  const blockedBy: string[] = []

  // Stage 0：雷达发现。门槛低 —— 有势能改善迹象即可进入观察，但永不可买。
  const detected = r.capital.score >= 2 || r.trend.score >= 3 || (r.metrics.excess20 ?? -1) > 0
  if (!detected) {
    blockedBy.push('雷达未发现势能改善（S0未达）')
    return { stage: 'STAGE_0_RADAR', priceWindow, blockedBy }
  }

  // Stage 1：产业验证 —— 客户、产品、订单、竞争格局已建档
  if (m.industryVerified !== true) {
    blockedBy.push('产业验证未完成：客户/产品/订单/竞争格局未建档（S1未达）')
    return { stage: 'STAGE_0_RADAR', priceWindow, blockedBy }
  }
  if (m.evidence === 'C' || m.evidence === 'D') {
    blockedBy.push(`产业证据${m.evidence}级，低于B级门槛（S1未达）`)
    return { stage: 'STAGE_0_RADAR', priceWindow, blockedBy }
  }

  // Stage 2：盈利验证 —— 扣非利润兑现 + 收入主线归因，两项都要
  if (m.earningsVerified !== true) {
    blockedBy.push('盈利验证未完成：扣非利润/现金流/毛利率未核验（S2未达）')
    return { stage: 'STAGE_1_INDUSTRY', priceWindow, blockedBy }
  }
  if (m.mainlineAttributionVerified !== true) {
    blockedBy.push('收入主线归因未核验（S2未达）')
    return { stage: 'STAGE_1_INDUSTRY', priceWindow, blockedBy }
  }

  // Stage 3：价格窗口 + 估值分位 + 市场环境 + 执行台账
  if (m.peHistoryPercentile === undefined) {
    blockedBy.push('PE历史分位缺失，估值评分不完整（S3未达）')
    return { stage: 'STAGE_2_EARNINGS', priceWindow, blockedBy }
  }
  if (m.peHistoryPercentile > 0.8) {
    blockedBy.push(`PE历史分位${(m.peHistoryPercentile * 100).toFixed(0)}%，高于80%上限（S3未达）`)
    return { stage: 'STAGE_2_EARNINGS', priceWindow, blockedBy }
  }
  if (priceWindow.color !== 'GREEN') {
    blockedBy.push(`价格窗口${WINDOW_COLOR_TEXT[priceWindow.color]}（S3未达，资格保留）`)
    return { stage: 'STAGE_2_EARNINGS', priceWindow, blockedBy }
  }
  if (!ctx.marketAllows) {
    blockedBy.push('市场阶段不允许建仓（下跌期/熔断期）')
    return { stage: 'STAGE_2_EARNINGS', priceWindow, blockedBy }
  }
  if (!ctx.executionCleared) {
    blockedBy.push('执行台账未清零')
    return { stage: 'STAGE_2_EARNINGS', priceWindow, blockedBy }
  }

  return { stage: 'STAGE_3_PRICE_WINDOW', priceWindow, blockedBy }
}
