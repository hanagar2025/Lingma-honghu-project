// 五层驾驶舱 —— 组合 × 主线 × 产业链 × 新势能 × 执行
//
// 委员会 2026-08-13 定稿原话：
//   「这个小程序不是每天告诉你买什么卖什么，而是每天把『我们现在在哪里、正在发生什么、
//     下一步哪里最值得盯』用数据压缩成一张驾驶舱。决策建议只是最后一层，不能凌驾于数据之上。」
//
// 本文件是**装配层**，不是计算层。它只做一件事：把已有引擎算出的真实数据
// 按四张表 + 动作区的结构重排。刻意不含任何新的判据、阈值、评分：
//   - 持仓表列值来自 momentum.ts（OBSERVATION）与 safety.ts（ACCOUNTING）
//   - 主线表列值来自 msr/health.ts 与 profitRadar.ts
//   - 产业结构表列值来自 profitRadar.ts 的 A/B/C 三变量
//   - 下一观察层的 S0–S3 勾选来自 universe 的核验标记与估值可用性
//   - 动作区动作来自 runCockpit，本文件**不生产动作**（无 makeAction 调用）
//
// 三条硬约束：
//   ① **禁止综合评分**。任何行都不得带总分/星级字段，由自检遍历 JSON 断言。
//      理由：数据不完整时，一个"84分"会制造虚假精确感。
//   ② **「不可判断」是合法输出**。数据完整度不足的主线，即使价格在涨，
//      也只能输出"不具备机会判断资格"，不得输出"正在成为下一主线"。
//   ③ **市场结构判断（深化/切换）不得产生动作**。它是对已披露利润的描述，
//      不是对未来的预测，且分类只用符号比较（无可调阈值）。

import type { DailyBar, Position } from '../tios/types'
import { sma } from '../tios/indicators'
import { MAINLINES, findMember, type UniverseMember } from '../msr/universe'
import type { MsrReport } from '../msr'
import type { MainlineHealth } from '../msr/health'
import type { ValuationInjection } from '../msr/valuation'
import type { ProfitMap, NodeProfit } from '../research/profitRadar'
import { nodeOf } from './nodes'
import type { MomentumRow } from './momentum'
import type { Action, EvidenceTier, Light, Metric } from './types'

/** 方向符号 —— 只表达符号与量级，不表达"该不该买" */
export type Arrow = '↑↑' | '↑' | '→' | '↓' | '↓↓' | '?'

/** 会话时点。盘前只报异常与必办，盘后出完整报告 */
export type SessionKind = 'PRE_OPEN' | 'POST_CLOSE'

export const SESSION_TEXT: Record<SessionKind, string> = {
  PRE_OPEN: '盘前状态（09:20–09:25）：只报持仓风险、超限、隔夜变化与今日必办动作',
  POST_CLOSE: '盘后完整报告（15:10–15:30）：趋势/相对强度/成交结构/利润结构/节点份额/新势能/KPI/数据缺口',
}

// ── ① 持仓表 ──

export interface HoldingRow {
  code: string
  name: string
  /** 仓位占总资产 */
  posPct: number | null
  ret1: number | null
  ret5: number | null
  ret20: number | null
  /** 20日相对所属主线基准的超额 */
  relMainline: number | null
  /** 收盘相对 MA20 / MA60 的位置 */
  aboveMa20: boolean | null
  aboveMa60: boolean | null
  pePercentile: number | null
  peUsable: boolean
  /** 所属节点的主线利润份额方向（来自利润结构地图，非价格） */
  nodeShareArrow: Arrow
  /** 该公司在节点内的利润份额 */
  shareWithinNode: number | null
  /** 产业位置 = 节点名 */
  industryPosition: string
  /** 触发复核的观察项条数与明细。**不是减仓理由** */
  reviewTriggers: string[]
  /** 法定减仓理由。null 表示"无" —— 这一列是本表最重要的一列 */
  legalReason: string | null
  /** 状态词：超限 / 观察 / 持有。由上面两列直接推出，不是评分 */
  status: '超限' | '观察' | '持有' | '数据不足'
  /** 系统动作 */
  systemAction: string
  metrics: Metric[]
}

// ── ② 主线表 ──

