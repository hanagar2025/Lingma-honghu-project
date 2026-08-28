/** 北京日历与快照新鲜度。只读已有日期，不产生判断。 */

export function beijingNow(now = new Date()): Date {
  return new Date(now.getTime() + 8 * 3600 * 1000)
}

export function beijingToday(now = new Date()): string {
  return beijingNow(now).toISOString().slice(0, 10)
}

export function daysBehind(tradeDate?: string | null, now = new Date()): number | null {
  if (!tradeDate) return null
  const today = beijingToday(now)
  const a = Date.parse(`${today}T00:00:00Z`)
  const b = Date.parse(`${tradeDate}T00:00:00Z`)
  if (Number.isNaN(a) || Number.isNaN(b)) return null
  return Math.round((a - b) / 86400000)
}

export function isBeijingWeekend(now = new Date()): boolean {
  const dow = beijingNow(now).getUTCDay()
  return dow === 0 || dow === 6
}

/** 下一档自动更新。交易日 09:20 盘前、15:10 盘后。 */
export function nextClockSlot(now = new Date()): string {
  const bj = beijingNow(now)
  const mins = bj.getUTCHours() * 60 + bj.getUTCMinutes()
  const weekend = isBeijingWeekend(now)
  if (!weekend && mins < 9 * 60 + 20) return '今日 09:20 盘前'
  if (!weekend && mins < 15 * 60 + 10) return '今日 15:10 盘后'
  return '下一交易日 09:20 盘前'
}

export function snapshotClock(tradeDate?: string | null, now = new Date()): {
  beijingToday: string
  staleDays: number | null
  isToday: boolean
  weekend: boolean
  nextSlot: string
} {
  const stale = daysBehind(tradeDate, now)
  return {
    beijingToday: beijingToday(now),
    staleDays: stale,
    isToday: stale === 0,
    weekend: isBeijingWeekend(now),
    nextSlot: nextClockSlot(now),
  }
}
