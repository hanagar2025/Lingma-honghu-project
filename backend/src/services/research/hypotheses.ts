/**
 * 外部叙事台账。
 *
 * ── 存在理由 ──
 *
 * 外部叙事(研报、访谈、视频)的共同特征是：
 * 「听起来已经完成了论证，实际上只完成了第一步。」
 *
 * 但 2026-08-16 的复核指出，这个说法本身还不够。真正的问题不是"完成了几步"，
 * 而是**一句话里缝着两个性质完全不同的命题**：
 *
 *   命题 A「存储行业正在改善」　　　→ 当前事实，可用公开财报验证
 *   命题 B「AI 造成 3–5 年超级周期」→ 未来假设，必须逐季度累积证据
 *
 * B 不能从 A 推出。份额上升至少有五种解释同时成立：
 * AI 需求增长、存储价格上涨、竞争对手利润下降、产品结构变化、供给收缩。
 *
 * 所以台账不再只问「有没有数据」，而先问：
 * **这条证据回答的是当前事实，还是未来假设？**
 *
 * ── 公开数据优先原则(2026-08-16 裁定) ──
 *
 * 此前本文件把第 3、4 步一并标为"需要付费数据源"。这是错的，而且错得危险：
 * 它会让系统形成一个假设 ——「没有付费数据库 → S2 永远过不了」——
 * 从而从一个"防止虚假判断"的工具退化成一个"因为没有 Bloomberg 所以什么都不判断"的工具。
 *
 * 事实核查的结果是：**扣非利润的原始数据早已在管道内。**
 * profitRadar 的 deductRatio 字段来自公开年报/中报的扣非 EPS ÷ 基本 EPS，
 * 三家半导体在册标的都能读出该比值(跑 npm run profit:map 可见当期值)。
 * 此处刻意不抄具体百分比 —— 抄了就会过期，而要证明的是「读数可得」，不是某个数值。
 *
 * 真正难的不是「扣非利润」，而是「扣非利润中有多少来自目标主线」。
 * 前者是公开披露项，后者是归因问题。把两者混在一起，
 * 就会用"数据买不到"掩盖"我们还没做归因"。
 *
 * 故每一项证据必须标注它的取数层级：
 * 能公开验证的绝不列为付费缺口；只有公开披露无法完成归因时，才进入付费/人工缺口。
 *
 * ── 为什么它不能产生动作(类型层面的保证) ──
 *
 * `tier` 恒为 `'OBSERVATION'`。本模块不 import makeAction，
 * 也不导出任何返回 Action 的函数 —— 不是"约定不用"，而是没有那个函数可用。
 * 机械验证：新增本模块后 `npm run freeze:check` 显示规则指纹未变。
 */

import type { EvidenceTier } from '../cockpit/types'

/**
 * 这条证据回答的是什么时间的问题。
 *
 * 委员会 2026-08-16 新增。它是本台账最重要的一个字段 ——
 * 「存储供不应求、量价齐升」与「未来三到五年是超级周期」
 * 在数据形态上没有区别(都是文字 + 数字)，但在证明力上完全不同：
 * 前者可被单期财报证实或证伪，后者只能靠连续多季度累积，
 * 且**任何单季数据都不能证明它**。
 *
 * 不分开的后果是：一条当期事实会被当成对未来的背书。
 */
export type EvidenceHorizon =
  /** 当前事实：可被已披露数据证实或证伪 */
  | 'CURRENT_FACT'
  /** 未来假设：任何单期数据都不能证明，须逐季度累积 */
  | 'FUTURE_HYPOTHESIS'

/**
 * 取数层级。**顺序即优先级：能用上一层解决的，不得下推到下一层。**
 *
 * 这个枚举的用途是防止一句话：「这个要买数据」。
 * 那句话一说出口，工作就停了，而且听起来很合理。
 */
