// 第②问：我手里的股票，谁正在失去势能？
//
// ⚠ 本问的全部输出等级是 OBSERVATION，**一条都不能产生动作**。
//
// 委员会 2026-08-13 原话：
//   「技术指标只能触发复核，不能凭技术指标预测未来。
//     小程序不能告诉你『中际要跌，所以卖』，而应告诉你
//     『中际技术结构恶化，但当前减仓理由仍然是仓位超限』。这两个东西必须严格分开。」
//
// 实测依据（scripts/backtest-0813-signals.py 第四节）：
//   TPO 退出信号（20日超额<0 且收盘<MA60）后继续持有的前瞻超额：
//     5日 -0.22pct、10日 -0.79pct、20日 -1.02pct、60日 **+0.56pct**（对无条件基准）
//   即该判据**识别不出后续显著跑输**。它有诊断价值，没有预测价值。
//
// 因此本文件的函数签名刻意不返回任何 Action —— 想让它产生减仓单，必须先改 types.ts。

import type { DailyBar, Position } from '../tios/types'
import { sma } from '../tios/indicators'
import { findMember } from '../msr/universe'
import type { Answer, AnswerRow, Light, Metric } from './types'
import type { ValuationInjection } from '../msr/valuation'
import type { LimitBreach } from './safety'

export interface MomentumInput {
  positions: Position[]
  barsByCode: Record<string, DailyBar[]>
  /** 主线基准指数 K 线，用于相对强度 */
  indexBarsByCode: Record<string, DailyBar[]>
  /** 大盘基准（默认创业板指），用于"相对大盘" */
  marketBars?: DailyBar[]
  valuationByCode?: Record<string, ValuationInjection>
  /** 第①问算出的法定超限，用于在同一行里并列展示"观察项 vs 法定理由" */
  breaches: LimitBreach[]
  asOf: string
}

function ret(bars: DailyBar[], n: number): number | null {
  if (bars.length < n + 1) return null
  return bars[bars.length - 1].close / bars[bars.length - 1 - n].close - 1
}

function excess(bars: DailyBar[], index: DailyBar[] | undefined, n: number): number | null {
  const a = ret(bars, n)
  const b = index ? ret(index, n) : null
  return a === null || b === null ? null : a - b
}

/** 近 n 日是否创新高 / 新低 */
function newExtreme(bars: DailyBar[], n = 60): { newHigh: boolean; newLow: boolean } | null {
  if (bars.length < n) return null
  const seg = bars.slice(-n)
  const last = seg[seg.length - 1].close
  return {
    newHigh: last >= Math.max(...seg.map(b => b.high)) * 0.999,
    newLow: last <= Math.min(...seg.map(b => b.low)) * 1.001,
  }
}

/** 成交量结构：上涨日均量 / 下跌日均量 */
function upDownVolumeRatio(bars: DailyBar[], w = 20): number | null {
  const seg = bars.slice(-w)
  const up: number[] = []
  const dn: number[] = []
  for (let i = 1; i < seg.length; i++) {
    if (seg[i].close > seg[i - 1].close) up.push(seg[i].volume)
    else if (seg[i].close < seg[i - 1].close) dn.push(seg[i].volume)
  }
  if (!up.length || !dn.length) return null
  return (up.reduce((a, b) => a + b, 0) / up.length) / (dn.reduce((a, b) => a + b, 0) / dn.length)
}

function obs(
  label: string, value: number | null, display: string, source: string, formula: string, asOf: string,
  missingReason?: string
): Metric {
  return { label, value, display, source, formula, asOf, tier: 'OBSERVATION', missingReason }
}

function pctStr(v: number | null, digits = 1): string {
  return v === null ? '缺失' : `${(v * 100).toFixed(digits)}%`
}

