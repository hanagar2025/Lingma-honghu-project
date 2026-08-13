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

export interface MsrCandidate {
  radar: RadarResult
  mainlineId: string
  mainlineName: string
  window: WindowState
  blocks: BlockReason[]
  /** 只有 blocks 为空且 window 为 ENTRY_WINDOW/ROTATION_WINDOW 才是真候选 */
  actionable: boolean
}

export interface MsrInput {
  date: string
  barsByCode: Record<string, DailyBar[]>
  indexBarsByCode: Record<string, DailyBar[]>
  /** 未执行的卖出指令条数 —— 来自 TIOS 执行台账。>0 即锁死全部建仓输出 */
  pendingSellCount: number
  /** 组合是否处于熔断降仓期 */
  portfolioCircuitActive?: boolean
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
    for (const m of ml.members) {
      const bars = input.barsByCode[m.code]
      if (!bars || bars.length < 65 || !index) continue
      const r = runRadar(m, bars, index)
      const window = classifyWindow(r, h)
      const blocks = collectBlocks(m, ml, r, h, input, window)
      all.push({
        radar: r, mainlineId: ml.id, mainlineName: ml.name, window, blocks,
        actionable: blocks.length === 0 && (window === 'ENTRY_WINDOW' || window === 'ROTATION_WINDOW'),
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
  const conclusion = locked
    ? `执行未清零（${input.pendingSellCount}条卖出指令未执行）→ 建仓输出全部锁定。` +
      `本期发现${potentialCores.length}个势能改善位置，全部记为研究结论，0个可执行。` +
      `解锁条件：卖出指令执行完毕并回报成交单。`
    : actionableCount === 0
      ? `无可执行建仓候选（${potentialCores.length}个位置进入窗口但被闸门阻断）。`
      : `${actionableCount}个候选通过MSR闸门，仍须经四道闸门与价格区间放行后方可买入。`

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
  }
}
