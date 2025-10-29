import { logger } from '../utils/logger'
import { getConnection } from '../config/database'
import { TimeSeriesAnalysisService, DecisionAnalysis } from './timeSeriesAnalysis'
import { PositionClassificationService } from './positionClassification'
import { TechnicalAnalysisService } from './technicalAnalysis'
import { FundamentalAnalysisService } from './fundamentalAnalysis'

export interface FinalDecision {
  decisionId: string
  userId: string
  timestamp: string
  timeHorizon: 'daily' | 'weekly' | 'monthly'
  overallAssessment: {
    portfolioHealth: number
    riskLevel: 'low' | 'medium' | 'high'
    expectedReturn: number
    confidence: number
  }
  positionDecisions: Array<{
    stockCode: string
    stockName: string
    currentCategory: string
    recommendedAction: 'continue' | 'buy' | 'sell' | 'reduce' | 'increase'
    confidence: number
    reasoning: string
    targetPrice?: number
    stopLoss?: number
    positionSize?: number
  }>
  portfolioAdjustment: {
    leftSideRatio: number
    rightSideRatio: number
    defensiveRatio: number
    observationRatio: number
    rebalancingActions: Array<{
      action: string
      stockCode: string
      reason: string
      priority: 'high' | 'medium' | 'low'
    }>
  }
  nextSteps: {
    immediateActions: string[]
    watchList: string[]
    alerts: string[]
    timeline: string
  }
}

