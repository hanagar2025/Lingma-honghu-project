import { logger } from '../utils/logger'
import { getConnection } from '../config/database'
import { FreeDataProvider } from '../config/dataSources'
import { TechnicalAnalysisService } from './technicalAnalysis'
import { FundamentalAnalysisService } from './fundamentalAnalysis'
import { PositionClassificationService } from './positionClassification'

export interface ReportData {
  reportId: string
  userId: string
  reportType: 'pre_market' | 'intraday' | 'post_market' | 'daily_decision'
  timestamp: string
  data: any
}

export class ReportGenerator {
  // 生成盘前准备报表
  static async generatePreMarketReport(userId: string): Promise<ReportData> {
    try {
      logger.info(`开始生成用户 ${userId} 的盘前准备报表`)

      // 获取用户持仓
      const positions = await this.getUserPositions(userId)
      
      // 获取持仓概览
      const portfolioOverview = await this.getPortfolioOverview(positions)
      
      // 获取重要资讯
      const importantNews = await this.getImportantNews(positions)
      
      // 获取今日关注点
      const todayFocus = await this.getTodayFocus(positions)
      
      // 获取市场环境
      const marketEnvironment = await this.getMarketEnvironment()

      const reportData = {
        reportId: `pre_market_${Date.now()}`,
        userId,
        reportType: 'pre_market',
        timestamp: new Date().toISOString(),
        data: {
          portfolioOverview,
          importantNews,
          todayFocus,
          marketEnvironment,
          generatedAt: new Date().toISOString()
        }
      }

      // 保存报表
      await this.saveReport(reportData)
      
      logger.info(`盘前准备报表生成完成: ${reportData.reportId}`)
      return reportData
    } catch (error) {
      logger.error('生成盘前准备报表失败:', error)
      throw error
    }
  }

  // 生成盘中观察报表
  static async generateIntradayReport(userId: string): Promise<ReportData> {
    try {
      logger.info(`开始生成用户 ${userId} 的盘中观察报表`)

      // 获取实时盈亏
      const realtimePnl = await this.getRealtimePnl(userId)
      
      // 获取异动提醒
      const alerts = await this.getIntradayAlerts(userId)
      
      // 获取资金流向
      const moneyFlow = await this.getMoneyFlow(userId)
      
      // 获取板块动态
      const sectorDynamics = await this.getSectorDynamics()
      
      // 获取操作建议
      const operationAdvice = await this.getOperationAdvice(userId)

      const reportData = {
        reportId: `intraday_${Date.now()}`,
        userId,
        reportType: 'intraday',
        timestamp: new Date().toISOString(),
        data: {
          realtimePnl,
          alerts,
          moneyFlow,
          sectorDynamics,
          operationAdvice,
          generatedAt: new Date().toISOString()
        }
      }

      await this.saveReport(reportData)
      
      logger.info(`盘中观察报表生成完成: ${reportData.reportId}`)
      return reportData
    } catch (error) {
      logger.error('生成盘中观察报表失败:', error)
      throw error
    }
  }

  // 生成收盘复盘报表
  static async generatePostMarketReport(userId: string): Promise<ReportData> {
    try {
      logger.info(`开始生成用户 ${userId} 的收盘复盘报表`)

      // 获取今日表现
      const dailyPerformance = await this.getDailyPerformance(userId)
      
      // 获取技术复盘
      const technicalReview = await this.getTechnicalReview(userId)
      
      // 获取基本面变化
      const fundamentalChanges = await this.getFundamentalChanges(userId)
      
      // 获取市场复盘
      const marketReview = await this.getMarketReview()

      const reportData = {
        reportId: `post_market_${Date.now()}`,
        userId,
        reportType: 'post_market',
        timestamp: new Date().toISOString(),
        data: {
          dailyPerformance,
          technicalReview,
          fundamentalChanges,
          marketReview,
          generatedAt: new Date().toISOString()
        }
      }

      await this.saveReport(reportData)
      
      logger.info(`收盘复盘报表生成完成: ${reportData.reportId}`)
      return reportData
    } catch (error) {
      logger.error('生成收盘复盘报表失败:', error)
      throw error
    }
  }

