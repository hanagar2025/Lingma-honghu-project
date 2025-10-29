import { logger } from '../utils/logger'
import { DataProvider } from './dataProvider'

export interface TechnicalIndicator {
  name: string
  value: number
  signal: 'buy' | 'sell' | 'hold'
  strength: number
}

export interface TechnicalAnalysis {
  trend: 'up' | 'down' | 'sideways'
  strength: number
  support: number
  resistance: number
  indicators: {
    ma5: number
    ma10: number
    ma20: number
    ma60: number
    ma120: number
    ma250: number
    macd: {
      value: number
      signal: number
      histogram: number
    }
    rsi: number
    kdj: {
      k: number
      d: number
      j: number
    }
    boll: {
      upper: number
      middle: number
      lower: number
    }
  }
  signals: Array<{
    type: 'buy' | 'sell' | 'hold'
    strength: 'weak' | 'medium' | 'strong'
    description: string
  }>
}

export class TechnicalAnalysisService {
  // 获取技术分析
  static async getTechnicalAnalysis(stockCode: string): Promise<TechnicalAnalysis> {
    try {
      const history = await DataProvider.getStockHistory(stockCode, '1y')
      if (!history || history.length === 0) {
        throw new Error('历史数据不足')
      }

      const prices = history.map(h => h.close_price)
      const volumes = history.map(h => h.volume)
      const currentPrice = prices[prices.length - 1]

      // 计算技术指标
      const ma5 = this.calculateMA(prices, 5)
      const ma10 = this.calculateMA(prices, 10)
      const ma20 = this.calculateMA(prices, 20)
      const ma60 = this.calculateMA(prices, 60)
      const ma120 = this.calculateMA(prices, 120)
      const ma250 = this.calculateMA(prices, 250)

      const macd = this.calculateMACD(prices)
      const rsi = this.calculateRSI(prices)
      const kdj = this.calculateKDJ(prices)
      const boll = this.calculateBollingerBands(prices)

      // 判断趋势
      const trend = this.determineTrend(prices, [ma5, ma10, ma20])
      const strength = this.calculateTrendStrength(prices, trend)

      // 计算支撑位和压力位
      const support = this.calculateSupport(prices)
      const resistance = this.calculateResistance(prices)

      // 生成交易信号
      const signals = this.generateSignals({
        currentPrice,
        ma5: ma5[ma5.length - 1],
        ma10: ma10[ma10.length - 1],
        ma20: ma20[ma20.length - 1],
        macd: macd[macd.length - 1],
        rsi: rsi[rsi.length - 1],
        kdj: kdj[kdj.length - 1],
        boll: boll[boll.length - 1]
      })

      return {
        trend,
        strength,
        support,
        resistance,
        indicators: {
          ma5: ma5[ma5.length - 1],
          ma10: ma10[ma10.length - 1],
          ma20: ma20[ma20.length - 1],
          ma60: ma60[ma60.length - 1],
          ma120: ma120[ma120.length - 1],
          ma250: ma250[ma250.length - 1],
          macd: macd[macd.length - 1],
          rsi: rsi[rsi.length - 1],
          kdj: kdj[kdj.length - 1],
          boll: boll[boll.length - 1]
        },
        signals
      }
    } catch (error) {
      logger.error('技术分析计算失败:', error)
      throw error
    }
  }

