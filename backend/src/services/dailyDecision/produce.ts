/**
 * 按给定账本现算一张执行单，不落盘、不推送。服务器页面用这一条。
 * 与定时任务 run.ts 走同一套计算：账本 + 持仓价格 → 两源核对 → 执行单。
 */
import { buildCard, buildFailureCard, type DecisionCard } from './card'
import { buildDecisionInput, fetchLastBars } from './input'
import { beijingToday, type LedgerFile } from './ledger'
import { beijingMinutes, resolveSession } from './schedule'
import type { DecisionSession } from './types'
import { fetchSinaRaw, MARKET_INDEX, sinaSymbol, verifyInput, type SinaRaw } from './verify'

export interface ProducedCard {
  card: DecisionCard
  session: DecisionSession
  /** 北京时间 YYYY-MM-DD HH:mm */
  generatedAt: string
}

export async function produceCard(pf: LedgerFile | null, now = new Date()): Promise<ProducedCard> {
  const today = beijingToday(now)
  const session = resolveSession(undefined, beijingMinutes(now)) ?? 'POST_CLOSE'
  const generatedAt = new Date(now.getTime() + 8 * 3600_000).toISOString().slice(0, 16).replace('T', ' ')
  if (!pf) return { card: buildFailureCard(today, '还没有账本。请先在输入框发一张持仓截图'), session, generatedAt }
  try {
    const { bars, failed } = await fetchLastBars(pf.positions.map(p => p.code))
    const input = buildDecisionInput(pf, bars, failed, today)
    let sina: Record<string, SinaRaw> | null = null
    try {
      sina = await fetchSinaRaw([MARKET_INDEX, ...input.holdings.map(h => sinaSymbol(h.code))])
    } catch { /* 第二数据源取不到时由核对环节判为不下单 */ }
    const card = buildCard(input, verifyInput(input, sina, session), session, { today, time: generatedAt.slice(11) })
    return { card, session, generatedAt }
  } catch (e) {
    return { card: buildFailureCard(today, `行情读取失败（${e instanceof Error ? e.message : String(e)}）`), session, generatedAt }
  }
}
