import { logger } from '../utils/logger'
import { DataProvider } from './dataProvider'

export interface SectorData {
  name: string
  code: string
  change: number
  changeRate: number
  volume: number
  turnover: number
  marketCap: number
  pe: number
  pb: number
  strength: number
  trend: 'up' | 'down' | 'sideways'
}

export interface PolicyNews {
  title: string
  content: string
  impact: 'positive' | 'negative' | 'neutral'
  sectors: string[]
  publishTime: string
  relevance: number
}

export class SectorAnalysisService {
  // 获取板块数据
  static async getSectorData(): Promise<SectorData[]> {
    try {
      const industries = await DataProvider.getIndustryData()
      
      return industries.map(industry => ({
        name: industry.name,
        code: industry.code,
        change: industry.change,
        changeRate: industry.changeRate,
        volume: Math.floor(Math.random() * 1000000000),
        turnover: Math.floor(Math.random() * 10000000000),
        marketCap: Math.floor(Math.random() * 1000000000000),
        pe: Math.random() * 50 + 10,
        pb: Math.random() * 5 + 1,
        strength: Math.random() * 100,
        trend: industry.changeRate > 2 ? 'up' : industry.changeRate < -2 ? 'down' : 'sideways'
      }))
    } catch (error) {
      logger.error('获取板块数据失败:', error)
      throw error
    }
  }

  // 获取政策新闻
  static async getPolicyNews(): Promise<PolicyNews[]> {
    try {
      const news = await DataProvider.getPolicyNews()
      
      return news.map(item => ({
        ...item,
        relevance: Math.random() * 100
      }))
    } catch (error) {
      logger.error('获取政策新闻失败:', error)
      throw error
    }
  }

  // 分析板块强度
  static analyzeSectorStrength(sectors: SectorData[]): SectorData[] {
    return sectors.sort((a, b) => b.strength - a.strength)
  }

  // 识别热点板块
  static identifyHotSectors(sectors: SectorData[]): SectorData[] {
    return sectors.filter(sector => 
      sector.changeRate > 3 || 
      sector.strength > 80 || 
      sector.trend === 'up'
    )
  }

  // 分析板块轮动
  static analyzeSectorRotation(sectors: SectorData[]): {
    rising: SectorData[]
    falling: SectorData[]
    stable: SectorData[]
  } {
    return {
      rising: sectors.filter(s => s.trend === 'up'),
      falling: sectors.filter(s => s.trend === 'down'),
      stable: sectors.filter(s => s.trend === 'sideways')
    }
  }

  // 获取板块相关性
  static getSectorCorrelation(sector1: string, sector2: string): number {
    // 简化实现，实际需要计算历史相关性
    return Math.random() * 2 - 1 // -1 到 1 之间的相关性
  }

  // 分析政策影响
  static analyzePolicyImpact(news: PolicyNews[], sectors: SectorData[]): Array<{
    sector: string
    impact: number
    reason: string
  }> {
    const impacts = []
    
    for (const sector of sectors) {
      const relevantNews = news.filter(n => 
        n.sectors.includes(sector.name) || 
        n.sectors.some(s => s.includes(sector.name))
      )
      
      if (relevantNews.length > 0) {
        const avgImpact = relevantNews.reduce((sum, n) => {
          const impact = n.impact === 'positive' ? 1 : n.impact === 'negative' ? -1 : 0
          return sum + impact * n.relevance / 100
        }, 0) / relevantNews.length
        
        impacts.push({
          sector: sector.name,
          impact: avgImpact,
          reason: relevantNews.map(n => n.title).join('; ')
        })
      }
    }
    
    return impacts.sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact))
  }
}