export interface MainlineRow {
  mainlineId: string
  name: string
  /** 基准指数趋势（MA20/MA60 位置） */
  trend: Arrow
  /** 基准 20 日相对大盘超额 */
  relStrength: Arrow
  /** 成交额 20/60 比 —— 资金的代理变量，非真实资金流 */
  volumeProxy: Arrow
  /** 首位节点的存量利润份额方向 */
  profitStructure: Arrow
  /** 龙头（T1）状态 */
  leaderStatus: string
  /** 三项验证完整度 */
  completeness: number | null
  /**
   * 当前判断。**「不可判断」是合法输出。**
   * 数据完整度不足时，即使 trend 为 ↑ 也只能输出不具备机会判断资格。
   */
  verdict: string
  /** 是否具备机会判断资格 */
  judgable: boolean
  /** 不可判断的具体原因 */
  blockers: string[]
  metrics: Metric[]
}

// ── ③ 产业结构表 ──

export interface NodeStructureRow {
  mainlineId: string
  node: string
  /** A 利润规模（元） */
  npLevel: number | null
  /** B 存量份额 */
  levelShare: number | null
  /** C 四季份额变化（pct点） */
  delta4Q: number | null
  /** 节点内领先公司（按节点内利润份额降序） */
  leaders: { name: string; shareWithinNode: number | null }[]
  /** 方向。'↑早期' 用于份额上升但绝对水平极低的节点 */
  direction: Arrow | '↑早期'
  /** 是否仅研究域覆盖 */
  researchOnly: boolean
  maxReportAgeDays: number | null
}

// ── ④ 下一观察层 ──

export interface NextLayerRow {
  mainlineId: string
  node: string
  /** 覆盖标的 */
  members: { code: string; name: string }[]
  /**
   * 战略层是否允许研究该节点的在册标的。
   *
   * 委员会第六节的链条第三步：数据发现 → 研究优先级提高 → **检查战略层是否允许** → ……
   * 若节点内全部在册标的均为 C 级清退，则战略层已关闭其仓位资格：
   * 此时节点份额上升只能记为**覆盖缺口**（须走冠军替换程序或补新标的），
   * 不得输出为"最值得研究"。兆易创新即此情形 —— 用户明确点名的越权路径。
   */
  strategyAllows: boolean
  /** 节点内已清退标的 */
  retiredMembers: string[]
  industryTrend: Arrow
  profitTrend: Arrow
  /** 节点存量份额 */
  nodeShare: number | null
  /** 资金：真实资金流数据不可得，恒为 '?' 并注明 */
  money: Arrow
  relStrength: Arrow
  valuation: string
  evidenceTier: string
  /** S0–S3 勾选。'?' 表示数据缺失，不得当作通过 */
  gates: {
    s0Discovered: boolean
    s1Industry: boolean | null
    s2Earnings: boolean | null
    s3Valuation: boolean | null
    moneyRadar: null
  }
  /** 阶段词：观察 / 研究。**不含"候选"以上级别** —— 那需要 S3 全过 */
  stage: '观察' | '研究'
  /** 是否允许动作。恒为 false，且必须显示 */
  actionAllowed: false
  /** 为什么不允许 */
  actionBlockedBy: string[]
}

// ── ⑤ 动作区 ──

export interface ActionZone {
  /** 必须执行 */
  mustExecute: { label: string; detail: string }[]
  /** 允许研究（不是允许买入） */
  allowedResearch: { label: string; detail: string }[]
  /** 禁止动作 */
  forbidden: { label: string; detail: string }[]
  /** 今日新增建仓数。0 是合法且常见的输出 */
  newEntryCount: number
}

// ── 市场结构判断 ──

/**
 * 深化 vs 切换。
 *
 * 委员会认为这是整个系统最有价值的一层：把"价格走弱"与"产业利润恶化"分开。
 *
 * 分类**只用符号比较**（首位节点份额变化的正负），没有可调阈值，
 * 因此不构成新增决策规则，也不进规则指纹。
 *
 * `canGenerateAction` 恒为 false：它描述的是已披露的历史利润分配，
 * 不预测未来价格。任何据此下单的行为都属越权。
 */
export interface MarketStructure {
  /** 'DEEPENING' 利润仍集中在原核心节点；'DIFFUSING' 首位节点份额在缩小 */
  kind: 'DEEPENING' | 'DIFFUSING' | 'UNKNOWN'
  headline: string
  /** 支撑证据：逐节点份额变化 */
  evidence: string[]
  /** 主线切换是否有足够证据 */
  switchEvidence: string
  tier: EvidenceTier
  canGenerateAction: false
}

// ── 首页一句话（多行压缩） ──

