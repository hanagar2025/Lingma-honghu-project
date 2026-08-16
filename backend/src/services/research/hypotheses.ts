/**
 * 外部叙事台账。
 *
 * ── 存在理由 ──
 *
 * 外部叙事（研报、访谈、视频）会不断到来，而它们的共同特征是：
 * **听起来已经完成了论证，实际上只完成了第一步。**
 * 「AI 内存超级周期来了」这句话里，"AI 需要内存"是可验证的产业事实，
 * "超级周期"是对未来三到五年的外推，"所以存储要起飞"是价格判断，
 * 三者被一句话缝在一起，读的人很难分辨自己接受了哪一部分。
 *
 * 这个台账做的事只有一件：**把一句话拆回它实际所处的验证阶段。**
 * 不打分，不排序，不产生候选，不产生动作。
 *
 * ── 为什么它不能产生动作（类型层面的保证）──
 *
 * `tier` 恒为 `'OBSERVATION'`。按 cockpit/types.ts 的 EvidenceTier 约定，
 * OBSERVATION 级读数只能进复核区，不能进动作区。这里不导出任何
 * 返回 Action 的函数 —— 不是"约定不用"，而是没有那个函数可用。
 *
 * ── 为什么不做成"存储主线" ──
 *
 * 委员会 2026-08-16 明确：叙事成立 ≠ 主线开放。开一条主线意味着
 * 它进入 MAINLINES、参与仓位上限聚合、其节点可产生候选。
 * 而当前存储节点唯一在册标的是 C 级清退的兆易创新 ——
 * 主线开放会让这只票通过"节点份额扩大"重新获得曝光，
 * 绕过冠军替换程序。这正是 strategyAllows 闸门要拦的事。
 */

import type { EvidenceTier } from '../cockpit/types'

/**
 * 叙事进入决策层必须走完的七步。
 *
 * 顺序不可跳。每一步都是上一步的**兑现**而不是上一步的**推论**：
 * 产业数据改善不必然带来公司收入增长（可能被价格战吃掉），
 * 收入增长不必然带来扣非利润（可能靠补贴或一次性收益），
 * 扣非利润增长不必然带来主线份额扩大（同行可能增长更快）。
 *
 * 我们已经在仕佳光子上吃过一次亏：利润增长是真的，
 * 但穿透后发现驱动来自非 AI 业务 —— 那次教训直接生成了第 3 步。
 */
export const VERIFICATION_CHAIN = [
  '叙事',
  '产业数据',
  '公司收入',
  '扣非利润',
  '主线利润份额',
  '节点内份额',
  '战略许可',
] as const

export type ChainStage = typeof VERIFICATION_CHAIN[number]

/** 单条待验指标。`status` 只有三态，刻意不设"部分满足" */
export interface Indicator {
  no: number
  text: string
  /** MET = 已有数据支持；UNVERIFIED = 无数据；REFUTED = 数据反向 */
  status: 'MET' | 'UNVERIFIED' | 'REFUTED'
  /** 数据来源或缺失原因。MET 时必须写明出处，否则等于自证 */
  evidence: string
}

export interface Hypothesis {
  id: string
  /** 叙事原文的核心主张，用它自己的话，不美化也不弱化 */
  claim: string
  source: string
  loggedOn: string
  /** 涉及的节点。用于在驾驶舱里与节点数据并列显示 */
  node: string
  mainline: string
  /** 当前走到链条的第几步（1 起） */
  stage: number
  /** 五项硬指标 */
  indicators: Indicator[]
  /** 明确不因本条成立的事 —— 写出来是为了防止读者自行外推 */
  doesNotImply: string[]
  /** 阻塞项：即便数据全部兑现，仍需先解决的事 */
  blockers: string[]
  tier: EvidenceTier
}

/**
 * 存储 / AI 内存需求。
 *
 * 委员会 2026-08-16 裁定：值得研究，不得进入动作层。
 */
