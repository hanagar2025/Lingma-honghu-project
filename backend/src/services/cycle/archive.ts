/**
 * CY-01 · 档案：证据包、研判记录、事后验证记录
 *
 *   share/cycle/packages/{asOf}.json / .md     证据包（同日再生成写 -r2、-r3，不覆盖）
 *   share/cycle/judgments/J-YYYY-MM-DD-NN.json 研判记录
 *   share/cycle/verifications/V-YYYY-MM-DD-NN.json 事后验证记录
 *   share/cycle/index.json                     索引：逐条 SHA-256 指纹 + 哈希链
 *
 * 只增不改由三道检查保证：文件只写一次；索引是哈希链，改动任何一条历史都会断链；
 * git 历史里已归档文件不得出现修改或删除，索引的每次提交必须是上一版的追加。
 */

import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { validateJudgment, validateVerification, type JudgmentRecord, type PackageLookup, type VerificationRecord } from './judgment'
import { renderPackage } from './package'
import type { EvidencePackage } from './types'

export const ARCHIVE_DIR = 'share/cycle'
export const INDEX_FILE = `${ARCHIVE_DIR}/index.json`
const DIRS = { PACKAGE: `${ARCHIVE_DIR}/packages`, JUDGMENT: `${ARCHIVE_DIR}/judgments`, VERIFICATION: `${ARCHIVE_DIR}/verifications` } as const

export type EntryKind = keyof typeof DIRS

export interface IndexEntry {
  seq: number
  kind: EntryKind
  id: string
  file: string
  sha256: string
  /** 证据包的可读文本 */
  mdFile: string | null
  mdSha256: string | null
  recordedAt: string
  /** 引用的上游文件（研判 → 证据包；验证 → 研判与新证据包） */
  refs: string[]
  prevEntryHash: string | null
  entryHash: string
}

export interface ArchiveIndex { id: 'CY-01'; kind: 'ARCHIVE_INDEX'; note: string; entries: IndexEntry[] }

export const sha256 = (s: string | Buffer) => createHash('sha256').update(s).digest('hex')
export const serialize = (x: unknown) => `${JSON.stringify(x, null, 2)}\n`

export function entryHashOf(e: Omit<IndexEntry, 'entryHash'>): string {
  const { seq, kind, id, file, sha256: h, mdFile, mdSha256, recordedAt, refs, prevEntryHash } = e
  return sha256(JSON.stringify({ seq, kind, id, file, sha256: h, mdFile, mdSha256, recordedAt, refs, prevEntryHash }))
}

const INDEX_NOTE = '只增不改。每条记录文件的 SHA-256 与哈希链；改动任何历史条目都会使 cycle:check 失败。'

export function readIndex(root: string): ArchiveIndex {
  const p = join(root, INDEX_FILE)
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : { id: 'CY-01', kind: 'ARCHIVE_INDEX', note: INDEX_NOTE, entries: [] }
}

function writeOnce(root: string, rel: string, content: string): void {
  const p = join(root, rel)
  if (existsSync(p)) throw new Error(`档案文件已存在，不覆盖：${rel}`)
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, content)
}

function append(root: string, e: Omit<IndexEntry, 'seq' | 'prevEntryHash' | 'entryHash'>): IndexEntry {
  const idx = readIndex(root)
  const last = idx.entries.at(-1) ?? null
  const draft = { ...e, seq: (last?.seq ?? 0) + 1, prevEntryHash: last?.entryHash ?? null }
  const entry: IndexEntry = { ...draft, entryHash: entryHashOf(draft) }
  idx.entries.push(entry)
  mkdirSync(join(root, ARCHIVE_DIR), { recursive: true })
  writeFileSync(join(root, INDEX_FILE), serialize(idx))
  return entry
}

/** 同日已有证据包时，只有显式要求修订才写 -r2、-r3 */
export function packageFileName(root: string, asOf: string, revision: boolean): string | null {
  const base = `${DIRS.PACKAGE}/${asOf}`
  if (!existsSync(join(root, `${base}.json`))) return `${base}.json`
  if (!revision) return null
  for (let r = 2; ; r++) if (!existsSync(join(root, `${base}-r${r}.json`))) return `${base}-r${r}.json`
}

