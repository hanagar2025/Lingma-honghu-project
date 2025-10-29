import { Router } from 'express'
import { asyncHandler, createError } from '../middleware/errorHandler'
import { authenticateToken } from '../middleware/auth'
import type { AuthRequest } from '../middleware/auth'
import { SectorAnalysisService } from '../services/sectorAnalysis'

const router = Router()

// 获取板块数据
router.get('/sectors', authenticateToken, asyncHandler(async (req: AuthRequest, res) => {
  try {
    const sectors = await SectorAnalysisService.getSectorData()
    
    res.json({
      success: true,
      data: sectors
    })
  } catch (error) {
    throw createError('获取板块数据失败', 500)
  }
}))

// 获取热点板块
router.get('/hot-sectors', authenticateToken, asyncHandler(async (req: AuthRequest, res) => {
  try {
    const sectors = await SectorAnalysisService.getSectorData()
    const hotSectors = SectorAnalysisService.identifyHotSectors(sectors)
    
    res.json({
      success: true,
      data: hotSectors
    })
  } catch (error) {
    throw createError('获取热点板块失败', 500)
  }
}))

// 获取板块轮动分析
router.get('/rotation', authenticateToken, asyncHandler(async (req: AuthRequest, res) => {
  try {
    const sectors = await SectorAnalysisService.getSectorData()
    const rotation = SectorAnalysisService.analyzeSectorRotation(sectors)
    
    res.json({
      success: true,
      data: rotation
    })
  } catch (error) {
    throw createError('获取板块轮动分析失败', 500)
  }
}))

// 获取政策新闻
router.get('/policy-news', authenticateToken, asyncHandler(async (req: AuthRequest, res) => {
  try {
    const news = await SectorAnalysisService.getPolicyNews()
    
    res.json({
      success: true,
      data: news
    })
  } catch (error) {
    throw createError('获取政策新闻失败', 500)
  }
}))

// 获取政策影响分析
router.get('/policy-impact', authenticateToken, asyncHandler(async (req: AuthRequest, res) => {
  try {
    const [sectors, news] = await Promise.all([
      SectorAnalysisService.getSectorData(),
      SectorAnalysisService.getPolicyNews()
    ])
    
    const impact = SectorAnalysisService.analyzePolicyImpact(news, sectors)
    
    res.json({
      success: true,
      data: impact
    })
  } catch (error) {
    throw createError('获取政策影响分析失败', 500)
  }
}))

// 获取板块相关性
router.get('/correlation', authenticateToken, asyncHandler(async (req: AuthRequest, res) => {
  const { sector1, sector2 } = req.query
  
  if (!sector1 || !sector2) {
    throw createError('请提供两个板块代码', 400)
  }
  
  try {
    const correlation = SectorAnalysisService.getSectorCorrelation(sector1 as string, sector2 as string)
    
    res.json({
      success: true,
      data: {
        sector1,
        sector2,
        correlation
      }
    })
  } catch (error) {
    throw createError('获取板块相关性失败', 500)
  }
}))

export default router
