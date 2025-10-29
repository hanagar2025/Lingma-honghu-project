import { logger } from '../utils/logger'
import { getConnection } from '../config/database'
import { FreeDataProvider } from '../config/dataSources'
import { TechnicalAnalysisService } from './technicalAnalysis'
import { FundamentalAnalysisService } from './fundamentalAnalysis'

export interface TimeSeriesData {
  date: string
  technical: {
    trend: string
    strength: number
    signals: any[]
  }
  fundamental: {
    score: number
    rating: string
    changes: any[]
  }
  market: {
    sentiment: string
    sectorRotation: string
    moneyFlow: number
  }
  performance: {
    return: number
    volatility: number
    maxDrawdown: number
  }
}

export interface DecisionAnalysis {
  timeHorizon: 'daily' | 'weekly' | 'monthly'
  dataPoints: TimeSeriesData[]
  trendAnalysis: {
    direction: 'improving' | 'deteriorating' | 'stable'
    momentum: number
    confidence: number
  }
  riskAssessment: {
    level: 'low' | 'medium' | 'high'
    factors: string[]
    mitigation: string[]
  }
  recommendations: {
    action: 'continue' | 'adjust' | 'rebalance' | 'replace'
    confidence: number
    reasoning: string
    timeline: string
  }
}

export class TimeSeriesAnalysisService {
  // 获取日度时间序列数据
  static async getDailyTimeSeries(stockCode: string, days: number = 30): Promise<TimeSeriesData[]> {
    try {
      const timeSeriesData: TimeSeriesData[] = []
      
      for (let i = days; i >= 0; i--) {
        const date = new Date(Date.now() - i * 24 * 60 * 60 * 1000)
        const dateStr = date.toISOString().split('T')[0]
        
        // 获取技术分析数据
        const technical = await TechnicalAnalysisService.getTechnicalAnalysis(stockCode)
        
        // 获取基本面数据
        const fundamental = await FundamentalAnalysisService.getFundamentalAnalysis(stockCode)
        
        // 获取市场数据
        const market = await this.getMarketData(dateStr)
        
        // 计算表现数据
        const performance = await this.calculatePerformance(stockCode, dateStr)
        
        timeSeriesData.push({
          date: dateStr,
          technical: {
            trend: technical.trend,
            strength: technical.strength,
            signals: technical.signals
          },
          fundamental: {
            score: fundamental.quality.score,
            rating: fundamental.quality.rating,
            changes: fundamental.quality.strengths
          },
          market: {
            sentiment: market.sentiment,
            sectorRotation: market.sectorRotation,
            moneyFlow: market.moneyFlow
          },
          performance: {
            return: performance.return,
            volatility: performance.volatility,
            maxDrawdown: performance.maxDrawdown
          }
        })
      }
      
      return timeSeriesData
    } catch (error) {
      logger.error('获取日度时间序列数据失败:', error)
      throw error
    }
  }

  // 获取周度时间序列数据
  static async getWeeklyTimeSeries(stockCode: string, weeks: number = 12): Promise<TimeSeriesData[]> {
    try {
      const weeklyData: TimeSeriesData[] = []
      
      for (let i = weeks; i >= 0; i--) {
        const weekStart = new Date(Date.now() - i * 7 * 24 * 60 * 60 * 1000)
        const weekEnd = new Date(weekStart.getTime() + 6 * 24 * 60 * 60 * 1000)
        
        // 获取周度汇总数据
        const weeklySummary = await this.getWeeklySummary(stockCode, weekStart, weekEnd)
        
        weeklyData.push(weeklySummary)
      }
      
      return weeklyData
    } catch (error) {
      logger.error('获取周度时间序列数据失败:', error)
      throw error
    }
  }

  // 获取月度时间序列数据
  static async getMonthlyTimeSeries(stockCode: string, months: number = 6): Promise<TimeSeriesData[]> {
    try {
      const monthlyData: TimeSeriesData[] = []
      
      for (let i = months; i >= 0; i--) {
        const monthStart = new Date(Date.now() - i * 30 * 24 * 60 * 60 * 1000)
        const monthEnd = new Date(monthStart.getTime() + 29 * 24 * 60 * 60 * 1000)
        
        // 获取月度汇总数据
        const monthlySummary = await this.getMonthlySummary(stockCode, monthStart, monthEnd)
        
        monthlyData.push(monthlySummary)
      }
      
      return monthlyData
    } catch (error) {
      logger.error('获取月度时间序列数据失败:', error)
      throw error
    }
  }

