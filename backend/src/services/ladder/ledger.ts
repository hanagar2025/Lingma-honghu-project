/**
 * 名单治理（L-01）· 留痕台账
 *
 * 每次进入、升级、降级、移出都记一行：日期、原层级、新层级、触发规则、证据来源、审批人。
 * 台账只增不改。层级由规则计算得出时审批人记「规则计算」；
 * 观察期满的续留 / 降级 / 移出由委员会决定，记在 decisions.json，审批人照录。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { REVIEW_ACTION_TEXT, type ReviewDecision } from './registry'
import { LEVEL_NAME, type LadderLevel, type LadderView } from './types'

const DATA = new URL('./data/', import.meta.url)
export const LADDER_LEDGER_FILE = fileURLToPath(new URL('ladder-ledger.json', DATA))
export const DECISIONS_FILE = fileURLToPath(new URL('decisions.json', DATA))

export type LadderEventKind = 'ENTER' | 'UP' | 'DOWN' | 'EXIT' | 'REVIEW'

export interface LadderEvent {
  date: string
  code: string
  name: string
  kind: LadderEventKind
  from: LadderLevel | null
  to: LadderLevel | null
  rule: string
  sources: string[]
  approver: string
}

export interface LadderLedger {
  id: 'L-01'
  startedOn: string
  events: LadderEvent[]
}

export function loadLadderLedger(file = LADDER_LEDGER_FILE): LadderLedger | null {
  if (!existsSync(file)) return null
  return JSON.parse(readFileSync(file, 'utf-8')) as LadderLedger
}

export function saveLadderLedger(l: LadderLedger, file = LADDER_LEDGER_FILE): void {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify(l, null, 1)}\n`, 'utf-8')
}

export function loadDecisions(file = DECISIONS_FILE): ReviewDecision[] {
  if (!existsSync(file)) return []
  return JSON.parse(readFileSync(file, 'utf-8')) as ReviewDecision[]
}

/** 每只股票在台账里的最近层级 */
export function lastLevels(l: LadderLedger): Map<string, LadderLevel | null> {
  const m = new Map<string, LadderLevel | null>()
  for (const e of l.events) if (e.kind !== 'REVIEW') m.set(e.code, e.to)
  return m
}

/**
 * 把本次计算结果与台账比对，追加变化。同一天重跑不会重复记：
 * 只有层级与台账最近一次不同才记；委员会决定按 (日期, 代码, 动作) 去重。
 */
export function appendLadderEvents(
  prev: LadderLedger | null, view: LadderView, decisions: readonly ReviewDecision[],
): { ledger: LadderLedger; added: LadderEvent[] } {
  const ledger: LadderLedger = prev ?? { id: 'L-01', startedOn: view.asOf, events: [] }
  const last = lastLevels(ledger)
  const added: LadderEvent[] = []

  const seenReview = new Set(ledger.events.filter(e => e.kind === 'REVIEW').map(e => `${e.date}|${e.code}|${e.rule}`))
  for (const d of decisions) {
    const rule = `${REVIEW_ACTION_TEXT[d.action]}：${d.note}`
    const key = `${d.date}|${d.code}|${rule}`
    if (seenReview.has(key)) continue
    seenReview.add(key)
    added.push({ date: d.date, code: d.code, name: view.entries.find(e => e.code === d.code)?.name ?? d.code, kind: 'REVIEW', from: null, to: null, rule, sources: [], approver: d.approver })
  }

  const now = new Map(view.entries.map(e => [e.code, e]))
  for (const e of view.entries) {
    const before = last.has(e.code) ? last.get(e.code)! : null
    if (before === e.level) continue
    const kind: LadderEventKind = before === null ? 'ENTER' : e.level > before ? 'UP' : 'DOWN'
    added.push({
      date: view.asOf, code: e.code, name: e.name, kind, from: before, to: e.level,
      rule: e.entryReason + (e.ceiling ? `；停在${LEVEL_NAME[e.level]}：${e.ceiling}` : ''),
      sources: e.sources.map(t => `${t.source}${t.group ? `·${t.group}` : ''}（${t.since}，${t.by}）`),
      approver: '规则计算',
    })
  }
  for (const [code, lv] of last) {
    if (lv === null || now.has(code)) continue
    const name = [...ledger.events].reverse().find(e => e.code === code)?.name ?? code
    added.push({ date: view.asOf, code, name, kind: 'EXIT', from: lv, to: null, rule: '所有来源均已移除', sources: [], approver: '规则计算' })
  }
  ledger.events.push(...added)
  return { ledger, added }
}