export type SourceTier =
  /** 公开财报直接披露，且已在管道内 */
  | 'PUBLIC_IN_PIPELINE'
  /** 公开财报有披露，但尚未接入管道 —— 这是工作量问题，不是数据可得性问题 */
  | 'PUBLIC_NOT_YET_WIRED'
  /** 公开披露只能部分拆分，剩余部分需人工核验 */
  | 'PUBLIC_PARTIAL'
  /** 系统自算 */
  | 'SYSTEM_COMPUTED'
  /** 战略层裁定，不是数据问题 */
  | 'STRATEGY_RULING'
  /** 公开披露确实无法回答，须付费数据源 —— 只有走完上面五层才允许标这个 */
  | 'NEEDS_PAID'

export const SOURCE_TIER_TEXT: Record<SourceTier, string> = {
  PUBLIC_IN_PIPELINE: '公开财报·已在管道内',
  PUBLIC_NOT_YET_WIRED: '公开财报·尚未接入(工作量问题,非数据可得性问题)',
  PUBLIC_PARTIAL: '公开披露·仅可部分拆分,余下须人工核验',
  SYSTEM_COMPUTED: '系统自算',
  STRATEGY_RULING: '战略层裁定·非数据问题',
  NEEDS_PAID: '公开披露无法回答·须付费数据源',
}

/**
 * 叙事进入决策层必须走完的七步。
 *
 * 顺序不可跳。每一步都是上一步的**兑现**而不是上一步的**推论**：
 * 产业数据改善不必然带来公司收入增长(可能被价格战吃掉)，
 * 收入增长不必然带来扣非利润(可能靠补贴或一次性收益)，
 * 扣非利润增长不必然带来主线份额扩大(同行可能增长更快)。
 *
 * 2026-08-16 复核把第 3 步与第 5 步的问法改精确了：
 * 不是问"收入/利润有没有增长"，而是问"其中多少可合理归因于我们定义的节点"。
 * 兆易创新同时做 NOR/NAND/DRAM/MCU/传感器/模拟芯片 ——
 * 「存储收入 ↑」不能自动写成「AI 内存收入 ↑」。
 */
export const VERIFICATION_CHAIN = [
  { no: 1, name: '产业事实', asks: '该产业的公开经营数据是否在改善', source: 'PUBLIC_IN_PIPELINE' },
  { no: 2, name: '公司收入', asks: '在册公司的收入是否增长', source: 'PUBLIC_IN_PIPELINE' },
  {
    no: 3, name: '主线收入归因',
    asks: '收入增长中有多少可合理归因于我们定义的节点(不是"收入有没有增长")',
    source: 'PUBLIC_PARTIAL',
  },
  { no: 4, name: '扣非利润', asks: '扣非利润绝对增量是否扩大', source: 'PUBLIC_IN_PIPELINE' },
  {
    no: 5, name: '主线利润归因',
    asks: '扣非利润中有多少来自目标主线(财报不能拆则标未知)',
    source: 'PUBLIC_PARTIAL',
  },
  { no: 6, name: '节点内利润份额', asks: '该公司在节点利润中的份额是否扩大', source: 'SYSTEM_COMPUTED' },
  { no: 7, name: '战略许可', asks: '战略层是否允许该标的持仓', source: 'STRATEGY_RULING' },
] as const satisfies readonly {
  no: number; name: string; asks: string; source: SourceTier
}[]

export type ChainStep = typeof VERIFICATION_CHAIN[number]

/** 单条待验指标 */
export interface Indicator {
  no: number
  text: string
  /** MET = 已有数据支持；UNVERIFIED = 无数据；REFUTED = 数据反向 */
  status: 'MET' | 'UNVERIFIED' | 'REFUTED'
  /** 这条证据回答的是当前事实还是未来假设 */
  horizon: EvidenceHorizon
  sourceTier: SourceTier
  /** 数据来源或缺失原因。MET 时必须写明出处，否则等于自证 */
  evidence: string
}

/**
 * 一条叙事里的独立命题。
 *
 * 分开的理由见 EvidenceHorizon 的注释：命题 A 与 B 的证明力完全不同，
 * 合在一起会让 A 的证据被读成 B 的背书。
 */
