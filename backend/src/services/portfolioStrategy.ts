import { logger } from '../utils/logger'
import { SmartPositionRecommendationService } from './smartPositionRecommendation'
import { FundamentalAnalysisService } from './fundamentalAnalysis'
import { SectorAnalysisService } from './sectorAnalysis'

/**
 * 组合策略联动系统
 * 基于数据、政策、趋势建立组合联动机制
 */

export interface StrategyTheme {
  id: string
  name: string
  type: 'offensive' | 'defensive' | 'tech' | 'policy' | 'trend'
  description: string
  keyFactors: string[]  // 关键驱动因素
  riskLevel: 'low' | 'medium' | 'high'
  recommendedProportion: number  // 组合中占比
}

export interface PortfolioStrategy {
  strategyId: string
  strategyName: string
  theme: StrategyTheme
  positions: {
    leftPositions: Array<{
      stockCode: string
      stockName: string
      proportion: number  // 在左仓中的占比
      reason: string
      entryPoint: string
    }>
    rightPositions: Array<{
      stockCode: string
      stockName: string
      proportion: number  // 在右仓中的占比
      reason: string
      entryPoint: string
    }>
    mainlinePositions: Array<{
      stockCode: string
      stockName: string
      proportion: number  // 在主线中的占比
      reason: string
      entryPoint: string
    }>
  }
  portfolioAllocation: {
    leftTotal: number  // 左仓总占比
    rightTotal: number  // 右仓总占比
    mainlineTotal: number  // 主线总占比
  }
  riskManagement: {
    maxLoss: number  // 最大回撤
    diversification: number  // 分散度评分
    correlation: number  // 相关性
    hedging: string[]  // 对冲建议
  }
  timeliness: {
    currentPhase: 'early' | 'middle' | 'late' | 'decline'
    expectedDuration: string
    keyEvents: Array<{
      date: string
      event: string
      impact: 'high' | 'medium' | 'low'
    }>
  }
  dataSupport: {
    policySupport: string[]  // 政策支持点
    trendSupport: string[]  // 趋势支持点
    dataSupport: string[]  // 数据支持点
    score: number  // 综合支持度
  }
}

export interface PortfolioComposition {
  compositionId: string
  userId: string
  totalStrategies: StrategyTheme[]
  currentAllocation: {
    offensive: number
    defensive: number
    tech: number
    policy: number
    trend: number
  }
  strategies: PortfolioStrategy[]
  overallRiskControl: {
    totalRisk: 'low' | 'medium' | 'high'
    maxDrawdown: number
    recommendedAdjustments: string[]
  }
  lastUpdated: string
}

export class PortfolioStrategyService {
  // 预定义策略主题
  private static strategyThemes: StrategyTheme[] = [
    {
      id: 'tech-ai',
      name: '人工智能主线',
      type: 'tech',
      description: 'AI技术突破和应用落地带来的投资机会',
      keyFactors: ['AI政策支持', '技术突破', '应用落地', '产业链成熟'],
      riskLevel: 'high',
      recommendedProportion: 25
    },
    {
      id: 'semiconductor',
      name: '半导体自主替代',
      type: 'tech',
      description: '半导体产业链自主可控和国产替代',
      keyFactors: ['国产替代', '政策扶持', '技术突破', '市场需求'],
      riskLevel: 'high',
      recommendedProportion: 20
    },
    {
      id: 'robotics',
      name: '机器人主线',
      type: 'tech',
      description: '工业机器人和服务机器人发展',
      keyFactors: ['人口红利消失', '产业升级', '技术成熟', '成本下降'],
      riskLevel: 'medium',
      recommendedProportion: 15
    },
    {
      id: 'new-energy',
      name: '新能源主线',
      type: 'policy',
      description: '双碳政策下的新能源发展',
      keyFactors: ['政策支持', '技术进步', '成本下降', '需求增长'],
      riskLevel: 'medium',
      recommendedProportion: 20
    },
    {
      id: 'consumption-defensive',
      name: '消费防御',
      type: 'defensive',
      description: '必需消费品和低估值消费股',
      keyFactors: ['消费升级', '品牌价值', '现金流', '稳定分红'],
      riskLevel: 'low',
      recommendedProportion: 10
    },
    {
      id: 'pharmaceutical',
      name: '医药主线',
      type: 'defensive',
      description: '创新药和医疗器械',
      keyFactors: ['老龄化', '医疗支出', '创新突破', '政策支持'],
      riskLevel: 'medium',
      recommendedProportion: 10
    }
  ]