export interface MomentumRow {
  code: string
  name: string
  /** 触发复核的观察项。**不是减仓理由** */
  reviewTriggers: string[]
  /** 该标的当前是否存在法定减仓理由（来自第①问的账务事实） */
  legalReason: string | null
  metrics: Metric[]
  /** 观察项数量，用于排序。刻意不叫 score —— 避免被读成"越高越该卖" */
  triggerCount: number
}

export function evaluateMomentum(input: MomentumInput): { answer: Answer; rows: MomentumRow[] } {
  const { positions, barsByCode, indexBarsByCode, marketBars, valuationByCode, breaches, asOf } = input
  const breachByCode = new Map(breaches.map(b => [b.code, b]))
  const rows: MomentumRow[] = []

  for (const p of positions) {
    const bars = barsByCode[p.code]
    const metrics: Metric[] = []
    const triggers: string[] = []

    if (!bars || bars.length < 65) {
      rows.push({
        code: p.code, name: p.name, reviewTriggers: ['K线数据不足65日，无法计算'],
        legalReason: breachByCode.get(p.code)
          ? `仓位${pctStr(breachByCode.get(p.code)!.currentPct)} > 上限${pctStr(breachByCode.get(p.code)!.limitPct)}`
          : null,
        metrics: [obs('数据完整性', null, '不足', 'stock_daily / 腾讯日K', '需≥65根日K', asOf, 'K线不足65根')],
        triggerCount: 0,
      })
      continue
    }

    const hit = findMember(p.code)
    const sectorIndex = hit ? indexBarsByCode[hit.mainline.benchmark] : undefined
    const close = bars[bars.length - 1].close
    const ma20 = sma(bars, 20)
    const ma60 = sma(bars, 60)

    // ① MA20 / MA60
    const d20 = ma20 === null ? null : close / ma20 - 1
    const d60 = ma60 === null ? null : close / ma60 - 1
    metrics.push(obs('距MA20', d20, pctStr(d20), '腾讯日K(前复权)', `收盘${close.toFixed(2)} ÷ MA20${ma20?.toFixed(2) ?? 'NA'} − 1`, asOf))
    metrics.push(obs('距MA60', d60, pctStr(d60), '腾讯日K(前复权)', `收盘${close.toFixed(2)} ÷ MA60${ma60?.toFixed(2) ?? 'NA'} − 1`, asOf))
    if (d20 !== null && d20 < 0) triggers.push(`收于MA20下方（${pctStr(d20)}）`)
    if (d60 !== null && d60 < 0) triggers.push(`收于MA60下方（${pctStr(d60)}）`)

    // ② 相对行业指数（20/60日）
    const e20 = excess(bars, sectorIndex, 20)
    const e60 = excess(bars, sectorIndex, 60)
    const benchName = hit ? `${hit.mainline.name}基准${hit.mainline.benchmark}` : '无主线归属'
    metrics.push(obs('20日相对行业超额', e20, pctStr(e20), benchName,
      `个股20日涨幅 − 基准20日涨幅`, asOf, sectorIndex ? undefined : '未匹配主线基准'))
    metrics.push(obs('60日相对行业超额', e60, pctStr(e60), benchName,
      `个股60日涨幅 − 基准60日涨幅`, asOf, sectorIndex ? undefined : '未匹配主线基准'))
    if (e20 !== null && e20 < 0) triggers.push(`20日跑输行业${pctStr(Math.abs(e20))}`)
    if (e60 !== null && e60 < 0) triggers.push(`60日跑输行业${pctStr(Math.abs(e60))}`)

    // ③ 相对大盘
    const em20 = excess(bars, marketBars, 20)
    metrics.push(obs('20日相对大盘超额', em20, pctStr(em20), '创业板指 sz399006',
      '个股20日涨幅 − 创业板指20日涨幅', asOf, marketBars ? undefined : '大盘K线缺失'))
    if (em20 !== null && em20 < 0) triggers.push(`20日跑输大盘${pctStr(Math.abs(em20))}`)

    // ④ 成交量结构
    const udv = upDownVolumeRatio(bars)
    metrics.push(obs('涨跌量比', udv, udv === null ? '缺失' : udv.toFixed(2), '腾讯日K',
      '近20日上涨日均量 ÷ 下跌日均量，>1为上涨放量', asOf, udv === null ? '窗口内无涨跌日' : undefined))
    if (udv !== null && udv < 1) triggers.push(`下跌放量（涨跌量比${udv.toFixed(2)}）`)

    // ⑤ 新高/新低
    const ext = newExtreme(bars, 60)
    metrics.push(obs('60日新高/新低', ext === null ? null : ext.newHigh ? 1 : ext.newLow ? -1 : 0,
      ext === null ? '缺失' : ext.newHigh ? '创新高' : ext.newLow ? '创新低' : '区间内',
      '腾讯日K', '收盘 vs 近60日最高/最低', asOf, ext === null ? 'K线不足60根' : undefined))
    if (ext?.newLow) triggers.push('创60日新低')

    // ⑥ 估值分位
    const v = valuationByCode?.[p.code]
    metrics.push({
      label: 'PE历史分位', value: v?.percentile3y ?? null,
      display: v?.usable && v.percentile3y !== null ? `${(v.percentile3y * 100).toFixed(0)}%` : '不可用',
      source: '东方财富RPT_LICO_FN_CPD + 腾讯未复权日K',
      formula: v?.note ?? '未生成，先跑 npm run msr:valuation',
      asOf,
      // 估值分位本身是账务事实推导的（利润与价格），非预测
      tier: 'ACCOUNTING',
      missingReason: v?.usable ? undefined : (v?.note ?? '估值数据缺失'),
    })
    if (v?.usable && v.percentile3y !== null && v.percentile3y > 0.8) {
      triggers.push(`PE历史分位${(v.percentile3y * 100).toFixed(0)}%（>80%）`)
    }

    const breach = breachByCode.get(p.code)
    rows.push({
      code: p.code, name: p.name,
      reviewTriggers: triggers,
      legalReason: breach
        ? `仓位${pctStr(breach.currentPct)} > 上限${pctStr(breach.limitPct)}，超出${((breach.currentPct - breach.limitPct) * 100).toFixed(1)}pct`
        : null,
      metrics,
      triggerCount: triggers.length,
    })
  }

  rows.sort((a, b) => b.triggerCount - a.triggerCount)

  const answerRows: AnswerRow[] = rows.map(r => {
    // 灯色只反映"需要复核的强度"，不反映"该不该卖"
    const light: Light = r.triggerCount >= 4 ? 'YELLOW' : r.triggerCount >= 2 ? 'YELLOW' : 'GREEN'
    return {
      label: r.name,
      status: r.triggerCount === 0 ? '无复核触发项' : `${r.triggerCount}项触发复核`,
      light,
      // 关键一行：观察项与法定理由并列，且明写"当前减仓理由仍然是X"
      decision: r.legalReason
        ? `复核（观察项${r.triggerCount}项）。当前减仓理由仍然是：${r.legalReason}`
        : r.triggerCount > 0
          ? '仅复核，无法定减仓理由 → 不动作'
          : '持有',
      metrics: r.metrics,
      reviewTriggers: r.reviewTriggers,
    }
  })

  const withTriggers = rows.filter(r => r.triggerCount > 0)
  const withLegal = rows.filter(r => r.legalReason !== null)
  const light: Light = withTriggers.length > 0 ? 'YELLOW' : 'GREEN'

  const headline =
    rows.length === 0
      ? '无持仓'
      : `${withTriggers.length}只触发复核（观察项，不构成减仓理由）；` +
        `其中${withLegal.length}只同时存在法定减仓理由` +
        (withLegal.length ? `：${withLegal.map(r => r.name).join('、')}` : '')

  return {
    answer: { no: 2, question: '我手里的股票，谁正在失去势能？', light, headline, metrics: [], rows: answerRows },
    rows,
  }
}
