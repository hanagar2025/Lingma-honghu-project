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
/** 盘中两源取价有几秒先后，放宽到 0.5% */
const INTRADAY_TOLERANCE = 0.005

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

/**
 * 新浪接口会间歇性拒绝（10/15 实测：同一请求先 403、两秒后 200；GitHub 运行机上则是连接失败），
 * 所以轮换 https/http 两个入口与两种 Referer，退避共约 30 秒，仍失败才判「取不到」。
 */
const SINA_ATTEMPTS: readonly { base: string; referer: string }[] = [
  { base: 'https://hq.sinajs.cn', referer: 'https://finance.sina.com.cn' },
  { base: 'http://hq.sinajs.cn', referer: 'https://finance.sina.com.cn/' },
  { base: 'https://hq.sinajs.cn', referer: 'https://finance.sina.com.cn/realstock/company/sh000001/nc.shtml' },
  { base: 'http://hq.sinajs.cn', referer: 'https://finance.sina.com.cn/realstock/company/sh000001/nc.shtml' },
  { base: 'https://hq.sinajs.cn', referer: 'https://finance.sina.com.cn' },
  { base: 'http://hq.sinajs.cn', referer: 'https://finance.sina.com.cn/' },
]
const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'

export async function fetchSinaRaw(
  symbols: readonly string[], opts: { backoffMs?: number; fetchImpl?: typeof fetch } = {},
): Promise<Record<string, SinaRaw>> {
  const backoff = opts.backoffMs ?? 1000
  const doFetch = opts.fetchImpl ?? fetch
  const errors: string[] = []
  for (let i = 0; i < SINA_ATTEMPTS.length; i++) {
    const { base, referer } = SINA_ATTEMPTS[i]!
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 15_000)
    try {
      const res = await doFetch(`${base}/list=${symbols.join(',')}`, {
        headers: { Referer: referer, 'User-Agent': BROWSER_UA },
        signal: ctrl.signal,
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const parsed = parseSinaRaw(new TextDecoder('gbk').decode(await res.arrayBuffer()))
      if (!Object.keys(parsed).length) throw new Error('返回内容里没有行情')
      return parsed
    } catch (e) {
      errors.push(`${i + 1}:${e instanceof Error ? e.message : String(e)}`)
      if (i < SINA_ATTEMPTS.length - 1) await new Promise(r => setTimeout(r, Math.min(backoff * Math.pow(2, i), 10 * backoff)))
    } finally {
      clearTimeout(timer)
    }
  }
  throw new Error(`新浪行情请求失败（${SINA_ATTEMPTS.length} 次）：${errors.join('；')}`)
}

function close(a: number, b: number, tol: number): boolean {
  return Math.abs(a - b) <= Math.max(0.011, tol * b)
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

    if (session !== 'PRE_OPEN' && marketDate && h.barDate && h.barDate < marketDate && s?.date === marketDate) {
      secondary = null
      note = `主数据源停在 ${h.barDate}，未更新到 ${marketDate}`
    }
    const tol = session === 'INTRADAY' ? INTRADAY_TOLERANCE : PRICE_TOLERANCE
    const ok = h.close !== null && secondary !== null && close(h.close, secondary, tol)
    if (!ok && !note) note = `两源差 ${((h.close! / secondary! - 1) * 100).toFixed(2)}%`
    checks.push({ code: h.code, name: h.name, primary: h.close, secondary, ok, note })
  }
  const bad = checks.filter(c => !c.ok)
  if (bad.length) problems.push(`收盘价核对未通过：${bad.map(c => `${c.name}（${c.note}）`).join('；')}`)

  const missing = input.priceFailed.filter(c => input.holdings.some(h => h.code === c && h.quantity > 0))
  if (missing.length) problems.push(`持仓行情拉取失败：${missing.join('、')}`)

  return { ok: problems.length === 0, marketDate, checks, problems }
}
