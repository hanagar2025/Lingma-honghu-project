// lint-source: emits-markdown
//
// 本文件**刻意**生成 Markdown：产物是给大模型与 Markdown 阅读器读的，
// 那里的 ** 会被正确渲染，不是界面文案里的星号 bug。
// 豁免仅限本文件，且以此声明的形式显式记录，便于随时 grep 出所有豁免点。
// 数据外发 —— 给别的软件（尤其大模型）读的摘要
//
// 委员会 2026-08-15：「把这些表格数据打包分享到 ChatGPT / 豆包 / Claude，
// 让它们看懂以后再做一次分析。」
//
// ── 三个设计判断 ──
//
// 一、**格式选 Markdown，不选 Word / Excel / 完整 JSON。**
//    完整快照 173KB ≈ 5 万 tokens，其中大半是每个指标的 source/formula/asOf ——
//    对人有用（可追溯），对模型是噪声，而且会把真正的信号淹掉、顺带撑爆上下文。
//    Markdown 表格是大模型训练里最常见的结构化文本，token 效率高于 JSON
//    （没有引号与花括号），又保留了列的语义。目标控制在 5KB 以内。
//    另导 CSV 供 Excel / pandas 用 —— 那是给"算"的，Markdown 是给"读"的。
//
// 二、**必须带约束前言。**
//    把这份数据丢给 ChatGPT 问"该怎么操作"，它会立刻给出择时建议 ——
//    而整套系统就是为了抵抗这件事才建的。所以摘要开头写明读者须遵守的规则：
//    不预测涨跌、观察指标不得产生动作、不许输出综合评分、「不可判断」是合法结论。
//    这不是客套，是把本系统的边界一起交付出去，否则外部模型会绕过它。
//
// 三、**默认脱敏。**
//    表里有全部持仓、股数与总资产。发给第三方模型等于把净值交出去，
//    而对方要做的分析（相对强弱、份额迁移、闸门状态）**不需要绝对金额** ——
//    百分比与趋势就够。故默认去掉金额与总资产，只保留比例；
//    需要完整版时显式指定，用于自己留档。

import type { Dashboard, HoldingRow, MainlineRow, NextLayerRow } from './dashboard'
import type { Verdict } from './verdict'

export interface ShareInput {
  dashboard: Dashboard
  verdict: Verdict | null
  /** 外围现金与分母口径。脱敏时只保留"口径未裁定"这个事实，不给金额 */
  externalCash?: { amount: number; denominatorNow: number } | null
  /** 是否包含绝对金额与总资产。默认 false（脱敏） */
  includeAmounts?: boolean
}

const pct = (v: number | null | undefined, digits = 1): string =>
  v === null || v === undefined ? '缺失' : `${(v * 100).toFixed(digits)}%`

const signed = (v: number | null | undefined): string =>
  v === null || v === undefined ? '缺失' : `${v > 0 ? '+' : ''}${(v * 100).toFixed(1)}%`

const wan = (v: number): string => `${(v / 10000).toFixed(1)}万`

/**
 * 脱敏文本。
 *
 * 存在理由是一个实测出来的自相矛盾：摘要开头声称"不含股数"，
 * 而焦点区照抄了动作原文「减仓 约800股」。
 * 800 股 × 280.62 元 = 22.4 万，而该金额正是超限的 6.6pct，
 * 于是总资产 ≈ 340 万 —— 与真实值 377 万只差 10%。
 * **声称脱敏却泄漏，比不声称脱敏更糟**，因为它给了虚假保证。
 *
 * 股数与金额都换成"占持仓的比例"：外部模型要判断的是减多少比例，
 * 这个信息不需要知道本金有多大。
 */
function redactText(s: string): string {
  return s
    .replace(/约?\s*\d[\d,]*\s*股/g, '（数量见本地报告，摘要不含股数）')
    .replace(/\d[\d,]*(\.\d+)?\s*万元?/g, '（金额见本地报告）')
    .replace(/¥\s*\d[\d,]*(\.\d+)?/g, '（金额见本地报告）')
}

