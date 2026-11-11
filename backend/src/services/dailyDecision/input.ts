/**
 * 决策输入：账本 + 持仓价格 → 仓位、回撤、法定动作。
 *
 * 只取持仓的价格，只算三件事：单票是否超限、熔断处在哪一级、有没有主线外持仓。
 * 不读任何研究模块。
 */
import { accountFreshness, type LedgerFile } from './ledger'
import { computeCircuit, findLimitBreaches, outsideMainline, sharesToClearExcess } from './rules'
import type { DecisionAction, DecisionInput } from './types'

export interface LastBar { date: string; close: number }

function tencentSymbol(code: string): string {
  if (/^(60|68|51|58)/.test(code)) return `sh${code}`
  if (/^(43|83|87|92)/.test(code)) return `bj${code}`
  return `sz${code}`
}

/** 腾讯前复权日 K 的最新一根。最新一根的收盘价与不复权价相同；盘中它就是实时价 */
export async function fetchLastBar(code: string, doFetch: typeof fetch = fetch): Promise<LastBar> {
  const symbol = tencentSymbol(code)
  const res = await doFetch(`https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${symbol},day,,,5,qfq`, {
    headers: { Referer: 'https://gu.qq.com/' },
  })
  if (!res.ok) throw new Error(`日K源HTTP ${res.status}: ${code}`)
  const json = (await res.json()) as { code: number; data?: Record<string, { qfqday?: string[][]; day?: string[][] }> }
  const rows = json.data?.[symbol]?.qfqday ?? json.data?.[symbol]?.day ?? []
  const last = rows[rows.length - 1]
  if (json.code !== 0 || !last) throw new Error(`日K数据缺失: ${code}`)
  return { date: last[0]!, close: Number(last[2]) }
}

export async function fetchLastBars(codes: readonly string[]): Promise<{ bars: Record<string, LastBar>; failed: string[] }> {
  const bars: Record<string, LastBar> = {}
  const failed: string[] = []
  await Promise.all(codes.map(async c => {
    try { bars[c] = await fetchLastBar(c) } catch { failed.push(c) }
  }))
  return { bars, failed }
}

export function buildDecisionInput(
  pf: LedgerFile,
  bars: Readonly<Record<string, LastBar | undefined>>,
  failed: readonly string[] = [],
  today?: string,
): DecisionInput {
  const account = accountFreshness(pf.asOf, today)
  const dates = pf.positions.map(p => bars[p.code]?.date).filter((d): d is string => !!d).sort()
  const date = dates[dates.length - 1] ?? today ?? new Date().toISOString().slice(0, 10)

  // 取不到价格的持仓按成本价估市值。它会让核对不通过，执行单因此不出股数
  const positions = pf.positions.map(p => ({
    code: p.code, name: p.name,
    marketValue: (bars[p.code]?.close ?? p.cost ?? 0) * p.quantity,
  }))
  const positionsValue = positions.reduce((s, p) => s + p.marketValue, 0)
  const externalCash = pf.externalCash ?? 0
  const brokerTotal = pf.cash + positionsValue
  const portfolioTotal = brokerTotal + externalCash
  const peakBasis = pf.peakBasis ?? 'BROKER'
  const snapshot = {
    date, brokerTotal, cash: pf.cash, positionsValue, externalCash, portfolioTotal,
    // 峰值只在同口径下才允许被当前值刷新
    peakAssets: peakBasis === 'PORTFOLIO' ? Math.max(pf.peakAssets, portfolioTotal) : pf.peakAssets,
    peakBasis,
    peakVerified: pf.peakVerified !== false,
  }
  const circuit = computeCircuit(snapshot)

  const actions: DecisionAction[] = []
  for (const b of findLimitBreaches(positions, portfolioTotal)) {
    const px = bars[b.code]?.close ?? null
    const held = pf.positions.find(p => p.code === b.code)?.quantity ?? null
    actions.push({
      code: b.code, name: b.name, kind: 'REDUCE', reason: 'POSITION_LIMIT',
      size: { value: px && px > 0 ? sharesToClearExcess(b.code, b.excessValue, px, held) : null },
    })
  }
  // 组合层降仓只在峰值已核实时成为指令；待核验时由执行单写成"不执行、不撤销"
  const stockPct = portfolioTotal > 0 ? positionsValue / portfolioTotal : null
  if (circuit.equityCap !== null && stockPct !== null && stockPct > circuit.equityCap && snapshot.peakVerified) {
    actions.push({
      code: 'PORTFOLIO', name: '组合整体', kind: 'REDUCE', reason: 'CIRCUIT_BREAKER',
      size: { value: (stockPct - circuit.equityCap) * portfolioTotal },
    })
  }

  const holdings = pf.positions.map(p => ({
    code: p.code, name: p.name, quantity: p.quantity,
    close: bars[p.code]?.close ?? null, barDate: bars[p.code]?.date ?? null,
  }))
  return {
    date,
    ledgerAsOf: pf.asOf ?? null,
    account,
    snapshot,
    circuit,
    holdings,
    priceFailed: [...failed],
    actions,
    noNewEntry: { verdict: true, reasons: ['买入只通过分段重建计划，执行单不产生买入'] },
    dataGaps: account.gaps,
    outsideMainline: outsideMainline(holdings).map(h => ({ code: h.code, name: h.name })),
  }
}