export class DecisionEngine {
  // 生成最终投资决策
  static async generateFinalDecision(
    userId: string, 
    timeHorizon: 'daily' | 'weekly' | 'monthly' = 'daily'
  ): Promise<FinalDecision> {
    try {
      logger.info(`开始为用户 ${userId} 生成${timeHorizon}投资决策`)

      // 获取用户持仓
      const positions = await this.getUserPositions(userId)
      
      // 获取时间序列分析
      const timeSeriesAnalysis = await this.getTimeSeriesAnalysis(positions, timeHorizon)
      
      // 生成持仓决策
      const positionDecisions = await this.generatePositionDecisions(positions, timeSeriesAnalysis)
      
      // 生成组合调整方案
      const portfolioAdjustment = await this.generatePortfolioAdjustment(positionDecisions, timeSeriesAnalysis)
      
      // 生成下一步计划
      const nextSteps = await this.generateNextSteps(positionDecisions, portfolioAdjustment)
      
      // 计算整体评估
      const overallAssessment = await this.calculateOverallAssessment(positionDecisions, timeSeriesAnalysis)

      const finalDecision: FinalDecision = {
        decisionId: `decision_${Date.now()}`,
        userId,
        timestamp: new Date().toISOString(),
        timeHorizon,
        overallAssessment,
        positionDecisions,
        portfolioAdjustment,
        nextSteps
      }

      // 保存决策记录
      await this.saveDecision(finalDecision)
      
      logger.info(`投资决策生成完成: ${finalDecision.decisionId}`)
      return finalDecision
    } catch (error) {
      logger.error('生成投资决策失败:', error)
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

  // 获取时间序列分析
  private static async getTimeSeriesAnalysis(
    positions: any[], 
    timeHorizon: 'daily' | 'weekly' | 'monthly'
  ): Promise<DecisionAnalysis[]> {
    const analyses: DecisionAnalysis[] = []
    
    for (const position of positions) {
      let timeSeriesData
      
      if (timeHorizon === 'daily') {
        timeSeriesData = await TimeSeriesAnalysisService.getDailyTimeSeries(position.stock_code, 30)
      } else if (timeHorizon === 'weekly') {
        timeSeriesData = await TimeSeriesAnalysisService.getWeeklyTimeSeries(position.stock_code, 12)
      } else {
        timeSeriesData = await TimeSeriesAnalysisService.getMonthlyTimeSeries(position.stock_code, 6)
      }
      
      const analysis = TimeSeriesAnalysisService.analyzeTimeSeriesTrend(timeSeriesData)
      analyses.push(analysis)
    }
    
    return analyses
  }

  // 生成持仓决策
  private static async generatePositionDecisions(
    positions: any[], 
    timeSeriesAnalysis: DecisionAnalysis[]
  ): Promise<any[]> {
    const decisions: any[] = []
    
    for (let i = 0; i < positions.length; i++) {
      const position = positions[i]
      const analysis = timeSeriesAnalysis[i]
      
      // 获取当前分类
      const classification = await PositionClassificationService.classifyPosition(
        position.stock_code, 
        position.current_price
      )
      
      // 基于时间序列分析生成决策
      const decision = await this.generateSinglePositionDecision(position, analysis, classification)
      decisions.push(decision)
    }
    
    return decisions
  }

  // 生成单个持仓决策
  private static async generateSinglePositionDecision(
    position: any, 
    analysis: DecisionAnalysis, 
    classification: any
  ): Promise<any> {
    const { recommendations, trendAnalysis, riskAssessment } = analysis
    
    let recommendedAction: 'continue' | 'buy' | 'sell' | 'reduce' | 'increase'
    let confidence = 0
    let reasoning = ''
    let targetPrice: number | undefined
    let stopLoss: number | undefined
    let positionSize: number | undefined
    
    // 基于趋势和风险的综合判断
    if (recommendations.action === 'continue') {
      if (classification.category === 'right' && trendAnalysis.direction === 'improving') {
        recommendedAction = 'continue'
        confidence = 0.9
        reasoning = '右侧持仓趋势向好，建议继续持有'
      } else if (classification.category === 'left' && trendAnalysis.direction === 'improving') {
        recommendedAction = 'increase'
        confidence = 0.8
        reasoning = '左侧持仓基本面改善，建议适度加仓'
        targetPrice = position.current_price * 1.1
      } else {
        recommendedAction = 'continue'
        confidence = 0.6
        reasoning = '持仓稳定，建议继续观察'
      }
    } else if (recommendations.action === 'adjust') {
      if (riskAssessment.level === 'high') {
        recommendedAction = 'reduce'
        confidence = 0.8
        reasoning = '风险较高，建议减仓控制风险'
        stopLoss = position.current_price * 0.9
      } else if (trendAnalysis.direction === 'improving') {
        recommendedAction = 'increase'
        confidence = 0.7
        reasoning = '趋势向好，建议适度加仓'
        targetPrice = position.current_price * 1.15
      } else {
        recommendedAction = 'reduce'
        confidence = 0.6
        reasoning = '趋势不明，建议减仓观望'
      }
    } else if (recommendations.action === 'replace') {
      recommendedAction = 'sell'
      confidence = 0.8
      reasoning = '基本面恶化且技术面转弱，建议卖出'
      stopLoss = position.current_price * 0.95
    } else {
      recommendedAction = 'continue'
      confidence = 0.5
      reasoning = '情况复杂，建议谨慎持有'
    }
    
    // 计算建议仓位
    if (recommendedAction === 'increase') {
      positionSize = Math.min(position.quantity * 1.2, position.quantity + 1000)
    } else if (recommendedAction === 'reduce') {
      positionSize = Math.max(position.quantity * 0.8, position.quantity - 1000)
    } else {
      positionSize = position.quantity
    }
    
    return {
      stockCode: position.stock_code,
      stockName: position.stock_name,
      currentCategory: classification.category,
      recommendedAction,
      confidence,
      reasoning,
      targetPrice,
      stopLoss,
      positionSize
    }
  }

  // 生成组合调整方案
  private static async generatePortfolioAdjustment(
    positionDecisions: any[], 
    timeSeriesAnalysis: DecisionAnalysis[]
  ): Promise<any> {
    // 分析当前仓位分布
    const categoryCount = positionDecisions.reduce((acc, decision) => {
      acc[decision.currentCategory] = (acc[decision.currentCategory] || 0) + 1
      return acc
    }, {})
    
    // 计算建议的仓位比例
    const totalPositions = positionDecisions.length
    const leftSideRatio = Math.round((categoryCount.left || 0) / totalPositions * 100)
    const rightSideRatio = Math.round((categoryCount.right || 0) / totalPositions * 100)
    const defensiveRatio = Math.round((categoryCount.defensive || 0) / totalPositions * 100)
    const observationRatio = Math.round((categoryCount.observation || 0) / totalPositions * 100)
    
    // 生成再平衡建议
    const rebalancingActions = []
    
    // 如果右侧仓位不足，建议增加
    if (rightSideRatio < 40) {
      rebalancingActions.push({
        action: '增加右侧仓位',
        stockCode: '建议关注',
        reason: '右侧仓位不足，建议关注趋势向上的优质标的',
        priority: 'high'
      })
    }
    
    // 如果左侧仓位过多，建议调整
    if (leftSideRatio > 50) {
      rebalancingActions.push({
        action: '减少左侧仓位',
        stockCode: '建议调整',
        reason: '左侧仓位过重，建议适度减仓或转换为右侧',
        priority: 'medium'
      })
    }
    
    // 如果防御性仓位不足，建议增加
    if (defensiveRatio < 15) {
      rebalancingActions.push({
        action: '增加防御性仓位',
        stockCode: '建议关注',
        reason: '防御性仓位不足，建议关注高股息、低估值标的',
        priority: 'medium'
      })
    }
    
    return {
      leftSideRatio,
      rightSideRatio,
      defensiveRatio,
      observationRatio,
      rebalancingActions
    }
  }

  // 生成下一步计划
  private static async generateNextSteps(
    positionDecisions: any[], 
    portfolioAdjustment: any
  ): Promise<any> {
    const immediateActions = []
    const watchList = []
    const alerts = []
    
    // 基于持仓决策生成即时行动
    for (const decision of positionDecisions) {
      if (decision.recommendedAction === 'sell') {
        immediateActions.push(`卖出 ${decision.stockName} (${decision.stockCode}) - ${decision.reasoning}`)
      } else if (decision.recommendedAction === 'buy') {
        immediateActions.push(`买入 ${decision.stockName} (${decision.stockCode}) - ${decision.reasoning}`)
      } else if (decision.recommendedAction === 'reduce') {
        immediateActions.push(`减仓 ${decision.stockName} (${decision.stockCode}) - ${decision.reasoning}`)
      } else if (decision.recommendedAction === 'increase') {
        immediateActions.push(`加仓 ${decision.stockName} (${decision.stockCode}) - ${decision.reasoning}`)
      }
    }
    
    // 生成关注清单
    for (const decision of positionDecisions) {
      if (decision.targetPrice) {
        watchList.push(`${decision.stockName} (${decision.stockCode}) 目标价: ${decision.targetPrice.toFixed(2)}`)
      }
      if (decision.stopLoss) {
        watchList.push(`${decision.stockName} (${decision.stockCode}) 止损价: ${decision.stopLoss.toFixed(2)}`)
      }
    }
    
    // 生成提醒设置
    for (const decision of positionDecisions) {
      if (decision.recommendedAction === 'continue' && decision.confidence < 0.7) {
        alerts.push(`关注 ${decision.stockName} (${decision.stockCode}) 技术面变化`)
      }
    }
    
    // 基于组合调整生成提醒
    for (const action of portfolioAdjustment.rebalancingActions) {
      if (action.priority === 'high') {
        alerts.push(`高优先级: ${action.action} - ${action.reason}`)
      }
    }
    
    return {
      immediateActions,
      watchList,
      alerts,
      timeline: this.getTimeline(positionDecisions)
    }
  }

  // 计算整体评估
  private static async calculateOverallAssessment(
    positionDecisions: any[], 
    timeSeriesAnalysis: DecisionAnalysis[]
  ): Promise<any> {
    // 计算投资组合健康度
    const avgConfidence = positionDecisions.reduce((sum, decision) => sum + decision.confidence, 0) / positionDecisions.length
    const portfolioHealth = Math.round(avgConfidence * 100)
    
    // 计算风险等级
    const highRiskCount = timeSeriesAnalysis.filter(analysis => analysis.riskAssessment.level === 'high').length
    const riskLevel = highRiskCount > timeSeriesAnalysis.length / 2 ? 'high' : 
                     highRiskCount > 0 ? 'medium' : 'low'
    
    // 计算预期收益
    const expectedReturn = this.calculateExpectedReturn(positionDecisions, timeSeriesAnalysis)
    
    // 计算整体置信度
    const overallConfidence = Math.round(avgConfidence * 100)
    
    return {
      portfolioHealth,
      riskLevel,
      expectedReturn,
      confidence: overallConfidence
    }
  }

  // 计算预期收益
  private static calculateExpectedReturn(positionDecisions: any[], timeSeriesAnalysis: DecisionAnalysis[]): number {
    // 基于历史表现和趋势分析计算预期收益
    const avgReturn = timeSeriesAnalysis.reduce((sum, analysis) => {
      const latestPerformance = analysis.dataPoints[analysis.dataPoints.length - 1]?.performance
      return sum + (latestPerformance?.return || 0)
    }, 0) / timeSeriesAnalysis.length
    
    // 基于决策调整预期收益
    const decisionMultiplier = positionDecisions.reduce((sum, decision) => {
      switch (decision.recommendedAction) {
        case 'buy':
        case 'increase':
          return sum + 1.2
        case 'sell':
        case 'reduce':
          return sum + 0.8
        default:
          return sum + 1.0
      }
    }, 0) / positionDecisions.length
    
    return Math.round(avgReturn * decisionMultiplier * 100) / 100
  }

  // 获取时间线
  private static getTimeline(positionDecisions: any[]): string {
    const urgentActions = positionDecisions.filter(d => 
      d.recommendedAction === 'sell' || d.recommendedAction === 'buy'
    ).length
    
    if (urgentActions > 0) {
      return '1-3天内执行紧急操作'
    } else {
      return '1-2周内完成调整'
    }
  }

  // 保存决策记录
  private static async saveDecision(decision: FinalDecision): Promise<void> {
    const connection = getConnection()
    await connection.execute(
      'INSERT INTO decisions (id, user_id, decision_type, decision_data, created_at) VALUES (?, ?, ?, ?, NOW())',
      [decision.decisionId, decision.userId, decision.timeHorizon, JSON.stringify(decision)]
    )
  }
}
