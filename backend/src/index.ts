// TIOS 精炼小程序后端入口
// 只保留一个大脑：TIOS规则引擎。数据→决策→执行→反馈完整闭环，无预测、无Mock。

import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import dotenv from 'dotenv'
import { createServer } from 'http'
import { logger } from './utils/logger'
import { connectDB } from './config/database'
import authRoutes from './routes/auth'
import portfolioRoutes from './routes/portfolio'
import marketRoutes from './routes/market'
import tiosRoutes from './routes/tios'
import { errorHandler } from './middleware/errorHandler'
import { setupScheduler } from './services/scheduler'

dotenv.config()

const app = express()
const server = createServer(app)
const PORT = process.env.PORT || 5000

app.use(helmet())
app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:3000'],
  credentials: true,
}))
app.use(express.json({ limit: '2mb' }))
app.use(express.urlencoded({ extended: true }))

app.use('/api/auth', authRoutes)
app.use('/api/portfolio', portfolioRoutes)
app.use('/api/market', marketRoutes)
app.use('/api/tios', tiosRoutes)

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

app.use(errorHandler)

async function startServer() {
  try {
    await connectDB()
    setupScheduler()
    server.listen(PORT, () => {
      logger.info(`TIOS 服务运行在端口 ${PORT}（环境: ${process.env.NODE_ENV || 'development'}）`)
    })
  } catch (error) {
    logger.error('服务器启动失败:', error)
    process.exit(1)
  }
}

const shutdown = (signal: string) => {
  logger.info(`收到${signal}信号，开始优雅关闭...`)
  server.close(() => {
    logger.info('服务器已关闭')
    process.exit(0)
  })
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))

startServer()
