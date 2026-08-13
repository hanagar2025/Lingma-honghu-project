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
  /** 累计毛利率及其同比变化（pct点） */
  grossMargin: number | null
  grossMarginYoyPct: number | null
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
  if (latest) {
    const lastYearSame = rec.periods.find(p => p.year === latest.year - 1 && p.quarter === latest.quarter)
    if (latest.grossMarginCum != null && lastYearSame?.grossMarginCum != null) {
      gmYoy = latest.grossMarginCum - lastYearSame.grossMarginCum
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
    grossMargin: latest?.grossMarginCum ?? null,
    grossMarginYoyPct: gmYoy,
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
  unavailableFields: readonly string[]
}

export function buildProfitMap(today: string, file?: ProfitFile): ProfitMap {
  const f = file ?? (JSON.parse(readFileSync(PROFIT_FILE, 'utf-8')) as ProfitFile)

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
    unavailableFields: f.methodology.unavailable,
  }
}
