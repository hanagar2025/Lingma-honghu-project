// 驾驶舱命令行版 —— 直连行情源，不依赖数据库，每日盘后独立复跑
//
// 用法：
//   npm run cockpit                      默认读 data/portfolio.json
//   PENDING_SELLS=0 npm run cockpit      模拟执行债务清零后的输出
//   MARKET_ALLOWS=1 npm run cockpit      模拟市场阶段允许建仓
//   PORTFOLIO=/path/to/x.json npm run cockpit
//   HTML=1 npm run cockpit               另存自包含 HTML 到 data/reports/（不依赖数据库与登录）
//
// 市值由最新收盘价 × 股数实时算出，portfolio.json 只存股数与成本价 ——
// 手抄的市值会过期，而过期的市值会让仓位上限判定失真。

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fetchDailyBars } from '../marketData'
import { buildAudit, renderAuditMarkdown, type CostSnapshot } from '../governance/audit'
import { loadBaseline } from '../governance/freeze'
import { loadValuationMap, VALUATION_FILE } from '../msr/valuation'
import { allBenchmarks, allCodes } from '../msr/universe'
import type { DailyBar, Position } from '../tios/types'
import { runCockpit } from './index'
import { buildDashboard, type Dashboard, type SessionKind } from './dashboard'
import { renderDashboard } from './renderDashboard'
import { buildVerdict, type Verdict } from './verdict'
import { buildDecisionCockpit, renderDecisionCockpit, type DecisionCockpit } from '../decision/cockpitV2'
import { persistJournal } from '../decision/migrationJournal'
import { renderVerdict } from './renderVerdict'
import { buildBrief, buildHoldingsCsv, buildNodesCsv } from './share'
import {
  HYPOTHESES, withLiveData, renderHypotheses, fourLineVerdict, causalLayers,
  pendingVerification, paidGaps, wiringBacklog,
  type Hypothesis,
} from '../research/hypotheses'
import {
  buildAttribution, renderAttribution, STORAGE_ATTRIBUTION, type Attribution,
} from '../research/attribution'
import {
  judgeAlternatives, renderAlternatives, ALTERNATIVES, type AltGate,
} from '../research/alternatives'
import { groupPeriod, type SegmentFile } from '../research/segmentFetch'
import { buildLink2, renderLink2, type Link2Result } from '../research/link2Revenue'
import { renderPowerChain, buildPowerChainView } from '../research/powerChain'
import { renderPortfolioDefense, buildPortfolioDefenseView } from '../research/portfolioDefense'
import { renderOwnershipPhilosophy, buildOwnershipPhilosophyView } from '../research/ownershipPhilosophy'
import { buildLookoutView, renderLookout, type LookoutView } from './lookout'
import { renderDashboardHtml } from './renderHtml'
import { buildWebSnapshot, saveWebSnapshot, webSnapshotFile } from './webSnapshot'
import {
  snapshotOf, diffSnapshots, saveSnapshot, loadPrevSnapshot,
  loadDiscovery, updateDiscovery, saveDiscovery, renderChanges, renderDiscovery,
  stageAdvances, isIntraday, loadAllSnapshots, driftOver,
  type Change, type DiscoveryLedger,
} from '../governance/changeLog'
import { buildPeerGrossMargin, buildProfitMap } from '../research/profitRadar'
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
  /**
   * 专用于股票投资的账户外现金储备。
   *
   * 委员会 2026-08-15 已裁定：**计入组合分母**（单票/板块/主题上限），
   * 但不计入家庭安全垫 —— 委员会明确它不是家庭日常生活资产。
   *
   * 裁定理由（记录在此以免被后来者当成随意放宽）：同一笔钱放在券商账户外
   * 还是账户内，不改变股票风险的经济实质；用账户口径做分母，等于
   * "把钱转进账户就认为风险变小"，这不是风控而是记账幻觉。
   */
  externalCash?: number | null
  externalCashNote?: string
  /** 峰值所属口径。BROKER 表示尚未按组合口径重新认定，回撤将输出"不可比" */
  peakBasis?: 'BROKER' | 'PORTFOLIO'
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
  const brokerTotal = pf.cash + positionsValue
  const externalCash = pf.externalCash ?? 0
  const portfolioTotal = brokerTotal + externalCash
  const peakBasis = pf.peakBasis ?? 'BROKER'
  const snapshot = {
    date,
    brokerTotal: brokerTotal,
    cash: pf.cash,
    positionsValue,
    externalCash,
    portfolioTotal,
    // 峰值只在同口径下才允许被"当前值刷新"。口径不可比时保持原值不动，
    // 否则一次运行就会把 430 万（账户口径）悄悄抬到 531 万（组合口径），
    // 而那等于把历史回撤记录抹掉。
    peakAssets: peakBasis === 'PORTFOLIO'
      ? Math.max(pf.peakAssets, portfolioTotal)
      : pf.peakAssets,
    peakBasis,
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

  let dashForHtml: Dashboard | null = null
  let v2ForHtml: DecisionCockpit | null = null
  let verdictForHtml: Verdict | null = null
  let changesForHtml: Change[] = []
  let prevDateForHtml: string | null = null
  let ledgerForHtml: DiscoveryLedger | null = null
  let hypothesesForHtml: Hypothesis[] = []
  let hypothesesForWeb: unknown[] = []
  let attributionForWeb: Attribution | null = null
  let altGateForWeb: AltGate | null = null
  let lookoutForHtml: LookoutView | null = null

  if (process.env.DASHBOARD === '0' || !internals) {
    printReport(rep)
  } else {
    const dash = buildDashboard({
      date, session, positions, portfolioTotal,
      assetBreakdown: {
        positionsValue, brokerCash: pf.cash, externalCash,
        brokerTotal, peakBasis, peak: pf.peakAssets,
      },
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
    const v2 = buildDecisionCockpit({
      date,
      holdings: dash.holdings,
      mainlines: dash.mainlines,
      nextLayer: dash.nextLayer,
      nodeStructure: dash.nodeStructure,
      actions: rep.actions,
      pendingSellCount,
      profit,
      circuitState: dash.assets.circuitState,
      circuitReason: dash.assets.circuitReason,
    })
    v2ForHtml = v2
    persistJournal(date, v2.cards)
    {
      const snap = snapshotOf(dash)
      const prev = loadPrevSnapshot(snap.date)
      const changes = prev ? diffSnapshots(prev, snap) : []
      changesForHtml = changes
      prevDateForHtml = prev?.date ?? null
      lookoutForHtml = buildLookoutView({
        date,
        cockpit: v2,
        changes: { items: changes, prevDate: prev?.date ?? null },
        pendingSellCount,
        pendingSells: null,
      })
      process.stdout.write(`${renderLookout(lookoutForHtml)}\n`)
    }
    process.stdout.write(`${renderDecisionCockpit(v2)}\n`)

    // 结论先于依据：委员会明确不想再从四张表里自己提炼。
    // 这一层不产生新判断，只按规则类别筛选归类，并把答不了的问题一并列出。
    const snaps = loadAllSnapshots()
    const verdict = buildVerdict({
      dashboard: dash,
      actions: rep.actions,
      actionText: ACTION_TEXT,
      drift: driftOver(snaps),
      driftSnapshotCount: snaps.length,
      driftFrom: snaps[0]?.date,
      driftTo: snaps[snaps.length - 1]?.date,
    })
    process.stdout.write(`\n${renderVerdict(verdict)}\n`)
    verdictForHtml = verdict

    process.stdout.write(`${renderDashboard(dash)}\n`)
    dashForHtml = dash

    // ── 外围叙事台账 ──
    // 放在研究表之后、动作区之外。它的证据等级恒为 OBSERVATION，
    // 按 EvidenceTier 约定不得产生动作 —— 这里也没有任何函数能产生动作。
    // ── 验证链第 2 环：公司收入 ──
    // 只回答"收入是否确实改善"，不回答"是不是 AI 导致的"。
    // 分产品收入只在年报/中报披露，故本环最快半年更新一次。
    let link2: Link2Result | null = null
    try {
      const segFile = JSON.parse(
        readFileSync(join(HERE, '..', 'research', 'data', 'segments.json'), 'utf-8')
      ) as SegmentFile
      const annual = segFile.periods.filter(x => x.reportDate.endsWith('-12-31'))
      if (annual.length >= 2) {
        link2 = buildLink2(segFile.name, groupPeriod(annual[0]!), groupPeriod(annual[1]!), date)
        process.stdout.write(`${renderLink2(link2)}\n`)
      }
    } catch {
      process.stdout.write('⚠ 分产品收入表不可用（先跑 npm run segments:fetch）→ 第 2 环显示未判定\n')
    }

    hypothesesForHtml = HYPOTHESES.map(h => withLiveData(
      h,
      (() => {
        const n = profit?.nodes.find(x => x.node === h.node)
        // 同业对照挂在节点上传下去 —— 它回答的是是否行业性，
        // 与偏离自身历史是两个问题，缺一个就会读错跃升的性质。
        if (!n || !profit) return n ?? null
        // 同业对照限定同主线：拿存储公司去和光模块、电力设备比毛利率，
        // 回答的是另一个问题，噪声也大得多。
        return {
          ...n,
          peerGrossMargin: buildPeerGrossMargin(profit.nodes, n.mainlineId),
          link2: link2 && {
            period: link2.period, revenueYoy: link2.revenueYoy, improved: link2.improved,
            ageDays: link2.ageDays,
            target: link2.target && {
              group: link2.target.group, yoy: link2.target.yoy,
              shareOfRevenue: link2.target.shareOfRevenue,
              shareOfTotalDelta: link2.target.shareOfTotalDelta,
            },
            fastestGrowing: link2.fastestGrowing,
            targetIsFastestGrowing: link2.targetIsFastestGrowing,
          },
        }
      })()
    ))
    // 四句话结论与两类缺口在后端算好再下发。
    // 前端重算的后果是两套口径：同一份数据在网页与终端给出不同的句子。
    hypothesesForWeb = hypothesesForHtml.map(h => ({
      ...h,
      fourLine: fourLineVerdict(h),
      causal: causalLayers(h, h.peer, {
        attributionDone: attributionForWeb !== null
          && attributionForWeb.verdict !== 'UNKNOWN',
        altGateOpen: judgeAlternatives().allowsCausalClaim,
        altNote: judgeAlternatives().verdict,
      }),
      pending: pendingVerification(h).map(i => ({
        text: i.text, evidence: i.evidence, checklist: i.verifyChecklist ?? [],
      })),
      paidGaps: paidGaps(h).map(i => i.text),
      wiringBacklog: wiringBacklog(h).map(i => i.text),
    }))
    process.stdout.write(`${renderHypotheses(hypothesesForHtml)}\n`)
    process.stdout.write(`${renderPowerChain()}\n`)
    process.stdout.write(`${renderPortfolioDefense()}\n`)
    process.stdout.write(`${renderOwnershipPhilosophy()}\n`)

    // ── 主线收入归因 ──
    // 委员会 2026-08-16 定为存储的唯一下一步。放在台账之后单列，
    // 是因为它现在全是缺口 —— 而缺口摆在明处才会被补，混在台账里会被读成"已在做"。
    attributionForWeb = buildAttribution(STORAGE_ATTRIBUTION)
    process.stdout.write(`${renderAttribution(attributionForWeb)}\n`)

    // ── 替代解释闸门 ──
    // 归因回答"钱从哪条产品线来"，本闸门回答"那条产品线为什么多赚了"。
    // 两道关都过，主线归因层才允许转绿。
    altGateForWeb = judgeAlternatives()
    process.stdout.write(`${renderAlternatives()}\n`)

    // ── 变化台账 ──
    // 盘前不落档：盘中读数会污染日间序列，而这份档案要连续读 30 个交易日。
    // 同理，盘中（15:00 前）跑出来的"今日收盘"其实是未定价的临时值，同样不得落档。
    // ARCHIVE=0 时只生成、不归档。
    //
    // 存在理由是一个真实的分叉：服务器装上定时任务后，它每天也会写 changelog 与
    // 审计档；而 Mac 为了部署前端也会跑一次生成。于是同一个交易日在两台机器上
    // 各有一份档案，两边都不完整 —— 而 30 天观察期的全部价值就建立在
    // **一条连续的档案**上。两份各缺几天的序列，比一份都没有更糟：
    // 它看起来是完整的。
    //
    // 因此档案必须有唯一归属方。委员会要求 Mac 可关机，那么归属方只能是服务器
    // （它不睡）。Mac 侧的生成一律带 ARCHIVE=0，只产出用于部署的快照。
    const archiveAllowed = process.env.ARCHIVE !== '0'
    const intraday = isIntraday(date)
    if (session === 'POST_CLOSE' && !intraday && !archiveAllowed) {
      process.stdout.write(
        `\n【不归档】ARCHIVE=0 —— 本次只生成快照。\n`
        + `  档案的唯一归属方是服务器（它不睡）。两台机器各写一份会得到两条\n`
        + `  各不完整的序列，而那比没有档案更糟：它看起来是完整的。\n`
      )
    }
    if (session === 'POST_CLOSE' && !intraday && archiveAllowed) {
      const snap = snapshotOf(dash)
      const prev = loadPrevSnapshot(snap.date)
      const changes = prev ? diffSnapshots(prev, snap) : []
      changesForHtml = changes
      prevDateForHtml = prev?.date ?? null

      // 归档失败不得中断整条流水线。
      //
      // 真实场景：非交易日（或K线未更新）重跑时，最新K线仍是上一交易日，
      // 而那一天的档案已经存在 → 跨日覆盖闸门触发。这时正确的行为是
      // **跳过归档、继续出报告**，而不是让报告、HTML、快照全部产不出来。
      // 闸门要防的是静默改历史，不是让人没法看今天的报告。
      try {
        const snapFile = saveSnapshot(snap)
        const ledger = updateDiscovery(loadDiscovery(), dash)
        saveDiscovery(ledger)
        ledgerForHtml = ledger
        process.stdout.write(`\n${'═'.repeat(122)}\n`)
        process.stdout.write(`${renderChanges(changes, prev?.date ?? null, snap.date)}\n`)
        process.stdout.write(`\n${renderDiscovery(ledger, snap.date)}\n`)
        process.stdout.write(`\n快照已归档 ${snapFile}（${snap.readings.length} 项读数）\n`)
      } catch (e) {
        ledgerForHtml = loadDiscovery()
        process.stdout.write(
          `\n【未归档】${e instanceof Error ? e.message : String(e)}\n`
          + `  报告、HTML 与快照仍照常产出 —— 闸门要防的是静默改历史，\n`
          + `  不是让人没法看今天的报告。\n`
        )
      }
    } else {
      ledgerForHtml = loadDiscovery()
      // 仍然算出变化给人看 —— 只是不写进档案。看得见，但不污染序列。
      const snap = snapshotOf(dash)
      const prev = loadPrevSnapshot(snap.date)
      changesForHtml = prev ? diffSnapshots(prev, snap) : []
      prevDateForHtml = prev?.date ?? null
      if (intraday) {
        process.stdout.write(`\n${'═'.repeat(122)}\n`)
        process.stdout.write(
          `⚠ 盘中运行（北京时间 15:00 前，最新K线 ${date} 尚未定价）→ 本次读数为临时值，不写入30天档案。\n` +
          `  下面的变化仅供现在看；盘后 15:10 之后重跑一次才会归档。\n`
        )
        process.stdout.write(`${renderChanges(changesForHtml, prevDateForHtml, date)}\n`)
      }
    }

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
  // 盘中审计另存文件名：审计里的减仓理由带着仓位百分比（"18.6% > 12%"），
  // 而盘中的百分比会随收盘变。若覆盖当日正式档，30天后回看会拿盘中值当结论依据。
  const auditIntraday = isIntraday(audit.date)
  // 审计档与变化台账同属"档案"，归属方必须一致 ——
  // 否则会出现"台账在服务器、审计在 Mac"这种更难对齐的分裂。
  const auditFile = join(dir, `${audit.date}${auditIntraday ? '-盘中' : ''}.md`)
  if (process.env.ARCHIVE !== '0') writeFileSync(auditFile, `${md}\n`, 'utf-8')

  const base = loadBaseline()
  process.stdout.write(
    process.env.ARCHIVE === '0'
      ? `\n【决策审计】未归档（ARCHIVE=0）\n`
      : `\n【决策审计】已归档 ${auditFile}${auditIntraday ? '（盘中临时档，不覆盖当日正式记录）' : ''}\n`
  )
  process.stdout.write(
    `  规则指纹 ${audit.rules.fingerprint.hash}｜${audit.rules.fingerprint.entryCount} 条决策生效参数｜` +
    `${Object.entries(audit.rules.fingerprint.tierCounts).map(([t, n]) => `${t}=${n}`).join(' ')}\n`
  )
  process.stdout.write(
    base
      ? `  ${audit.rules.drift?.drifted ? '⚠ 规则已漂移：' : '✓ '}${audit.rules.drift?.detail ?? ''}\n`
      : `  ⚠ 未找到冻结基线，无法判定漂移。先跑 npm run freeze:baseline\n`
  )

  // ── 三个仓位口径并列播报 ──
  // 委员会 2026-08-15 裁定后，账户口径与组合口径必须同时可见：
  // 前者回答"还能下多少单"，后者回答"风险有多集中"。
  // 只印一个的后果实测过 —— 券商App显示 21% 被当成超过 12% 上限。
  {
    const biggest = positions.reduce(
      (a, b) => (b.marketValue > a.marketValue ? b : a), positions[0]
    )
    const w = (v: number) => `${(v / 10000).toFixed(1)}万`
    process.stdout.write(`\n【仓位口径】委员会 2026-08-15 裁定：上限一律用组合口径\n`)
    process.stdout.write(
      `  券商账户合计 ${w(brokerTotal)}（持仓 ${w(positionsValue)} + 账内现金 ${w(pf.cash)}）\n`
      + `    账户内仓位 ${(positionsValue / brokerTotal * 100).toFixed(1)}%`
      + ` —— 只回答"还有多少现金可直接下单"，不用于任何上限判定\n`
    )
    process.stdout.write(
      `  组合总资产 ${w(portfolioTotal)}（+ 账户外股票现金 ${w(externalCash)}）\n`
      + `    股票占比 ${(positionsValue / portfolioTotal * 100).toFixed(1)}%`
      + `　现金占比 ${((pf.cash + externalCash) / portfolioTotal * 100).toFixed(1)}%\n`
      + `    最大单票 ${biggest.name} ${(biggest.marketValue / portfolioTotal * 100).toFixed(2)}%`
      + `（上限 12%）\n`
    )
    if (peakBasis !== 'PORTFOLIO') {
      process.stdout.write(
        `  ⚠ 净值峰值 ${w(pf.peakAssets)} 记于券商账户口径，与组合口径不可比 →\n`
        + `    回撤与熔断判定输出"不可比"而非 0。须由委员会按组合口径重新认定峰值。\n`
      )
    }
  }

  // ── 自包含 HTML 导出 ──
  // 后端启动依赖 MySQL、前端还要登录；盘后想看一眼分析结果不该卡在这上面。
  // 同一份数据的另一个渲染器：不新增判据，不影响规则指纹。
  if (process.env.HTML === '1' && dashForHtml) {
    const html = renderDashboardHtml({
      dashboard: dashForHtml,
      changes: changesForHtml,
      prevDate: prevDateForHtml,
      discovery: {
        nodeCount: ledgerForHtml?.entries.length ?? 0,
        advances: ledgerForHtml ? stageAdvances(ledgerForHtml) : [],
      },
      freeze: {
        baselineHash: base?.hash ?? null,
        currentHash: audit.rules.fingerprint.hash,
        drifted: audit.rules.drift?.drifted ?? false,
        detail: audit.rules.drift?.detail ?? '未找到冻结基线，无法判定漂移。先跑 npm run freeze:baseline',
      },
      intraday: isIntraday(dashForHtml.date),
      verdict: verdictForHtml,
      decisionV2: v2ForHtml,
      hypotheses: hypothesesForHtml,
      powerChain: buildPowerChainView(),
      portfolioDefense: buildPortfolioDefenseView(),
      ownershipPhilosophy: buildOwnershipPhilosophyView(),
      lookout: lookoutForHtml,
    })
    const reportDir = join(HERE, 'data', 'reports')
    mkdirSync(reportDir, { recursive: true })
    const htmlFile = join(reportDir, `${dashForHtml.date}${session === 'PRE_OPEN' ? '-盘前' : ''}.html`)
    writeFileSync(htmlFile, html, 'utf-8')
    process.stdout.write(`\n【HTML 报告】${htmlFile}\n  双击即可在浏览器打开，无需数据库、无需登录、无外部请求。\n`)
  }

  // ── 外发摘要 ──
  // 给别的软件（尤其大模型）读的。完整快照 5 万字符以上，
  // 其中大半是每个指标的 source/formula —— 对人有用，对模型是噪声。
  // 故另出一份约 1 万字符的 Markdown，外加两个 CSV 供 Excel/pandas。
  //
  // 无条件生成（纯本地计算、不联网、毫秒级），因为网页端的"一键分享"要用它。
  // 只在 SHARE=1 时才额外落盘成文件。
  const withAmounts = process.env.SHARE_AMOUNTS === '1'
  let briefForWeb: string | null = null
  if (dashForHtml) {
    briefForWeb = buildBrief({
      dashboard: dashForHtml,
      verdict: verdictForHtml,
      decisionV2: v2ForHtml,
      includeAmounts: withAmounts,
      intraday: isIntraday(dashForHtml.date),
    })
  }

  if (process.env.SHARE === '1' && dashForHtml && briefForWeb) {
    const brief = briefForWeb
    const shareDir = join(HERE, 'data', 'share')
    mkdirSync(shareDir, { recursive: true })
    const suffix = withAmounts ? '-含金额' : ''
    const mdFile = join(shareDir, `${dashForHtml.date}-摘要${suffix}.md`)
    const hCsv = join(shareDir, `${dashForHtml.date}-持仓.csv`)
    const nCsv = join(shareDir, `${dashForHtml.date}-产业节点.csv`)
    writeFileSync(mdFile, `${brief}\n`, 'utf-8')
    writeFileSync(hCsv, buildHoldingsCsv(dashForHtml, withAmounts), 'utf-8')
    writeFileSync(nCsv, buildNodesCsv(dashForHtml), 'utf-8')
    // token 估算按**字符数**而非字节数：中文一字占 3 字节但约等于 1 token，
    // 按字节除以 3.5 会把中文文本的 token 数低估到三分之一。
    const chars = [...brief].length
    process.stdout.write(
      `\n【外发摘要】${mdFile}\n`
      + `  ${chars.toLocaleString()} 字符，约 ${Math.round(chars / 1000)}k tokens`
      + `（中文约一字一 token）。完整快照 5 万字符以上，故不直接外发\n`
      + `  ${withAmounts ? '⚠ 含绝对金额与总资产，仅供自己留档' : '已脱敏：无金额、无股数、无总资产'}\n`
      + `  CSV（供 Excel/pandas）：${hCsv}\n                    ${nCsv}\n`
    )
  }

  // ── 离线网页快照 ──
  // 让浏览器里的 React 驾驶舱脱离 MySQL 与登录运行。数据来源与 CLI/HTML 完全一致，
  // 三个出口因此不可能给出互相矛盾的结论。
  if (process.env.WEB === '1' && dashForHtml) {
    const repoRoot = join(HERE, '..', '..', '..', '..')
    const payload = buildWebSnapshot({
      report: rep,
      dashboard: dashForHtml,
      verdict: verdictForHtml,
      decisionV2: v2ForHtml,
      hypotheses: hypothesesForWeb,
      powerChain: buildPowerChainView(),
      portfolioDefense: buildPortfolioDefenseView(),
      ownershipPhilosophy: buildOwnershipPhilosophyView(),
      lookout: lookoutForHtml,
      attribution: attributionForWeb,
      alternatives: { gate: altGateForWeb, items: ALTERNATIVES },
      brief: briefForWeb,
      changes: changesForHtml,
      prevDate: prevDateForHtml,
      discovery: ledgerForHtml,
      audit,
      auditMarkdown: md,
      baseline: base,
      missing: failed,
      valuationUsable: Object.values(valuationByCode).filter(v => v.usable).length,
      valuationLoaded: Object.keys(valuationByCode).length,
      intraday: isIntraday(dashForHtml.date),
      marketAllows,
      pendingSellCount,
      externalCash: externalCash > 0
        ? {
          amount: externalCash,
          note: pf.externalCashNote
            ?? '口径未裁定：并入分母会让现有超限持仓自动合规，故按从严处理，暂不计入。',
          denominatorNow: portfolioTotal,
        }
        : null,
    })
    // 快照以明文托管。委员会 2026-08-15 决议：这些数据公开无妨，故去掉口令解锁。
    //
    // 这个决定顺带解决了另一件事：服务器生成快照不再需要任何秘密，
    // 于是"Mac 关机也能更新"从"要么把口令交给公网服务器、要么上非对称加密"
    // 变成一件平凡的事。为此前写的那套 RSA 混合加密已随之删除 ——
    // 约束消失后留着它，只是给系统多添一处无人验证的复杂度。
    const plainPath = webSnapshotFile(repoRoot)
    const stale = plainPath.replace(/\.json$/, '.enc.json')
    if (existsSync(stale)) {
      rmSync(stale)
      process.stdout.write(`\n  已删除旧的加密快照（口令模式已废弃）。\n`)
    }
    const webFile = saveWebSnapshot(payload, plainPath)
    process.stdout.write(
      `\n【网页快照】${webFile}\n`
      + `  浏览器直接读取，无需数据库、无需登录、无需口令。\n`
    )
  }
}

main().catch(e => {
  process.stderr.write(`驾驶舱运行失败：${e instanceof Error ? e.message : String(e)}\n`)
  process.exit(1)
})
