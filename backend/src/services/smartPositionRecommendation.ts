import { logger } from '../utils/logger'
import { TechnicalAnalysisService } from './technicalAnalysis'
import { FundamentalAnalysisService } from './fundamentalAnalysis'
import { TimeSeriesAnalysisService } from './timeSeriesAnalysis'
import { DataProvider } from './dataProvider'

/**
 * 智能仓位推荐系统
 * 基于多维数据分析，自动推荐股票的左仓/右仓策略
 * 核心逻辑：通过大数据推理判断最终推荐持有建议
 */
export interface PositionRecommendation {
  stockCode: string
  stockName: string
  recommendedPosition: 'left' | 'right' | 'mainline' | 'defensive' | 'exit'
  currentStatus: {
    isHeld: boolean
    quantity?: number
    averagePrice?: number
    currentPrice: number
  }
  recommendation: {
    action: 'build' | 'add' | 'hold' | 'reduce' | 'exit' | 'upgrade'
    confidence: number
    reasoning: string[]
    urgency: 'high' | 'medium' | 'low'
  }
  timeNodes: {
    buildLeft: TimeNode[]  // 建左仓时间节点
    upgradeToRight: TimeNode[]  // 升级到右仓时间节点
    upgradeToMainline: TimeNode[]  // 升级到主线时间节点
    addPosition: TimeNode[]  // 加仓时间节点
    reducePosition: TimeNode[]  // 减仓时间节点
    exit: TimeNode[]  // 退出时间节点
  }
  positionSize: {
    recommendedLeftPosition: number  // 推荐左仓比例 10-30%
    recommendedRightPosition: number  // 推荐右仓比例 30-50%
    recommendedMainlinePosition: number  // 推荐主线仓位 50-70%
    maxPosition: number  // 最大仓位限制
  }
  riskControl: {
    stopLoss: number
    targetPrice: number
    positionLadder: Array<{
      price: number
      positionRatio: number
      description: string
    }>
  }
  prediction: {
    entrySignal: string  // 入场信号描述
    exitSignal: string  // 出场信号描述
    keyNodes: Array<{
      date: string
      event: string
      impact: 'high' | 'medium' | 'low'
      action: string
    }>
    trendForecast: {
      direction: 'up' | 'down' | 'sideways'
      probability: number
      timeframe: string
    }
  }
}

export interface TimeNode {
  date: string
  price: number
  condition: string
  confidence: number
  action: string
  priority: 'high' | 'medium' | 'low'
}

export class SmartPositionRecommendationService {
  /**
   * 生成智能仓位推荐
   * @param stockCode 股票代码
   * @param userId 用户ID
   */
  static async generateRecommendation(
    stockCode: string, 
    userId: string
  ): Promise<PositionRecommendation> {
    try {
      logger.info(`开始为股票 ${stockCode} 生成智能仓位推荐`)
      
      // 1. 获取多维数据
      const technicalAnalysis = await TechnicalAnalysisService.getTechnicalAnalysis(stockCode)
      const fundamentalAnalysis = await FundamentalAnalysisService.getFundamentalAnalysis(stockCode)
      const timeSeriesData = await TimeSeriesAnalysisService.getDailyTimeSeries(stockCode, 60)
      const stockInfo = await DataProvider.getStockInfo(stockCode)
      
      // 2. 获取用户当前持仓
      const currentPosition = await this.getUserPosition(userId, stockCode)
      
      // 3. 综合评估
      const positionAssessment = await this.assessPosition(
        technicalAnalysis, 
        fundamentalAnalysis, 
        timeSeriesData,
        stockInfo,
        currentPosition
      )
      
      // 4. 生成仓位推荐
      const positionRecommendation = this.generatePositionStrategy(
        positionAssessment,
        currentPosition,
        stockInfo
      )
      
      // 5. 生成时间节点
      const timeNodes = await this.generateTimeNodes(
        stockCode,
        positionAssessment,
        currentPosition
      )
      
      // 6. 计算仓位大小
      const positionSize = this.calculatePositionSize(
        positionAssessment,
        currentPosition
      )
      
      // 7. 风险控制
      const riskControl = this.calculateRiskControl(
        positionAssessment,
        stockInfo
      )
      
      // 8. 趋势预测
      const prediction = await this.generatePrediction(
        stockCode,
        technicalAnalysis,
        fundamentalAnalysis,
        timeSeriesData
      )
      
      return {
        stockCode,
        stockName: stockInfo.name,
        recommendedPosition: positionRecommendation.position,
        currentStatus: {
          isHeld: !!currentPosition,
          quantity: currentPosition?.quantity,
          averagePrice: currentPosition?.average_price,
          currentPrice: stockInfo.price
        },
        recommendation: positionRecommendation.recommendation,
        timeNodes,
        positionSize,
        riskControl,
        prediction
      }
    } catch (error) {
      logger.error('生成智能仓位推荐失败:', error)
      throw error
    }
  }
  
