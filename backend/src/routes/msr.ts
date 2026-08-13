// MSR API —— 主线内部轮动雷达
// 与 TPO/TIOS 对偶：TIOS 回答"谁失去势能"，MSR 回答"谁获得势能"。
// 建仓输出受执行台账约束：未执行卖出指令数由 trade_executions 实时统计，不接受客户端传入。

import { Router } from 'express'
import { getConnection } from '../config/database'
import { authenticateToken, type AuthRequest } from '../middleware/auth'
import { asyncHandler } from '../middleware/errorHandler'
import { fetchDailyBars, getBarsFromDB } from '../services/marketData'
import { runMsr, WINDOW_TEXT, BLOCK_TEXT } from '../services/msr'
import { loadValuationMap, VALUATION_FILE } from '../services/msr/valuation'
import { EVIDENCE_DEFINITION, MAINLINES, allBenchmarks, allCodes } from '../services/msr/universe'
import type { DailyBar } from '../services/tios/types'
import { logger } from '../utils/logger'

const router = Router()

/** 扫描域与口径说明（无需鉴权，便于核对配置） */
router.get('/universe', (_req, res) => {
  res.json({
    success: true,
    data: {
      mainlines: MAINLINES.map(m => ({
        id: m.id, name: m.name, strategicStars: m.strategicStars, benchmark: m.benchmark,
        members: m.members,
      })),
      evidenceDefinition: EVIDENCE_DEFINITION,
      windowStates: WINDOW_TEXT,
      blockReasons: BLOCK_TEXT,
    },
  })
})

/** 统计未执行的卖出指令数 —— MSR 建仓闸门的唯一输入，不可由外部覆盖 */
async function countPendingSells(userId: string): Promise<number> {
  const conn = getConnection()
  const [rows] = await conn.execute(
    `SELECT COUNT(*) AS cnt FROM trade_executions
     WHERE user_id = ? AND action <> 'NONE' AND executed = 0`,
    [userId]
  )
  const r = (rows as { cnt: number | string }[])[0]
  return Number(r?.cnt ?? 0)
}

/**
 * 运行 MSR 扫描。
 * live=1 时直连行情源取K线（盘后复跑用）；否则优先读库，缺失再回源。
 */
router.post('/scan', authenticateToken, asyncHandler(async (req: AuthRequest, res) => {
  const userId = req.user!.id
  const live = req.query.live === '1' || req.body?.live === true
  const codes = allCodes()
  const benchmarks = allBenchmarks()

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
      logger.warn(`MSR K线缺失 ${c}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  for (const b of benchmarks) {
    try {
      let bars = live ? [] : await getBarsFromDB(b, 200)
      if (bars.length < 65) bars = await fetchDailyBars(b, 200)
      indexBarsByCode[b] = bars
    } catch (e) {
      missing.push(b)
    }
  }

  const pendingSellCount = await countPendingSells(userId)
  const anyBars = Object.values(barsByCode).find(b => b.length > 0)
  const date = anyBars ? anyBars[anyBars.length - 1].date : new Date().toISOString().slice(0, 10)

  // PE历史分位由 npm run msr:valuation 离线生成。文件缺失时估值维度记0并阻断S3，不静默放行。
  const valuationByCode = loadValuationMap(VALUATION_FILE)
  const report = runMsr({ date, barsByCode, indexBarsByCode, pendingSellCount, valuationByCode })
  res.json({
    success: true,
    data: {
      ...report, missing, windowText: WINDOW_TEXT, blockText: BLOCK_TEXT,
      valuationLoaded: Object.keys(valuationByCode).length,
      valuationUsable: Object.values(valuationByCode).filter(v => v.usable).length,
    },
  })
}))

export default router
