/**
 * 按给定账本现算一张执行单，不推送。服务器页面和定时推送都用这一条。
 * 账本 + 持仓价格 → 两源核对 → 核对通过后套《半年计划》的规则（证据分、指令簿）→ 执行单。
 */
import { buildCard, buildFailureCard, type DecisionCard } from './card'
import { buildDecisionInput, fetchLastBars } from './input'
import { beijingToday, type LedgerFile } from './ledger'
import { buildPlan, type PlanContext } from './plan'
import type { BaseFile } from '../chain/types'
import { beijingMinutes, resolveSession } from './schedule'
import type { DecisionInput, DecisionSession } from './types'
import { fetchSinaRaw, MARKET_INDEX, sinaSymbol, verifyInput, type SinaRaw } from './verify'

export interface ProducedCard {
  card: DecisionCard
  /** 账本与行情都读得出时的决策输入；简报要用它算仓位 */
  input: DecisionInput | null
  session: DecisionSession
  /** 北京时间 YYYY-MM-DD HH:mm */
  generatedAt: string
}

/** 链上数据这一侧：净值基准、日线与资金序列、盯线、指令簿。不给时执行单写明“卖出条件核对不了” */
export interface PlanSource {
  base: () => BaseFile | null
  context: () => PlanContext
}

export async function produceCard(pf: LedgerFile | null, now = new Date(), source?: PlanSource): Promise<ProducedCard> {
  const today = beijingToday(now)
  const session = resolveSession(undefined, beijingMinutes(now)) ?? 'POST_CLOSE'
  const generatedAt = new Date(now.getTime() + 8 * 3600_000).toISOString().slice(0, 16).replace('T', ' ')
  if (!pf) return { card: buildFailureCard(today, '还没有账本。请先在输入框发一张持仓截图'), input: null, session, generatedAt }
  try {
    const { bars, failed } = await fetchLastBars(pf.positions.map(p => p.code))
    const input = buildDecisionInput(pf, bars, failed, today, source?.base() ?? null)
    let sina: Record<string, SinaRaw> | null = null
    try {
      sina = await fetchSinaRaw([MARKET_INDEX, ...input.holdings.map(h => sinaSymbol(h.code))])
    } catch { /* 第二数据源取不到时由核对环节判为不下单 */ }
    const v = verifyInput(input, sina, session)
    // 价格核对没通过时不动指令簿：只把原有的指令列出来
    if (source) input.plan = buildPlan(input, session, source.context(), { sync: v.ok, now: `${generatedAt}:00` })
    const card = buildCard(input, v, session, { today, time: generatedAt.slice(11) })
    return { card, input, session, generatedAt }
  } catch (e) {
    return { card: buildFailureCard(today, `行情读取失败（${e instanceof Error ? e.message : String(e)}）`), input: null, session, generatedAt }
  }
}
