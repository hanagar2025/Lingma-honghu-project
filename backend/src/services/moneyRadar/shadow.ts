/**
 * 资金驾驶舱（R-01）· 影子运行台账
 *
 * 阈值冻结之后，每次盘后运行把当日的状态跃迁与背离新触发记进台账；
 * 到期后回填第 20 / 60 个交易日相对两市基准的超额收益。
 *
 * 台账只增不改：已记录的事件不因后来的数据重算而删改，
 * 回填只写入原来为空的结果字段。台账入库，是规则日后能否升级的原始凭据。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { THRESHOLDS } from './config'
import { HORIZONS, RULE_HYPOTHESIS, excessReturn, type EvalObject, type RuleId } from './backtest'
import { KLINE_FINAL_HHMM, beijingClock } from './fetch'
import type { DataSet, EntryNo } from './types'

const HERE = dirname(fileURLToPath(import.meta.url))
export const SHADOW_FILE = process.env.MONEY_SHADOW_FILE ?? join(HERE, 'data', 'shadow-ledger.json')

export interface ShadowEvent {
  key: string
  date: string
  rule: RuleId
  objectId: string
  name: string
  entry: EntryNo | null
  kind: EvalObject['kind']
  /** 记录时的状态说明，便于事后审问 */
  state: string
  h20: number | null
  h60: number | null
}

export interface ShadowLedger {
  startedOn: string
  thresholdsHash: string
  events: ShadowEvent[]
}

/**
 * 最新 K 线是北京时间今天，且还没到 16:30 → 当日数据未定稿，不记台账。
 * 科创板盘后固定价格交易到 15:30，15:10 那次运行时当日成交额还不完整。
 */
export function isIntraday(latestDate: string, now = new Date()): boolean {
  const { date, hhmm } = beijingClock(now)
  return latestDate === date && hhmm < KLINE_FINAL_HHMM
}

export function loadLedger(file = SHADOW_FILE): ShadowLedger | null {
  if (!existsSync(file)) return null
  try { return JSON.parse(readFileSync(file, 'utf-8')) as ShadowLedger } catch { return null }
}

export function saveLedger(l: ShadowLedger, file = SHADOW_FILE): void {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify(l, null, 1)}\n`, 'utf-8')
}

/** 某个交易日发生的规则事件 */
export function eventsOn(objs: readonly EvalObject[], t: number): { rule: RuleId; o: EvalObject; state: string }[] {
  const out: { rule: RuleId; o: EvalObject; state: string }[] = []
  for (const o of objs) {
    for (const tr of o.transitions) {
      if (tr.t !== t || tr.from === 'NO_BASELINE') continue
      const rule: RuleId | null = tr.failed ? 'FAILED_START'
        : tr.to === 'START' || tr.to === 'TREND' || tr.to === 'BURST' || tr.to === 'EXHAUST' || tr.to === 'RETREAT' ? tr.to : null
      if (rule) out.push({ rule, o, state: `${tr.from}→${tr.to}：${tr.reason}` })
    }
    if (t > 0 && o.divergence[t] && !o.divergence[t - 1]) out.push({ rule: 'DIVERGENCE', o, state: '高位背离四项全满足' })
  }
  return out
}

/**
 * 记录当日事件并回填到期结果。
 * 只记录冻结之后（startedOn 当天及以后）的交易日；冻结之前的历史属于样本外检验，不进台账。
 */
export function updateLedger(
  ledger: ShadowLedger | null, objs: readonly EvalObject[], ds: DataSet, startedOn: string, hash: string,
): ShadowLedger {
  const l: ShadowLedger = ledger ?? { startedOn, thresholdsHash: hash, events: [] }
  const seen = new Set(l.events.map(e => e.key))
  const idx = new Map(ds.dates.map((d, i) => [d, i]))

  for (let t = 0; t < ds.dates.length; t++) {
    const date = ds.dates[t]!
    if (date < l.startedOn) continue
    for (const e of eventsOn(objs, t)) {
      const key = `${date}|${e.o.id}|${e.rule}`
      if (seen.has(key)) continue
      seen.add(key)
      l.events.push({
        key, date, rule: e.rule, objectId: e.o.id, name: e.o.name, entry: e.o.entry, kind: e.o.kind,
        state: e.state, h20: null, h60: null,
      })
    }
  }

  const bench = ds.market.map(d => d.close ?? null)
  const byId = new Map(objs.map(o => [o.id, o]))
  for (const e of l.events) {
    const t = idx.get(e.date)
    const o = byId.get(e.objectId)
    if (t === undefined || !o) continue
    for (const h of HORIZONS) {
      const k = h === 20 ? 'h20' : 'h60'
      if (e[k] !== null) continue
      const v = excessReturn(o.close, bench, t, h)
      if (v !== null) e[k] = v
    }
  }
  l.events.sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key))
  return l
}

export interface ShadowSummaryRow {
  rule: RuleId
  hypothesis: string
  count: number
  toVerdict: number
  filled20: number
  mean20: number | null
  filled60: number
  mean60: number | null
}

export interface ShadowSummary {
  startedOn: string
  thresholdsHash: string
  total: number
  rows: ShadowSummaryRow[]
  latest: ShadowEvent[]
}

export function summarize(l: ShadowLedger): ShadowSummary {
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
  const rows = (Object.keys(RULE_HYPOTHESIS) as RuleId[]).map(rule => {
    const ev = l.events.filter(e => e.rule === rule)
    const f20 = ev.map(e => e.h20).filter((v): v is number => v !== null)
    const f60 = ev.map(e => e.h60).filter((v): v is number => v !== null)
    return {
      rule, hypothesis: RULE_HYPOTHESIS[rule].text, count: ev.length,
      toVerdict: Math.max(0, THRESHOLDS.minTriggersForVerdict - f20.length),
      filled20: f20.length, mean20: mean(f20), filled60: f60.length, mean60: mean(f60),
    }
  })
  const own = l.events.filter(e => e.entry === 1 || e.entry === 2)
  const latest = [...own.slice(-8), ...l.events.filter(e => e.entry === 3).slice(-8)]
    .sort((a, b) => b.date.localeCompare(a.date)).slice(0, 12)
  return { startedOn: l.startedOn, thresholdsHash: l.thresholdsHash, total: l.events.length, rows, latest }
}