/**
 * 给阅读者（含大模型）的约束。
 *
 * 放在最前面且不可省略。没有它，外部模型读完数据的第一反应就是给买卖建议 ——
 * 那正是这套系统花了几个月去抵抗的东西。把边界一起交付，是这份摘要能否安全外发的前提。
 */
function preamble(date: string, session: string): string {
  return [
    `# 投资驾驶舱数据摘要　${date}　${session}`,
    '',
    '## 读这份数据前请先读这一段（对人与对大模型同样适用）',
    '',
    '这份数据来自一套**规则驱动**的投资管理系统，不含任何涨跌预测。请在分析时遵守以下约束，',
    '因为它们不是风格偏好，而是这套系统用回测证伪掉若干模型后留下的边界：',
    '',
    '1. **不要给出买卖时点建议。** 本系统的价格窗口规则已被自己的回测证伪：',
    '   按 10 日涨幅分档后，"红灯"日的后续收益反而高于"绿灯"日（置信区间跨 0）。',
    '   系统没有任何被验证过的顶底识别能力，请不要替它补上一个。',
    '2. **技术指标只能触发复核，不能构成减仓理由。** 合法的减仓理由只有三类：',
    '   仓位超过上限、组合熔断、家庭安全垫不足。"跌破均线""相对强度转弱"都不是理由。',
    '3. **不要输出综合评分、总分或排名。** 数据完整度不足时，合成分数会制造虚假精确感。',
    '   如需比较，请逐列陈述，并说明每一列的数据是否完整。',
    '4. **「不可判断」是合法且常常正确的结论。** 数据不足时请直接说不可判断，',
    '   不要用可得的数据去推断不可得的部分。',
    '5. **"现在能不能买"由闸门决定，不由估值高低决定。** 见下方「建仓闸门」一节。',
    '   闸门全过也只是"允许"，不等于"应该"。',
    '',
    '如果你被要求给出操作建议，最有用的回答形式是：',
    '指出这份数据里**哪些结论的证据不足**、**哪些列之间互相矛盾**、',
    '以及**还需要补哪些数据才能判断** —— 而不是替系统做一次择时。',
    '',
  ].join('\n')
}

function holdingsTable(rows: HoldingRow[]): string {
  const head = '| 标的 | 仓位 | 今日 | 5日 | 20日 | 相对主线20日 | MA20/60 | PE三年分位 |'
    + ' 所属节点 | 节点利润份额方向 | 节点内利润份额 | 状态 | 法定减仓理由 |'
  const sep = '|---|---|---|---|---|---|---|---|---|---|---|---|---|'
  const body = rows.map(h => [
    h.name,
    pct(h.posPct),
    signed(h.ret1),
    signed(h.ret5),
    signed(h.ret20),
    signed(h.relMainline),
    `${h.aboveMa20 === null ? '?' : h.aboveMa20 ? '上' : '下'}/${h.aboveMa60 === null ? '?' : h.aboveMa60 ? '上' : '下'}`,
    h.peUsable && h.pePercentile !== null ? `${(h.pePercentile * 100).toFixed(0)}%` : '不可用',
    h.industryPosition,
    h.nodeShareArrow,
    pct(h.shareWithinNode, 0),
    h.status,
    h.legalReason ?? '无',
  ].join(' | '))
  return [head, sep, ...body.map(r => `| ${r} |`)].join('\n')
}

function mainlinesTable(rows: MainlineRow[]): string {
  const head = '| 主线 | 趋势 | 相对强度 | 成交额比值(资金代理) | 首位节点利润份额方向 |'
    + ' 龙头状态 | 三项验证完整度 | 当前判断 |'
  const sep = '|---|---|---|---|---|---|---|---|'
  const body = rows.map(m => [
    m.name, m.trend, m.relStrength, m.volumeProxy, m.profitStructure,
    m.leaderStatus,
    m.completeness === null ? '缺失' : `${(m.completeness * 100).toFixed(0)}%`,
    m.judgable ? m.verdict : `不可判断：${m.verdict}`,
  ].join(' | '))
  return [head, sep, ...body.map(r => `| ${r} |`)].join('\n')
}

