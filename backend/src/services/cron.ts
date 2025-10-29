import cron from 'node-cron'
import { logger } from '../utils/logger'
import { getConnection } from '../config/database'
import { ReportGenerator } from './reportGenerator'

export const setupCronJobs = (): void => {
  // 每日9:00 - 盘前准备报表
  cron.schedule('0 9 * * 1-5', async () => {
    logger.info('开始生成盘前准备报表')
    try {
      // 获取所有用户
      const connection = getConnection()
      const [users] = await connection.execute('SELECT id FROM users')
      
      // 为每个用户生成报表
      for (const user of users as any[]) {
        await ReportGenerator.generatePreMarketReport(user.id)
      }
      
      logger.info('盘前准备报表生成完成')
    } catch (error) {
      logger.error('盘前准备报表生成失败:', error)
    }
  }, {
    timezone: 'Asia/Shanghai'
  })

  // 每日11:30 - 盘中观察报表
  cron.schedule('30 11 * * 1-5', async () => {
    logger.info('开始生成盘中观察报表')
    try {
      const connection = getConnection()
      const [users] = await connection.execute('SELECT id FROM users')
      
      for (const user of users as any[]) {
        await ReportGenerator.generateIntradayReport(user.id)
      }
      
      logger.info('盘中观察报表生成完成')
    } catch (error) {
      logger.error('盘中观察报表生成失败:', error)
    }
  }, {
    timezone: 'Asia/Shanghai'
  })

  // 每日14:00 - 盘中观察报表
  cron.schedule('0 14 * * 1-5', async () => {
    logger.info('开始生成盘中观察报表')
    try {
      const connection = getConnection()
      const [users] = await connection.execute('SELECT id FROM users')
      
      for (const user of users as any[]) {
        await ReportGenerator.generateIntradayReport(user.id)
      }
      
      logger.info('盘中观察报表生成完成')
    } catch (error) {
      logger.error('盘中观察报表生成失败:', error)
    }
  }, {
    timezone: 'Asia/Shanghai'
  })

  // 每日15:30 - 收盘复盘报表
  cron.schedule('30 15 * * 1-5', async () => {
    logger.info('开始生成收盘复盘报表')
    try {
      const connection = getConnection()
      const [users] = await connection.execute('SELECT id FROM users')
      
      for (const user of users as any[]) {
        await ReportGenerator.generatePostMarketReport(user.id)
      }
      
      logger.info('收盘复盘报表生成完成')
    } catch (error) {
      logger.error('收盘复盘报表生成失败:', error)
    }
  }, {
    timezone: 'Asia/Shanghai'
  })

  // 每日20:00 - 日终决策报表
  cron.schedule('0 20 * * 1-5', async () => {
    logger.info('开始生成日终决策报表')
    try {
      const connection = getConnection()
      const [users] = await connection.execute('SELECT id FROM users')
      
      for (const user of users as any[]) {
        await ReportGenerator.generateDailyDecisionReport(user.id)
      }
      
      logger.info('日终决策报表生成完成')
    } catch (error) {
      logger.error('日终决策报表生成失败:', error)
    }
  }, {
    timezone: 'Asia/Shanghai'
  })

  // 每小时更新行情数据
  cron.schedule('0 * * * *', async () => {
    logger.info('开始更新行情数据')
    try {
      await updateMarketData()
      logger.info('行情数据更新完成')
    } catch (error) {
      logger.error('行情数据更新失败:', error)
    }
  })

  logger.info('定时任务已启动')
}