export interface Proposition {
  id: 'A' | 'B'
  claim: string
  horizon: EvidenceHorizon
  /** 逐条指标 */
  indicators: Indicator[]
  /** 该命题当前判定。文字刻意短，供四句话结论直接引用 */
  verdictText: string
}

export interface Hypothesis {
  id: string
  /** 叙事原文的核心主张，用它自己的话，不美化也不弱化 */
  claim: string
  source: string
  loggedOn: string
  node: string
  mainline: string
  /** 当前走到链条的第几步(1 起) */
  stage: number
  /** 拆出的独立命题。A 当前事实，B 未来假设 */
  propositions: Proposition[]
  /** 明确不因本条成立的事 —— 写出来是为了防止读者自行外推 */
  doesNotImply: string[]
  /** 阻塞项：即便数据全部兑现，仍需先解决的事 */
  blockers: string[]
  tier: EvidenceTier
}

/**
 * 存储 / AI 内存需求。
 *
 * 委员会 2026-08-16 裁定：保留 H1，不改变规则；
 * 拆成两个命题；取数改为公开优先。
 */
export const HYPOTHESES: Hypothesis[] = [
  {
    id: 'H1',
    claim:
      'AI 推动内存需求结构性提升 → 存储产业利润池扩大 → 国产存储节点开始获得利润份额；'
      + '并伴随「3–5 年超级周期」与「AI 改变传统存储周期」的外推。',
    source: '外部视频/访谈(委员会 2026-08-16 转述)',
    loggedOn: '2026-08-16',
    node: '存储',
    mainline: '半导体国产替代',
    // 停在第 3 步。第 1、2、4 步已有公开证据，但第 3 步(主线收入归因)未完成 ——
    // 链条不可跳步，故整条链停在最早一个未完成的步骤上，而不是最晚一个已完成的。
    stage: 3,
    propositions: [
      {
        id: 'A',
        claim: '存储行业当前景气正在改善',
        horizon: 'CURRENT_FACT',
        verdictText: '有证据',
        indicators: [
          {
            no: 1,
            text: '存储节点在主线中的利润存量份额是否继续扩大',
            status: 'UNVERIFIED',
            horizon: 'CURRENT_FACT',
            sourceTier: 'SYSTEM_COMPUTED',
            evidence: '待从利润结构地图读取(withLiveData 未调用时保持未验证)',
          },
          {
            no: 2,
            text: '在册公司存储业务收入是否增长(公司收入，第 2 步)',
            status: 'MET',
            horizon: 'CURRENT_FACT',
            sourceTier: 'PUBLIC_NOT_YET_WIRED',
            evidence:
              '公开披露可得：兆易创新 2025 年报存储芯片收入约 65.66 亿元、同比 +26.41%、'
              + '毛利率 42.84%；2026Q1 公告提到存储芯片供不应求、量价齐升。'
              + '「按产品线拆分的收入尚未接入管道」 —— 这是工作量问题，不是数据可得性问题，'
              + '不得记为付费数据缺口。',
          },
          {
            no: 3,
            text: '扣非利润占净利比是否健康(扣非利润，第 4 步)',
            status: 'UNVERIFIED',
            horizon: 'CURRENT_FACT',
            sourceTier: 'PUBLIC_IN_PIPELINE',
            evidence: '待从利润结构地图的 deductRatio 读取',
          },
          {
            no: 4,
            text: '毛利率同比是否改善',
            status: 'UNVERIFIED',
            horizon: 'CURRENT_FACT',
            sourceTier: 'PUBLIC_IN_PIPELINE',
            evidence: '待从利润结构地图的 grossMarginYoyPct 读取',
          },
        ],
      },
      {
        id: 'B',
        claim: 'AI 正在造成一个持续 3–5 年的内存超级周期，且 AI 是主要驱动力',
        horizon: 'FUTURE_HYPOTHESIS',
        verdictText: '未验证',
        indicators: [
          {
            no: 1,
            text: '需求端：AI 服务器 / HBM / DDR5 / NAND 需求是否持续放量',
            status: 'UNVERIFIED',
            horizon: 'FUTURE_HYPOTHESIS',
            sourceTier: 'NEEDS_PAID',
            evidence:
              '按下游用途拆分的内存出货结构，公开财报不披露，'
              + '在册免费源亦不可得 → 确认为付费数据缺口(已走完公开优先的前五层)。',
          },
          {
            no: 2,
            text: '价格端：ASP / 合约价 / 现货价是否持续上行',
            status: 'UNVERIFIED',
            horizon: 'FUTURE_HYPOTHESIS',
            sourceTier: 'NEEDS_PAID',
            evidence:
              'DRAM / NAND 合约价与现货价均需付费数据库。'
              + '公司公告里的「量价齐升」是定性表述，不能替代价格序列 ——'
              + '它无法回答"涨了多久、还能涨多久"。',
          },
          {
            no: 3,
            text: '供给端：CapEx / 产能 / 库存 / 供给纪律是否支持长周期',
            status: 'UNVERIFIED',
            horizon: 'FUTURE_HYPOTHESIS',
            sourceTier: 'PUBLIC_NOT_YET_WIRED',
            evidence:
              '「存货与在建工程/购建固定资产支付的现金均为公开财报披露项」，'
              + '海外大厂 CapEx 指引亦公开。尚未接入管道 → 记为工作量缺口，'
              + '不得记为付费数据缺口。',
          },
          {
            no: 4,
            text: '盈利端：毛利率 → 扣非利润 → ROIC 是否同向改善',
            status: 'UNVERIFIED',
            horizon: 'FUTURE_HYPOTHESIS',
            sourceTier: 'PUBLIC_IN_PIPELINE',
            evidence:
              '毛利率与扣非占比已在管道内；ROIC 尚未计算但所需科目均为公开披露项。'
              + '注意：盈利端改善属命题 A 的当期事实，'
              + '「只有连续多季同向」才构成对 B 的证据 —— 单季不算。',
          },
          {
            no: 5,
            text: '持续性：上述各项是否连续多个季度同向，而非单季价格上涨',
            status: 'UNVERIFIED',
            horizon: 'FUTURE_HYPOTHESIS',
            sourceTier: 'SYSTEM_COMPUTED',
            evidence:
              '「这一项在定义上无法用任何单期数据满足」，须逐季累积。'
              + '当前观察期仅 2 个交易日的归档，且份额类指标每季才更新一次 ——'
              + '距离可判断持续性还差数个季度。这不是缺口，是时间本身。',
          },
        ],
      },
    ],
    doesNotImply: [
      '不意味着存储主线重新开放',
      '不意味着兆易创新恢复仓位资格 —— 战略层 C 级清退状态不变',
      '不意味着产生新候选或新增建仓',
      '不意味着「3–5 年超级周期」被采纳 —— 命题 B 未验证，不进入任何判据',
      '不意味着「AI 是主要驱动力」成立 —— 份额上升另有五种解释同时成立：'
      + 'AI 需求增长、存储价格上涨、竞争对手利润下降、产品结构变化、供给收缩',
      '命题 A 有证据，「不构成对命题 B 的任何支持」 —— B 不能从 A 推出',
    ],
    blockers: [
      '节点唯一在册标的兆易创新为 C 级清退 → strategyAllows = false。'
      + '「即便命题 A、B 的全部指标都兑现，第 7 步仍为不允许，故不产生买入动作。」'
      + '这不是产业证据不足，而是战略层裁定 —— 两者不可互相替代。'
      + '若开放存储主线，兆易创新会通过「节点份额扩大」重新获得曝光、绕过冠军替换程序 ——那是这道闸门要拦的后门。',
    ],
    tier: 'OBSERVATION',
  },
]

