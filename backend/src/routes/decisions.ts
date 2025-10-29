import { Router } from 'express'
import { asyncHandler, createError } from '../middleware/errorHandler'
import { authenticateToken } from '../middleware/auth'
import type { AuthRequest } from '../middleware/auth'
import { DecisionEngine } from '../services/decisionEngine'

const router = Router()

// 生成投资决策
router.post('/generate', authenticateToken, asyncHandler(async (req: AuthRequest, res) => {
  const userId = req.user?.id
  const { timeHorizon = 'daily' } = req.body

  if (!userId) {
    throw createError('用户未认证', 401)
  }

  try {
    const decision = await DecisionEngine.generateFinalDecision(userId, timeHorizon)
    
    res.json({
      success: true,
      data: decision
    })
  } catch (error) {
    throw createError('生成投资决策失败', 500)
  }
}))

// 获取历史决策
router.get('/history', authenticateToken, asyncHandler(async (req: AuthRequest, res) => {
  const userId = req.user?.id
  const { page = 1, limit = 10, timeHorizon } = req.query

  if (!userId) {
    throw createError('用户未认证', 401)
  }

  try {
    const { getConnection } = await import('../config/database')
    const connection = getConnection()
    
    let query = 'SELECT * FROM decisions WHERE user_id = ?'
    const params: any[] = [userId]
    
    if (timeHorizon) {
      query += ' AND decision_type = ?'
      params.push(timeHorizon)
    }
    
    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?'
    params.push(parseInt(limit as string), (parseInt(page as string) - 1) * parseInt(limit as string))
    
    const [decisions] = await connection.execute(query, params)
    
    res.json({
      success: true,
      data: {
        decisions,
        pagination: {
          page: parseInt(page as string),
          limit: parseInt(limit as string),
          total: decisions.length
        }
      }
    })
  } catch (error) {
    throw createError('获取历史决策失败', 500)
  }
}))

// 获取决策详情
router.get('/:decisionId', authenticateToken, asyncHandler(async (req: AuthRequest, res) => {
  const { decisionId } = req.params
  const userId = req.user?.id

  if (!userId) {
    throw createError('用户未认证', 401)
  }

  try {
    const { getConnection } = await import('../config/database')
    const connection = getConnection()
    const [decisions] = await connection.execute(
      'SELECT * FROM decisions WHERE id = ? AND user_id = ?',
      [decisionId, userId]
    )

    if (!decisions || (decisions as any[]).length === 0) {
      throw createError('决策不存在', 404)
    }

    const decision = (decisions as any[])[0]
    const decisionData = JSON.parse(decision.decision_data)

    res.json({
      success: true,
      data: decisionData
    })
  } catch (error) {
    throw createError('获取决策详情失败', 500)
  }
}))

// 执行决策操作
router.post('/:decisionId/execute', authenticateToken, asyncHandler(async (req: AuthRequest, res) => {
  const { decisionId } = req.params
  const { action, stockCode, quantity, price } = req.body
  const userId = req.user?.id

  if (!userId) {
    throw createError('用户未认证', 401)
  }

  try {
    // 记录决策执行
    const { getConnection } = await import('../config/database')
    const connection = getConnection()
    
    await connection.execute(
      'INSERT INTO decision_executions (decision_id, user_id, action, stock_code, quantity, price, executed_at) VALUES (?, ?, ?, ?, ?, ?, NOW())',
      [decisionId, userId, action, stockCode, quantity, price]
    )

    res.json({
      success: true,
      message: '决策执行记录已保存'
    })
  } catch (error) {
    throw createError('执行决策失败', 500)
  }
}))

// 获取决策统计
router.get('/stats/overview', authenticateToken, asyncHandler(async (req: AuthRequest, res) => {
  const userId = req.user?.id

  if (!userId) {
    throw createError('用户未认证', 401)
  }

  try {
    const { getConnection } = await import('../config/database')
    const connection = getConnection()
    
    // 获取决策统计
    const [decisionStats] = await connection.execute(
      'SELECT decision_type, COUNT(*) as count FROM decisions WHERE user_id = ? GROUP BY decision_type',
      [userId]
    )
    
    // 获取执行统计
    const [executionStats] = await connection.execute(
      'SELECT action, COUNT(*) as count FROM decision_executions WHERE user_id = ? GROUP BY action',
      [userId]
    )
    
    // 获取最近决策
    const [recentDecisions] = await connection.execute(
      'SELECT * FROM decisions WHERE user_id = ? ORDER BY created_at DESC LIMIT 5',
      [userId]
    )

    res.json({
      success: true,
      data: {
        decisionStats,
        executionStats,
        recentDecisions
      }
    })
  } catch (error) {
    throw createError('获取决策统计失败', 500)
  }
}))

export default router
