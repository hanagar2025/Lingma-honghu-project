// 驾驶舱命令行版 —— 直连行情源，不依赖数据库，每日盘后独立复跑
//
// 用法：
//   npm run cockpit                      默认读 data/portfolio.json
//   PENDING_SELLS=0 npm run cockpit      模拟执行债务清零后的输出
//   MARKET_ALLOWS=1 npm run cockpit      模拟市场阶段允许建仓
//   PORTFOLIO=/path/to/x.json npm run cockpit
//
// 市值由最新收盘价 × 股数实时算出，portfolio.json 只存股数与成本价 ——
// 手抄的市值会过期，而过期的市值会让仓位上限判定失真。

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fetchDailyBars } from '../marketData'
import { buildAudit, renderAuditMarkdown, type CostSnapshot } from '../governance/audit'
import { loadBaseline } from '../governance/freeze'
import { loadValuationMap, VALUATION_FILE } from '../msr/valuation'
import { allBenchmarks, allCodes } from '../msr/universe'
import type { DailyBar, Position } from '../tios/types'
import { runCockpit } from './index'
import { buildDashboard, type SessionKind } from './dashboard'
import { renderDashboard } from './renderDashboard'
import { buildProfitMap } from '../research/profitRadar'
import type { ProfitMap } from '../research/profitRadar'
import type { MsrReport } from '../msr'
import type { MomentumRow } from './momentum'
import { ACTION_TEXT, LEGAL_REASON_TEXT, LIGHT_TEXT, type CockpitReport } from './types'

const HERE = dirname(fileURLToPath(import.meta.url))
export const PORTFOLIO_FILE = join(HERE, 'data', 'portfolio.json')

interface PortfolioFile {
  cash: number
  peakAssets: number
  householdAnnualExpense: number | null
  positions: { code: string; name: string; quantity: number; cost: number; sector: string; theme: string }[]
  pendingSells: number
}

const LIGHT_DOT: Record<string, string> = { GREEN: '🟢', YELLOW: '🟡', RED: '🔴', UNKNOWN: '⚪' }

function pad(s: string, width: number): string {
  // 中文按两个字符宽度计
  let w = 0
  for (const ch of s) w += /[\u4e00-\u9fa5\u3000-\u303f（）：、。]/.test(ch) ? 2 : 1
  return s + ' '.repeat(Math.max(0, width - w))
}