export function allIndicators(h: Hypothesis): Indicator[] {
  return h.propositions.flatMap(p => p.indicators)
}

/** 已兑现的指标数。用于渲染，不参与任何排序或打分 */
export function metCount(h: Hypothesis): number {
  return allIndicators(h).filter(i => i.status === 'MET').length
}

/**
 * 付费数据缺口清单。
 *
 * 刻意做成"筛出来"而不是"标出来"：只有 sourceTier === 'NEEDS_PAID' 的才算。
 * 这样「这个要买数据」就不能再随口说 —— 它必须先写进 sourceTier，
 * 而写的时候会被迫回答"公开优先的前五层为什么都不行"。
 */
export function paidGaps(h: Hypothesis): Indicator[] {
  return allIndicators(h).filter(i => i.sourceTier === 'NEEDS_PAID')
}

/** 公开可得但尚未接入的项 —— 这些是工作量，不是缺口 */
export function wiringBacklog(h: Hypothesis): Indicator[] {
  return allIndicators(h).filter(i => i.sourceTier === 'PUBLIC_NOT_YET_WIRED')
}

/**
 * 用利润结构地图的实测值填充命题 A 的系统项。
 *
 * 两件事必须一起说出来，否则"数据已支持"会被读成"叙事已验证"：
 * 1. 份额确实在扩大(这是事实)
 * 2. 「这份数据滞后多少天」(这决定它能不能回答当期问题)
 */
