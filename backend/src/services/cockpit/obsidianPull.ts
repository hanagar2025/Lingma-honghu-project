/**
 * 把已经发布的 today.json 拉到本地，再写成 Obsidian 笔记。
 *
 * 它不重新判断。服务器（或本机 refresh）先用真实行情算出结果，
 * 这里只搬运同一份快照。不新增判据，不改页面架构。
 *
 * 用法：
 *   npm run obsidian:pull
 *   TODAY_JSON_URL=https://hhwealth.cc/data/today.json OBSIDIAN_VAULT=路径 npm run obsidian:pull
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { webSnapshotFile } from './webSnapshot'
import { exportObsidianVault } from './obsidianExport'
import { formatObsidianResult } from './renderObsidian'

export const DEFAULT_TODAY_JSON_URL = 'https://hhwealth.cc/data/today.json'

function repoRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..')
}

export async function pullTodayJson(
  dest: string,
  url = process.env.TODAY_JSON_URL ?? DEFAULT_TODAY_JSON_URL,
): Promise<{ dest: string; date: string; bytes: number; hasLookout: boolean }> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(30000),
    headers: { 'cache-control': 'no-cache' },
  })
  if (!res.ok) throw new Error(`拉取失败 HTTP ${res.status}：${url}`)
  const text = await res.text()
  let raw: unknown
  try { raw = JSON.parse(text) } catch {
    throw new Error(`拉取到的不是 JSON：${url}`)
  }
  if (!raw || typeof raw !== 'object') throw new Error('快照不是对象')
  const snap = raw as Record<string, unknown>
  mkdirSync(dirname(dest), { recursive: true })
  writeFileSync(dest, text.endsWith('\n') ? text : `${text}\n`, 'utf-8')
  return {
    dest,
    date: typeof snap.date === 'string' ? snap.date : '未知',
    bytes: Buffer.byteLength(text),
    hasLookout: Boolean(snap.lookout && typeof snap.lookout === 'object'),
  }
}

async function main(): Promise<void> {
  const dest = webSnapshotFile(repoRoot())
  const pulled = await pullTodayJson(dest)
  process.stdout.write(
    `\n【已拉取】${pulled.dest}\n`
    + `  交易日 ${pulled.date}　${pulled.bytes} 字节　看台字段 ${pulled.hasLookout ? '有' : '无'}\n`
  )
  const out = exportObsidianVault()
  process.stdout.write(
    `\n【Obsidian 库】${out.root}\n`
    + `  日期 ${out.date}　来源 ${out.source}　${out.files.length} 个笔记\n`
  )
  process.stdout.write(formatObsidianResult({
    date: out.date,
    source: out.source,
    oneLine: out.input.oneLine,
    hasLookout: Boolean(out.input.lookoutText) || pulled.hasLookout,
    freshness: out.input.freshness,
    root: out.root,
    files: out.files.length,
  }))
  if (!pulled.hasLookout) {
    process.stdout.write(
      '  服务器代码还没有看台字段。要当日看台，在本机跑 npm run obsidian:refresh。\n'
    )
  }
}

const isDirect = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (isDirect) main().catch(e => {
  process.stderr.write(`拉取失败：${e instanceof Error ? e.message : String(e)}\n`)
  process.exit(1)
})
