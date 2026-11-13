/**
 * 持仓快照的勾稽核对。识别错一位数字，这里要能拦住。
 *
 * 券商页面上的数字彼此约束：各持仓市值相加等于总市值；总市值加现金等于总资产；
 * 市值除以现价是整数股。三条都对上，读错的可能性就很小了。
 */
import type { LedgerFile } from '../dailyDecision/ledger'
import { findMember } from '../msr/universe'
import type { Check, HoldingsSnapshot, Intent } from './types'

export interface DayRange { low: number; high: number }

export function reconcileHoldings(s: HoldingsSnapshot, ranges?: Record<string, DayRange>): Check[] {
  const checks: Check[] = []

  const badCode = s.positions.filter(p => !/^\d{6}$/.test(p.code))
  const codes = s.positions.map(p => p.code)
  const dup = codes.filter((c, i) => codes.indexOf(c) !== i)
  const badQty = s.positions.filter(p => !Number.isInteger(p.quantity) || p.quantity <= 0)
  checks.push({
    name: '代码与股数',
    ok: !badCode.length && !dup.length && !badQty.length && s.cash >= 0 && /^\d{4}-\d{2}-\d{2}$/.test(s.asOf),
    detail: [
      badCode.length ? `代码不是 6 位：${badCode.map(p => p.name).join('、')}` : '',
      dup.length ? `代码重复：${[...new Set(dup)].join('、')}` : '',
      badQty.length ? `股数不是正整数：${badQty.map(p => p.name).join('、')}` : '',
      s.cash < 0 ? '现金为负' : '',
    ].filter(Boolean).join('；') || `${s.positions.length} 只持仓，股数均为正整数`,
  })

  const priced = s.positions.filter(p => p.price !== undefined && p.marketValue !== undefined)
  if (priced.length === s.positions.length && priced.length) {
    const off = priced.filter(p => Math.abs(p.quantity * p.price! - p.marketValue!) > Math.max(1, p.quantity * 0.005))
    checks.push({
      name: '市值 = 股数 × 现价',
      ok: !off.length,
      detail: off.length ? `对不上：${off.map(p => p.name).join('、')}` : `${priced.length} 只全部对上`,
    })
  } else {
    checks.push({ name: '市值 = 股数 × 现价', ok: null, detail: '没有逐只的现价和市值，无法核对' })
  }

  const sum = s.positions.reduce((a, p) => a + (p.marketValue ?? NaN), 0)
  if (s.totalMarketValue !== undefined && Number.isFinite(sum)) {
    const ok = Math.abs(sum - s.totalMarketValue) <= 1
    checks.push({ name: '各持仓市值之和 = 总市值', ok, detail: ok ? '对上' : '对不上，可能漏了一只持仓或读错了数字' })
  } else {
    checks.push({ name: '各持仓市值之和 = 总市值', ok: null, detail: '没有总市值，无法核对' })
  }

  const mv = s.totalMarketValue ?? (Number.isFinite(sum) ? sum : undefined)
  if (s.totalAssets !== undefined && mv !== undefined) {
    const ok = Math.abs(mv + s.cash - s.totalAssets) <= 1
    checks.push({ name: '总市值 + 现金 = 总资产', ok, detail: ok ? '对上' : '对不上，现金或总资产有一项读错' })
  } else {
    checks.push({ name: '总市值 + 现金 = 总资产', ok: null, detail: '没有总资产或市值，无法核对' })
  }

  if (ranges && priced.length) {
    const missing = priced.filter(p => !ranges[p.code])
    const outside = priced.filter(p => ranges[p.code] && (p.price! < ranges[p.code]!.low - 0.011 || p.price! > ranges[p.code]!.high + 0.011))
    checks.push({
      name: '现价在当日行情区间内',
      ok: outside.length ? false : missing.length ? null : true,
      detail: outside.length
        ? `不在当日最低价与最高价之间：${outside.map(p => p.name).join('、')}`
        : missing.length ? `行情取不到：${missing.map(p => p.name).join('、')}` : `${priced.length} 只全部在区间内`,
    })
  }
  return checks
}

export function checksPassed(checks: readonly Check[]): boolean {
  return checks.every(c => c.ok !== false)
}

/** 只凭文字、没有任何金额勾稽 */
export function unverifiable(checks: readonly Check[]): boolean {
  return checks.filter(c => c.ok === null).length >= 3
}

/** 新快照写成账本。峰值与口径沿用上一份；成本沿用旧值，没有旧值时用现价占位 */
export function toLedger(s: HoldingsSnapshot, prev: LedgerFile | null): LedgerFile {
  return {
    asOf: s.asOf,
    cash: s.cash,
    externalCash: 0,
    peakAssets: prev?.peakAssets ?? 0,
    peakBasis: prev?.peakBasis ?? 'BROKER',
    peakVerified: prev?.peakVerified ?? false,
    positions: s.positions.map(p => {
      const cost = p.cost ?? prev?.positions.find(x => x.code === p.code)?.cost ?? p.price
      return { code: p.code, name: p.name, quantity: p.quantity, ...(cost !== undefined ? { cost } : {}) }
    }),
  }
}

/** 与上一份账本相比变了什么。给确认的人看，也是成交记录的旁证 */
export function diffLedger(prev: LedgerFile | null, next: HoldingsSnapshot): string[] {
  if (!prev) return ['这是第一份账本']
  const out: string[] = []
  const before = new Map(prev.positions.filter(p => p.quantity > 0).map(p => [p.code, p]))
  for (const p of next.positions) {
    const old = before.get(p.code)
    if (!old) out.push(`新增 ${p.name} ${p.quantity} 股`)
    else if (old.quantity !== p.quantity) out.push(`${p.name} ${old.quantity} → ${p.quantity} 股`)
    before.delete(p.code)
  }
  for (const old of before.values()) out.push(`${old.name} ${old.quantity} 股 → 已清空`)
  return out.length ? out : ['股数与上一份账本相同']
}

/**
 * 意向对照现行规则。只说明在规则内还是规则外，不批准、也不阻止。
 * instructed：当前执行单上的卖出指令（代码 → 股数）；执行单停单时为 null，此时不对卖出定性。
 */
export function classifyIntent(intent: Intent, instructed: Record<string, number> | null, held: Record<string, number>): string {
  const who = `${intent.name} ${intent.code}`
  if (intent.side === 'BUY') {
    const scope = findMember(intent.code) ? '' : `${who} 不在四条主线内。`
    return `规则外。${scope}现行规则下买入权限关闭，买入只通过分段重建计划，该计划尚未生效。已按收到时刻登记。`
  }
  if (!held[intent.code]) return `规则外。账本里没有 ${who} 的持仓。已按收到时刻登记。`
  if (instructed === null) return '执行单此刻因数据未通过核对而停单，无法判断这笔卖出在规则内还是规则外。已按收到时刻登记，核对恢复后以当时的执行单为准。'
  const want = instructed[intent.code]
  if (want === undefined) return `规则外。现行三条卖出规则今天没有对 ${who} 的指令。已按收到时刻登记。`
  if (intent.quantity === null) return `规则内。执行单要求卖出 ${who} ${want} 股，下单时按实时价重算。`
  if (intent.quantity < want) return `规则内，但不足。执行单要求卖出 ${want} 股，意向只有 ${intent.quantity} 股。`
  if (intent.quantity > want) return `前 ${want} 股在规则内，多出的 ${intent.quantity - want} 股在规则外。已按收到时刻登记。`
  return `规则内。与执行单一致：卖出 ${who} ${want} 股。`
}