  /**
   * 生成组合策略推荐
   */
  static async generatePortfolioStrategy(
    userId: string,
    selectedThemeIds?: string[]
  ): Promise<PortfolioComposition> {
    try {
      logger.info(`为用户 ${userId} 生成组合策略`)

      // 选择策略主题
      const themes = selectedThemeIds
        ? this.strategyThemes.filter(t => selectedThemeIds.includes(t.id))
        : this.strategyThemes

      // 为每个主题生成股票组合
      const strategies: PortfolioStrategy[] = []
      
      for (const theme of themes) {
        const strategy = await this.generateStrategyForTheme(theme, userId)
        strategies.push(strategy)
      }

      // 计算整体配置
      const totalAllocation = this.calculateTotalAllocation(strategies)
      
      // 风险评估和调整建议
      const riskControl = await this.calculateRiskControl(strategies)

      return {
        compositionId: `composition_${Date.now()}`,
        userId,
        totalStrategies: themes,
        currentAllocation: totalAllocation,
        strategies,
        overallRiskControl: riskControl,
        lastUpdated: new Date().toISOString()
      }
    } catch (error) {
      logger.error('生成组合策略失败:', error)
      throw error
    }
  }

  /**
   * 为主题生成策略
   */
  private static async generateStrategyForTheme(
    theme: StrategyTheme,
    userId: string
  ): Promise<PortfolioStrategy> {
    
    // 根据主题获取推荐的股票池
    const stockPool = await this.getStockPoolForTheme(theme)
    
    // 为每只股票生成推荐
    const recommendations = await this.generateRecommendationsForPool(stockPool, userId)
    
    // 分类到左仓、右仓、主线
    const leftPositions = recommendations
      .filter(r => r.recommendedPosition === 'left')
      .map((r, idx, arr) => ({
        stockCode: r.stockCode,
        stockName: r.stockName,
        proportion: (1 / arr.length) * 100,
        reason: r.recommendation.reasoning.join('；'),
        entryPoint: r.timeNodes.buildLeft[0]?.condition || '当前价位'
      }))
    
    const rightPositions = recommendations
      .filter(r => r.recommendedPosition === 'right')
      .map((r, idx, arr) => ({
        stockCode: r.stockCode,
        stockName: r.stockName,
        proportion: (1 / arr.length) * 100,
        reason: r.recommendation.reasoning.join('；'),
        entryPoint: r.timeNodes.upgradeToRight[0]?.condition || '突破确认'
      }))
    
    const mainlinePositions = recommendations
      .filter(r => r.recommendedPosition === 'mainline')
      .map((r, idx, arr) => ({
        stockCode: r.stockCode,
        stockName: r.stockName,
        proportion: (1 / arr.length) * 100,
        reason: r.recommendation.reasoning.join('；'),
        entryPoint: r.timeNodes.upgradeToMainline[0]?.condition || '趋势延续'
      }))
    
    // 计算仓位分配
    const portfolioAllocation = this.calculatePortfolioAllocation(
      leftPositions.length,
      rightPositions.length,
      mainlinePositions.length
    )
    
    // 生成数据支持
    const dataSupport = await this.generateDataSupport(theme)
    
    // 生成时效性分析
    const timeliness = await this.analyzeTimeliness(theme)
    
    // 风险控制
    const riskManagement = await this.calculateRiskForStrategy(
      recommendations,
      theme
    )

    return {
      strategyId: `strategy_${theme.id}_${Date.now()}`,
      strategyName: theme.name,
      theme,
      positions: {
        leftPositions: leftPositions.slice(0, 5), // 取前5只
        rightPositions: rightPositions.slice(0, 5),
        mainlinePositions: mainlinePositions.slice(0, 3)
      },
      portfolioAllocation,
      riskManagement,
      timeliness,
      dataSupport
    }
  }

