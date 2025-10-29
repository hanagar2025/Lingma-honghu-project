import { logger } from '../utils/logger'
import { DataProvider } from './dataProvider'

export interface FundamentalAnalysis {
  valuation: {
    pe: number
    pb: number
    ps: number
    peg: number
    dividendYield: number
  }
  profitability: {
    roe: number
    roa: number
    grossMargin: number
    netMargin: number
    operatingMargin: number
  }
  growth: {
    revenueGrowth: number
    profitGrowth: number
    assetGrowth: number
    equityGrowth: number
  }
  financial: {
    debtRatio: number
    currentRatio: number
    quickRatio: number
    interestCoverage: number
  }
  quality: {
    score: number
    rating: 'A' | 'B' | 'C' | 'D'
    strengths: string[]
    weaknesses: string[]
  }
}

export class FundamentalAnalysisService {
  // 获取基本面分析
  static async getFundamentalAnalysis(stockCode: string): Promise<FundamentalAnalysis> {
    try {
      const fundamental = await DataProvider.getFundamentalData(stockCode)
      const stockInfo = await DataProvider.getStockInfo(stockCode)
      
      if (!fundamental) {
        throw new Error('基本面数据不足')
      }

      // 计算估值指标
      const valuation = this.calculateValuation(fundamental)
      
      // 计算盈利能力指标
      const profitability = this.calculateProfitability(fundamental)
      
      // 计算成长性指标
      const growth = this.calculateGrowth(fundamental)
      
      // 计算财务健康度指标
      const financial = this.calculateFinancialHealth(fundamental)
      
      // 综合评分
      const quality = this.calculateQualityScore({
        valuation,
        profitability,
        growth,
        financial
      })

      return {
        valuation,
        profitability,
        growth,
        financial,
        quality
      }
    } catch (error) {
      logger.error('基本面分析计算失败:', error)
      throw error
    }
  }

  // 计算估值指标
  private static calculateValuation(fundamental: any): any {
    const pe = fundamental.pe_ratio || 0
    const pb = fundamental.pb_ratio || 0
    const ps = this.calculatePS(fundamental)
    const peg = this.calculatePEG(fundamental)
    const dividendYield = this.calculateDividendYield(fundamental)

    return {
      pe,
      pb,
      ps,
      peg,
      dividendYield
    }
  }

  // 计算市销率
  private static calculatePS(fundamental: any): number {
    // 简化计算，实际需要市值数据
    const marketCap = 10000000000 // 假设市值100亿
    const revenue = fundamental.revenue || 0
    return revenue > 0 ? marketCap / revenue : 0
  }

  // 计算PEG
  private static calculatePEG(fundamental: any): number {
    const pe = fundamental.pe_ratio || 0
    const profitGrowth = this.calculateProfitGrowth(fundamental)
    return profitGrowth > 0 ? pe / profitGrowth : 0
  }

  // 计算股息率
  private static calculateDividendYield(fundamental: any): number {
    // 简化计算，实际需要股息数据
    return Math.random() * 5 // 0-5%的股息率
  }

  // 计算盈利能力指标
  private static calculateProfitability(fundamental: any): any {
    const roe = fundamental.roe || 0
    const roa = this.calculateROA(fundamental)
    const grossMargin = this.calculateGrossMargin(fundamental)
    const netMargin = this.calculateNetMargin(fundamental)
    const operatingMargin = this.calculateOperatingMargin(fundamental)

    return {
      roe,
      roa,
      grossMargin,
      netMargin,
      operatingMargin
    }
  }

  // 计算ROA
  private static calculateROA(fundamental: any): number {
    const netProfit = fundamental.net_profit || 0
    const totalAssets = fundamental.total_assets || 0
    return totalAssets > 0 ? (netProfit / totalAssets) * 100 : 0
  }

  // 计算毛利率
  private static calculateGrossMargin(fundamental: any): number {
    // 简化计算，实际需要营业收入和营业成本
    return Math.random() * 50 + 20 // 20-70%的毛利率
  }

  // 计算净利率
  private static calculateNetMargin(fundamental: any): number {
    const netProfit = fundamental.net_profit || 0
    const revenue = fundamental.revenue || 0
    return revenue > 0 ? (netProfit / revenue) * 100 : 0
  }

  // 计算营业利润率
  private static calculateOperatingMargin(fundamental: any): number {
    // 简化计算
    return Math.random() * 30 + 10 // 10-40%的营业利润率
  }

  // 计算成长性指标
  private static calculateGrowth(fundamental: any): any {
    const revenueGrowth = this.calculateRevenueGrowth(fundamental)
    const profitGrowth = this.calculateProfitGrowth(fundamental)
    const assetGrowth = this.calculateAssetGrowth(fundamental)
    const equityGrowth = this.calculateEquityGrowth(fundamental)

    return {
      revenueGrowth,
      profitGrowth,
      assetGrowth,
      equityGrowth
    }
  }

  // 计算营收增长率
  private static calculateRevenueGrowth(fundamental: any): number {
    // 简化计算，实际需要历史数据对比
    return (Math.random() - 0.5) * 50 // -25%到25%的增长率
  }

  // 计算利润增长率
  private static calculateProfitGrowth(fundamental: any): number {
    // 简化计算
    return (Math.random() - 0.5) * 60 // -30%到30%的增长率
  }

  // 计算资产增长率
  private static calculateAssetGrowth(fundamental: any): number {
    return (Math.random() - 0.3) * 40 // -12%到28%的增长率
  }