export const HYPOTHESES: Hypothesis[] = [
  {
    id: 'H1',
    claim:
      'AI 推动内存需求结构性提升 → 存储产业利润池扩大 → 国产存储节点开始获得利润份额；'
      + '并伴随一个「3–5 年超级周期」与「AI 改变传统存储周期」的外推。',
    source: '外部视频/访谈（委员会 2026-08-16 转述）',
    loggedOn: '2026-08-16',
    node: '存储',
    mainline: '半导体国产替代',
    // 停在第 1 步。第 5 步（主线利润份额）虽已有数据，但链条不可跳步 ——
    // 中间三步未验证时，份额扩大无法归因于 AI 内存需求，
    // 它同样可以来自周期性涨价、同行掉队、或一次性收益。
    stage: 1,
    indicators: [
      {
        no: 1,
        text: 'AI 相关内存需求占比是否持续提高',
        status: 'UNVERIFIED',
        evidence: '无在册数据源。需要按下游用途拆分的内存出货结构，免费源不可得。',
      },
      {
        no: 2,
        text: 'DRAM / NAND / HBM 价格与供需是否真正改善',
        status: 'UNVERIFIED',
        evidence: '无在册数据源。现货价与合约价均需付费数据库。',
      },
      {
        no: 3,
        text: '国产厂商收入增长是否来自存储主线',
        status: 'UNVERIFIED',
        evidence:
          '主线归因字段尚未接入（与 S2 盈利验证同一缺口）。'
          + '「这是仕佳光子那次教训对应的那一条」 —— 利润增长是真的，'
          + '穿透后驱动来自非 AI 业务。不做归因就等于重犯。',
      },
      {
        no: 4,
        text: '扣非利润绝对增量是否扩大',
        status: 'UNVERIFIED',
        evidence:
          '利润结构地图当前用归母净利润，扣非字段尚未接入。'
          + '两者差额正是补贴与一次性收益，而那部分不构成产业兑现。',
      },
      {
        no: 5,
        text: '存储节点在半导体国产替代主线中的利润存量份额是否继续扩大',
        // status 与 evidence 均由 withLiveData() 从利润结构地图填入。
        // 此处写死数字会让台账在下一季悄悄过期 ——
        // 而一份过期的台账比没有台账更糟：它看起来是当期的。
        status: 'UNVERIFIED',
        evidence: '待从利润结构地图读取（withLiveData 未调用时保持未验证）',
      },
    ],
    doesNotImply: [
      '不意味着存储主线重新开放',
      '不意味着兆易创新恢复仓位资格 —— 战略层 C 级清退状态不变',
      '不意味着产生新候选或新增建仓',
      '不意味着「3–5 年超级周期」被采纳 —— 该外推降级为待验证叙事，不进入任何判据',
      '不意味着「AI 改变传统存储周期」成立 —— 同上',
    ],
    blockers: [
      '节点唯一在册标的兆易创新为 C 级清退 → strategyAllows = false。'
      + '即便五项指标全部兑现，也须先走冠军替换四步程序或补入新标的，'
      + '否则「节点份额扩大」会成为清退标的重新获得曝光的后门。',
    ],
    tier: 'OBSERVATION',
  },
]

/**
 * 用利润结构地图的实测值填充指标 5。
 *
 * 两件事必须一起说出来，否则"数据已支持"会被读成"叙事已验证"：
 *
 * 1. 份额确实在扩大（这是事实）
 * 2. **这份数据滞后多少天**（这决定它能不能回答当期问题）
 *
 * 第 2 条是关键。一个关于"当下 AI 内存周期"的叙事，用四个多月前的财报
 * 既无法证实也无法证伪。滞后天数不写出来，读者会默认数据是当期的。
 */
