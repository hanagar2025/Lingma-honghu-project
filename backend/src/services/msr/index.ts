// MSR 主线内部轮动雷达 —— 与 TPO 对偶运行
//   TPO：谁正在失去势能 → 减仓、退出
//   MSR：谁正在获得势能 → 发现下一核心
// 输出严格限定为三类：减仓候选 / 潜在新核心 / 暂不行动。没有第四类。
//
// 最高优先级约束（委员会 2026-08-13 自设，硬编码不可配置）：
//   执行未清零时，MSR 不得输出任何建仓候选。
//   "我发现一个新机会，于是暂时不卖老核心" —— 绝对禁止（第10条教训：研究替代执行）。
//   顺序永远是：老核心减仓执行 → 现金回来 → MSR 扫描 → 四道闸门 → 才可以买。

import type { DailyBar } from '../tios/types'
import { runRadar, type RadarResult } from './radar'
import { evaluateMainlineHealth, type MainlineHealthResult } from './health'
import { evaluatePromotion, type PromotionResult } from './promotion'
import type { ValuationInjection } from './valuation'
import {
  MAINLINES, MIN_EVIDENCE_FOR_CANDIDATE, RESEARCH_ONLY_MAINLINE_IDS,
  type Mainline, type UniverseMember,
} from './universe'

/** 窗口期状态机（委员会 2026-08-13 第八节） */
export type WindowState =
  | 'RESEARCH'          // 产业强、资金弱 → 只研究
  | 'WATCH'             // 资金开始进入 → 重点观察
  | 'ENTRY_WINDOW'      // 资金进入 + 趋势启动 → 建仓窗口
  | 'HOLD_NO_CHASE'     // 趋势加速 → 持有不追
  | 'REDUCE_RISK'       // 趋势极端加速 → 减仓风险上升
  | 'ROTATION_WINDOW'   // 龙头撤退、二线接力 → 轮动窗口
  | 'MAINLINE_REDUCE'   // 全板块撤退 → 主线战术降仓

export const WINDOW_TEXT: Record<WindowState, string> = {
  RESEARCH: '只研究',
  WATCH: '重点观察',
  ENTRY_WINDOW: '建仓窗口',
  HOLD_NO_CHASE: '持有/不追',
  REDUCE_RISK: '减仓风险上升',
  ROTATION_WINDOW: '轮动窗口',
  MAINLINE_REDUCE: '主线战术降仓',
}

/** 阻断理由枚举 —— 刻意不包含"已涨X%"。禁止涨幅否决法（2026-08-13条款） */
export type BlockReason =
  | 'EXECUTION_DEBT'          // 存在未执行的卖出指令
  | 'MAINLINE_NOT_ROTATING'   // 主线健康度未达轮动
  | 'EVIDENCE_BELOW_B'        // 产业证据低于B级
  | 'ATTRIBUTION_UNVERIFIED'  // 收入主线归因未核验
  | 'SCORE_INCOMPLETE'        // 评分不完整（如PE历史分位缺失）
  | 'RETIRED_C_TIER'          // C级清退，须走冠军替换四步程序
  | 'RESEARCH_ONLY_MAINLINE'  // 冻结令：只研究不进组合
  | 'VALUATION_PERCENTILE_HIGH' // 估值历史分位过高
  | 'TREND_NOT_STARTED'       // 趋势未启动

export const BLOCK_TEXT: Record<BlockReason, string> = {
  EXECUTION_DEBT: '执行未清零（存在未执行卖出指令）',
  MAINLINE_NOT_ROTATING: '主线健康度未达轮动标准',
  EVIDENCE_BELOW_B: '产业证据低于B级',
  ATTRIBUTION_UNVERIFIED: '收入主线归因未核验',
  SCORE_INCOMPLETE: '评分不完整',
  RETIRED_C_TIER: 'C级清退，须走冠军替换四步程序',
  RESEARCH_ONLY_MAINLINE: '冻结令：该主线只研究不进组合',
  VALUATION_PERCENTILE_HIGH: '估值历史分位过高',
  TREND_NOT_STARTED: '趋势未启动',
}

/**
 * MSR 择时能力的实测读数。**必须随每份报告输出**，不得只在文档里提。
 *
 * 理由：2026-08-13 回测显示 MSR 的择时增量为 -14.5pct（劣于同域始终满仓），
 * 入场信号相对基准的 20 日超额优势 +1.05pct 的 95% 区间为 [-0.89, +3.40]，跨 0。
 * 若报告不带这行字，"雷达选出的第一名"极易被读成"经过验证的机会"——
 * 这正是第10条教训（研究替代执行）的变体：用模型的复杂度冒充模型的有效性。
 */
