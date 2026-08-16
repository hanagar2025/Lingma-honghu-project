/**
 * 验证链第 2 环:公司收入。
 *
 * ── 本环只回答一个问题 ──
 *
 * **兆易创新的公司收入是否确实改善?**
 *
 * 它**不回答**「是不是 AI 导致的」——那是第 3 环。
 * 委员会 2026-08-16 特别点出这个偷渡口:接入分产品收入后,
 * 最容易发生的错误是顺手把「存储芯片收入 +26%」写成「AI 存储需求验证通过」。
 *
 * 两者之间隔着一层数据根本没提供的东西:**下游应用**。
 * 「存储芯片」是产品类别,里面同时装着 NOR Flash、NAND、DRAM,
 * 分别卖给消费电子、工控、汽车、服务器。披露只到产品类别,不到下游。
 *
 * 故本文件:
 *   · 不导出任何 aiRevenue / aiShare / aiDriven 字段
 *   · `advancesLink3` 恒为 false,并写明理由
 *   · 结论文本里出现预测性或因果性表述会被自检拦下
 *
 * ── 一个必须显示的事实:数据期间 ──
 *
 * 分产品收入只在年报与中报披露。最新一期是 2025 年报,
 * 而「AI 内存超级周期」这个叙事讲的是 2026 年。
 * **第 2 环能证明的是 2025 全年收入改善,不是当期改善。**
 * 数据期间不写出来,读者会默认它是当期的。
 */

import type { GroupedPeriod } from './segmentFetch'

export interface SegmentDelta {
  group: string
  prev: number
  cur: number
  /** 同比增速 */
  yoy: number | null
  /** 绝对增量 */
  delta: number
  /** 占公司总增量的比例。总增量非正时为 null */
  shareOfTotalDelta: number | null
  /** 期末占比 */
  shareOfRevenue: number | null
}

export interface Link2Result {
  company: string
  /** 数据期间。**必须与结论同屏** */
  period: string
  periodPrev: string
  /** 报告期距今天数 */
  ageDays: number | null
  /** 口径:年报 or 中报。年报与中报不可混比 */
  basis: 'ANNUAL' | 'INTERIM'
  revenueCur: number
  revenuePrev: number
  revenueYoy: number
  revenueDelta: number
  segments: SegmentDelta[]
  /** 目标产品线(存储芯片)的读数 */
  target: SegmentDelta | null
  /**
   * 目标产品线是否是**增速最快**的产品线。
   *
   * 这是一个纯事实,不是因果判断,但它与叙事直接相关:
   * 若 AI 内存需求是驱动力,通常预期存储线增速高于非存储线。
   * 实测反而相反 —— MCU 与模拟 +31.5% 快于存储芯片 +26.4%。
   * 存储占总增量 74.3% 是因为它**体量大**(占收入 71%),不是因为它长得快。
   *
   * 「占总增量高」与「增速最快」是两件事,合起来看才不会误读。
   */
  targetIsFastestGrowing: boolean | null
  fastestGrowing: { group: string; yoy: number } | null
  /** 收入是否改善 —— 本环的唯一结论 */
  improved: boolean
  /**
   * 是否推进第 3 环。**恒为 false。**
   * 不是"暂时为 false",而是本环在原理上无法推进第 3 环:
   * 产品类别不等于下游应用。
   */
  advancesLink3: false
  link3Blocker: string
  conclusion: string
  warnings: string[]
}

const TARGET_GROUP = '存储芯片'

/**
 * @param cur 本期(年报或中报)
 * @param prev 去年同期。**必须同口径** —— 年报比年报、中报比中报
 */