  // 生成日终决策报表
  static async generateDailyDecisionReport(userId: string): Promise<ReportData> {
    try {
      logger.info(`开始生成用户 ${userId} 的日终决策报表`)

      // 获取持仓诊断
      const portfolioDiagnosis = await this.getPortfolioDiagnosis(userId)
      
      // 获取AI决策建议
      const aiRecommendations = await this.getAIRecommendations(userId)
      
      // 获取仓位调整方案
      const rebalancingPlan = await this.getRebalancingPlan(userId)
      
      // 获取明日计划
      const tomorrowPlan = await this.getTomorrowPlan(userId)

      const reportData = {
        reportId: `daily_decision_${Date.now()}`,
        userId,
        reportType: 'daily_decision',
        timestamp: new Date().toISOString(),
        data: {
          portfolioDiagnosis,
          aiRecommendations,
          rebalancingPlan,
          tomorrowPlan,
          generatedAt: new Date().toISOString()
        }
      }

      await this.saveReport(reportData)
      
      logger.info(`日终决策报表生成完成: ${reportData.reportId}`)
      return reportData
    } catch (error) {
      logger.error('生成日终决策报表失败:', error)
      throw error
    }
  }

  // 获取用户持仓
  private static async getUserPositions(userId: string): Promise<any[]> {
    const connection = getConnection()
    const [positions] = await connection.execute(
      'SELECT * FROM positions WHERE user_id = ?',
      [userId]
    )
    return positions as any[]
  }

  // 获取投资组合概览
  private static async getPortfolioOverview(positions: any[]): Promise<any> {
    const totalMarketValue = positions.reduce((sum, p) => sum + p.market_value, 0)
    const totalProfitLoss = positions.reduce((sum, p) => sum + p.profit_loss, 0)
    const totalProfitLossRate = totalMarketValue > 0 ? (totalProfitLoss / totalMarketValue) * 100 : 0

    return {
      totalPositions: positions.length,
      totalMarketValue,
      totalProfitLoss,
      totalProfitLossRate,
      positions: positions.map(p => ({
        code: p.stock_code,
        name: p.stock_name,
        marketValue: p.market_value,
        profitLoss: p.profit_loss,
        profitLossRate: p.profit_loss_rate
      }))
    }
  }

  // 获取重要资讯
  private static async getImportantNews(positions: any[]): Promise<any[]> {
    const news = []
    
    // 获取持仓股相关新闻
    for (const position of positions) {
      const stockNews = await FreeDataProvider.getNewsData()
      news.push(...stockNews.filter(n => 
        n.title.includes(position.stock_name) || 
        n.content.includes(position.stock_code)
      ))
    }
    
    // 获取政策新闻
    const policyNews = await FreeDataProvider.getPolicyData()
    news.push(...policyNews)
    
    return news.slice(0, 10) // 返回最新10条
  }

  // 获取今日关注点
  private static async getTodayFocus(positions: any[]): Promise<any[]> {
    const focus = []
    
    for (const position of positions) {
      // 获取技术关键位
      const technical = await TechnicalAnalysisService.getTechnicalAnalysis(position.stock_code)
      
      focus.push({
        stockCode: position.stock_code,
        stockName: position.stock_name,
        support: technical.support,
        resistance: technical.resistance,
        trend: technical.trend,
        signals: technical.signals
      })
    }
    
    return focus
  }

  // 获取市场环境
  private static async getMarketEnvironment(): Promise<any> {
    // 获取大盘指数
    const indices = await FreeDataProvider.getRealtimeQuotes(['sh000001', 'sz399001', 'sz399006'])
    
    // 获取市场情绪指标
    const sentiment = {
      risingStocks: Math.floor(Math.random() * 1000),
      fallingStocks: Math.floor(Math.random() * 1000),
      limitUp: Math.floor(Math.random() * 50),
      limitDown: Math.floor(Math.random() * 50)
    }
    
    return {
      indices,
      sentiment,
      marketTrend: 'positive', // 简化判断
      hotSectors: ['科技', '新能源', '医药']
    }
  }

