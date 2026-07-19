// 真实行情接入 —— 闭环第①步（数据）
// 数据源：腾讯行情（免费、无需token）。实时报价 qt.gtimg.cn，日K web.ifzq.gtimg.cn，搜索 smartbox.gtimg.cn

import { getConnection } from '../config/database'
import { logger } from '../utils/logger'
import type { DailyBar } from './tios/types'

export interface Quote {
  code: string
  name: string
  price: number
  prevClose: number
  open: number
  high: number
  low: number
  change: number
  changeRate: number
  volume: number
}

/** 6位代码 → 腾讯symbol：60/68→sh，00/30→sz，43/83/87→bj；支持 sh000001 等指数写法直传 */
export function toTencentSymbol(code: string): string {
  const c = code.trim().toLowerCase()
  if (/^(sh|sz|bj)\d{6}$/.test(c)) return c
  const plain = c.replace(/\.(sh|sz|bj)$/, '')
  const suffix = c.match(/\.(sh|sz|bj)$/)?.[1]
  if (suffix) return `${suffix}${plain}`
  if (/^(60|68|51|58)/.test(plain)) return `sh${plain}`
  if (/^(43|83|87|92)/.test(plain)) return `bj${plain}`
  return `sz${plain}`
}

const gbkDecoder = new TextDecoder('gbk')

async function fetchGbk(url: string): Promise<string> {
  const res = await fetch(url, { headers: { Referer: 'https://gu.qq.com/' } })
  if (!res.ok) throw new Error(`行情源HTTP ${res.status}: ${url}`)
  return gbkDecoder.decode(await res.arrayBuffer())
}

/** 实时报价（支持个股与指数） */
export async function fetchQuotes(codes: string[]): Promise<Quote[]> {
  if (codes.length === 0) return []
  const symbols = codes.map(toTencentSymbol)
  const text = await fetchGbk(`https://qt.gtimg.cn/q=${symbols.join(',')}`)
  const quotes: Quote[] = []
  for (let i = 0; i < symbols.length; i++) {
    const m = text.match(new RegExp(`v_${symbols[i]}="([^"]*)"`))
    if (!m || !m[1]) continue
    const f = m[1].split('~')
    if (f.length < 40) continue
    quotes.push({
      code: codes[i],
      name: f[1],
      price: Number(f[3]),
      prevClose: Number(f[4]),
      open: Number(f[5]),
      high: Number(f[33]),
      low: Number(f[34]),
      change: Number(f[31]),
      changeRate: Number(f[32]),
      volume: Number(f[6]),
    })
  }
  return quotes
}

/** 前复权日K（个股返回 qfqday，指数返回 day） */
export async function fetchDailyBars(code: string, days = 320): Promise<DailyBar[]> {
  const symbol = toTencentSymbol(code)
  const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${symbol},day,,,${days},qfq`
  const res = await fetch(url, { headers: { Referer: 'https://gu.qq.com/' } })
  if (!res.ok) throw new Error(`日K源HTTP ${res.status}: ${code}`)
  const json = (await res.json()) as { code: number; data?: Record<string, { qfqday?: string[][]; day?: string[][] }> }
  if (json.code !== 0 || !json.data?.[symbol]) throw new Error(`日K数据缺失: ${code}`)
  const rows = json.data[symbol].qfqday ?? json.data[symbol].day ?? []
  return rows.map(r => ({
    date: r[0],
    open: Number(r[1]),
    close: Number(r[2]),
    high: Number(r[3]),
    low: Number(r[4]),
    volume: Number(r[5]),
  }))
}

/** 股票搜索（代码/名称/拼音） */
export async function searchStock(keyword: string): Promise<{ code: string; name: string; market: string }[]> {
  const text = await fetchGbk(`https://smartbox.gtimg.cn/s3/?v=2&q=${encodeURIComponent(keyword)}&t=all`)
  const m = text.match(/="([^"]*)"/)
  if (!m || !m[1]) return []
  return m[1]
    .split('^')
    .map(item => item.split('~'))
    .filter(f => f.length >= 3 && ['sh', 'sz', 'bj'].includes(f[0]))
    .map(f => ({ code: f[1], name: decodeUnicodeName(f[2]), market: f[0] }))
}

function decodeUnicodeName(s: string): string {
  // smartbox 返回形如 \u4e2d\u9645\u65ed\u521b 的转义
  return s.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
}

/** 抓取日K并落库 stock_daily（幂等 upsert） */
export async function syncDailyBars(codes: string[], days = 320): Promise<{ code: string; saved: number; error?: string }[]> {
  const conn = getConnection()
  const results: { code: string; saved: number; error?: string }[] = []
  for (const code of codes) {
    try {
      const bars = await fetchDailyBars(code, days)
      for (const b of bars) {
        await conn.execute(
          `INSERT INTO stock_daily (stock_code, trade_date, open_price, high_price, low_price, close_price, volume)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE open_price=VALUES(open_price), high_price=VALUES(high_price),
             low_price=VALUES(low_price), close_price=VALUES(close_price), volume=VALUES(volume)`,
          [code, b.date, b.open, b.high, b.low, b.close, b.volume]
        )
      }
      results.push({ code, saved: bars.length })
    } catch (err) {
      logger.error(`同步日K失败 ${code}:`, err)
      results.push({ code, saved: 0, error: (err as Error).message })
    }
  }
  return results
}

/** 从库中读取日K（升序），供TIOS引擎使用 */
export async function getBarsFromDB(code: string, limit = 320): Promise<DailyBar[]> {
  const conn = getConnection()
  const [rows] = await conn.execute(
    `SELECT DATE_FORMAT(trade_date, '%Y-%m-%d') as date,
            open_price as open, high_price as high, low_price as low, close_price as close, volume
     FROM stock_daily WHERE stock_code = ?
     ORDER BY trade_date DESC LIMIT ${Math.max(1, Math.min(1000, limit))}`,
    [code]
  )
  const bars = (rows as { date: string; open: string; high: string; low: string; close: string; volume: string }[]).map(r => ({
    date: r.date,
    open: Number(r.open),
    high: Number(r.high),
    low: Number(r.low),
    close: Number(r.close),
    volume: Number(r.volume),
  }))
  return bars.reverse()
}
