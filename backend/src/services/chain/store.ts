/**
 * 链上数据的私有存储：<DATA_DIR>/chain/。只有服务账号能读，不进仓库。
 *
 *   series/<代码>.json        每只股票一份：日线、主力净流入、融资余额，按日期累积
 *   market.json               全市场融资余额
 *   earnings.json             业绩与业绩预告
 *   intraday/<日期>.json      当日的盘中快照
 *   mainline/<日期>.json      scripts/ai-mainline-map.py 的输出，原样
 *   scan/<日期>.json、.md     scripts/market-scan.py 的输出，原样
 *   digests/<日期>/<时点>.json bot 推来的汇总，连同策略方的决定和委员会的否决
 *   watch.json、flags.json、base.json、state.json
 *   orders.json               执行单的指令簿（含股数，只在这里）
 *   runs.jsonl                每次拉数一行
 *
 * 写入规则：主力净流入和融资余额只增不改，已存的日期不删；同一天重拉时数值变了，新值生效、旧值记进修订记录。
 * 日线是前复权价，除权后整段会重算，所以按源头最新的一段整体覆盖。
 */
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { beijingStamp } from '../intake/store'
import type {
  BarRow, BaseFile, EarningsFile, FlowRow, IntradaySnapshot, MarginRow, MarketFile, Revision, RunRecord, ShockFlag, StockSeries, WatchLine,
} from './types'

const DATE = /^\d{4}-\d{2}-\d{2}$/
const CODE = /^\d{6}$/
const MAX_BARS = 500
const MAX_REVISIONS = 200

function differs(a: number, b: number): boolean {
  return Math.abs(a - b) > Math.max(0.005, 1e-4 * Math.abs(b))
}