  /**
   * 获取主题股票池
   */
  private static async getStockPoolForTheme(theme: StrategyTheme): Promise<string[]> {
    // 根据主题返回相关股票代码
    // 这里简化处理，实际应该连接数据库或API获取
    const stockMap: Record<string, string[]> = {
      'tech-ai': ['000001', '000002', '600000', '600036', '000858'],
      'semiconductor': ['600519', '600036', '000858', '002142', '300015'],
      'robotics': ['000858', '002142', '300015', '000001', '000002'],
      'new-energy': ['600519', '600000', '000858', '002142', '300015'],
      'consumption-defensive': ['600519', '000858', '600036', '000001', '000002'],
      'pharmaceutical': ['002142', '300015', '600519', '000001', '600036']
    }
    
    return stockMap[theme.id] || ['000001', '000002', '600000', '600036', '600519']
  }

  /**
   * 为股票池生成推荐
   */
  private static async generateRecommendationsForPool(
    stockPool: string[],
    userId: string
  ) {
    const recommendations = []
    for (const code of stockPool) {
      try {
        const rec = await SmartPositionRecommendationService.generateRecommendation(code, userId)
        recommendations.push(rec)
      } catch (error) {
        logger.error(`生成 ${code} 推荐失败:`, error)
      }
    }
    return recommendations
  }

  /**
   * 计算仓位分配
   */
  private static calculatePortfolioAllocation(
    leftCount: number,
    rightCount: number,
    mainlineCount: number
  ) {
    const total = leftCount + rightCount + mainlineCount
    
    if (total === 0) {
      return { leftTotal: 0, rightTotal: 0, mainlineTotal: 0 }
    }
    
    // 根据风险偏好分配
    // 左仓：30-40%，右仓：40-50%，主线：20-30%
    return {
      leftTotal: 35,
      rightTotal: 45,
      mainlineTotal: 20
    }
  }

  /**
   * 生成数据支持分析
   */
  private static async generateDataSupport(theme: StrategyTheme) {
    const policySupport: string[] = []
    const trendSupport: string[] = []
    const dataSupport: string[] = []
    
    // 根据不同主题生成不同的支持点
    switch (theme.id) {
      case 'tech-ai':
        policySupport.push('国家AI战略规划支持')
        policySupport.push('新质生产力政策导向')
        trendSupport.push('全球AI技术加速突破')
        trendSupport.push('AI应用场景不断扩展')
        dataSupport.push('AI行业增速30%+')
        dataSupport.push('相关公司业绩持续增长')
        break
      
      case 'semiconductor':
        policySupport.push('半导体产业政策支持')
        policySupport.push('国产替代加速推进')
        trendSupport.push('技术能力持续提升')
        trendSupport.push('市场需求旺盛')
        dataSupport.push('国产化率不断提升')
        dataSupport.push('龙头企业业绩亮眼')
        break
      
      case 'robotics':
        policySupport.push('智能制造政策支持')
        policySupport.push('机器人产业发展规划')
        trendSupport.push('人口红利消失推动需求')
        trendSupport.push('技术成本持续下降')
        dataSupport.push('工业机器人销量增长')
        dataSupport.push('国产机器人份额提升')
        break
      
      default:
        policySupport.push('政策整体支持')
        trendSupport.push('行业发展趋势良好')
        dataSupport.push('相关数据支撑')
    }
    
    // 计算综合支持度
    const score = (policySupport.length * 0.4 + 
                   trendSupport.length * 0.35 + 
                   dataSupport.length * 0.25) / 3 * 100
    
    return {
      policySupport,
      trendSupport,
      dataSupport,
      score: Math.round(score)
    }
  }

  /**
   * 分析时效性
   */
  private static async analyzeTimeliness(theme: StrategyTheme) {
    const phases = ['early', 'middle', 'late', 'decline']
    const phase = phases[Math.floor(Math.random() * phases.length)]
    
    const durations = ['3-6个月', '6-12个月', '12-24个月']
    const duration = durations[Math.floor(Math.random() * durations.length)]
    
    const keyEvents = [
      {
        date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        event: `${theme.name}相关政策发布`,
        impact: 'high' as const
      },
      {
        date: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        event: `${theme.name}重要数据发布`,
        impact: 'medium' as const
      }
    ]
    
    return {
      currentPhase: phase,
      expectedDuration: duration,
      keyEvents
    }
  }

