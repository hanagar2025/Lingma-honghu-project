import { logger } from '../utils/logger'
import { TechnicalAnalysisService } from './technicalAnalysis'
import { FundamentalAnalysisService } from './fundamentalAnalysis'
import { DataProvider } from './dataProvider'

export interface PositionClassification {
  category: 'left' | 'right' | 'defensive' | 'observation'
  confidence: number
  reasoning: string[]
  score: {
    technical: number
    fundamental: number
    market: number
    overall: number
  }
  recommendations: {
    action: 'buy' | 'sell' | 'hold' | 'watch'
    reason: string
    targetPrice?: number
    stopLoss?: number
  }[]
}

export class PositionClassificationService {
  // 分类持仓
  static async classifyPosition(stockCode: string, currentPrice: number): Promise<PositionClassification> {
    try {
      // 获取技术分析
      const technical = await TechnicalAnalysisService.getTechnicalAnalysis(stockCode)
      
      // 获取基本面分析
      const fundamental = await FundamentalAnalysisService.getFundamentalAnalysis(stockCode)
      
      // 获取市场数据
      const marketData = await this.getMarketData(stockCode)
      
      // 计算各项得分
      const technicalScore = this.calculateTechnicalScore(technical, currentPrice)
      const fundamentalScore = this.calculateFundamentalScore(fundamental)
      const marketScore = this.calculateMarketScore(marketData)
      
      // 综合评分
      const overallScore = (technicalScore * 0.4 + fundamentalScore * 0.3 + marketScore * 0.3)
      
      // 分类决策
      const classification = this.determineCategory({
        technical,
        fundamental,
        marketData,
        scores: { technical: technicalScore, fundamental: fundamentalScore, market: marketScore, overall: overallScore }
      })
      
      return classification
    } catch (error) {
      logger.error('持仓分类失败:', error)
      throw error
    }
  }

  // 计算技术面得分
  private static calculateTechnicalScore(technical: any, currentPrice: number): number {
    let score = 0
    
    // 趋势得分 (40%)
    if (technical.trend === 'up') {
      score += 40 * (technical.strength / 100)
    } else if (technical.trend === 'down') {
      score += 40 * (1 - technical.strength / 100)
    } else {
      score += 20 // 震荡趋势中等得分
    }
    
    // 均线排列得分 (30%)
    const maScore = this.calculateMAScore(technical.indicators, currentPrice)
    score += maScore * 0.3
    
    // 技术指标得分 (30%)
    const indicatorScore = this.calculateIndicatorScore(technical.indicators)
    score += indicatorScore * 0.3
    
    return Math.min(score, 100)
  }

  // 计算均线得分
  private static calculateMAScore(indicators: any, currentPrice: number): number {
    const { ma5, ma10, ma20, ma60 } = indicators
    
    // 多头排列
    if (currentPrice > ma5 && ma5 > ma10 && ma10 > ma20 && ma20 > ma60) {
      return 100
    }
    // 空头排列
    else if (currentPrice < ma5 && ma5 < ma10 && ma10 < ma20 && ma20 < ma60) {
      return 0
    }
    // 部分多头
    else if (currentPrice > ma5 && ma5 > ma10) {
      return 70
    }
    // 部分空头
    else if (currentPrice < ma5 && ma5 < ma10) {
      return 30
    }
    // 震荡
    else {
      return 50
    }
  }

