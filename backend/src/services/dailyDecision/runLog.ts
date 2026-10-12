/**
 * 定时运行台账：每轮由工作流追加一行到 share/decision/run-log.csv，这里只做统计。
 * 被 GitHub 整轮跳过（或在 concurrency 组里被取代）的那一轮不会留下记录，所以「漏跑」靠
 * 对照 SLOTS 里应有的轮次找出来，而不是靠记录本身。
 */
import { readFileSync } from 'node:fs'

export type RunSessionKey = 'pre' | 'intra' | 'post'

export interface RunRow {
  date: string
  session: RunSessionKey
  trigger: 'schedule' | 'manual'
  planned: string
  started: string
  delayMin: number | null
  cardStep: string
  pushed: boolean
  runId: string
}

/** 必须与 .github/workflows/daily-decision.yml 的 cron 保持一致（北京时间，周一至周五）。since 起才计应有轮次。 */
export const SLOTS: { session: RunSessionKey; planned: string; since: string }[] = [
  { session: 'pre', planned: '07:00', since: '2026-10-13' },
  { session: 'intra', planned: '13:30', since: '2026-10-13' },
  { session: 'post', planned: '15:40', since: '2026-10-12' },
]

/** 计划时刻过了这么久仍无记录，才算漏跑；没到这个时限的只算「未到」。 */
export const MISSING_AFTER_MIN = 180

export const RUN_LOG_HEADER = 'date,session,trigger,planned,started,delay_min,card_step,pushed,run_id'

export function parseRunLog(text: string): RunRow[] {
  return text.split(/\r?\n/).slice(1).filter(l => l.trim()).map(l => {
    const [date, session, trigger, planned, started, delay, cardStep, pushed, runId] = l.split(',')
    return {
      date, session: session as RunSessionKey, trigger: trigger === 'schedule' ? 'schedule' : 'manual',
      planned, started, delayMin: delay === '' || delay === undefined ? null : Number(delay),
      cardStep, pushed: pushed === '1', runId,
    }
  })
}

function beijingParts(d: Date): { date: string; minutes: number; weekday: number } {
  const b = new Date(d.getTime() + 8 * 3600_000)
  return { date: b.toISOString().slice(0, 10), minutes: b.getUTCHours() * 60 + b.getUTCMinutes(), weekday: b.getUTCDay() }
}

function quantile(sorted: number[], q: number): number {
  return sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)]
}

export interface SessionStats {
  session: RunSessionKey
  runs: number
  median: number | null
  p90: number | null
  max: number | null
  over30: number
  over60: number
}

/** gh run list --json databaseId,event,createdAt,conclusion 的一项 */
export interface GithubRun {
  databaseId: number
  event: string
  createdAt: string
  conclusion: string
}

/**
 * 台账里没有的那一轮，对照 GitHub 运行列表分三种：
 * NOT_STARTED 整轮没启动（调度问题）；STARTED_NO_RECORD 启动了但没留下记录（留痕问题，附运行号）；
 * UNCHECKED 没有提供运行列表，无法区分。
 */
export type MissingCause = 'NOT_STARTED' | 'STARTED_NO_RECORD' | 'UNCHECKED'

export interface MissingSlot {
  date: string
  session: RunSessionKey
  cause: MissingCause
  run?: GithubRun
}

export interface RunLogSummary {
  stats: SessionStats[]
  expected: number
  missing: MissingSlot[]
  failures: RunRow[]
  notPushed: RunRow[]
  manual: number
}

/** 台账外的定时运行归到它之前最近的、且在 MISSING_AFTER_MIN 窗口内的那一轮（盘中 13:30 与收盘后 15:40 的窗口重叠）。 */
function unloggedRunsBySlot(rows: RunRow[], runs: GithubRun[]): Map<string, GithubRun> {
  const logged = new Set(rows.map(r => r.runId))
  const out = new Map<string, GithubRun>()
  for (const run of runs) {
    if (run.event !== 'schedule' || logged.has(String(run.databaseId))) continue
    const b = beijingParts(new Date(run.createdAt))
    let best: { session: RunSessionKey; start: number } | null = null
    for (const slot of SLOTS) {
      const [h, m] = slot.planned.split(':').map(Number)
      const start = h * 60 + m
      if (b.date < slot.since || b.minutes < start || b.minutes >= start + MISSING_AFTER_MIN) continue
      if (!best || start > best.start) best = { session: slot.session, start }
    }
    if (best) out.set(`${b.date}|${best.session}`, run)
  }
  return out
}

