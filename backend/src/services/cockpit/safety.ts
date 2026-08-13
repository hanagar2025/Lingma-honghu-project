// 第①问：今天组合安全吗？
//
// 本问全部由**账务事实**构成（ACCOUNTING 等级），不含任何预测。
// 因此它是驾驶舱里唯一可以直接产生减仓动作的一问 —— 也是回测唯一没有否掉的部分。
//
// 缺数据时的处理原则：显示"缺失"并按 UNKNOWN（等同必须处理）对待，
// **绝不用默认值糊过去**。/portfolio/summary 里那个硬编码的 10万现金就是反面教材。

import type { Position, AccountSnapshot } from '../tios/types'
import { findMember } from '../msr/universe'
import type { Answer, AnswerRow, Light, Metric } from './types'

/** 仓位与风险预算上限 —— 与 tios/gates.ts、executionEngine.ts 同源，改这里须同步改那里 */
export const LIMITS = {
  singleStock: 0.12,
  sector: 0.30,
  theme: 0.45,
  cashFloor: 0.10,
  /** 组合回撤触发点：15% 降仓至50%，25% 降至30%且只卖不买 */
  circuitLevel1: 0.15,
  circuitLevel2: 0.25,
  /** 家庭安全垫：现金须覆盖的刚性支出年数 */
  safetyNetYears: 2,
} as const

export interface SafetyInput {
  snapshot: AccountSnapshot
  positions: Position[]
  /** 家庭年度刚性支出。未提供则安全垫一项判为数据缺失 —— 不猜 */
  householdAnnualExpense?: number
  /** 主线集中度按 MSR universe 的主线归属聚合 */
  asOf: string
}

function m(
  label: string, value: number | null, display: string,
  source: string, formula: string, asOf: string, missingReason?: string
): Metric {
  return { label, value, display, source, formula, asOf, tier: 'ACCOUNTING', missingReason }
}

function pctStr(v: number | null): string {
  return v === null ? '缺失' : `${(v * 100).toFixed(1)}%`
}

function wanStr(v: number | null): string {
  return v === null ? '缺失' : `${(v / 10000).toFixed(1)}万`
}

/** 三色灯取最严：任一项 RED 则整体 RED；UNKNOWN 等同 RED 对待但单独标注 */
export function worstLight(lights: Light[]): Light {
  if (lights.includes('RED')) return 'RED'
  if (lights.includes('UNKNOWN')) return 'UNKNOWN'
  if (lights.includes('YELLOW')) return 'YELLOW'
  return 'GREEN'
}

