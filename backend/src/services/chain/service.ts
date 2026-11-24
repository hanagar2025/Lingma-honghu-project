/**
 * 链上数据的编排：到点拉数、调用脚本、盯线、提醒汇总未到。
 *
 * 后端自己的时点（北京时间，周一到周五）：
 *   08:20  上一交易日融资余额（没公布就每 10 分钟再试，到 09:15）；财报期补业绩
 *   11:35  盘中快照
 *   15:35  日线与主力净流入定稿，随后跑 ai-mainline-map.py
 *   16:22  跑 market-scan.py
 *   09:30–11:30、13:00–15:00 每 5 分钟盯线
 *   bot 的每个时点过后 15 分钟还没收到汇总，推送一条「汇总未到」
 *
 * 这里不打分、不排序。打分和排序由 bot 做。
 */
import type { LedgerFile } from '../dailyDecision/ledger'
import { beijingStamp } from '../intake/store'
import { beijing } from '../scheduler'
import { collectDaily, collectEarnings, collectIntraday, collectMargin, earningsDue, type CollectOptions } from './collect'
import { DIGEST_SLOTS } from './digest'
import { ScriptRunner, type ScriptKind, type Spawn, mainlineIncomplete } from './scripts'
import { emQuotes, tencentQuotes } from './sources'
import { ChainStore } from './store'
import type { BaseFile, RunRecord } from './types'
import { withHoldings, type Segment } from './universe'
import { portfolioView, type PortfolioView } from './view'
import { describeLine, lineStatus, newlyBeyond, type LineStatus, type LiveQuote } from './watch'

export interface ChainTask {
  id: string
  at: string
  /** 从 at 起多少分钟内有效 */
  windowMin: number
  /** 没做成时隔多少分钟再试 */
  retryMin: number
  /** 只在星期几（1–5）；缺省周一到周五 */
  weekday?: number
}