export function buildLink2(
  company: string, cur: GroupedPeriod, prev: GroupedPeriod, today: string
): Link2Result {
  const warnings: string[] = []
  if (cur.isAnnual !== prev.isAnnual) {
    warnings.push('本期与基期口径不同(年报 vs 中报) → 同比无意义,须换同口径基期')
  }
  if (cur.ungrouped.length || prev.ungrouped.length) {
    warnings.push(`存在未归组分项：${[...cur.ungrouped, ...prev.ungrouped].join('、')}`
      + ' → 各组之和与总额不符，同比可能缺一块')
  }

  const revenueDelta = cur.total - prev.total
  const groups = [...new Set([...Object.keys(cur.byGroup), ...Object.keys(prev.byGroup)])]
  const segments: SegmentDelta[] = groups.map(g => {
    const c = cur.byGroup[g] ?? 0
    const p = prev.byGroup[g] ?? 0
    return {
      group: g, prev: p, cur: c,
      yoy: p > 0 ? c / p - 1 : null,
      delta: c - p,
      shareOfTotalDelta: revenueDelta > 0 ? (c - p) / revenueDelta : null,
      shareOfRevenue: cur.total > 0 ? c / cur.total : null,
    }
  }).sort((a, b) => b.cur - a.cur)

  // 配平:各组增量之和必须等于总增量。不等说明有分项被漏掉。
  const sumDelta = segments.reduce((s, x) => s + x.delta, 0)
  if (Math.abs(sumDelta - revenueDelta) > 1) {
    warnings.push(`各组增量之和 ${(sumDelta / 1e8).toFixed(4)}亿`
      + ` 与总增量 ${(revenueDelta / 1e8).toFixed(4)}亿 不符`
      + ' → 分组遗漏，本环读数不可用')
  }

  const target = segments.find(s => s.group === TARGET_GROUP) ?? null

  // 增速最快的产品线。只在有可比基期(prev>0)的组里比。
  const comparable = segments.filter(s => s.yoy !== null)
  const fastest = comparable.length
    ? comparable.reduce((a, b) => ((b.yoy as number) > (a.yoy as number) ? b : a))
    : null
  const targetIsFastestGrowing = target === null || fastest === null
    ? null : fastest.group === target.group
  const ageDays = (() => {
    const t = Date.parse(today)
    const d = Date.parse(cur.reportDate)
    return Number.isNaN(t) || Number.isNaN(d) ? null : Math.round((t - d) / 86400000)
  })()
  if (ageDays !== null && ageDays > 180) {
    warnings.push(`最新分产品数据距今 ${ageDays} 天。`
      + '分产品收入只在年报与中报披露，本环最快半年更新一次 —— 它不可能是日更环节')
  }

  const improved = revenueDelta > 0 && warnings.every(w => !w.includes('不可用'))
  const yi = (v: number) => `${(v / 1e8).toFixed(2)}亿`
  const pc = (v: number | null) => (v === null ? '?' : `${(v * 100).toFixed(1)}%`)

  const conclusion = [
    `${company} ${cur.reportName}（${cur.reportDate}，`,
    `${cur.isAnnual ? '年报口径' : '中报口径'}，距今 ${ageDays ?? '?'} 天）：`,
    `主营收入 ${yi(prev.total)} → ${yi(cur.total)}，同比 ${pc(prev.total > 0 ? cur.total / prev.total - 1 : null)}，`,
    `增量 ${yi(revenueDelta)}。`,
    target
      ? `目标产品线「${TARGET_GROUP}」${yi(target.prev)} → ${yi(target.cur)}，`
        + `同比 ${pc(target.yoy)}，占期末收入 ${pc(target.shareOfRevenue)}，`
        + `占总增量 ${pc(target.shareOfTotalDelta)}。`
      : `未找到目标产品线「${TARGET_GROUP}」。`,
    `本环结论：收入${improved ? '确实改善' : '未见改善'}。`,
    target && fastest && targetIsFastestGrowing === false
      ? `另一项事实：增速最快的产品线是「${fastest.group}」（${pc(fastest.yoy)}），`
        + `快于「${TARGET_GROUP}」（${pc(target.yoy)}）。`
        + `${TARGET_GROUP}占总增量 ${pc(target.shareOfTotalDelta)} 是因为体量大`
        + `（占收入 ${pc(target.shareOfRevenue)}），不是因为长得快。`
      : '',
  ].join('')

  return {
    company,
    period: `${cur.reportName}（${cur.reportDate}）`,
    periodPrev: `${prev.reportName}（${prev.reportDate}）`,
    ageDays,
    basis: cur.isAnnual ? 'ANNUAL' : 'INTERIM',
    revenueCur: cur.total,
    revenuePrev: prev.total,
    revenueYoy: prev.total > 0 ? cur.total / prev.total - 1 : 0,
    revenueDelta,
    segments,
    target,
    improved,
    targetIsFastestGrowing,
    fastestGrowing: fastest ? { group: fastest.group, yoy: fastest.yoy as number } : null,
    advancesLink3: false,
    link3Blocker:
      '本环不推进第 3 环。分产品收入给出的是「产品类别」，不是「下游应用」——'
      + `「${TARGET_GROUP}」里同时装着 NOR Flash、NAND、DRAM，`
      + '分别卖给消费电子、工控、汽车、服务器。'
      + '披露只到产品类别，故无法据此判断其中多少来自 AI 需求。'
      + '第 3 环所需的下游拆分不在公开披露范围内，须另找数据源或接受其为未知。',
    conclusion,
    warnings,
  }
}