  // 计算技术指标得分
  private static calculateIndicatorScore(indicators: any): number {
    let score = 0
    
    // MACD得分
    if (indicators.macd.value > indicators.macd.signal && indicators.macd.histogram > 0) {
      score += 25
    } else if (indicators.macd.value < indicators.macd.signal && indicators.macd.histogram < 0) {
      score += 0
    } else {
      score += 12.5
    }
    
    // RSI得分
    if (indicators.rsi < 30) {
      score += 25 // 超卖，可能反弹
    } else if (indicators.rsi > 70) {
      score += 0 // 超买，可能回调
    } else if (indicators.rsi > 50) {
      score += 20 // 偏强
    } else {
      score += 10 // 偏弱
    }
    
    // KDJ得分
    if (indicators.kdj.k > indicators.kdj.d && indicators.kdj.j > indicators.kdj.k) {
      score += 25
    } else if (indicators.kdj.k < indicators.kdj.d && indicators.kdj.j < indicators.kdj.k) {
      score += 0
    } else {
      score += 12.5
    }
    
    // 布林带得分
    const bollPosition = this.getBollingerPosition(indicators.boll, indicators.currentPrice)
    score += bollPosition * 25
    
    return Math.min(score, 100)
  }

  // 获取布林带位置得分
  private static getBollingerPosition(boll: any, currentPrice: number): number {
    const { upper, middle, lower } = boll
    const range = upper - lower
    
    if (currentPrice >= upper) {
      return 0 // 触及上轨，可能回调
    } else if (currentPrice <= lower) {
      return 100 // 触及下轨，可能反弹
    } else if (currentPrice > middle) {
      return 75 // 中轨上方，偏强
    } else {
      return 25 // 中轨下方，偏弱
    }
  }

  // 计算基本面得分
  private static calculateFundamentalScore(fundamental: any): number {
    const { valuation, profitability, growth, financial, quality } = fundamental
    
    // 估值得分 (25%)
    const valuationScore = this.scoreValuation(valuation)
    
    // 盈利能力得分 (30%)
    const profitabilityScore = this.scoreProfitability(profitability)
    
    // 成长性得分 (25%)
    const growthScore = this.scoreGrowth(growth)
    
    // 财务健康度得分 (20%)
    const financialScore = this.scoreFinancial(financial)
    
    return (valuationScore * 0.25 + profitabilityScore * 0.30 + growthScore * 0.25 + financialScore * 0.20)
  }

  // 估值评分
  private static scoreValuation(valuation: any): number {
    let score = 0
    
    // PE评分
    if (valuation.pe > 0 && valuation.pe < 15) {
      score += 40
    } else if (valuation.pe <= 20) {
      score += 30
    } else if (valuation.pe <= 30) {
      score += 20
    } else {
      score += 10
    }
    
    // PB评分
    if (valuation.pb > 0 && valuation.pb < 2) {
      score += 30
    } else if (valuation.pb <= 3) {
      score += 20
    } else if (valuation.pb <= 5) {
      score += 10
    } else {
      score += 5
    }
    
    // PEG评分
    if (valuation.peg > 0 && valuation.peg < 1) {
      score += 30
    } else if (valuation.peg <= 1.5) {
      score += 20
    } else {
      score += 10
    }
    
    return Math.min(score, 100)
  }

  // 盈利能力评分
  private static scoreProfitability(profitability: any): number {
    let score = 0
    
    // ROE评分
    if (profitability.roe >= 20) {
      score += 40
    } else if (profitability.roe >= 15) {
      score += 30
    } else if (profitability.roe >= 10) {
      score += 20
    } else {
      score += 10
    }
    
    // 净利率评分
    if (profitability.netMargin >= 15) {
      score += 30
    } else if (profitability.netMargin >= 10) {
      score += 20
    } else if (profitability.netMargin >= 5) {
      score += 15
    } else {
      score += 5
    }
    
    // 毛利率评分
    if (profitability.grossMargin >= 40) {
      score += 30
    } else if (profitability.grossMargin >= 30) {
      score += 20
    } else if (profitability.grossMargin >= 20) {
      score += 15
    } else {
      score += 5
    }
    
    return Math.min(score, 100)
  }

  // 成长性评分
  private static scoreGrowth(growth: any): number {
    const avgGrowth = (growth.revenueGrowth + growth.profitGrowth) / 2
    
    if (avgGrowth >= 30) {
      return 100
    } else if (avgGrowth >= 20) {
      return 80
    } else if (avgGrowth >= 10) {
      return 60
    } else if (avgGrowth >= 0) {
      return 40
    } else {
      return 20
    }
  }