const minutes = (hhmm: string): number => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5))
const hhmm = (m: number): string => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`

export const ALERT_AFTER_MIN = 15

/** 主线脚本带缺项的读数，一天最多重跑几次 */
const MAX_REDO = 2

/** 同一项拉数两次之间至少隔这么久 */
const PULL_GAP_MS = 120_000

export const CHAIN_TASKS: readonly ChainTask[] = [
  { id: 'margin', at: '08:20', windowMin: 55, retryMin: 10 },
  { id: 'intraday', at: '11:35', windowMin: 20, retryMin: 3 },
  { id: 'daily', at: '15:35', windowMin: 40, retryMin: 5 },
  { id: 'scan', at: '16:22', windowMin: 30, retryMin: 5 },
  ...DIGEST_SLOTS.map(s => ({ id: `alert-${s.id}`, at: hhmm(minutes(s.at) + ALERT_AFTER_MIN), windowMin: 20, retryMin: 5, weekday: s.weekday })),
]

/** 此刻该做哪些事。done：任务 → 已做完的日期；tried：任务 → 上次尝试的时刻（毫秒） */
export function dueChainTasks(now: Date, done: Readonly<Record<string, string>>, tried: Readonly<Record<string, number>> = {}): ChainTask[] {
  const bj = beijing(now)
  if (bj.weekday === 0 || bj.weekday === 6) return []
  const t = minutes(bj.time)
  return CHAIN_TASKS.filter(k =>
    (k.weekday === undefined || k.weekday === bj.weekday)
    && t >= minutes(k.at) && t < minutes(k.at) + k.windowMin
    && done[k.id] !== bj.date
    && now.getTime() - (tried[k.id] ?? 0) >= k.retryMin * 60_000)
}

/** 盯线只在连续竞价时段，每 5 分钟一次 */
export function watchDue(now: Date, lastAt: number): boolean {
  const bj = beijing(now)
  if (bj.weekday === 0 || bj.weekday === 6) return false
  const t = minutes(bj.time)
  const inSession = (t >= 9 * 60 + 30 && t <= 11 * 60 + 30) || (t >= 13 * 60 && t <= 15 * 60)
  return inSession && now.getTime() - lastAt >= 5 * 60_000
}

export interface ChainDeps {
  dataDir: string
  readLedger: () => LedgerFile | null
  /** 推送到手机。没配通道时什么都不做 */
  notify: (title: string, body: string) => Promise<void>
  isTrading: (now: Date) => Promise<boolean | null>
  log: (line: string) => void
  source?: CollectOptions
  spawn?: Spawn
  pyHome?: string | null
}

interface StateFile { done: Record<string, string>; lineSeen: Record<string, string> }

export class ChainService {
  readonly store: ChainStore
  readonly runner: ScriptRunner
  private tried: Record<string, number> = {}
  private lastWatch = 0
  private busy = false
  /** 主线脚本带缺项的读数，这一天已经重跑了几次 */
  private redone: Record<string, number> = {}

  constructor(private readonly deps: ChainDeps) {
    this.store = new ChainStore(deps.dataDir)
    this.runner = new ScriptRunner(this.store, { spawn: deps.spawn, pyHome: deps.pyHome, log: deps.log })
  }

  segments(): Segment[] {
    return withHoldings((this.deps.readLedger()?.positions ?? []).filter(p => p.quantity > 0).map(p => p.code))
  }

  codes(): string[] {
    return this.segments().flatMap(s => s.codes)
  }

  /** 日线最新的已收盘交易日 */
  lastClosed(): string | null {
    const dates = this.codes().map(c => this.store.series(c)?.bars.slice(-1)[0]?.date).filter((d): d is string => !!d)
    return dates.sort().pop() ?? null
  }

  /**
   * 让某天的脚本读数存在：有了就直接用，没有就现在跑。
   * ai-mainline-map.py 总是按行情源最新的一根日线算，没有“截至某日”的参数。
   * 所以只在这一根就是要的那一天时才跑：当天 15:05 之后，或次日 09:15 之前。别的时候跑出来的是盘中价。
   */
  ensureScript(kind: ScriptKind, date: string, now = new Date()): { state: 'ready' | 'running' | 'failed'; error: string | null } {
    if (this.store.scriptOutput(kind, date) === null) {
      const closed = this.lastClosed()
      if (date !== closed) return { state: 'failed', error: `只能生成最新收盘日（${closed ?? '还没有日线'}）的读数` }
      const bj = beijing(now)
      const weekend = bj.weekday === 0 || bj.weekday === 6
      const fresh = date === bj.date ? bj.time >= '15:05' : weekend || bj.time < '09:15'
      if (kind === 'mainline' && !fresh) return { state: 'failed', error: `${date} 的读数只能在收盘后到下一个交易日开盘前生成，现在行情源里最新一根是盘中价` }
    }
    const { state, job } = this.runner.ensure(kind, date, now)
    return { state, error: job?.error ?? null }
  }

  private state(): StateFile {
    return this.store.doc<StateFile>('state') ?? { done: {}, lineSeen: {} }
  }

  // ── 拉数 ──

  /**
   * 同一项拉数，正在拉或刚拉完（2 分钟内）就把那一次的结果交回去，不另拉一遍。
   * 定时任务、bot 催数、人工补数可能挤在同一分钟；行情源对短时间的大量请求会直接断连接。
   */
  private readonly recent = new Map<string, { at: number; run: Promise<unknown> }>()
  private once<T>(key: string, now: Date, force: boolean, work: () => Promise<T>): Promise<T> {
    const have = this.recent.get(key)
    if (!force && have && Math.abs(now.getTime() - have.at) < PULL_GAP_MS) return have.run as Promise<T>
    const run = work()
    this.recent.set(key, { at: now.getTime(), run })
    run.catch(() => { if (this.recent.get(key)?.run === run) this.recent.delete(key) })
    return run
  }

  async pullDaily(now = new Date(), backfill = false): Promise<RunRecord> {
    return this.once('daily', now, backfill, () => collectDaily(this.store, this.codes(), { ...this.deps.source, now, backfill }))
  }

  async pullMargin(now = new Date(), backfill = false): Promise<RunRecord[]> {
    return this.once('margin', now, backfill, async () => {
      const out = [await collectMargin(this.store, this.codes(), { ...this.deps.source, now, backfill })]
      if (backfill || earningsDue(now) || !this.store.earnings().updatedAt) out.push(await collectEarnings(this.store, this.codes(), { ...this.deps.source, now }))
      return out
    })
  }

  async pullIntraday(now = new Date()): Promise<RunRecord> {
    return this.once('intraday', now, false, () => collectIntraday(this.store, this.codes(), { ...this.deps.source, now }))
  }

  /** 第一次启动时私有目录是空的：把近 130 个交易日的日线、主力净流入和融资一次补齐 */
  async bootstrap(now = new Date()): Promise<void> {
    if (this.store.seriesCodes().length > 0) return
    this.deps.log('链上数据是空的，开始补历史')
    const daily = await this.pullDaily(now, true)
    const margin = await this.pullMargin(now, true)
    this.deps.log(`补历史完成：日线 ${daily.ok} 只、缺 ${daily.failed.length} 项；融资 ${margin[0]!.ok} 只、缺 ${margin[0]!.failed.length} 项`)
  }

  // ── 仓位（只有占比和指数） ──

  async portfolio(now = new Date()): Promise<PortfolioView> {
    const ledger = this.deps.readLedger()
    const codes = (ledger?.positions ?? []).filter(p => p.quantity > 0).map(p => p.code)
    const prices: Record<string, number | undefined> = {}
    if (codes.length) {
      try {
        const live = await tencentQuotes(codes, this.deps.source)
        for (const c of codes) prices[c] = live[c]?.price
      } catch { /* 取不到实时价就用最近收盘价 */ }
      for (const c of codes) prices[c] ??= this.store.series(c)?.bars.slice(-1)[0]?.close
    }
    const base = this.store.base()
    const { view, newHigh } = portfolioView(ledger, prices, base, now)
    if (newHigh !== null && base) this.store.saveDoc('base', { ...base, highIndex: newHigh } satisfies BaseFile)
    return view
  }

  /** 委员会填净值基准。金额只落在服务器，不回显 */
  setBase(totalAssets: unknown, at: unknown, now = new Date()): string | null {
    if (typeof totalAssets !== 'number' || !Number.isFinite(totalAssets) || totalAssets <= 0) return '基准总资产要是正数'
    if (typeof at !== 'string' || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(at)) return '基准时点写成 2026-11-24 09:37 这样'
    this.store.saveDoc('base', { totalAssets, at, highIndex: 100, setAt: beijingStamp(now) } satisfies BaseFile)
    return null
  }

  // ── 盯线 ──

  /** live = true 时取盘中现价；否则按最近收盘日 */
  async lines(live: boolean): Promise<{ at: string; live: boolean; statuses: LineStatus[]; note: string | null }> {
    const lines = this.store.watch()
    let quotes: Record<string, LiveQuote> = {}
    let note: string | null = null
    if (live && lines.length) {
      try {
        const got = await emQuotes([...new Set(lines.map(l => l.code))], this.deps.source)
        quotes = Object.fromEntries(Object.entries(got.quotes).map(([c, q]) => [c, { price: q.price, main: q.main }]))
        note = `行情时刻 ${got.sourceAt ?? '未知'}`
      } catch (e) {
        note = `盘中行情取不到（${e instanceof Error ? e.message : String(e)}），按最近收盘日`
      }
    }
    return {
      at: beijingStamp(), live: live && Object.keys(quotes).length > 0, note,
      statuses: lines.map(l => lineStatus(l, this.store.series(l.code), quotes[l.code] ?? null)),
    }
  }

  private async watchTick(now: Date): Promise<void> {
    if (!this.store.watch().length || (await this.deps.isTrading(now)) !== true) return
    const { statuses, live } = await this.lines(true)
    if (!live) return
    const state = this.state()
    const today = beijing(now).date
    const fresh = newlyBeyond(statuses, state.lineSeen, today)
    if (!fresh.length) return
    const body = fresh.map(s => `- ${describeLine(s)}。${s.basis === 'close' ? '收盘才判定。' : ''}规则写的动作：${s.action}`).join('\n')
    await this.deps.notify('鸿鹄盯线：有线被越过', `${body}\n\n只是读数，不是指令。决定由策略方写，委员会可否决。`)
    this.store.saveDoc('state', { ...this.state(), lineSeen: { ...state.lineSeen, ...Object.fromEntries(fresh.map(s => [s.id, today])) } })
  }

  // ── 定时 ──

  private async runTask(task: ChainTask, now: Date): Promise<boolean> {
    const today = beijing(now).date
    if (task.id === 'margin') {
      const records = await this.pullMargin(now)
      const closed = this.lastClosed()
      // 上一交易日的融资公布了才算做完；没公布就在窗口内再试
      return records[0]!.asOf !== null && closed !== null && records[0]!.asOf >= closed
    }
    if (task.id.startsWith('alert-')) {
      const slot = DIGEST_SLOTS.find(s => `alert-${s.id}` === task.id)!
      // 开盘前判断不出今天是否开市，盘前那一份只按工作日算
      if (slot.id !== 'pre' && (await this.deps.isTrading(now)) !== true) return true
      if (this.store.digest(today, slot.id) === null) {
        await this.deps.notify(`鸿鹄：${slot.label}汇总未到`, `${today} ${slot.at} 的${slot.label}汇总，到 ${task.at} 还没有收到。数据照常在拉，页面上可以直接看读数。`)
      }
      return true
    }
    const trading = await this.deps.isTrading(now)
    if (trading !== true) return trading === false
    if (task.id === 'intraday') return (await this.pullIntraday(now)).ok > 0
    if (task.id === 'daily') {
      const record = await this.pullDaily(now)
      if (record.asOf !== today) return false
      // 有缺项或脚本没跑出来，就在窗口内再试：下一轮只补缺的那几只
      return (await this.runMainline(today, record.failed.length === 0)) && record.failed.length === 0
    }
    if (task.id === 'scan') {
      // 日线还没到今天就等下一轮
      return this.ensureScript('scan', today, now).state !== 'failed'
    }
    return true
  }

  /**
   * 收盘后跑主线脚本。脚本取不到数时不失败，而是带着缺项存一份（missing 字段）。
   * 带缺项的那份要不要重跑：等后端自己的拉数齐了再重跑，那说明来源恢复了；来源还断着时不去添乱。
   * 一天最多重跑 2 次。返回这一天的读数是否齐了。
   */
  async runMainline(date: string, pullComplete: boolean): Promise<boolean> {
    const have = this.store.scriptOutput('mainline', date)
    if (have === null) await this.runner.runNow('mainline', date)
    else if (mainlineIncomplete(have) && pullComplete && (this.redone[date] ?? 0) < MAX_REDO) {
      this.redone[date] = (this.redone[date] ?? 0) + 1
      this.deps.log(`主线脚本 ${date} 的读数带缺项，来源已恢复，重跑第 ${this.redone[date]} 次`)
      await this.runner.runNow('mainline', date, true)
    }
    const out = this.store.scriptOutput('mainline', date)
    return out !== null && !mainlineIncomplete(out)
  }

  async tick(now = new Date()): Promise<void> {
    if (this.busy) return
    this.busy = true
    try {
      for (const task of dueChainTasks(now, this.state().done, this.tried)) {
        this.tried[task.id] = now.getTime()
        const finished = await this.runTask(task, now)
        if (finished) this.store.saveDoc('state', { ...this.state(), done: { ...this.state().done, [task.id]: beijing(now).date } })
      }
      if (watchDue(now, this.lastWatch)) {
        this.lastWatch = now.getTime()
        await this.watchTick(now)
      }
    } catch (e) {
      this.deps.log(`链上定时任务出错：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      this.busy = false
    }
  }

  /** 把扫描脚本和随包的历史读数放进私有目录。不联网 */
  init(): void {
    const problem = this.runner.prepare()
    if (problem) this.deps.log(`扫描脚本没有就位：${problem}`)
  }

  start(intervalMs = 30_000): NodeJS.Timeout {
    void this.bootstrap().catch(e => { this.deps.log(`补历史出错：${e instanceof Error ? e.message : String(e)}`) })
    const timer = setInterval(() => { void this.tick() }, intervalMs)
    timer.unref()
    return timer
  }
}