function printReport(rep: CockpitReport): void {
  const w = 118
  const out = process.stdout

  out.write(`\n${'═'.repeat(w)}\n每日投资驾驶舱  ${rep.date}\n${'═'.repeat(w)}\n`)

  out.write(`\n【首页单表】\n`)
  out.write(`  ${pad('项目', 26)}${pad('今日状态', 56)}决策\n`)
  out.write(`  ${'─'.repeat(w - 2)}\n`)
  for (const r of rep.table) {
    out.write(`  ${pad(r.item, 26)}${LIGHT_DOT[r.light]} ${pad(r.todayStatus.slice(0, 50), 53)}${r.decision}\n`)
  }

  out.write(`\n  ${'─'.repeat(w - 2)}\n`)
  out.write(`  今日核心决策：${rep.coreDecision}\n`)

  out.write(`\n${'═'.repeat(w)}\n【六问】\n${'═'.repeat(w)}\n`)
  for (const a of rep.answers) {
    const mark = ['①', '②', '③', '④', '⑤', '⑥'][a.no - 1]
    out.write(`\n${mark} ${a.question}  ${LIGHT_DOT[a.light]} ${LIGHT_TEXT[a.light]}\n`)
    out.write(`   ${a.headline}\n`)
    for (const r of a.rows.slice(0, 12)) {
      out.write(`     ${LIGHT_DOT[r.light]} ${pad(r.label, 26)}${pad(r.status.slice(0, 46), 48)}→ ${r.decision}\n`)
      if (r.reviewTriggers?.length) {
        out.write(`        观察项（仅复核）: ${r.reviewTriggers.slice(0, 4).join('；')}\n`)
      }
    }
    if (a.rows.length > 12) out.write(`     …… 另有 ${a.rows.length - 12} 行\n`)
  }

  out.write(`\n${'═'.repeat(w)}\n【今日动作】只有 买入 / 持有 / 减仓 / 不动作 四种\n${'═'.repeat(w)}\n`)
  for (const a of rep.actions) {
    if (a.kind === 'HOLD') continue
    out.write(`\n  ${a.name}（${a.code}） → ${ACTION_TEXT[a.kind]}  ${a.size.display}\n`)
    out.write(`    法定理由：${LEGAL_REASON_TEXT[a.reason]}｜${a.reasonDetail}\n`)
    if (a.notReason.length) out.write(`    非理由：${a.notReason.join('；')}\n`)
    if (a.reviewTriggers.length) out.write(`    观察项（不构成理由）：${a.reviewTriggers.join('；')}\n`)
    if (a.size.value !== null) out.write(`    换算：${a.size.note}\n`)
  }
  const holds = rep.actions.filter(a => a.kind === 'HOLD')
  if (holds.length) out.write(`\n  持有（无法定理由且无复核项）：${holds.map(a => a.name).join('、')}\n`)

  if (rep.noNewEntry.verdict) {
    out.write(`\n${'═'.repeat(w)}\n【今日无新增建仓】\n${'═'.repeat(w)}\n`)
    rep.noNewEntry.reasons.forEach((r, i) => out.write(`  ${i + 1}. ${r}\n`))
    out.write(`  —— 不为了让系统"每天有输出"而强行找一只股票买。\n`)
  }

  out.write(`\n${'═'.repeat(w)}\n【模型能力披露】${rep.disclosure.headline}\n${'═'.repeat(w)}\n`)
  for (const it of rep.disclosure.items) {
    out.write(`  [${pad(it.tier, 12)}] ${it.model}\n      ${it.measured}\n`)
  }

  out.write(`\n【数据缺口】\n`)
  rep.dataGaps.forEach((g, i) => out.write(`  ${i + 1}. ${g}\n`))
  out.write(`\n${'═'.repeat(w)}\n`)
}