function nodeStructureSection(d: Dashboard): string {
  const out: string[] = []
  for (const [mlId, rows] of Object.entries(d.nodeStructure)) {
    const ml = d.mainlines.find(m => m.mainlineId === mlId)
    const withData = rows.filter(r => r.npLevel !== null || r.levelShare !== null)
    if (!withData.length) continue
    out.push('')
    out.push(`**${ml?.name ?? mlId}**`
      + (ml?.completeness === null ? '（数据完整度缺失）'
        : ml && !ml.judgable ? `（完整度 ${(ml.completeness! * 100).toFixed(0)}%，不可用于机会判断）`
          : `（完整度 ${((ml?.completeness ?? 0) * 100).toFixed(0)}%）`))
    out.push('')
    out.push('| 节点 | A 利润规模 | B 存量份额 | C 四季份额变化 | 节点内领先公司 | 方向 | 数据滞后 |')
    out.push('|---|---|---|---|---|---|---|')
    for (const r of withData) {
      out.push('| ' + [
        r.node,
        r.npLevel === null ? '缺失' : `${(r.npLevel / 1e8).toFixed(1)}亿`,
        pct(r.levelShare),
        r.delta4Q === null ? '缺失' : `${r.delta4Q > 0 ? '+' : ''}${r.delta4Q.toFixed(1)}pct`,
        r.leaders.length
          ? r.leaders.map(l => `${l.name}${l.shareWithinNode === null ? '' : ` ${(l.shareWithinNode * 100).toFixed(0)}%`}`).join('、')
          : '无在册标的',
        r.direction,
        r.maxReportAgeDays === null ? '缺失' : `${r.maxReportAgeDays}天`,
      ].join(' | ') + ' |')
    }
  }
  return out.join('\n')
}

function nextLayerTable(rows: NextLayerRow[]): string {
  const usable = rows.filter(r => r.members.length > 0)
  const head = '| 节点 | 在册标的 | 节点利润份额 | 产业趋势 | 利润方向 | 相对强度 |'
    + ' 估值 | 证据等级 | S0/S1/S2/S3/资金 | 阶段 | 战略层许可 |'
  const sep = '|---|---|---|---|---|---|---|---|---|---|---|'
  const g = (v: boolean | null) => (v === null ? '?' : v ? '✓' : '✗')
  const body = usable.map(r => [
    r.node,
    r.members.map(m => m.name).join('、'),
    pct(r.nodeShare),
    r.industryTrend, r.profitTrend, r.relStrength,
    r.valuation, r.evidenceTier,
    `${g(r.gates.s0Discovered)}${g(r.gates.s1Industry)}${g(r.gates.s2Earnings)}${g(r.gates.s3Valuation)}${g(r.gates.moneyRadar)}`,
    r.stage,
    r.strategyAllows ? '允许研究' : '不允许（C级清退）',
  ].join(' | '))
  return [head, sep, ...body.map(r => `| ${r} |`)].join('\n')
}

