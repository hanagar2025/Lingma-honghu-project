import { Router, Response } from 'express'
import { generateDailyReport, DailyReportInput } from '../services/tios/dailyReport'
import { riskReward } from '../services/tios/gates'
import { getLatestReport, getReportHistory, loadPositions, loadRuleCards, runDailyPipeline, STAGE_INDEX_CODE } from '../services/tiosService'
import { getConnection } from '../config/database'
import { asyncHandler, createError } from '../middleware/errorHandler'
import { authenticateToken } from '../middleware/auth'
import type { AuthRequest } from '../middleware/auth'

const router = Router()

// ============ 闭环主流程 ============

/** 一键运行：同步真实K线 → 生成盘前四问 → 入库留痕（闭环①②③） */
router.post('/run', authenticateToken, asyncHandler(async (req: AuthRequest, res: Response) => {
  const result = await runDailyPipeline(req.user!.id, { skipSync: req.body?.skipSync === true })
  res.json({ success: true, data: result })
}))

/** 最新盘前四问报告 */
router.get('/report/latest', authenticateToken, asyncHandler(async (req: AuthRequest, res: Response) => {
  const report = await getLatestReport(req.user!.id)
  res.json({ success: true, data: report })
}))

/** 历史报告列表 */
router.get('/reports', authenticateToken, asyncHandler(async (req: AuthRequest, res: Response) => {
  const limit = Number(req.query.limit) || 30
  const history = await getReportHistory(req.user!.id, limit)
  res.json({ success: true, data: history })
}))

// ============ 规则卡（一股一卡） ============

router.get('/rule-cards', authenticateToken, asyncHandler(async (req: AuthRequest, res: Response) => {
  const positions = await loadPositions(req.user!.id)
  const cards = await loadRuleCards(req.user!.id, positions.map(p => p.code))
  res.json({ success: true, data: Object.values(cards) })
}))

router.put('/rule-cards/:code', authenticateToken, asyncHandler(async (req: AuthRequest, res: Response) => {
  const { code } = req.params
  const { hardStopPct, crashPct, banBuy, banReason, pendingCrashExecutions } = req.body ?? {}
  if (hardStopPct !== undefined && !(hardStopPct > 0 && hardStopPct < 1)) throw createError('hardStopPct 必须在(0,1)之间', 400)
  if (crashPct !== undefined && !(crashPct > 0 && crashPct < 1)) throw createError('crashPct 必须在(0,1)之间', 400)
  const conn = getConnection()
  await conn.execute(
    `INSERT INTO rule_cards (user_id, stock_code, hard_stop_pct, crash_pct, ban_buy, ban_reason, pending_crash_executions)
     VALUES (?, ?, COALESCE(?, 0.25), COALESCE(?, 0.12), COALESCE(?, 0), ?, COALESCE(?, 0))
     ON DUPLICATE KEY UPDATE
       hard_stop_pct = COALESCE(?, hard_stop_pct),
       crash_pct = COALESCE(?, crash_pct),
       ban_buy = COALESCE(?, ban_buy),
       ban_reason = COALESCE(?, ban_reason),
       pending_crash_executions = COALESCE(?, pending_crash_executions)`,
    [
      req.user!.id, code,
      hardStopPct ?? null, crashPct ?? null, banBuy === undefined ? null : banBuy ? 1 : 0, banReason ?? null, pendingCrashExecutions ?? null,
      hardStopPct ?? null, crashPct ?? null, banBuy === undefined ? null : banBuy ? 1 : 0, banReason ?? null, pendingCrashExecutions ?? null,
    ]
  )
  res.json({ success: true, message: '规则卡已更新' })
}))

// ============ 账户状态（现金/峰值，用于组合熔断） ============

router.get('/account', authenticateToken, asyncHandler(async (req: AuthRequest, res: Response) => {
  const conn = getConnection()
  const [rows] = await conn.execute('SELECT cash, peak_assets as peakAssets FROM account_state WHERE user_id = ?', [req.user!.id])
  const arr = rows as { cash: string; peakAssets: string }[]
  res.json({
    success: true,
    data: {
      cash: arr.length ? Number(arr[0].cash) : 0,
      peakAssets: arr.length ? Number(arr[0].peakAssets) : 0,
      stageIndexCode: STAGE_INDEX_CODE,
    },
  })
}))

