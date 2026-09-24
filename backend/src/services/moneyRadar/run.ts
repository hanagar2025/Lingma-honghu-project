/**
 * 资金驾驶舱（R-01）· 每日运行
 *
 *   npm run money
 *
 * 抓取公开数据（有缓存只补增量）→ 计算三个入口 → 累计提醒 → 打印文本版 → 写网页快照与 Agent 文件。
 *
 * 排程（北京时间，交易日）：
 *   09:20  盘前：T-1 的融资余额与 ETF 份额已发布（约 08:30），昨日提醒的方向性确认定稿
 *   15:10  收盘初版：只刷新页面，不记账（科创板盘后交易到 15:30，成交额未定稿）
 *   16:35  收盘定稿：记影子台账与提醒台账，生成通知
 *
 * 环境变量：
 *   MONEY_LEDGER_WRITE=0   不写台账（部署后 Mac 作备用时用，台账以服务器为准）
 *   OBSIDIAN_VAULT=路径     同时写 Obsidian 笔记"鸿鹄/资金提醒.md"
 */

import { execSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildMoneyAgentShare } from './agentShare'
import { ALERT_RULES, alertRulesHash, buildAlertContext, buildAlerts, cardLine } from './alerts'
import { appendEvents, emptyLedger, loadAlertLedger, saveAlertLedger, updateFailures } from './alertLedger'
import { CALIBRATION, THRESHOLDS } from './config'
import { replayObjects, thresholdsHash } from './backtest'
import { loadLatestCalibration } from './calibrate'
import { DEFAULT_LIVE, industryObjects, loadLiveDataSet } from './live'
import { buildMoneyCockpitView, entryObjects, renderMoneyCockpit } from './radar'
import { isIntraday, loadLedger, saveLedger, summarize, updateLedger } from './shadow'

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
      ? `融资余额 T+1 约 08:30 发布，${lastDate} 当日融资余额尚未发布，方向性判断以最近已发布日为准`
      : '融资余额已更新到最新交易日',
    '深市国家队 ETF（7 只）没有可访问的份额历史来源，从接入之日起逐日存档积累；温度计暂只用沪市 ETF',
    '个股成交额来自腾讯日 K，暂无第二来源交叉校验（东方财富行情接口在本环境不可用）',
  ]

  const industries = industryObjects(live.industries)
  const view = buildMoneyCockpitView(live.ds, 'LIVE', { names: live.names, industries, dataNotes })
  const calibration = loadLatestCalibration()
  if (calibration) view.calibration = calibration

  // 当日数据未定稿（16:30 前）：可以刷新页面，但不记台账 —— 台账只增不改，半截数据记进去就改不掉了
  const intraday = isIntraday(lastDate)
  const writeLedgers = !intraday && process.env.MONEY_LEDGER_WRITE !== '0'
  if (intraday) {
    view.dataNotes.unshift(`盘中快照：${lastDate} 当日成交额尚未定稿（16:30 前），状态与提醒仅供参考；台账本次不记账`)
    log('· 当日数据未定稿：台账本次不记账（16:30 后再跑）')
  } else if (!writeLedgers) {
    log('· MONEY_LEDGER_WRITE=0：本机作备用，不写台账')
  }

  const objs = entryObjects(industries)
  const replayed = replayObjects(live.ds, [...objs[1], ...objs[2], ...objs[3]])

  // 影子运行：阈值指纹与冻结记录对不上时拒绝记账 —— 那说明阈值被改过
  if (THRESHOLDS.status === 'FROZEN' && CALIBRATION) {
    const hash = thresholdsHash()
    if (hash !== CALIBRATION.thresholdsHash) {
      log(`⚠ 阈值指纹 ${hash} 与冻结记录 ${CALIBRATION.thresholdsHash} 不一致：阈值在冻结后被改动，影子台账本次不更新`)
    } else {
      const prev = loadLedger()
      const ledger = writeLedgers ? updateLedger(prev, replayed, live.ds, CALIBRATION.frozenOn, hash) : prev
      if (writeLedgers && ledger) saveLedger(ledger)
      if (ledger) {
        view.shadow = summarize(ledger)
        log(`· 影子台账：累计 ${ledger.events.length} 条事件（自 ${ledger.startedOn} 起）`)
      }
    }
  }

  // 累计提醒
  const rulesHash = alertRulesHash()
  const names = new Map<string, string>(replayed.map(o => [o.id, o.name]))
  for (const [c, n] of Object.entries(live.names)) names.set(c, n)
  const aLedger = loadAlertLedger() ?? emptyLedger(lastDate, rulesHash)
  const failRatio = live.coverage.stocksWanted ? live.coverage.failed.length / live.coverage.stocksWanted : 0
  const anomalies = updateFailures(aLedger, live.ds.provenance, lastDate, failRatio)
  const { view: alerts, life } = buildAlerts(buildAlertContext(live.ds, replayed), names, anomalies)
  view.alerts = alerts
  if (rulesHash !== aLedger.rulesHash) {
    log(`⚠ 提醒档位指纹 ${rulesHash} 与台账登记 ${aLedger.rulesHash} 不一致：提醒档位在登记后被改动，提醒台账本次不追加`)
  } else if (writeLedgers) {
    appendEvents(aLedger, life, names)
    saveAlertLedger(aLedger)
  } else if (process.env.MONEY_LEDGER_WRITE !== '0') {
    saveAlertLedger(aLedger)
  }
  log(`· 今日提醒 ${alerts.cards.length} 张（展开 ${alerts.cards.filter(c => c.expanded).length}），今日解除 ${alerts.resolvedToday.length}，临时观察池 ${alerts.tempPool.length}`)

  process.stdout.write(renderMoneyCockpit(view))
  process.stdout.write(`\n  ── 今日提醒 ──\n${alerts.cards.filter(c => c.expanded).map(c => `  ${cardLine(c)}`).join('\n')}\n`)

  const dir = dirname(MONEY_SNAPSHOT_FILE)
  mkdirSync(dir, { recursive: true })
  writeFileSync(MONEY_SNAPSHOT_FILE, JSON.stringify(view), 'utf-8')
  const commit = (() => { try { return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() } catch { return 'unknown' } })()
  const agentMd = buildMoneyAgentShare(view, { intraday, commit })
  writeFileSync(join(dir, 'money.agent.md'), agentMd, 'utf-8')

  // 通知：只对持仓与观察仓、今天新增或升级到"警示"及以上；只在定稿后发
  const notify = writeLedgers
    ? alerts.cards.filter(c => (c.entry === 1 || c.entry === 2) && (c.event === 'NEW' || c.event === 'UP') && c.level >= 2)
    : []
  writeFileSync(join(dir, 'money.notify.txt'), notify.map(c => `${c.name}：${c.title}`).join('\n'), 'utf-8')
  if (notify.length) log(`· 通知 ${notify.length} 条：${notify.map(c => c.name).join('、')}`)

  // Obsidian：显式给了库路径才写，避免写进代码仓库
  if (process.env.OBSIDIAN_VAULT?.trim()) {
    const { resolveObsidianRoot, VAULT_FOLDER } = await import('../cockpit/renderObsidian')
    const note = join(resolveObsidianRoot(), VAULT_FOLDER, '资金提醒.md')
    mkdirSync(dirname(note), { recursive: true })
    writeFileSync(note, agentMd, 'utf-8')
    log(`· 已写 Obsidian：${note}`)
  }

  log(`\n已写入网页快照：${MONEY_SNAPSHOT_FILE}（${(JSON.stringify(view).length / 1024).toFixed(0)} KB，用时 ${((Date.now() - t0) / 1000).toFixed(0)} 秒）`)
  void ALERT_RULES
}

main().catch(e => {
  process.stderr.write(`资金驾驶舱运行失败：${e instanceof Error ? e.stack : String(e)}\n`)
  process.exit(1)
})
