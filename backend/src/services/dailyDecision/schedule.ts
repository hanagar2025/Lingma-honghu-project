import type { DecisionSession } from './types'

export function beijingMinutes(now = new Date()): number {
  return ((now.getUTCHours() + 8) % 24) * 60 + now.getUTCMinutes()
}

/**
 * 定时任务会被 GitHub 延迟（10/12 盘前晚了 54 分钟），所以按实际运行时刻校正：
 * 盘前单拖到开盘后就改按实时价出盘中复核；盘中复核拖到收盘后就不发，由收盘后那一轮出单，免得重复推送。
 * 返回 null = 本次不出单。
 */
export function resolveSession(requested: string | undefined, minutes: number): DecisionSession | null {
  const open = 9 * 60 + 30
  const close = 15 * 60
  if (requested === 'post') return 'POST_CLOSE'
  if (requested === 'pre' || requested === 'intra') {
    if (minutes < open) return 'PRE_OPEN'
    return minutes < close ? 'INTRADAY' : null
  }
  if (minutes < open) return 'PRE_OPEN'
  return minutes < close ? 'INTRADAY' : 'POST_CLOSE'
}
