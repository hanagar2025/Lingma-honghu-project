// 利润池迁移地图 CLI
//
// 运行：npm run profit:map
//
// 输出的是会计事实与描述性标签，**不产出买入候选、不产出动作**。
// 「重点研究」不等于「可以买」——后者只由 S3 与执行闸门决定。

import { buildProfitMap, type NodeProfit } from './profitRadar'

const MAINLINE_NAME: Record<string, string> = {
  optical: 'AI光通信', semi: '半导体国产替代', compute: 'AI算力', power: 'AI电力基础设施', 未归属: '未归属',
}
const STATUS_TEXT: Record<NodeProfit['status'], string> = {
  ACCELERATING: '单季净利同比加速',
  DECELERATING: '单季净利同比减速',
  MIXED: '内部分化',
  LEVEL_ONLY: '仅有同比读数',
  NO_DATA: '无可用数据',
}

function pct(v: number | null, digits = 1): string {
  return v === null ? '—' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(digits)}%`
}
function pp(v: number | null, digits = 1): string {
  return v === null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(digits)}pct`
}
function yi(v: number | null): string {
  return v === null ? '—' : `${(v / 1e8).toFixed(1)}亿`
}

function main(): void {
  const today = process.argv[2] ?? new Date().toISOString().slice(0, 10)
  const map = buildProfitMap(today)
  const out = process.stdout
  const W = 118

  out.write(`\n${'═'.repeat(W)}\n`)
  out.write(`  主线利润池迁移地图  ${today}\n`)
  out.write(`${'═'.repeat(W)}\n\n`)

  out.write(`⚠ 数据新鲜度：${map.freshness.warning}\n\n`)

  for (const mlId of ['optical', 'semi', 'compute', 'power', '未归属']) {
    const nodes = map.nodes.filter(n => n.mainlineId === mlId)
    if (!nodes.length) continue
    out.write(`${'─'.repeat(W)}\n【${MAINLINE_NAME[mlId] ?? mlId}】\n${'─'.repeat(W)}\n`)
    out.write(
      `  ${'节点'.padEnd(12)}${'状态'.padEnd(14)}${'单季净利同比中位'.padEnd(12)}` +
      `${'加速数'.padEnd(8)}${'数据滞后'.padEnd(10)}覆盖\n`
    )
    // 按单季净利同比中位数降序，仅为阅读方便，不构成排序推荐
    const sorted = [...nodes].sort((a, b) => (b.medianNpYoy ?? -Infinity) - (a.medianNpYoy ?? -Infinity))
    for (const n of sorted) {
      const cov = n.researchOnly ? '仅研究域' : `${n.members.filter(m => m.scope === 'DECISION').length}只决策域`
      out.write(
        `  ${n.node.padEnd(12)}${STATUS_TEXT[n.status].padEnd(14)}` +
        `${pct(n.medianNpYoy).padEnd(14)}${`${n.accelerating}/${n.members.length}`.padEnd(9)}` +
        `${(n.maxReportAgeDays === null ? '—' : `${n.maxReportAgeDays}天`).padEnd(10)}${cov}\n`
      )
    }
    out.write('\n')

    // 逐标的明细
    for (const n of sorted) {
      if (!n.members.length) continue
      out.write(`  ▸ ${n.node}\n`)
      for (const m of n.members) {
        out.write(
          `      ${m.name.padEnd(7)}${m.code}  ${m.scope === 'RESEARCH' ? '[研究]' : '[决策]'}  ` +
          `${m.latestReport ?? '无数据'}\n`
        )
        out.write(
          `        单季收入 ${yi(m.latestSingle?.revenue ?? null)}（同比 ${pct(m.latestSingle?.revenueYoy ?? null)}）` +
          `  单季净利 ${yi(m.latestSingle?.netProfit ?? null)}（同比 ${pct(m.latestSingle?.netProfitYoy ?? null)}）\n`
        )
        out.write(
          `        同比加速 ${pp(m.npYoyAccelPct)}  毛利率 ${m.grossMargin === null ? '—' : `${m.grossMargin.toFixed(1)}%`}` +
          `（同比 ${pp(m.grossMarginYoyPct)}）  扣非占比 ${m.deductRatio === null ? '—' : `${(m.deductRatio * 100).toFixed(0)}%`}` +
          `${m.deductRatioAsOf ? `@${m.deductRatioAsOf}` : ''}  现金含量 ${m.cashMatch === null ? '—' : m.cashMatch.toFixed(2)}\n`
        )
        if (m.dataGaps.length) out.write(`        缺口：${m.dataGaps.join('；')}\n`)
      }
      out.write('\n')
    }
  }

  out.write(`${'═'.repeat(W)}\n`)
  out.write(`本数据源不可得，须人工建档：${map.unavailableFields.join('、')}\n`)
  out.write(
    '\n本地图是会计事实与描述性标签，等级为 ACCOUNTING/OBSERVATION，' +
    '不产出买入候选、不产出动作。「重点研究」不等于「可以买」。\n'
  )
  out.write(`${'═'.repeat(W)}\n`)
}

main()
