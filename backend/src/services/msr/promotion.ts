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

export type PriceWindow = 'GREEN' | 'YELLOW' | 'RED' | 'RED_EXTREME'

export const WINDOW_COLOR_TEXT: Record<PriceWindow, string> = {
  GREEN: '绿灯·结构平缓',
  YELLOW: '黄灯·结构一般',
  RED: '红灯·已偏离（不否决，仅降规模）',
  RED_EXTREME: '深红·极端急涨（唯一硬否决）',
}

export interface PriceWindowResult {
  color: PriceWindow
  /** 触发红灯的具体项，用于复盘 */
  redFlags: string[]
  greenFlags: string[]
  /**
   * 仓位规模系数。价格窗口自 2026-08-13 回测后**不再具有否决权**（深红除外），
   * 只影响首次建仓的规模。
   */
  sizeMultiplier: number
  detail: string
}

/**
 * 价格窗口判定。
 *
 * ⚠ 本函数的收益主张已于 2026-08-13 被自有回测**证伪**，且方向相反。必须先读这段再改代码。
 *
 * 回测设定：27只标的（AI光通信/半导体/算力/电力）、2023-05 ~ 2026-08、13500 个观测，
 * 前瞻超额对创业板指，日期区块自助抽样 3000 次修正重叠窗口。
 * 脚本：scripts/backtest-0813-signals.py、-regime.py、-significance.py
 *
 *   20日前瞻超额：绿灯 +3.53%（胜率50.7%）  黄灯 +5.07%  红灯 +6.14%（胜率56.6%）
 *   绿灯减红灯 = **-2.61pct**，95%区间 [-5.62, -0.37]，P(绿≥红)=0.012
 *   → 不是"无差异"，是**红灯显著优于绿灯**。等绿灯建仓平均少赚，不是多赚。
 *
 *   分期复核（想找出"闸门只在转折期有效"的辩解，未找到）：
 *     基准在MA60上方（上行期）：绿减红 -1.96pct
 *     基准在MA60下方（下行期）：绿减红 -1.54pct
 *     2026-06-20 以来本轮回撤期：绿减红 -0.38pct
 *   三个子样本无一支持闸门。原先"急涨段内会回踩绿灯，等待几乎免费"的结论
 *   （基于中际旭创三段共 3 个样本）属于极小样本偶然，已作废。
 *
 *   唯一还有方向性支持的是极端尾部：10日涨幅 >50% 时，20日前瞻超额 -2.70%（全样本 +4.56%）。
 *   但 n=138 且高度重叠，有效样本约 7，t=-0.4 —— 统计上什么都没证明。
 *
 * 因此本次改造遵循一条原则：**被证伪的部分不许再以收益为理由存在。**
 *   - 除深红（10日>50% 或 10日超额>40%）外，红灯**不再否决建仓**，只压缩规模。
 *   - 深红保留硬否决，理由写明是**集中度与行为风险**，不是超额收益。
 *     本账户的 80万 回撤来自单票 16% 仓位在急涨末端建仓后无法持有，
 *     回测用等权分散度量均值，测不到这种破产风险，故此处保留一条不靠回测支撑的护栏，
 *     并明码标价：代价约 2.6pct/20日 的均值让渡。
 *   - 规模系数本身**未经回测检验**（回测是等权的，没测过仓位调节），属于设计判断，勿宣称有据。
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

  // 深红：唯一保留硬否决的极端区。阈值取自回测中唯一出现负超额的尾部。
  const extremeFlags: string[] = []
  if (m.ret10 !== null && m.ret10 > 0.5) extremeFlags.push(`10日涨幅 +${(m.ret10 * 100).toFixed(1)}%（>50%极端区）`)
  if (m.excess10 !== null && m.excess10 > 0.4) extremeFlags.push(`10日超额 +${(m.excess10 * 100).toFixed(1)}pct（>40pct极端区）`)

  const color: PriceWindow =
    extremeFlags.length > 0
      ? 'RED_EXTREME'
      : redFlags.length > 0
        ? 'RED'
        : greenFlags.length >= 3
          ? 'GREEN'
          : 'YELLOW'

  const sizeMultiplier = color === 'RED_EXTREME' ? 0 : color === 'RED' ? 0.5 : color === 'YELLOW' ? 0.7 : 1

  return {
    color,
    redFlags: color === 'RED_EXTREME' ? [...extremeFlags, ...redFlags] : redFlags,
    greenFlags,
    sizeMultiplier,
    detail:
      color === 'RED_EXTREME'
        ? `深红：${extremeFlags.join('；')} → 禁止建仓（行为护栏，非收益理由；资格保留）`
        : color === 'RED'
          ? `红灯：${redFlags.join('；')} → 可建仓但规模减半（回测显示此区收益并不更差，仅控集中度）`
          : color === 'GREEN'
            ? `绿灯：${greenFlags.join('；')} → 全额规模（注意：回测中绿灯收益低于红灯 2.6pct/20日）`
            : `黄灯：绿灯项${greenFlags.length}/3未达标${greenFlags.length > 0 ? `（${greenFlags.join('；')}）` : ''} → 规模七折`,
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
  // 价格窗口只在深红区否决。绿/黄/红一律放行，仅由 sizeMultiplier 决定规模。
  // 改动依据：2026-08-13 回测证伪"等绿灯能提高收益"，见 evaluatePriceWindow 注释。
  if (priceWindow.color === 'RED_EXTREME') {
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