export function withLiveData(
  h: Hypothesis,
  node: {
    npLevelSum: number | null
    levelShare: number | null
    levelShareDelta4Q: number | null
    deltaShareOfMainline: number | null
    maxReportAgeDays: number | null
    members?: {
      name: string
      deductRatio: number | null
      deductRatioAsOf: string | null
      grossMarginPct: number | null
      grossMarginYoyPct: number | null
      grossMarginPrevPct: number | null
    }[]
  } | null
): Hypothesis {
  const patch = (ind: Indicator): Indicator => {
    const A = h.propositions.find(p => p.id === 'A')
    if (!A || !A.indicators.includes(ind)) return ind

    // A-1 份额
    if (ind.no === 1) {
      if (!node || node.levelShare === null || node.levelShareDelta4Q === null) {
        return {
          ...ind, status: 'UNVERIFIED',
          evidence: '利润结构地图中该节点无可用份额数据 → 本项无法判定。'
            + '不得以"方向应该是扩大"代替读数。',
        }
      }
      const expanding = node.levelShareDelta4Q > 0
      const age = node.maxReportAgeDays
      const parts = [
        `利润规模 ${((node.npLevelSum ?? 0) / 1e8).toFixed(1)}亿`,
        `存量份额 ${(node.levelShare * 100).toFixed(1)}%`,
        `四季变化 ${node.levelShareDelta4Q > 0 ? '+' : ''}${node.levelShareDelta4Q.toFixed(1)}pct`,
      ]
      if (node.deltaShareOfMainline !== null) {
        parts.push(`增量份额 ${(node.deltaShareOfMainline * 100).toFixed(1)}%`)
      }
      let evidence = `利润结构地图：${parts.join('，')}。方向${expanding ? '为扩大' : '未扩大'}。`
      if (age !== null) {
        evidence += `「数据滞后 ${age} 天。」`
        if (age > 100) {
          evidence += `一个关于"当下 AI 内存周期"的叙事，用 ${age} 天前的财报既无法证实也无法证伪 ——`
            + '本项只说明历史份额在扩大，不构成对当期需求的任何判断。'
        }
      }
      evidence += '且份额扩大另有解释：周期涨价、同行掉队、产品结构变化、供给收缩 ——'
        + '与 AI 需求无必然关系。'
      return { ...ind, status: expanding ? 'MET' : 'REFUTED', evidence }
    }

    // A-3 扣非占比
    if (ind.no === 3) {
      const m = node?.members?.[0]
      if (!m || m.deductRatio === null) {
        return {
          ...ind, status: 'UNVERIFIED',
          evidence: '一季报/三季报不披露扣非 → 本项须等中报或年报。'
            + '注意这是披露节奏问题，不是数据可得性问题。',
        }
      }
      return {
        ...ind, status: m.deductRatio >= 0.8 ? 'MET' : 'UNVERIFIED',
        evidence: `${m.name} 扣非占净利比 ${(m.deductRatio * 100).toFixed(1)}%`
          + `(口径日 ${m.deductRatioAsOf ?? '未知'})，来自公开年报的扣非 EPS ÷ 基本 EPS。`
          + `${m.deductRatio >= 0.8 ? '占比高，净利主要来自经常性经营。' : '占比偏低，须核查非经常性损益构成。'}`
          + '「但这只回答"利润是否干净"，不回答"利润是否来自本主线"」 ——'
          + '后者是第 5 步的归因问题，须另行核验。',
      }
    }

    // A-4 毛利率
    if (ind.no === 4) {
      const m = node?.members?.[0]
      if (!m || m.grossMarginYoyPct === null) {
        return { ...ind, status: 'UNVERIFIED', evidence: '毛利率同比基期缺失 → 本项无法判定。' }
      }
      const up = m.grossMarginYoyPct > 0
      // 同屏显示两个端点，不只给差值 —— 只看 +19.6pct 看不出它是从 37% 到 57%，
      // 而后者这个量级本身就要求核验，不能当成一条平常的改善记录。
      const ends = m.grossMarginPrevPct !== null && m.grossMarginPct !== null
        ? `${m.grossMarginPrevPct.toFixed(1)}% → ${m.grossMarginPct.toFixed(1)}%`
        : m.grossMarginPct === null ? '?' : `${m.grossMarginPct.toFixed(1)}%`
      const big = Math.abs(m.grossMarginYoyPct) >= 10
      return {
        ...ind, status: up ? 'MET' : 'REFUTED',
        evidence: `${m.name} 累计毛利率 ${ends}`
          + `(同比 ${m.grossMarginYoyPct > 0 ? '+' : ''}${m.grossMarginYoyPct.toFixed(1)}pct，`
          + '公开财报 XSMLL 字段，单位为百分数)。'
          + `方向${up ? '改善' : '恶化'}。`
          + (big
            ? '「同比变动超过 10pct，量级异常，须核验」 ——'
            + '毛利率一年内出现这种幅度的变化，可能是量价齐升的真实反映，'
            + '也可能是产品结构重分类或会计口径调整。台账只记录读数与量级，不替委员会判定原因。'
            : '')
          + '单季毛利率改善属命题 A 的当期事实，不构成对命题 B 的证据。',
      }
    }
    return ind
  }

  return {
    ...h,
    propositions: h.propositions.map(p => ({ ...p, indicators: p.indicators.map(patch) })),
  }
}