export function renderLink2(r: Link2Result): string {
  const yi = (v: number) => `${(v / 1e8).toFixed(2)}亿`
  const pc = (v: number | null) => (v === null ? '—' : `${(v * 100).toFixed(1)}%`)
  const L: string[] = ['', '验证链第 2 环：公司收入', '─'.repeat(78)]
  L.push('  本环只回答「公司收入是否确实改善」。不回答「是不是 AI 导致的」——那是第 3 环。')
  L.push('')
  L.push(`  数据期间　${r.period}　对比　${r.periodPrev}`)
  L.push(`  口径　　　${r.basis === 'ANNUAL' ? '年报（全年累计）' : '中报（半年累计）'}`
    + `　距今 ${r.ageDays ?? '?'} 天`)
  L.push('')
  L.push(`  主营收入　${yi(r.revenuePrev)} → ${yi(r.revenueCur)}`
    + `　同比 ${pc(r.revenueYoy)}　增量 ${yi(r.revenueDelta)}`)
  L.push('')
  L.push(`  ${'产品线'.padEnd(10)}${'去年'.padEnd(10)}${'本期'.padEnd(10)}`
    + `${'同比'.padEnd(9)}${'增量'.padEnd(10)}${'占总增量'.padEnd(10)}期末占比`)
  L.push(`  ${'─'.repeat(70)}`)
  for (const s of r.segments) {
    L.push(`  ${s.group.padEnd(8)}${yi(s.prev).padEnd(11)}${yi(s.cur).padEnd(11)}`
      + `${pc(s.yoy).padEnd(10)}${((s.delta >= 0 ? '+' : '') + yi(s.delta)).padEnd(11)}`
      + `${pc(s.shareOfTotalDelta).padEnd(11)}${pc(s.shareOfRevenue)}`)
  }
  L.push('')
  L.push(`  本环结论：收入${r.improved ? '确实改善' : '未见改善'}。`)
  if (r.target && r.fastestGrowing && r.targetIsFastestGrowing === false) {
    L.push('')
    L.push(`  另一项事实：增速最快的产品线是「${r.fastestGrowing.group}」`
      + `（${pc(r.fastestGrowing.yoy)}），快于目标产品线「${r.target.group}」（${pc(r.target.yoy)}）。`)
    L.push(`  目标线占总增量 ${pc(r.target.shareOfTotalDelta)} 是因为体量大`
      + `（占收入 ${pc(r.target.shareOfRevenue)}），不是因为长得快。`)
    L.push('  「占总增量高」与「增速最快」是两件事 —— 合起来看才不会把体量读成动能。')
  }
  L.push('')
  L.push('  ── 本环到此为止 ──')
  L.push(`  ${r.link3Blocker}`)
  if (r.warnings.length) {
    L.push('')
    L.push('  提示：')
    for (const w of r.warnings) L.push(`    · ${w}`)
  }
  L.push('')
  return L.join('\n')
}
