// 驾驶舱 API —— 每天只回答六个问题
//
// 一个 GET 就把六问、首页单表、今日核心决策、动作清单、数据缺口全部返回。
// 前端不做任何判断逻辑：所有阈值、灯色、法定理由都在后端定死，
// 否则"规则"会分裂成两份，而分裂的规则等于没有规则。

import { Router } from 'express'
import { getConnection } from '../config/database'
import { authenticateToken, type AuthRequest } from '../middleware/auth'
import { asyncHandler } from '../middleware/errorHandler'
import { countPendingSells, listPendingSells, listAllRequiredActions } from '../services/executionLedger'
import { fetchDailyBars, getBarsFromDB } from '../services/marketData'
import { runCockpit } from '../services/cockpit'
import { buildDashboard, type SessionKind } from '../services/cockpit/dashboard'
import { renderDashboard } from '../services/cockpit/renderDashboard'
import { buildVerdict } from '../services/cockpit/verdict'
import { buildBrief } from '../services/cockpit/share'
import type { MomentumRow } from '../services/cockpit/momentum'
import {
  snapshotOf, diffSnapshots, saveSnapshot, loadPrevSnapshot,
  loadDiscovery, updateDiscovery, saveDiscovery, stageAdvances, isIntraday,
  loadAllSnapshots, driftOver,
  type Change, type DiscoveryLedger,
} from '../services/governance/changeLog'
import { buildProfitMap, type ProfitMap } from '../services/research/profitRadar'
import type { MsrReport } from '../services/msr'
import { buildAudit, computeKpis, renderAuditMarkdown, type CostSnapshot } from '../services/governance/audit'
import { saveAudit, loadAudits, loadAuditMarkdown } from '../services/governance/auditStore'
import { fingerprint } from '../services/governance/ruleRegistry'
import { loadBaseline } from '../services/governance/freeze'
import { ACTION_TEXT, LEGAL_REASON_TEXT, LIGHT_TEXT, EVIDENCE_TIER_TEXT } from '../services/cockpit/types'
import { NODE_TAXONOMY } from '../services/cockpit/nodes'
import { LIMITS } from '../services/cockpit/safety'
import { loadValuationMap, VALUATION_FILE } from '../services/msr/valuation'
import { allBenchmarks, allCodes } from '../services/msr/universe'
import { loadPositions, buildSnapshot, getLatestConfirmedStage } from '../services/tiosService'
import type { DailyBar } from '../services/tios/types'
import { logger } from '../utils/logger'

const router = Router()

/** 口径说明：阈值、灯色、法定理由、节点分类表 —— 便于核对，无需鉴权 */
router.get('/spec', (_req, res) => {
  res.json({
    success: true,
    data: {
      limits: LIMITS,
      lightText: LIGHT_TEXT,
      actionText: ACTION_TEXT,
      legalReasonText: LEGAL_REASON_TEXT,
      evidenceTierText: EVIDENCE_TIER_TEXT,
      nodeTaxonomy: NODE_TAXONOMY,
    },
  })
})

/** 家庭年度刚性支出 —— 安全垫的唯一输入。未设置时驾驶舱按数据缺失处理，不猜 */
async function loadHouseholdExpense(userId: string): Promise<number | undefined> {
  const conn = getConnection()
  try {
    const [rows] = await conn.execute(
      'SELECT household_annual_expense AS v FROM account_state WHERE user_id = ?',
      [userId]
    )
    const v = (rows as { v: number | string | null }[])[0]?.v
    const n = v === null || v === undefined ? NaN : Number(v)
    return Number.isFinite(n) && n > 0 ? n : undefined
  } catch {
    // 列可能尚未迁移。缺失即缺失，交由 safety.ts 判为 UNKNOWN
    return undefined
  }
}

/**
 * 今日驾驶舱。
 * live=1 直连行情源（盘后复跑）；否则优先读库，不足再回源。
 */
