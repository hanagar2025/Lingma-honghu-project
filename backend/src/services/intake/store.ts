/**
 * 私有数据目录。账本、成交、意向、截图都放在这里，不进仓库。
 *
 *   <DATA_DIR>/inbox/<id>.json      每次提交一份
 *   <DATA_DIR>/inbox/<id>.<png|jpg> 截图原件
 *   <DATA_DIR>/ledger/portfolio.json            当前账本（执行单读这一份）
 *   <DATA_DIR>/ledger/history/<asOf>-<id>.json  每次生效的账本留底
 *   <DATA_DIR>/trades.jsonl、intents.jsonl      只追加
 */
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import type { LedgerFile } from '../dailyDecision/ledger'
import type { Submission } from './types'

export function beijingStamp(now = new Date()): string {
  return new Date(now.getTime() + 8 * 3600_000).toISOString().slice(0, 19).replace('T', ' ')
}

const IMAGE_TYPES: Record<string, { ext: string; magic: number[] }> = {
  'image/png': { ext: 'png', magic: [0x89, 0x50, 0x4e, 0x47] },
  'image/jpeg': { ext: 'jpg', magic: [0xff, 0xd8, 0xff] },
  'image/webp': { ext: 'webp', magic: [0x52, 0x49, 0x46, 0x46] },
}

/** data URL → 图片字节。只收 PNG、JPEG、WebP，且文件头必须与声明的类型一致 */
export function decodeImage(dataUrl: string): { bytes: Buffer; ext: string } | null {
  const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl)
  if (!m) return null
  const type = IMAGE_TYPES[m[1]!]!
  const bytes = Buffer.from(m[2]!, 'base64')
  if (bytes.length < 16 || !type.magic.every((b, i) => bytes[i] === b)) return null
  return { bytes, ext: type.ext }
}

export class Store {
  constructor(readonly dir: string) {
    mkdirSync(join(dir, 'inbox'), { recursive: true, mode: 0o700 })
    mkdirSync(join(dir, 'ledger', 'history'), { recursive: true, mode: 0o700 })
  }

  get ledgerPath(): string {
    return join(this.dir, 'ledger', 'portfolio.json')
  }

  newId(now = new Date()): string {
    return `${beijingStamp(now).replace(/[- :]/g, '').replace(/^(\d{8})(\d{6})$/, '$1-$2')}-${randomBytes(3).toString('hex')}`
  }

  private write(file: string, content: string | Buffer): void {
    const tmp = `${file}.tmp`
    writeFileSync(tmp, content, { mode: 0o600 })
    renameSync(tmp, file)
  }

  save(s: Submission): Submission {
    this.write(join(this.dir, 'inbox', `${s.id}.json`), `${JSON.stringify(s, null, 2)}\n`)
    return s
  }

  saveImage(id: string, ext: string, bytes: Buffer): string {
    const name = `${id}.${ext}`
    this.write(join(this.dir, 'inbox', name), bytes)
    return name
  }

  get(id: string): Submission | null {
    if (!/^[\w-]+$/.test(id)) return null
    const file = join(this.dir, 'inbox', `${id}.json`)
    return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf-8')) as Submission) : null
  }

  imagePath(s: Submission): string | null {
    return s.imageFile && /^[\w-]+\.(png|jpg|webp)$/.test(s.imageFile) ? join(this.dir, 'inbox', s.imageFile) : null
  }

  /** 新的在前 */
  list(limit = 50): Submission[] {
    return readdirSync(join(this.dir, 'inbox'))
      .filter(f => f.endsWith('.json')).sort().reverse().slice(0, limit)
      .map(f => JSON.parse(readFileSync(join(this.dir, 'inbox', f), 'utf-8')) as Submission)
  }

  readLedger(): LedgerFile | null {
    return existsSync(this.ledgerPath) ? (JSON.parse(readFileSync(this.ledgerPath, 'utf-8')) as LedgerFile) : null
  }

  writeLedger(ledger: LedgerFile, id: string): void {
    const text = `${JSON.stringify(ledger, null, 2)}\n`
    this.write(join(this.dir, 'ledger', 'history', `${ledger.asOf ?? 'undated'}-${id}.json`), text)
    this.write(this.ledgerPath, text)
  }

  append(name: 'trades' | 'intents', record: unknown): void {
    appendFileSync(join(this.dir, `${name}.jsonl`), `${JSON.stringify(record)}\n`, { mode: 0o600 })
  }

  readLog(name: 'trades' | 'intents'): unknown[] {
    const file = join(this.dir, `${name}.jsonl`)
    if (!existsSync(file)) return []
    return readFileSync(file, 'utf-8').split('\n').filter(Boolean).map(l => JSON.parse(l) as unknown)
  }
}