  /**
   * 获取用户持仓
   */
  private static async getUserPosition(userId: string, stockCode: string): Promise<any> {
    const { getConnection } = await import('../config/database')
    const connection = getConnection()
    const [positions] = await connection.execute(
      'SELECT * FROM positions WHERE user_id = ? AND stock_code = ?',
      [userId, stockCode]
    )
    return (positions as any[])[0]
  }
  
  /**
   * 综合评估
   */
  private static async assessPosition(
    technical: any,
    fundamental: any,
    timeSeries: any[],
    stockInfo: any,
    currentPosition?: any
  ): Promise<any> {
    // 1. 技术面评估（30%权重）
    const technicalScore = this.assessTechnical(technical)
    
    // 2. 基本面评估（25%权重）
    const fundamentalScore = this.assessFundamental(fundamental)
    
    // 3. 趋势评估（25%权重）
    const trendScore = this.assessTrend(timeSeries)
    
    // 4. 市场环境评估（20%权重）
    const marketScore = await this.assessMarket(stockInfo)
    
    // 5. 计算综合得分
    const overallScore = 
      technicalScore * 0.30 +
      fundamentalScore * 0.25 +
      trendScore * 0.25 +
      marketScore * 0.20
    
    // 6. 判断趋势阶段
    const trendPhase = this.determineTrendPhase(technical, timeSeries)
    
    // 7. 判断买入机会等级
    const opportunityLevel = this.determineOpportunityLevel(
      technicalScore,
      fundamentalScore,
      trendScore,
      trendPhase
    )
    
    return {
      technicalScore,
      fundamentalScore,
      trendScore,
      marketScore,
      overallScore,
      trendPhase,
      opportunityLevel
    }
  }
  
  /**
   * 技术面评估
   */
  private static assessTechnical(technical: any): number {
    let score = 0
    
    // 1. 趋势强度 (30%)
    if (technical.trend === 'up') {
      score += 30 * (technical.strength / 100)
    } else if (technical.trend === 'down') {
      score += 30 * (1 - technical.strength / 100)
    } else {
      score += 15
    }
    
    // 2. 均线系统 (25%)
    const maScore = this.assessMASystem(technical.indicators)
    score += maScore * 0.25
    
    // 3. 技术指标 (25%)
    const indicatorScore = this.assessIndicators(technical.indicators)
    score += indicatorScore * 0.25
    
    // 4. 交易信号 (20%)
    const signalScore = this.assessSignals(technical.signals)
    score += signalScore * 0.20
    
    return Math.min(score, 100)
  }
  
  /**
   * 评估均线系统
   */
  private static assessMASystem(indicators: any): number {
    const { ma5, ma10, ma20, ma60, ma120 } = indicators
    
    // 多头排列
    if (ma5 > ma10 && ma10 > ma20 && ma20 > ma60) {
      return 100
    }
    // 部分多头
    else if (ma5 > ma10 && ma10 > ma20) {
      return 75
    }
    // 震荡
    else if (Math.abs(ma5 - ma10) < ma10 * 0.02) {
      return 50
    }
    // 空头排列
    else {
      return 25
    }
  }
  
