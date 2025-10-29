import type { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import { getConnection } from '../config/database'
import { createError } from './errorHandler'

export interface AuthRequest extends Request {
  user?: {
    id: string
    username: string
    email: string
  }
}

export const authenticateToken = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization
    const token = authHeader && authHeader.split(' ')[1]

    if (!token) {
      throw createError('访问令牌缺失', 401)
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key') as any
    
    // 验证用户是否存在
    const connection = getConnection()
    const [rows] = await connection.execute(
      'SELECT id, username, email FROM users WHERE id = ?',
      [decoded.userId]
    )

    if (!Array.isArray(rows) || rows.length === 0) {
      throw createError('用户不存在', 401)
    }

    req.user = rows[0] as any
    next()
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      next(createError('无效的访问令牌', 401))
    } else if (error.name === 'TokenExpiredError') {
      next(createError('访问令牌已过期', 401))
    } else {
      next(error)
    }
  }
}
