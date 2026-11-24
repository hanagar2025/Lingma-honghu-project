/**
 * 调用两个扫描脚本，原样保存输出。脚本的逻辑一行不改：
 *
 *   scripts/ai-mainline-map.py   环节排序、资金状态、S1–S5 触发表
 *   scripts/market-scan.py       全市场宽度、行业强弱、融资、链条分环节
 *
 * 脚本把读数存在自己旁边的「战略组合2026-2030/数据/」里，并靠前几天存下的读数计连续天数。
 * 服务器上程序目录是只读的，所以每次运行前把脚本拷到私有目录 <DATA_DIR>/chain/py/scripts/，
 * 读数就落在 <DATA_DIR>/chain/py/ 下面，逐日累积。随包带来的历史读数只在首次补进去，不覆盖。
 *
 * 脚本只用 Python 标准库，需要 Python 3.8 以上。子进程拿不到任何口令。
 */
import { spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beijingStamp } from '../intake/store'
import type { ChainStore } from './store'

export type ScriptKind = 'mainline' | 'scan'

// 主线脚本在东方财富全断的时候最慢：每只股票的日线和主力净流入都要试满再放弃，2026-11-24 实测约 9 分钟
const SPEC: Record<ScriptKind, { file: string; saveDir: string[]; timeoutMs: number }> = {
  mainline: { file: 'ai-mainline-map.py', saveDir: ['战略组合2026-2030', '数据', 'AI主线'], timeoutMs: 15 * 60_000 },
  scan: { file: 'market-scan.py', saveDir: ['战略组合2026-2030', '数据', '全市场扫描'], timeoutMs: 25 * 60_000 },
}

export interface JobState {
  kind: ScriptKind
  date: string
  state: 'running' | 'done' | 'failed'
  startedAt: string
  finishedAt: string | null
  error: string | null
}

export type Spawn = (command: string, args: string[], opts: { cwd: string; env: Record<string, string>; timeoutMs: number }) => Promise<{ code: number | null; stdout: string; stderr: string }>

