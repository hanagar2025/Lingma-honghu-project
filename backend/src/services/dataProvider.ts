import axios from 'axios'
import { logger } from '../utils/logger'
import { getConnection } from '../config/database'
import { redisUtils } from '../config/redis'

// 数据源配置
const DATA_SOURCES = {
  TUSHARE: {
    baseUrl: 'http://api.tushare.pro',
    token: process.env.TUSHARE_TOKEN || '',
  },
  EASTMONEY: {
    baseUrl: 'http://push2.eastmoney.com',
    apiKey: process.env.EASTMONEY_API_KEY || '',
  },
  SINA: {
    baseUrl: 'http://hq.sinajs.cn',
  }
}

export class DataProvider {
  // 获取股票基本信息
  static async getStockInfo(stockCode: string): Promise<any> {
    try {
      // 先检查缓存
      const cacheKey = `stock_info_${stockCode}`
      const cached = await redisUtils.get(cacheKey)
      if (cached) {
        return cached
      }

      // 从数据库获取
      const connection = getConnection()
      const [rows] = await connection.execute(
        'SELECT * FROM stock_info WHERE code = ?',
        [stockCode]
      )

      if (Array.isArray(rows) && rows.length > 0) {
        const stockInfo = rows[0] as any
        await redisUtils.set(cacheKey, stockInfo, 3600) // 缓存1小时
        return stockInfo
      }

      // 如果数据库没有，从API获取
      const stockInfo = await this.fetchStockInfoFromAPI(stockCode)
      if (stockInfo) {
        // 保存到数据库
        await connection.execute(
          `INSERT INTO stock_info (code, name, industry, market, list_date) 
           VALUES (?, ?, ?, ?, ?) 
           ON DUPLICATE KEY UPDATE 
           name = VALUES(name), industry = VALUES(industry), 
           market = VALUES(market), updated_at = CURRENT_TIMESTAMP`,
          [stockInfo.code, stockInfo.name, stockInfo.industry, stockInfo.market, stockInfo.listDate]
        )
        
        await redisUtils.set(cacheKey, stockInfo, 3600)
      }

      return stockInfo
    } catch (error) {
      logger.error('获取股票信息失败:', error)
      throw error
    }
  }

  // 获取实时行情
  static async getStockQuote(stockCode: string): Promise<any> {
    try {
      const cacheKey = `stock_quote_${stockCode}`
      const cached = await redisUtils.get(cacheKey)
      if (cached && Date.now() - cached.timestamp < 5000) { // 5秒内有效
        return cached
      }

      // 模拟实时行情数据
      const quote = {
        code: stockCode,
        name: `股票${stockCode}`,
        price: Math.random() * 100 + 10,
        change: (Math.random() - 0.5) * 10,
        changeRate: (Math.random() - 0.5) * 10,
        volume: Math.floor(Math.random() * 1000000),
        turnover: Math.floor(Math.random() * 100000000),
        high: Math.random() * 100 + 10,
        low: Math.random() * 100 + 10,
        open: Math.random() * 100 + 10,
        prevClose: Math.random() * 100 + 10,
        timestamp: Date.now()
      }

      await redisUtils.set(cacheKey, quote, 10) // 缓存10秒
      return quote
    } catch (error) {
      logger.error('获取实时行情失败:', error)
      throw error
    }
  }

  // 获取历史行情数据
  static async getStockHistory(stockCode: string, period: string = '1y'): Promise<any[]> {
    try {
      const cacheKey = `stock_history_${stockCode}_${period}`
      const cached = await redisUtils.get(cacheKey)
      if (cached) {
        return cached
      }

      // 从数据库获取历史数据
      const connection = getConnection()
      let days = 365
      if (period === '1m') days = 30
      else if (period === '3m') days = 90
      else if (period === '6m') days = 180
      else if (period === '1y') days = 365
      else if (period === '3y') days = 1095

      const [rows] = await connection.execute(
        `SELECT * FROM stock_daily 
         WHERE stock_code = ? 
         ORDER BY trade_date DESC 
         LIMIT ?`,
        [stockCode, parseInt(days.toString())]
      )

      if (Array.isArray(rows) && rows.length > 0) {
        const history = rows.reverse() as any[]
        await redisUtils.set(cacheKey, history, 3600) // 缓存1小时
        return history
      }

      // 如果数据库没有数据，生成模拟数据
      const history = this.generateMockHistoryData(stockCode, days)
      await redisUtils.set(cacheKey, history, 3600)
      return history
    } catch (error) {
      logger.error('获取历史数据失败:', error)
      throw error
    }
  }

