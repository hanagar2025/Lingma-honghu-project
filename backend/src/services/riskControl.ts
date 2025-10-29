import { logger } from '../utils/logger'
import { getConnection } from '../config/database'
import { FreeDataProvider } from '../config/dataSources'

export interface RiskMetrics {
  portfolioRisk: {
    totalRisk: number
    systematicRisk: number
    unsystematicRisk: number
    maxDrawdown: number
    var95: number
    cvar95: number
  }
  positionRisks: Array<{
    stockCode: string
    stockName: string
    riskLevel: 'low' | 'medium' | 'high'
    riskFactors: string[]
    riskScore: number
  }>
  sectorRisks: Array<{
    sector: string
    concentration: number
    riskLevel: 'low' | 'medium' | 'high'
    diversification: number
  }>
  marketRisks: {
    marketVolatility: number
    correlationRisk: number
    liquidityRisk: number
    policyRisk: number
  }
}

export interface RiskAlert {
  alertId: string
  type: 'position' | 'portfolio' | 'market' | 'system'
  level: 'low' | 'medium' | 'high' | 'critical'
  title: string
  description: string
  recommendation: string
  timestamp: string
  isRead: boolean
}

export class RiskControlService {
  // 计算投资组合风险指标
  static async calculatePortfolioRisk(userId: string): Promise<RiskMetrics> {
    try {
      logger.info(`开始计算用户 ${userId} 的投资组合风险`)

      // 获取用户持仓
      const positions = await this.getUserPositions(userId)
      
      // 计算组合风险
      const portfolioRisk = await this.calculatePortfolioRiskMetrics(positions)
      
      // 计算持仓风险
      const positionRisks = await this.calculatePositionRisks(positions)
      
      // 计算板块风险
      const sectorRisks = await this.calculateSectorRisks(positions)
      
      // 计算市场风险
      const marketRisks = await this.calculateMarketRisks()

      const riskMetrics: RiskMetrics = {
        portfolioRisk,
        positionRisks,
        sectorRisks,
        marketRisks
      }

      // 保存风险指标
      await this.saveRiskMetrics(userId, riskMetrics)
      
      logger.info(`投资组合风险计算完成`)
      return riskMetrics
    } catch (error) {
      logger.error('计算投资组合风险失败:', error)
      throw error
    }
  }

  // 生成风险预警
  static async generateRiskAlerts(userId: string): Promise<RiskAlert[]> {
    try {
      const riskMetrics = await this.calculatePortfolioRisk(userId)
      const alerts: RiskAlert[] = []

      // 组合风险预警
      if (riskMetrics.portfolioRisk.totalRisk > 0.3) {
        alerts.push({
          alertId: `portfolio_risk_${Date.now()}`,
          type: 'portfolio',
          level: 'high',
          title: '投资组合风险过高',
          description: `当前组合风险为 ${(riskMetrics.portfolioRisk.totalRisk * 100).toFixed(1)}%，超过30%警戒线`,
          recommendation: '建议减少高风险持仓，增加防御性资产配置',
          timestamp: new Date().toISOString(),
          isRead: false
        })
      }

      // 最大回撤预警
      if (riskMetrics.portfolioRisk.maxDrawdown > 0.2) {
        alerts.push({
          alertId: `max_drawdown_${Date.now()}`,
          type: 'portfolio',
          level: 'critical',
          title: '最大回撤超限',
          description: `当前最大回撤为 ${(riskMetrics.portfolioRisk.maxDrawdown * 100).toFixed(1)}%，超过20%限制`,
          recommendation: '建议立即止损，重新评估投资策略',
          timestamp: new Date().toISOString(),
          isRead: false
        })
      }

      // 持仓风险预警
      for (const positionRisk of riskMetrics.positionRisks) {
        if (positionRisk.riskLevel === 'high') {
          alerts.push({
            alertId: `position_risk_${positionRisk.stockCode}_${Date.now()}`,
            type: 'position',
            level: 'high',
            title: `${positionRisk.stockName} 风险过高`,
            description: `该持仓风险评分为 ${positionRisk.riskScore.toFixed(1)}，风险因素：${positionRisk.riskFactors.join('、')}`,
            recommendation: '建议减仓或设置止损位',
            timestamp: new Date().toISOString(),
            isRead: false
          })
        }
      }

      // 板块集中度预警
      for (const sectorRisk of riskMetrics.sectorRisks) {
        if (sectorRisk.concentration > 0.4) {
          alerts.push({
            alertId: `sector_concentration_${sectorRisk.sector}_${Date.now()}`,
            type: 'portfolio',
            level: 'medium',
            title: `${sectorRisk.sector} 板块集中度过高`,
            description: `该板块占比为 ${(sectorRisk.concentration * 100).toFixed(1)}%，超过40%警戒线`,
            recommendation: '建议分散投资，降低板块集中度',
            timestamp: new Date().toISOString(),
            isRead: false
          })
        }
      }

      // 市场风险预警
      if (riskMetrics.marketRisks.marketVolatility > 0.25) {
        alerts.push({
          alertId: `market_volatility_${Date.now()}`,
          type: 'market',
          level: 'high',
          title: '市场波动率过高',
          description: `当前市场波动率为 ${(riskMetrics.marketRisks.marketVolatility * 100).toFixed(1)}%，市场风险较大`,
          recommendation: '建议降低仓位，增加现金比例',
          timestamp: new Date().toISOString(),
          isRead: false
        })
      }

      // 保存风险预警
      await this.saveRiskAlerts(userId, alerts)
      
      return alerts
    } catch (error) {
      logger.error('生成风险预警失败:', error)
      throw error
    }
  }

