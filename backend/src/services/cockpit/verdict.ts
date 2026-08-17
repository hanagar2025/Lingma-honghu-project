// 今日结论 —— 四张表之上的一页总结
//
// 委员会 2026-08-14 的要求：
//   「把所有数据罗列、所有趋势摆开以后，最后你要给我一个：这些数据在说明什么问题？
//     我们该怎么行动？总结为哪几个个股？我不需要再去分析我们已经分析好的那些数据。」
//
// 这一层**不产生任何新判断**。它做的是筛选与归类：
// 五百多项读数里，绝大多数今天不改变任何事；这一层只留下改变了"我们被允许做什么"的那些。
//
// ── 三条边界，写在最前面，因为它们决定了这个文件能写什么不能写什么 ──
//
// 一、**结论只能有四种动作**：买入 / 持有 / 减仓 / 不动作。
//    每种都必须挂一条法定理由（LegalReason）。没有法定理由的观察项，
//    最多只能进"触发复核"，不能变成动作 —— 这是 EvidenceTier 在类型层守的东西。
//
// 二、**不排序、不打分**。分档只按规则类别（有无法定理由、还差几个闸门），
//    不按"重要性"。一旦按重要性排，就需要一个跨维度可比的分数，
//    而综合评分制造虚假精确感，已被写死禁止。
//    同一量纲内的排序是允许的（超限幅度都是 pct 点，可比）。
//
// 三、**不回答系统答不了的问题**。"是不是阶段性顶/底"、"现在能不能建仓"
//    属于择时预测。价格窗口回测已被证伪（RED 日跑赢 GREEN 日），
//    MSR 择时对组合的贡献实测为 -14.5pct。因此这两类问题进 `cannotAnswer`
//    并附上实测数字，而不是给一个听起来像答案的答案。
//    把答不了的问题明确列出来，本身就是结论的一部分。

import type { Dashboard, HoldingRow, NextLayerRow } from './dashboard'
import type { Action } from './types'
import type { Drift } from '../governance/changeLog'

export interface VerdictHolding {
  code: string
  name: string
  /** 仓位。事实层 */
  posPct: number | null
  /** 数据在说什么 —— 只陈述已观察到的，不含推断 */
  saysWhat: string[]
  /** 规则允许什么 —— 法定理由；null 表示"无法定理由" */
  legalReason: string | null
  /** 动作与数量。来自 runCockpit，本文件不生产动作 */
  action: string
  /** 明确不是理由的东西。防止复核项被事后追认为减仓依据 */
  notReason: string[]
}

export interface VerdictResearch {
  node: string
  members: string[]
  /** 这个节点凭什么进来 —— 逐条事实 */
  saysWhat: string[]
  /** 还差哪几道闸门。给出的是**可执行的核验任务**，不是"再等等" */
  missingGates: string[]
  /** 缺的是数据还是结论。数据缺口可以补，战略层不允许则不能靠补数据解决 */
  blockedByStrategy: boolean
}

/**
 * 焦点条目 —— 回答"最后总结为哪几个个股"。
 *
 * 收敛靠的是**规则类别**，不是"看起来更有机会"：
 * 有无法定理由是二值的；复核项条数、缺口道数是整数计数；
 * 这些都不需要一个跨维度可比的分数，因此不构成综合评分。
 */
export interface FocusItem {
  name: string
  code: string
  held: boolean
  /** 凭哪条规则进焦点 */
  because: string
  /** 今天对它做什么。必须是可执行的，"继续观察"不算 */
  todo: string
}

export interface Verdict {
  date: string
  /** 一句话：今天系统允许做什么。允许为"什么都不许" */
  oneLine: string
  /** 焦点名单。收敛到最少的几个名字 */
  focus: FocusItem[]
  /** 研究覆盖的整体判断 —— 一堆"待核验"不等于一堆机会 */
  coverageVerdict: string
  /** 第一档：有法定理由，必须执行 */
  mustDo: VerdictHolding[]
  /** 第二档：有复核触发但**无**法定理由 —— 明写不构成减仓理由 */
  reviewNoAction: VerdictHolding[]
  /** 第三档：无复核项也无法定理由 */
  quiet: { name: string; posPct: number | null }[]
  /** 允许研究的节点，附还差什么 */
  research: VerdictResearch[]
  /** 今日为何不许新增建仓。逐条 */
  noEntryReasons: string[]
  /** 系统答不了的问题 + 为什么答不了 */
  cannotAnswer: { question: string; why: string }[]
  /** 跨多日累计变化。单日噪声看不出的东西 */
  drift: { label: string; items: Drift[] }[]
  driftWindow: { days: number; from: string; to: string } | null
  /** 观察期样本不足时的明确告知 */
  driftNote: string
}