  /**
   * 评估技术指标
   */
  private static assessIndicators(indicators: any): number {
    let score = 0
    
    // MACD
    if (indicators.macd.value > indicators.macd.signal && indicators.macd.histogram > 0) {
      score += 35
    } else if (indicators.macd.value < indicators.macd.signal) {
      score += 15
    } else {
      score += 25
    }
    
    // RSI
    if (indicators.rsi < 30) {
      score += 35  // 超卖，可能反弹
    } else if (indicators.rsi > 70) {
      score += 15  // 超买
    } else if (indicators.rsi > 50) {
      score += 30
    } else {
      score += 20
    }
    
    // KDJ
    if (indicators.kdj.k > indicators.kdj.d && indicators.kdj.j > indicators.kdj.k) {
      score += 30
    } else if (indicators.kdj.k < indicators.kdj.d) {
      score += 10
    } else {
      score += 20
    }
    
    return score
  }
  
  /**
   * 评估交易信号
   */
  private static assessSignals(signals: any[]): number {
    if (signals.length === 0) return 50
    
    const buySignals = signals.filter(s => s.type === 'buy').length
    const sellSignals = signals.filter(s => s.type === 'sell').length
    
    const buyStrength = signals
      .filter(s => s.type === 'buy')
      .reduce((sum, s) => sum + (s.strength === 'strong' ? 2 : s.strength === 'medium' ? 1 : 0.5), 0)
    const sellStrength = signals
      .filter(s => s.type === 'sell')
      .reduce((sum, s) => sum + (s.strength === 'strong' ? 2 : s.strength === 'medium' ? 1 : 0.5), 0)
    
    return 50 + (buyStrength - sellStrength) * 20
  }
  
  /**
   * 基本面评估
   */
  private static assessFundamental(fundamental: any): number {
    const { valuation, profitability, growth, financial, quality } = fundamental
    
    // 直接使用质量评分
    return quality.score
  }
  
  /**
   * 趋势评估
   */
  private static assessTrend(timeSeries: any[]): number {
    if (timeSeries.length < 2) return 50
    
    const recentPerformance = timeSeries.slice(-10)
    const avgPerformance = recentPerformance.reduce((sum, item) => sum + item.performance.return, 0) / recentPerformance.length
    
    // 波动率
    const volatilities = recentPerformance.map(item => item.performance.volatility)
    const avgVolatility = volatilities.reduce((sum, v) => sum + v, 0) / volatilities.length
    
    // 综合评分
    let score = 50
    score += (avgPerformance > 0 ? 25 : -15) // 收益影响
    score -= avgVolatility * 50 // 波动惩罚
    
    return Math.max(0, Math.min(100, score))
  }
  
  /**
   * 市场环境评估
   */
  private static async assessMarket(stockInfo: any): Promise<number> {
    // 简化实现，实际应该考虑板块、资金流向等
    return Math.random() * 40 + 60
  }
  
  /**
   * 判断趋势阶段
   */
  private static determineTrendPhase(technical: any, timeSeries: any[]): string {
    // 1. 下跌后的筑底阶段（适合左仓）
    if (technical.trend === 'down' && technical.strength < 30) {
      return 'bottom-building'
    }
    
    // 2. 突破阶段（适合右仓）
    if (technical.trend === 'up' && technical.strength > 70) {
      return 'breakout'
    }
    
    // 3. 上涨中继（适合主线）
    if (technical.trend === 'up' && technical.strength > 50) {
      return 'uptrend-continuation'
    }
    
    // 4. 震荡整理
    if (technical.trend === 'sideways') {
      return 'consolidation'
    }
    
    // 5. 回调阶段
    if (technical.trend === 'down' && technical.strength < 50) {
      return 'pullback'
    }
    
    return 'uncertain'
  }
  
  /**
   * 判断机会等级
   */
  private static determineOpportunityLevel(
    technicalScore: number,
    fundamentalScore: number,
    trendScore: number,
    trendPhase: string
  ): string {
    const avgScore = (technicalScore + fundamentalScore + trendScore) / 3
    
    // 高机会：技术面好 + 基本面好 + 趋势向上
    if (avgScore >= 75 && trendPhase === 'breakout') {
      return 'high'
    }
    
    // 中高机会：基本面好 + 技术面一般（适合左仓）
    if (fundamentalScore >= 70 && technicalScore >= 50 && trendPhase === 'bottom-building') {
      return 'medium-high'
    }
    
    // 中等机会
    if (avgScore >= 60) {
      return 'medium'
    }
    
    // 低机会
    if (avgScore >= 40) {
      return 'low'
    }
    
    return 'very-low'
  }
  
