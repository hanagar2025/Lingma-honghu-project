/**
 * 资本迁移留痕。
 *
 * 下一阶段不急着决定「几个族才能加仓」，而是先记录当时为什么迁移。
 * 一年以后才可以研究：哪种证据组合后来真的兑现了基本面。
 *
 * 这是鸿鹄自己的投资数据集，不是拿外部指标证明规则。
 *
 * 本文件：
 *   - 不计算收益率
 *   - 不声称回测证明了族数门槛
 *   - 不生产动作
 *   - 不进规则指纹（增加审计，不是新增模型）
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Judged } from './judge'
import type { EvidenceFamily } from './capitalGates'
import type { HunterStage } from './hunter'
import type { CapitalAction, EvidenceTone, Ownership } from './triaxis'
import { RISK_TEXT, type RiskCategory } from './lifecycle'
import { FAMILY_TEXT } from './capitalGates'
import { HUNTER_TEXT } from './hunter'
import { CAPITAL_ACTION_TEXT, EVIDENCE_TONE_TEXT, OWNERSHIP_TEXT } from './triaxis'
import {
  HOLD_AS_DECISION, LEGAL_MOVE_QUESTION, legalMoveOf,
  type CapitalOutcome, type DecisionQuality, type EvidenceOutcome, type LegalMove,
} from './charter'

const HERE = dirname(fileURLToPath(import.meta.url))
export const JOURNAL_DIR = join(HERE, '../governance/data/migrations')

/** 族数门槛是设计规则。禁止对外说「回测证明三族最好」。 */
export const NEVER_CLAIM_BACKTEST_PROVED_FAMILIES = true

/** 决策账本必须具备的字段。缺一格就不能事后审问。 */
export const LEDGER_FIELDS = [
  'date', 'code', 'name', 'from', 'to',
  'ownership', 'evidenceTone', 'newFamilies', 'independenceWhy',
  'unknowns', 'risks', 'exposurePct', 'exposure', 'action',
  'decisionQuality', 'evidenceOutcome', 'capitalOutcome', 'aftermath',
] as const

export interface MigrationRecord {
  date: string
  code: string
  name: string
  from: HunterStage | null
  to: HunterStage
  ownership: Ownership
  evidenceTone: EvidenceTone
  /** 当日新增的独立证据族。INIT/HOLD 必须是空数组，站立族不算新增。 */
  newFamilies: readonly EvidenceFamily[]
  /** 为什么这些族算独立；没有新族时写明维持是主动决策。 */
  independenceWhy: string
  unknowns: readonly string[]
  risks: readonly RiskCategory[]
  /** 当时组合暴露。用比例，不用仓位评分。 */
  exposurePct: number | null
  exposure: '超限' | '正常' | '未知'
  action: CapitalAction
  triggerFamilies: readonly EvidenceFamily[]
  blockers: readonly string[]
  why: string
  r4: string
  legalMove: LegalMove | null
  legalQuestion: string | null
  /**
   * 当时的信息条件下，动作是否符合规则。
   * 后来涨跌不得改写这一格。
   */
  decisionQuality: DecisionQuality
  /**
   * 后来事实有没有兑现。当日只能是 PENDING。
   * 价格不能填这一格。
   */
  evidenceOutcome: EvidenceOutcome
  /**
   * 资本结果。存在，但不得用来判断系统好坏。
   */
  capitalOutcome: CapitalOutcome
  /** 事后发生了什么。当日为空，只允许回填这一格与 Evidence Outcome。 */
  aftermath: string
  /** 恒为 true。本档案不是收益归因。 */
  notAReturnClaim: true
}

function newFamiliesOf(j: Judged): EvidenceFamily[] {
  if (j.migration.direction === 'INIT' || j.migration.direction === 'HOLD') return []
  if (
    j.capitalAction === 'HOLD_CAPITAL'
    || j.capitalAction === 'OBSERVE'
    || j.capitalAction === 'REDUCE_EXPOSURE'
    || j.capitalAction === 'EXIT'
  ) return []
  const kind = j.migration.capitalReason.kind
  if (kind === 'ENTRY' || kind === 'ADD' || kind === 'TOP_UP') {
    return [...j.migration.capitalReason.families]
  }
  return []
}

function independenceWhyOf(j: Judged, families: readonly EvidenceFamily[]): string {
  if (families.length === 0) {
    if (j.capitalAction === 'REDUCE_EXPOSURE') {
      return '当日没有新的独立证据族。动作来自组合硬约束，不是证据变化，更不是涨跌。'
    }
    if (j.capitalAction === 'EXIT') {
      return '当日没有新的独立证据族。动作来自战略资格关闭，不是新证据。'
    }
    return `当日没有新的独立证据族。${HOLD_AS_DECISION}不是系统无能。`
  }
  return `新增独立证据族：${families.map(f => FAMILY_TEXT[f]).join('、')}。独立性要求来源不同，且不属于同一因果链。`
}