/**
 * 四句话机器结论。
 *
 * 委员会 2026-08-16 指定的格式。它比"AI 内存超级周期成立"有价值得多的原因是：
 * **它把"有证据"和"未验证"放在同一段话里，读者无法只取前半句。**
 */
export interface FourLineVerdict {
  currentFact: string
  aiAsDriver: string
  superCycle: string
  candidacy: string
}

export function fourLineVerdict(h: Hypothesis): FourLineVerdict {
  const A = h.propositions.find(p => p.id === 'A')!
  const B = h.propositions.find(p => p.id === 'B')!
  const aMet = A.indicators.filter(i => i.status === 'MET').length
  const bMet = B.indicators.filter(i => i.status === 'MET').length
  const strategyBlocked = h.blockers.some(b => b.includes('strategyAllows = false'))

  return {
    currentFact: `${h.node}当前景气改善：${
      aMet === 0 ? '暂无证据' : aMet === A.indicators.length ? '有证据' : '有证据'
    }(${aMet}/${A.indicators.length} 项当期指标兑现，均来自公开披露)。`,
    aiAsDriver: 'AI 是主要驱动力：部分待验证'
      + '(份额上升另有周期涨价、同行掉队、产品结构变化、供给收缩四种解释同时成立)。',
    superCycle: `持续 3–5 年超级周期：${bMet === 0 ? '未验证' : '部分待验证'}`
      + `(${bMet}/${B.indicators.length} 项未来假设指标兑现；`
      + '持续性一项在定义上无法用任何单期数据满足)。',
    candidacy: `${h.node}节点在册标的是否值得进入投资候选：${
      strategyBlocked ? '战略层不允许' : '须走 S0–S3 晋级'
    }。`,
  }
}

