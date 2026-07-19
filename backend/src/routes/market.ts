import { Router } from 'express'
import { fetchQuotes, searchStock, getBarsFromDB } from '../services/marketData'
import { asyncHandler, createError } from '../middleware/errorHandler'

const router = Router()

/** 实时报价（腾讯行情，免费无token） */
router.post('/quotes', asyncHandler(async (req, res) => {
  const { codes } = req.body ?? {}
  if (!Array.isArray(codes) || codes.length === 0 || codes.length > 50) {
    throw createError('codes 必须为1~50个股票代码的数组', 400)
  }
  const quotes = await fetchQuotes(codes)
  res.json({ success: true, data: quotes })
}))

/** 按名称/拼音/代码搜索股票 */
router.get('/search', asyncHandler(async (req, res) => {
  const name = String(req.query.name ?? '').trim()
  if (!name) throw createError('缺少 name 参数', 400)
  const candidates = await searchStock(name)
  // 补上现价，方便前端自动填充
  const quotes = candidates.length > 0 ? await fetchQuotes(candidates.slice(0, 5).map(c => c.code)) : []
  const data = candidates.slice(0, 5).map(c => ({
    code: c.code,
    name: c.name,
    price: quotes.find(q => q.code === c.code)?.price ?? 0,
  }))
  res.json({ success: true, data })
}))

/** 库中日K（升序），供图表或核对使用 */
router.get('/bars/:code', asyncHandler(async (req, res) => {
  const limit = Number(req.query.limit) || 120
  const bars = await getBarsFromDB(req.params.code, limit)
  res.json({ success: true, data: bars })
}))

export default router
