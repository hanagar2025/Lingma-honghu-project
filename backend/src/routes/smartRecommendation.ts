import { Router } from 'express'
import { asyncHandler, createError } from '../middleware/errorHandler'
import { authenticateToken } from '../middleware/auth'
import type { AuthRequest } from '../middleware/auth'
import { SmartPositionRecommendationService } from '../services/smartPositionRecommendation'

const router = Router()

/**
 * 生成单个股票的智能仓位推荐
 */
router.post('/recommend/:stockCode', authenticateToken, asyncHandler(async (req: AuthRequest, res) => {
  const { stockCode } = req.params
  const userId = req.user?.id

  if (!userId) {
    throw createError('用户未认证', 401)
  }

  if (!stockCode) {
    throw createError('股票代码不能为空', 400)
  }

  try {
    const recommendation = await SmartPositionRecommendationService.generateRecommendation(stockCode, userId)
    
    res.json({
      success: true,
      data: recommendation
    })
  } catch (error) {
    throw createError('生成仓位推荐失败', 500)
  }
}))

/**
 * 批量生成推荐
 */
router.post('/batch', authenticateToken, asyncHandler(async (req: AuthRequest, res) => {
  const { stockCodes } = req.body
  const userId = req.user?.id

  if (!userId) {
    throw createError('用户未认证', 401)
  }

  if (!stockCodes || !Array.isArray(stockCodes)) {
    throw createError('股票代码列表不能为空', 400)
  }

  try {
    const recommendations = await SmartPositionRecommendationService.generateBatchRecommendations(
      stockCodes, 
      userId
    )
    
    res.json({
      success: true,
      data: recommendations
    })
  } catch (error) {
    throw createError('批量生成推荐失败', 500)
  }
}))

/**
 * 获取推荐股票池
 */
router.get('/stock-pool', authenticateToken, asyncHandler(async (req: AuthRequest, res) => {
  const userId = req.user?.id

  if (!userId) {
    throw createError('用户未认证', 401)
  }

  try {
    const stockPool = await SmartPositionRecommendationService.getRecommendedStockPool(userId)
    
    res.json({
      success: true,
      data: stockPool
    })
  } catch (error) {
    throw createError('获取推荐股票池失败', 500)
  }
}))

/**
 * 获取智能推荐概览
 */
router.get('/overview', authenticateToken, asyncHandler(async (req: AuthRequest, res) => {
  const userId = req.user?.id

  if (!userId) {
    throw createError('用户未认证', 401)
  }

  try {
    // 获取推荐股票池
    const stockPool = await SmartPositionRecommendationService.getRecommendedStockPool(userId)
    
    // 批量生成推荐
    const recommendations = await SmartPositionRecommendationService.generateBatchRecommendations(
      stockPool.slice(0, 10), // 只取前10个
      userId
    )
    
    // 按推荐类型分组
    const byPosition = recommendations.reduce((acc, rec) => {
      const pos = rec.recommendedPosition
      if (!acc[pos]) acc[pos] = []
      acc[pos].push(rec)
      return acc
    }, {} as any)
    
    res.json({
      success: true,
      data: {
        total: recommendations.length,
        byPosition,
        topRecommendations: recommendations.slice(0, 5)
      }
    })
  } catch (error) {
    throw createError('获取推荐概览失败', 500)
  }
}))

export default router

