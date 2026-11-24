/**
 * 定时推送。服务器自己按北京时间到点出单，不依赖任何外部定时任务。
 *
 *   09:20  开盘前   只在有指令时发：提醒今天要做的。融资余额 08:20 起拉取，这一单用的是定稿的资金分
 *   10:30  盘中     只在有指令时发：按实时价重算的股数
 *   15:50  收盘后   每个交易日都发：执行单 + 今天的变化 + 需要您做的。排在 15:35 的日线和主力净流入拉取之后，
 *                   这样当晚就能看到按当天收盘初算的资金分；初算成立的卖出条件只提示，次日开盘前定稿
 *
 * 另外，委员会确认一份新持仓后立即重算并发一次。
 * 是否交易日由新浪上证指数的行情日期判断；判断不出时不发，不猜。
 */
import { fetchSinaRaw, MARKET_INDEX } from './dailyDecision/verify'

export interface Slot { id: 'pre' | 'intra' | 'post'; at: string; always: boolean; label: string }

export const SLOTS: readonly Slot[] = [
  { id: 'pre', at: '09:20', always: false, label: '开盘前' },
  { id: 'intra', at: '10:30', always: false, label: '盘中' },
  { id: 'post', at: '15:50', always: true, label: '收盘后' },
]
const WINDOW_MINUTES = 25

const minutes = (hhmm: string): number => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5))

export function beijing(now: Date): { date: string; time: string; weekday: number } {
  const d = new Date(now.getTime() + 8 * 3600_000)
  return { date: d.toISOString().slice(0, 10), time: d.toISOString().slice(11, 16), weekday: d.getUTCDay() }
}

/** 此刻该跑哪些时段。done：时段 → 已跑过的日期 */
export function dueSlots(now: Date, done: Readonly<Record<string, string>>): Slot[] {
  const bj = beijing(now)
  if (bj.weekday === 0 || bj.weekday === 6) return []
  const t = minutes(bj.time)
  return SLOTS.filter(s => t >= minutes(s.at) && t < minutes(s.at) + WINDOW_MINUTES && done[s.id] !== bj.date)
}

export async function isTradingToday(now: Date, doFetch: typeof fetch = fetch): Promise<boolean | null> {
  try {
    const sina = await fetchSinaRaw([MARKET_INDEX], { fetchImpl: doFetch, backoffMs: 300 })
    const date = sina[MARKET_INDEX]?.date
    return date ? date === beijing(now).date : null
  } catch {
    return null
  }
}

export interface SchedulerHooks {
  /** 读写"哪个时段哪天跑过" */
  loadDone: () => Record<string, string>
  saveDone: (done: Record<string, string>) => void
  /** 到点后做的事。返回 false = 条件还不具备（例如行情日期还没切到今天），窗口内下一轮再试 */
  run: (slot: Slot, now: Date) => Promise<boolean>
  log: (line: string) => void
}

export function startScheduler(hooks: SchedulerHooks, intervalMs = 30_000): NodeJS.Timeout {
  let busy = false
  const tick = async (): Promise<void> => {
    if (busy) return
    busy = true
    try {
      const now = new Date()
      for (const slot of dueSlots(now, hooks.loadDone())) {
        const finished = await hooks.run(slot, now)
        if (finished) hooks.saveDone({ ...hooks.loadDone(), [slot.id]: beijing(now).date })
      }
    } catch (e) {
      hooks.log(`定时任务出错：${e instanceof Error ? e.message : String(e)}`)
    } finally {
      busy = false
    }
  }
  const timer = setInterval(() => { void tick() }, intervalMs)
  timer.unref()
  return timer
}
