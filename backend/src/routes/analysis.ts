import { Router } from 'express'
import { asyncHandler, createError } from '../middleware/errorHandler'
import { authenticateToken } from '../middleware/auth'
import type { AuthRequest } from '../middleware/auth'
import { TechnicalAnalysisService } from '../services/technicalAnalysis'
import { FundamentalAnalysisService } from '../services/fundamentalAnalysis'
import { PositionClassificationService } from '../services/positionClassification'

const router = Router()

// 获取技术分析
router.get('/technical/:code', authenticateToken, asyncHandler(async (req: AuthRequest, res) => {
  const { code } = req.params

  try {
    const technicalAnalysis = await TechnicalAnalysisService.getTechnicalAnalysis(code)
    
    res.json({
      success: true,
      data: technicalAnalysis
    })
  } catch (error) {
    throw createError('技术分析获取失败', 500)
  }
}))

// 获取基本面分析
router.get('/fundamental/:code', authenticateToken, asyncHandler(async (req: AuthRequest, res) => {
  const { code } = req.params

  try {
    const fundamentalAnalysis = await FundamentalAnalysisService.getFundamentalAnalysis(code)
    
    res.json({
      success: true,
      data: fundamentalAnalysis
    })
  } catch (error) {
    throw createError('基本面分析获取失败', 500)
  }
}))

// 获取持仓分析
router.get('/positions', authenticateToken, asyncHandler(async (req: AuthRequest, res) => {
  const userId = req.user?.id

  try {
    // 获取用户持仓
    const { getConnection } = await import('../config/database')
    const connection = getConnection()
    const [positions] = await connection.execute(
      'SELECT * FROM positions WHERE user_id = ?',
      [userId]
    )

    // 分析每个持仓
    const positionAnalysis = []
    for (const position of positions as any[]) {
      const classification = await PositionClassificationService.classifyPosition(
        position.stock_code, 
        position.current_price
      )
      
      positionAnalysis.push({
        code: position.stock_code,
        name: position.stock_name,
        category: classification.category,
        confidence: classification.confidence,
        score: classification.score.overall,
        reasoning: classification.reasoning,
        recommendations: classification.recommendations
      })
    }

    // 计算整体分析
    const overallScore = positionAnalysis.reduce((sum, p) => sum + p.score, 0) / positionAnalysis.length
    const riskLevel = this.calculateRiskLevel(positionAnalysis)
    const diversification = this.calculateDiversification(positionAnalysis)

    res.json({
      success: true,
      data: {
        overallScore,
        riskLevel,
        diversification,
        positions: positionAnalysis,
        recommendations: this.generatePortfolioRecommendations(positionAnalysis)
      }
    })
  } catch (error) {
    throw createError('持仓分析获取失败', 500)
  }
}))

// 计算风险等级
function calculateRiskLevel(positions: any[]): string {
  const avgScore = positions.reduce((sum, p) => sum + p.score, 0) / positions.length
  if (avgScore >= 80) return 'low'
  if (avgScore >= 60) return 'medium'
  return 'high'
}

// 计算分散化程度
function calculateDiversification(positions: any[]): number {
  const categories = positions.reduce((acc, p) => {
    acc[p.category] = (acc[p.category] || 0) + 1
    return acc
  }, {})
  
  const categoryCount = Object.keys(categories).length
  const maxCategoryCount = Math.max(...Object.values(categories) as number[])
  
  return (categoryCount / positions.length) * 100 - (maxCategoryCount / positions.length) * 50
}

// 生成投资组合建议
function generatePortfolioRecommendations(positions: any[]): any[] {
  const recommendations = []
  
  // 分析仓位分布
  const categoryCount = positions.reduce((acc, p) => {
    acc[p.category] = (acc[p.category] || 0) + 1
    return acc
  }, {})
  
  // 建议调整仓位分布
  if (categoryCount.right < 2) {
    recommendations.push({
      type: 'buy',
      reason: '建议增加右侧仓位，把握趋势机会',
      priority: 'high'
    })
  }
  
  if (categoryCount.defensive < 1) {
    recommendations.push({
      type: 'buy',
      reason: '建议增加防御性仓位，降低组合风险',
      priority: 'medium'
    })
  }
  
  return recommendations
}

// 获取推荐
router.get('/recommendations', authenticateToken, asyncHandler(async (req: AuthRequest, res) => {
  // 模拟推荐数据
  const recommendations = [
    {
      code: '000001',
      name: '平安银行',
      action: 'buy',
      confidence: 0.85,
      reason: '技术突破，资金流入',
      targetPrice: 15.5,
      stopLoss: 12.0,
      category: 'right'
    },
    {
      code: '000002',
      name: '万科A',
      action: 'sell',
      confidence: 0.75,
      reason: '技术破位，基本面转弱',
      targetPrice: 8.0,
      stopLoss: 12.0,
      category: 'left'
    }
  ]

  res.json({
    success: true,
    data: recommendations
  })
}))

export default router
