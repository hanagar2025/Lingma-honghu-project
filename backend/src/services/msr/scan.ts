// MSR 命令行扫描器 —— 直连行情源，不依赖数据库，便于每日盘后独立复跑
// 用法：npm run msr:scan            （默认按当前未执行卖出指令数=7）
//       PENDING_SELLS=0 npm run msr:scan   （模拟执行清零后的输出）

import { fetchDailyBars } from '../marketData'
import { runMsr, WINDOW_TEXT, BLOCK_TEXT, type MsrCandidate } from './index'
import { STAGE_TEXT, WINDOW_COLOR_TEXT } from './promotion'
import { MAINLINES, allBenchmarks, allCodes } from './universe'
import { loadValuationMap, VALUATION_FILE } from './valuation'
import type { DailyBar } from '../tios/types'

function pct(v: number | null | undefined, digits = 1): string {
  return v === null || v === undefined ? '  NA  ' : `${(v * 100).toFixed(digits)}%`
}

function line(c: MsrCandidate): string {
  const m = c.radar.metrics
  const s = c.radar
  return (
    `  ${s.name.padEnd(6, '　')} T${s.tier} ${s.node.padEnd(12, ' ')}` +
    `合计${s.total.toFixed(1).padStart(5)}/25 ` +
    `[资${s.capital.score.toFixed(1)} 强${s.relativeStrength.score.toFixed(1)} ` +
    `趋${s.trend.score.toFixed(1)} 据${s.evidence.score.toFixed(1)} 估${s.valuation.score.toFixed(1)}] ` +
    `距MA20 ${pct(m.distMa20).padStart(7)} 距MA60 ${pct(m.distMa60).padStart(7)} ` +
    `20日超额 ${pct(m.excess20).padStart(7)} ` +
    `→ ${STAGE_TEXT[c.promotion.stage]}｜${WINDOW_COLOR_TEXT[c.promotion.priceWindow.color]}｜${WINDOW_TEXT[c.window]}` +
    (c.blocks.length > 0 ? `\n      阻断: ${c.blocks.map(b => BLOCK_TEXT[b]).join('、')}` : '｜✅ 无阻断') +
    (c.promotion.blockedBy.length > 0 ? `\n      晋级卡点: ${c.promotion.blockedBy.join('；')}` : '')
  )
}

async function main(): Promise<void> {
  const pendingSells = Number(process.env.PENDING_SELLS ?? '7')
  const codes = allCodes()
  const benchmarks = allBenchmarks()

  process.stdout.write(`MSR 主线内部轮动雷达 —— 拉取 ${codes.length} 只标的 + ${benchmarks.length} 个基准指数\n`)
  const barsByCode: Record<string, DailyBar[]> = {}
  const indexBarsByCode: Record<string, DailyBar[]> = {}
  const failed: string[] = []
  for (const c of codes) {
    try {
      barsByCode[c] = await fetchDailyBars(c, 200)
    } catch {
      failed.push(c)
    }
  }
  for (const b of benchmarks) {
    try {
      indexBarsByCode[b] = await fetchDailyBars(b, 200)
    } catch {
      failed.push(b)
    }
  }
  if (failed.length > 0) process.stdout.write(`  拉取失败(跳过): ${failed.join(', ')}\n`)

  const anyBars = Object.values(barsByCode).find(b => b.length > 0)
  const date = anyBars ? anyBars[anyBars.length - 1].date : new Date().toISOString().slice(0, 10)

  const marketAllows = process.env.MARKET_ALLOWS === '1'
  const valuationByCode = loadValuationMap(VALUATION_FILE)
  const vCount = Object.values(valuationByCode).filter(v => v.usable).length
  process.stdout.write(
    Object.keys(valuationByCode).length === 0
      ? '⚠ 未找到 data/valuation.json，估值维度将全部记0并阻断S3。先跑 npm run msr:valuation\n'
      : `PE历史分位已加载：${vCount}/${Object.keys(valuationByCode).length} 只可用于闸门\n`
  )
  const rep = runMsr({
    date, barsByCode, indexBarsByCode, pendingSellCount: pendingSells, marketAllows, valuationByCode,
  })

  process.stdout.write(`\n${'='.repeat(112)}\nMSR 报告 ${rep.date}\n${'='.repeat(112)}\n`)
  process.stdout.write(`\n【执行债务闸门】${rep.executionGate.locked ? '🔒 已锁定' : '🔓 已解锁'} —— ${rep.executionGate.detail}\n`)

  process.stdout.write(`\n【主线健康度】\n`)
  for (const h of rep.health) {
    const ml = MAINLINES.find(x => x.id === h.mainlineId)!
    process.stdout.write(
      `  ${h.mainlineName.padEnd(10, '　')} 战略${'★'.repeat(ml.strategicStars)} ` +
      `健康度=${h.health.padEnd(18)} 龙头调整=${h.leadersAdjusting ? '是' : '否'} ` +
      `板块额20/60=${h.sectorAmt20Over60?.toFixed(2) ?? 'NA'} ` +
      `强势股${h.strongCountPrev}→${h.strongCountNow} ` +
      `二线跑赢占比=${h.tier2OutperformRatio === null ? 'NA' : (h.tier2OutperformRatio * 100).toFixed(0) + '%'}\n` +
      `    └ ${h.detail}\n`
    )
  }

  process.stdout.write(`\n【输出一：减仓候选】${rep.reduceCandidates.length}个\n`)
  rep.reduceCandidates.forEach(c => process.stdout.write(line(c) + '\n'))
  if (rep.reduceCandidates.length === 0) process.stdout.write('  （无）\n')

  process.stdout.write(`\n【输出二：潜在新核心】${rep.potentialCores.length}个，其中可执行 ${rep.potentialCores.filter(c => c.actionable).length}个\n`)
  rep.potentialCores.forEach(c => process.stdout.write(line(c) + '\n'))
  if (rep.potentialCores.length === 0) process.stdout.write('  （无）\n')

  process.stdout.write(`\n【输出三：暂不行动】${rep.noAction.length}个\n`)
  rep.noAction.forEach(c => process.stdout.write(line(c) + '\n'))

  process.stdout.write(`\n${'='.repeat(112)}\n结论：${rep.conclusion}\n${'='.repeat(112)}\n`)
}

main().catch(e => {
  process.stderr.write(`MSR 扫描失败: ${e instanceof Error ? e.message : String(e)}\n`)
  process.exit(1)
})
