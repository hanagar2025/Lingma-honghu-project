// Profit Radar —— 主线利润结构地图
//
// 委员会 2026-08-13 定名。原名"利润池迁移地图"已废弃：
//   **"迁移"默认了零和**，而实测显示光通信全链同时扩张（光模块 +100、光芯片 +20、光器件 +10），
//   这叫"产业扩张 + 边际扩散"，不是"100→80→60，钱跑到另一个节点"。
//   名字会决定读者怎么解释数字，所以名字必须先改对。
//
// 回答的问题：「这条主线的利润，现在集中在哪些节点？各节点占多少？份额在往哪个方向变？」
//
// 三个变量必须同时看（委员会第三节）：
//   A. 利润规模   —— 这个节点到底创造了多少钱（绝对水平）
//   B. 利润份额   —— 它占整条主线利润的多少（**存量**份额）
//   C. 份额变化   —— 扩大 / 稳定 / 缩小
//
// ⚠ B 与"增量份额"是两个不同的量，且常常给出不同印象：
//   增量份额回答"这一季新增的钱去了哪里"，存量份额回答"钱现在在哪里"。
//   一个节点可以增量份额很高（新增的钱多流向它）而存量份额仍很低（家底还小）。
//   两者都要显示，不得只留其一。
//
// 本文件只做两件事：把累计财报还原成单季序列，按节点汇总。**不含任何决策规则。**
// 全部输出为会计事实（ACCOUNTING）或描述性标签（OBSERVATION），不产生动作、不产生买入候选。
//
// ⚠ 一条必须先读的结构性约束（实测）：
//   2026-08-13 抓取 51 只标的，**仅 2 只已披露 2026 中报**，其余 49 只最新为 2026Q1。
//   即利润数据对 96% 的标的滞后约 4.5 个月。
//
//   推论：**利润雷达在结构上不可能是"每天变化"的雷达。** 它一年只更新四次，且集中在财报季。
//   若把它塞进一张每日刷新的表，那张表里唯一每天变化的东西就是价格与成交 ——
//   于是"每日新核心发现"的日间变动会 100% 由价格驱动，只是这次穿的是财报的外衣。
//
//   正确用法：利润雷达**事件驱动**（财报披露触发），价格/资金雷达每日运行，
//   两者的更新频率必须在界面上分别标注，不得混在一张"今日"表里制造实时感。

import { readFileSync } from 'node:fs'
import { PROFIT_FILE, type ProfitFile, type ProfitRecord, type RawPeriod } from './profitFetch'
import { NODE_CANDIDATES } from './nodeCandidates'
import { MAINLINES } from '../msr/universe'

/** 单季还原结果 */
export interface QuarterPoint {
  year: number
  quarter: 1 | 2 | 3 | 4
  label: string
  /** 单季营业收入（元） */
  revenue: number | null
  /** 单季归母净利润（元） */
  netProfit: number | null
  /** 单季收入同比 */
  revenueYoy: number | null
  /** 单季净利同比 */
  netProfitYoy: number | null
}

/**
 * 累计 → 单季。
 *
 * Q1 的累计即单季；Q2/Q3/Q4 单季 = 本期累计 − 同年上期累计。
 * 缺任一端则该季为 null，**不做插值** —— 插出来的利润会被当成兑现证据。
 */
export function toSingleQuarter(periods: RawPeriod[]): QuarterPoint[] {
  const byKey = new Map<string, RawPeriod>()
  for (const p of periods) byKey.set(`${p.year}Q${p.quarter}`, p)

  const single = new Map<string, { revenue: number | null; netProfit: number | null }>()
  for (const p of periods) {
    if (p.quarter === 1) {
      single.set(`${p.year}Q1`, { revenue: p.revenueCum, netProfit: p.netProfitCum })
      continue
    }
    const prev = byKey.get(`${p.year}Q${p.quarter - 1}`)
    single.set(`${p.year}Q${p.quarter}`, {
      revenue: p.revenueCum !== null && prev?.revenueCum != null ? p.revenueCum - prev.revenueCum : null,
      netProfit: p.netProfitCum !== null && prev?.netProfitCum != null ? p.netProfitCum - prev.netProfitCum : null,
    })
  }

  const out: QuarterPoint[] = []
  for (const p of periods) {
    const key = `${p.year}Q${p.quarter}`
    const cur = single.get(key)
    const yoyKey = `${p.year - 1}Q${p.quarter}`
    const base = single.get(yoyKey)
    // 同比要求基期为正。基期为负时"同比增长率"没有可解释含义，宁可留空
    const revYoy = cur?.revenue != null && base?.revenue != null && base.revenue > 0
      ? cur.revenue / base.revenue - 1 : null
    const npYoy = cur?.netProfit != null && base?.netProfit != null && base.netProfit > 0
      ? cur.netProfit / base.netProfit - 1 : null
    out.push({
      year: p.year, quarter: p.quarter, label: key,
      revenue: cur?.revenue ?? null, netProfit: cur?.netProfit ?? null,
      revenueYoy: revYoy, netProfitYoy: npYoy,
    })
  }
  return out
}