export function archivePackage(root: string, pkg: EvidencePackage, revision = false): IndexEntry | null {
  const file = packageFileName(root, pkg.asOf, revision)
  if (!file) return null
  const json = serialize(pkg)
  const h = sha256(json)
  const mdFile = file.replace(/\.json$/, '.md')
  const md = renderPackage(pkg, h)
  writeOnce(root, file, json)
  writeOnce(root, mdFile, md)
  return append(root, {
    kind: 'PACKAGE', id: `P-${file.split('/').at(-1)!.replace(/\.json$/, '')}`, file, sha256: h,
    mdFile, mdSha256: sha256(md), recordedAt: pkg.generatedAt, refs: [],
  })
}

function lookups(root: string, idx: ArchiveIndex) {
  const byFile = new Map(idx.entries.map(e => [e.file, e]))
  const packageOf = (file: string): PackageLookup | null => {
    const e = byFile.get(file)
    if (!e || e.kind !== 'PACKAGE' || !existsSync(join(root, file))) return null
    return { file, sha256: e.sha256, pkg: JSON.parse(readFileSync(join(root, file), 'utf8')) }
  }
  const judgmentOf = (file: string) => {
    const e = byFile.get(file)
    if (!e || e.kind !== 'JUDGMENT' || !existsSync(join(root, file))) return null
    return { sha256: e.sha256, record: JSON.parse(readFileSync(join(root, file), 'utf8')) as JudgmentRecord }
  }
  return { packageOf, judgmentOf }
}

/** 落档研判或验证记录。记录时刻取落档时刻，不接受倒填 */
export function archiveRecord(root: string, draft: JudgmentRecord | VerificationRecord, now: string): { entry: IndexEntry | null; errors: string[] } {
  const idx = readIndex(root)
  const rec = { ...draft, recordedAt: now }
  const { packageOf, judgmentOf } = lookups(root, idx)
  const errors = rec.kind === 'JUDGMENT'
    ? validateJudgment(rec as JudgmentRecord, packageOf)
    : rec.kind === 'VERIFICATION'
      ? validateVerification(rec as VerificationRecord, judgmentOf, packageOf)
      : [`未知记录类型 ${(rec as { kind: string }).kind}`]
  if (idx.entries.some(e => e.id === rec.id)) errors.push(`编号已存在：${rec.id}`)
  const datePart = rec.id?.slice(2, 12)
  if (datePart !== now.slice(0, 10)) errors.push(`编号日期须为落档日 ${now.slice(0, 10)}（现为 ${datePart}）`)
  if (errors.length) return { entry: null, errors }
  const kind = rec.kind as 'JUDGMENT' | 'VERIFICATION'
  const file = `${DIRS[kind]}/${rec.id}.json`
  const json = serialize(rec)
  writeOnce(root, file, json)
  const refs = kind === 'JUDGMENT'
    ? [(rec as JudgmentRecord).package.file]
    : [(rec as VerificationRecord).judgment.file, ...(rec as VerificationRecord).packages.map(p => p.file)]
  return { entry: append(root, { kind, id: rec.id, file, sha256: sha256(json), mdFile: null, mdSha256: null, recordedAt: now, refs }), errors: [] }
}

function git(root: string, args: string[]): string | null {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
  } catch {
    return null
  }
}

/** git 历史里已归档文件不得被修改或删除；索引每次提交必须是上一版的追加 */
export function gitAppendOnlyProblems(root: string): { problems: string[]; checked: boolean } {
  if (git(root, ['rev-parse', '--is-inside-work-tree'])?.trim() !== 'true') return { problems: [], checked: false }
  const problems: string[] = []
  const changed = git(root, ['log', '--format=commit %h', '--diff-filter=MDR', '--name-status', '--', ...Object.values(DIRS)]) ?? ''
  let commit = ''
  for (const line of changed.split('\n')) {
    if (line.startsWith('commit ')) commit = line.slice(7)
    else if (/^[MDR]/.test(line)) problems.push(`提交 ${commit} 修改或删除了已归档文件：${line.split('\t').slice(1).join(' → ')}`)
  }
  const commits = (git(root, ['log', '--format=%H', '--', INDEX_FILE]) ?? '').split('\n').filter(Boolean)
  for (const c of commits) {
    const cur = git(root, ['show', `${c}:${INDEX_FILE}`])
    const prev = git(root, ['show', `${c}^:${INDEX_FILE}`])
    if (!cur || !prev) continue
    const a = (JSON.parse(prev) as ArchiveIndex).entries
    const b = (JSON.parse(cur) as ArchiveIndex).entries
    const kept = a.every((e, i) => b[i]?.entryHash === e.entryHash)
    if (!kept) problems.push(`提交 ${c.slice(0, 8)} 改写了索引的历史条目`)
  }
  return { problems, checked: true }
}