export const MSR_BACKTEST_EVIDENCE = {
  asOf: '2026-08-13',
  sample: '27只标的 / 2023-05~2026-08 / 13500观测 / 日期区块自助抽样3000次',
  entryEdge20d: { point: 0.0105, ci95: [-0.0089, 0.034] as [number, number], significant: false },
  timingContribution: -0.145,
  universeSelectionBias: 3.81,
  verdict:
    'MSR择时增量为负（-14.5pct，且最大回撤反而更深）；入场信号优势无法与噪声区分。' +
    '当前 MSR 只应被当作"缩小观察范围的工具"，不得当作"已验证的选股能力"。',
  scripts: [
    'scripts/backtest-0813-signals.py',
    'scripts/backtest-0813-regime.py',
    'scripts/backtest-0813-significance.py',
  ],
} as const

export interface MsrCandidate {
  radar: RadarResult
  mainlineId: string
  mainlineName: string
  window: WindowState
  blocks: BlockReason[]
  /** 四阶段晋级结果 —— 只有 STAGE_3_PRICE_WINDOW 才可能 actionable */
  promotion: PromotionResult
  /** 可建仓：须同时满足 blocks 为空、窗口态为建仓/轮动、且晋级至 Stage3 */
  actionable: boolean
  /** 首次建仓规模系数（来自价格窗口）。深红为0=禁止；其余仅缩放，不否决 */
  sizeMultiplier: number
}

export interface MsrInput {
  date: string
  barsByCode: Record<string, DailyBar[]>
  indexBarsByCode: Record<string, DailyBar[]>
  /** 未执行的卖出指令条数 —— 来自 TIOS 执行台账。>0 即锁死全部建仓输出 */
  pendingSellCount: number
  /** 市场阶段是否允许建仓（下跌期/熔断期为 false）。缺省按不允许处理 —— 默认从严 */
  marketAllows?: boolean
  /**
   * PE历史分位，由 `npm run msr:valuation` 生成的 data/valuation.json 注入。
   * 缺失或 usable=false 时估值维度记 0 分并阻断 S3 —— 没有数据就不许买，不静默放行。
   */
  valuationByCode?: Record<string, ValuationInjection>
}

export interface MsrReport {
  date: string
  /** 执行债务闸门状态 */
  executionGate: { pendingSellCount: number; locked: boolean; detail: string }
  health: MainlineHealthResult[]
  /** 输出一：减仓候选（势能衰减，交由 TPO/执行层处理） */
  reduceCandidates: MsrCandidate[]
  /** 输出二：潜在新核心 */
  potentialCores: MsrCandidate[]
  /** 输出三：暂不行动 */
  noAction: MsrCandidate[]
  conclusion: string
  /** 实测能力披露 —— 强制随报告输出，防止"发现"被读成"已验证" */
  backtest: typeof MSR_BACKTEST_EVIDENCE
}

function classifyWindow(r: RadarResult, health: MainlineHealthResult): WindowState {
  const dist20 = r.metrics.distMa20 ?? 0
  if (health.health === 'BROAD_RETREAT') return 'MAINLINE_REDUCE'
  if (dist20 > 0.25) return 'REDUCE_RISK'
  if (dist20 > 0.15) return 'HOLD_NO_CHASE'
  const capitalIn = r.capital.score >= 3
  const trendStarted = r.trend.score >= 3
  if (health.health === 'ROTATION' && capitalIn && trendStarted && r.tier !== 1) return 'ROTATION_WINDOW'
  if (capitalIn && trendStarted) return 'ENTRY_WINDOW'
  if (capitalIn) return 'WATCH'
  return 'RESEARCH'
}

function collectBlocks(
  m: UniverseMember, mainline: Mainline, r: RadarResult,
  health: MainlineHealthResult, input: MsrInput, window: WindowState
): BlockReason[] {
  const blocks: BlockReason[] = []
  // 最高优先级：执行债务。硬编码，不受任何配置或评分影响。
  if (input.pendingSellCount > 0) blocks.push('EXECUTION_DEBT')
  if (m.retiredC) blocks.push('RETIRED_C_TIER')
  if (RESEARCH_ONLY_MAINLINE_IDS.includes(mainline.id)) blocks.push('RESEARCH_ONLY_MAINLINE')
  if (!MIN_EVIDENCE_FOR_CANDIDATE.includes(m.evidence)) blocks.push('EVIDENCE_BELOW_B')
  if (m.mainlineAttributionVerified === false) blocks.push('ATTRIBUTION_UNVERIFIED')
  if (!r.complete) blocks.push('SCORE_INCOMPLETE')
  if (m.peHistoryPercentile !== undefined && m.peHistoryPercentile > 0.8) blocks.push('VALUATION_PERCENTILE_HIGH')
  if (!health.allowCandidates && m.tier !== 1) blocks.push('MAINLINE_NOT_ROTATING')
  if (window === 'RESEARCH' || window === 'WATCH') blocks.push('TREND_NOT_STARTED')
  return blocks
}