export interface MemberProfit {
  code: string
  name: string
  scope: 'DECISION' | 'RESEARCH'
  node: string
  mainlineId: string
  /** 最新报告期 */
  latestReport: string | null
  /** 距今天数 —— 用于暴露利润数据的滞后 */
  reportAgeDays: number | null
  /** 是否已披露最近一期中报/年报（即扣非可得） */
  latestSingle: QuarterPoint | null
  prevSingle: QuarterPoint | null
  /** 单季净利同比的变化（pct点）。>0 表示同比增速本季高于上季 —— 事实，不是预测 */
  npYoyAccelPct: number | null
  /**
   * 单季净利润的**绝对同比增量**（元）= 本季净利 − 去年同季净利。
   *
   * ⚠ 这一项是"利润池迁移"唯一正确的度量口径，与增长率不是一回事，且常常方向相反。
   * 2026Q1 实例：源杰净利同比 +1153%，绝对增量约 1.7 亿；中际同比 +262%，绝对增量约 41.5 亿。
   * 按增长率排名会把源杰排在中际之前并称其为"新核心"，
   * 而实际上该季度光通信利润池的增量绝大部分落在光模块，不在光芯片。
   * 增长率衡量"这家公司变化多大"，增量衡量"利润池的钱去了哪里"。后者才是迁移问题的答案。
   */
  npAbsDelta: number | null
  /**
   * 该公司单季净利占**所属节点**利润的份额。
   *
   * 委员会给出的新核心定义需要两个条件同时成立：
   *   ① 所在节点正在获得越来越大的主线利润份额；
   *   ② **公司自身开始获得节点内越来越高的份额**。
   * 本字段是第 ② 个条件的度量。单标的节点恒为 1，此时该条件无判别力，须标注。
   */
  shareWithinNode: number | null
  /**
   * 累计毛利率，「单位为百分数」（37.21 表示 37.21%），不是小数。
   * 名字里带 Pct 是因为曾有人（我）当成小数又乘了 100，渲染出 5707.67%。
   * 一个数值字段不写明单位，就一定会被按错的单位用一次。
   */
  grossMarginPct: number | null
  /** 同比变化（pct 点）= 本期 − 去年同季 */
  grossMarginYoyPct: number | null
  /** 去年同季的累计毛利率。用于同屏显示两个端点 —— 只给差值看不出量级 */
  grossMarginPrevPct: number | null
  /**
   * 毛利率同比大幅变动时，「变的是本期还是基期」。
   *
   * 存在理由是一次真实的对照：2026Q1 同业里两家毛利率同比都跳升 20pct 上下，
   * 但性质完全相反 ——
   *   兆易创新：前 8 季稳定 37–40%，基期 37.4% 正常，本期 57.1% 偏离自身历史
   *   拓荆科技：前 8 季 40–44%，基期 19.9% 才是异常，本期 41.7% 只是回归正常
   * 同比数字（+19.6pct / +21.8pct）把这个区别完全掩盖了。
   * 只看同比会把"回归正常"读成"大幅改善"。
   */
  grossMarginAnomaly: GrossMarginAnomaly | null
  /** 扣非占净利比。仅半年报/年报可得 */
  deductRatio: number | null
  deductRatioAsOf: string | null
  /** 现金含量 = 每股经营现金流 ÷ 基本每股收益 */
  cashMatch: number | null
  roe: number | null
  dataGaps: string[]
}

function daysSince(d: string, today: string): number {
  return Math.round((Date.parse(today) - Date.parse(d)) / 86400000)
}