  // 获取实时盈亏
  private static async getRealtimePnl(userId: string): Promise<any> {
    const positions = await this.getUserPositions(userId)
    const totalProfitLoss = positions.reduce((sum, p) => sum + p.profit_loss, 0)
    const totalMarketValue = positions.reduce((sum, p) => sum + p.market_value, 0)
    
    return {
      totalProfitLoss,
      totalProfitLossRate: totalMarketValue > 0 ? (totalProfitLoss / totalMarketValue) * 100 : 0,
      positions: positions.map(p => ({
        code: p.stock_code,
        name: p.stock_name,
        profitLoss: p.profit_loss,
        profitLossRate: p.profit_loss_rate
      }))
    }
  }

  // 获取异动提醒
  private static async getIntradayAlerts(userId: string): Promise<any[]> {
    const positions = await this.getUserPositions(userId)
    const alerts = []
    
    for (const position of positions) {
      // 涨跌幅超过3%提醒
      if (Math.abs(position.profit_loss_rate) > 3) {
        alerts.push({
          type: 'price_change',
          stockCode: position.stock_code,
          stockName: position.stock_name,
          message: `涨跌幅超过3%: ${position.profit_loss_rate.toFixed(2)}%`,
          level: 'warning'
        })
      }
      
      // 技术信号提醒
      const technical = await TechnicalAnalysisService.getTechnicalAnalysis(position.stock_code)
      if (technical.signals.length > 0) {
        alerts.push({
          type: 'technical_signal',
          stockCode: position.stock_code,
          stockName: position.stock_name,
          message: technical.signals[0].description,
          level: 'info'
        })
      }
    }
    
    return alerts
  }

  // 获取资金流向
  private static async getMoneyFlow(userId: string): Promise<any> {
    const positions = await this.getUserPositions(userId)
    const moneyFlow = []
    
    for (const position of positions) {
      // 模拟资金流向数据
      moneyFlow.push({
        stockCode: position.stock_code,
        stockName: position.stock_name,
        netInflow: Math.random() * 1000000 - 500000, // 模拟净流入
        mainInflow: Math.random() * 500000,
        retailInflow: Math.random() * 300000
      })
    }
    
    return moneyFlow
  }

  // 获取板块动态
  private static async getSectorDynamics(): Promise<any> {
    // 模拟板块数据
    return {
      hotSectors: [
        { name: '科技', change: 2.5, changeRate: 1.8 },
        { name: '新能源', change: 1.8, changeRate: 1.2 },
        { name: '医药', change: -0.5, changeRate: -0.3 }
      ],
      sectorRotation: '科技->新能源->医药'
    }
  }

  // 获取操作建议
  private static async getOperationAdvice(userId: string): Promise<any[]> {
    const positions = await this.getUserPositions(userId)
    const advice = []
    
    for (const position of positions) {
      const classification = await PositionClassificationService.classifyPosition(
        position.stock_code, 
        position.current_price
      )
      
      if (classification.recommendations.length > 0) {
        advice.push({
          stockCode: position.stock_code,
          stockName: position.stock_name,
          recommendations: classification.recommendations
        })
      }
    }
    
    return advice
  }

  // 获取今日表现
  private static async getDailyPerformance(userId: string): Promise<any> {
    const positions = await this.getUserPositions(userId)
    
    // 按涨跌幅排序
    const sortedPositions = positions.sort((a, b) => b.profit_loss_rate - a.profit_loss_rate)
    
    return {
      bestPerformer: sortedPositions[0],
      worstPerformer: sortedPositions[sortedPositions.length - 1],
      totalReturn: positions.reduce((sum, p) => sum + p.profit_loss_rate, 0) / positions.length,
      winRate: positions.filter(p => p.profit_loss > 0).length / positions.length * 100
    }
  }

