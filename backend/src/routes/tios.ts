import { Router, Request, Response } from 'express'
import { generateDailyReport, DailyReportInput } from '../services/tios/dailyReport'
import { riskReward } from '../services/tios/gates'

const router = Router()

/**
 * 生成盘前四问决策单（闭环第③步）
 * Body: DailyReportInput（行情K线、持仓、规则卡、账户快照、前日确认阶段）
 */
router.post('/daily-report', (req: Request, res: Response) => {
  try {
    const input = req.body as DailyReportInput
    if (!input?.date || !input?.indexBars?.length || !input?.snapshot || !input?.positions) {
      return res.status(400).json({ error: '缺少必要字段：date / indexBars / snapshot / positions' })
    }
    const report = generateDailyReport(input)
    return res.json(report)
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message })
  }
})

/**
 * 赔率计算（每笔买入指令必须附RR记录）
 * Body: { current, targetPrice, defensePrice }
 */
router.post('/risk-reward', (req: Request, res: Response) => {
  const { current, targetPrice, defensePrice } = req.body ?? {}
  if (![current, targetPrice, defensePrice].every(v => typeof v === 'number' && v > 0)) {
    return res.status(400).json({ error: 'current / targetPrice / defensePrice 必须为正数' })
  }
  return res.json(riskReward(current, targetPrice, defensePrice))
})

export default router