export interface CheckResult { problems: string[]; counts: Record<EntryKind, number>; gitChecked: boolean }

export function checkArchive(root: string, opts: { git?: boolean } = {}): CheckResult {
  const idx = readIndex(root)
  const problems: string[] = []
  const counts: Record<EntryKind, number> = { PACKAGE: 0, JUDGMENT: 0, VERIFICATION: 0 }
  let prev: IndexEntry | null = null
  for (const e of idx.entries) {
    counts[e.kind]++
    if (e.seq !== (prev?.seq ?? 0) + 1) problems.push(`索引序号不连续：${e.id}`)
    if (e.prevEntryHash !== (prev?.entryHash ?? null)) problems.push(`哈希链断开：${e.id}`)
    const { entryHash, ...rest } = e
    if (entryHashOf(rest) !== entryHash) problems.push(`索引条目被改动：${e.id}`)
    if (prev && Date.parse(e.recordedAt) < Date.parse(prev.recordedAt)) problems.push(`记录时刻倒序：${e.id} 早于 ${prev.id}`)
    for (const [f, h] of [[e.file, e.sha256], [e.mdFile, e.mdSha256]] as const) {
      if (!f) continue
      const p = join(root, f)
      if (!existsSync(p)) problems.push(`档案文件缺失：${f}`)
      else if (sha256(readFileSync(p)) !== h) problems.push(`指纹不符（文件被改动）：${f}`)
    }
    prev = e
  }
  const indexed = new Set(idx.entries.flatMap(e => [e.file, e.mdFile]).filter(Boolean))
  for (const d of Object.values(DIRS)) {
    const dir = join(root, d)
    if (!existsSync(dir)) continue
    for (const f of readdirSync(dir)) if (!indexed.has(`${d}/${f}`)) problems.push(`档案目录里有未登记索引的文件：${d}/${f}`)
  }
  const { packageOf, judgmentOf } = lookups(root, idx)
  for (const e of idx.entries) {
    if (!existsSync(join(root, e.file))) continue
    const rec = JSON.parse(readFileSync(join(root, e.file), 'utf8'))
    if (e.kind === 'PACKAGE') {
      const pkg = rec as EvidencePackage
      if (pkg.kind !== 'EVIDENCE_PACKAGE' || pkg.producesAction !== false) problems.push(`证据包格式不符：${e.file}`)
      if (!e.file.split('/').at(-1)!.startsWith(pkg.asOf)) problems.push(`证据包文件名与日期不符：${e.file}`)
      if (pkg.nodes.some(n => n.cycleState.state !== null)) problems.push(`证据包不得自行给出 C0–C3：${e.file}`)
    } else {
      if (rec.recordedAt !== e.recordedAt) problems.push(`记录时刻与索引不符：${e.file}`)
      const errs = e.kind === 'JUDGMENT' ? validateJudgment(rec, packageOf) : validateVerification(rec, judgmentOf, packageOf)
      for (const x of errs) problems.push(`${e.id}：${x}`)
      const refsOk = e.refs.every(r => idx.entries.some(o => o.file === r && o.seq < e.seq))
      if (!refsOk) problems.push(`${e.id} 引用了在它之后才落档的文件`)
    }
  }
  let gitChecked = false
  if (opts.git !== false) {
    const g = gitAppendOnlyProblems(root)
    problems.push(...g.problems)
    gitChecked = g.checked
  }
  return { problems, counts, gitChecked }
}