export interface Headline {
  mainline: string
  structure: string
  core: string
  deepening: string
  switching: string
  action: string
  dataCompleteness: string
  mostWorthResearching: string
}

export interface Dashboard {
  date: string
  session: SessionKind
  sessionNote: string
  headline: Headline
  marketStructure: MarketStructure
  holdings: HoldingRow[]
  mainlines: MainlineRow[]
  /** 按主线分组的产业结构表 */
  nodeStructure: Record<string, NodeStructureRow[]>
  nextLayer: NextLayerRow[]
  actionZone: ActionZone
  /** 数据缺口 —— 与研究表严格隔离地显示 */
  dataGaps: string[]
  /** 本表禁止综合评分的声明，随报告输出 */
  noCompositeScoreNote: string
}

/**
 * 找出在利润结构地图里查不到节点的在册标的。
 *
 * 存在理由：universe 的 `member.node` 与 NODE_TAXONOMY 的节点名是两套命名，
 * 曾经因此让半导体持仓的利润份额列静默显示 '?'（而不是报错）。
 * 静默缺失比报错危险得多 —— 读表的人会以为"这个节点没有利润数据"，
 * 而真实情况是"我们用错了键"。自检会断言此函数返回空。
 */
export function findProfitNodeMismatches(profit: ProfitMap | null): string[] {
  if (!profit) return []
  const keys = new Set(profit.nodes.map(n => `${n.mainlineId}|${n.node}`))
  const bad: string[] = []
  for (const ml of MAINLINES) {
    for (const m of ml.members) {
      if (!keys.has(`${ml.id}|${m.node}`)) bad.push(`${ml.name}/${m.node}（${m.name} ${m.code}）`)
    }
  }
  return bad
}

function ret(bars: DailyBar[] | undefined, n: number): number | null {
  if (!bars || bars.length < n + 1) return null
  return bars[bars.length - 1].close / bars[bars.length - 1 - n].close - 1
}

function arrowOf(v: number | null, strong: number): Arrow {
  if (v === null) return '?'
  if (v >= strong) return '↑↑'
  if (v > 0) return '↑'
  if (v === 0) return '→'
  if (v > -strong) return '↓'
  return '↓↓'
}

function amountRatio(bars: DailyBar[] | undefined, shortN: number, longN: number): number | null {
  if (!bars || bars.length < longN) return null
  const amt = bars.map(b => b.close * b.volume)
  const s = amt.slice(-shortN).reduce((a, b) => a + b, 0) / shortN
  const l = amt.slice(-longN).reduce((a, b) => a + b, 0) / longN
  return l === 0 ? null : s / l - 1
}

function acct(label: string, value: number | null, display: string, source: string, formula: string, asOf: string, missingReason?: string): Metric {
  return { label, value, display, source, formula, asOf, tier: 'ACCOUNTING', missingReason }
}

function obs(label: string, value: number | null, display: string, source: string, formula: string, asOf: string, missingReason?: string): Metric {
  return { label, value, display, source, formula, asOf, tier: 'OBSERVATION', missingReason }
}

const HEALTH_LEADER_TEXT: Record<MainlineHealth, string> = {
  ROTATION: '龙头承压、二线走强',
  TAIL_CHASE: '龙头调整而二线普涨',
  HEALTHY_UPTREND: '正常',
  BROAD_RETREAT: '全面退潮',
  INSUFFICIENT_DATA: '样本不足',
}

export interface DashboardInput {
  date: string
  session: SessionKind
  positions: Position[]
  totalAssets: number
  barsByCode: Record<string, DailyBar[]>
  indexBarsByCode: Record<string, DailyBar[]>
  marketBars?: DailyBar[]
  valuationByCode?: Record<string, ValuationInjection>
  momentumRows: MomentumRow[]
  msr: MsrReport
  /** 利润结构地图。null 表示未生成（须先跑 profit:fetch） */
  profit: ProfitMap | null
  /** runCockpit 产出的动作。本文件不生产动作 */
  actions: Action[]
  pendingSellCount: number
  noNewEntryReasons: string[]
  dataGaps: string[]
}

