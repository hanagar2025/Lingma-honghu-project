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

/**
 * 价格窗口。**只有 RED_EXTREME 具有决策效力**，其余两档纯描述、不影响任何输出。
 * 三档不是"红黄绿灯"式的强弱序列 —— 那个设计已于 2026-08-13 被回测删除，见下方注释。
 */
export type PriceWindow = 'CALM' | 'EXTENDED' | 'RED_EXTREME'

export const WINDOW_COLOR_TEXT: Record<PriceWindow, string> = {
  CALM: '结构平缓（描述，无决策效力）',
  EXTENDED: '已伸展（描述，无决策效力）',
  RED_EXTREME: '极端急涨·硬否决（10日涨幅>50%）',
}

export interface PriceWindowResult {
  color: PriceWindow
  /** 触发硬否决的项。仅可能包含"10日涨幅>50%"一项 */
  redFlags: string[]
  /** 结构描述项，仅用于报告可读性，不参与任何判定 */
  greenFlags: string[]
  /** 建仓规模系数。只有 0（深红否决）与 1（其余）两种取值 */
  sizeMultiplier: number
  detail: string
}

/**
 * 价格窗口判定。
 *
 * ⚠ 改这个函数前必须读完这段。本函数在 2026-08-13 一天内经历了"建立 → 被自有回测证伪 → 删到只剩一条"。
 *
 * 回测设定：27只标的（AI光通信/半导体/算力/电力）、2023-05 ~ 2026-08、13500 个观测，
 * 20日前瞻超额对创业板指，与**同日期基准**配对比较，日期区块自助抽样 3000 次修正重叠窗口。
 * 脚本：backtest-0813-signals.py / -regime.py / -significance.py / -redflags.py
 *
 * ── 第一步：整体证伪 ──
 *   绿灯 +3.53%（胜率50.7%） 黄灯 +5.07% 红灯 +6.14%（胜率56.6%）
 *   绿减红 -2.61pct，95%区间 [-5.62, -0.37] —— 不是无差异，是**红灯显著优于绿灯**。
 *   分期复核未找到辩解：上行期 -1.96pct，下行期 -1.54pct，本轮回撤期 -0.38pct，三者无一支持闸门。
 *
 * ── 第二步：逐项归因，找出是谁在拖累 ──
 *   实盘扫描出现异象：距MA20 仅 -2.1% 的标的也被判红灯。逐项检验五个子条件：
 *
 *     子条件                  命中    减同期基准   95%区间          判定
 *     长上影（收盘低于最高4%）  2516   +1.14pct   [+0.2,+3.2]   ✗反向且显著，留着主动亏钱
 *     距MA20 > +15%          1668   +2.48pct   [-1.0,+6.2]   ✗无信息（点估计还是正的）
 *     当日量 > 2.5倍            162   +3.35pct   [-3.0,+7.3]   ✗无信息
 *     10日涨幅 > +30%          685   +0.27pct   [-3.7,+4.4]   ✗无信息
 *     10日超额 > +25pct        632   -1.69pct   [-5.1,+2.4]   ✗无信息
 *     ★10日涨幅 > +50%         138   -7.25pct   [-12.6,-1.4]  ✓唯一有警示力
 *     ☆10日超额 > +40pct       155   -5.54pct   [-10.9,+0.9]  ✗跨0，不够格
 *
 *   红灯之所以整体优于绿灯，主因是**长上影**这一项：命中最多（2516次，把几乎所有标的染红），
 *   而它命中后 20 日表现反而**显著更好**。把噪声当警报，是整套闸门失效的根源。
 *
 * ── 第三步：删四留一 ──
 *   按 CTC 证据标准条款（样本≥300独立观测 + 有可推翻的检验 + 对无条件基准 + 否则不得进代码），
 *   五个子条件删掉四个，只留 10日涨幅>50%。普通红灯整档删除 —— 它的每个组成部分都不携带信息。
 *
 * ── 必须记下的一次自我纠错 ──
 *   本函数上午的注释曾写"10日涨>50% 有效样本约7、t=-0.4，统计上什么都没证明"。**这个判断是错的**，
 *   因为它检验的是"均值是否异于0"。急涨日集中在市场火热期，同期基准也高，
 *   不与**同日期基准**配对就会被共同市场因子淹没。改为配对检验后，该条 95%区间不含 0。
 *   教训：检验设计错误会把真信号判成噪声，与把噪声判成真信号同样危险。
 *
 * ── 关于集中度风险 ──
 *   上午曾用"防止单票16%仓位在急涨末端建仓"为普通红灯的降规模机制辩护。该辩护已撤回：
 *   集中度风险由**12%单票上限**这条独立规则承担，与价格无关、与预测无关。
 *   一个风险配一个控制点；用价格窗口再兜一层，是把未经检验的机制伪装成风控。
 */
export function evaluatePriceWindow(bars: DailyBar[], r: RadarResult): PriceWindowResult {
  const m = r.metrics
  const redFlags: string[] = []
  const greenFlags: string[] = []

  // 唯一具备决策效力的判据。阈值与检验结果见函数注释。
  if (m.ret10 !== null && m.ret10 > 0.5) {
    redFlags.push(`10日涨幅 +${(m.ret10 * 100).toFixed(1)}%（>50%，实测此区20日超额 -7.25pct）`)
  }

  // 以下全部为描述项，不参与判定。保留是为了报告可读性与人工复盘。
  if (m.distMa20 !== null && Math.abs(m.distMa20) <= 0.08) greenFlags.push(`贴近MA20（${(m.distMa20 * 100).toFixed(1)}%）`)
  if (m.distMa60 !== null && Math.abs(m.distMa60) <= 0.1) greenFlags.push(`贴近MA60（${(m.distMa60 * 100).toFixed(1)}%）`)
  if (m.upDownVolumeRatio !== null && m.upDownVolumeRatio >= 1) greenFlags.push(`上涨放量（涨跌量比${m.upDownVolumeRatio.toFixed(2)}）`)
  if (m.pullbackDepths.length >= 2) {
    const [a, b] = m.pullbackDepths.slice(-2)
    if (Math.abs(b) < Math.abs(a)) greenFlags.push('回调递浅')
  }

  const extended = (m.distMa20 !== null && m.distMa20 > 0.15) || (m.ret10 !== null && m.ret10 > 0.3)
  const color: PriceWindow =
    redFlags.length > 0 ? 'RED_EXTREME' : extended ? 'EXTENDED' : 'CALM'

  return {
    color,
    redFlags,
    greenFlags,
    // 只有否决与不否决两种。差异化规模系数已删除：回测从未检验过仓位调节，
    // 未经检验的机制不得进代码（CTC 证据标准条款第4项）。
    sizeMultiplier: color === 'RED_EXTREME' ? 0 : 1,
    detail:
      color === 'RED_EXTREME'
        ? `硬否决：${redFlags.join('；')} → 禁止建仓（资格保留，回落后可买）`
        : color === 'EXTENDED'
          ? `已伸展（仅描述，不影响放行）${greenFlags.length ? `；${greenFlags.join('；')}` : ''}`
          : `结构平缓（仅描述，不影响放行）${greenFlags.length ? `：${greenFlags.join('；')}` : ''}`,
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
