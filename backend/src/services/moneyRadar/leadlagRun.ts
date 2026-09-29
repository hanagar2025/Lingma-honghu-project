/**
 * 资金驾驶舱（R-01）· 资金信号时效检验（运行入口）
 *
 *   npm run money:leadlag
 *
 * 用每日运行同一份缓存数据；结果写 data/leadlag/，每次重跑覆盖当日档。
 */

import { fileURLToPath } from 'node:url'
import { VERDICT_TEXT, collectEvents, eventStudy, replayObjects, splitWindow } from './backtest'
import { DEFAULT_LIVE, industryObjects, loadLiveDataSet } from './live'
import {
  LEADLAG_REGISTERED_ON, SIGNALS, UNIVERSES,
  buildPanel, concludeLeadLag, renderLeadLag, saveLeadLag, slowGroups, studySignal, studyTiming, universeObjects,
  type EventDelayRow, type LeadLagReport, type SignalId, type SignalResult, type UniverseId,
} from './leadlag'
import { loadSlowData, studySlow } from './slowMoney'
import { entryObjects } from './radar'

async function main(): Promise<void> {
  const log = (s: string) => process.stderr.write(`${s}\n`)
  const live = await loadLiveDataSet({ ...DEFAULT_LIVE, log })
  const ds = live.ds
  const industries = industryObjects(live.industries)
  const boardOf: Record<string, string> = {}
  for (const i of live.industries) for (const c of i.members) boardOf[c] = i.name
  const uni = universeObjects(ds, live.names, boardOf, industries)

  const results: SignalResult[] = []
  const universes = {} as LeadLagReport['universes']
  for (const u of Object.keys(UNIVERSES) as UniverseId[]) {
    const t0 = Date.now()
    const panel = buildPanel(u, uni[u], ds)
    universes[u] = { text: UNIVERSES[u], size: panel.ids.length }
    for (const s of Object.keys(SIGNALS) as SignalId[]) results.push(studySignal(panel, s, ds))
    log(`· ${UNIVERSES[u]}：${panel.ids.length} 个，用时 ${((Date.now() - t0) / 1000).toFixed(0)} 秒`)
  }
  const timing = studyTiming(ds)

  const sd = await loadSlowData(ds, log, { etfDays: DEFAULT_LIVE.etfDays, marketCap: live.marketCap })
  const groups = slowGroups(ds, live.names, boardOf)
  const slow = studySlow(sd, ds, Object.fromEntries(
    Object.entries(groups).map(([k, g]) => [k === 'ALL' ? '全部' : k === 'STAR' ? '科创板' : '科技', { text: g.text, codes: new Set(g.codes) }])))

  const objs = entryObjects(industries)
  const replayed = replayObjects(ds, [...objs[1], ...objs[2], ...objs[3]])
  const split = splitWindow(ds.dates.length)
  const events = collectEvents(replayed, ds, split.outOfSample[0], split.outOfSample[1])
  const t0 = eventStudy(events, replayed, ds, 0)
  const t1 = eventStudy(events, replayed, ds, 1)
  const eventDelay: EventDelayRow[] = t0.map((a, i) => {
    const b = t1[i]!
    return {
      rule: a.rule, horizon: a.horizon, n: b.n, meanT0: a.mean, meanT1: b.mean, ciT1: b.ci,
      verdictT0: VERDICT_TEXT[a.verdict], verdictT1: VERDICT_TEXT[b.verdict],
    }
  })

  const firstSignal = ds.dates.findIndex((_, t) => ds.market[t]?.marginTotal !== null)
  const report: LeadLagReport = {
    id: 'R-01-leadlag',
    registeredOn: LEADLAG_REGISTERED_ON,
    runOn: new Date().toISOString().slice(0, 10),
    dataThrough: ds.dates.at(-1)!,
    period: [ds.dates[Math.max(0, firstSignal)]!, ds.dates.at(-1)!],
    signals: SIGNALS,
    universes,
    results,
    timing,
    eventDelay,
    slow,
    conclusion: concludeLeadLag(results, timing, eventDelay),
  }
  process.stdout.write(`${renderLeadLag(report)}\n`)
  log(`\n已写入：${saveLeadLag(report)}`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(e => {
    process.stderr.write(`时效检验失败：${e instanceof Error ? e.stack : String(e)}\n`)
    process.exit(1)
  })
}
