// 免费数据源配置
export const FREE_DATA_SOURCES = {
  // 实时行情 - 新浪财经API (免费)
  SINA_QUOTES: {
    baseUrl: 'http://hq.sinajs.cn',
    realtimeUrl: 'http://hq.sinajs.cn/list=',
    description: '新浪财经实时行情API',
    cost: '免费',
    rateLimit: '无限制',
    updateFrequency: '实时'
  },

  // 基本面数据 - 东方财富API (免费)
  EASTMONEY_FUNDAMENTAL: {
    baseUrl: 'http://push2.eastmoney.com',
    financialUrl: 'http://push2.eastmoney.com/api/qt/stock/get',
    description: '东方财富基本面数据API',
    cost: '免费',
    rateLimit: '每分钟100次',
    updateFrequency: '日更新'
  },

  // 新闻资讯 - 自建爬虫 (免费)
  NEWS_CRAWLER: {
    sources: [
      'http://finance.sina.com.cn',
      'http://finance.eastmoney.com',
      'http://www.cs.com.cn'
    ],
    description: '自建新闻爬虫',
    cost: '免费',
    rateLimit: '无限制',
    updateFrequency: '每小时'
  },

  // 政策数据 - 政府公开API (免费)
  GOVERNMENT_API: {
    baseUrl: 'http://www.gov.cn',
    policyUrl: 'http://www.gov.cn/zhengce',
    description: '政府政策公开数据',
    cost: '免费',
    rateLimit: '无限制',
    updateFrequency: '实时'
  },

  // 技术指标计算 - 自建算法 (免费)
  TECHNICAL_INDICATORS: {
    description: '自建技术指标计算',
    cost: '免费',
    algorithms: [
      'MA', 'MACD', 'RSI', 'KDJ', 'BOLL',
      'OBV', 'CCI', 'WR', 'DMI'
    ]
  }
}

// 数据获取工具类
export class FreeDataProvider {
  // 获取实时行情
  static async getRealtimeQuotes(stockCodes: string[]): Promise<any[]> {
    try {
      const codes = stockCodes.join(',')
      const url = `${FREE_DATA_SOURCES.SINA_QUOTES.realtimeUrl}${codes}`
      
      const response = await fetch(url)
      const data = await response.text()
      
      // 解析新浪财经数据格式
      return this.parseSinaData(data)
    } catch (error) {
      console.error('获取实时行情失败:', error)
      return []
    }
  }

  // 获取基本面数据
  static async getFundamentalData(stockCode: string): Promise<any> {
    try {
      const url = `${FREE_DATA_SOURCES.EASTMONEY_FUNDAMENTAL.financialUrl}?secid=${stockCode}`
      
      const response = await fetch(url)
      const data = await response.json()
      
      return this.parseEastmoneyData(data)
    } catch (error) {
      console.error('获取基本面数据失败:', error)
      return null
    }
  }

  // 获取新闻资讯
  static async getNewsData(): Promise<any[]> {
    try {
      const news = []
      
      // 爬取多个新闻源
      for (const source of FREE_DATA_SOURCES.NEWS_CRAWLER.sources) {
        const articles = await this.crawlNews(source)
        news.push(...articles)
      }
      
      return news
    } catch (error) {
      console.error('获取新闻数据失败:', error)
      return []
    }
  }

  // 获取政策数据
  static async getPolicyData(): Promise<any[]> {
    try {
      const url = FREE_DATA_SOURCES.GOVERNMENT_API.policyUrl
      const response = await fetch(url)
      const html = await response.text()
      
      return this.parsePolicyData(html)
    } catch (error) {
      console.error('获取政策数据失败:', error)
      return []
    }
  }

  // 解析新浪财经数据
  private static parseSinaData(data: string): any[] {
    const quotes = []
    const lines = data.split('\n')
    
    for (const line of lines) {
      if (line.includes('var hq_str_')) {
        const match = line.match(/var hq_str_(\w+)="([^"]+)"/)
        if (match) {
          const [, code, quoteData] = match
          const fields = quoteData.split(',')
          
          if (fields.length >= 32) {
            quotes.push({
              code: code,
              name: fields[0],
              open: parseFloat(fields[1]),
              close: parseFloat(fields[3]),
              high: parseFloat(fields[4]),
              low: parseFloat(fields[5]),
              volume: parseInt(fields[8]),
              amount: parseFloat(fields[9]),
              change: parseFloat(fields[4]) - parseFloat(fields[2]),
              changeRate: ((parseFloat(fields[4]) - parseFloat(fields[2])) / parseFloat(fields[2]) * 100).toFixed(2)
            })
          }
        }
      }
    }
    
    return quotes
  }

  // 解析东方财富数据
  private static parseEastmoneyData(data: any): any {
    if (data.data) {
      const stock = data.data
      return {
        code: stock.f12,
        name: stock.f14,
        pe: stock.f9,
        pb: stock.f23,
        marketCap: stock.f116,
        totalShares: stock.f117,
        circulatingShares: stock.f118
      }
    }
    return null
  }

  // 爬取新闻
  private static async crawlNews(source: string): Promise<any[]> {
    // 简化的新闻爬取逻辑
    return [
      {
        title: '重要政策发布',
        content: '相关政策内容',
        source: source,
        publishTime: new Date().toISOString(),
        impact: 'positive'
      }
    ]
  }

  // 解析政策数据
  private static parsePolicyData(html: string): any[] {
    // 简化的政策数据解析
    return [
      {
        title: '央行货币政策',
        content: '货币政策相关内容',
        publishTime: new Date().toISOString(),
        impact: 'positive',
        sectors: ['银行', '地产']
      }
    ]
  }
}
