// 五层驾驶舱的文本渲染
//
// 独立成文件，因为它必须在没有前端、没有数据库、只有一个终端的情况下也能用 ——
// 盘后 15:10 真正需要看到这张表时，最不该出问题的环节是渲染。
//
// 渲染规则（委员会 2026-08-13）：
//   - 每张表的**数据完整度放在最显眼位置**（表头右侧），不放表尾。
//   - 缺失一律显示"缺失/?"，绝不显示 0。
//   - 不输出任何综合评分。
//   - 动作区与前面四张研究表之间用分隔线严格隔开。

import type {
  Dashboard, HoldingRow, MainlineRow, NextLayerRow, NodeStructureRow,
} from './dashboard'

const W = 122

function pad(s: string, width: number): string {
  let w = 0
  for (const ch of s) w += /[\u4e00-\u9fa5\u3000-\u303f（）：、。↑↓→⚠✓✗？]/.test(ch) ? 2 : 1
  return s + ' '.repeat(Math.max(0, width - w))
}

function pct(v: number | null, digits = 1, signed = false): string {
  if (v === null) return '缺失'
  const s = (v * 100).toFixed(digits)
  return `${signed && v > 0 ? '+' : ''}${s}%`
}

function pp(v: number | null): string {
  if (v === null) return '缺失'
  return `${v > 0 ? '+' : ''}${v.toFixed(1)}pct`
}

function yi(v: number | null): string {
  if (v === null) return '缺失'
  return `${(v / 1e8).toFixed(1)}亿`
}

function side(above: boolean | null): string {
  return above === null ? '?' : above ? '上' : '下'
}

function gate(v: boolean | null): string {
  return v === null ? '?' : v ? '✓' : '✗'
}

