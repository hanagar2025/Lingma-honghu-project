/**
 * 每天的一整套：执行单 → 行情与融资 → 简报 → 记分牌 → 收盘后留底。
 * 页面和定时推送都走这一条，保证两处看到的是同一份结论。
 */
import type { ProducedCard } from './dailyDecision/produce'
import { briefCodes, buildBrief, type Brief } from './insight/brief'
import type { Store } from './intake/store'
import { collectMarket, INDEXES, type CollectOptions, type MarketData } from './market/data'
import { journalOf, scoreCodes, scoreMarkdown, type JournalDay, type TradeLog } from './scoreboard/score'

export interface Daily {
  brief: Brief
  market: MarketData
  /** 最近一个已收盘的交易日是不是今天 */
  closedToday: boolean
}

export async function runDaily(store: Store, produced: ProducedCard, opts: CollectOptions = {}): Promise<Daily> {
  const now = opts.now ?? new Date()
  const today = new Date(now.getTime() + 8 * 3600_000).toISOString().slice(0, 10)
  let journal = store.listJournal() as JournalDay[]
  const trades = store.readLog('trades') as TradeLog[]
  const market = await collectMarket([...briefCodes(produced.input), ...scoreCodes(journal, trades)], opts)
  const brief = buildBrief(produced.input, produced.card, market, today)

  const index = market.bars[INDEXES.shanghai]
  const closeDate = index?.[index.length - 1]?.date ?? null
  const closedToday = closeDate === today
  // 留底只在价格是收盘价时写（收盘后到次日开盘前）。当天的可以重写：收盘后账本更新了，以新账本为准
  const chinext = market.bars[INDEXES.chinext]
  const day = journalOf(produced.input, produced.card, closeDate, chinext?.[chinext.length - 1]?.close ?? null)
  if (day && (closedToday || !journal.some(j => j.date === day.date))) {
    store.saveJournal(day.date, day)
    journal = store.listJournal() as JournalDay[]
  }

  const prices: Record<string, number> = {}
  for (const [code, bars] of Object.entries(market.bars)) {
    const last = bars[bars.length - 1]
    if (last) prices[code] = last.close
  }
  brief.sections.splice(brief.sections.length - 1, 0, { id: 'score', title: '记分牌', markdown: scoreMarkdown(journal, trades, prices) })
  return { brief, market, closedToday }
}
