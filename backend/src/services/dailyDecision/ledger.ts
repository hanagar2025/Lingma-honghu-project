/**
 * 账本：只记股数、现金和峰值。市值永远由价格 × 股数现算。
 *
 * 路径由环境变量 PORTFOLIO 指定时，账本可以放在仓库之外的私有位置；
 * 未指定时沿用仓库内的旧位置，保持现有流程不变。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
export const DEFAULT_LEDGER_FILE = join(HERE, '..', 'cockpit', 'data', 'portfolio.json')

export interface LedgerPosition {
  code: string
  name: string
  quantity: number
  /** 每股成本。只在取不到价格时用来估市值 */
  cost?: number
}

export interface LedgerFile {
  /** 账本快照日。股数与现金记于这一天 */
  asOf?: string
  cash: number
  /** 账户外、专用于股票投资的现金。10/10 裁定后为 0 */
  externalCash?: number | null
  peakAssets: number
  /** 峰值所属口径。BROKER 表示尚未按组合口径认定，回撤输出"不可比" */
  peakBasis?: 'BROKER' | 'PORTFOLIO'
  /** false = 峰值待券商记录与资金流水核实；缺省视为已核实 */
  peakVerified?: boolean
  positions: LedgerPosition[]
}

export function ledgerFile(): string {
  return process.env.PORTFOLIO ?? DEFAULT_LEDGER_FILE
}

export function loadLedger(file = ledgerFile()): LedgerFile {
  return JSON.parse(readFileSync(file, 'utf-8')) as LedgerFile
}

export function beijingToday(now = new Date()): string {
  return new Date(now.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10)
}

export function daysBehind(date: string | null | undefined, today = beijingToday()): number | null {
  if (!date) return null
  const a = Date.parse(`${today}T00:00:00Z`)
  const b = Date.parse(`${date}T00:00:00Z`)
  if (Number.isNaN(a) || Number.isNaN(b)) return null
  return Math.round((a - b) / 86400000)
}

/** 账本可以落后几天而不影响判定。取 5 天是为了跨过周末与小长假不误报 */
export const ACCOUNT_STALE_LIMIT_DAYS = 5

export interface AccountFreshness {
  stale: boolean
  /** 落后天数。null = 账本没记日期，时点不可知 */
  staleDays: number | null
  gaps: string[]
}

/** 只把落差说出来。不猜差额，也不按券商页面反推股数 */
export function accountFreshness(asOf: string | null | undefined, today?: string): AccountFreshness {
  const date = asOf ?? null
  const staleDays = daysBehind(date, today ?? beijingToday())
  if (date === null || staleDays === null) {
    return { stale: true, staleDays: null, gaps: ['账本快照缺 asOf → 股数与现金时点不可知，仓位/熔断/超限判定不可确认'] }
  }
  if (staleDays <= ACCOUNT_STALE_LIMIT_DAYS) return { stale: false, staleDays, gaps: [] }
  return {
    stale: true,
    staleDays,
    gaps: [
      `账本快照 ${date} 落后 ${staleDays} 天 → 股数与现金可能已变动，`
      + '仓位/熔断/超限判定须按"账本可能过期"读，不得当成当日资本事实',
    ],
  }
}
