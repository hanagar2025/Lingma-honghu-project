// PE-TTM 历史分位 —— 补齐 MSR 估值维度（此前 28 只标的估值分全部为 0，S3 硬阻断）
//
// 为什么必须自己算，不能取现成的"PE分位"：
//   现成分位普遍不披露口径（用的静态PE还是TTM？分位窗口多长？是否点位对齐？），
//   而 CTC 证据标准要求判据可复核。自算的每一步都可追溯到公告日与收盘价。
//
// 无未来函数的关键：使用财报的 **NOTICE_DATE（公告日）** 而非 REPORTDATE（报告期）。
//   2025年报的 REPORTDATE 是 2025-12-31，但公告日是 2026-03-31。
//   若按报告期对齐，2026年1月的PE会用上三个月后才公布的利润 —— 这正是最常见的回测作弊。
//
// 价格必须用**未复权**收盘价：
//   财报EPS是当期实际股本下的as-reported值，前复权价格已按分红送股回调，二者混用会系统性压低历史PE。
//   腾讯接口最后一个参数留空即为未复权（qfq 为前复权）。

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { DailyBar } from '../tios/types'

/** 生成物路径。放在本纯模块内，避免消费方从 scan.ts 导入而触发其顶层 main() */
export const VALUATION_FILE = join(dirname(fileURLToPath(import.meta.url)), 'data', 'valuation.json')

/** 单期财报（只保留估值与盈利验证需要的字段） */
export interface FinancialReport {
  /** 报告期，如 2025-12-31 */
  reportDate: string
  /** 公告日 —— 点位对齐的唯一依据 */
  noticeDate: string
  /** 基本每股收益（年初至今累计值） */
  basicEps: number | null
  /** 扣非每股收益。仅年报/半年报披露，且实测存在异常值，使用前须核验 */
  deductEps: number | null
  /** 营业总收入（累计） */
  revenue: number | null
  /** 归母净利润（累计） */
  netProfit: number | null
  /** 季度标签 Q1/Q2/Q3/Q4 */
  quarter: 1 | 2 | 3 | 4
  year: number
}

export interface PeTtmPoint {
  date: string
  close: number
  /** 该日可见的最新TTM每股收益 */
  ttmEps: number
  /** null 表示 TTM 亏损或数据缺失，此时不计入分位 */
  pe: number | null
  /** 该PE来自哪一期财报的公告 */
  basedOn: string
}

export interface ValuationResult {
  code: string
  name: string
  /** 最新PE-TTM */
  peTtm: number | null
  /** 近3年（750个交易日）历史分位，0~1。数据不足3年则用全部可用历史并置 window 标记 */
  percentile3y: number | null
  /** 全历史分位 */
  percentileAll: number | null
  /** 实际使用的分位窗口交易日数 */
  windowDays: number
  /** 有效PE样本数（剔除亏损期） */
  validSamples: number
  /** 最近一期财报公告日 */
  latestNoticeDate: string | null
  /** 实际用于计算最新PE的那一期财报（可能因TTM算不出而回退到更早一期） */
  basedOn: string | null
  /**
   * 该分位是否可用于闸门判定。false 的三种情形：
   * TTM亏损、有效样本不足、PE极端（>500，TTM利润接近0时分位无经济含义）
   */
  usable: boolean
  /** 数据可用性说明，供报告直接引用 */
  note: string
}

/** PE 超过此值视为 TTM 利润接近零，分位无经济含义 */
export const PE_SANITY_CEILING = 500

/** 供 MSR 注入的精简形态 */
export interface ValuationInjection {
  peTtm: number | null
  percentile3y: number | null
  usable: boolean
  note: string
}

/**
 * 读取 msr:valuation 生成的数据文件。找不到文件时返回空表 ——
 * 此时估值维度记 0 且阻断 S3，与"没有数据就不许买"的既有语义一致，不静默放行。
 */
export function loadValuationMap(filePath: string): Record<string, ValuationInjection> {
  try {
    // 动态 require 避免打包期强依赖生成物
    const raw = readFileSync(filePath, 'utf8')
    const parsed = JSON.parse(raw) as { items?: Record<string, ValuationResult> }
    const out: Record<string, ValuationInjection> = {}
    for (const [code, v] of Object.entries(parsed.items ?? {})) {
      out[code] = { peTtm: v.peTtm, percentile3y: v.percentile3y, usable: v.usable, note: v.note }
    }
    return out
  } catch {
    return {}
  }
}

/**
 * 由累计EPS推TTM。A股财报是年初至今累计，故：
 *   Q4：TTM = 本年Q4累计
 *   Q1/Q2/Q3：TTM = 上年年报 + 本年累计 - 上年同期累计
 * 缺任一项则返回 null（宁缺勿估）。
 */