const realSpawn: Spawn = (command, args, opts) => new Promise(done => {
  const child = spawn(command, args, { cwd: opts.cwd, env: opts.env, stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = ''
  let stderr = ''
  let timedOut = false
  const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL') }, opts.timeoutMs)
  child.stdout.on('data', d => { stdout += String(d) })
  child.stderr.on('data', d => { stderr = (stderr + String(d)).slice(-4000) })
  child.on('error', e => { clearTimeout(timer); done({ code: null, stdout, stderr: `${stderr}\n${e.message}` }) })
  // 超时被终止和 Python 起不来是两回事，分开报
  child.on('close', code => { clearTimeout(timer); done(timedOut ? { code: 124, stdout, stderr: `运行超过 ${Math.round(opts.timeoutMs / 60_000)} 分钟，已终止` } : { code, stdout, stderr }) })
})

/** 脚本原件在哪里：发布包里是程序旁边的 py/，开发时是仓库根目录 */
export function findPyHome(env: Record<string, string | undefined> = process.env): string | null {
  const here = dirname(fileURLToPath(import.meta.url))
  const candidates = [env.HONGHU_PY_DIR, join(here, 'py'), resolve(here, '..', '..', '..', '..')].filter((p): p is string => !!p)
  return candidates.find(p => existsSync(join(p, 'scripts', SPEC.mainline.file))) ?? null
}

export class ScriptRunner {
  private readonly jobs = new Map<string, JobState>()
  private readonly work: string

  constructor(
    private readonly store: ChainStore,
    private readonly opts: { pyHome?: string | null; python?: string; spawn?: Spawn; log?: (line: string) => void } = {},
  ) {
    this.work = join(store.dir, 'py')
  }

  /** 把脚本和随包的历史读数放进私有目录。启动时做一次，每次运行前再做一次 */
  prepare(): string | null {
    const home = this.opts.pyHome === undefined ? findPyHome() : this.opts.pyHome
    if (!home) return '发布包里没有扫描脚本'
    mkdirSync(join(this.work, 'scripts'), { recursive: true, mode: 0o700 })
    mkdirSync(join(this.work, 'cache'), { recursive: true, mode: 0o700 })
    for (const [kind, spec] of Object.entries(SPEC) as [ScriptKind, (typeof SPEC)[ScriptKind]][]) {
      copyFileSync(join(home, 'scripts', spec.file), join(this.work, 'scripts', spec.file))
      const seed = join(home, ...spec.saveDir)
      const target = join(this.work, ...spec.saveDir)
      mkdirSync(target, { recursive: true, mode: 0o700 })
      if (!existsSync(seed)) continue
      for (const f of readdirSync(seed).filter(n => n.endsWith('.json'))) {
        if (!existsSync(join(target, f))) copyFileSync(join(seed, f), join(target, f))
        // 主线读数按天接续（连续天数、S1–S5）：随包带来的那几天直接可查。只认发布包里的，不认运行目录里的残留
        const date = f.slice(0, -5)
        if (kind === 'mainline' && /^\d{4}-\d{2}-\d{2}$/.test(date) && this.store.scriptOutput(kind, date) === null) {
          this.store.saveScriptOutput(kind, date, readFileSync(join(seed, f), 'utf-8'), null)
        }
      }
    }
    return null
  }

  private async run(kind: ScriptKind, date: string): Promise<string | null> {
    const problem = this.prepare()
    if (problem) return problem
    const spec = SPEC[kind]
    const args = [join(this.work, 'scripts', spec.file), '--last', date, '--save', ...(kind === 'scan' ? ['--cache', join(this.work, 'cache')] : [])]
    const env = { PATH: process.env.PATH ?? '/usr/bin:/bin', LANG: 'C.UTF-8', PYTHONIOENCODING: 'utf-8', PYTHONDONTWRITEBYTECODE: '1' }
    const result = await (this.opts.spawn ?? realSpawn)(this.opts.python ?? 'python3', args, { cwd: this.work, env, timeoutMs: spec.timeoutMs })
    if (result.code === null) return `Python 运行不了（服务器上要有 Python 3.8 以上）：${result.stderr.trim().slice(-300)}`
    if (result.code !== 0) return `脚本退出码 ${result.code}：${result.stderr.trim().slice(-300)}`
    const saved = join(this.work, ...spec.saveDir, `${date}.json`)
    if (!existsSync(saved)) return `脚本没有存出 ${date} 的读数（行情可能还没更新到这一天）`
    this.store.saveScriptOutput(kind, date, readFileSync(saved, 'utf-8'), result.stdout)
    return null
  }

  /** 这一天这个脚本此刻的运行状态；没跑过为 null */
  job(kind: ScriptKind, date: string): JobState | null {
    return this.jobs.get(`${kind}:${date}`) ?? null
  }

  /** 某天的输出有了就直接说有；正在跑就说正在跑；否则现在开始跑，不等它跑完。redo：已有的那份带着缺项，重跑一遍盖掉它 */
  ensure(kind: ScriptKind, date: string, now = new Date(), redo = false): { state: 'ready' | 'running' | 'failed'; job: JobState | null } {
    if (!redo && this.store.scriptOutput(kind, date) !== null) return { state: 'ready', job: this.jobs.get(`${kind}:${date}`) ?? null }
    const key = `${kind}:${date}`
    const have = this.jobs.get(key)
    if (have?.state === 'running') return { state: 'running', job: have }
    // 刚失败过的 2 分钟内不重跑，把原因交回去
    if (have?.state === 'failed' && have.finishedAt && now.getTime() - Date.parse(`${have.finishedAt.replace(' ', 'T')}+08:00`) < 120_000) return { state: 'failed', job: have }
    const job: JobState = { kind, date, state: 'running', startedAt: beijingStamp(now), finishedAt: null, error: null }
    this.jobs.set(key, job)
    void this.run(kind, date)
      .catch(e => (e instanceof Error ? e.message : String(e)))
      .then(error => {
        job.state = error ? 'failed' : 'done'
        job.error = error
        job.finishedAt = beijingStamp()
        this.store.logRun({ task: `script-${kind}`, at: job.finishedAt, asOf: date, ok: error ? 0 : 1, failed: error ? [error] : [], notes: [] })
        this.opts.log?.(`脚本 ${SPEC[kind].file}（${date}）：${error ?? '完成'}`)
      })
    return { state: 'running', job }
  }

  /** 等到跑完。定时任务和自检用 */
  async runNow(kind: ScriptKind, date: string, redo = false): Promise<JobState | null> {
    const { job } = this.ensure(kind, date, new Date(), redo)
    // job 跑完时在原地改状态
    while (job?.state === 'running') await new Promise(r => setTimeout(r, 200))
    return job
  }
}

/**
 * ai-mainline-map.py 自己记下的缺项（存档里的 missing 字段）。
 * 日线两家都取不到、主力净流入缺、主力过半缺失而沿用了旧排序，都算这份读数不全。
 * 融资缺不算：不是两融标的的股票本来就没有。
 */
export function mainlineIncomplete(output: unknown): boolean {
  const m = (output as { missing?: { kline?: unknown[]; flow?: unknown[]; flow_short?: unknown } } | null)?.missing
  if (!m) return false
  return m.flow_short === true || (m.kline?.length ?? 0) > 0 || (m.flow?.length ?? 0) > 0
}