export function buildDashboard(input: DashboardInput): Dashboard {
  const {
    date, session, positions, totalAssets, barsByCode, indexBarsByCode, marketBars,
    valuationByCode, momentumRows, msr, profit, actions, pendingSellCount,
    noNewEntryReasons, dataGaps,
  } = input

  const momByCode = new Map(momentumRows.map(r => [r.code, r]))
  const nodeByKey = new Map<string, NodeProfit>()
  for (const n of profit?.nodes ?? []) nodeByKey.set(`${n.mainlineId}|${n.node}`, n)

  // ══ ① 持仓表 ══
  const holdings: HoldingRow[] = positions.map(p => {
    const bars = barsByCode[p.code]
    const hit = findMember(p.code)
    const sectorIdx = hit ? indexBarsByCode[hit.mainline.benchmark] : undefined
    const mom = momByCode.get(p.code)
    // ⚠ 用 universe 的 member.node 而非 NODE_TAXONOMY 的 nodeOf()：
    // 两套命名并不一致（如 universe「刻蚀/MOCVD」vs 分类表「刻蚀」），
    // 利润结构地图是按 member.node 建的。用错会让份额列静默显示 '?' 而不报错。
    const node = hit?.member.node ?? nodeOf(p.code)
    const np = hit ? nodeByKey.get(`${hit.mainline.id}|${hit.member.node}`) : undefined
    const mine = np?.members.find(m => m.code === p.code)

    const close = bars?.length ? bars[bars.length - 1].close : null
    const ma20 = bars ? sma(bars, 20) : null
    const ma60 = bars ? sma(bars, 60) : null
    const r20 = ret(bars, 20)
    const b20 = ret(sectorIdx, 20)
    const v = valuationByCode?.[p.code]
    const posPct = totalAssets > 0 ? p.marketValue / totalAssets : null

    const metrics: Metric[] = [
      acct('仓位占比', posPct, posPct === null ? '缺失' : `${(posPct * 100).toFixed(1)}%`,
        'positions.market_value ÷ 总资产',
        `${p.marketValue.toFixed(0)} ÷ ${totalAssets.toFixed(0)}`,
        date, posPct === null ? '总资产为0' : undefined),
      obs('20日相对主线超额', r20 === null || b20 === null ? null : r20 - b20,
        r20 === null || b20 === null ? '缺失' : `${((r20 - b20) * 100).toFixed(1)}%`,
        hit ? `${hit.mainline.name}基准${hit.mainline.benchmark}` : '无主线归属',
        '个股20日涨幅 − 主线基准20日涨幅', date,
        r20 === null || b20 === null ? '基准或个股K线不足' : undefined),
      {
        label: '节点主线利润份额变化（4季，pct点）',
        value: np?.levelShareDelta4Q ?? null,
        display: np?.levelShareDelta4Q === null || np?.levelShareDelta4Q === undefined
          ? '缺失' : `${np.levelShareDelta4Q > 0 ? '+' : ''}${np.levelShareDelta4Q.toFixed(1)}pct`,
        source: '东方财富RPT_LICO_FN_CPD 单季净利',
        formula: '本节点存量份额 − 四季前存量份额',
        asOf: profit?.generatedAt ?? date,
        tier: 'ACCOUNTING',
        missingReason: np?.levelShareDelta4Q == null ? '利润结构地图未生成或季度不足' : undefined,
      },
      {
        label: '公司在节点内利润份额',
        value: mine?.shareWithinNode ?? null,
        display: mine?.shareWithinNode == null ? '缺失'
          : (np?.members.length ?? 0) <= 1
            ? '100%（单标的节点，本项无判别力）'
            : `${(mine.shareWithinNode * 100).toFixed(1)}%`,
        source: '东方财富RPT_LICO_FN_CPD 单季净利',
        formula: '公司单季净利 ÷ 节点内正利润之和',
        asOf: profit?.generatedAt ?? date,
        tier: 'ACCOUNTING',
        missingReason: mine?.shareWithinNode == null ? '未披露或节点利润非正' : undefined,
      },
    ]

    const status: HoldingRow['status'] =
      mom?.legalReason ? '超限'
        : bars === undefined || bars.length < 65 ? '数据不足'
          : (mom?.reviewTriggers.length ?? 0) > 0 ? '观察' : '持有'

    return {
      code: p.code, name: p.name, posPct,
      ret1: ret(bars, 1), ret5: ret(bars, 5), ret20: r20,
      relMainline: r20 === null || b20 === null ? null : r20 - b20,
      aboveMa20: close === null || ma20 === null ? null : close >= ma20,
      aboveMa60: close === null || ma60 === null ? null : close >= ma60,
      pePercentile: v?.usable ? v.percentile3y : null,
      peUsable: !!v?.usable,
      nodeShareArrow: arrowOf(np?.levelShareDelta4Q ?? null, 5),
      shareWithinNode: mine?.shareWithinNode ?? null,
      industryPosition: node ?? '未归属节点',
      reviewTriggers: mom?.reviewTriggers ?? [],
      legalReason: mom?.legalReason ?? null,
      status,
      // 这一句是整张表的落点：观察项与法定理由严格分开
      systemAction: mom?.legalReason
        ? `减仓（法定理由：${mom.legalReason}）`
        : (mom?.reviewTriggers.length ?? 0) > 0
          ? '不动作，仅复核（无法定减仓理由）'
          : '持有',
      metrics,
    }
  })

  // ══ ② 主线表 ══
  const mainlines: MainlineRow[] = MAINLINES.map(ml => {
    const idx = indexBarsByCode[ml.benchmark]
    const q = profit?.quality.find(x => x.mainlineId === ml.id)
    const inMl = (profit?.nodes ?? []).filter(n => n.mainlineId === ml.id)
    const topNode = [...inMl].sort((a, b) => (b.levelShare ?? -1) - (a.levelShare ?? -1))[0]
    const health = msr.health.find(h => h.mainlineId === ml.id)

    const idxClose = idx?.length ? idx[idx.length - 1].close : null
    const idxMa60 = idx ? sma(idx, 60) : null
    const trendV = idxClose === null || idxMa60 === null ? null : idxClose / idxMa60 - 1
    const r20 = ret(idx, 20)
    const m20 = ret(marketBars, 20)
    const relV = r20 === null || m20 === null ? null : r20 - m20
    const volV = amountRatio(idx, 20, 60)

    const judgable = q?.usableForOpportunity ?? false
    const blockers = q?.blockers ?? ['利润结构地图未生成']

    // 「不可判断」是合法输出：数据不足时，即使 trend 为 ↑ 也不得输出主线强弱结论
    const verdict = !judgable
      ? `数据不足，不具备机会判断资格（${blockers.join('、')}）`
      : (topNode?.levelShareDelta4Q ?? 0) >= 0
        ? '主线未失效（首位节点利润份额未缩小）'
        : '首位节点利润份额缩小，需核查是扩散还是主线走弱'

    return {
      mainlineId: ml.id, name: ml.name,
      trend: arrowOf(trendV, 0.1),
      relStrength: arrowOf(relV, 0.05),
      volumeProxy: arrowOf(volV, 0.2),
      profitStructure: judgable ? arrowOf(topNode?.levelShareDelta4Q ?? null, 5) : '?',
      leaderStatus: health ? HEALTH_LEADER_TEXT[health.health] : '未评估',
      completeness: q?.completeness ?? null,
      verdict, judgable, blockers,
      metrics: [
        obs('基准距MA60', trendV, trendV === null ? '缺失' : `${(trendV * 100).toFixed(1)}%`,
          `${ml.benchmark}`, '基准收盘 ÷ MA60 − 1', date, trendV === null ? '基准K线不足' : undefined),
        obs('基准20日相对大盘', relV, relV === null ? '缺失' : `${(relV * 100).toFixed(1)}%`,
          `${ml.benchmark} vs 创业板指`, '基准20日涨幅 − 大盘20日涨幅', date,
          relV === null ? '基准或大盘K线不足' : undefined),
        obs('成交额20/60比（资金代理）', volV, volV === null ? '缺失' : `${(volV * 100).toFixed(1)}%`,
          `${ml.benchmark} 成交额`, '近20日均额 ÷ 近60日均额 − 1。**代理变量，非真实资金流**', date,
          volV === null ? '基准K线不足60根' : undefined),
        acct('三项验证完整度', q?.completeness ?? null,
          q ? `${(q.completeness * 100).toFixed(0)}%` : '缺失',
          'universe 核验标记', '(产业+盈利+归因) ÷ (成员数×3)', date,
          q ? undefined : '利润结构地图未生成'),
      ],
    }
  })

  // ══ ③ 产业结构表 ══
  const nodeStructure: Record<string, NodeStructureRow[]> = {}
  for (const ml of MAINLINES) {
    const inMl = (profit?.nodes ?? []).filter(n => n.mainlineId === ml.id)
    if (!inMl.length) continue
    const rows: NodeStructureRow[] = [...inMl]
      .sort((a, b) => (b.levelShare ?? -1) - (a.levelShare ?? -1))
      .map(n => {
        const leaders = [...n.members]
          .filter(m => m.shareWithinNode !== null)
          .sort((a, b) => (b.shareWithinNode ?? 0) - (a.shareWithinNode ?? 0))
          .slice(0, 2)
          .map(m => ({ name: m.name, shareWithinNode: m.shareWithinNode }))
        const d = n.levelShareDelta4Q
        // '↑早期'：份额在扩大但绝对水平仍在个位数以下 —— 委员会要求把
        // "方向对、水平低"与"已成主体"区分开，避免把 1% 的节点读成新核心。
        const direction: NodeStructureRow['direction'] =
          d === null ? '?'
            : d > 0 && (n.levelShare ?? 0) < 0.05 ? '↑早期'
              : arrowOf(d, 5)
        return {
          mainlineId: n.mainlineId, node: n.node,
          npLevel: n.npLevelSum, levelShare: n.levelShare, delta4Q: d,
          leaders, direction,
          researchOnly: n.researchOnly,
          maxReportAgeDays: n.maxReportAgeDays,
        }
      })
    nodeStructure[ml.id] = rows
  }

  // ══ ④ 下一观察层 ══
  // 定义：主线内**非首位份额**的节点。它们是"下一层"，不是"替代核心"——
  // 后者预设了接棒，而利润数据尚未支持接棒。
  const nextLayer: NextLayerRow[] = []
  for (const ml of MAINLINES) {
    const rows = nodeStructure[ml.id]
    if (!rows || rows.length < 2) continue
    for (const r of rows.slice(1)) {
      const np = nodeByKey.get(`${ml.id}|${r.node}`)
      const members: UniverseMember[] = ml.members.filter(m => m.node === r.node)
      const allCands = [...msr.potentialCores, ...msr.noAction, ...msr.reduceCandidates]
      const cand = allCands.find(c => members.some(m => m.code === c.radar.code))
      const s1 = members.length ? members.some(m => m.industryVerified) : null
      const s2 = members.length ? members.some(m => m.earningsVerified) : null
      const vals = members.map(m => valuationByCode?.[m.code]).filter(v => v?.usable)
      const s3 = members.length === 0 ? null : vals.length > 0 ? true : null
      const retired = members.filter(m => m.retiredC)
      // 全部在册标的被清退 → 战略层已关闭该节点的仓位资格
      const strategyAllows = members.length > 0 && retired.length < members.length
      const blocked: string[] = []
      if (pendingSellCount > 0) blocked.push(`执行债务 ${pendingSellCount} 笔未清偿`)
      if (!members.length) blocked.push('无在册标的（仅研究域覆盖）')
      if (members.length && !strategyAllows) {
        blocked.push(
          `战略层不允许：在册标的${retired.map(m => m.name).join('、')}均为C级清退。` +
          `节点份额上升只能记为覆盖缺口，须走冠军替换四步程序或补入新标的`
        )
      }
      if (s1 !== true) blocked.push('S1产业验证未完成')
      if (s2 !== true) blocked.push('S2盈利验证未完成')
      if (s3 !== true) blocked.push('S3估值分位不可用')
      blocked.push('Money Radar 数据不可得（真实资金流免费源缺失）')
      if ((r.levelShare ?? 0) < 0.05) blocked.push(`节点利润份额仅 ${((r.levelShare ?? 0) * 100).toFixed(1)}%`)

      nextLayer.push({
        mainlineId: ml.id, node: r.node,
        members: members.map(m => ({ code: m.code, name: m.name })),
        strategyAllows, retiredMembers: retired.map(m => m.name),
        industryTrend: cand ? arrowOf(cand.radar.metrics.ret20 ?? null, 0.15) : '?',
        profitTrend: np?.medianNpYoy == null ? '?' : arrowOf(np.medianNpYoy, 0.5),
        nodeShare: r.levelShare,
        money: '?',
        relStrength: cand ? arrowOf(cand.radar.metrics.excess20 ?? null, 0.05) : '?',
        valuation: vals.length && vals[0]?.percentile3y !== null
          ? `历史分位 ${(vals[0]!.percentile3y! * 100).toFixed(0)}%`
          : '不可用',
        evidenceTier: members.length ? members.map(m => m.evidence).sort()[0] : '无标的',
        gates: { s0Discovered: !!cand, s1Industry: s1, s2Earnings: s2, s3Valuation: s3, moneyRadar: null },
        // 只有"观察"与"研究"两级 —— "候选"以上须 S3 全过，当前无一满足
        stage: r.direction === '↑早期' || r.direction === '↑' || r.direction === '↑↑' ? '观察' : '研究',
        actionAllowed: false,
        actionBlockedBy: blocked,
      })
    }
  }

  // ══ 市场结构判断：深化 vs 切换 ══
  const marketStructure = judgeStructure(profit, nodeStructure)

  // 份额在扩大、但战略层已关闭仓位资格的节点 —— 必须显示为覆盖缺口，不能藏起来
  const blockedByStrategy = nextLayer.filter(
    r => r.stage === '观察' && r.members.length > 0 && !r.strategyAllows
  )

  // ══ ⑤ 动作区 ══
  const mustExecute: ActionZone['mustExecute'] = []
  if (pendingSellCount > 0) {
    mustExecute.push({
      label: `执行债务 ${pendingSellCount} 笔`,
      detail: '未执行卖出指令。清偿前硬锁全部新增建仓（法定理由 EXECUTION_DEBT）',
    })
  }
  for (const a of actions.filter(x => x.kind === 'REDUCE')) {
    mustExecute.push({ label: `${a.name}：${a.reasonDetail}`, detail: `${a.size.display}。${a.size.note}` })
  }
  const allowedResearch = nextLayer
    .filter(r => r.stage === '观察' && r.strategyAllows)
    .map(r => ({
      label: `${r.node}${r.members.length ? `（${r.members.map(m => m.name).join('、')}）` : '（仅研究域）'}`,
      detail: `节点利润份额 ${r.nodeShare === null ? '缺失' : `${(r.nodeShare * 100).toFixed(1)}%`}，份额方向扩大。允许研究，不等于允许买入`,
    }))
  const forbidden: ActionZone['forbidden'] = mainlines
    .filter(m => !m.judgable)
    .map(m => ({ label: `${m.name}：禁止做主线切换判断`, detail: m.blockers.join('、') }))
  for (const r of noNewEntryReasons) forbidden.push({ label: '禁止新增建仓', detail: r })
  for (const r of blockedByStrategy) {
    forbidden.push({
      label: `${r.node}：份额扩大但战略层不允许`,
      detail: `在册标的${r.retiredMembers.join('、')}均为C级清退。记为覆盖缺口，须走冠军替换四步程序`,
    })
  }

  const actionZone: ActionZone = {
    mustExecute, allowedResearch, forbidden,
    newEntryCount: actions.filter(a => a.kind === 'BUY').length,
  }

  // ══ 首页一句话 ══
  const optical = mainlines.find(m => m.mainlineId === 'optical')
  const judgables = mainlines.filter(m => m.judgable)
  const avgCompleteness = profit?.quality.length
    ? profit.quality.reduce((s, q) => s + q.completeness, 0) / profit.quality.length
    : null
  // 「最值得研究」按**份额扩大幅度**降序，而不是按份额最低。
  // 按份额最低会选出 0.0% 且无在册标的的空节点——那是噪声，不是"0→1→2→5→10"的第一步。
  // 委员会要找的是"产业利润份额刚开始从0→1→2→5→10的人"，其信号是份额**增幅**，
  // 且必须有在册标的才谈得上研究（无标的只能记为覆盖缺口）。
  const deltaByNode = new Map(
    Object.values(nodeStructure).flat().map(r => [`${r.mainlineId}|${r.node}`, r.delta4Q])
  )
  const earliest = [...nextLayer]
    .filter(r => r.stage === '观察' && r.nodeShare !== null && r.members.length > 0 && r.strategyAllows)
    .sort((a, b) => {
      const da = deltaByNode.get(`${a.mainlineId}|${a.node}`) ?? -Infinity
      const db = deltaByNode.get(`${b.mainlineId}|${b.node}`) ?? -Infinity
      return db - da
    })[0]
  const pressured = holdings.filter(h => h.reviewTriggers.length > 0)

  const headline: Headline = {
    mainline: optical
      ? `${optical.name}：${optical.verdict}`
      : '主线数据未生成',
    structure: marketStructure.headline,
    core: pressured.length
      ? `${pressured.map(h => h.name).join('、')}价格势能下降（${pressured.reduce((s, h) => s + h.reviewTriggers.length, 0)}项复核触发），` +
        `产业利润份额未恶化 → 无法定减仓理由者不动作`
      : '持仓无复核触发项',
    // 措辞随份额水平变化：把 1% 的节点说成"早期改善"是对的，
    // 把 23% 的节点也说成"早期改善"就是错的。
    deepening: earliest
      ? (earliest.nodeShare ?? 0) < 0.05
        ? `${earliest.node}出现早期改善，但利润份额仅约 ${((earliest.nodeShare ?? 0) * 100).toFixed(1)}%，尚不足以成为新核心`
        : `${earliest.node}利润份额已达 ${((earliest.nodeShare ?? 0) * 100).toFixed(1)}%且在扩大，已是主线主要节点之一（非早期节点）`
      : blockedByStrategy.length
        ? `份额扩大的次级节点全部受战略层限制：${blockedByStrategy.map(r => `${r.node}（${r.retiredMembers.join('、')}已清退）`).join('；')}`
        : '主线内部暂无份额扩大的次级节点',
    switching: marketStructure.switchEvidence,
    action: `执行既有仓位纪律（必办 ${mustExecute.length} 项）；今日新增建仓 ${actionZone.newEntryCount}`,
    dataCompleteness: avgCompleteness === null
      ? '利润结构地图未生成，数据完整度未知'
      : `${(avgCompleteness * 100).toFixed(0)}%（可判主线 ${judgables.length}/${mainlines.length}）`,
    mostWorthResearching: earliest
      ? `${earliest.node}${earliest.members.length ? `（${earliest.members.map(m => m.name).join('、')}）` : ''}` +
        ` —— 观察，不买。阻断项：${earliest.actionBlockedBy.length} 项`
      : '无',
  }

  return {
    date, session, sessionNote: SESSION_TEXT[session],
    headline, marketStructure,
    holdings, mainlines, nodeStructure, nextLayer, actionZone,
    dataGaps,
    noCompositeScoreNote:
      '本驾驶舱不输出主线综合评分/星级/总分。数据不完整时，合成分数会制造虚假精确感；' +
      '每一列自己说话，并各自附数据日期与证据等级。',
  }
}

