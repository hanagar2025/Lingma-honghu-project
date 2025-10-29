import { Router } from 'express'
import { asyncHandler, createError } from '../middleware/errorHandler'
import { authenticateToken } from '../middleware/auth'
import type { AuthRequest } from '../middleware/auth'

const router = Router()

// 获取股票行情
router.post('/quotes', authenticateToken, asyncHandler(async (req: AuthRequest, res) => {
  const { codes } = req.body

  if (!codes || !Array.isArray(codes)) {
    throw createError('股票代码列表是必填项', 400)
  }

  // 模拟行情数据
  const quotes = codes.map((code: string) => ({
    code,
    name: `股票${code}`,
    price: Math.random() * 100 + 10,
    change: (Math.random() - 0.5) * 10,
    changeRate: (Math.random() - 0.5) * 10,
    volume: Math.floor(Math.random() * 1000000),
    turnover: Math.floor(Math.random() * 100000000),
    high: Math.random() * 100 + 10,
    low: Math.random() * 100 + 10,
    open: Math.random() * 100 + 10,
    prevClose: Math.random() * 100 + 10,
    timestamp: Date.now()
  }))

  res.json({
    success: true,
    data: quotes
  })
}))

// 根据名称搜索股票
router.get('/search', authenticateToken, asyncHandler(async (req: AuthRequest, res) => {
  const { name } = req.query

  if (!name || typeof name !== 'string') {
    throw createError('股票名称是必填项', 400)
  }

  // 模拟搜索数据库
  const stockDatabase: Record<string, { code: string; name: string; price: number }> = {
    '平安银行': { code: '000001', name: '平安银行', price: 11.20 },
    '万科A': { code: '000002', name: '万科A', price: 8.50 },
    '国农科技': { code: '000004', name: '国农科技', price: 12.30 },
    '兆易创新': { code: '603986', name: '兆易创新', price: 243.00 },
    '贵州茅台': { code: '600519', name: '贵州茅台', price: 1850.00 },
    '五粮液': { code: '000858', name: '五粮液', price: 156.80 },
    '比亚迪': { code: '002594', name: '比亚迪', price: 268.50 },
    '宁德时代': { code: '300750', name: '宁德时代', price: 432.60 },
    '招商银行': { code: '600036', name: '招商银行', price: 41.20 },
    '工商银行': { code: '601398', name: '工商银行', price: 5.80 },
  }

  // 模糊搜索
  const matchedStocks = Object.entries(stockDatabase)
    .filter(([stockName]) => stockName.includes(name))
    .map(([_, stock]) => stock)

  if (matchedStocks.length === 0) {
    throw createError(`未找到股票: ${name}`, 404)
  }

  res.json({
    success: true,
    data: matchedStocks
  })
}))

// 获取市场指数
router.get('/indices', asyncHandler(async (req, res) => {
  // 模拟市场指数数据
  const indices = [
    {
      code: '000001',
      name: '上证指数',
      value: 3000 + Math.random() * 200,
      change: (Math.random() - 0.5) * 50,
      changeRate: (Math.random() - 0.5) * 2
    },
    {
      code: '399001',
      name: '深证成指',
      value: 10000 + Math.random() * 1000,
      change: (Math.random() - 0.5) * 100,
      changeRate: (Math.random() - 0.5) * 2
    },
    {
      code: '399006',
      name: '创业板指',
      value: 2000 + Math.random() * 200,
      change: (Math.random() - 0.5) * 30,
      changeRate: (Math.random() - 0.5) * 2
    }
  ]

  res.json({
    success: true,
    data: indices
  })
}))

// 订阅行情
router.post('/subscribe', authenticateToken, asyncHandler(async (req: AuthRequest, res) => {
  const { codes } = req.body

  if (!codes || !Array.isArray(codes)) {
    throw createError('股票代码列表是必填项', 400)
  }

  // TODO: 实现WebSocket订阅逻辑
  res.json({
    success: true,
    message: '订阅成功'
  })
}))

// 获取股票信息
router.get('/stocks/:code', authenticateToken, asyncHandler(async (req: AuthRequest, res) => {
  const { code } = req.params

  // 模拟股票信息
  const stockInfo = {
    code,
    name: `股票${code}`,
    industry: '科技',
    market: '主板',
    listDate: '2020-01-01',
    marketCap: Math.floor(Math.random() * 100000000000),
    pe: Math.random() * 50 + 10,
    pb: Math.random() * 5 + 1,
    roe: Math.random() * 20 + 5
  }

  res.json({
    success: true,
    data: stockInfo
  })
}))

// 获取股票历史数据
router.get('/stocks/:code/history', authenticateToken, asyncHandler(async (req: AuthRequest, res) => {
  const { code } = req.params
  const { period = '1d' } = req.query

  // 模拟历史数据
  const history = Array.from({ length: 30 }, (_, i) => ({
    date: new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    open: Math.random() * 100 + 10,
    high: Math.random() * 100 + 10,
    low: Math.random() * 100 + 10,
    close: Math.random() * 100 + 10,
    volume: Math.floor(Math.random() * 1000000)
  })).reverse()

  res.json({
    success: true,
    data: history
  })
}))

export default router