function pctStr(v: number | null, digits = 1): string {
  return v === null ? '缺失' : `${(v * 100).toFixed(digits)}%`
}

/**
 * 持仓的"数据在说什么"。
 *
 * 刻意只写**已观察到的事实**，且每条都带数字。
 * 不写"动能减弱"这类概括 —— 概括会把 20 日超额 -7.5% 和"要跌了"混为一谈，
 * 而前者是记录，后者是预测。
 */
function holdingSays(h: HoldingRow): string[] {
  const s: string[] = []
  if (h.posPct !== null) s.push(`仓位 ${pctStr(h.posPct)}`)
  if (h.relMainline !== null) {
    s.push(`20日相对主线 ${h.relMainline > 0 ? '+' : ''}${(h.relMainline * 100).toFixed(1)}%`)
  }
  if (h.aboveMa20 !== null && h.aboveMa60 !== null) {
    s.push(`收盘在 MA20 ${h.aboveMa20 ? '上' : '下'}方、MA60 ${h.aboveMa60 ? '上' : '下'}方`)
  }
  if (h.peUsable && h.pePercentile !== null) {
    s.push(`PE 三年分位 ${(h.pePercentile * 100).toFixed(0)}%`)
  } else {
    s.push('PE 分位不可用（TTM 亏损或数据缺失）')
  }
  if (h.nodeShareArrow !== '?') {
    s.push(`所属节点「${h.industryPosition}」利润份额方向 ${h.nodeShareArrow}`)
  }
  if (h.shareWithinNode !== null) {
    s.push(`节点内利润份额 ${pctStr(h.shareWithinNode, 0)}`)
  }
  if (h.reviewTriggers.length) s.push(`触发复核 ${h.reviewTriggers.length} 项`)
  return s
}

function researchSays(n: NextLayerRow): string[] {
  const s: string[] = []
  if (n.nodeShare !== null) s.push(`节点利润份额 ${pctStr(n.nodeShare)}`)
  if (n.profitTrend !== '?') s.push(`利润方向 ${n.profitTrend}`)
  if (n.industryTrend !== '?') s.push(`产业趋势 ${n.industryTrend}`)
  if (n.relStrength !== '?') s.push(`相对强度 ${n.relStrength}`)
  s.push(`估值 ${n.valuation}`)
  s.push(`证据等级 ${n.evidenceTier}`)
  return s
}

/**
 * 把 S 闸门缺口翻译成**可执行的核验任务**。
 *
 * 差别很重要：写"S1 未通过"等于什么都没说，人看完不知道下一步做什么；
 * 写"去核验客户、订单、产能"才是一件可以今天开始做的事。
 * 研究许可的意义就在这里 —— 允许研究不是允许等待。
 */
function missingGates(n: NextLayerRow): string[] {
  const g = n.gates
  const out: string[] = []
  if (g.s1Industry !== true) {
    out.push('S1 产业核验：客户是谁、订单有没有、产品是否进主线、竞争格局')
  }
  if (g.s2Earnings !== true) {
    out.push('S2 盈利核验：扣非净利、经营现金流、毛利率、收入的主线归因')
  }
  if (g.s3Valuation !== true) {
    out.push('S3 估值与价格：PE 历史分位是否可用且不在高位')
  }
  if (g.moneyRadar !== true) {
    out.push('资金核验：真实资金流免费源不可得，此项当前无法通过（不用价格代理冒充）')
  }
  return out
}

const DRIFT_GROUPS: { label: string; match: (d: Drift) => boolean }[] = [
  {
    label: '产业利润份额（存量）—— 钱现在在哪里，这个分配比例在怎么变',
    match: d => d.scope === 'NODE' && d.field.includes('份额'),
  },
  {
    label: '观察层节点份额 —— 0→1→2→5 的爬升只有跨多日才看得出',
    match: d => d.scope === 'NEXT_LAYER' && d.field.includes('份额'),
  },
  {
    label: '持仓仓位 —— 超限幅度的累计漂移',
    match: d => d.scope === 'HOLDING' && d.field === '仓位',
  },
  {
    label: '持仓相对主线 —— 相对强度的累计变化',
    match: d => d.scope === 'HOLDING' && d.field.includes('相对主线'),
  },
  {
    label: 'S 闸门推进 —— 发现 KPI 的唯一硬指标',
    match: d => d.field === 'S闸门',
  },
]

export interface VerdictInput {
  dashboard: Dashboard
  actions: Action[]
  actionText: Record<string, string>
  drift: Drift[]
  driftSnapshotCount: number
  driftFrom?: string
  driftTo?: string
}