  // 分析时间序列趋势
  static analyzeTimeSeriesTrend(data: TimeSeriesData[]): DecisionAnalysis {
    const latest = data[data.length - 1]
    const previous = data[data.length - 2]
    
    // 趋势分析
    const trendAnalysis = this.calculateTrendAnalysis(data)
    
    // 风险评估
    const riskAssessment = this.calculateRiskAssessment(data)
    
    // 生成建议
    const recommendations = this.generateRecommendations(data, trendAnalysis, riskAssessment)
    
    return {
      timeHorizon: data.length <= 7 ? 'daily' : data.length <= 30 ? 'weekly' : 'monthly',
      dataPoints: data,
      trendAnalysis,
      riskAssessment,
      recommendations
    }
  }

  // 计算趋势分析
  private static calculateTrendAnalysis(data: TimeSeriesData[]): any {
    const technicalTrends = data.map(d => d.technical.trend)
    const fundamentalScores = data.map(d => d.fundamental.score)
    const performanceReturns = data.map(d => d.performance.return)
    
    // 技术面趋势
    const technicalImproving = technicalTrends.filter(t => t === 'up').length / technicalTrends.length
    const technicalStable = technicalTrends.filter(t => t === 'sideways').length / technicalTrends.length
    const technicalDeteriorating = technicalTrends.filter(t => t === 'down').length / technicalTrends.length
    
    // 基本面趋势
    const fundamentalTrend = this.calculateSlope(fundamentalScores)
    
    // 表现趋势
    const performanceTrend = this.calculateSlope(performanceReturns)
    
    // 综合趋势判断
    let direction: 'improving' | 'deteriorating' | 'stable'
    if (technicalImproving > 0.6 && fundamentalTrend > 0 && performanceTrend > 0) {
      direction = 'improving'
    } else if (technicalDeteriorating > 0.6 && fundamentalTrend < 0 && performanceTrend < 0) {
      direction = 'deteriorating'
    } else {
      direction = 'stable'
    }
    
    // 动量计算
    const momentum = (technicalImproving - technicalDeteriorating) * 0.4 + 
                    (fundamentalTrend > 0 ? 1 : -1) * 0.3 + 
                    (performanceTrend > 0 ? 1 : -1) * 0.3
    
    // 置信度计算
    const confidence = Math.abs(momentum) * 0.7 + 
                      (data.length >= 10 ? 0.3 : data.length / 10 * 0.3)
    
    return {
      direction,
      momentum,
      confidence: Math.min(confidence, 1)
    }
  }

  // 计算风险评估
  private static calculateRiskAssessment(data: TimeSeriesData[]): any {
    const volatilities = data.map(d => d.performance.volatility)
    const maxDrawdowns = data.map(d => d.performance.maxDrawdown)
    const riskFactors: string[] = []
    const mitigation: string[] = []
    
    // 波动率风险
    const avgVolatility = volatilities.reduce((a, b) => a + b, 0) / volatilities.length
    if (avgVolatility > 0.3) {
      riskFactors.push('高波动率风险')
      mitigation.push('考虑减仓或对冲')
    }
    
    // 回撤风险
    const maxDrawdown = Math.max(...maxDrawdowns)
    if (maxDrawdown > 0.2) {
      riskFactors.push('大幅回撤风险')
      mitigation.push('设置止损位')
    }
    
    // 基本面风险
    const latestFundamental = data[data.length - 1].fundamental
    if (latestFundamental.score < 60) {
      riskFactors.push('基本面恶化')
      mitigation.push('关注基本面变化')
    }
    
    // 技术面风险
    const latestTechnical = data[data.length - 1].technical
    if (latestTechnical.strength < 40) {
      riskFactors.push('技术面转弱')
      mitigation.push('关注技术信号')
    }
    
    // 综合风险等级
    let riskLevel: 'low' | 'medium' | 'high'
    if (riskFactors.length === 0) {
      riskLevel = 'low'
    } else if (riskFactors.length <= 2) {
      riskLevel = 'medium'
    } else {
      riskLevel = 'high'
    }
    
    return {
      level: riskLevel,
      factors: riskFactors,
      mitigation
    }
  }