  /**
   * 生成仓位策略
   */
  private static generatePositionStrategy(
    assessment: any,
    currentPosition: any,
    stockInfo: any
  ): any {
    const { overallScore, trendPhase, opportunityLevel } = assessment
    
    let position: 'left' | 'right' | 'mainline' | 'defensive' | 'exit'
    let action: 'build' | 'add' | 'hold' | 'reduce' | 'exit' | 'upgrade'
    let confidence = 0
    const reasoning: string[] = []
    let urgency: 'high' | 'medium' | 'low' = 'low'
    
    // 用户已持有
    if (currentPosition) {
      // 根据当前情况决定操作
      if (overallScore >= 75 && trendPhase === 'breakout') {
        action = 'upgrade'
        position = 'right'
        confidence = 85
        reasoning.push('技术突破，趋势向上，建议升级到右仓或主线')
        urgency = 'high'
      } else if (overallScore >= 70 && trendPhase === 'uptrend-continuation') {
        action = 'add'
        position = 'mainline'
        confidence = 80
        reasoning.push('趋势延续，建议加仓到主线仓位')
        urgency = 'medium'
      } else if (overallScore < 50 && trendPhase === 'consolidation') {
        action = 'reduce'
        position = 'left'
        confidence = 70
        reasoning.push('基本面转弱，建议减仓观望')
        urgency = 'medium'
      } else if (overallScore < 40) {
        action = 'exit'
        position = 'exit'
        confidence = 75
        reasoning.push('基本面恶化，建议清仓退出')
        urgency = 'high'
      } else {
        action = 'hold'
        position = currentPosition.category || 'left'
        confidence = 60
        reasoning.push('情况稳定，建议继续持有观察')
        urgency = 'low'
      }
    } else {
      // 用户未持有，判断是否推荐买入
      if (overallScore >= 70 && trendPhase === 'bottom-building' && opportunityLevel !== 'very-low') {
        action = 'build'
        position = 'left'
        confidence = 75
        reasoning.push('基本面良好，处于筑底阶段，建议建左仓')
        reasoning.push('当前估值合理，适合长期布局')
        urgency = 'medium'
      } else if (overallScore >= 80 && trendPhase === 'breakout') {
        action = 'build'
        position = 'right'
        confidence = 85
        reasoning.push('技术突破，趋势向上，建议直接建右仓')
        reasoning.push('市场表现强劲，时机成熟')
        urgency = 'high'
      } else {
        action = 'hold'
        position = 'exit'
        confidence = 50
        reasoning.push('当前机会不明确，建议观望')
        urgency = 'low'
      }
    }
    
    return { position, recommendation: { action, confidence, reasoning, urgency } }
  }
  
