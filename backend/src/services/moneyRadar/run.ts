/**
 * 资金驾驶舱（R-01）· 盘后运行
 *
 *   npm run money
 *
 * 抓取公开数据（有缓存只补增量）→ 计算三个入口 → 打印文本版 → 写网页快照。
 * 网页快照写到 frontend/public/data/money.json，驾驶舱页面 /money 读它。
 *
 * 建议时点：T 日约 16:30 跑一次（成交额、价格齐全）；T+1 约 08:45 再跑一次
 * （融资余额、ETF 份额发布后，背离判定第 3 项才完整）。
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { CALIBRATION, THRESHOLDS } from './config'
import { replayObjects, thresholdsHash } from './backtest'
import { loadLatestCalibration } from './calibrate'
import { DEFAULT_LIVE, industryObjects, loadLiveDataSet } from './live'
import { buildMoneyCockpitView, entryObjects, renderMoneyCockpit } from './radar'
import { loadLedger, saveLedger, summarize, updateLedger } from './shadow'

const HERE = dirname(fileURLToPath(import.meta.url))
export const MONEY_SNAPSHOT_FILE = process.env.MONEY_SNAPSHOT_FILE
  ?? join(HERE, '..', '..', '..', '..', 'frontend', 'public', 'data', 'money.json')

async function main(): Promise<void> {
  const t0 = Date.now()
  const log = (s: string) => process.stderr.write(`${s}\n`)
  log('资金驾驶舱：装载公开数据')
  const live = await loadLiveDataSet({ ...DEFAULT_LIVE, log })

  const unusable = live.industries.filter(i => !i.usable)
  const lastDate = live.ds.dates.at(-1) ?? ''
  const marginMissingToday = live.ds.provenance.some(p => p.kind === 'MARGIN' && p.status === 'PENDING')
  const dataNotes = [
    `个股 ${live.coverage.stocksFetched}/${live.coverage.stocksWanted} 只取到日 K`
      + (live.coverage.failed.length ? `，${live.coverage.failed.length} 只抓取失败（行业按覆盖率处理）` : ''),
    `申万二级行业 ${live.industries.length - unusable.length}/${live.industries.length} 个可用`
      + (unusable.length ? `；覆盖率不足 95% 不计入：${unusable.map(i => i.name).join('、')}` : ''),
    '两市成交额 = 上证指数 + 深证综指；北交所不在其中，为口径一致不纳入份额计算',
    marginMissingToday
      ? `融资余额 T+1 约 08:30 发布，${lastDate} 当日融资余额尚未发布，背离判定第 3 项以最近已发布日为准`
      : '融资余额已更新到最新交易日',
    '深市国家队 ETF（7 只）没有可访问的份额历史来源，从接入之日起逐日存档积累；温度计暂只用沪市 ETF',
    '个股成交额来自腾讯日 K，暂无第二来源交叉校验（东方财富行情接口在本环境不可用）',
  ]

  const industries = industryObjects(live.industries)
  const view = buildMoneyCockpitView(live.ds, 'LIVE', { names: live.names, industries, dataNotes })

  const calibration = loadLatestCalibration()
  if (calibration) view.calibration = calibration

  // 影子运行：阈值冻结之后才记台账；阈值指纹与冻结记录对不上时拒绝记账 —— 那说明阈值被改过
  if (THRESHOLDS.status === 'FROZEN' && CALIBRATION) {
    const hash = thresholdsHash()
    if (hash !== CALIBRATION.thresholdsHash) {
      log(`⚠ 阈值指纹 ${hash} 与冻结记录 ${CALIBRATION.thresholdsHash} 不一致：阈值在冻结后被改动，影子台账本次不更新`)
    } else {
      const objs = entryObjects(industries)
      const replayed = replayObjects(live.ds, [...objs[1], ...objs[2], ...objs[3]])
      const ledger = updateLedger(loadLedger(), replayed, live.ds, CALIBRATION.frozenOn, hash)
      saveLedger(ledger)
      view.shadow = summarize(ledger)
      log(`· 影子台账：累计 ${ledger.events.length} 条事件（自 ${ledger.startedOn} 起）`)
    }
  }

  process.stdout.write(renderMoneyCockpit(view))
  mkdirSync(dirname(MONEY_SNAPSHOT_FILE), { recursive: true })
  writeFileSync(MONEY_SNAPSHOT_FILE, JSON.stringify(view), 'utf-8')
  log(`\n已写入网页快照：${MONEY_SNAPSHOT_FILE}（${(JSON.stringify(view).length / 1024).toFixed(0)} KB，用时 ${((Date.now() - t0) / 1000).toFixed(0)} 秒）`)
}

main().catch(e => {
  process.stderr.write(`资金驾驶舱运行失败：${e instanceof Error ? e.stack : String(e)}\n`)
  process.exit(1)
})