/** 按日期并入。新值生效；与旧值不同的记修订 */
function mergeRows<T extends { date: string }>(
  have: T[], incoming: readonly T[], value: (row: T) => number, kind: Revision['kind'], at: string, revisions: Revision[],
): T[] {
  const byDate = new Map(have.map(r => [r.date, r]))
  for (const r of incoming) {
    const old = byDate.get(r.date)
    if (old && differs(value(old), value(r))) revisions.push({ at, kind, date: r.date, from: value(old), to: value(r) })
    byDate.set(r.date, r)
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
}

export class ChainStore {
  readonly dir: string

  constructor(dataDir: string) {
    this.dir = join(dataDir, 'chain')
    for (const sub of ['series', 'intraday', 'mainline', 'scan', 'digests']) mkdirSync(join(this.dir, sub), { recursive: true, mode: 0o700 })
  }

  private write(file: string, content: string): void {
    const tmp = `${file}.tmp`
    writeFileSync(tmp, content, { mode: 0o600 })
    renameSync(tmp, file)
  }

  private readJson<T>(file: string): T | null {
    return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf-8')) as T) : null
  }

  private writeJson(file: string, doc: unknown): void {
    this.write(file, `${JSON.stringify(doc)}\n`)
  }

  // ── 个股序列 ──

  series(code: string): StockSeries | null {
    return CODE.test(code) ? this.readJson<StockSeries>(join(this.dir, 'series', `${code}.json`)) : null
  }

  /** 并入一次拉取的结果。没拉到的那一类传 undefined，原样保留 */
  mergeSeries(code: string, incoming: { name?: string; bars?: readonly BarRow[]; flow?: readonly FlowRow[]; margin?: readonly MarginRow[] }, now = new Date()): StockSeries {
    if (!CODE.test(code)) throw new Error(`代码不对：${code}`)
    const at = beijingStamp(now)
    const have = this.series(code) ?? { code, name: '', bars: [], flow: [], margin: [], revisions: [], updatedAt: at }
    const revisions = [...have.revisions]
    let bars = have.bars
    if (incoming.bars?.length) {
      // 前复权价除权后整段重算：源头给的这一段整体覆盖，更早的保留
      const first = incoming.bars[0]!.date
      const changed = have.bars.find(b => b.date >= first && incoming.bars!.some(n => n.date === b.date && differs(b.close, n.close)))
      if (changed) revisions.push({ at, kind: 'bars', date: changed.date, from: changed.close, to: incoming.bars.find(n => n.date === changed.date)!.close })
      bars = [...have.bars.filter(b => b.date < first), ...incoming.bars].slice(-MAX_BARS)
    }
    const next: StockSeries = {
      code,
      name: incoming.name || have.name,
      bars,
      flow: incoming.flow?.length ? mergeRows(have.flow, incoming.flow, r => r.main, 'flow', at, revisions) : have.flow,
      margin: incoming.margin?.length ? mergeRows(have.margin, incoming.margin, r => r.balance, 'margin', at, revisions) : have.margin,
      revisions: revisions.slice(-MAX_REVISIONS),
      updatedAt: at,
    }
    this.writeJson(join(this.dir, 'series', `${code}.json`), next)
    return next
  }

  seriesCodes(): string[] {
    return readdirSync(join(this.dir, 'series')).filter(f => /^\d{6}\.json$/.test(f)).map(f => f.slice(0, 6)).sort()
  }

  // ── 全市场、业绩 ──

  market(): MarketFile {
    return this.readJson<MarketFile>(join(this.dir, 'market.json')) ?? { margin: [], updatedAt: '' }
  }

  mergeMarketMargin(rows: readonly MarginRow[], now = new Date()): MarketFile {
    const have = this.market()
    const next: MarketFile = { margin: mergeRows(have.margin, rows, r => r.balance, 'margin', beijingStamp(now), []), updatedAt: beijingStamp(now) }
    this.writeJson(join(this.dir, 'market.json'), next)
    return next
  }

  earnings(): EarningsFile {
    return this.readJson<EarningsFile>(join(this.dir, 'earnings.json')) ?? { earnings: {}, forecasts: {}, updatedAt: '' }
  }

  saveEarnings(file: EarningsFile): void {
    this.writeJson(join(this.dir, 'earnings.json'), file)
  }

  // ── 盘中快照 ──

  intraday(date: string): IntradaySnapshot[] {
    return DATE.test(date) ? this.readJson<IntradaySnapshot[]>(join(this.dir, 'intraday', `${date}.json`)) ?? [] : []
  }

  addIntraday(date: string, snap: IntradaySnapshot): void {
    this.writeJson(join(this.dir, 'intraday', `${date}.json`), [...this.intraday(date), snap].slice(-60))
  }

  // ── 两个脚本的输出 ──

  scriptOutput(kind: 'mainline' | 'scan', date: string): unknown | null {
    return DATE.test(date) ? this.readJson<unknown>(join(this.dir, kind, `${date}.json`)) : null
  }

  scriptText(kind: 'mainline' | 'scan', date: string): string | null {
    const file = join(this.dir, kind, `${date}.md`)
    return DATE.test(date) && existsSync(file) ? readFileSync(file, 'utf-8') : null
  }

  /** text：脚本打印的表格。随包带来的历史读数没有这一份，传 null */
  saveScriptOutput(kind: 'mainline' | 'scan', date: string, json: string, text: string | null): void {
    if (!DATE.test(date)) throw new Error(`日期不对：${date}`)
    this.write(join(this.dir, kind, `${date}.json`), json)
    if (text !== null) this.write(join(this.dir, kind, `${date}.md`), text)
  }

  /** 已有输出的日期，旧的在前 */
  scriptDates(kind: 'mainline' | 'scan'): string[] {
    return readdirSync(join(this.dir, kind)).filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).map(f => f.slice(0, 10)).sort()
  }

  // ── 单份文件 ──

  doc<T>(name: 'watch' | 'flags' | 'base' | 'state' | 'orders'): T | null {
    return this.readJson<T>(join(this.dir, `${name}.json`))
  }

  saveDoc(name: 'watch' | 'flags' | 'base' | 'state' | 'orders', doc: unknown): void {
    this.write(join(this.dir, `${name}.json`), `${JSON.stringify(doc, null, 2)}\n`)
  }

  watch(): WatchLine[] { return this.doc<WatchLine[]>('watch') ?? [] }
  flags(): ShockFlag[] { return this.doc<ShockFlag[]>('flags') ?? [] }
  base(): BaseFile | null { return this.doc<BaseFile>('base') }

  // ── 汇总 ──

  digestPath(date: string, slot: string): string {
    if (!DATE.test(date) || !/^[a-z]+$/.test(slot)) throw new Error('日期或时点不对')
    return join(this.dir, 'digests', date, `${slot}.json`)
  }

  digest<T>(date: string, slot: string): T | null {
    return this.readJson<T>(this.digestPath(date, slot))
  }

  saveDigest(date: string, slot: string, doc: unknown): void {
    mkdirSync(join(this.dir, 'digests', date), { recursive: true, mode: 0o700 })
    this.write(this.digestPath(date, slot), `${JSON.stringify(doc, null, 2)}\n`)
  }

  /** 有汇总的日期，新的在前 */
  digestDates(limit = 30): string[] {
    return readdirSync(join(this.dir, 'digests')).filter(d => DATE.test(d)).sort().reverse().slice(0, limit)
  }

  digestSlots(date: string): string[] {
    const dir = join(this.dir, 'digests', date)
    return DATE.test(date) && existsSync(dir) ? readdirSync(dir).filter(f => /^[a-z]+\.json$/.test(f)).map(f => f.slice(0, -5)) : []
  }

  // ── 拉数记录 ──

  logRun(record: RunRecord): void {
    appendFileSync(join(this.dir, 'runs.jsonl'), `${JSON.stringify(record)}\n`, { mode: 0o600 })
  }

  runs(limit = 50): RunRecord[] {
    const file = join(this.dir, 'runs.jsonl')
    if (!existsSync(file)) return []
    return readFileSync(file, 'utf-8').split('\n').filter(Boolean).slice(-limit).map(l => JSON.parse(l) as RunRecord)
  }
}
