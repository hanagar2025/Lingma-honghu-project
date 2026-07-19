// TIOS 编排服务 —— 把数据库状态装配成引擎输入，运行盘前四问并留痕
// 闭环：①同步真实K线 → ②装配持仓/规则卡/账户快照 → ③生成决策报告入库 → ④执行记录与执行率反馈

import { getConnection } from '../config/database'
import { logger } from '../utils/logger'
import { generateDailyReport } from './tios/dailyReport'
import type { AccountSnapshot, DailyBar, DailyReport, MarketStage, Position, RuleCard } from './tios/types'
import { getBarsFromDB, syncDailyBars } from './marketData'

/** 阶段判定基准指数（默认科创50），可用 TIOS_INDEX_CODE 覆盖，如 sh000001 / sz399006 */
export const STAGE_INDEX_CODE = process.env.TIOS_INDEX_CODE || 'sh000688'

interface PositionRow {
  id: string
  stock_code: string
  stock_name: string
  sector: string
  theme: string
  quantity: number
  cost_price: string
  market_value: string
}

interface RuleCardRow {
  stock_code: string
  hard_stop_pct: string
  crash_pct: string
  ban_buy: number
  ban_reason: string | null
  pending_crash_executions: number
}

async function loadPositionRows(userId: string): Promise<PositionRow[]> {
  const conn = getConnection()
  const [rows] = await conn.execute(
    'SELECT id, stock_code, stock_name, sector, theme, quantity, cost_price, market_value FROM positions WHERE user_id = ?',
    [userId]
  )
  return rows as PositionRow[]
}

export async function loadPositions(userId: string): Promise<Position[]> {
  return (await loadPositionRows(userId)).map(toPosition)
}

function toPosition(r: PositionRow): Position {
  return {
    code: r.stock_code,
    name: r.stock_name,
    sector: r.sector,
    theme: r.theme,
    cost: Number(r.cost_price),
    marketValue: Number(r.market_value),
  }
}

/** 用最新收盘价刷新持仓市值（同步K线后调用），保证仓位闸门与组合快照基于真实价格 */
async function refreshPositionPrices(rows: PositionRow[], barsByCode: Record<string, DailyBar[]>): Promise<void> {
  const conn = getConnection()
  for (const r of rows) {
    const bars = barsByCode[r.stock_code]
    const last = bars?.[bars.length - 1]
    if (!last) continue
    const quantity = Number(r.quantity)
    const cost = Number(r.cost_price)
    const marketValue = quantity * last.close
    const profitLoss = marketValue - quantity * cost
    const profitLossRate = cost > 0 ? (profitLoss / (quantity * cost)) * 100 : 0
    await conn.execute(
      'UPDATE positions SET current_price = ?, market_value = ?, profit_loss = ?, profit_loss_rate = ? WHERE id = ?',
      [last.close, marketValue, profitLoss, profitLossRate, r.id]
    )
    r.market_value = String(marketValue)
  }
}

/** 加载规则卡；持仓中没有卡的股票自动建默认卡（硬止损25%、单日熔断12%） */
export async function loadRuleCards(userId: string, codes: string[]): Promise<Record<string, RuleCard>> {
  const conn = getConnection()
  const [rows] = await conn.execute('SELECT * FROM rule_cards WHERE user_id = ?', [userId])
  const cards: Record<string, RuleCard> = {}
  for (const r of rows as RuleCardRow[]) {
    cards[r.stock_code] = {
      code: r.stock_code,
      hardStopPct: Number(r.hard_stop_pct),
      crashPct: Number(r.crash_pct),
      banBuy: r.ban_buy === 1,
      banReason: r.ban_reason ?? undefined,
      pendingCrashExecutions: r.pending_crash_executions,
    }
  }
  for (const code of codes) {
    if (!cards[code]) {
      await conn.execute(
        'INSERT IGNORE INTO rule_cards (user_id, stock_code) VALUES (?, ?)',
        [userId, code]
      )
      cards[code] = { code, hardStopPct: 0.25, crashPct: 0.12, banBuy: false, pendingCrashExecutions: 0 }
    }
  }
  return cards
}

/** 装配账户快照：总资产=现金+持仓市值；净值创新高时自动抬升峰值 */
export async function buildSnapshot(userId: string, date: string, positions: Position[]): Promise<AccountSnapshot> {
  const conn = getConnection()
  const [rows] = await conn.execute('SELECT cash, peak_assets FROM account_state WHERE user_id = ?', [userId])
  let cash = 0
  let peak = 0
  const arr = rows as { cash: string; peak_assets: string }[]
  if (arr.length > 0) {
    cash = Number(arr[0].cash)
    peak = Number(arr[0].peak_assets)
  } else {
    await conn.execute('INSERT INTO account_state (user_id) VALUES (?)', [userId])
  }
  const positionsValue = positions.reduce((s, p) => s + p.marketValue, 0)
  const totalAssets = cash + positionsValue
  if (totalAssets > peak) {
    peak = totalAssets
    await conn.execute('UPDATE account_state SET peak_assets = ? WHERE user_id = ?', [peak, userId])
  }
  return { date, totalAssets, cash, positionsValue, peakAssets: peak }
}

