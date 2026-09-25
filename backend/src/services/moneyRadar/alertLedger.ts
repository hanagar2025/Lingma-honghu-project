/**
 * 资金驾驶舱（R-01）· 提醒台账与数据异常计数
 *
 * 提醒台账只增不改：每次收盘定稿运行，把当日的提醒生命周期事件（新增 / 升级 / 降级 / 解除）
 * 追加进去，日后回头审问"这条提醒之后发生了什么"。
 *
 * 数据异常：同一类数据在不同交易日连续失败达到门槛，出"数据异常"卡片。
 * 同一交易日重复失败只算一次。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ALERT_RULES, TYPE_LABEL, type AlertEvent, type AlertLevel, type AlertType, type AlertsView, type Lifecycle } from './alerts'
import type { DataSet } from './types'

const HERE = dirname(fileURLToPath(import.meta.url))
export const ALERT_LEDGER_FILE = process.env.MONEY_ALERT_LEDGER_FILE ?? join(HERE, 'data', 'alert-ledger.json')

export interface AlertLedger {
  startedOn: string
  rulesHash: string
  events: { date: string; key: string; objectId: string; name: string; type: AlertType; event: AlertEvent; level: AlertLevel }[]
  sourceFailures: Record<string, { lastDate: string; consecutive: number }>
}

export function loadAlertLedger(file = ALERT_LEDGER_FILE): AlertLedger | null {
  if (!existsSync(file)) return null
  try { return JSON.parse(readFileSync(file, 'utf-8')) as AlertLedger } catch { return null }
}

export function saveAlertLedger(l: AlertLedger, file = ALERT_LEDGER_FILE): void {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify(l, null, 1)}\n`, 'utf-8')
}

export function emptyLedger(startedOn: string, rulesHash: string): AlertLedger {
  return { startedOn, rulesHash, events: [], sourceFailures: {} }
}

/** 追加生命周期事件：只记 startedOn 当天及以后，同一 (日期, 提醒, 事件) 只记一次 */
export function appendEvents(l: AlertLedger, life: Lifecycle, names: Map<string, string>): AlertLedger {
  const seen = new Set(l.events.map(e => `${e.date}|${e.key}|${e.event}`))
  for (const e of life.events) {
    if (e.date < l.startedOn) continue
    const k = `${e.date}|${e.key}|${e.event}`
    if (seen.has(k)) continue
    seen.add(k)
    l.events.push({ ...e, name: names.get(e.objectId) ?? e.objectId })
  }
  l.events.sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key))
  return l
}

const KIND_TEXT: Record<string, string> = {
  MARKET_AMOUNT: '两市成交额', SW_INDUSTRY: '申万行业成分', STOCK_AMOUNT: '个股成交额',
  MARGIN: '融资余额', TOP_INST: '龙虎榜机构', ETF_SHARE: 'ETF 份额',
}

/**
 * 更新各类数据的连续失败计数并给出异常清单。
 * PENDING（按发布时间还没到）不算失败；MISSING 与个股抓取失败率超过 5% 算失败。
 */
export function updateFailures(
  l: AlertLedger, provenance: DataSet['provenance'], date: string, stockFailRatio: number,
): AlertsView['anomalies'] {
  const failing = new Set(provenance.filter(p => p.status === 'MISSING').map(p => p.kind as string))
  if (stockFailRatio > 0.05) failing.add('STOCK_AMOUNT')
  const kinds = new Set([...Object.keys(l.sourceFailures), ...provenance.map(p => p.kind as string), 'STOCK_AMOUNT'])
  for (const k of kinds) {
    const cur = l.sourceFailures[k] ?? { lastDate: '', consecutive: 0 }
    if (failing.has(k)) {
      if (cur.lastDate !== date) l.sourceFailures[k] = { lastDate: date, consecutive: cur.consecutive + 1 }
    } else {
      l.sourceFailures[k] = { lastDate: date, consecutive: 0 }
    }
  }
  return Object.entries(l.sourceFailures)
    .filter(([, v]) => v.consecutive >= ALERT_RULES.anomalyAfterFailures)
    .map(([kind, v]) => ({
      kind, failures: v.consecutive,
      text: `${KIND_TEXT[kind] ?? kind}已连续 ${v.consecutive} 个交易日取数失败，相关对象的状态与提醒可能不完整`,
    }))
}

/** 台账摘要里用的一行 */
export function ledgerLine(e: AlertLedger['events'][number]): string {
  const ev = ({ NEW: '新增', UP: '升级', DOWN: '降级', CONTINUE: '持续', RESOLVED: '解除' } as const)[e.event]
  return `${e.date} ${e.name} ${TYPE_LABEL[e.type]} ${ev}`
}