export function computeMemberProfit(rec: ProfitRecord, node: string, mainlineId: string, today: string): MemberProfit {
  const gaps: string[] = []
  const sq = toSingleQuarter(rec.periods)
  const latest = rec.periods[rec.periods.length - 1] ?? null
  const latestSq = sq.length ? sq[sq.length - 1] : null
  const prevSq = sq.length > 1 ? sq[sq.length - 2] : null

  if (rec.error) gaps.push(`财报抓取失败：${rec.error}`)
  if (!latest) gaps.push('无任何财报数据')

  // 毛利率同比：与去年同季的累计毛利率比
  let gmYoy: number | null = null
  let gmPrev: number | null = null
  let gmAnomaly: GrossMarginAnomaly | null = null
  if (latest) {
    const lastYearSame = rec.periods.find(p => p.year === latest.year - 1 && p.quarter === latest.quarter)
    if (latest.grossMarginCumPct != null && lastYearSame?.grossMarginCumPct != null) {
      gmYoy = latest.grossMarginCumPct - lastYearSame.grossMarginCumPct
      gmPrev = lastYearSame.grossMarginCumPct
      // 自身历史 = 除本期与基期之外的各季，用于判别"偏离的是哪一端"
      const hist = rec.periods
        .filter(x => x !== latest && x !== lastYearSame && x.grossMarginCumPct != null)
        .map(x => x.grossMarginCumPct as number)
      gmAnomaly = judgeGmAnomaly(hist, latest.grossMarginCumPct, lastYearSame.grossMarginCumPct)
    } else gaps.push('毛利率同比基期缺失')
  }

  // 扣非占比：取最近一期同时有扣非与基本EPS的报告（半年报/年报）
  let deductRatio: number | null = null
  let deductAsOf: string | null = null
  for (let i = rec.periods.length - 1; i >= 0; i--) {
    const p = rec.periods[i]
    if (p.deductEps != null && p.basicEps != null && p.basicEps !== 0) {
      deductRatio = p.deductEps / p.basicEps
      deductAsOf = p.reportDate
      break
    }
  }
  if (deductRatio === null) gaps.push('扣非占比不可得（一季报/三季报无该字段）')
  else if (deductAsOf && latest && deductAsOf !== latest.reportDate) {
    gaps.push(`扣非口径滞后至 ${deductAsOf}（最新报告期 ${latest.reportDate} 无扣非字段）`)
  }

  const cashMatch = latest?.cfoPerShareCum != null && latest.basicEps != null && latest.basicEps !== 0
    ? latest.cfoPerShareCum / latest.basicEps : null
  if (cashMatch === null) gaps.push('现金含量不可算')

  const accel = latestSq?.netProfitYoy != null && prevSq?.netProfitYoy != null
    ? (latestSq.netProfitYoy - prevSq.netProfitYoy) * 100 : null
  if (accel === null) gaps.push('单季净利同比加速度不可算（基期为负或缺失）')

  // 绝对增量：与去年同季的单季净利之差。基期为负时仍可算（增量本身有意义），
  // 这与同比增长率不同 —— 后者在基期为负时无可解释含义。
  let npAbsDelta: number | null = null
  if (latestSq?.netProfit != null) {
    const sqAll = toSingleQuarter(rec.periods)
    const base = sqAll.find(x => x.year === latestSq.year - 1 && x.quarter === latestSq.quarter)
    if (base?.netProfit != null) npAbsDelta = latestSq.netProfit - base.netProfit
    else gaps.push('净利绝对增量不可算（去年同季缺失）')
  }

  return {
    code: rec.code, name: rec.name, scope: rec.scope, node, mainlineId,
    latestReport: latest?.reportDate ?? null,
    reportAgeDays: latest ? daysSince(latest.reportDate, today) : null,
    latestSingle: latestSq, prevSingle: prevSq,
    npYoyAccelPct: accel,
    npAbsDelta,
    shareWithinNode: null,
    grossMarginPct: latest?.grossMarginCumPct ?? null,
    grossMarginYoyPct: gmYoy,
    grossMarginPrevPct: gmPrev,
    grossMarginAnomaly: gmAnomaly,
    deductRatio, deductRatioAsOf: deductAsOf,
    cashMatch,
    roe: latest?.roeCum ?? null,
    dataGaps: gaps,
  }
}

/**
 * 节点级利润读数。
 *
 * `status` 是**描述性标签（OBSERVATION）**，不得作为动作依据。
 * 它只陈述"该节点在册标的的单季利润同比是加速还是减速"，不预测股价。
 */
/**
 * 毛利率跃升的归因：偏离的是本期，还是基期？
 *
 * 纯描述统计，不含预测。判据是与「自身前若干季」的偏离，
 * 而不是与同业比 —— 同业比回答的是另一个问题(是否行业性)，两者都要看。
 */
export interface GrossMarginAnomaly {
  /** 参与比较的历史季数(不含本期与基期) */
  baseQuarters: number
  /** 自身历史中位数 */
  historyMedianPct: number
  /** 历史区间 */
  historyMinPct: number
  historyMaxPct: number
  /** 本期偏离历史区间的幅度(pct点)。0 = 落在区间内 */
  currentDeviationPct: number
  /** 基期偏离历史区间的幅度(pct点) */
  prevDeviationPct: number
  verdict:
    /** 本期偏离自身历史 → 跃升是真实事件，须解释 */
    | 'CURRENT_IS_OUTLIER'
    /** 基期偏离自身历史 → 同比是基期失真，本期只是回归正常 */
    | 'BASE_IS_OUTLIER'
    | 'BOTH_OUTLIERS'
    /** 两端都在历史区间内 → 同比变动不构成跃升 */
    | 'NEITHER'
  note: string
}

