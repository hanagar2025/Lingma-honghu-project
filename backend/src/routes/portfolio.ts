import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { getConnection } from '../config/database'
import { asyncHandler, createError } from '../middleware/errorHandler'
import { authenticateToken } from '../middleware/auth'
import type { AuthRequest } from '../middleware/auth'

const router = Router()

// 获取持仓列表
router.get('/positions', authenticateToken, asyncHandler(async (req: AuthRequest, res) => {
  const connection = getConnection()
  const userId = req.user?.id

  const [positions] = await connection.execute(
    `SELECT 
      id, 
      stock_code as stockCode, 
      stock_name as stockName, 
      quantity, 
      cost_price as costPrice, 
      current_price as currentPrice,
      market_value as marketValue, 
      profit_loss as profitLoss, 
      profit_loss_rate as profitLossRate, 
      position_ratio as positionRatio, 
      category,
      sector,
      theme,
      created_at as createdAt, 
      updated_at as updatedAt
    FROM positions 
    WHERE user_id = ? 
    ORDER BY created_at DESC`,
    [userId]
  )

  res.json({
    success: true,
    data: positions
  })
}))

// 添加持仓
router.post('/positions', authenticateToken, asyncHandler(async (req: AuthRequest, res) => {
  const {
    stockCode,
    stockName,
    quantity,
    costPrice,
    currentPrice,
    category,
    sector,
    theme
  } = req.body

  if (!stockCode || !stockName || !quantity || !costPrice || !currentPrice || !category) {
    throw createError('股票代码、名称、数量、成本价、现价、分类都是必填项', 400)
  }

  const connection = getConnection()
  const userId = req.user?.id
  const positionId = uuidv4()

  // 计算市值和盈亏
  const marketValue = quantity * currentPrice
  const profitLoss = marketValue - (quantity * costPrice)
  const profitLossRate = (profitLoss / (quantity * costPrice)) * 100

  // 计算仓位占比（需要先获取总资产）
  const [totalAssetsResult] = await connection.execute(
    'SELECT SUM(market_value) as total_market_value FROM positions WHERE user_id = ?',
    [userId]
  )
  
  const totalMarketValue = (totalAssetsResult as any)[0]?.total_market_value || 0
  const newTotalMarketValue = totalMarketValue + marketValue
  // 确保positionRatio在0-100范围内
  const positionRatio = Math.min(Math.max((marketValue / newTotalMarketValue) * 100, 0), 100)

  // 插入新持仓
  await connection.execute(
    `INSERT INTO positions (
      id, user_id, stock_code, stock_name, quantity, cost_price, current_price,
      market_value, profit_loss, profit_loss_rate, position_ratio, category, sector, theme
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      positionId, userId, stockCode, stockName, quantity, costPrice, currentPrice,
      marketValue, profitLoss, profitLossRate, positionRatio, category,
      sector || '未分类', theme || '未分类'
    ]
  )

  // 更新其他持仓的仓位占比
  if (totalMarketValue > 0) {
    await connection.execute(
      `UPDATE positions 
       SET position_ratio = (market_value / ?) * 100 
       WHERE user_id = ? AND id != ?`,
      [newTotalMarketValue, userId, positionId]
    )
  }

  const newPosition = {
    id: positionId,
    stockCode,
    stockName,
    quantity,
    costPrice,
    currentPrice,
    marketValue,
    profitLoss,
    profitLossRate,
    positionRatio,
    category,
    sector: sector || '未分类',
    theme: theme || '未分类',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }

  res.json({
    success: true,
    message: '持仓添加成功',
    data: newPosition
  })
}))

// 更新持仓
router.put('/positions/:id', authenticateToken, asyncHandler(async (req: AuthRequest, res) => {
  const { id } = req.params
  const updateData = req.body
  const userId = req.user?.id

  const connection = getConnection()

  // 检查持仓是否存在且属于当前用户
  const [positions] = await connection.execute(
    'SELECT * FROM positions WHERE id = ? AND user_id = ?',
    [id, userId]
  )

  if (!Array.isArray(positions) || positions.length === 0) {
    throw createError('持仓不存在', 404)
  }

  // 如果更新了价格相关字段，重新计算
  if (updateData.currentPrice || updateData.quantity) {
    const currentPosition = positions[0] as { quantity: number; current_price: number; cost_price: number }
    const newQuantity = Number(updateData.quantity || currentPosition.quantity)
    const newCurrentPrice = Number(updateData.currentPrice || currentPosition.current_price)
    const newMarketValue = newQuantity * newCurrentPrice
    const newProfitLoss = newMarketValue - (newQuantity * Number(currentPosition.cost_price))
    const newProfitLossRate = (newProfitLoss / (newQuantity * Number(currentPosition.cost_price))) * 100

    updateData.market_value = newMarketValue
    updateData.profit_loss = newProfitLoss
    updateData.profit_loss_rate = newProfitLossRate
  }

  // 构建更新SQL（白名单列，防注入）
  const columnMap: Record<string, string> = {
    stockCode: 'stock_code',
    stockName: 'stock_name',
    quantity: 'quantity',
    costPrice: 'cost_price',
    currentPrice: 'current_price',
    category: 'category',
    sector: 'sector',
    theme: 'theme',
    market_value: 'market_value',
    profit_loss: 'profit_loss',
    profit_loss_rate: 'profit_loss_rate',
    position_ratio: 'position_ratio',
  }
  const updateFields: string[] = []
  const updateValues: unknown[] = []

  Object.keys(updateData).forEach(key => {
    const column = columnMap[key]
    if (column && updateData[key] !== undefined) {
      updateFields.push(`${column} = ?`)
      updateValues.push(updateData[key])
    }
  })

  if (updateFields.length === 0) {
    throw createError('没有要更新的字段', 400)
  }

  updateValues.push(id, userId)

  await connection.execute(
    `UPDATE positions SET ${updateFields.join(', ')} WHERE id = ? AND user_id = ?`,
    updateValues
  )

  res.json({
    success: true,
    message: '持仓更新成功'
  })
}))

// 删除持仓
router.delete('/positions/:id', authenticateToken, asyncHandler(async (req: AuthRequest, res) => {
  const { id } = req.params
  const userId = req.user?.id

  const connection = getConnection()

  const [result] = await connection.execute(
    'DELETE FROM positions WHERE id = ? AND user_id = ?',
    [id, userId]
  )

  if ((result as any).affectedRows === 0) {
    throw createError('持仓不存在', 404)
  }

  res.json({
    success: true,
    message: '持仓删除成功'
  })
}))

// 获取投资组合摘要
router.get('/summary', authenticateToken, asyncHandler(async (req: AuthRequest, res) => {
  const connection = getConnection()
  const userId = req.user?.id

  const [summary] = await connection.execute(
    `SELECT 
      SUM(market_value) as total_market_value,
      SUM(profit_loss) as total_profit_loss,
      AVG(profit_loss_rate) as total_profit_loss_rate,
      SUM(CASE WHEN category = 'left' THEN market_value ELSE 0 END) as left_side_value,
      SUM(CASE WHEN category = 'right' THEN market_value ELSE 0 END) as right_side_value,
      SUM(CASE WHEN category = 'defensive' THEN market_value ELSE 0 END) as defensive_value,
      SUM(CASE WHEN category = 'observation' THEN market_value ELSE 0 END) as observation_value
    FROM positions 
    WHERE user_id = ?`,
    [userId]
  )

  const data = (summary as any)[0]
  const totalMarketValue = data.total_market_value || 0
  const totalAssets = totalMarketValue + 100000 // 假设可用资金10万

  res.json({
    success: true,
    data: {
      totalAssets,
      availableCash: 100000,
      totalMarketValue,
      totalProfitLoss: data.total_profit_loss || 0,
      totalProfitLossRate: data.total_profit_loss_rate || 0,
      leftSideRatio: totalMarketValue > 0 ? (data.left_side_value / totalMarketValue) * 100 : 0,
      rightSideRatio: totalMarketValue > 0 ? (data.right_side_value / totalMarketValue) * 100 : 0,
      defensiveRatio: totalMarketValue > 0 ? (data.defensive_value / totalMarketValue) * 100 : 0,
      observationRatio: totalMarketValue > 0 ? (data.observation_value / totalMarketValue) * 100 : 0
    }
  })
}))

export default router