  /**
   * 生成时间节点
   */
  private static async generateTimeNodes(
    stockCode: string,
    assessment: any,
    currentPosition: any
  ): Promise<any> {
    const nodes: TimeNode[] = []
    const currentDate = new Date()
    
    // 根据趋势阶段生成不同时间节点
    const { trendPhase, overallScore } = assessment
    
    // 建左仓时间节点
    const buildLeftNodes: TimeNode[] = []
    if (!currentPosition && overallScore >= 70) {
      buildLeftNodes.push({
        date: currentDate.toISOString().split('T')[0],
        price: 0, // 需要实际价格
        condition: '基本面良好，技术面企稳',
        confidence: 75,
        action: '建议建左仓10-20%',
        priority: 'medium'
      })
    }
    
    // 升级到右仓时间节点
    const upgradeToRightNodes: TimeNode[] = []
    if (currentPosition && trendPhase === 'breakout' && overallScore >= 75) {
      const nextWeek = new Date(currentDate.getTime() + 7 * 24 * 60 * 60 * 1000)
      upgradeToRightNodes.push({
        date: nextWeek.toISOString().split('T')[0],
        price: 0,
        condition: '突破压力位，成交量放大',
        confidence: 80,
        action: '建议从左仓升级到右仓，加仓至总仓位30-40%',
        priority: 'high'
      })
    }
    
    // 升级到主线时间节点
    const upgradeToMainlineNodes: TimeNode[] = []
    if (currentPosition && trendPhase === 'uptrend-continuation' && overallScore >= 80) {
      const nextMonth = new Date(currentDate.getTime() + 30 * 24 * 60 * 60 * 1000)
      upgradeToMainlineNodes.push({
        date: nextMonth.toISOString().split('T')[0],
        price: 0,
        condition: '趋势持续，基本面改善',
        confidence: 85,
        action: '建议升级到主线仓位，总仓位50-60%',
        priority: 'high'
      })
    }
    
    // 加仓时间节点
    const addPositionNodes: TimeNode[] = []
    
    // 减仓时间节点
    const reducePositionNodes: TimeNode[] = []
    if (currentPosition && overallScore < 50) {
      reducePositionNodes.push({
        date: currentDate.toISOString().split('T')[0],
        price: 0,
        condition: '基本面转弱，风险增加',
        confidence: 70,
        action: '建议减仓50%',
        priority: 'medium'
      })
    }
    
    // 退出时间节点
    const exitNodes: TimeNode[] = []
    if (currentPosition && overallScore < 40) {
      exitNodes.push({
        date: currentDate.toISOString().split('T')[0],
        price: 0,
        condition: '基本面恶化，建议清仓',
        confidence: 75,
        action: '建议全部清仓',
        priority: 'high'
      })
    }
    
    return {
      buildLeft: buildLeftNodes,
      upgradeToRight: upgradeToRightNodes,
      upgradeToMainline: upgradeToMainlineNodes,
      addPosition: addPositionNodes,
      reducePosition: reducePositionNodes,
      exit: exitNodes
    }
  }
  
  /**
   * 计算仓位大小
   */
  private static calculatePositionSize(
    assessment: any,
    currentPosition: any
  ): any {
    const { overallScore, trendPhase } = assessment
    
    // 左仓：10-30%
    let recommendedLeftPosition = 0
    if (overallScore >= 70 && trendPhase === 'bottom-building') {
      recommendedLeftPosition = 20
    } else if (overallScore >= 60) {
      recommendedLeftPosition = 15
    } else if (overallScore >= 50) {
      recommendedLeftPosition = 10
    }
    
    // 右仓：30-50%
    let recommendedRightPosition = 0
    if (overallScore >= 80 && trendPhase === 'breakout') {
      recommendedRightPosition = 40
    } else if (overallScore >= 75) {
      recommendedRightPosition = 35
    } else if (overallScore >= 70) {
      recommendedRightPosition = 30
    }
    
    // 主线：50-70%
    let recommendedMainlinePosition = 0
    if (overallScore >= 85 && trendPhase === 'uptrend-continuation') {
      recommendedMainlinePosition = 60
    } else if (overallScore >= 80) {
      recommendedMainlinePosition = 55
    } else if (overallScore >= 75) {
      recommendedMainlinePosition = 50
    }
    
    // 最大仓位
    const maxPosition = Math.max(
      recommendedLeftPosition,
      recommendedRightPosition,
      recommendedMainlinePosition
    )
    
    return {
      recommendedLeftPosition,
      recommendedRightPosition,
      recommendedMainlinePosition,
      maxPosition
    }
  }
  
  /**
   * 计算风险控制
   */
  private static calculateRiskControl(
    assessment: any,
    stockInfo: any
  ): any {
    const currentPrice = stockInfo.price
    
    // 止损价（7-10%）
    const stopLoss = currentPrice * 0.92
    
    // 目标价（20-30%）
    const targetPrice = currentPrice * 1.25
    
    // 仓位阶梯
    const positionLadder = [
      {
        price: currentPrice * 0.95,
        positionRatio: 10,
        description: '下跌5%，加仓至总仓位10%'
      },
      {
        price: currentPrice * 1.10,
        positionRatio: 20,
        description: '上涨10%，左侧确认，加仓至20%'
      },
      {
        price: currentPrice * 1.20,
        positionRatio: 35,
        description: '突破前高，右侧确认，加仓至35%'
      },
      {
        price: currentPrice * 1.35,
        positionRatio: 50,
        description: '趋势确立，升级主线，加仓至50%'
      }
    ]
    
    return {
      stopLoss,
      targetPrice,
      positionLadder
    }
  }
  