// 生成盘前准备报表
const generatePreMarketReport = async (): Promise<void> => {
  const connection = getConnection()
  
  // 获取所有用户
  const [users] = await connection.execute('SELECT id FROM users')
  
  for (const user of users as any[]) {
    // 获取用户持仓
    const [positions] = await connection.execute(
      'SELECT * FROM positions WHERE user_id = ?',
      [user.id]
    )

    // 生成报表数据
    const reportData = {
      userId: user.id,
      type: 'pre_market',
      date: new Date().toISOString().split('T')[0],
      positions: positions,
      marketOutlook: 'positive', // 模拟数据
      keyEvents: [
        '重要政策发布',
        '行业利好消息',
        '个股重大公告'
      ],
      recommendations: [
        {
          action: 'watch',
          code: '000001',
          reason: '技术突破在即'
        }
      ]
    }

    // 保存报表
    await connection.execute(
      'INSERT INTO daily_reports (id, user_id, report_type, report_data, created_at) VALUES (?, ?, ?, ?, NOW())',
      [generateId(), user.id, 'pre_market', JSON.stringify(reportData)]
    )
  }
}

// 生成盘中观察报表
const generateIntradayReport = async (): Promise<void> => {
  const connection = getConnection()
  
  const [users] = await connection.execute('SELECT id FROM users')
  
  for (const user of users as any[]) {
    const reportData = {
      userId: user.id,
      type: 'intraday',
      timestamp: new Date().toISOString(),
      positions: [], // 获取实时持仓数据
      alerts: [
        {
          type: 'price_change',
          code: '000001',
          message: '涨幅超过3%'
        }
      ],
      marketSentiment: 'neutral'
    }

    await connection.execute(
      'INSERT INTO daily_reports (id, user_id, report_type, report_data, created_at) VALUES (?, ?, ?, ?, NOW())',
      [generateId(), user.id, 'intraday', JSON.stringify(reportData)]
    )
  }
}

// 生成收盘复盘报表
const generatePostMarketReport = async (): Promise<void> => {
  const connection = getConnection()
  
  const [users] = await connection.execute('SELECT id FROM users')
  
  for (const user of users as any[]) {
    const reportData = {
      userId: user.id,
      type: 'post_market',
      date: new Date().toISOString().split('T')[0],
      dailyPerformance: {
        totalReturn: Math.random() * 10 - 5,
        bestPerformer: '000001',
        worstPerformer: '000002'
      },
      technicalAnalysis: {
        trend: 'up',
        support: 10.5,
        resistance: 12.0
      },
      news: [
        '重要公告发布',
        '行业政策变化'
      ]
    }

    await connection.execute(
      'INSERT INTO daily_reports (id, user_id, report_type, report_data, created_at) VALUES (?, ?, ?, ?, NOW())',
      [generateId(), user.id, 'post_market', JSON.stringify(reportData)]
    )
  }
}

// 生成日终决策报表
const generateDailyDecisionReport = async (): Promise<void> => {
  const connection = getConnection()
  
  const [users] = await connection.execute('SELECT id FROM users')
  
  for (const user of users as any[]) {
    const reportData = {
      userId: user.id,
      type: 'daily_decision',
      date: new Date().toISOString().split('T')[0],
      portfolioHealth: {
        score: Math.random() * 100,
        riskLevel: 'medium'
      },
      recommendations: [
        {
          action: 'buy',
          code: '000001',
          confidence: 0.85,
          reason: '技术突破，基本面良好'
        },
        {
          action: 'sell',
          code: '000002',
          confidence: 0.75,
          reason: '技术破位，建议止损'
        }
      ],
      tomorrowPlan: [
        '关注000001突破情况',
        '考虑减仓000002'
      ]
    }

    await connection.execute(
      'INSERT INTO daily_reports (id, user_id, report_type, report_data, created_at) VALUES (?, ?, ?, ?, NOW())',
      [generateId(), user.id, 'daily_decision', JSON.stringify(reportData)]
    )
  }
}

// 更新行情数据
const updateMarketData = async (): Promise<void> => {
  // TODO: 实现行情数据更新逻辑
  logger.info('行情数据更新中...')
}

// 生成唯一ID
const generateId = (): string => {
  return Date.now().toString(36) + Math.random().toString(36).substr(2)
}