/** 偏离判据：超出自身历史 min–max 区间即为偏离，幅度按超出量计。
 *  刻意不用标准差倍数 —— 8 个样本估标准差本身不可靠，而 min–max 是直接可读的事实。 */
function judgeGmAnomaly(
  history: number[], currentPct: number, prevPct: number
): GrossMarginAnomaly | null {
  if (history.length < 4) return null
  const sorted = [...history].sort((a, b) => a - b)
  const med = sorted[Math.floor(sorted.length / 2)]
  const lo = sorted[0]
  const hi = sorted[sorted.length - 1]
  const dev = (v: number) => (v > hi ? v - hi : v < lo ? v - lo : 0)
  const cd = dev(currentPct)
  const pd = dev(prevPct)
  const cOut = Math.abs(cd) > 0
  const pOut = Math.abs(pd) > 0
  const verdict: GrossMarginAnomaly['verdict'] = cOut && pOut ? 'BOTH_OUTLIERS'
    : cOut ? 'CURRENT_IS_OUTLIER' : pOut ? 'BASE_IS_OUTLIER' : 'NEITHER'
  // 措辞必须与偏离幅度相称。偏离 0.3pct 写成"跃升是真实事件"是把噪声说成事件 ——
  // 这里只报事实(偏离多少)，是否构成须解释的事件由台账结合同比幅度另行判断。
  const note = verdict === 'CURRENT_IS_OUTLIER'
    ? `本期 ${currentPct.toFixed(1)}% 落在自身历史区间 ${lo.toFixed(1)}–${hi.toFixed(1)}% 之`
      + `${cd > 0 ? '上' : '下'} ${Math.abs(cd).toFixed(1)}pct（基期 ${prevPct.toFixed(1)}% 在区间内）`
    : verdict === 'BASE_IS_OUTLIER'
      ? `基期 ${prevPct.toFixed(1)}% 才是偏离项(自身历史区间 ${lo.toFixed(1)}–${hi.toFixed(1)}%)，`
        + `本期 ${currentPct.toFixed(1)}% 落在区间内 → 「同比变动是基期失真，不是本期改善」`
      : verdict === 'BOTH_OUTLIERS'
        ? '本期与基期均偏离自身历史 → 同比无参考价值，须逐期核对原始报表'
        : `本期与基期均落在自身历史区间 ${lo.toFixed(1)}–${hi.toFixed(1)}% 内 → 同比变动不构成跃升`
  return {
    baseQuarters: history.length, historyMedianPct: med,
    historyMinPct: lo, historyMaxPct: hi,
    currentDeviationPct: cd, prevDeviationPct: pd, verdict, note,
  }
}

export interface NodeProfit {
  mainlineId: string
  node: string
  members: MemberProfit[]
  /** 有可用单季净利同比的标的数 */
  usable: number
  /** 单季净利同比中位数 */
  medianNpYoy: number | null
  /**
   * 节点净利绝对增量合计（元）。**这一项才是"利润池迁移"的答案。**
   * 与增长率中位数常常方向相反，两者必须并列呈现，不得只显示其一。
   */
  npAbsDeltaSum: number | null
  /** ── A. 利润规模 ── 节点单季净利合计（元），绝对水平 */
  npLevelSum: number | null
  /** ── B. 利润份额（存量）── 该节点利润占本主线利润总额的份额 */
  levelShare: number | null
  /** ── C. 份额变化 ── 存量份额的历史序列（按季升序） */
  levelShareHistory: { label: string; share: number | null }[]
  /** 存量份额相对四季前的变化（pct点）。正=份额扩大 */
  levelShareDelta4Q: number | null
  /** 该节点增量占本主线全部正增量的份额。负增量节点为 null */
  deltaShareOfMainline: number | null
  /**
   * 增量份额的历史序列（按季升序）。**这一项才是"迁移"的直接证据。**
   *
   * 单季份额只是快照。真正的迁移应表现为：某节点的份额在连续几个季度里持续上升，
   * 而原核心节点的份额持续下降。若两者份额都稳定，则不存在迁移，只是全链同时扩张。
   *
   * 为什么必须看份额而不是增长率或增量本身：
   *   - 增长率偏袒小基数：新节点从 0.1 亿到 1 亿是 +900%，但只拿到主线增量的 2%；
   *   - 绝对增量偏袒在位者：光模块基数最大，几乎总会拿走最大增量；
   *   - **份额的变化方向**同时消掉这两种偏袒，因为它问的是"这一块蛋糕分配比例在怎么变"。
   */
  deltaShareHistory: { label: string; share: number | null }[]
  /** 加速的标的数 */
  accelerating: number
  /** 最旧的报告期距今天数 —— 节点整体的数据新鲜度 */
  maxReportAgeDays: number | null
  /**
   * 描述性标签。`LEVEL_ONLY` 表示有同比读数但加速度不可算（基期为负或缺一季），
   * 与 `NO_DATA` 必须区分 —— 混为一谈会让"高速增长但历史太短"被误读成"没有数据"。
   */
  status: 'ACCELERATING' | 'DECELERATING' | 'MIXED' | 'LEVEL_ONLY' | 'NO_DATA'
  /** 该节点是否只有研究域标的（即决策域尚未覆盖） */
  researchOnly: boolean
}