export function buildVerdict(input: VerdictInput): Verdict {
  const { dashboard: d, actions, actionText, drift } = input

  const actionOf = new Map(actions.map(a => [a.code, a]))

  const toVerdictHolding = (h: HoldingRow): VerdictHolding => {
    const a = actionOf.get(h.code)
    return {
      code: h.code,
      name: h.name,
      posPct: h.posPct,
      saysWhat: holdingSays(h),
      legalReason: h.legalReason,
      action: a
        ? `${actionText[a.kind] ?? a.kind}${a.size.display ? ` ${a.size.display}` : ''}`
        : '不动作',
      notReason: a?.notReason ?? [],
    }
  }

  // 分档只按规则类别。第一档内部按超限幅度排序 ——
  // 都是 pct 点，同一量纲可比，不构成跨维度评分。
  const mustDo = d.holdings
    .filter(h => h.legalReason !== null)
    .sort((x, y) => (y.posPct ?? 0) - (x.posPct ?? 0))
    .map(toVerdictHolding)

  const reviewNoAction = d.holdings
    .filter(h => h.legalReason === null && h.reviewTriggers.length > 0)
    .map(toVerdictHolding)

  const quiet = d.holdings
    .filter(h => h.legalReason === null && h.reviewTriggers.length === 0)
    .map(h => ({ name: h.name, posPct: h.posPct }))

  const research = d.nextLayer
    .filter(n => n.members.length > 0 && n.strategyAllows)
    .map(n => ({
      node: n.node,
      members: n.members.map(m => m.name),
      saysWhat: researchSays(n),
      missingGates: missingGates(n),
      blockedByStrategy: false,
    }))
    // 按"还差几道闸门"升序：整数计数，不是评分。差得少的先看是常识排序，
    // 不隐含"更值得买"，因为四道闸门全过也只是进候选池。
    .sort((a, b) => a.missingGates.length - b.missingGates.length)

  const blockedNodes = d.nextLayer
    .filter(n => n.members.length > 0 && !n.strategyAllows)
    .map(n => ({
      node: n.node,
      members: n.members.map(m => m.name),
      saysWhat: researchSays(n),
      missingGates: ['战略层已关闭这些标的的仓位资格（C 级清退）。补数据不能解决，须走冠军替换程序或补新标的'],
      blockedByStrategy: true,
    }))

  const newEntry = d.actionZone.newEntryCount
  const oneLine = mustDo.length > 0
    ? `今天必须做 ${mustDo.length} 件事（全部是仓位纪律，与涨跌判断无关）；新增建仓 ${newEntry}。`
    : `今天没有任何法定动作；新增建仓 ${newEntry}。`

  // ── 焦点名单 ──
  // 只差"资金核验"的节点是特殊情形：那道闸门当前**不可能通过**
  // （真实资金流无免费数据源），所以它们不是"快要成熟"，而是"能查的都查完了"。
  // 把这两种情况混在一起，会让人误以为再等几天就能买。
  const heldCodes = new Set(d.holdings.map(h => h.code))
  const onlyMoneyGate = research.filter(
    r => r.missingGates.length === 1 && r.missingGates[0].startsWith('资金核验')
  )
  const fixable = research.filter(
    r => r.missingGates.some(g => g.startsWith('S1') || g.startsWith('S2'))
  )

  const focus: FocusItem[] = []
  for (const h of mustDo) {
    focus.push({
      name: h.name, code: h.code, held: true,
      because: `法定减仓理由成立：${h.legalReason}`,
      todo: `执行 ${h.action}。理由是仓位纪律，不是对股价的判断。`,
    })
  }
  // 复核项最多的那一只：同量纲计数比较，取最多者。它是"最容易被自己推翻纪律"的那只。
  const topReview = reviewNoAction
    .map(h => ({ h, n: Number(/触发复核 (\d+) 项/.exec(h.saysWhat.join('；'))?.[1] ?? 0) }))
    .sort((a, b) => b.n - a.n)[0]
  if (topReview && topReview.n > 0) {
    focus.push({
      name: topReview.h.name, code: topReview.h.code, held: true,
      because: `复核触发项最多（${topReview.n} 项），但无法定减仓理由`,
      todo: '记录，不动作。这一只是纪律的压力测试点：读到多项恶化仍不得据此减仓。',
    })
  }
  // 同一只票不重复出现：焦点只有几行，重复一次就浪费掉六分之一的注意力。
  // 已因法定理由入列的，把研究状态并进它的 todo，而不是另起一行。
  const MONEY_GATE_NOTE = '「资金核验」未过：不是"快要成熟"，而是能查的都查完了 ——'
    + '该闸门无免费数据源，当前不可能通过。要推进只有两条路：买资金流数据，或等季报更新盈利证据。'
  for (const r of onlyMoneyGate) {
    const code = d.nextLayer.find(n => n.node === r.node)?.members[0]?.code ?? ''
    const dup = focus.find(f => f.code === code)
    if (dup) {
      dup.todo += `　另：其所属节点「${r.node}」产业与盈利核验已过，${MONEY_GATE_NOTE}`
      continue
    }
    focus.push({
      name: `${r.node}（${r.members.join('、')}）`, code, held: heldCodes.has(code),
      because: '产业与盈利核验已过，仅剩「资金核验」未过',
      todo: MONEY_GATE_NOTE,
    })
  }

  const coverageVerdict = fixable.length === 0
    ? '所有在册节点的可补缺口均已补齐。'
    : `${fixable.length} 个节点缺 S1/S2 核验。这不是 ${fixable.length} 个机会，`
      + `而是 ${fixable.length} 处研究覆盖不足 —— 未核验的节点不具备候选资格，`
      + `其份额与趋势数字只能当线索，不能当依据。`
      + `真正的下一步是挑其中少数几个做客户/订单/扣非利润的人工核验，而不是同时盯 ${fixable.length} 个。`

  const driftGroups = DRIFT_GROUPS
    .map(g => ({ label: g.label, items: drift.filter(g.match) }))
    .filter(g => g.items.length > 0)

  const enough = input.driftSnapshotCount >= 10
  const driftNote = input.driftSnapshotCount < 2
    ? `只有 ${input.driftSnapshotCount} 个交易日的归档，无法计算累计趋势。`
      + `观察期自 2026-08-13 起，需连续运行才能积累 —— 这一栏现在为空是正常的，不是故障。`
    : enough
      ? `基于 ${input.driftSnapshotCount} 个交易日的归档。`
      : `仅 ${input.driftSnapshotCount} 个交易日的归档，样本太短。`
        + `下面的数字只能当"已经记录到的变化"看，不足以判断趋势 —— `
        + `份额类指标每季才更新一次，需要跨季度才有意义。`

  return {
    date: d.date,
    oneLine,
    focus,
    coverageVerdict,
    mustDo,
    reviewNoAction,
    quiet,
    research: [...research, ...blockedNodes],
    noEntryReasons: d.actionZone.forbidden.map(f => `${f.label}：${f.detail}`),
    cannotAnswer: CANNOT_ANSWER,
    drift: driftGroups,
    driftWindow: input.driftFrom && input.driftTo
      ? { days: input.driftSnapshotCount, from: input.driftFrom, to: input.driftTo }
      : null,
    driftNote,
  }
}