  // 计算移动平均线
  private static calculateMA(prices: number[], period: number): number[] {
    const ma = []
    for (let i = period - 1; i < prices.length; i++) {
      const sum = prices.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0)
      ma.push(sum / period)
    }
    return ma
  }

  // 计算MACD
  private static calculateMACD(prices: number[]): Array<{value: number, signal: number, histogram: number}> {
    const ema12 = this.calculateEMA(prices, 12)
    const ema26 = this.calculateEMA(prices, 26)
    
    const macd = []
    for (let i = 0; i < ema12.length; i++) {
      const macdValue = ema12[i] - ema26[i]
      macd.push({ value: macdValue, signal: 0, histogram: 0 })
    }

    // 计算信号线（9日EMA）
    const signalLine = this.calculateEMA(macd.map(m => m.value), 9)
    
    for (let i = 0; i < macd.length; i++) {
      if (i < signalLine.length) {
        macd[i].signal = signalLine[i]
        macd[i].histogram = macd[i].value - signalLine[i]
      }
    }

    return macd
  }

  // 计算EMA
  private static calculateEMA(prices: number[], period: number): number[] {
    const ema = []
    const multiplier = 2 / (period + 1)
    
    ema[0] = prices[0]
    for (let i = 1; i < prices.length; i++) {
      ema[i] = (prices[i] * multiplier) + (ema[i - 1] * (1 - multiplier))
    }
    
    return ema
  }

  // 计算RSI
  private static calculateRSI(prices: number[], period: number = 14): number[] {
    const rsi = []
    const gains = []
    const losses = []

    for (let i = 1; i < prices.length; i++) {
      const change = prices[i] - prices[i - 1]
      gains.push(change > 0 ? change : 0)
      losses.push(change < 0 ? Math.abs(change) : 0)
    }

    for (let i = period - 1; i < gains.length; i++) {
      const avgGain = gains.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0) / period
      const avgLoss = losses.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0) / period
      
      if (avgLoss === 0) {
        rsi.push(100)
      } else {
        const rs = avgGain / avgLoss
        rsi.push(100 - (100 / (1 + rs)))
      }
    }

    return rsi
  }

  // 计算KDJ
  private static calculateKDJ(prices: number[], period: number = 9): Array<{k: number, d: number, j: number}> {
    const kdj = []
    const highs = prices.slice() // 简化处理，实际应该用最高价
    const lows = prices.slice()  // 简化处理，实际应该用最低价

    for (let i = period - 1; i < prices.length; i++) {
      const highest = Math.max(...highs.slice(i - period + 1, i + 1))
      const lowest = Math.min(...lows.slice(i - period + 1, i + 1))
      
      const rsv = ((prices[i] - lowest) / (highest - lowest)) * 100
      
      let k, d, j
      if (i === period - 1) {
        k = rsv
        d = rsv
      } else {
        k = (2 * kdj[kdj.length - 1].k + rsv) / 3
        d = (2 * kdj[kdj.length - 1].d + k) / 3
      }
      j = 3 * k - 2 * d
      
      kdj.push({ k, d, j })
    }

    return kdj
  }

  // 计算布林带
  private static calculateBollingerBands(prices: number[], period: number = 20, stdDev: number = 2): Array<{upper: number, middle: number, lower: number}> {
    const boll = []
    const ma = this.calculateMA(prices, period)

    for (let i = period - 1; i < prices.length; i++) {
      const slice = prices.slice(i - period + 1, i + 1)
      const mean = ma[i - period + 1]
      const variance = slice.reduce((sum, price) => sum + Math.pow(price - mean, 2), 0) / period
      const standardDeviation = Math.sqrt(variance)
      
      boll.push({
        upper: mean + (stdDev * standardDeviation),
        middle: mean,
        lower: mean - (stdDev * standardDeviation)
      })
    }

    return boll
  }

  // 判断趋势
  private static determineTrend(prices: number[], mas: number[][]): 'up' | 'down' | 'sideways' {
    const currentPrice = prices[prices.length - 1]
    const ma5 = mas[0][mas[0].length - 1]
    const ma10 = mas[1][mas[1].length - 1]
    const ma20 = mas[2][mas[2].length - 1]

    if (currentPrice > ma5 && ma5 > ma10 && ma10 > ma20) {
      return 'up'
    } else if (currentPrice < ma5 && ma5 < ma10 && ma10 < ma20) {
      return 'down'
    } else {
      return 'sideways'
    }
  }

  // 计算趋势强度
  private static calculateTrendStrength(prices: number[], trend: string): number {
    const recentPrices = prices.slice(-20) // 最近20天
    const slope = this.calculateSlope(recentPrices)
    
    let strength = Math.abs(slope) * 100
    if (trend === 'up' && slope > 0) strength *= 1.2
    if (trend === 'down' && slope < 0) strength *= 1.2
    
    return Math.min(strength, 100)
  }

  // 计算斜率
  private static calculateSlope(prices: number[]): number {
    const n = prices.length
    const x = Array.from({ length: n }, (_, i) => i)
    const y = prices

    const sumX = x.reduce((a, b) => a + b, 0)
    const sumY = y.reduce((a, b) => a + b, 0)
    const sumXY = x.reduce((sum, xi, i) => sum + xi * y[i], 0)
    const sumXX = x.reduce((sum, xi) => sum + xi * xi, 0)

    return (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX)
  }

  // 计算支撑位
  private static calculateSupport(prices: number[]): number {
    const recentPrices = prices.slice(-60) // 最近60天
    return Math.min(...recentPrices) * 0.95 // 支撑位为近期最低价的95%
  }

  // 计算压力位
  private static calculateResistance(prices: number[]): number {
    const recentPrices = prices.slice(-60) // 最近60天
    return Math.max(...recentPrices) * 1.05 // 压力位为近期最高价的105%
  }

  // 生成交易信号
  private static generateSignals(indicators: any): Array<{type: 'buy' | 'sell' | 'hold', strength: 'weak' | 'medium' | 'strong', description: string}> {
    const signals = []

    // MACD金叉死叉
    if (indicators.macd.value > indicators.macd.signal && indicators.macd.histogram > 0) {
      signals.push({
        type: 'buy',
        strength: 'medium',
        description: 'MACD金叉，建议关注'
      })
    } else if (indicators.macd.value < indicators.macd.signal && indicators.macd.histogram < 0) {
      signals.push({
        type: 'sell',
        strength: 'medium',
        description: 'MACD死叉，注意风险'
      })
    }

    // RSI超买超卖
    if (indicators.rsi < 30) {
      signals.push({
        type: 'buy',
        strength: 'strong',
        description: 'RSI超卖，可能反弹'
      })
    } else if (indicators.rsi > 70) {
      signals.push({
        type: 'sell',
        strength: 'strong',
        description: 'RSI超买，注意回调'
      })
    }

    // 均线排列
    if (indicators.currentPrice > indicators.ma5 && indicators.ma5 > indicators.ma10 && indicators.ma10 > indicators.ma20) {
      signals.push({
        type: 'buy',
        strength: 'strong',
        description: '均线多头排列，趋势向上'
      })
    } else if (indicators.currentPrice < indicators.ma5 && indicators.ma5 < indicators.ma10 && indicators.ma10 < indicators.ma20) {
      signals.push({
        type: 'sell',
        strength: 'strong',
        description: '均线空头排列，趋势向下'
      })
    }

    return signals
  }
}
