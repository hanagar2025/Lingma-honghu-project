/**
 * 决策输入：账本 + 持仓价格 → 占比、净值指数、三条线。
 *
 * 这里只算账户这一侧。证据分、卖出条件和指令在 plan.ts，价格两源核对通过之后才算。
 */
import type { BaseFile } from '../chain/types'
import { accountFreshness, type LedgerFile } from './ledger'
import { computeLines, outsideChain } from './rules'
import type { DecisionInput } from './types'

export interface LastBar { date: string; close: number }

export function tencentSymbol(code: string): string {
  if (/^(60|68|51|58)/.test(code)) return `sh${code}`
  if (/^(43|83|87|92)/.test(code)) return `bj${code}`
  return `sz${code}`
}

/** 腾讯前复权日 K 的最新一根。最新一根的收盘价与不复权价相同；盘中它就是实时价 */
export async function fetchLastBar(code: string, doFetch: typeof fetch = fetch): Promise<LastBar> {
  const symbol = tencentSymbol(code)
  const res = await doFetch(`https://web.ifzq.gtimg.cn/appstock/app/newfqkline/get?param=${symbol},day,,,5,qfq`, {
    headers: { Referer: 'https://gu.qq.com/' },
  })
  if (!res.ok) throw new Error(`日K源HTTP ${res.status}: ${code}`)
  const json = (await res.json()) as { code: number; data?: Record<string, { qfqday?: string[][]; day?: string[][] }> }
  const rows = json.data?.[symbol]?.qfqday ?? json.data?.[symbol]?.day ?? []
  const last = rows[rows.length - 1]
  if (json.code !== 0 || !last) throw new Error(`日K数据缺失: ${code}`)
  return { date: last[0]!, close: Number(last[2]) }
}

/** 行情源偶尔会拒掉并发请求中的一两个。每只最多试 3 次，仍取不到才记为失败 */
export async function fetchLastBars(
  codes: readonly string[], opts: { doFetch?: typeof fetch; backoffMs?: number } = {},
): Promise<{ bars: Record<string, LastBar>; failed: string[] }> {
  const bars: Record<string, LastBar> = {}
  const failed: string[] = []
  const backoff = opts.backoffMs ?? 400
  await Promise.all(codes.map(async c => {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        bars[c] = await fetchLastBar(c, opts.doFetch)
        return
      } catch {
        if (attempt < 3) await new Promise(r => setTimeout(r, backoff * attempt))
      }
    }
    failed.push(c)
  }))
  return { bars, failed }
}

export function buildDecisionInput(
  pf: LedgerFile,
  bars: Readonly<Record<string, LastBar | undefined>>,
  failed: readonly string[] = [],
  today?: string,
  base: Pick<BaseFile, 'totalAssets' | 'at' | 'highIndex'> | null = null,
): DecisionInput {
  const account = accountFreshness(pf.asOf, today)
  const dates = pf.positions.map(p => bars[p.code]?.date).filter((d): d is string => !!d).sort()
  const date = dates[dates.length - 1] ?? today ?? new Date().toISOString().slice(0, 10)

  // 取不到价格的持仓按成本价估市值。它会让核对不通过，执行单因此不出股数
  const positionsValue = pf.positions.reduce((s, p) => s + (bars[p.code]?.close ?? p.cost ?? 0) * p.quantity, 0)
  const externalCash = pf.externalCash ?? 0
  const brokerTotal = pf.cash + positionsValue
  const portfolioTotal = brokerTotal + externalCash
  const snapshot = { date, brokerTotal, cash: pf.cash, positionsValue, externalCash, portfolioTotal }

  // 净值指数：基准没填、或有持仓取不到价格时算不出。算不出就是“核对不了”，不当作没触线
  const priced = pf.positions.every(p => !(p.quantity > 0) || bars[p.code]?.close !== undefined)
  const navIndex = base && base.totalAssets > 0 && priced && portfolioTotal > 0 ? (portfolioTotal / base.totalAssets) * 100 : null
  const navHigh = base ? Math.max(base.highIndex, navIndex ?? 0) : null

  const holdings = pf.positions.map(p => ({
    code: p.code, name: p.name, quantity: p.quantity,
    close: bars[p.code]?.close ?? null, barDate: bars[p.code]?.date ?? null,
  }))
  return {
    date,
    ledgerAsOf: pf.asOf ?? null,
    account,
    snapshot,
    holdings,
    priceFailed: [...failed],
    dataGaps: account.gaps,
    lines: { ...computeLines(navIndex, navHigh), baseAt: base?.at ?? null },
    plan: null,
    outsideChain: outsideChain(holdings).map(h => ({ code: h.code, name: h.name })),
  }
}