  // 获取技术复盘
  private static async getTechnicalReview(userId: string): Promise<any> {
    const positions = await this.getUserPositions(userId)
    const technicalReview = []
    
    for (const position of positions) {
      const technical = await TechnicalAnalysisService.getTechnicalAnalysis(position.stock_code)
      
      technicalReview.push({
        stockCode: position.stock_code,
        stockName: position.stock_name,
        trend: technical.trend,
        strength: technical.strength,
        signals: technical.signals
      })
    }
    
    return technicalReview
  }

  // 获取基本面变化
  private static async getFundamentalChanges(userId: string): Promise<any[]> {
    const positions = await this.getUserPositions(userId)
    const changes = []
    
    for (const position of positions) {
      const fundamental = await FundamentalAnalysisService.getFundamentalAnalysis(position.stock_code)
      
      changes.push({
        stockCode: position.stock_code,
        stockName: position.stock_name,
        qualityScore: fundamental.quality.score,
        rating: fundamental.quality.rating,
        strengths: fundamental.quality.strengths,
        weaknesses: fundamental.quality.weaknesses
      })
    }
    
    return changes
  }

  // 获取市场复盘
  private static async getMarketReview(): Promise<any> {
    return {
      marketTrend: '震荡上行',
      sectorPerformance: '科技领涨，医药回调',
      marketSentiment: '谨慎乐观',
      keyEvents: [
        '央行货币政策会议',
        '重要经济数据发布',
        '行业政策出台'
      ]
    }
  }

  // 获取持仓诊断
  private static async getPortfolioDiagnosis(userId: string): Promise<any> {
    const positions = await this.getUserPositions(userId)
    
    // 计算整体健康度
    let totalScore = 0
    for (const position of positions) {
      const classification = await PositionClassificationService.classifyPosition(
        position.stock_code, 
        position.current_price
      )
      totalScore += classification.score.overall
    }
    
    const avgScore = totalScore / positions.length
    
    return {
      overallScore: avgScore,
      riskLevel: avgScore >= 80 ? 'low' : avgScore >= 60 ? 'medium' : 'high',
      positions: positions.map(p => ({
        code: p.stock_code,
        name: p.stock_name,
        score: avgScore, // 简化处理
        risk: avgScore >= 80 ? 'low' : avgScore >= 60 ? 'medium' : 'high'
      }))
    }
  }

  // 获取AI决策建议
  private static async getAIRecommendations(userId: string): Promise<any[]> {
    const positions = await this.getUserPositions(userId)
    const recommendations = []
    
    for (const position of positions) {
      const classification = await PositionClassificationService.classifyPosition(
        position.stock_code, 
        position.current_price
      )
      
      recommendations.push({
        stockCode: position.stock_code,
        stockName: position.stock_name,
        category: classification.category,
        confidence: classification.confidence,
        recommendations: classification.recommendations
      })
    }
    
    return recommendations
  }

  // 获取仓位调整方案
  private static async getRebalancingPlan(userId: string): Promise<any> {
    return {
      leftSideRatio: 30,
      rightSideRatio: 50,
      defensiveRatio: 15,
      observationRatio: 5,
      rebalancingActions: [
        {
          action: 'reduce',
          stockCode: '000001',
          reason: '技术破位，建议减仓'
        },
        {
          action: 'increase',
          stockCode: '000002',
          reason: '技术突破，建议加仓'
        }
      ]
    }
  }

  // 获取明日计划
  private static async getTomorrowPlan(userId: string): Promise<any> {
    return {
      watchList: [
        '000001 - 关注技术突破',
        '000002 - 关注基本面变化'
      ],
      alerts: [
        '价格提醒: 000001 > 15.5',
        '技术信号: 000002 MACD金叉'
      ],
      operations: [
        '减仓000001 1000股',
        '加仓000002 500股'
      ]
    }
  }

  // 保存报表
  private static async saveReport(reportData: ReportData): Promise<void> {
    const connection = getConnection()
    await connection.execute(
      'INSERT INTO daily_reports (id, user_id, report_type, report_data, created_at) VALUES (?, ?, ?, ?, NOW())',
      [reportData.reportId, reportData.userId, reportData.reportType, JSON.stringify(reportData.data)]
    )
  }
}