export function withLiveData(
  h: Hypothesis,
  node: {
    npLevelSum: number | null
    levelShare: number | null
    levelShareDelta4Q: number | null
    deltaShareOfMainline: number | null
    maxReportAgeDays: number | null
  } | null
): Hypothesis {
  const i5 = h.indicators.find(i => i.no === 5)
  if (!i5) return h
  if (!node || node.levelShare === null || node.levelShareDelta4Q === null) {
    return {
      ...h,
      indicators: h.indicators.map(i => (i.no === 5
        ? {
          ...i, status: 'UNVERIFIED' as const,
          evidence: '利润结构地图中该节点无可用份额数据 → 本项无法判定。'
            + '不得以"方向应该是扩大"代替读数。',
        }
        : i)),
    }
  }
  const expanding = node.levelShareDelta4Q > 0
  const age = node.maxReportAgeDays
  const stale = age !== null && age > 100
  const parts = [
    `利润结构地图：利润规模 ${((node.npLevelSum ?? 0) / 1e8).toFixed(1)}亿`,
    `存量份额 ${(node.levelShare * 100).toFixed(1)}%`,
    `四季变化 ${node.levelShareDelta4Q > 0 ? '+' : ''}${node.levelShareDelta4Q.toFixed(1)}pct`,
  ]
  if (node.deltaShareOfMainline !== null) {
    parts.push(`增量份额 ${(node.deltaShareOfMainline * 100).toFixed(1)}%`)
  }
  let evidence = `${parts.join('，')}。方向${expanding ? '为扩大' : '未扩大'}。`
  if (age !== null) {
    evidence += `「数据滞后 ${age} 天。」`
    if (stale) {
      evidence += `一个关于"当下 AI 内存周期"的叙事，用 ${age} 天前的财报既无法证实也无法证伪 ——`
        + '本项只说明历史份额在扩大，不构成对当期需求的任何判断。'
    }
  }
  evidence += '且仅此一条兑现不足以支撑整条链：份额扩大同样可以来自周期涨价或同行掉队，'
    + '与 AI 需求无必然关系。'
  return {
    ...h,
    indicators: h.indicators.map(i => (i.no === 5
      ? { ...i, status: (expanding ? 'MET' : 'REFUTED') as Indicator['status'], evidence }
      : i)),
  }
}

/** 已兑现的指标数。用于渲染，不参与任何排序或打分 */
export function metCount(h: Hypothesis): number {
  return h.indicators.filter(i => i.status === 'MET').length
}

/**
 * 生成克制版结论。
 *
 * 刻意做成模板而非自由文本：每次更新数据后这句话会自动跟着变，
 * 而人手写的结论会停留在写它的那一天。
 */
export function statementOf(h: Hypothesis): string {
  const met = metCount(h)
  const total = h.indicators.length
  return `${h.node}：值得持续研究，${
    met > 0 ? `${total} 项硬指标中 ${met} 项已有数据支持` : '五项硬指标均无数据支持'
  }；但该叙事尚未完成产业—盈利闭环验证（停在第 ${h.stage} 步「${
    VERIFICATION_CHAIN[h.stage - 1]
  }」，共 ${VERIFICATION_CHAIN.length} 步），且当前节点唯一在册标的处于战略清退状态。`
    + '因此不改变主线、不产生候选、不产生交易动作。'
}

export function renderHypotheses(list: Hypothesis[] = HYPOTHESES): string {
  const W = 122
  const L: string[] = ['', '═'.repeat(W), '外部叙事台账 —— 拆回它实际所处的验证阶段', '═'.repeat(W)]
  L.push('  本区不打分、不排序、不产生候选、不产生动作。证据等级恒为 OBSERVATION。')
  for (const h of list) {
    L.push('')
    L.push(`  ${h.id}｜${h.node}（${h.mainline}）　登记于 ${h.loggedOn}`)
    L.push(`     主张：${h.claim}`)
    L.push(`     来源：${h.source}`)
    L.push('')
    // 链条画成带光标的形式：一眼看出停在哪，以及后面还有多远
    const chain = VERIFICATION_CHAIN
      .map((s, i) => (i + 1 === h.stage ? `【${s}】` : i + 1 < h.stage ? `${s}` : `${s}`))
      .join(' → ')
    L.push(`     验证链：${chain}`)
    L.push(`     　　　　停在第 ${h.stage}/${VERIFICATION_CHAIN.length} 步。`
      + '每一步是上一步的兑现，不是上一步的推论，故不可跳步。')
    L.push('')
    L.push(`     五项硬指标（${metCount(h)}/${h.indicators.length} 已有数据支持）：`)
    for (const i of h.indicators) {
      const mark = i.status === 'MET' ? '✓' : i.status === 'REFUTED' ? '✗' : '·'
      L.push(`       ${mark} ${i.no}. ${i.text}`)
      L.push(`           ${i.evidence}`)
    }
    L.push('')
    L.push('     本条成立也不意味着：')
    for (const d of h.doesNotImply) L.push(`       · ${d}`)
    L.push('')
    L.push('     阻塞项：')
    for (const b of h.blockers) L.push(`       · ${b}`)
    L.push('')
    L.push(`     今日结论：${statementOf(h)}`)
  }
  L.push('')
  return L.join('\n')
}