export function renderDashboard(d: Dashboard): string {
  const L: string[] = []
  const w = (s = '') => L.push(s)

  w()
  w('═'.repeat(W))
  w(`  五层驾驶舱  ${d.date}   组合 × 主线 × 产业链 × 新势能 × 执行`)
  w(`  ${d.sessionNote}`)
  w('═'.repeat(W))

  // ── 首页一句话 ──
  w()
  w('【今日市场状态】')
  w(`  主线：      ${d.headline.mainline}`)
  w(`  结构：      ${d.headline.structure}`)
  w(`  核心：      ${d.headline.core}`)
  w(`  深化：      ${d.headline.deepening}`)
  w(`  切换：      ${d.headline.switching}`)
  w(`  行动：      ${d.headline.action}`)
  w(`  数据完整度：${d.headline.dataCompleteness}`)
  w(`  今日最值得研究：${d.headline.mostWorthResearching}`)

  if (d.session === 'PRE_OPEN') {
    // 盘前刻意只出必办与超限。盘前给全套指标会诱发开盘冲动交易，
    // 而 5/20/60 日结构在盘中本来就算不准。
    w()
    w('─'.repeat(W))
    w('【盘前必办】')
    if (!d.actionZone.mustExecute.length) w('  无')
    for (const m of d.actionZone.mustExecute) w(`  ▸ ${m.label} —— ${m.detail}`)
    w()
    w('【盘前超限与风险】')
    const risky = d.holdings.filter(h => h.status === '超限' || h.status === '数据不足')
    if (!risky.length) w('  无超限')
    for (const h of risky) w(`  ▸ ${h.name}  仓位 ${pct(h.posPct)}  ${h.legalReason ?? h.status}`)
    w()
    w(`【今日新增建仓】${d.actionZone.newEntryCount}`)
    w('─'.repeat(W))
    w('盘前不输出趋势/相对强度/利润结构 —— 这些须盘后收盘价才能算准。')
    return L.join('\n')
  }

  // ══ ① 持仓表 ══
  w()
  w('═'.repeat(W))
  w('① 持仓表 —— 我手里的东西发生了什么？')
  w('═'.repeat(W))
  w(
    `  ${pad('持仓', 12)}${pad('仓位', 8)}${pad('今日', 8)}${pad('5日', 9)}${pad('20日', 9)}` +
    `${pad('相对主线', 10)}${pad('MA20/60', 9)}${pad('PE分位', 8)}${pad('节点利润份额', 14)}` +
    `${pad('节点内份额', 11)}${pad('产业位置', 16)}状态`
  )
  w(`  ${'─'.repeat(W - 2)}`)
  for (const h of d.holdings) {
    w(
      `  ${pad(h.name, 12)}${pad(pct(h.posPct), 8)}${pad(pct(h.ret1), 8)}${pad(pct(h.ret5), 9)}${pad(pct(h.ret20), 9)}` +
      `${pad(pct(h.relMainline, 1, true), 10)}${pad(`${side(h.aboveMa20)}/${side(h.aboveMa60)}`, 9)}` +
      `${pad(h.peUsable && h.pePercentile !== null ? `${(h.pePercentile * 100).toFixed(0)}%` : '不可用', 8)}` +
      `${pad(h.nodeShareArrow, 14)}${pad(h.shareWithinNode === null ? '缺失' : `${(h.shareWithinNode * 100).toFixed(0)}%`, 11)}` +
      `${pad(h.industryPosition, 16)}${h.status}`
    )
  }
  w()
  w('  逐票明细（观察项与法定理由严格分开）：')
  for (const h of d.holdings) {
    w(`  ▸ ${h.name}`)
    w(`      法定减仓理由：${h.legalReason ?? '无'}`)
    w(`      系统动作：    ${h.systemAction}`)
    if (h.reviewTriggers.length) {
      w(`      触发复核 ${h.reviewTriggers.length} 项（不构成减仓理由）：`)
      for (const t of h.reviewTriggers) w(`        · ${t}`)
    }
  }

  // ══ ② 主线表 ══
  w()
  w('═'.repeat(W))
  w('② 主线表 —— 市场现在在哪？哪条主线强？有没有切换？')
  w('═'.repeat(W))
  w(
    `  ${pad('主线', 20)}${pad('趋势', 8)}${pad('相对强度', 10)}${pad('成交/资金代理', 15)}` +
    `${pad('利润结构', 10)}${pad('龙头状态', 22)}${pad('数据完整度', 12)}当前判断`
  )
  w(`  ${'─'.repeat(W - 2)}`)
  for (const m of d.mainlines) {
    w(
      `  ${pad(m.name, 20)}${pad(m.trend, 8)}${pad(m.relStrength, 10)}${pad(m.volumeProxy, 15)}` +
      `${pad(m.profitStructure, 10)}${pad(m.leaderStatus, 22)}` +
      `${pad(m.completeness === null ? '缺失' : `${(m.completeness * 100).toFixed(0)}%`, 12)}` +
      `${m.judgable ? '' : '⚠ '}${m.verdict}`
    )
  }
  w()
  w('  「成交/资金代理」是成交额比值，不是真实资金流（北向/融资/龙虎榜/机构持仓免费源不可得）。')
  w('  「不可判断」是合法输出：数据完整度不足的主线，即使价格在涨也不得输出主线强弱结论。')

  // ══ 市场结构 ══
  w()
  w('═'.repeat(W))
  w('   市场结构判断 —— 是「切主线」还是「打深一层」？')
  w('═'.repeat(W))
  w(`  ${d.marketStructure.headline}`)
  w()
  for (const e of d.marketStructure.evidence) w(`    · ${e}`)
  w()
  w(`  主线切换：${d.marketStructure.switchEvidence}`)
  w(`  ⚠ 本判断描述的是「已披露的历史利润分配」，不预测价格，且不得产生任何动作。`)

  // ══ ③ 产业结构表 ══
  w()
  w('═'.repeat(W))
  w('③ 产业结构表 —— 主线内部的钱在哪里？是继续集中在原核心，还是向下一层扩散？')
  w('═'.repeat(W))
  for (const [mlId, rows] of Object.entries(d.nodeStructure)) {
    const ml = d.mainlines.find(m => m.mainlineId === mlId)
    w()
    w(`  【${ml?.name ?? mlId}】数据完整度 ${ml?.completeness === null || ml?.completeness === undefined ? '缺失' : `${(ml.completeness * 100).toFixed(0)}%`}` +
      (ml && !ml.judgable ? '  ⚠ 当前结论不可用于机会判断' : ''))
    w(
      `    ${pad('节点', 18)}${pad('A利润规模', 12)}${pad('B存量份额', 12)}${pad('C四季变化', 12)}` +
      `${pad('节点内领先公司', 26)}${pad('方向', 10)}${pad('滞后', 8)}覆盖`
    )
    w(`    ${'─'.repeat(W - 4)}`)
    for (const r of rows) {
      const leaders = r.leaders.length
        ? r.leaders.map(l => `${l.name}${l.shareWithinNode === null ? '' : ` ${(l.shareWithinNode * 100).toFixed(0)}%`}`).join('、')
        : '—'
      w(
        `    ${pad(r.node, 18)}${pad(yi(r.npLevel), 12)}${pad(r.levelShare === null ? '缺失' : `${(r.levelShare * 100).toFixed(1)}%`, 12)}` +
        `${pad(pp(r.delta4Q), 12)}${pad(leaders, 26)}${pad(r.direction, 10)}` +
        `${pad(r.maxReportAgeDays === null ? '—' : `${r.maxReportAgeDays}天`, 8)}${r.researchOnly ? '仅研究域' : '决策域'}`
      )
    }
  }

  // ══ ④ 下一观察层 ══
  w()
  w('═'.repeat(W))
  w('④ 下一观察层 —— 接下来应该盯谁？（发现 ≠ 候选 ≠ 买入）')
  w('═'.repeat(W))
  w(
    `  ${pad('节点', 18)}${pad('产业', 8)}${pad('利润', 8)}${pad('节点份额', 10)}${pad('资金', 8)}` +
    `${pad('相对强度', 10)}${pad('估值', 16)}${pad('证据', 10)}${pad('S0/S1/S2/S3/资金', 22)}阶段`
  )
  w(`  ${'─'.repeat(W - 2)}`)
  for (const r of d.nextLayer) {
    const g = r.gates
    w(
      `  ${pad(r.node, 18)}${pad(r.industryTrend, 8)}${pad(r.profitTrend, 8)}` +
      `${pad(r.nodeShare === null ? '缺失' : `${(r.nodeShare * 100).toFixed(1)}%`, 10)}${pad(r.money, 8)}` +
      `${pad(r.relStrength, 10)}${pad(r.valuation, 16)}${pad(r.evidenceTier, 10)}` +
      `${pad(`${gate(g.s0Discovered)} / ${gate(g.s1Industry)} / ${gate(g.s2Earnings)} / ${gate(g.s3Valuation)} / ?`, 22)}` +
      // 「无在册标的」与「战略层不允许」是两回事，不能共用一个标记：
      // 前者是覆盖缺口（需补研究标的），后者是战略层已关闭仓位资格（需走冠军替换）。
      `${r.stage}${r.members.length === 0
        ? ' ⚠无在册标的'
        : r.strategyAllows === false ? ' ⚠战略层不允许' : ''}`
    )
  }
  w()
  w('  逐节点阻断项：')
  for (const r of d.nextLayer.filter(x => x.stage === '观察')) {
    w(`  ▸ ${r.node}${r.members.length ? `（${r.members.map(m => m.name).join('、')}）` : '（无在册标的）'}  动作许可：❌`)
    for (const b of r.actionBlockedBy) w(`      · ${b}`)
  }
  w()
  w('  「资金」列恒为 ? —— 真实资金流数据免费源不可得，不用价格代理冒充资金验证。')

  // ══ ⑤ 动作区 ══
  w()
  w('█'.repeat(W))
  w('⑤ 动作区 —— 与上面四张研究表严格隔离')
  w('█'.repeat(W))
  w()
  w('  必须执行：')
  if (!d.actionZone.mustExecute.length) w('    无')
  for (const m of d.actionZone.mustExecute) w(`    ▸ ${m.label}\n        ${m.detail}`)
  w()
  w('  允许研究（不是允许买入）：')
  if (!d.actionZone.allowedResearch.length) w('    无')
  for (const m of d.actionZone.allowedResearch) w(`    ▸ ${m.label}\n        ${m.detail}`)
  w()
  w('  禁止动作：')
  if (!d.actionZone.forbidden.length) w('    无')
  for (const m of d.actionZone.forbidden) w(`    ▸ ${m.label}\n        ${m.detail}`)
  w()
  w(`  今日新增建仓：${d.actionZone.newEntryCount}`)

  // ── 数据缺口 ──
  w()
  w('─'.repeat(W))
  w('【数据缺口】不知道，本身就是信息')
  for (const g of d.dataGaps) w(`  · ${g}`)
  w()
  w(`※ ${d.noCompositeScoreNote}`)

  return L.join('\n')
}