/** 份额历史回溯的季度数。8 季 = 两年，足以区分趋势与单季噪声 */
export const SHARE_HISTORY_QUARTERS = 8

function median(xs: number[]): number | null {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2
}

/**
 * 主线级数据完整度。
 *
 * 委员会 2026-08-13 第九节：「不知道，本身就是信息。」
 * AI电力产业验证 0/6、盈利验证 0/6、主线归因 0/6 时，系统必须显示
 * 「⚠ 当前结论不可用于机会判断」，**而不是给它一个 81 分**。
 *
 * `usableForOpportunity` 为 false 时，该主线的一切读数只能用于"这里需要研究"，
 * 不得用于"这里有机会"。这是一条**抑制**规则 —— 它只减少系统的发言权，不增加，
 * 因此不属于"新增决策规则"，不改变规则指纹。
 */
export interface MainlineDataQuality {
  mainlineId: string
  mainlineName: string
  memberCount: number
  industryVerified: number
  earningsVerified: number
  attributionVerified: number
  /** 三项验证的整体完整度 */
  completeness: number
  /** 报告期中位滞后天数 */
  medianReportAgeDays: number | null
  /** 是否可用于机会判断 */
  usableForOpportunity: boolean
  /** 不可用的原因。可用时为空 */
  blockers: string[]
}

export interface ProfitMap {
  today: string
  generatedAt: string
  /** 各主线数据完整度。必须显示在每张表最显眼处 */
  quality: MainlineDataQuality[]
  /** 数据新鲜度声明 —— 必须随地图一起呈现 */
  freshness: {
    withLatestHalfYear: number
    total: number
    medianReportAgeDays: number | null
    warning: string
  }
  nodes: NodeProfit[]
  /**
   * 同业当期毛利率对照。
   *
   * 回答的是「这次跃升是否行业性」—— 与"偏离自身历史"是两个不同的问题，
   * 两者都要看：只看自身历史无法区分公司特有事件与行业周期；
   * 只看同业无法区分本期跃升与基期失真。
   */
  peerGrossMargin: PeerGrossMargin
  unavailableFields: readonly string[]
}

export interface PeerGrossMargin {
  /** 有可比同比读数的家数 */
  total: number
  /** 本期偏离自身历史的家数 */
  currentOutliers: number
  /** 基期偏离自身历史的家数(其同比属失真) */
  baseOutliers: number
  medianYoyPct: number | null
  note: string
}

/**
 * @param mainlineId 限定同主线。拿一家存储公司去和光模块、电力设备比毛利率，
 *   回答的不是"是否行业性"，而是"A股半导体与新能源的毛利率是否一起动" ——
 *   那是另一个问题，而且噪声大得多。传 null 时才退回全域比较。
 */
export function buildPeerGrossMargin(
  nodes: NodeProfit[], mainlineId: string | null = null
): PeerGrossMargin {
  const scope = mainlineId === null ? nodes : nodes.filter(n => n.mainlineId === mainlineId)
  const ms = scope.flatMap(n => n.members).filter(m => m.grossMarginYoyPct != null)
  if (!ms.length) {
    return {
      total: 0, currentOutliers: 0, baseOutliers: 0, medianYoyPct: null,
      note: '无可比同业读数',
    }
  }
  const ys = ms.map(m => m.grossMarginYoyPct as number).sort((a, b) => a - b)
  const med = ys[Math.floor(ys.length / 2)]
  const cur = ms.filter(m => m.grossMarginAnomaly?.verdict === 'CURRENT_IS_OUTLIER').length
  const base = ms.filter(m => m.grossMarginAnomaly?.verdict === 'BASE_IS_OUTLIER').length
  return {
    total: ms.length, currentOutliers: cur, baseOutliers: base, medianYoyPct: med,
    note: `${mainlineId === null ? '全域' : mainlineId}口径 ${ms.length} 家有可比读数，`
      + `同比中位数 ${med > 0 ? '+' : ''}${med.toFixed(1)}pct；`
      + `其中 ${cur} 家本期偏离自身历史、${base} 家属基期失真。`
      + (base >= cur
        ? '「同业里基期失真的家数不少于本期偏离的家数」 —— '
        + '说明这批大幅同比读数里相当一部分并非当期改善，不足以支撑"行业性毛利扩张"。'
        : '同业中本期偏离者占多数，须进一步核对是否行业性因素。'),
  }
}