  // 生成投资建议
  private static generateRecommendations(
    data: TimeSeriesData[], 
    trendAnalysis: any, 
    riskAssessment: any
  ): any {
    const latest = data[data.length - 1]
    const timeHorizon = data.length <= 7 ? 'daily' : data.length <= 30 ? 'weekly' : 'monthly'
    
    let action: 'continue' | 'adjust' | 'rebalance' | 'replace'
    let confidence = 0
    let reasoning = ''
    let timeline = ''
    
    // 基于趋势和风险的综合判断
    if (trendAnalysis.direction === 'improving' && riskAssessment.level === 'low') {
      action = 'continue'
      confidence = 0.9
      reasoning = '技术面转强，基本面改善，风险可控，建议继续持有'
      timeline = '1-3个月'
    } else if (trendAnalysis.direction === 'improving' && riskAssessment.level === 'medium') {
      action = 'adjust'
      confidence = 0.7
      reasoning = '趋势向好但存在一定风险，建议适度调整仓位'
      timeline = '2-4周'
    } else if (trendAnalysis.direction === 'deteriorating' && riskAssessment.level === 'high') {
      action = 'replace'
      confidence = 0.8
      reasoning = '趋势转弱且风险较高，建议考虑替换标的'
      timeline = '1-2周'
    } else if (trendAnalysis.direction === 'stable') {
      action = 'rebalance'
      confidence = 0.6
      reasoning = '趋势平稳，建议重新平衡仓位结构'
      timeline = '3-6周'
    } else {
      action = 'adjust'
      confidence = 0.5
      reasoning = '情况复杂，建议谨慎调整'
      timeline = '1-2周'
    }
    
    return {
      action,
      confidence,
      reasoning,
      timeline
    }
  }

  // 获取市场数据
  private static async getMarketData(date: string): Promise<any> {
    // 模拟市场数据
    return {
      sentiment: Math.random() > 0.5 ? 'positive' : 'negative',
      sectorRotation: '科技->新能源->医药',
      moneyFlow: (Math.random() - 0.5) * 1000000
    }
  }

  // 计算表现数据
  private static async calculatePerformance(stockCode: string, date: string): Promise<any> {
    // 模拟表现数据
    return {
      return: (Math.random() - 0.5) * 0.1,
      volatility: Math.random() * 0.3,
      maxDrawdown: Math.random() * 0.2
    }
  }

  // 获取周度汇总数据
  private static async getWeeklySummary(stockCode: string, weekStart: Date, weekEnd: Date): Promise<TimeSeriesData> {
    // 模拟周度汇总数据
    return {
      date: weekStart.toISOString().split('T')[0],
      technical: {
        trend: Math.random() > 0.5 ? 'up' : 'down',
        strength: Math.random() * 100,
        signals: []
      },
      fundamental: {
        score: Math.random() * 100,
        rating: 'A',
        changes: []
      },
      market: {
        sentiment: 'positive',
        sectorRotation: '科技',
        moneyFlow: Math.random() * 1000000
      },
      performance: {
        return: (Math.random() - 0.5) * 0.05,
        volatility: Math.random() * 0.2,
        maxDrawdown: Math.random() * 0.15
      }
    }
  }

  // 获取月度汇总数据
  private static async getMonthlySummary(stockCode: string, monthStart: Date, monthEnd: Date): Promise<TimeSeriesData> {
    // 模拟月度汇总数据
    return {
      date: monthStart.toISOString().split('T')[0],
      technical: {
        trend: Math.random() > 0.5 ? 'up' : 'down',
        strength: Math.random() * 100,
        signals: []
      },
      fundamental: {
        score: Math.random() * 100,
        rating: 'A',
        changes: []
      },
      market: {
        sentiment: 'positive',
        sectorRotation: '科技',
        moneyFlow: Math.random() * 1000000
      },
      performance: {
        return: (Math.random() - 0.5) * 0.1,
        volatility: Math.random() * 0.3,
        maxDrawdown: Math.random() * 0.25
      }
    }
  }

  // 计算斜率
  private static calculateSlope(values: number[]): number {
    if (values.length < 2) return 0
    
    const n = values.length
    const x = Array.from({ length: n }, (_, i) => i)
    const y = values
    
    const sumX = x.reduce((a, b) => a + b, 0)
    const sumY = y.reduce((a, b) => a + b, 0)
    const sumXY = x.reduce((sum, xi, i) => sum + xi * y[i], 0)
    const sumXX = x.reduce((sum, xi) => sum + xi * xi, 0)
    
    return (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX)
  }
}