async function main(): Promise<void> {
  const file = process.env.PORTFOLIO ?? PORTFOLIO_FILE
  const pf = JSON.parse(readFileSync(file, 'utf-8')) as PortfolioFile

  const codes = Array.from(new Set([...allCodes(), ...pf.positions.map(p => p.code)]))
  const benchmarks = Array.from(new Set([...allBenchmarks(), 'sz399006']))

  process.stdout.write(`拉取 ${codes.length} 只标的 + ${benchmarks.length} 个基准指数……\n`)
  const barsByCode: Record<string, DailyBar[]> = {}
  const indexBarsByCode: Record<string, DailyBar[]> = {}
  const failed: string[] = []
  for (const c of codes) {
    try { barsByCode[c] = await fetchDailyBars(c, 200) } catch { failed.push(c) }
  }
  for (const b of benchmarks) {
    try { indexBarsByCode[b] = await fetchDailyBars(b, 200) } catch { failed.push(b) }
  }
  if (failed.length) process.stdout.write(`  拉取失败（跳过）：${failed.join(', ')}\n`)

  const anyBars = Object.values(barsByCode).find(b => b.length > 0)
  const date = anyBars ? anyBars[anyBars.length - 1].date : new Date().toISOString().slice(0, 10)

  // 市值 = 最新收盘 × 股数。取不到价格的标的按成本价计并明示
  const priceless: string[] = []
  const positions: Position[] = pf.positions.map(p => {
    const bars = barsByCode[p.code]
    const px = bars?.length ? bars[bars.length - 1].close : null
    if (px === null) priceless.push(p.name)
    return {
      code: p.code, name: p.name, sector: p.sector, theme: p.theme,
      cost: p.cost * p.quantity,
      marketValue: (px ?? p.cost) * p.quantity,
    }
  })
  if (priceless.length) {
    process.stdout.write(`  ⚠ 以下标的取不到收盘价，市值暂按成本价计（会影响仓位判定）：${priceless.join('、')}\n`)
  }

  const positionsValue = positions.reduce((s, p) => s + p.marketValue, 0)
  const totalAssets = pf.cash + positionsValue
  const snapshot = {
    date, totalAssets, cash: pf.cash, positionsValue,
    peakAssets: Math.max(pf.peakAssets, totalAssets),
  }

  const pendingSellCount = Number(process.env.PENDING_SELLS ?? pf.pendingSells)
  const marketAllows = process.env.MARKET_ALLOWS === '1'
  const valuationByCode = loadValuationMap(VALUATION_FILE)
  process.stdout.write(
    Object.keys(valuationByCode).length === 0
      ? '⚠ 未找到 data/valuation.json，估值维度全部记0并阻断S3。先跑 npm run msr:valuation\n'
      : `PE历史分位：${Object.values(valuationByCode).filter(v => v.usable).length}/${Object.keys(valuationByCode).length} 可用\n`
  )

  const rep = runCockpit({
    date, snapshot, positions, barsByCode, indexBarsByCode,
    pendingSellCount, valuationByCode,
    householdAnnualExpense: pf.householdAnnualExpense ?? undefined,
    marketAllows,
  })

  // ── 五层驾驶舱 ──
  // DASHBOARD=0 可退回六问旧版；SESSION=pre 出盘前简报。
  const session: SessionKind = process.env.SESSION === 'pre' ? 'PRE_OPEN' : 'POST_CLOSE'
  let profit: ProfitMap | null = null
  try {
    profit = buildProfitMap(date)
  } catch {
    process.stdout.write('⚠ 利润结构地图不可用（先跑 npm run profit:fetch）→ 主线/产业结构表将显示数据缺失\n')
  }
  const internals = rep.internals as
    | { momentumRows: MomentumRow[]; msr: MsrReport; nodes: unknown[] }
    | undefined

  if (process.env.DASHBOARD === '0' || !internals) {
    printReport(rep)
  } else {
    const dash = buildDashboard({
      date, session, positions, totalAssets,
      barsByCode, indexBarsByCode, marketBars: indexBarsByCode['sz399006'],
      valuationByCode,
      momentumRows: internals.momentumRows,
      msr: internals.msr,
      profit,
      actions: rep.actions,
      pendingSellCount,
      noNewEntryReasons: rep.noNewEntry.reasons,
      dataGaps: rep.dataGaps,
    })
    process.stdout.write(`${renderDashboard(dash)}\n`)
    if (session === 'POST_CLOSE' && process.env.SIX === '1') printReport(rep)
  }

  // ── 决策审计归档 ──
  // 成本快照用总成本而非市值：总成本不随价格波动，其上升唯一对应"发生了买入"。
  const costSnapshot: CostSnapshot[] = pf.positions.map(p => ({
    code: p.code, name: p.name, totalCost: p.cost * p.quantity,
  }))
  const audit = buildAudit({ report: rep, costSnapshot })
  const md = renderAuditMarkdown(audit)
  const dir = join(HERE, 'data', 'audits')
  mkdirSync(dir, { recursive: true })
  const auditFile = join(dir, `${audit.date}.md`)
  writeFileSync(auditFile, `${md}\n`, 'utf-8')

  const base = loadBaseline()
  process.stdout.write(`\n【决策审计】已归档 ${auditFile}\n`)
  process.stdout.write(
    `  规则指纹 ${audit.rules.fingerprint.hash}｜${audit.rules.fingerprint.entryCount} 条决策生效参数｜` +
    `${Object.entries(audit.rules.fingerprint.tierCounts).map(([t, n]) => `${t}=${n}`).join(' ')}\n`
  )
  process.stdout.write(
    base
      ? `  ${audit.rules.drift?.drifted ? '⚠ 规则已漂移：' : '✓ '}${audit.rules.drift?.detail ?? ''}\n`
      : `  ⚠ 未找到冻结基线，无法判定漂移。先跑 npm run freeze:baseline\n`
  )
}

main().catch(e => {
  process.stderr.write(`驾驶舱运行失败：${e instanceof Error ? e.message : String(e)}\n`)
  process.exit(1)
})