router.get('/today', authenticateToken, asyncHandler(async (req: AuthRequest, res) => {
  const userId = req.user!.id
  const live = req.query.live === '1'

  const positions = await loadPositions(userId)

  // 扫描域 = MSR 全域 ∪ 持仓（持仓可能有尚未纳入主线地图的标的）
  const codes = Array.from(new Set([...allCodes(), ...positions.map(p => p.code)]))
  const benchmarks = Array.from(new Set([...allBenchmarks(), 'sz399006']))

  const barsByCode: Record<string, DailyBar[]> = {}
  const indexBarsByCode: Record<string, DailyBar[]> = {}
  const missing: string[] = []

  for (const c of codes) {
    try {
      let bars = live ? [] : await getBarsFromDB(c, 200)
      if (bars.length < 65) bars = await fetchDailyBars(c, 200)
      barsByCode[c] = bars
    } catch (e) {
      missing.push(c)
      logger.warn(`驾驶舱K线缺失 ${c}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  for (const b of benchmarks) {
    try {
      let bars = live ? [] : await getBarsFromDB(b, 200)
      if (bars.length < 65) bars = await fetchDailyBars(b, 200)
      indexBarsByCode[b] = bars
    } catch {
      missing.push(b)
    }
  }

  const anyBars = Object.values(barsByCode).find(b => b.length > 0)
  const date = anyBars ? anyBars[anyBars.length - 1].date : new Date().toISOString().slice(0, 10)

  const snapshot = await buildSnapshot(userId, date, positions)
  const pendingSellCount = await countPendingSells(userId)
  const pendingSells = await listPendingSells(userId)
  const householdAnnualExpense = await loadHouseholdExpense(userId)
  const valuationByCode = loadValuationMap(VALUATION_FILE)

  // 市场阶段：沿用 TIOS 已确认阶段。下跌期不允许建仓；**未确认时同样不允许**（从严）
  const stage = await getLatestConfirmedStage(userId)
  const marketAllows = stage === 'uptrend' || stage === 'range'

  const report = runCockpit({
    date, snapshot, positions, barsByCode, indexBarsByCode,
    pendingSellCount, valuationByCode, householdAnnualExpense, marketAllows,
  })

  // ── 决策审计：每次运行自动落一条（同日覆盖） ──
  // 成本快照用总成本而非市值：总成本不随价格波动，其上升唯一对应"发生了买入"，
  // 是 E3 检出未授权买入的依据。
  const costSnapshot: CostSnapshot[] = positions.map(p => ({
    code: p.code, name: p.name, totalCost: p.cost,
  }))
  const audit = buildAudit({ report, costSnapshot })
  const auditMd = renderAuditMarkdown(audit)
  try {
    await saveAudit(userId, audit, auditMd)
  } catch (e) {
    logger.warn(`决策审计落库失败（不影响当日决策输出）：${e instanceof Error ? e.message : String(e)}`)
  }

  // ── KPI E1–E4 ──
  const requiredActions = await listAllRequiredActions(userId)
  const history = await loadAudits(userId, 60)
  const kpi = computeKpis({
    today: date,
    requiredActions,
    dataChecks: buildDataChecks(report, snapshot, householdAnnualExpense, valuationByCode),
    e3: {
      audits: history.map(h => ({
        date: h.date,
        buyFrozen: h.buyFrozen,
        costSnapshot: h.costSnapshot,
        // 类型层已保证动作必带法定理由；此处校验的是历史记录是否完整
        allActionsHadLegalReason: h.why !== undefined,
        ruleDrifted: h.rules?.drift?.drifted ?? false,
      })),
    },
  })

  // ── 五层驾驶舱 ──
  // 利润结构地图按季更新，取不到时降级为"数据缺失"而不是静默省略整张表：
  // 少一张表读者不会察觉，写着"缺失"才会去补数据。
  let profit: ProfitMap | null = null
  try {
    profit = buildProfitMap(date)
  } catch (e) {
    logger.warn(`利润结构地图不可用（先跑 profit:fetch）：${e instanceof Error ? e.message : String(e)}`)
  }
  const internals = report.internals as
    | { momentumRows: MomentumRow[]; msr: MsrReport; nodes: unknown[] }
    | undefined
  const session: SessionKind = req.query.session === 'pre' ? 'PRE_OPEN' : 'POST_CLOSE'
  const dashboard = internals
    ? buildDashboard({
      // 上限分母改用组合口径（8/15 裁定）。数据库尚无 external_cash 列，
      // 故 portfolioTotal 目前退化为账户口径 —— 由 tiosService 显式标注。
      date, session, positions, portfolioTotal: snapshot.portfolioTotal,
      assetBreakdown: {
        positionsValue: snapshot.positionsValue,
        brokerCash: snapshot.cash,
        externalCash: snapshot.externalCash,
        brokerTotal: snapshot.brokerTotal,
        peakBasis: snapshot.peakBasis,
        peak: snapshot.peakAssets,
      },
      barsByCode, indexBarsByCode, marketBars: indexBarsByCode['sz399006'],
      valuationByCode,
      momentumRows: internals.momentumRows,
      msr: internals.msr,
      profit,
      actions: report.actions,
      pendingSellCount,
      noNewEntryReasons: report.noNewEntry.reasons,
      dataGaps: report.dataGaps,
    })
    : null

  // ── 变化台账 ──
  // 只在盘后落档：盘中读数会污染日间序列。接口调用不写盘也不影响决策，
  // 但会让 Discovery KPI 少一天样本，所以失败要记日志而不是静默跳过。
  //
  // `session` 只反映前端选了哪个视图，**不代表现在真的收盘了**：
  // 用户在 11:16 打开页面（默认盘后视图）时，最新K线是当日未定价的那一根。
  // 若照写，盘中值就成了"当日收盘"，且 30 天后无法事后分辨 —— 故须用时间闸门另判一次。
  const intraday = isIntraday(date)
  let changes: Change[] = []
  let prevDate: string | null = null
  let discovery: DiscoveryLedger = { updatedAt: '', entries: [] }
  if (dashboard) {
    try {
      const snap = snapshotOf(dashboard)
      const prev = loadPrevSnapshot(snap.date)
      prevDate = prev?.date ?? null
      changes = prev ? diffSnapshots(prev, snap) : []
      discovery = updateDiscovery(loadDiscovery(), dashboard)
      if (session === 'POST_CLOSE' && !intraday) {
        saveSnapshot(snap)
        saveDiscovery(discovery)
      }
    } catch (e) {
      logger.warn(`变化台账写入失败（不影响当日决策输出）：${e instanceof Error ? e.message : String(e)}`)
    }
  }

  // 今日结论。三个出口（网页/HTML/命令行）必须给出同一份结论，
  // 否则会各说一套，而"到底听哪个"这种问题一旦出现，纪律就没了。
  const allSnaps = loadAllSnapshots()
  const verdict = dashboard
    ? buildVerdict({
      dashboard,
      actions: report.actions,
      actionText: ACTION_TEXT,
      drift: driftOver(allSnaps),
      driftSnapshotCount: allSnaps.length,
      driftFrom: allSnaps[0]?.date,
      driftTo: allSnaps[allSnaps.length - 1]?.date,
    })
    : null

  res.json({
    success: true,
    data: {
      ...report,
      dashboard,
      verdict,
      // 外发摘要由后端统一生成：前端若自己拼，同一份数据会有两套措辞，
      // 而其中一套迟早会漏掉那段约束前言。默认脱敏，不含金额与总资产。
      brief: dashboard
        ? buildBrief({ dashboard, verdict, includeAmounts: false })
        : null,
      dashboardText: dashboard ? renderDashboard(dashboard) : null,
      changes: { prevDate, items: changes },
      // 盘中标记必须随数据一起下发：前端若只看到数字，会把未定价读数当收盘读数用
      provisional: {
        intraday,
        archived: session === 'POST_CLOSE' && !intraday,
        note: intraday
          ? `最新K线 ${date} 尚未收盘，本页读数为临时值（仓位%、相对强度、成交比值都会随收盘变化），且未写入30天档案。`
          : '',
      },
      discovery: {
        nodeCount: discovery.entries.length,
        advances: stageAdvances(discovery),
        firstSeenToday: discovery.entries.filter(e => e.firstSeen === date).map(e => e.key),
      },
      pendingSells,
      audit,
      auditMarkdown: auditMd,
      kpi,
      freeze: { baseline: loadBaseline(), current: fingerprint() },
      marketStage: stage ?? '未确认（按不允许建仓处理）',
      missing,
      limits: LIMITS,
      lightText: LIGHT_TEXT,
      actionText: ACTION_TEXT,
      legalReasonText: LEGAL_REASON_TEXT,
      evidenceTierText: EVIDENCE_TIER_TEXT,
      valuationUsable: Object.values(valuationByCode).filter(v => v.usable).length,
      valuationLoaded: Object.keys(valuationByCode).length,
    },
  })
}))

/**
 * E2 数据完整度的检查清单。
 *
 * 逐项列出"决策需要但可能缺失"的数据。刻意做成显式清单而非"报告里有几条缺口"，
 * 因为后者会随文案变化而漂移，无法跨月比较。
 */
function buildDataChecks(
  report: { dataGaps: string[] },
  snapshot: { peakAssets: number },
  householdAnnualExpense: number | undefined,
  valuationByCode: Record<string, { usable: boolean }>
): { name: string; present: boolean }[] {
  const usable = Object.values(valuationByCode).filter(v => v.usable).length
  const loaded = Object.keys(valuationByCode).length
  return [
    { name: '家庭年度刚性支出', present: householdAnnualExpense !== undefined },
    { name: '净值峰值', present: snapshot.peakAssets > 0 },
    { name: 'PE历史分位（≥90%标的可用）', present: loaded > 0 && usable / loaded >= 0.9 },
    { name: '资金结构数据（北向/融资/龙虎榜/机构持仓）', present: false },
    { name: '扣非利润与主线收入占比', present: false },
    { name: '产业链节点全覆盖', present: !report.dataGaps.some(g => g.includes('无覆盖标的')) },
  ]
}

/** 历史审计（Markdown），供三个月后回看 */
router.get('/audit/:date', authenticateToken, asyncHandler(async (req: AuthRequest, res) => {
  const md = await loadAuditMarkdown(req.user!.id, req.params.date)
  if (md === null) {
    res.status(404).json({ success: false, error: { message: `${req.params.date} 无审计记录` } })
    return
  }
  res.json({ success: true, data: { date: req.params.date, markdown: md } })
}))

/** 审计序列，用于观察 30 个交易日的连续性 */
router.get('/audits', authenticateToken, asyncHandler(async (req: AuthRequest, res) => {
  const limit = Math.min(Number(req.query.limit ?? 60), 200)
  const audits = await loadAudits(req.user!.id, limit)
  res.json({
    success: true,
    data: audits.map(a => ({
      date: a.date,
      coreDecision: a.coreDecision,
      buyFrozen: a.buyFrozen,
      executionDebt: a.actions.executionDebt,
      newEntries: a.actions.newEntries,
      legalReduces: a.actions.legalReduces.length,
      reviewedNoAction: a.actions.reviewedNoAction.length,
      fingerprint: a.rules.fingerprint.hash,
      drifted: a.rules.drift?.drifted ?? null,
    })),
  })
}))

export default router