export function computeTtmEps(reports: FinancialReport[], idx: number): number | null {
  const r = reports[idx]
  if (r.basicEps === null) return null
  if (r.quarter === 4) return r.basicEps

  const prevAnnual = reports.find(x => x.year === r.year - 1 && x.quarter === 4)
  const prevSame = reports.find(x => x.year === r.year - 1 && x.quarter === r.quarter)
  if (!prevAnnual?.basicEps || !prevSame || prevSame.basicEps === null) return null
  return prevAnnual.basicEps + r.basicEps - prevSame.basicEps
}

/**
 * 构建逐日 PE-TTM 序列。
 * @param bars 未复权日K（升序）
 * @param reports 财报（任意顺序，内部按公告日排序）
 */
export function buildPeTtmSeries(bars: DailyBar[], reports: FinancialReport[]): PeTtmPoint[] {
  const sorted = [...reports]
    .filter(r => r.noticeDate)
    .sort((a, b) => a.noticeDate.localeCompare(b.noticeDate))

  // 预算每期财报公告时点可见的TTM
  const ttmByNotice = sorted.map((r, i) => ({
    noticeDate: r.noticeDate,
    reportDate: r.reportDate,
    // 注意：computeTtmEps 需要在**全部**报告里找上年同期，而非仅已公告部分。
    // 这不构成未来函数 —— 上年同期数据在本期公告时早已披露。
    ttm: computeTtmEps(reports, reports.indexOf(r)),
  }))

  const out: PeTtmPoint[] = []
  let cursor = -1
  for (const bar of bars) {
    // 推进到最后一个公告日 <= 当前交易日的财报
    while (cursor + 1 < ttmByNotice.length && ttmByNotice[cursor + 1].noticeDate <= bar.date) cursor++
    if (cursor < 0) continue
    // 若最新一期TTM算不出来，回退到上一期能算出的
    let use = cursor
    while (use >= 0 && ttmByNotice[use].ttm === null) use--
    if (use < 0) continue
    const ttm = ttmByNotice[use].ttm as number
    out.push({
      date: bar.date,
      close: bar.close,
      ttmEps: ttm,
      pe: ttm > 0 ? bar.close / ttm : null,
      basedOn: `${ttmByNotice[use].reportDate}(公告${ttmByNotice[use].noticeDate})`,
    })
  }
  return out
}

/**
 * 分位：当前PE在窗口内的排名位置。0=最便宜，1=最贵。
 *
 * 硬约束：**最新一日PE为空（TTM亏损）时必须返回 null**，不得退而用窗口内最后一个有效PE。
 * 否则会拿一个陈旧的PE去和历史比，得出"当前95%分位"这种既无意义又危险的读数
 * （英维克首次生成时即触发此错，TTM每股收益 -0.02 却输出 95% 分位）。
 */
export function pePercentile(series: PeTtmPoint[], windowDays: number): number | null {
  if (!series.length) return null
  const latest = series[series.length - 1]
  if (latest.pe === null) return null
  const win = series.slice(-windowDays).map(p => p.pe).filter((x): x is number => x !== null)
  if (win.length < 60) return null
  const below = win.filter(x => x < latest.pe!).length
  return below / win.length
}

export function summarizeValuation(
  code: string, name: string, bars: DailyBar[], reports: FinancialReport[]
): ValuationResult {
  const series = buildPeTtmSeries(bars, reports)
  const valid = series.filter(p => p.pe !== null)
  const p3 = pePercentile(series, 750)
  const pAll = pePercentile(series, series.length)
  const latest = series.length ? series[series.length - 1] : null
  const latestNotice = reports.length
    ? [...reports].sort((a, b) => (b.noticeDate || '').localeCompare(a.noticeDate || ''))[0].noticeDate
    : null

  const pe = latest?.pe ?? null
  const extreme = pe !== null && pe > PE_SANITY_CEILING
  const usable = pe !== null && !extreme && (p3 !== null || pAll !== null)

  let note: string
  if (!series.length) note = '无可用财报或价格数据'
  else if (pe === null) note = `TTM每股收益${latest!.ttmEps.toFixed(2)}（亏损或为零）→ PE无意义，分位不可用`
  else if (extreme) note = `PE ${pe.toFixed(0)} 超过${PE_SANITY_CEILING}，TTM利润接近零 → 分位无经济含义，不可用于闸门`
  else if (p3 === null && pAll === null) note = `有效PE样本仅${valid.length}个，不足60个 → 分位不可用`
  else if (p3 === null) note = `不足3年数据，改用全历史${valid.length}个样本`
  else note = `基于${valid.length}个有效PE样本，取数自${latest?.basedOn ?? ''}`

  return {
    code, name,
    peTtm: pe,
    percentile3y: p3,
    percentileAll: pAll,
    windowDays: Math.min(750, series.length),
    validSamples: valid.length,
    latestNoticeDate: latestNotice,
    basedOn: latest?.basedOn ?? null,
    usable,
    note,
  }
}