export function recordOf(date: string, j: Judged): MigrationRecord {
  const blockers: string[] = []
  if (j.expectation.verdict === 'UNKNOWN') blockers.push('R4 UNKNOWN')
  if (j.forward.tone === 'UNKNOWN') blockers.push('前瞻盈利 UNKNOWN')
  for (const name of j.evidence.unknown) blockers.push(`${name} UNKNOWN`)

  const move = legalMoveOf(j.migration.from, j.hunter)
  const newFamilies = newFamiliesOf(j)
  return {
    date,
    code: j.code,
    name: j.name,
    from: j.migration.from,
    to: j.hunter,
    ownership: j.ownership,
    evidenceTone: j.evidenceTone,
    newFamilies,
    independenceWhy: independenceWhyOf(j, newFamilies),
    unknowns: [...j.evidence.unknown],
    risks: [...j.risks],
    exposurePct: j.exposure.currentPct,
    exposure: j.exposure.portfolioStatus === 'OVER'
      ? '超限'
      : j.exposure.portfolioStatus === 'WITHIN' ? '正常' : '未知',
    action: j.capitalAction,
    triggerFamilies: j.migration.capitalReason.families,
    blockers,
    why: j.oneReason,
    r4: j.expectation.verdict,
    legalMove: move,
    legalQuestion: move ? LEGAL_MOVE_QUESTION[move] : null,
    decisionQuality: j.migration.legal ? 'COMPLIANT' : 'VIOLATION',
    evidenceOutcome: 'PENDING',
    capitalOutcome: 'NOT_USED_TO_JUDGE_SYSTEM',
    aftermath: '',
    notAReturnClaim: true,
  }
}

export function formatRecord(r: MigrationRecord): string {
  const from = r.from ? HUNTER_TEXT[r.from] : '无昨日档案'
  const added = r.newFamilies.length
    ? r.newFamilies.map(f => FAMILY_TEXT[f]).join('、')
    : '无新的独立证据族'
  const standing = r.triggerFamilies.length
    ? r.triggerFamilies.map(f => FAMILY_TEXT[f]).join('、')
    : '无'
  const blocks = r.blockers.length ? r.blockers.join('；') : '无'
  const unknown = r.unknowns.length ? r.unknowns.join('、') : '无'
  const risk = r.risks.length ? r.risks.map(k => RISK_TEXT[k]).join('、') : '无'
  const pct = r.exposurePct === null ? '未知' : `${(r.exposurePct * 100).toFixed(1)}%`
  return [
    r.date,
    `${r.name}（${r.code}）`,
    `${from} → ${HUNTER_TEXT[r.to]}`,
    `Ownership　${OWNERSHIP_TEXT[r.ownership]}`,
    `Evidence　${EVIDENCE_TONE_TEXT[r.evidenceTone]}`,
    `新证据族　${added}`,
    `独立性依据　${r.independenceWhy}`,
    `UNKNOWN　${unknown}`,
    `风险　${risk}`,
    `Exposure　${r.exposure}（${pct}）`,
    `当时站立族　${standing}`,
    `阻止条件　${blocks}`,
    `资本动作　${CAPITAL_ACTION_TEXT[r.action]}`,
    `原因　${r.why}`,
    r.legalQuestion ? `当时必须回答　${r.legalQuestion}` : '',
    `Decision Quality　${r.decisionQuality}`,
    `Evidence Outcome　${r.evidenceOutcome}`,
    `Capital Outcome　${r.capitalOutcome}`,
    `后续解释　${r.aftermath || '待回填'}`,
    '三类审计必须分开。后来涨跌不得改写当时是否合规。本条不是收益归因，也不证明族数门槛有效。',
  ].filter(Boolean).join('\n')
}

/**
 * 只允许回填后来事实与事后解释。
 * 禁止改 Decision Quality 与当日 Action。后来收益参数必须丢掉。
 */
export function afterTheFact(
  rec: MigrationRecord,
  later: {
    evidenceOutcome?: EvidenceOutcome
    aftermath?: string
    laterReturn?: number
    decisionQuality?: DecisionQuality
    action?: CapitalAction
  },
): MigrationRecord {
  void later.laterReturn
  void later.decisionQuality
  void later.action
  return {
    ...rec,
    evidenceOutcome: later.evidenceOutcome ?? rec.evidenceOutcome,
    aftermath: later.aftermath ?? rec.aftermath,
    decisionQuality: rec.decisionQuality,
    action: rec.action,
  }
}

export function persistJournal(
  date: string, cards: readonly Judged[], dir = JOURNAL_DIR,
): string {
  mkdirSync(dir, { recursive: true })
  const records = cards.map(j => recordOf(date, j))
  const file = join(dir, `${date}.json`)
  writeFileSync(file, `${JSON.stringify({ date, records }, null, 2)}\n`, 'utf-8')
  return file
}

export function loadJournal(date: string, dir = JOURNAL_DIR): MigrationRecord[] {
  const file = join(dir, `${date}.json`)
  if (!existsSync(file)) return []
  const raw = JSON.parse(readFileSync(file, 'utf-8')) as { records?: MigrationRecord[] }
  return raw.records ?? []
}