/**
 * 数据文件完整性检查：某个字段在全部记录里都是 null 时报出来。
 *
 * 存在理由是一次真实的静默故障：把 grossMarginCum 改名为 grossMarginCumPct
 * 之后，代码读新键、磁盘存旧键，于是 1826 个报告期的毛利率全部变成 null。
 * 没有任何报错 —— 只是所有毛利率读数悄悄消失，页面显示"基期缺失"，
 * 看起来像"数据源本来就没有这一项"。
 *
 * 「全 null 与部分 null 必须区别对待」：后者是正常的披露缺失
 * （一季报不披露扣非），前者几乎一定是代码与数据不匹配。
 */
export function findEmptyFields(f: ProfitFile): string[] {
  const all = f.records.flatMap(r => r.periods)
  const out: string[] = []

  // 逐季披露的字段：只要样本够，全 null 就是异常。
  // 4 期是最低样本 —— 少于此的小样本（单测 fixture）全 null 可能只是巧合。
  const everyQuarter: (keyof RawPeriod)[] = ['revenueCum', 'netProfitCum', 'grossMarginCumPct']
  if (all.length >= 4) {
    for (const k of everyQuarter) {
      if (all.every(p => p[k] == null)) {
        out.push(`${k}：${all.length} 个报告期全为 null。该字段每季披露，`
          + '全空几乎一定是代码与数据文件字段名不匹配，而不是数据源缺失该项')
      }
    }
  }

  // 扣非只在中报/年报披露，故只在"存在中报/年报期"的前提下检查那些期。
  // 按季度数拍一个阈值会同时产生误报与漏报；按披露节奏判断才是准的。
  const semiAnnual = all.filter(p => p.quarter === 2 || p.quarter === 4)
  if (semiAnnual.length >= 2 && semiAnnual.every(p => p.deductEps == null)) {
    out.push(`deductEps：${semiAnnual.length} 个中报/年报期全为 null。`
      + '该字段仅中报/年报披露，但这些期全空仍属异常')
  }
  return out
}