export function evaluateSafety(input: SafetyInput): Answer {
  const { snapshot, positions, householdAnnualExpense, asOf } = input
  const total = snapshot.totalAssets
  const rows: AnswerRow[] = []
  const metrics: Metric[] = []

  // ── 总资产 ──
  const mTotal = m('总资产', total, wanStr(total), 'account_state.cash + Σ positions.market_value',
    `现金${wanStr(snapshot.cash)} + 持仓市值${wanStr(snapshot.positionsValue)}`, asOf)
  metrics.push(mTotal)
  rows.push({
    label: '总资产', status: wanStr(total), light: 'GREEN',
    decision: '记录', metrics: [mTotal],
  })

  // ── 现金比例 ──
  const cashPct = total > 0 ? snapshot.cash / total : null
  const mCash = m('现金比例', cashPct, pctStr(cashPct), 'account_state.cash / 总资产',
    `${wanStr(snapshot.cash)} ÷ ${wanStr(total)}`, asOf,
    total > 0 ? undefined : '总资产为0或缺失')
  metrics.push(mCash)
  const cashLight: Light =
    cashPct === null ? 'UNKNOWN' : cashPct <= LIMITS.cashFloor ? 'RED' : cashPct < 0.15 ? 'YELLOW' : 'GREEN'
  rows.push({
    label: '现金比例', status: `${pctStr(cashPct)}（红线${pctStr(LIMITS.cashFloor)}）`,
    light: cashLight,
    decision: cashLight === 'RED' ? '禁止新增建仓' : cashLight === 'YELLOW' ? '不再扩仓' : '正常',
    metrics: [mCash],
  })

  // ── 家庭安全垫 ──
  const needed = householdAnnualExpense === undefined ? null : householdAnnualExpense * LIMITS.safetyNetYears
  const netYears = householdAnnualExpense === undefined || householdAnnualExpense <= 0
    ? null : snapshot.cash / householdAnnualExpense
  const mNet = m('安全垫年数', netYears, netYears === null ? '缺失' : `${netYears.toFixed(1)}年`,
    '用户输入的家庭年度刚性支出',
    householdAnnualExpense === undefined
      ? `未提供家庭年度刚性支出，无法计算（需 现金 ÷ 年支出 ≥ ${LIMITS.safetyNetYears}）`
      : `${wanStr(snapshot.cash)} ÷ ${wanStr(householdAnnualExpense)} = ${netYears?.toFixed(2)}年，要求≥${LIMITS.safetyNetYears}年`,
    asOf,
    householdAnnualExpense === undefined ? '委员会尚未提供家庭年度刚性支出' : undefined)
  metrics.push(mNet)
  const netLight: Light =
    netYears === null ? 'UNKNOWN' : netYears >= LIMITS.safetyNetYears ? 'GREEN'
      : netYears >= LIMITS.safetyNetYears * 0.75 ? 'YELLOW' : 'RED'
  rows.push({
    label: '家庭安全垫', status: netYears === null ? '数据缺失' : `${netYears.toFixed(1)}年 / 要求${LIMITS.safetyNetYears}年`,
    light: netLight,
    decision: netLight === 'UNKNOWN'
      ? '待委员会提供年度刚性支出后方可判定'
      : netLight === 'GREEN' ? '正常' : '优先补足现金',
    metrics: [mNet],
  })

  // ── 单股仓位 ──
  const over: { code: string; name: string; pct: number; excessValue: number }[] = []
  for (const p of positions) {
    const pct = total > 0 ? p.marketValue / total : 0
    if (pct > LIMITS.singleStock) {
      over.push({ code: p.code, name: p.name, pct, excessValue: p.marketValue - total * LIMITS.singleStock })
    }
  }
  over.sort((a, b) => b.pct - a.pct)
  const maxStockPct = positions.length
    ? Math.max(...positions.map(p => (total > 0 ? p.marketValue / total : 0))) : null
  const mStock = m('最大单股仓位', maxStockPct, pctStr(maxStockPct),
    'positions.market_value / 总资产',
    over.length
      ? over.map(o => `${o.name} ${pctStr(o.pct)}（超出${wanStr(o.excessValue)}）`).join('；')
      : `全部持仓均不超过上限${pctStr(LIMITS.singleStock)}`,
    asOf, positions.length ? undefined : '无持仓记录')
  metrics.push(mStock)
  const stockLight: Light = over.length > 0 ? 'RED' : maxStockPct === null ? 'UNKNOWN'
    : maxStockPct > LIMITS.singleStock * 0.9 ? 'YELLOW' : 'GREEN'
  rows.push({
    label: '单股仓位上限', status: over.length
      ? `${over.length}只超限：${over.map(o => `${o.name}${pctStr(o.pct)}`).join('、')}`
      : `最高${pctStr(maxStockPct)} / 上限${pctStr(LIMITS.singleStock)}`,
    light: stockLight,
    decision: over.length ? '减仓至上限（法定理由：仓位超限）' : '正常',
    metrics: [mStock],
  })

  // ── 主线集中度 ──
  const byMainline = new Map<string, number>()
  let unclassified = 0
  for (const p of positions) {
    const hit = findMember(p.code)
    if (hit) byMainline.set(hit.mainline.name, (byMainline.get(hit.mainline.name) ?? 0) + p.marketValue)
    else unclassified += p.marketValue
  }
  const mainlineRows = [...byMainline.entries()]
    .map(([name, v]) => ({ name, pct: total > 0 ? v / total : 0, value: v }))
    .sort((a, b) => b.pct - a.pct)
  const maxMainline = mainlineRows[0] ?? null
  const mMainline = m('最大主线集中度', maxMainline?.pct ?? null, pctStr(maxMainline?.pct ?? null),
    'Σ 该主线成员市值 / 总资产（主线归属取自 msr/universe.ts）',
    mainlineRows.length
      ? mainlineRows.map(r => `${r.name} ${pctStr(r.pct)}`).join('；') +
        (unclassified > 0 ? `；未归类 ${wanStr(unclassified)}` : '')
      : '无可归类持仓',
    asOf, mainlineRows.length ? undefined : '持仓未匹配到任何主线')
  metrics.push(mMainline)
  // 主线集中度沿用主题45%上限（一条主线在本组合里即一个主题）
  const mainlineLight: Light = maxMainline === null ? 'UNKNOWN'
    : maxMainline.pct > LIMITS.theme ? 'RED' : maxMainline.pct > LIMITS.theme * 0.85 ? 'YELLOW' : 'GREEN'
  rows.push({
    label: '主线集中度', status: maxMainline
      ? `${maxMainline.name} ${pctStr(maxMainline.pct)} / 上限${pctStr(LIMITS.theme)}`
      : '数据缺失',
    light: mainlineLight,
    decision: mainlineLight === 'RED' ? '减仓至上限（法定理由：主题超限）' : '继续跟踪',
    metrics: [mMainline],
  })

  // ── 最大回撤与熔断 ──
  const dd = snapshot.peakAssets > 0 ? 1 - total / snapshot.peakAssets : null
  const mDd = m('自峰值回撤', dd, pctStr(dd), 'account_state.peak_assets',
    snapshot.peakAssets > 0
      ? `1 − ${wanStr(total)} ÷ ${wanStr(snapshot.peakAssets)}`
      : '峰值净值缺失，无法计算',
    asOf, snapshot.peakAssets > 0 ? undefined : 'account_state.peak_assets 为0或缺失')
  metrics.push(mDd)
  const ddLight: Light = dd === null ? 'UNKNOWN'
    : dd >= LIMITS.circuitLevel2 ? 'RED' : dd >= LIMITS.circuitLevel1 ? 'RED' : dd >= 0.10 ? 'YELLOW' : 'GREEN'
  const capByDd = dd === null ? null : dd >= LIMITS.circuitLevel2 ? 0.30 : dd >= LIMITS.circuitLevel1 ? 0.50 : null
  rows.push({
    label: '组合回撤/熔断', status: dd === null ? '数据缺失'
      : `${pctStr(dd)}${capByDd !== null ? ` → 仓位上限${pctStr(capByDd)}${dd >= LIMITS.circuitLevel2 ? '且只卖不买' : ''}` : ''}`,
    light: ddLight,
    decision: capByDd !== null ? '强制降仓（法定理由：熔断风险预算）'
      : ddLight === 'YELLOW' ? '不再扩仓' : '正常',
    metrics: [mDd],
  })

  // ── 持仓总占比 ──
  const posPct = total > 0 ? snapshot.positionsValue / total : null
  const mPos = m('持仓占比', posPct, pctStr(posPct), 'Σ positions.market_value / 总资产',
    `${wanStr(snapshot.positionsValue)} ÷ ${wanStr(total)}`, asOf)
  metrics.push(mPos)
  const capOver = capByDd !== null && posPct !== null && posPct > capByDd
  rows.push({
    label: '仓位是否超熔断上限', status: capByDd === null ? `无熔断上限约束（当前${pctStr(posPct)}）`
      : `${pctStr(posPct)} vs 上限${pctStr(capByDd)}${capOver ? ' → 超限' : ''}`,
    light: capOver ? 'RED' : 'GREEN',
    decision: capOver ? `须卖出约 ${wanStr((posPct! - capByDd!) * total)}（法定理由：熔断风险预算）` : '正常',
    metrics: [mPos],
  })

  const light = worstLight(rows.map(r => r.light))
  const redRows = rows.filter(r => r.light === 'RED')
  const unknownRows = rows.filter(r => r.light === 'UNKNOWN')

  const headline =
    light === 'RED'
      ? `必须处理 ${redRows.length} 项：${redRows.map(r => r.label).join('、')}` +
        (unknownRows.length ? `；另有${unknownRows.length}项数据缺失` : '')
      : light === 'UNKNOWN'
        ? `${unknownRows.length}项数据缺失（${unknownRows.map(r => r.label).join('、')}），按必须处理对待`
        : light === 'YELLOW'
          ? `风险升高：${rows.filter(r => r.light === 'YELLOW').map(r => r.label).join('、')}`
          : '各项风险指标均在限额内'

  return { no: 1, question: '今天组合安全吗？', light, headline, metrics, rows }
}

/** 供第⑤问生成减仓动作使用的结构化超限结果 */
export interface LimitBreach {
  code: string
  name: string
  currentPct: number
  limitPct: number
  excessValue: number
  kind: 'POSITION_LIMIT' | 'THEME_LIMIT'
}

export function findLimitBreaches(input: SafetyInput): LimitBreach[] {
  const { snapshot, positions } = input
  const total = snapshot.totalAssets
  if (total <= 0) return []
  const out: LimitBreach[] = []
  for (const p of positions) {
    const pct = p.marketValue / total
    if (pct > LIMITS.singleStock) {
      out.push({
        code: p.code, name: p.name, currentPct: pct, limitPct: LIMITS.singleStock,
        excessValue: p.marketValue - total * LIMITS.singleStock, kind: 'POSITION_LIMIT',
      })
    }
  }
  return out.sort((a, b) => b.currentPct - a.currentPct)
}