router.put('/account', authenticateToken, asyncHandler(async (req: AuthRequest, res: Response) => {
  const { cash, peakAssets } = req.body ?? {}
  if (cash !== undefined && !(typeof cash === 'number' && cash >= 0)) throw createError('cash 必须为非负数', 400)
  if (peakAssets !== undefined && !(typeof peakAssets === 'number' && peakAssets >= 0)) throw createError('peakAssets 必须为非负数', 400)
  const conn = getConnection()
  await conn.execute(
    `INSERT INTO account_state (user_id, cash, peak_assets) VALUES (?, COALESCE(?, 0), COALESCE(?, 0))
     ON DUPLICATE KEY UPDATE cash = COALESCE(?, cash), peak_assets = COALESCE(?, peak_assets)`,
    [req.user!.id, cash ?? null, peakAssets ?? null, cash ?? null, peakAssets ?? null]
  )
  res.json({ success: true, message: '账户状态已更新' })
}))

// ============ 执行记录（闭环④：应执行 vs 实际执行） ============

router.get('/executions', authenticateToken, asyncHandler(async (req: AuthRequest, res: Response) => {
  const conn = getConnection()
  const [rows] = await conn.execute(
    `SELECT id, DATE_FORMAT(report_date, '%Y-%m-%d') as reportDate, stock_code as stockCode,
            clause, required_action as requiredAction, executed, note
     FROM trade_executions WHERE user_id = ? ORDER BY report_date DESC, id DESC LIMIT 100`,
    [req.user!.id]
  )
  res.json({ success: true, data: rows })
}))

router.put('/executions/:id', authenticateToken, asyncHandler(async (req: AuthRequest, res: Response) => {
  const { executed, note } = req.body ?? {}
  const conn = getConnection()
  const [result] = await conn.execute(
    'UPDATE trade_executions SET executed = ?, note = ? WHERE id = ? AND user_id = ?',
    [executed ? 1 : 0, note ?? null, req.params.id, req.user!.id]
  )
  if ((result as { affectedRows: number }).affectedRows === 0) throw createError('执行记录不存在', 404)
  res.json({ success: true, message: '执行记录已更新' })
}))

/** 执行率统计：铁律遵守度是体系有效性的核心反馈指标 */
router.get('/executions/stats', authenticateToken, asyncHandler(async (req: AuthRequest, res: Response) => {
  const conn = getConnection()
  const [rows] = await conn.execute(
    'SELECT COUNT(*) as total, SUM(executed) as done FROM trade_executions WHERE user_id = ?',
    [req.user!.id]
  )
  const arr = rows as { total: number; done: string | null }[]
  const total = Number(arr[0]?.total ?? 0)
  const done = Number(arr[0]?.done ?? 0)
  res.json({ success: true, data: { total, done, rate: total > 0 ? done / total : 1 } })
}))

// ============ 无状态工具接口 ============

/** 直接传入完整输入生成盘前四问（用于回测/自测，不入库） */
router.post('/daily-report', asyncHandler(async (req, res: Response) => {
  const input = req.body as DailyReportInput
  if (!input?.date || !input?.indexBars?.length || !input?.snapshot || !input?.positions) {
    throw createError('缺少必要字段：date / indexBars / snapshot / positions', 400)
  }
  res.json(generateDailyReport(input))
}))

/** 赔率计算（每笔买入指令必须附RR记录） */
router.post('/risk-reward', asyncHandler(async (req, res: Response) => {
  const { current, targetPrice, defensePrice } = req.body ?? {}
  if (![current, targetPrice, defensePrice].every(v => typeof v === 'number' && v > 0)) {
    throw createError('current / targetPrice / defensePrice 必须为正数', 400)
  }
  res.json(riskReward(current, targetPrice, defensePrice))
}))

export default router