async function loadPrevConfirmedStage(userId: string): Promise<MarketStage> {
  const conn = getConnection()
  const [rows] = await conn.execute(
    'SELECT confirmed_stage FROM decision_reports WHERE user_id = ? ORDER BY report_date DESC LIMIT 1',
    [userId]
  )
  const arr = rows as { confirmed_stage: string }[]
  const stage = arr[0]?.confirmed_stage
  return stage === 'uptrend' || stage === 'downtrend' ? stage : 'range'
}

export interface RunResult {
  report: DailyReport
  synced: { code: string; saved: number; error?: string }[]
}

/** 一键运行：同步数据 → 刷新持仓市值 → 生成盘前四问 → 报告入库 → 卖出指令写入待执行记录 */
export async function runDailyPipeline(userId: string, opts?: { skipSync?: boolean }): Promise<RunResult> {
  const rows = await loadPositionRows(userId)
  if (rows.length === 0) {
    throw new Error('当前无持仓，请先在持仓管理中录入')
  }
  const codes = rows.map(r => r.stock_code)

  let synced: RunResult['synced'] = []
  if (!opts?.skipSync) {
    synced = await syncDailyBars([...codes, STAGE_INDEX_CODE])
  }

  const indexBars = await getBarsFromDB(STAGE_INDEX_CODE)
  if (indexBars.length < 25) {
    throw new Error(`基准指数 ${STAGE_INDEX_CODE} 的K线不足25根，无法判定市场阶段（请先同步数据）`)
  }
  const barsByCode: Record<string, DailyBar[]> = {}
  for (const code of codes) {
    barsByCode[code] = await getBarsFromDB(code)
  }

  await refreshPositionPrices(rows, barsByCode)
  const positions = rows.map(toPosition)

  const date = indexBars[indexBars.length - 1].date
  const cards = await loadRuleCards(userId, codes)
  const snapshot = await buildSnapshot(userId, date, positions)
  const prevConfirmedStage = await loadPrevConfirmedStage(userId)

  const report = generateDailyReport({ date, indexBars, prevConfirmedStage, snapshot, positions, cards, barsByCode })

  const conn = getConnection()
  await conn.execute(
    `INSERT INTO decision_reports (user_id, report_date, confirmed_stage, conclusion, report_json)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE confirmed_stage=VALUES(confirmed_stage), conclusion=VALUES(conclusion), report_json=VALUES(report_json)`,
    [userId, report.date, report.stage.confirmed, report.conclusion, JSON.stringify(report)]
  )

  // 卖出指令写入执行记录（未执行状态），供盘后回填
  for (const s of report.sells) {
    const [existing] = await conn.execute(
      'SELECT id FROM trade_executions WHERE user_id = ? AND report_date = ? AND stock_code = ? AND clause = ?',
      [userId, report.date, s.code, s.clause]
    )
    if ((existing as unknown[]).length === 0) {
      await conn.execute(
        `INSERT INTO trade_executions (user_id, report_date, stock_code, clause, required_action)
         VALUES (?, ?, ?, ?, ?)`,
        [userId, report.date, s.code, s.clause, s.action]
      )
    }
  }

  logger.info(`盘前四问已生成 user=${userId} date=${report.date} stage=${report.stage.confirmed} sells=${report.sells.length}`)
  return { report, synced }
}

export async function getLatestReport(userId: string): Promise<DailyReport | null> {
  const conn = getConnection()
  const [rows] = await conn.execute(
    'SELECT report_json FROM decision_reports WHERE user_id = ? ORDER BY report_date DESC LIMIT 1',
    [userId]
  )
  const arr = rows as { report_json: string | DailyReport }[]
  if (arr.length === 0) return null
  const raw = arr[0].report_json
  return typeof raw === 'string' ? (JSON.parse(raw) as DailyReport) : raw
}

export async function getReportHistory(userId: string, limit = 30): Promise<{ date: string; stage: string; conclusion: string }[]> {
  const conn = getConnection()
  const [rows] = await conn.execute(
    `SELECT DATE_FORMAT(report_date, '%Y-%m-%d') as date, confirmed_stage as stage, conclusion
     FROM decision_reports WHERE user_id = ? ORDER BY report_date DESC LIMIT ${Math.max(1, Math.min(365, limit))}`,
    [userId]
  )
  return rows as { date: string; stage: string; conclusion: string }[]
}