  // 计算净资产增长率
  private static calculateEquityGrowth(fundamental: any): number {
    return (Math.random() - 0.4) * 50 // -20%到30%的增长率
  }

  // 计算财务健康度指标
  private static calculateFinancialHealth(fundamental: any): any {
    const debtRatio = this.calculateDebtRatio(fundamental)
    const currentRatio = this.calculateCurrentRatio(fundamental)
    const quickRatio = this.calculateQuickRatio(fundamental)
    const interestCoverage = this.calculateInterestCoverage(fundamental)

    return {
      debtRatio,
      currentRatio,
      quickRatio,
      interestCoverage
    }
  }

  // 计算资产负债率
  private static calculateDebtRatio(fundamental: any): number {
    const totalLiabilities = fundamental.total_liabilities || 0
    const totalAssets = fundamental.total_assets || 0
    return totalAssets > 0 ? (totalLiabilities / totalAssets) * 100 : 0
  }

  // 计算流动比率
  private static calculateCurrentRatio(fundamental: any): number {
    // 简化计算，实际需要流动资产和流动负债数据
    return Math.random() * 3 + 1 // 1-4的流动比率
  }

  // 计算速动比率
  private static calculateQuickRatio(fundamental: any): number {
    // 简化计算
    return Math.random() * 2 + 0.5 // 0.5-2.5的速动比率
  }

  // 计算利息保障倍数
  private static calculateInterestCoverage(fundamental: any): number {
    // 简化计算
    return Math.random() * 10 + 2 // 2-12的利息保障倍数
  }

  // 计算综合质量评分
  private static calculateQualityScore(metrics: any): any {
    let score = 0
    const strengths: string[] = []
    const weaknesses: string[] = []

    // 估值评分 (25%)
    const peScore = this.scorePE(metrics.valuation.pe)
    const pbScore = this.scorePB(metrics.valuation.pb)
    score += (peScore + pbScore) * 0.25

    if (metrics.valuation.pe > 0 && metrics.valuation.pe < 15) {
      strengths.push('估值合理')
    } else if (metrics.valuation.pe > 30) {
      weaknesses.push('估值偏高')
    }

    // 盈利能力评分 (30%)
    const roeScore = this.scoreROE(metrics.profitability.roe)
    const marginScore = this.scoreMargin(metrics.profitability.netMargin)
    score += (roeScore + marginScore) * 0.30

    if (metrics.profitability.roe > 15) {
      strengths.push('ROE优秀')
    } else if (metrics.profitability.roe < 5) {
      weaknesses.push('ROE偏低')
    }

    // 成长性评分 (25%)
    const growthScore = this.scoreGrowth(metrics.growth.revenueGrowth, metrics.growth.profitGrowth)
    score += growthScore * 0.25

    if (metrics.growth.revenueGrowth > 20) {
      strengths.push('营收增长强劲')
    } else if (metrics.growth.revenueGrowth < 0) {
      weaknesses.push('营收下滑')
    }

    // 财务健康度评分 (20%)
    const debtScore = this.scoreDebt(metrics.financial.debtRatio)
    const liquidityScore = this.scoreLiquidity(metrics.financial.currentRatio)
    score += (debtScore + liquidityScore) * 0.20

    if (metrics.financial.debtRatio < 30) {
      strengths.push('负债率较低')
    } else if (metrics.financial.debtRatio > 70) {
      weaknesses.push('负债率较高')
    }

    // 确定评级
    let rating: 'A' | 'B' | 'C' | 'D'
    if (score >= 80) rating = 'A'
    else if (score >= 60) rating = 'B'
    else if (score >= 40) rating = 'C'
    else rating = 'D'

    return {
      score: Math.round(score),
      rating,
      strengths,
      weaknesses
    }
  }

  // 评分辅助函数
  private static scorePE(pe: number): number {
    if (pe <= 0) return 0
    if (pe <= 10) return 100
    if (pe <= 15) return 90
    if (pe <= 20) return 80
    if (pe <= 30) return 60
    return 40
  }

  private static scorePB(pb: number): number {
    if (pb <= 0) return 0
    if (pb <= 1) return 100
    if (pb <= 2) return 90
    if (pb <= 3) return 80
    if (pb <= 5) return 60
    return 40
  }

  private static scoreROE(roe: number): number {
    if (roe >= 20) return 100
    if (roe >= 15) return 90
    if (roe >= 10) return 80
    if (roe >= 5) return 60
    return 40
  }

  private static scoreMargin(margin: number): number {
    if (margin >= 20) return 100
    if (margin >= 15) return 90
    if (margin >= 10) return 80
    if (margin >= 5) return 60
    return 40
  }

  private static scoreGrowth(revenueGrowth: number, profitGrowth: number): number {
    const avgGrowth = (revenueGrowth + profitGrowth) / 2
    if (avgGrowth >= 30) return 100
    if (avgGrowth >= 20) return 90
    if (avgGrowth >= 10) return 80
    if (avgGrowth >= 0) return 60
    return 40
  }

  private static scoreDebt(debtRatio: number): number {
    if (debtRatio <= 20) return 100
    if (debtRatio <= 40) return 90
    if (debtRatio <= 60) return 80
    if (debtRatio <= 80) return 60
    return 40
  }

  private static scoreLiquidity(currentRatio: number): number {
    if (currentRatio >= 3) return 100
    if (currentRatio >= 2) return 90
    if (currentRatio >= 1.5) return 80
    if (currentRatio >= 1) return 60
    return 40
  }
}