  // 财务健康度评分
  private static scoreFinancial(financial: any): number {
    let score = 0
    
    // 负债率评分
    if (financial.debtRatio <= 30) {
      score += 50
    } else if (financial.debtRatio <= 50) {
      score += 40
    } else if (financial.debtRatio <= 70) {
      score += 20
    } else {
      score += 5
    }
    
    // 流动比率评分
    if (financial.currentRatio >= 2) {
      score += 30
    } else if (financial.currentRatio >= 1.5) {
      score += 25
    } else if (financial.currentRatio >= 1) {
      score += 15
    } else {
      score += 5
    }
    
    // 利息保障倍数评分
    if (financial.interestCoverage >= 5) {
      score += 20
    } else if (financial.interestCoverage >= 3) {
      score += 15
    } else if (financial.interestCoverage >= 1) {
      score += 10
    } else {
      score += 0
    }
    
    return Math.min(score, 100)
  }

  // 计算市场面得分
  private static calculateMarketScore(marketData: any): number {
    // 简化计算，实际需要更多市场数据
    return Math.random() * 100
  }

  // 获取市场数据
  private static async getMarketData(stockCode: string): Promise<any> {
    // 简化实现，实际需要获取板块数据、资金流向等
    return {
      sectorStrength: Math.random() * 100,
      moneyFlow: (Math.random() - 0.5) * 100,
      relativeStrength: Math.random() * 100
    }
  }

  // 确定分类
  private static determineCategory(data: any): PositionClassification {
    const { technical, fundamental, scores } = data
    const { overall } = scores
    
    let category: 'left' | 'right' | 'defensive' | 'observation'
    let confidence = 0
    const reasoning: string[] = []
    const recommendations: any[] = []
    
    // 判断逻辑
    if (overall >= 80 && technical.trend === 'up' && fundamental.quality.rating === 'A') {
      // 右侧持仓：技术面强，基本面好，趋势向上
      category = 'right'
      confidence = 90
      reasoning.push('技术面强势，趋势向上')
      reasoning.push('基本面优秀，估值合理')
      reasoning.push('市场表现强劲')
      recommendations.push({
        action: 'buy',
        reason: '技术突破，基本面支撑',
        targetPrice: technical.resistance * 1.1
      })
    } else if (overall >= 60 && technical.trend === 'sideways' && fundamental.quality.rating >= 'B') {
      // 左侧持仓：基本面好但技术面一般，适合价值投资
      category = 'left'
      confidence = 75
      reasoning.push('基本面良好，估值合理')
      reasoning.push('技术面震荡，适合逢低布局')
      reasoning.push('长期投资价值凸显')
      recommendations.push({
        action: 'watch',
        reason: '等待技术面企稳信号',
        targetPrice: technical.support * 0.95
      })
    } else if (overall >= 50 && fundamental.quality.rating >= 'B' && fundamental.valuation.dividendYield > 3) {
      // 防御持仓：高股息，低估值，适合防御
      category = 'defensive'
      confidence = 70
      reasoning.push('高股息率，分红稳定')
      reasoning.push('估值偏低，安全边际高')
      reasoning.push('适合长期持有')
      recommendations.push({
        action: 'hold',
        reason: '防御性配置，稳定收益'
      })
    } else {
      // 观察持仓：各方面表现一般，需要观察
      category = 'observation'
      confidence = 60
      reasoning.push('基本面一般，需要改善')
      reasoning.push('技术面不明朗，需要观察')
      reasoning.push('等待更好的投资时机')
      recommendations.push({
        action: 'watch',
        reason: '继续观察，等待机会'
      })
    }
    
    return {
      category,
      confidence,
      reasoning,
      score: scores,
      recommendations
    }
  }
}
