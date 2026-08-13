// 驾驶舱 API —— 每天只回答六个问题
//
// 一个 GET 就把六问、首页单表、今日核心决策、动作清单、数据缺口全部返回。
// 前端不做任何判断逻辑：所有阈值、灯色、法定理由都在后端定死，
// 否则"规则"会分裂成两份，而分裂的规则等于没有规则。

import { Router } from 'express'
import { getConnection } from '../config/database'
import { authenticateToken, type AuthRequest } from '../middleware/auth'
import { asyncHandler } from '../middleware/errorHandler'
import { countPendingSells, listPendingSells } from '../services/executionLedger'
import { fetchDailyBars, getBarsFromDB } from '../services/marketData'
import { runCockpit } from '../services/cockpit'
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

  res.json({
    success: true,
    data: {
      ...report,
      pendingSells,
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

export default router