export function runMsr(input: MsrInput): MsrReport {
  const health = MAINLINES.map(ml => evaluateMainlineHealth(ml, input.barsByCode))
  const healthById = new Map(health.map(h => [h.mainlineId, h]))

  const all: MsrCandidate[] = []
  for (const ml of MAINLINES) {
    const h = healthById.get(ml.id)!
    const index = input.indexBarsByCode[ml.benchmark]
    for (const raw of ml.members) {
      const bars = input.barsByCode[raw.code]
      if (!bars || bars.length < 65 || !index) continue
      // 注入实测PE历史分位。usable=false（TTM亏损/PE极端/样本不足）时不注入，
      // 让估值维度维持"缺失"状态并继续阻断 S3 —— 坏数据与无数据同等对待。
      const v = input.valuationByCode?.[raw.code]
      const m: UniverseMember =
        v?.usable && v.percentile3y !== null ? { ...raw, peHistoryPercentile: v.percentile3y } : raw
      const r = runRadar(m, bars, index)
      const window = classifyWindow(r, h)
      const blocks = collectBlocks(m, ml, r, h, input, window)
      const promotion = evaluatePromotion(m, r, bars, {
        marketAllows: input.marketAllows === true,
        executionCleared: input.pendingSellCount === 0,
      })
      all.push({
        radar: r, mainlineId: ml.id, mainlineName: ml.name, window, blocks, promotion,
        // 三重条件同时成立才可建仓。晋级制是最后一道，且不可被高评分绕过。
        actionable:
          blocks.length === 0 &&
          (window === 'ENTRY_WINDOW' || window === 'ROTATION_WINDOW') &&
          promotion.stage === 'STAGE_3_PRICE_WINDOW',
        sizeMultiplier: promotion.priceWindow.sizeMultiplier,
      })
    }
  }

  const reduceCandidates = all
    .filter(c => {
      if (c.window === 'REDUCE_RISK' || c.window === 'MAINLINE_REDUCE') return true
      if (c.radar.tier !== 1) return false
      // 龙头势能衰减：中期超额为负且跌破MA60 —— 与 TPO-1/TPO-5 同源判据。
      // 不使用短期超额，避免一根反弹把处于中期下降趋势的龙头移出减仓候选。
      const e20 = c.radar.metrics.excess20
      const d60 = c.radar.metrics.distMa60
      if (e20 !== null && d60 !== null && e20 < 0 && d60 < 0) return true
      return c.radar.relativeStrength.score <= 1 && c.radar.capital.score <= 2
    })
    .sort((a, b) => a.radar.total - b.radar.total)

  const reduceCodes = new Set(reduceCandidates.map(c => c.radar.code))
  const rest = all.filter(c => !reduceCodes.has(c.radar.code))

  // 潜在新核心：即便被 blocks 阻断也要列出，但标注为不可行动 ——
  // 目的是让"发现"与"授权"在同一张表上分离，防止发现被当成授权。
  const potentialCores = rest
    .filter(c => c.window === 'ENTRY_WINDOW' || c.window === 'ROTATION_WINDOW')
    .sort((a, b) => b.radar.total - a.radar.total)
  const coreCodes = new Set(potentialCores.map(c => c.radar.code))
  const noAction = rest.filter(c => !coreCodes.has(c.radar.code))
    .sort((a, b) => b.radar.total - a.radar.total)

  const locked = input.pendingSellCount > 0
  const actionableCount = potentialCores.filter(c => c.actionable).length
  const stageCount = (s: PromotionResult['stage']): number => all.filter(c => c.promotion.stage === s).length
  const stageLine =
    `晋级分布：S0=${stageCount('STAGE_0_RADAR')} S1=${stageCount('STAGE_1_INDUSTRY')} ` +
    `S2=${stageCount('STAGE_2_EARNINGS')} S3=${stageCount('STAGE_3_PRICE_WINDOW')}`
  const caveat =
    `［实测披露］MSR择时增量 ${(MSR_BACKTEST_EVIDENCE.timingContribution * 100).toFixed(1)}pct，` +
    `入场优势95%区间[${(MSR_BACKTEST_EVIDENCE.entryEdge20d.ci95[0] * 100).toFixed(1)},` +
    `${(MSR_BACKTEST_EVIDENCE.entryEdge20d.ci95[1] * 100).toFixed(1)}]pct跨0 —— ` +
    `本表是观察范围，不是已验证的机会。`
  const body = locked
    ? `执行未清零（${input.pendingSellCount}条卖出指令未执行）→ 建仓输出全部锁定。` +
      `本期发现${potentialCores.length}个势能改善位置，全部记为研究结论，0个可执行。${stageLine}。` +
      `解锁条件：卖出指令执行完毕并回报成交单。`
    : actionableCount === 0
      ? `无可执行建仓候选（${potentialCores.length}个位置进入窗口但未晋级至S3）。${stageLine}。`
      : `${actionableCount}个候选晋级S3，仍须经四道闸门与价格区间放行后方可买入。${stageLine}。`
  const conclusion = `${body} ${caveat}`

  return {
    date: input.date,
    executionGate: {
      pendingSellCount: input.pendingSellCount,
      locked,
      detail: locked
        ? `第10条教训（研究替代执行）：存在${input.pendingSellCount}条未执行卖出指令，MSR建仓输出物理锁定`
        : '执行台账已清零，建仓输出解锁',
    },
    health,
    reduceCandidates,
    potentialCores,
    noAction,
    conclusion,
    backtest: MSR_BACKTEST_EVIDENCE,
  }
}