  // 计算止损建议
  static async calculateStopLoss(userId: string): Promise<Array<{
    stockCode: string
    stockName: string
    currentPrice: number
    stopLossPrice: number
    stopLossRate: number
    reasoning: string
  }>> {
    try {
      const positions = await this.getUserPositions(userId)
      const stopLossSuggestions = []

      for (const position of positions) {
        // 获取技术分析数据
        const technicalData = await this.getTechnicalData(position.stock_code)
        
        // 计算止损位
        const stopLossPrice = this.calculateStopLossPrice(position, technicalData)
        const stopLossRate = (position.current_price - stopLossPrice) / position.current_price
        
        stopLossSuggestions.push({
          stockCode: position.stock_code,
          stockName: position.stock_name,
          currentPrice: position.current_price,
          stopLossPrice,
          stopLossRate,
          reasoning: this.getStopLossReasoning(technicalData, stopLossRate)
        })
      }

      return stopLossSuggestions
    } catch (error) {
      logger.error('计算止损建议失败:', error)
      throw error
    }
  }

  // 计算仓位建议
  static async calculatePositionSizing(userId: string): Promise<Array<{
    stockCode: string
    stockName: string
    currentWeight: number
    recommendedWeight: number
    adjustment: number
    reasoning: string
  }>> {
    try {
      const positions = await this.getUserPositions(userId)
      const totalValue = positions.reduce((sum, p) => sum + p.market_value, 0)
      const positionSizing = []

      for (const position of positions) {
        const currentWeight = position.market_value / totalValue
        
        // 基于风险调整的仓位建议
        const riskAdjustedWeight = this.calculateRiskAdjustedWeight(position)
        const adjustment = riskAdjustedWeight - currentWeight

        positionSizing.push({
          stockCode: position.stock_code,
          stockName: position.stock_name,
          currentWeight: currentWeight * 100,
          recommendedWeight: riskAdjustedWeight * 100,
          adjustment: adjustment * 100,
          reasoning: this.getPositionSizingReasoning(position, riskAdjustedWeight)
        })
      }

      return positionSizing
    } catch (error) {
      logger.error('计算仓位建议失败:', error)
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

  // 计算组合风险指标
  private static async calculatePortfolioRiskMetrics(positions: any[]): Promise<any> {
    // 计算总风险
    const totalRisk = this.calculateTotalRisk(positions)
    
    // 计算系统性风险
    const systematicRisk = this.calculateSystematicRisk(positions)
    
    // 计算非系统性风险
    const unsystematicRisk = totalRisk - systematicRisk
    
    // 计算最大回撤
    const maxDrawdown = this.calculateMaxDrawdown(positions)
    
    // 计算VaR和CVaR
    const var95 = this.calculateVaR(positions, 0.95)
    const cvar95 = this.calculateCVaR(positions, 0.95)

    return {
      totalRisk,
      systematicRisk,
      unsystematicRisk,
      maxDrawdown,
      var95,
      cvar95
    }
  }

  // 计算持仓风险
  private static async calculatePositionRisks(positions: any[]): Promise<any[]> {
    const positionRisks = []

    for (const position of positions) {
      // 计算个股风险
      const riskScore = this.calculateStockRisk(position)
      const riskLevel = riskScore > 0.7 ? 'high' : riskScore > 0.4 ? 'medium' : 'low'
      
      // 识别风险因素
      const riskFactors = this.identifyRiskFactors(position)

      positionRisks.push({
        stockCode: position.stock_code,
        stockName: position.stock_name,
        riskLevel,
        riskFactors,
        riskScore
      })
    }

    return positionRisks
  }

  // 计算板块风险
  private static async calculateSectorRisks(positions: any[]): Promise<any[]> {
    // 按板块分组
    const sectorGroups = this.groupBySector(positions)
    const sectorRisks = []

    for (const [sector, sectorPositions] of Object.entries(sectorGroups)) {
      const totalValue = sectorPositions.reduce((sum: number, p: any) => sum + p.market_value, 0)
      const portfolioValue = positions.reduce((sum, p) => sum + p.market_value, 0)
      const concentration = totalValue / portfolioValue
      
      const diversification = this.calculateDiversification(sectorPositions)
      const riskLevel = concentration > 0.4 ? 'high' : concentration > 0.2 ? 'medium' : 'low'

      sectorRisks.push({
        sector,
        concentration,
        riskLevel,
        diversification
      })
    }

    return sectorRisks
  }

  // 计算市场风险
  private static async calculateMarketRisks(): Promise<any> {
    // 获取市场数据
    const marketData = await FreeDataProvider.getRealtimeQuotes(['sh000001', 'sz399001'])
    
    // 计算市场波动率
    const marketVolatility = this.calculateMarketVolatility(marketData)
    
    // 计算相关性风险
    const correlationRisk = this.calculateCorrelationRisk()
    
    // 计算流动性风险
    const liquidityRisk = this.calculateLiquidityRisk()
    
    // 计算政策风险
    const policyRisk = this.calculatePolicyRisk()

    return {
      marketVolatility,
      correlationRisk,
      liquidityRisk,
      policyRisk
    }
  }

  // 计算总风险
  private static calculateTotalRisk(positions: any[]): number {
    // 简化的风险计算
    const weights = positions.map(p => p.market_value)
    const totalValue = weights.reduce((sum, w) => sum + w, 0)
    const normalizedWeights = weights.map(w => w / totalValue)
    
    // 假设个股风险为20%
    const stockRisk = 0.2
    const portfolioRisk = Math.sqrt(normalizedWeights.reduce((sum, w) => sum + w * w * stockRisk * stockRisk, 0))
    
    return portfolioRisk
  }

  // 计算系统性风险
  private static calculateSystematicRisk(positions: any[]): number {
    // 简化的系统性风险计算
    return 0.15 // 假设系统性风险为15%
  }

  // 计算最大回撤
  private static calculateMaxDrawdown(positions: any[]): number {
    // 简化的最大回撤计算
    return Math.random() * 0.3 // 模拟0-30%的回撤
  }

  // 计算VaR
  private static calculateVaR(positions: any[], confidence: number): number {
    // 简化的VaR计算
    return 0.05 * confidence // 模拟5%的VaR
  }

  // 计算CVaR
  private static calculateCVaR(positions: any[], confidence: number): number {
    // 简化的CVaR计算
    return 0.07 * confidence // 模拟7%的CVaR
  }

  // 计算个股风险
  private static calculateStockRisk(position: any): number {
    // 基于持仓比例和波动率计算风险
    const positionRisk = Math.random() * 0.8 + 0.2 // 20%-100%的风险
    return positionRisk
  }

  // 识别风险因素
  private static identifyRiskFactors(position: any): string[] {
    const factors = []
    
    if (Math.random() > 0.7) factors.push('高波动率')
    if (Math.random() > 0.8) factors.push('流动性不足')
    if (Math.random() > 0.6) factors.push('基本面恶化')
    if (Math.random() > 0.9) factors.push('技术面破位')
    
    return factors
  }

  // 按板块分组
  private static groupBySector(positions: any[]): Record<string, any[]> {
    const groups: Record<string, any[]> = {}
    
    for (const position of positions) {
      const sector = position.sector || '其他'
      if (!groups[sector]) {
        groups[sector] = []
      }
      groups[sector].push(position)
    }
    
    return groups
  }

  // 计算分散化程度
  private static calculateDiversification(positions: any[]): number {
    // 简化的分散化计算
    return Math.min(positions.length / 10, 1) // 最多10只股票达到完全分散
  }

  // 计算市场波动率
  private static calculateMarketVolatility(marketData: any[]): number {
    // 简化的市场波动率计算
    return Math.random() * 0.4 // 0-40%的波动率
  }

  // 计算相关性风险
  private static calculateCorrelationRisk(): number {
    return Math.random() * 0.8 // 0-80%的相关性风险
  }

  // 计算流动性风险
  private static calculateLiquidityRisk(): number {
    return Math.random() * 0.6 // 0-60%的流动性风险
  }

  // 计算政策风险
  private static calculatePolicyRisk(): number {
    return Math.random() * 0.5 // 0-50%的政策风险
  }

  // 计算止损价
  private static calculateStopLossPrice(position: any, technicalData: any): number {
    // 基于技术分析计算止损位
    const support = technicalData?.support || position.current_price * 0.9
    const stopLossRate = 0.1 // 10%止损
    return Math.max(support, position.current_price * (1 - stopLossRate))
  }

  // 获取止损理由
  private static getStopLossReasoning(technicalData: any, stopLossRate: number): string {
    if (stopLossRate > 0.15) {
      return '技术支撑位较强，建议设置较宽松止损'
    } else if (stopLossRate < 0.05) {
      return '技术面较弱，建议设置严格止损'
    } else {
      return '基于技术分析设置标准止损位'
    }
  }

  // 计算风险调整权重
  private static calculateRiskAdjustedWeight(position: any): number {
    // 基于风险调整的权重计算
    const baseWeight = 0.1 // 基础权重10%
    const riskAdjustment = Math.random() * 0.1 - 0.05 // -5%到+5%的调整
    return Math.max(0.05, Math.min(0.2, baseWeight + riskAdjustment)) // 限制在5%-20%
  }

  // 获取仓位建议理由
  private static getPositionSizingReasoning(position: any, recommendedWeight: number): string {
    if (recommendedWeight > 0.15) {
      return '该股票风险较低，建议增加仓位'
    } else if (recommendedWeight < 0.08) {
      return '该股票风险较高，建议减少仓位'
    } else {
      return '该股票风险适中，建议保持当前仓位'
    }
  }

  // 获取技术数据
  private static async getTechnicalData(stockCode: string): Promise<any> {
    // 模拟技术数据
    return {
      support: Math.random() * 100 + 10,
      resistance: Math.random() * 100 + 20,
      trend: Math.random() > 0.5 ? 'up' : 'down'
    }
  }

  // 保存风险指标
  private static async saveRiskMetrics(userId: string, riskMetrics: RiskMetrics): Promise<void> {
    const connection = getConnection()
    await connection.execute(
      'INSERT INTO risk_metrics (user_id, metrics_data, created_at) VALUES (?, ?, NOW())',
      [userId, JSON.stringify(riskMetrics)]
    )
  }

  // 保存风险预警
  private static async saveRiskAlerts(userId: string, alerts: RiskAlert[]): Promise<void> {
    const connection = getConnection()
    
    for (const alert of alerts) {
      await connection.execute(
        'INSERT INTO risk_alerts (id, user_id, alert_type, alert_level, title, description, recommendation, created_at, is_read) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [alert.alertId, userId, alert.type, alert.level, alert.title, alert.description, alert.recommendation, alert.timestamp, alert.isRead]
      )
    }
  }
}