/**
 * 系统答不了的问题。
 *
 * 这一栏是刻意固定的，不随数据变化 —— 因为限制来自方法论而非当日读数。
 * 每条都附实测数字：说"不能预测"容易被当成谦辞，给出回测结论才是事实陈述。
 */
export const CANNOT_ANSWER: { question: string; why: string }[] = [
  {
    question: '现在是不是阶段性顶部／底部？',
    why: '价格窗口规则已被自己的回测证伪：按 10 日涨幅分档后，"红灯"日的后续收益反而'
      + '高于"绿灯"日（区间跨 0），故除 10 日涨幅 >50% 这一条行为护栏外全部从代码中删除。'
      + '系统没有任何被验证过的顶底识别能力。',
  },
  {
    question: '现在能不能建仓？哪只可以买？',
    why: '买入许可只由闸门决定，不由"看起来低"决定：执行债务清零、候选晋普 S3、'
      + 'PE 分位可用且不在高位、市场阶段已确认。当前至少四道不通过，故新增建仓为 0。'
      + '闸门通过也只是"允许"，不是"应该"。',
  },
  {
    question: '这几只里哪只最值得加仓？',
    why: '需要一个跨标的可比的总分才能排序，而综合评分在数据不完整时制造虚假精确感，'
      + '已被写死禁止。系统只能回答"哪些有法定理由"，不能回答"哪个更好"。',
  },
  {
    question: '主线会不会切换？切到哪条？',
    why: '四条主线中 3 条数据完整度不足 33%，AI电力为 0%。'
      + '数据完整度不足时"不可判断"是合法且唯一诚实的输出。'
      + '已观察到的事实是利润仍在向光模块集中（71%→77%），不是在扩散。',
  },
  {
    question: '减仓的这两只是因为要跌吗？',
    why: '不是。法定理由是"仓位超过 12% 上限"，属账务事实。'
      + '技术结构恶化只能触发复核，不能作为减仓理由 —— 这条由类型系统与自检强制。',
  },
]