/**
 * 深化 vs 扩散的机械分类。
 *
 * 只看首位份额节点的四季份额变化符号：
 *   >= 0 → DEEPENING（利润仍在向原核心节点集中或维持）
 *   <  0 → DIFFUSING（首位节点份额缩小，须进一步核查）
 * 无可调阈值，故不构成新增决策规则。
 */
export function judgeStructure(
  profit: ProfitMap | null,
  nodeStructure: Record<string, NodeStructureRow[]>
): MarketStructure {
  const optical = nodeStructure['optical']
  if (!profit || !optical?.length || optical[0].delta4Q === null) {
    return {
      kind: 'UNKNOWN',
      headline: '利润结构数据不足，无法判断是主线内部深化还是主线切换',
      evidence: [], switchEvidence: '数据不足，禁止做主线切换判断',
      tier: 'ACCOUNTING', canGenerateAction: false,
    }
  }
  const top = optical[0]
  const kind = (top.delta4Q ?? 0) >= 0 ? 'DEEPENING' : 'DIFFUSING'
  const evidence = optical
    .filter(r => r.delta4Q !== null)
    .map(r =>
      `${r.node}：份额 ${((r.levelShare ?? 0) * 100).toFixed(1)}%，` +
      `四季${(r.delta4Q ?? 0) > 0 ? '+' : ''}${(r.delta4Q ?? 0).toFixed(1)}pct` +
      (r.direction === '↑早期' ? '（方向扩大但水平极低）' : '')
    )

  // 主线切换需要跨主线的利润与验证证据。当前多数主线三项验证不足，
  // 故这里给出的是"证据是否足够"而非"哪条主线更强"。
  const judgableCount = profit.quality.filter(q => q.usableForOpportunity).length
  const switchEvidence = judgableCount < profit.quality.length
    ? `暂未发现另一条主线获得足够证据（${profit.quality.length - judgableCount}/${profit.quality.length} 条主线数据完整度不足，不具备切换判断资格）`
    : '各主线均具备判断资格，切换判断须由季度评审做出，不由日报做出'

  return {
    kind,
    headline: kind === 'DEEPENING'
      ? `主线内部深化，而非主线切换：首位节点「${top.node}」份额 ${((top.levelShare ?? 0) * 100).toFixed(1)}%，四季 +${(top.delta4Q ?? 0).toFixed(1)}pct，产业利润未离开原核心节点`
      : `首位节点「${top.node}」份额四季 ${(top.delta4Q ?? 0).toFixed(1)}pct，须核查是产业扩散还是主线走弱`,
    evidence, switchEvidence,
    tier: 'ACCOUNTING',
    canGenerateAction: false,
  }
}
