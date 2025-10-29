import { Router } from 'express'
import { asyncHandler, createError } from '../middleware/errorHandler'
import { authenticateToken } from '../middleware/auth'
import type { AuthRequest } from '../middleware/auth'
import { PortfolioStrategyService } from '../services/portfolioStrategy'

const router = Router()

/**
 * 获取所有策略主题
 */
router.get('/themes', authenticateToken, asyncHandler(async (req: AuthRequest, res) => {
  const themes = PortfolioStrategyService.getStrategyThemes()
  
  res.json({
    success: true,
    data: themes
  })
}))

/**
 * 生成组合策略
 */
router.post('/generate', authenticateToken, asyncHandler(async (req: AuthRequest, res) => {
  const userId = req.user?.id
  const { themeIds, marketCondition } = req.body

  if (!userId) {
    throw createError('用户未认证', 401)
  }

  try {
    let composition
    
    if (marketCondition) {
      // 根据市场环境推荐
      composition = await PortfolioStrategyService.recommendOptimalPortfolio(
        userId, 
        marketCondition
      )
    } else {
      // 根据选择的主题生成
      composition = await PortfolioStrategyService.generatePortfolioStrategy(
        userId,
        themeIds
      )
    }
    
    res.json({
      success: true,
      data: composition
    })
  } catch (error) {
    throw createError('生成组合策略失败', 500)
  }
}))

/**
 * 获取智能推荐组合
 */
router.post('/recommend', authenticateToken, asyncHandler(async (req: AuthRequest, res) => {
  const userId = req.user?.id
  const { riskTolerance = 'medium', investmentHorizon = 'medium' } = req.body

  if (!userId) {
    throw createError('用户未认证', 401)
  }

  try {
    // 根据风险偏好和投资期限推荐
    const themes = PortfolioStrategyService.getStrategyThemes()
    let selectedThemes: string[] = []
    
    if (riskTolerance === 'low') {
      // 低风险：主要是防御型
      selectedThemes = ['consumption-defensive', 'pharmaceutical']
    } else if (riskTolerance === 'high') {
      // 高风险：主要是科技和趋势型
      selectedThemes = ['tech-ai', 'semiconductor', 'robotics', 'new-energy']
    } else {
      // 中等风险：均衡配置
      selectedThemes = ['tech-ai', 'consumption-defensive', 'pharmaceutical', 'new-energy']
    }
    
    const composition = await PortfolioStrategyService.generatePortfolioStrategy(
      userId,
      selectedThemes
    )
    
    res.json({
      success: true,
      data: composition
    })
  } catch (error) {
    throw createError('获取智能推荐失败', 500)
  }
}))

export default router

