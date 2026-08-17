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
import { FAMILY_TEXT } from './capitalGates'
import { HUNTER_TEXT } from './hunter'
import { CAPITAL_ACTION_TEXT, EVIDENCE_TONE_TEXT, OWNERSHIP_TEXT } from './triaxis'

const HERE = dirname(fileURLToPath(import.meta.url))
export const JOURNAL_DIR = join(HERE, '../governance/data/migrations')

/** 族数门槛是设计规则。禁止对外说「回测证明三族最好」。 */
export const NEVER_CLAIM_BACKTEST_PROVED_FAMILIES = true

export interface MigrationRecord {
  date: string
  code: string
  name: string
  from: HunterStage | null
  to: HunterStage
  ownership: Ownership
  evidenceTone: EvidenceTone
  exposure: '超限' | '正常' | '未知'
  action: CapitalAction
  triggerFamilies: readonly EvidenceFamily[]
  blockers: readonly string[]
  why: string
  /** 恒为 true。本档案不是收益归因。 */
  notAReturnClaim: true
}

export function recordOf(date: string, j: Judged): MigrationRecord {
  const blockers: string[] = []
  if (j.expectation.verdict === 'UNKNOWN') blockers.push('R4 UNKNOWN')
  if (j.forward.tone === 'UNKNOWN') blockers.push('前瞻盈利 UNKNOWN')
  for (const name of j.evidence.unknown) blockers.push(`${name} UNKNOWN`)

  return {
    date,
    code: j.code,
    name: j.name,
    from: j.migration.from,
    to: j.hunter,
    ownership: j.ownership,
    evidenceTone: j.evidenceTone,
    exposure: j.exposure.portfolioStatus === 'OVER'
      ? '超限'
      : j.exposure.portfolioStatus === 'WITHIN' ? '正常' : '未知',
    action: j.capitalAction,
    triggerFamilies: j.migration.capitalReason.families,
    blockers,
    why: j.oneReason,
    notAReturnClaim: true,
  }
}

export function formatRecord(r: MigrationRecord): string {
  const from = r.from ? HUNTER_TEXT[r.from] : '无昨日档案'
  const triggers = r.triggerFamilies.length
    ? r.triggerFamilies.map(f => FAMILY_TEXT[f]).join('、')
    : '无新的独立证据族'
  const blocks = r.blockers.length ? r.blockers.join('；') : '无'
  return [
    r.date,
    `${r.name}（${r.code}）`,
    `${from} → ${HUNTER_TEXT[r.to]}`,
    `Ownership　${OWNERSHIP_TEXT[r.ownership]}`,
    `Evidence　${EVIDENCE_TONE_TEXT[r.evidenceTone]}`,
    `Exposure　${r.exposure}`,
    `触发证据　${triggers}`,
    `阻止条件　${blocks}`,
    `资本动作　${CAPITAL_ACTION_TEXT[r.action]}`,
    `原因　${r.why}`,
    '本条不是收益归因，也不证明族数门槛有效。',
  ].join('\n')
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