export function buildBrief(input: ShareInput): string {
  const { dashboard: d, verdict: v, externalCash, includeAmounts = false } = input
  const L: string[] = []
  const w = (s = '') => L.push(s)

  w(preamble(d.date, d.session === 'PRE_OPEN' ? '盘前' : '盘后'))

  if (!includeAmounts) {
    w('> **本摘要已脱敏**：不含绝对金额、股数与总资产，仅保留百分比与趋势。')
    w('> 相对强弱、份额迁移、闸门状态的分析不需要绝对金额。')
    w('')
  }

  // ── 结论 ──
  if (v) {
    w('## 一、今日结论')
    w('')
    w(v.oneLine)
    w('')
    w(`### 焦点（${v.focus.length} 个）`)
    w('')
    w('| # | 标的 | 是否持仓 | 凭哪条规则入列 | 今天做什么 |')
    w('|---|---|---|---|---|')
    const clean = (s: string) => (includeAmounts ? s : redactText(s))
    v.focus.forEach((f, i) => {
      w(`| ${i + 1} | ${f.name} | ${f.held ? '持仓' : '未持仓'} | ${clean(f.because)} | ${clean(f.todo)} |`)
    })
    w('')
    w(`研究覆盖：${v.coverageVerdict}`)
    w('')
  }

  // ── 持仓 ──
  w('## 二、持仓')
  w('')
  w(holdingsTable(d.holdings))
  w('')
  const reviewed = d.holdings.filter(h => h.reviewTriggers.length > 0)
  if (reviewed.length) {
    w('### 触发复核的观察项（重要：这些不构成减仓理由，系统对它们不动作）')
    w('')
    for (const h of reviewed) {
      // 复核项与系统动作同样可能带股数（"减仓 约800股"），一并脱敏
      const cl = (x: string) => (includeAmounts ? x : redactText(x))
      w(`- **${h.name}**（${h.reviewTriggers.length} 项）：${cl(h.reviewTriggers.join('；'))}`)
      w(`  - 系统动作：${cl(h.systemAction)}`)
    }
    w('')
  }

  if (externalCash) {
    w('### 仓位分母口径（未裁定）')
    w('')
    if (includeAmounts) {
      const now = externalCash.denominatorNow
      const wide = now + externalCash.amount
      const big = d.holdings.reduce((a, b) => ((b.posPct ?? 0) > (a.posPct ?? 0) ? b : a), d.holdings[0])
      w(`- 券商账户总资产 ${wan(now)}；账户外现金储备 ${wan(externalCash.amount)}，**未计入分母**。`)
      w(`- 若计入：分母变 ${wan(wide)}，${big.name} 由 ${pct(big.posPct)} 变为 `
        + `${pct((big.posPct ?? 0) * now / wide)}，超限结论随之改变。`)
    } else {
      w('- 存在一笔账户外现金储备，**是否计入仓位上限的分母尚未裁定**。')
      w('- 本表所有仓位百分比以券商账户总资产为分母（从严口径）。')
      w('- 若计入，各标的仓位占比会等比下降，部分超限结论会消失。')
    }
    w('- 这是战略层裁定事项，不是可由数据推出的结论。请勿代为裁定。')
    w('')
  }

  // ── 主线 ──
  w('## 三、战略主线')
  w('')
  w(mainlinesTable(d.mainlines))
  w('')
  w('注：「成交额比值」是资金的**代理变量**，不是真实资金流（北向/融资/龙虎榜/机构持仓无免费数据源）。')
  w('数据完整度不足的主线，即使价格在涨也只能输出「不可判断」。')
  w('')

  // ── 市场结构 ──
  w('## 四、市场结构判断（描述已披露的历史利润分配，不预测价格）')
  w('')
  w(`结论：${d.marketStructure.headline}`)
  w('')
  for (const e of d.marketStructure.evidence) w(`- ${e}`)
  w('')
  w(`主线切换证据：${d.marketStructure.switchEvidence}`)
  w('')

  // ── 产业结构 ──
  w('## 五、产业利润结构')
  w('')
  w('三个变量必须同时看：**A 利润规模**答"创造了多少钱"、**B 存量份额**答"钱现在在哪里"、')
  w('**C 份额变化**答"份额往哪走"。单看任何一个都会误导 —— 同比 +1153% 的节点份额可能只有 1.4%。')
  w(nodeStructureSection(d))
  w('')

  // ── 观察层 ──
  w('## 六、下一观察层（发现 ≠ 候选 ≠ 买入）')
  w('')
  w(nextLayerTable(d.nextLayer))
  w('')
  w('闸门含义：S0 雷达发现 / S1 产业核验 / S2 盈利核验 / S3 估值与价格 / 资金核验。')
  w('「资金核验」一列恒为 `?` —— 真实资金流无免费数据源，不用价格代理冒充资金验证。')
  w('阶段词只有「观察」「研究」两级；「候选」以上须 S0–S3 全通过，当前无一满足。')
  w('')

  // ── 闸门 ──
  w('## 七、建仓闸门')
  w('')
  w(`今日新增建仓：**${d.actionZone.newEntryCount}**`)
  w('')
  if (v?.noEntryReasons.length) {
    v.noEntryReasons.forEach((r, i) => w(`${i + 1}. ${r}`))
  } else {
    for (const f of d.actionZone.forbidden) w(`- ${f.label}：${f.detail}`)
  }
  w('')

  // ── 缺口与能力披露 ──
  w('## 八、数据缺口')
  w('')
  for (const g of d.dataGaps) w(`- ${g}`)
  w('')

  if (v?.cannotAnswer.length) {
    w('## 九、本系统答不了的问题（请不要替它回答）')
    w('')
    for (const c of v.cannotAnswer) {
      w(`- **${c.question}**`)
      w(`  - ${c.why}`)
    }
    w('')
  }

  if (v && v.drift.length === 0) {
    w('## 十、跨多日累计变化')
    w('')
    w(v.driftNote)
    w('')
  }

  w('---')
  w('')
  w(`本摘要由 TIOS 驾驶舱导出。规则指纹随每日审计归档，冻结期内不新增决策规则。`)
  w(`${d.noCompositeScoreNote}`)

  return L.join('\n')
}