  /**
   * 生成趋势预测
   */
  private static async generatePrediction(
    stockCode: string,
    technical: any,
    fundamental: any,
    timeSeries: any[]
  ): Promise<any> {
    // 入场信号
    const entrySignal = this.generateEntrySignal(technical, fundamental)
    
    // 出场信号
    const exitSignal = this.generateExitSignal(technical, fundamental)
    
    // 关键节点
    const keyNodes = this.generateKeyNodes(timeSeries)
    
    // 趋势预测
    const trendForecast = this.forecastTrend(technical, timeSeries)
    
    return {
      entrySignal,
      exitSignal,
      keyNodes,
      trendForecast
    }
  }
  
  /**
   * 生成入场信号
   */
  private static generateEntrySignal(technical: any, fundamental: any): string {
    if (technical.trend === 'up' && fundamental.quality.score >= 70) {
      return '技术面突破+基本面优秀，建议建仓'
    } else if (fundamental.quality.score >= 80 && technical.trend === 'sideways') {
      return '基本面优秀+技术面筑底，适合左侧布局'
    } else if (technical.trend === 'up') {
      return '技术面转强，建议关注'
    }
    return '等待更好时机'
  }
  
  /**
   * 生成出场信号
   */
  private static generateExitSignal(technical: any, fundamental: any): string {
    if (technical.trend === 'down' && fundamental.quality.score < 50) {
      return '技术面破位+基本面恶化，建议清仓'
    } else if (fundamental.quality.score < 40) {
      return '基本面恶化，建议减仓或清仓'
    } else if (technical.trend === 'down' && technical.strength < 30) {
      return '技术面转弱，建议减仓'
    }
    return '暂无退出信号'
  }
  
  /**
   * 生成关键节点
   */
  private static generateKeyNodes(timeSeries: any[]): Array<{
    date: string
    event: string
    impact: 'high' | 'medium' | 'low'
    action: string
  }> {
    const nodes = []
    const currentDate = new Date()
    
    // 模拟关键节点
    const nextWeek = new Date(currentDate.getTime() + 7 * 24 * 60 * 60 * 1000)
    nodes.push({
      date: nextWeek.toISOString().split('T')[0],
      event: '技术面关键位测试',
      impact: 'high',
      action: '关注突破方向'
    })
    
    const nextMonth = new Date(currentDate.getTime() + 30 * 24 * 60 * 60 * 1000)
    nodes.push({
      date: nextMonth.toISOString().split('T')[0],
      event: '基本面数据更新',
      impact: 'medium',
      action: '关注财务数据变化'
    })
    
    return nodes
  }
  
  /**
   * 预测趋势
   */
  private static forecastTrend(technical: any, timeSeries: any[]): any {
    // 简化趋势预测
    let direction: 'up' | 'down' | 'sideways' = 'sideways'
    let probability = 50
    let timeframe = '1-3个月'
    
    if (technical.trend === 'up' && technical.strength > 70) {
      direction = 'up'
      probability = 75
    } else if (technical.trend === 'down' && technical.strength > 70) {
      direction = 'down'
      probability = 70
    }
    
    return { direction, probability, timeframe }
  }
  
  /**
   * 批量生成推荐
   * 获取股票池推荐
   */
  static async generateBatchRecommendations(
    stockCodes: string[],
    userId: string
  ): Promise<PositionRecommendation[]> {
    const recommendations = []
    
    for (const code of stockCodes) {
      try {
        const recommendation = await this.generateRecommendation(code, userId)
        recommendations.push(recommendation)
      } catch (error) {
        logger.error(`生成 ${code} 推荐失败:`, error)
      }
    }
    
    // 按置信度排序
    return recommendations.sort((a, b) => b.recommendation.confidence - a.recommendation.confidence)
  }
  
  /**
   * 获取推荐股票池
   * 基于全市场扫描
   */
  static async getRecommendedStockPool(userId: string): Promise<string[]> {
    // 这里应该实现全市场扫描逻辑
    // 暂时返回示例股票
    return ['000001', '000002', '600000', '600036', '600519']
  }
}