export function renderHypotheses(list: Hypothesis[] = HYPOTHESES): string {
  const W = 122
  const L: string[] = ['', '═'.repeat(W), '外部叙事台账 —— 这条证据到底证明了什么？', '═'.repeat(W)]
  L.push('  本区不打分、不排序、不产生候选、不产生动作。证据等级恒为 OBSERVATION。')
  L.push('  取数原则：能公开验证的绝不列为付费缺口；只有公开披露无法完成归因时，才进入付费/人工缺口。')

  for (const h of list) {
    L.push('')
    L.push(`  ${h.id}｜${h.node}(${h.mainline})　登记于 ${h.loggedOn}`)
    L.push(`     原始主张：${h.claim}`)
    L.push(`     来源：${h.source}`)

    // 四句话结论置于最前 —— 委员会明确不想再从指标表里自己提炼
    const v = fourLineVerdict(h)
    L.push('')
    L.push('     ── 机器结论(四句话) ──')
    L.push(`     1. ${v.currentFact}`)
    L.push(`     2. ${v.aiAsDriver}`)
    L.push(`     3. ${v.superCycle}`)
    L.push(`     4. ${v.candidacy}`)

    L.push('')
    L.push('     验证链(停在最早一个未完成的步骤，不是最晚一个已完成的)：')
    for (const st of VERIFICATION_CHAIN) {
      const cur = st.no === h.stage
      L.push(`       ${cur ? '▶' : ' '} ${st.no}. ${st.name.padEnd(7)}`
        + `${SOURCE_TIER_TEXT[st.source].padEnd(34)}${cur ? '← 当前停在此步' : ''}`)
      if (cur) L.push(`           问的是：${st.asks}`)
    }

    for (const p of h.propositions) {
      const label = p.horizon === 'CURRENT_FACT' ? '当前事实·可被单期数据证实或证伪'
        : '未来假设·任何单期数据都不能证明，须逐季累积'
      L.push('')
      L.push(`     ── 命题 ${p.id}：${p.claim} ──`)
      L.push(`        性质：${label}`)
      L.push(`        判定：${p.verdictText}`
        + `(${p.indicators.filter(i => i.status === 'MET').length}/${p.indicators.length} 兑现)`)
      for (const i of p.indicators) {
        const mk = i.status === 'MET' ? '✓' : i.status === 'REFUTED' ? '✗' : '·'
        L.push(`        ${mk} ${p.id}-${i.no}. ${i.text}`)
        L.push(`            取数：${SOURCE_TIER_TEXT[i.sourceTier]}`)
        L.push(`            ${i.evidence}`)
      }
    }

    const paid = paidGaps(h)
    const wiring = wiringBacklog(h)
    L.push('')
    L.push(`     付费数据缺口(${paid.length} 项)：`
      + '只有走完公开优先的前五层仍无法回答的才列入')
    for (const i of paid) L.push(`       · ${i.text}`)
    L.push(`     公开可得但尚未接入(${wiring.length} 项)：`
      + '这些是工作量，不是缺口 —— 不得用"要买数据"掩盖"还没做"')
    for (const i of wiring) L.push(`       · ${i.text}`)

    L.push('')
    L.push('     本条成立也不意味着：')
    for (const d of h.doesNotImply) L.push(`       · ${d}`)
    L.push('')
    L.push('     阻塞项：')
    for (const b of h.blockers) L.push(`       · ${b}`)
  }
  L.push('')
  return L.join('\n')
}
