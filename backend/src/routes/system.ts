import { Router } from 'express'
import { asyncHandler, createError } from '../middleware/errorHandler'
import { authenticateToken } from '../middleware/auth'
import type { AuthRequest } from '../middleware/auth'
import { RiskControlService } from '../services/riskControl'
import { SystemOptimizationService } from '../services/systemOptimization'
import { UserExperienceService } from '../services/userExperience'

const router = Router()

// 获取风险控制数据
router.get('/risk', authenticateToken, asyncHandler(async (req: AuthRequest, res) => {
  const userId = req.user?.id

  if (!userId) {
    throw createError('用户未认证', 401)
  }

  try {
    const riskMetrics = await RiskControlService.calculatePortfolioRisk(userId)
    const riskAlerts = await RiskControlService.generateRiskAlerts(userId)
    const stopLossSuggestions = await RiskControlService.calculateStopLoss(userId)
    const positionSizing = await RiskControlService.calculatePositionSizing(userId)

    res.json({
      success: true,
      data: {
        riskMetrics,
        riskAlerts,
        stopLossSuggestions,
        positionSizing
      }
    })
  } catch (error) {
    throw createError('获取风险控制数据失败', 500)
  }
}))

// 获取系统指标
router.get('/metrics', authenticateToken, asyncHandler(async (req: AuthRequest, res) => {
  try {
    const metrics = await SystemOptimizationService.getSystemMetrics()
    
    res.json({
      success: true,
      data: metrics
    })
  } catch (error) {
    throw createError('获取系统指标失败', 500)
  }
}))

// 获取优化建议
router.get('/optimization', authenticateToken, asyncHandler(async (req: AuthRequest, res) => {
  try {
    const suggestions = await SystemOptimizationService.generateOptimizationSuggestions()
    
    res.json({
      success: true,
      data: suggestions
    })
  } catch (error) {
    throw createError('获取优化建议失败', 500)
  }
}))

// 执行系统优化
router.post('/optimization/execute', authenticateToken, asyncHandler(async (req: AuthRequest, res) => {
  const { optimizationId } = req.body

  if (!optimizationId) {
    throw createError('请提供优化ID', 400)
  }

  try {
    const success = await SystemOptimizationService.executeOptimization(optimizationId)
    
    res.json({
      success,
      message: success ? '优化执行成功' : '优化执行失败'
    })
  } catch (error) {
    throw createError('执行系统优化失败', 500)
  }
}))

// 获取系统健康状态
router.get('/health', authenticateToken, asyncHandler(async (req: AuthRequest, res) => {
  try {
    const health = await SystemOptimizationService.monitorSystemHealth()
    
    res.json({
      success: true,
      data: health
    })
  } catch (error) {
    throw createError('获取系统健康状态失败', 500)
  }
}))

// 生成系统报告
router.get('/report', authenticateToken, asyncHandler(async (req: AuthRequest, res) => {
  try {
    const report = await SystemOptimizationService.generateSystemReport()
    
    res.json({
      success: true,
      data: report
    })
  } catch (error) {
    throw createError('生成系统报告失败', 500)
  }
}))

// 收集用户反馈
router.post('/feedback', authenticateToken, asyncHandler(async (req: AuthRequest, res) => {
  const userId = req.user?.id
  const { type, category, title, description, priority, rating } = req.body

  if (!userId) {
    throw createError('用户未认证', 401)
  }

  if (!type || !category || !title || !description) {
    throw createError('请提供完整的反馈信息', 400)
  }

  try {
    const feedbackId = await UserExperienceService.collectFeedback(userId, {
      type,
      category,
      title,
      description,
      priority: priority || 'medium',
      status: 'pending',
      rating: rating || 0
    })

    res.json({
      success: true,
      data: { feedbackId },
      message: '反馈提交成功'
    })
  } catch (error) {
    throw createError('提交反馈失败', 500)
  }
}))

// 获取用户分析数据
router.get('/analytics', authenticateToken, asyncHandler(async (req: AuthRequest, res) => {
  const userId = req.user?.id

  if (!userId) {
    throw createError('用户未认证', 401)
  }

  try {
    const analytics = await UserExperienceService.getUserAnalytics(userId)
    
    res.json({
      success: true,
      data: analytics
    })
  } catch (error) {
    throw createError('获取用户分析数据失败', 500)
  }
}))

// 获取个性化设置
router.get('/settings', authenticateToken, asyncHandler(async (req: AuthRequest, res) => {
  const userId = req.user?.id

  if (!userId) {
    throw createError('用户未认证', 401)
  }

  try {
    const settings = await UserExperienceService.getPersonalizationSettings(userId)
    
    res.json({
      success: true,
      data: settings
    })
  } catch (error) {
    throw createError('获取个性化设置失败', 500)
  }
}))

// 更新个性化设置
router.put('/settings', authenticateToken, asyncHandler(async (req: AuthRequest, res) => {
  const userId = req.user?.id
  const settings = req.body

  if (!userId) {
    throw createError('用户未认证', 401)
  }

  try {
    await UserExperienceService.updatePersonalizationSettings(userId, settings)
    
    res.json({
      success: true,
      message: '设置更新成功'
    })
  } catch (error) {
    throw createError('更新个性化设置失败', 500)
  }
}))

// 跟踪用户行为
router.post('/track', authenticateToken, asyncHandler(async (req: AuthRequest, res) => {
  const userId = req.user?.id
  const { action, data } = req.body

  if (!userId) {
    throw createError('用户未认证', 401)
  }

  if (!action) {
    throw createError('请提供行为类型', 400)
  }

  try {
    await UserExperienceService.trackUserBehavior(userId, action, data)
    
    res.json({
      success: true,
      message: '行为跟踪成功'
    })
  } catch (error) {
    throw createError('跟踪用户行为失败', 500)
  }
}))

// 生成用户体验报告
router.get('/ux-report', authenticateToken, asyncHandler(async (req: AuthRequest, res) => {
  try {
    const report = await UserExperienceService.generateUXReport()
    
    res.json({
      success: true,
      data: report
    })
  } catch (error) {
    throw createError('生成用户体验报告失败', 500)
  }
}))

export default router