export function summarize(rows: RunRow[], now = new Date(), githubRuns?: GithubRun[]): RunLogSummary {
  const unlogged = githubRuns ? unloggedRunsBySlot(rows, githubRuns) : new Map<string, GithubRun>()
  const scheduled = rows.filter(r => r.trigger === 'schedule')
  const stats = SLOTS.map(({ session }) => {
    const d = scheduled.filter(r => r.session === session && r.delayMin !== null).map(r => r.delayMin as number).sort((a, b) => a - b)
    return {
      session, runs: d.length,
      median: d.length ? quantile(d, 0.5) : null,
      p90: d.length ? quantile(d, 0.9) : null,
      max: d.length ? d[d.length - 1] : null,
      over30: d.filter(x => x > 30).length,
      over60: d.filter(x => x > 60).length,
    }
  })

  const today = beijingParts(now)
  const seen = new Set(scheduled.map(r => `${r.date}|${r.session}`))
  const missing: RunLogSummary['missing'] = []
  let expected = 0
  for (const slot of SLOTS) {
    const [h, m] = slot.planned.split(':').map(Number)
    for (let t = Date.parse(`${slot.since}T00:00:00Z`); ; t += 86400_000) {
      const date = new Date(t).toISOString().slice(0, 10)
      if (date > today.date) break
      const weekday = new Date(t).getUTCDay()
      if (weekday === 0 || weekday === 6) continue
      if (date === today.date && today.minutes < h * 60 + m + MISSING_AFTER_MIN) continue
      expected++
      const key = `${date}|${slot.session}`
      if (seen.has(key)) continue
      const run = unlogged.get(key)
      missing.push({
        date, session: slot.session, run,
        cause: run ? 'STARTED_NO_RECORD' : githubRuns ? 'NOT_STARTED' : 'UNCHECKED',
      })
    }
  }

  return {
    stats, expected, missing,
    failures: rows.filter(r => r.cardStep !== 'success'),
    notPushed: rows.filter(r => r.cardStep === 'success' && !r.pushed),
    manual: rows.filter(r => r.trigger === 'manual').length,
  }
}

const LABEL: Record<RunSessionKey, string> = { pre: '盘前', intra: '盘中复核', post: '收盘后' }
const CAUSE_LABEL: Record<MissingCause, string> = {
  NOT_STARTED: 'GitHub 未启动（调度漏跑）',
  STARTED_NO_RECORD: '已启动但未留痕（留痕失败）',
  UNCHECKED: '未核对 GitHub 运行列表（无法区分）',
}

export function renderSummary(s: RunLogSummary): string {
  const fmt = (v: number | null) => (v === null ? '—' : `${v}`)
  const lines = [
    '| 轮次 | 定时运行次数 | 延迟中位数（分） | 90% 分位 | 最大 | 超 30 分钟 | 超 60 分钟 |',
    '|---|---|---|---|---|---|---|',
    ...s.stats.map(x => `| ${LABEL[x.session]} | ${x.runs} | ${fmt(x.median)} | ${fmt(x.p90)} | ${fmt(x.max)} | ${x.over30} | ${x.over60} |`),
    '',
    `应有定时轮次 ${s.expected}，台账无记录 ${s.missing.length}`,
    ...(['NOT_STARTED', 'STARTED_NO_RECORD', 'UNCHECKED'] as MissingCause[]).map(cause => {
      const list = s.missing.filter(m => m.cause === cause)
      const items = list.map(m => `${m.date} ${LABEL[m.session]}` + (m.run ? `（运行 ${m.run.databaseId}，结论 ${m.run.conclusion || '进行中'}）` : ''))
      return `- ${CAUSE_LABEL[cause]} ${list.length}` + (items.length ? `：${items.join('；')}` : '')
    }),
    `执行单步骤失败 ${s.failures.length}` + (s.failures.length ? `：${s.failures.map(r => `${r.date} ${r.session}（${r.cardStep}）`).join('；')}` : ''),
    `运行成功但未推送 ${s.notPushed.length}（休市跳过或盘中复核拖到收盘后不发）`,
    `手动运行 ${s.manual}`,
  ]
  return lines.join('\n')
}

export function loadRunLog(path: string): RunRow[] {
  return parseRunLog(readFileSync(path, 'utf8'))
}
