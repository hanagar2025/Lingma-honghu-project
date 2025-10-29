import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import dotenv from 'dotenv'
import { createServer } from 'http'
import { WebSocketServer } from 'ws'
import { logger } from './utils/logger'
import { connectDB } from './config/database'
import { connectRedis } from './config/redis'
import authRoutes from './routes/auth'
import portfolioRoutes from './routes/portfolio'
import marketRoutes from './routes/market'
import analysisRoutes from './routes/analysis'
import reportsRoutes from './routes/reports'
import sectorRoutes from './routes/sector'
import decisionsRoutes from './routes/decisions'
import systemRoutes from './routes/system'
import smartRecommendationRoutes from './routes/smartRecommendation'
import portfolioStrategyRoutes from './routes/portfolioStrategy'
import { errorHandler } from './middleware/errorHandler'
import { setupWebSocket } from './services/websocket'
import { setupCronJobs } from './services/cron'

// 加载环境变量
dotenv.config()

const app = express()
const server = createServer(app)
const wss = new WebSocketServer({ server })

const PORT = process.env.PORT || 5000

// 中间件
app.use(helmet())
app.use(cors({
  origin: ['http://localhost:5173', 'http://localhost:5174', 'http://localhost:3000'],
  credentials: true
}))
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true }))

// 路由
app.use('/api/auth', authRoutes)
app.use('/api/portfolio', portfolioRoutes)
app.use('/api/market', marketRoutes)
app.use('/api/analysis', analysisRoutes)
app.use('/api/reports', reportsRoutes)
app.use('/api/sector', sectorRoutes)
app.use('/api/decisions', decisionsRoutes)
app.use('/api/system', systemRoutes)
app.use('/api/smart-recommendation', smartRecommendationRoutes)
app.use('/api/portfolio-strategy', portfolioStrategyRoutes)

// 健康检查
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// 错误处理
app.use(errorHandler)

// 启动服务器
async function startServer() {
  try {
    // 连接数据库
    await connectDB()
    logger.info('数据库连接成功')

    // 连接Redis
    await connectRedis()
    logger.info('Redis连接成功')

    // 设置WebSocket
    setupWebSocket(wss)
    logger.info('WebSocket服务启动')

    // 设置定时任务
    setupCronJobs()
    logger.info('定时任务启动')

    // 启动HTTP服务器
    server.listen(PORT, () => {
      logger.info(`服务器运行在端口 ${PORT}`)
      logger.info(`环境: ${process.env.NODE_ENV || 'development'}`)
    })
  } catch (error) {
    logger.error('服务器启动失败:', error)
    process.exit(1)
  }
}

// 优雅关闭
process.on('SIGTERM', () => {
  logger.info('收到SIGTERM信号，开始优雅关闭...')
  server.close(() => {
    logger.info('服务器已关闭')
    process.exit(0)
  })
})

process.on('SIGINT', () => {
  logger.info('收到SIGINT信号，开始优雅关闭...')
  server.close(() => {
    logger.info('服务器已关闭')
    process.exit(0)
  })
})

startServer()
