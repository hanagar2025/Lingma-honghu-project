/**
 * 独立写出 Obsidian 库。
 *
 * 不依赖 MySQL，不依赖登录，不依赖行情接口。
 * 研究笔记每次都会写。看台和依据只在有 today.json 或调用方传入时写入。
 *
 * 用法：
 *   npm run obsidian
 *   OBSIDIAN_VAULT=~/Documents/鸿鹄理财 npm run obsidian
 *   npm run obsidian:pull      先拉线上 today.json，再写库
 *   npm run obsidian:refresh   拉真实行情，程序分析后写库
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderDecisionCockpit, type DecisionCockpit } from '../decision/cockpitV2'
import { renderLookout, type LookoutView } from './lookout'
import { renderVerdict } from './renderVerdict'
import { renderDashboard } from './renderDashboard'
import { renderChanges, type Change } from '../governance/changeLog'
import type { Verdict } from './verdict'
import type { Dashboard } from './dashboard'
import { webSnapshotFile } from './webSnapshot'
import {
  buildObsidianVault, formatObsidianResult, resolveFreshness, resolveObsidianRoot,
  writeObsidianVault, type ObsidianInput,
} from './renderObsidian'

const HERE = dirname(fileURLToPath(import.meta.url))

function repoRoot(): string {
  return join(HERE, '..', '..', '..', '..')
}

function asObject(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' ? v as Record<string, unknown> : null
}

function safeLookout(v: unknown): string | null {
  if (!v || typeof v !== 'object') return null
  try { return renderLookout(v as LookoutView) } catch { return null }
}

function safeDecision(v: unknown): string | null {
  if (!v || typeof v !== 'object') return null
  try { return renderDecisionCockpit(v as DecisionCockpit) } catch { return null }
}

function safeVerdict(v: unknown): string | null {
  if (!v || typeof v !== 'object') return null
  try { return renderVerdict(v as Verdict) } catch { return null }
}

function safeDashboard(v: unknown): string | null {
  if (!v || typeof v !== 'object') return null
  try { return renderDashboard(v as Dashboard) } catch { return null }
}

function snapshotChanges(snapshot: Record<string, unknown>): { items: Change[]; prevDate: string | null } {
  const raw = asObject(snapshot.changes)
  if (!raw) return { items: [], prevDate: null }
  const items = Array.isArray(raw.items) ? raw.items as Change[] : []
  const prevDate = typeof raw.prevDate === 'string' ? raw.prevDate : null
  return { items, prevDate }
}

function safeChanges(snapshot: Record<string, unknown>, date: string): string | null {
  const { items, prevDate } = snapshotChanges(snapshot)
  if (!prevDate && items.length === 0) return null
  try { return renderChanges(items, prevDate, date) } catch { return null }
}

export function inputFromSnapshot(snapshot: Record<string, unknown>): ObsidianInput {
  const dash = asObject(snapshot.dashboard)
  const freeze = asObject(snapshot.freeze)
  const lookout = snapshot.lookout
  const verdict = asObject(snapshot.verdict)
  const date = typeof snapshot.date === 'string'
    ? snapshot.date
    : typeof dash?.date === 'string' ? dash.date : null
  const oneLine = typeof verdict?.oneLine === 'string'
    ? verdict.oneLine
    : typeof snapshot.coreDecision === 'string' ? snapshot.coreDecision : null
  return {
    date,
    generatedAt: typeof snapshot.generatedAt === 'string' ? snapshot.generatedAt : null,
    codeCommit: typeof snapshot.codeCommit === 'string' ? snapshot.codeCommit : null,
    lookout: lookout && typeof lookout === 'object' ? lookout as LookoutView : null,
    lookoutText: safeLookout(lookout),
    decisionText: safeDecision(snapshot.decisionV2),
    verdictText: safeVerdict(snapshot.verdict),
    dashboardText: safeDashboard(snapshot.dashboard),
    oneLine,
    changesText: date ? safeChanges(snapshot, date) : null,
    briefText: typeof snapshot.brief === 'string' ? snapshot.brief : null,
    freeze: freeze ? {
      currentHash: typeof freeze.currentHash === 'string'
        ? freeze.currentHash
        : typeof asObject(freeze.current)?.hash === 'string'
          ? String(asObject(freeze.current)?.hash)
          : null,
      drifted: freeze.drifted === true,
      detail: typeof freeze.detail === 'string' ? freeze.detail : undefined,
    } : null,
    dataGaps: Array.isArray(snapshot.dataGaps)
      ? snapshot.dataGaps.filter((x): x is string => typeof x === 'string')
      : Array.isArray(dash?.dataGaps)
        ? (dash.dataGaps as unknown[]).filter((x): x is string => typeof x === 'string')
        : null,
    freshness: resolveFreshness(date),
    source: 'snapshot',
  }
}

export function loadSnapshotInput(): ObsidianInput {
  const file = webSnapshotFile(repoRoot())
  if (!existsSync(file)) return { source: 'research-only' }
  try {
    const raw = JSON.parse(readFileSync(file, 'utf-8')) as unknown
    if (!raw || typeof raw !== 'object') return { source: 'research-only' }
    return inputFromSnapshot(raw as Record<string, unknown>)
  } catch {
    return { source: 'research-only' }
  }
}

export function exportObsidianVault(root = resolveObsidianRoot()): {
  root: string
  files: string[]
  source: string
  date: string
  input: ObsidianInput
} {
  const input = loadSnapshotInput()
  const vault = buildObsidianVault(input)
  const written = writeObsidianVault(root, vault.notes)
  return { ...written, source: vault.source, date: vault.date, input }
}

function main(): void {
  const out = exportObsidianVault()
  process.stdout.write(
    `\n【Obsidian 库】${out.root}\n`
    + `  日期 ${out.date}　来源 ${out.source}　${out.files.length} 个笔记\n`
    + `  在 Obsidian 里「打开文件夹作为库」，或把「鸿鹄」文件夹放进已有库。\n`
    + `  指定现有库：OBSIDIAN_VAULT=路径 npm run obsidian\n`
    + `  这不是新的页面架构。网页三层仍然冻结。\n`
  )
  process.stdout.write(formatObsidianResult({
    date: out.date,
    source: out.source,
    oneLine: out.input.oneLine,
    hasLookout: Boolean(out.input.lookoutText),
    freshness: out.input.freshness,
    root: out.root,
    files: out.files.length,
  }))
}

const isDirect = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (isDirect) main()
