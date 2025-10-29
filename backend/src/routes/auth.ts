import { Router } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { v4 as uuidv4 } from 'uuid'
import { getConnection } from '../config/database'
import { asyncHandler, createError } from '../middleware/errorHandler'
import { logger } from '../utils/logger'

const router = Router()

// 注册
router.post('/register', asyncHandler(async (req, res) => {
  const { username, email, password } = req.body

  // 验证输入
  if (!username || !email || !password) {
    throw createError('用户名、邮箱和密码都是必填项', 400)
  }

  if (password.length < 6) {
    throw createError('密码长度至少6位', 400)
  }

  const connection = getConnection()

  // 检查用户是否已存在
  const [existingUsers] = await connection.execute(
    'SELECT id FROM users WHERE username = ? OR email = ?',
    [username, email]
  )

  if (Array.isArray(existingUsers) && existingUsers.length > 0) {
    throw createError('用户名或邮箱已存在', 400)
  }

  // 加密密码
  const passwordHash = await bcrypt.hash(password, 10)
  const userId = uuidv4()

  // 创建用户
  await connection.execute(
    'INSERT INTO users (id, username, email, password_hash) VALUES (?, ?, ?, ?)',
    [userId, username, email, passwordHash]
  )

  // 创建用户设置
  const settingsId = uuidv4()
  await connection.execute(
    'INSERT INTO user_settings (id, user_id) VALUES (?, ?)',
    [settingsId, userId]
  )

  // 生成JWT令牌
  const token = jwt.sign(
    { userId },
    process.env.JWT_SECRET || 'your-secret-key',
    { expiresIn: '7d' }
  )

  logger.info(`用户注册成功: ${username}`)

  res.json({
    success: true,
    message: '注册成功',
    data: {
      user: {
        id: userId,
        username,
        email
      },
      token
    }
  })
}))

// 登录
router.post('/login', asyncHandler(async (req, res) => {
  const { username, password } = req.body

  if (!username || !password) {
    throw createError('用户名和密码都是必填项', 400)
  }

  const connection = getConnection()

  // 查找用户
  const [users] = await connection.execute(
    'SELECT id, username, email, password_hash FROM users WHERE username = ?',
    [username]
  )

  if (!Array.isArray(users) || users.length === 0) {
    throw createError('用户名或密码错误', 401)
  }

  const user = users[0] as any

  // 验证密码
  const isValidPassword = await bcrypt.compare(password, user.password_hash)
  if (!isValidPassword) {
    throw createError('用户名或密码错误', 401)
  }

  // 生成JWT令牌
  const token = jwt.sign(
    { userId: user.id },
    process.env.JWT_SECRET || 'your-secret-key',
    { expiresIn: '7d' }
  )

  logger.info(`用户登录成功: ${username}`)

  res.json({
    success: true,
    message: '登录成功',
    data: {
      user: {
        id: user.id,
        username: user.username,
        email: user.email
      },
      token
    }
  })
}))

// 获取用户信息
router.get('/profile', asyncHandler(async (req, res) => {
  // 这里需要认证中间件，暂时返回模拟数据
  res.json({
    success: true,
    data: {
      id: '1',
      username: 'testuser',
      email: 'test@example.com'
    }
  })
}))

// 退出登录
router.post('/logout', asyncHandler(async (req, res) => {
  // JWT是无状态的，客户端删除token即可
  res.json({
    success: true,
    message: '退出成功'
  })
}))

export default router