  /**
   * 计算策略风险
   */
  private static async calculateRiskForStrategy(
    recommendations: any[],
    theme: StrategyTheme
  ) {
    // 计算分散度
    const diversification = recommendations.length >= 3 ? 80 : recommendations.length * 25
    
    // 计算相关性（简化处理）
    const correlation = 0.6  // 中等相关性
    
    // 计算最大回撤
    const maxLoss = theme.riskLevel === 'high' ? 20 : theme.riskLevel === 'medium' ? 15 : 10
    
    // 对冲建议
    const hedging: string[] = []
    if (theme.riskLevel === 'high') {
      hedging.push('建议配置10-15%的防御性资产')
      hedging.push('考虑配置反向ETF进行对冲')
    }
    
    return {
      maxLoss,
      diversification,
      correlation,
      hedging
    }
  }

  /**
   * 计算总配置
   */
  private static calculateTotalAllocation(strategies: PortfolioStrategy[]) {
    return strategies.reduce((acc, strategy) => {
      const type = strategy.theme.type
      if (type === 'offensive') acc.offensive += strategy.theme.recommendedProportion
      else if (type === 'defensive') acc.defensive += strategy.theme.recommendedProportion
      else if (type === 'tech') acc.tech += strategy.theme.recommendedProportion
      else if (type === 'policy') acc.policy += strategy.theme.recommendedProportion
      else if (type === 'trend') acc.trend += strategy.theme.recommendedProportion
      return acc
    }, { offensive: 0, defensive: 0, tech: 0, policy: 0, trend: 0 })
  }

  /**
   * 计算整体风险控制
   */
  private static async calculateRiskControl(strategies: PortfolioStrategy[]) {
    const avgRiskLevel = strategies.reduce((sum, s) => {
      const risk = s.theme.riskLevel === 'high' ? 3 : s.theme.riskLevel === 'medium' ? 2 : 1
      return sum + risk
    }, 0) / strategies.length
    
    const totalRisk = avgRiskLevel >= 2.5 ? 'high' : avgRiskLevel >= 1.5 ? 'medium' : 'low'
    
    const maxDrawdown = strategies.reduce((max, s) => 
      Math.max(max, s.riskManagement.maxLoss), 0
    )
    
    const recommendations: string[] = []
    if (totalRisk === 'high') {
      recommendations.push('风险较高，建议降低高风险主题配置')
      recommendations.push('增加防御性主题配置至30%+')
    }
    if (maxDrawdown > 15) {
      recommendations.push('最大回撤超过15%，建议增加对冲')
    }
    
    return {
      totalRisk,
      maxDrawdown,
      recommendedAdjustments: recommendations
    }
  }

  /**
   * 获取所有策略主题
   */
  static getStrategyThemes(): StrategyTheme[] {
    return this.strategyThemes
  }

  /**
   * 根据市场环境推荐最佳组合
   */
  static async recommendOptimalPortfolio(
    userId: string,
    marketCondition: 'bull' | 'bear' | 'volatile' | 'recovery'
  ): Promise<PortfolioComposition> {
    let selectedThemes: string[] = []
    
    switch (marketCondition) {
      case 'bull':
        // 牛市：配置进攻型
        selectedThemes = ['tech-ai', 'semiconductor', 'robotics', 'new-energy']
        break
      case 'bear':
        // 熊市：配置防御型
        selectedThemes = ['consumption-defensive', 'pharmaceutical']
        break
      case 'volatile':
        // 震荡市：均衡配置
        selectedThemes = ['tech-ai', 'consumption-defensive', 'pharmaceutical']
        break
      case 'recovery':
        // 复苏期：政策主题 + 科技
        selectedThemes = ['new-energy', 'tech-ai', 'pharmaceutical']
        break
      default:
        selectedThemes = this.strategyThemes.map(t => t.id)
    }
    
    return this.generatePortfolioStrategy(userId, selectedThemes)
  }
}