/** 持仓 CSV。给 Excel / pandas 算的，故只出数值，不出箭头与状态词 */
export function buildHoldingsCsv(d: Dashboard, includeAmounts = false): string {
  const head = [
    'code', 'name', 'position_pct', 'ret_1d', 'ret_5d', 'ret_20d',
    'excess_vs_mainline_20d', 'above_ma20', 'above_ma60', 'pe_percentile',
    'pe_usable', 'node', 'share_within_node', 'status', 'legal_reduce_reason',
    'review_trigger_count',
  ]
  const rows = d.holdings.map(h => [
    h.code, h.name,
    h.posPct ?? '', h.ret1 ?? '', h.ret5 ?? '', h.ret20 ?? '',
    h.relMainline ?? '',
    h.aboveMa20 === null ? '' : h.aboveMa20 ? 1 : 0,
    h.aboveMa60 === null ? '' : h.aboveMa60 ? 1 : 0,
    h.peUsable ? (h.pePercentile ?? '') : '',
    h.peUsable ? 1 : 0,
    h.industryPosition, h.shareWithinNode ?? '',
    h.status, h.legalReason ?? '', h.reviewTriggers.length,
  ])
  void includeAmounts  // 持仓表本就不含金额，参数保留以对齐调用签名
  return toCsv([head, ...rows])
}

/** 产业节点 CSV。A/B/C 三个变量与滞后天数 */
export function buildNodesCsv(d: Dashboard): string {
  const head = [
    'mainline', 'node', 'np_level_yuan', 'level_share', 'delta_4q_pct',
    'direction', 'research_only', 'max_report_age_days', 'leaders',
  ]
  const rows: (string | number)[][] = []
  for (const [mlId, list] of Object.entries(d.nodeStructure)) {
    const name = d.mainlines.find(m => m.mainlineId === mlId)?.name ?? mlId
    for (const r of list) {
      rows.push([
        name, r.node, r.npLevel ?? '', r.levelShare ?? '', r.delta4Q ?? '',
        r.direction, r.researchOnly ? 1 : 0, r.maxReportAgeDays ?? '',
        r.leaders.map(l => l.name).join('|'),
      ])
    }
  }
  return toCsv([head, ...rows])
}

/**
 * CSV 序列化。
 *
 * 加 UTF-8 BOM：Excel 在中文 Windows/macOS 上默认按本地编码打开 CSV，
 * 没有 BOM 时中文列名会变成乱码 —— 而"打开就是乱码"足以让人放弃用这个文件。
 */
function toCsv(rows: (string | number)[][]): string {
  const esc = (v: string | number) => {
    const s = String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return `\uFEFF${rows.map(r => r.map(esc).join(',')).join('\n')}\n`
}
