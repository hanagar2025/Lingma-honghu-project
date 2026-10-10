/**
 * 执行单的数据核对：持仓收盘价必须两源一致，否则不出执行单。
 *
 * 主源是驾驶舱用的腾讯日 K，副源是新浪实时行情（与腾讯无关）。
 * 腾讯日 K 为前复权，但最新一根的收盘价与不复权价相同，可以直接比。
 * 盘前新浪的现价字段为 0，此时拿它的「昨收」与腾讯最新一根比。
 */
import type { DecisionInput, DecisionSession, PriceCheck, Verification } from './types'

export const MARKET_INDEX = 'sh000001'
const PRICE_TOLERANCE = 0.002

export interface SinaRaw { prevClose: number; price: number; date: string }

export function sinaSymbol(code: string): string {
  return /^[569]/.test(code) ? `sh${code}` : `sz${code}`
}

export function parseSinaRaw(text: string): Record<string, SinaRaw> {
  const out: Record<string, SinaRaw> = {}
  for (const line of text.split('\n')) {
    const m = /hq_str_(s[hz]\d{6})="([^"]*)"/.exec(line)
    if (!m) continue
    const f = m[2]!.split(',')
    if (f.length < 32) continue
    const date = f[30] ?? ''
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue
    out[m[1]!] = { prevClose: Number(f[2]), price: Number(f[3]), date }
  }
  return out
}

export async function fetchSinaRaw(symbols: readonly string[]): Promise<Record<string, SinaRaw>> {
  let last: unknown
  for (let i = 0; i < 3; i++) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 15_000)
    try {
      const res = await fetch(`https://hq.sinajs.cn/list=${symbols.join(',')}`, {
        headers: { Referer: 'https://finance.sina.com.cn', 'User-Agent': 'Mozilla/5.0' },
        signal: ctrl.signal,
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      return parseSinaRaw(new TextDecoder('gbk').decode(await res.arrayBuffer()))
    } catch (e) {
      last = e
      await new Promise(r => setTimeout(r, 800 * Math.pow(2, i)))
    } finally {
      clearTimeout(timer)
    }
  }
  throw new Error(`新浪行情请求失败：${String(last)}`)
}

function close(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(0.011, PRICE_TOLERANCE * b)
}

export function verifyInput(
  input: DecisionInput, sina: Record<string, SinaRaw> | null, session: DecisionSession,
): Verification {
  const problems: string[] = []
  const marketDate = sina?.[MARKET_INDEX]?.date ?? null
  if (sina === null) problems.push('第二数据源（新浪行情）取不到，收盘价无法核对')

  if (input.account.stale) {
    problems.push(input.account.staleDays === null
      ? '账本没有日期，股数与现金时点不可知'
      : `账本 ${input.ledgerAsOf} 已落后 ${input.account.staleDays} 天，股数与现金需要对账`)
  }

  const checks: PriceCheck[] = []
  for (const h of input.holdings.filter(x => x.quantity > 0)) {
    const s = sina?.[sinaSymbol(h.code)]
    let secondary: number | null = null
    let note = ''
    if (h.close === null) note = '主数据源无收盘价'
    else if (!s) note = '新浪无此代码行情'
    else if (h.barDate === s.date && s.price > 0) secondary = s.price
    else if (h.barDate !== null && h.barDate < s.date && s.prevClose > 0) secondary = s.prevClose
    else note = `日期对不上（腾讯 ${h.barDate ?? '无'} / 新浪 ${s.date}）`

    if (session === 'POST_CLOSE' && marketDate && h.barDate && h.barDate < marketDate && s?.date === marketDate) {
      secondary = null
      note = `主数据源停在 ${h.barDate}，未更新到 ${marketDate}`
    }
    const ok = h.close !== null && secondary !== null && close(h.close, secondary)
    if (!ok && !note) note = `两源差 ${((h.close! / secondary! - 1) * 100).toFixed(2)}%`
    checks.push({ code: h.code, name: h.name, primary: h.close, secondary, ok, note })
  }
  const bad = checks.filter(c => !c.ok)
  if (bad.length) problems.push(`收盘价核对未通过：${bad.map(c => `${c.name}（${c.note}）`).join('；')}`)

  const missing = input.priceFailed.filter(c => input.holdings.some(h => h.code === c && h.quantity > 0))
  if (missing.length) problems.push(`持仓行情拉取失败：${missing.join('、')}`)

  return { ok: problems.length === 0, marketDate, checks, problems }
}