  // 获取基本面数据
  static async getFundamentalData(stockCode: string): Promise<any> {
    try {
      const cacheKey = `fundamental_${stockCode}`
      const cached = await redisUtils.get(cacheKey)
      if (cached) {
        return cached
      }

      // 从数据库获取最新基本面数据
      const connection = getConnection()
      const [rows] = await connection.execute(
        `SELECT * FROM stock_fundamentals 
         WHERE stock_code = ? 
         ORDER BY report_date DESC 
         LIMIT 1`,
        [stockCode]
      )

      if (Array.isArray(rows) && rows.length > 0) {
        const fundamental = rows[0] as any
        await redisUtils.set(cacheKey, fundamental, 7200) // 缓存2小时
        return fundamental
      }

      // 生成模拟基本面数据
      const fundamental = this.generateMockFundamentalData(stockCode)
      await redisUtils.set(cacheKey, fundamental, 7200)
      return fundamental
    } catch (error) {
      logger.error('获取基本面数据失败:', error)
      throw error
    }
  }

  // 获取行业板块数据
  static async getIndustryData(): Promise<any[]> {
    try {
      const cacheKey = 'industry_data'
      const cached = await redisUtils.get(cacheKey)
      if (cached) {
        return cached
      }

      // 模拟行业数据
      const industries = [
        { name: '科技', code: 'TECH', change: (Math.random() - 0.5) * 5, changeRate: (Math.random() - 0.5) * 3 },
        { name: '金融', code: 'FIN', change: (Math.random() - 0.5) * 5, changeRate: (Math.random() - 0.5) * 3 },
        { name: '医药', code: 'MED', change: (Math.random() - 0.5) * 5, changeRate: (Math.random() - 0.5) * 3 },
        { name: '消费', code: 'CONS', change: (Math.random() - 0.5) * 5, changeRate: (Math.random() - 0.5) * 3 },
        { name: '新能源', code: 'NEW', change: (Math.random() - 0.5) * 5, changeRate: (Math.random() - 0.5) * 3 },
      ]

      await redisUtils.set(cacheKey, industries, 1800) // 缓存30分钟
      return industries
    } catch (error) {
      logger.error('获取行业数据失败:', error)
      throw error
    }
  }

  // 获取政策新闻
  static async getPolicyNews(): Promise<any[]> {
    try {
      const cacheKey = 'policy_news'
      const cached = await redisUtils.get(cacheKey)
      if (cached) {
        return cached
      }

      // 模拟政策新闻
      const news = [
        {
          title: '央行降准释放流动性',
          content: '央行宣布降准0.5个百分点，释放长期流动性约1万亿元',
          impact: 'positive',
          sectors: ['银行', '地产'],
          publishTime: new Date().toISOString()
        },
        {
          title: '新能源汽车补贴政策延续',
          content: '财政部宣布新能源汽车购置补贴政策延续至2025年',
          impact: 'positive',
          sectors: ['新能源', '汽车'],
          publishTime: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
        }
      ]

      await redisUtils.set(cacheKey, news, 3600) // 缓存1小时
      return news
    } catch (error) {
      logger.error('获取政策新闻失败:', error)
      throw error
    }
  }

  // 从API获取股票信息
  private static async fetchStockInfoFromAPI(stockCode: string): Promise<any> {
    // 这里应该调用真实的API，现在返回模拟数据
    return {
      code: stockCode,
      name: `股票${stockCode}`,
      industry: '科技',
      market: '主板',
      listDate: '2020-01-01'
    }
  }

  // 生成模拟历史数据
  private static generateMockHistoryData(stockCode: string, days: number): any[] {
    const history = []
    let basePrice = 10 + Math.random() * 20
    
    for (let i = days; i >= 0; i--) {
      const date = new Date(Date.now() - i * 24 * 60 * 60 * 1000)
      const change = (Math.random() - 0.5) * 0.1
      basePrice = basePrice * (1 + change)
      
      history.push({
        stock_code: stockCode,
        trade_date: date.toISOString().split('T')[0],
        open_price: basePrice * (0.98 + Math.random() * 0.04),
        high_price: basePrice * (1 + Math.random() * 0.05),
        low_price: basePrice * (0.95 + Math.random() * 0.05),
        close_price: basePrice,
        volume: Math.floor(Math.random() * 1000000),
        turnover: Math.floor(Math.random() * 100000000)
      })
    }
    
    return history
  }

  // 生成模拟基本面数据
  private static generateMockFundamentalData(stockCode: string): any {
    return {
      stock_code: stockCode,
      report_date: new Date().toISOString().split('T')[0],
      pe_ratio: Math.random() * 50 + 10,
      pb_ratio: Math.random() * 5 + 1,
      roe: Math.random() * 20 + 5,
      revenue: Math.random() * 10000000000 + 1000000000,
      net_profit: Math.random() * 1000000000 + 100000000,
      total_assets: Math.random() * 50000000000 + 10000000000,
      total_liabilities: Math.random() * 30000000000 + 5000000000
    }
  }
}