export function buildProfitMap(today: string, file?: ProfitFile): ProfitMap {
  const fromDisk = file === undefined
  const f = file ?? (JSON.parse(readFileSync(PROFIT_FILE, 'utf-8')) as ProfitFile)

  // 字段全 null 直接抛错而不是继续跑。继续跑的后果是每一处读数都显示"缺失"，
  // 而"缺失"是一个合法输出 —— 于是一个代码 bug 会被读成数据源的问题。
  //
  // 「只检查磁盘文件」：注入的 fixture 是调用方自己构造的，
  // 通常只填被测属性所需的字段，对它做完整性检查等于要求每个单测都填满全部字段。
  // 这道检查要防的是"改了字段名但没迁移数据文件"，那只发生在磁盘那一份上。
  if (fromDisk) {
    const empty = findEmptyFields(f)
    if (empty.length) {
      throw new Error(`利润数据文件字段异常：\n  ${empty.join('\n  ')}`)
    }
  }

  // 节点归属：决策域取 universe.ts，研究域取 nodeCandidates.ts
  const attribution = new Map<string, { node: string; mainlineId: string }>()
  for (const ml of MAINLINES) {
    for (const m of ml.members) attribution.set(m.code, { node: m.node, mainlineId: ml.id })
  }
  for (const c of NODE_CANDIDATES) {
    if (!attribution.has(c.code)) attribution.set(c.code, { node: c.node, mainlineId: c.mainlineId })
  }

  const members = f.records.map(r => {
    const a = attribution.get(r.code) ?? { node: '未归属', mainlineId: '未归属' }
    return computeMemberProfit(r, a.node, a.mainlineId, today)
  })

  const keys = [...new Set(members.map(m => `${m.mainlineId}|${m.node}`))].sort()
  const nodes: NodeProfit[] = keys.map(k => {
    const [mainlineId, node] = k.split('|')
    const ms = members.filter(m => m.mainlineId === mainlineId && m.node === node)
    const yoys = ms.map(m => m.latestSingle?.netProfitYoy).filter((x): x is number => x != null)
    const accels = ms.map(m => m.npYoyAccelPct).filter((x): x is number => x != null)
    const ages = ms.map(m => m.reportAgeDays).filter((x): x is number => x != null)
    const accelerating = accels.filter(a => a > 0).length
    const status: NodeProfit['status'] = accels.length === 0
      ? (yoys.length ? 'LEVEL_ONLY' : 'NO_DATA')
      : accelerating === accels.length ? 'ACCELERATING'
      : accelerating === 0 ? 'DECELERATING' : 'MIXED'
    const deltas = ms.map(m => m.npAbsDelta).filter((x): x is number => x != null)
    const levels = ms.map(m => m.latestSingle?.netProfit).filter((x): x is number => x != null)
    return {
      mainlineId, node, members: ms,
      usable: yoys.length,
      medianNpYoy: median(yoys),
      npLevelSum: levels.length ? levels.reduce((a, b) => a + b, 0) : null,
      levelShare: null,
      levelShareHistory: [],
      levelShareDelta4Q: null,
      npAbsDeltaSum: deltas.length ? deltas.reduce((a, b) => a + b, 0) : null,
      deltaShareOfMainline: null,
      deltaShareHistory: [],
      accelerating,
      maxReportAgeDays: ages.length ? Math.max(...ages) : null,
      status,
      researchOnly: ms.length > 0 && ms.every(m => m.scope === 'RESEARCH'),
    }
  })

  // 增量份额：分母取本主线全部**正**增量之和。用净额做分母会让一个亏损节点
  // 把其他节点的份额推过 100%，读起来像"某节点吃掉了全部利润"。
  for (const mlId of new Set(nodes.map(n => n.mainlineId))) {
    const inMl = nodes.filter(n => n.mainlineId === mlId)
    const posTotal = inMl.reduce((s, n) => s + Math.max(0, n.npAbsDeltaSum ?? 0), 0)
    if (posTotal <= 0) continue
    for (const n of inMl) {
      if (n.npAbsDeltaSum != null && n.npAbsDeltaSum > 0) n.deltaShareOfMainline = n.npAbsDeltaSum / posTotal
    }
  }

  // ── 公司在节点内的利润份额 ──
  // 分母取节点内**正**利润之和：若某公司亏损，用净额做分母会让其他公司份额超过 100%。
  for (const n of nodes) {
    const posTotal = n.members.reduce((s, m) => s + Math.max(0, m.latestSingle?.netProfit ?? 0), 0)
    if (posTotal <= 0) continue
    for (const m of n.members) {
      const v = m.latestSingle?.netProfit
      if (v != null && v > 0) m.shareWithinNode = v / posTotal
    }
  }

  // ── B. 存量份额（当季） ──
  for (const mlId of new Set(nodes.map(n => n.mainlineId))) {
    const inMl = nodes.filter(n => n.mainlineId === mlId)
    const posTotal = inMl.reduce((s, n) => s + Math.max(0, n.npLevelSum ?? 0), 0)
    if (posTotal <= 0) continue
    for (const n of inMl) {
      if (n.npLevelSum != null && n.npLevelSum > 0) n.levelShare = n.npLevelSum / posTotal
    }
  }

  // ── 增量份额的历史序列 ──
  // 对每个季度重算一次"节点增量 ÷ 主线正增量合计"。份额的变化方向才是迁移证据。
  const sqByCode = new Map<string, QuarterPoint[]>()
  for (const r of f.records) sqByCode.set(r.code, toSingleQuarter(r.periods))

  const allLabels = [...new Set([...sqByCode.values()].flat().map(q => q.label))].sort()
  const recentLabels = allLabels.slice(-SHARE_HISTORY_QUARTERS)

  for (const label of recentLabels) {
    const [yStr, qStr] = label.split('Q')
    const year = +yStr
    const quarter = +qStr
    const nodeDelta = new Map<string, number>()
    for (const n of nodes) {
      let sum: number | null = null
      for (const m of n.members) {
        const sq = sqByCode.get(m.code) ?? []
        const cur = sq.find(x => x.year === year && x.quarter === quarter)
        const base = sq.find(x => x.year === year - 1 && x.quarter === quarter)
        if (cur?.netProfit != null && base?.netProfit != null) {
          sum = (sum ?? 0) + (cur.netProfit - base.netProfit)
        }
      }
      if (sum !== null) nodeDelta.set(`${n.mainlineId}|${n.node}`, sum)
    }
    for (const mlId of new Set(nodes.map(n => n.mainlineId))) {
      const inMl = nodes.filter(n => n.mainlineId === mlId)
      const reporting = inMl.filter(n => nodeDelta.has(`${n.mainlineId}|${n.node}`)).length
      const posTotal = inMl.reduce((s, n) => s + Math.max(0, nodeDelta.get(`${n.mainlineId}|${n.node}`) ?? 0), 0)
      // 财报披露期内只有少数节点出报表时，份额分母不完整 —— 首个披露者会显示接近 100%，
      // 那是披露顺序的伪影，不是利润迁移。少于 3 个节点有数据时整季置空。
      const usableSeason = reporting >= 3
      for (const n of inMl) {
        const d = nodeDelta.get(`${n.mainlineId}|${n.node}`)
        n.deltaShareHistory.push({
          label,
          share: usableSeason && d != null && posTotal > 0 ? Math.max(0, d) / posTotal : null,
        })
      }
    }
  }

  // ── C. 存量份额的历史序列 ──
  // 与增量份额同样受披露顺序影响：财报季只有少数节点出报表时，分母不完整。
  for (const label of recentLabels) {
    const [yStr, qStr] = label.split('Q')
    const year = +yStr
    const quarter = +qStr
    const nodeLevel = new Map<string, number>()
    for (const n of nodes) {
      let sum: number | null = null
      for (const m of n.members) {
        const sq = sqByCode.get(m.code) ?? []
        const cur = sq.find(x => x.year === year && x.quarter === quarter)
        if (cur?.netProfit != null) sum = (sum ?? 0) + cur.netProfit
      }
      if (sum !== null) nodeLevel.set(`${n.mainlineId}|${n.node}`, sum)
    }
    for (const mlId of new Set(nodes.map(n => n.mainlineId))) {
      const inMl = nodes.filter(n => n.mainlineId === mlId)
      const reporting = inMl.filter(n => nodeLevel.has(`${n.mainlineId}|${n.node}`)).length
      const posTotal = inMl.reduce((s, n) => s + Math.max(0, nodeLevel.get(`${n.mainlineId}|${n.node}`) ?? 0), 0)
      const usableSeason = reporting >= 3
      for (const n of inMl) {
        const v = nodeLevel.get(`${n.mainlineId}|${n.node}`)
        n.levelShareHistory.push({
          label,
          share: usableSeason && v != null && posTotal > 0 ? Math.max(0, v) / posTotal : null,
        })
      }
    }
  }

  // 份额变化：与四季前同比，避开季节性
  for (const n of nodes) {
    const h = n.levelShareHistory.filter(x => x.share !== null)
    if (h.length >= 5) {
      const last = h[h.length - 1].share!
      const prior = h[h.length - 5].share!
      n.levelShareDelta4Q = (last - prior) * 100
    }
  }

  const ages = members.map(m => m.reportAgeDays).filter((x): x is number => x != null)
  const withH1 = members.filter(m => m.latestReport && m.latestReport >= `${today.slice(0, 4)}-06-30`).length

  // ── 主线数据完整度 ──
  const quality: MainlineDataQuality[] = MAINLINES.map(ml => {
    const n = ml.members.length
    const ind = ml.members.filter(m => m.industryVerified).length
    const earn = ml.members.filter(m => m.earningsVerified).length
    const attr = ml.members.filter(m => m.mainlineAttributionVerified === true).length
    const codes = new Set(ml.members.map(m => m.code))
    const mlAges = members.filter(m => codes.has(m.code)).map(m => m.reportAgeDays)
      .filter((x): x is number => x != null)
    const completeness = n > 0 ? (ind + earn + attr) / (n * 3) : 0
    const blockers: string[] = []
    if (ind === 0) blockers.push(`产业验证 0/${n}`)
    if (earn === 0) blockers.push(`盈利验证 0/${n}`)
    if (attr === 0) blockers.push(`主线归因 0/${n}`)
    if (completeness < 0.2) blockers.push(`三项验证完整度仅 ${(completeness * 100).toFixed(0)}%`)
    return {
      mainlineId: ml.id, mainlineName: ml.name, memberCount: n,
      industryVerified: ind, earningsVerified: earn, attributionVerified: attr,
      completeness,
      medianReportAgeDays: median(mlAges),
      usableForOpportunity: blockers.length === 0,
      blockers,
    }
  })

  return {
    today,
    generatedAt: f.generatedAt,
    quality,
    freshness: {
      withLatestHalfYear: withH1,
      total: members.length,
      medianReportAgeDays: median(ages),
      warning:
        `仅 ${withH1}/${members.length} 只已披露最新半年报，中位滞后 ${median(ages) ?? '—'} 天。` +
        '利润雷达一年只更新四次，结构上不可能每天变化；把它放进每日表会让日间变动全部来自价格。',
    },
    nodes,
    peerGrossMargin: buildPeerGrossMargin(nodes),
    unavailableFields: f.methodology.unavailable,
  }
}
