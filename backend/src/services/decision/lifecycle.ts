/**
 * 决策语义层：仓位生命线与风险分类。
 *
 * ── 它解决的问题 ──
 *
 * 在此之前系统只能说出一句话:「这只股票 13.2%,超过 12%,所以卖。」
 * 那是仓位管家,不是投资决策系统。委员会 2026-08-17 的裁定把目标重新定义为:
 *
 *   战略决定「为什么值得长期持有」
 *   战术决定「现在处于这项投资的哪个生命阶段,下一步该做什么」
 *   组合决定「最多承受多少风险」
 *
 * ── 本文件刻意不引入任何新指标 ──
 *
 * 委员会同时明确:「先停掉加指标。现在缺的不是第 37 个指标,
 * 而是决策语义层。」故本模块**只消费已有证据**,不新增任何数据源。
 * 它把已有的读数翻译成「状态」与「动作资格」,而不是再算一个数。
 *
 * ── 最要紧的一条约束 ──
 *
 * 「技术数据可以决定战术状态,但不能单独决定交易动作。」
 *
 * 这条不是风格偏好。系统自己的回测已经证伪过价格窗口:
 * 按 10 日涨幅分档后"红灯"日的后续收益反而高于"绿灯"日。
 * 若允许「跌破 MA60 → 减仓」重新进来,等于把已经被数据推翻的东西请回决策层。
 *
 * 本文件用两道机制保证它进不来:
 *   1. 技术类证据的 `canReduce` 恒为 false（类型层面）
 *   2. R4 预期/价格风险的唯一动作是 STOP_ADDING,**永远不是 REDUCE**
 *
 * 第 2 条是技术数据参与决策的正确位置:它能让你「持有,不追」,不能让你卖。
 */

/**
 * 卖出的三种性质。**必须严格区分。**
 *
 * 否则投资人看到「减仓」根本不知道为什么减 —— 而这三种的含义、
 * 严重性、以及后续该做什么完全不同:
 * 价值退出意味着这家公司不该再拥有;组合减仓意味着公司没问题只是买多了。
 * 把两者都叫"减仓",等于把最严重的和最轻微的混为一谈。
 */
export type SellKind =
  /** ① 价值退出：公司已不值得继续拥有。最严重 */
  | 'VALUE_EXIT'
  /** ② 战术减仓：公司仍值得拥有，但当前风险收益结构不再支持原仓位 */
  | 'TACTICAL_REDUCE'
  /** ③ 组合减仓：公司本身没问题，但组合暴露过高 */
  | 'PORTFOLIO_REDUCE'

export const SELL_KIND_TEXT: Record<SellKind, string> = {
  VALUE_EXIT: '价值退出 —— 公司已不值得继续拥有',
  TACTICAL_REDUCE: '战术减仓 —— 公司仍值得拥有，但风险收益结构不再支持原仓位',
  PORTFOLIO_REDUCE: '组合减仓 —— 公司本身没问题，是组合暴露过高',
}

/**
 * 四类风险。**不是统统叫"风险"。**
 *
 * 分类的意义在于：同一个"减仓"动作，来源不同则后续动作完全不同。
 * R1 减完就结束；R2/R3 要重新做战略复核；R4 根本不该减。
 */
export type RiskCategory =
  /** R1 组合风险：单票超限、板块/主题集中、熔断、安全垫 */
  | 'R1_PORTFOLIO'
  /** R2 公司风险：收入停滞、扣非恶化、毛利恶化、节点内份额下降、订单/现金流异常 */
  | 'R2_COMPANY'
  /** R3 主线风险：产业需求/价格/库存/CapEx/产业利润/节点份额转坏 —— 公司可能仍是冠军，但蛋糕在缩小 */
  | 'R3_MAINLINE'
  /** R4 预期/价格风险：基本面未恶化，但价格已提前反映数年增长 */
  | 'R4_EXPECTATION'

export const RISK_TEXT: Record<RiskCategory, string> = {
  R1_PORTFOLIO: 'R1 组合风险（超限/集中度/熔断/安全垫）',
  R2_COMPANY: 'R2 公司风险（盈利/竞争/订单/现金流）',
  R3_MAINLINE: 'R3 主线风险（产业蛋糕在缩小）',
  R4_EXPECTATION: 'R4 预期/价格风险（价格透支未来）',
}

/**
 * 每类风险允许产生哪种卖出。
 *
 * 「R4 的答案是空数组」—— 这是整张表最重要的一格。
 * 预期/价格风险不能产生任何卖出，它只能让你停止追加。
 * 允许它产生减仓，就是把被回测证伪的"技术信号 → 卖出"换个名字放回来。
 */
export const RISK_CAN_PRODUCE: Record<RiskCategory, readonly SellKind[]> = {
  R1_PORTFOLIO: ['PORTFOLIO_REDUCE'],
  R2_COMPANY: ['TACTICAL_REDUCE', 'VALUE_EXIT'],
  R3_MAINLINE: ['TACTICAL_REDUCE', 'VALUE_EXIT'],
  R4_EXPECTATION: [],
}

/**
 * 证据的性质。决定它能不能参与减仓。
 *
 * 「技术类的 canReduce 恒为 false」。这是本文件的核心不变量：
 * 技术数据可以改变状态、可以停止追加、可以触发复核，
 * 但它单独永远不能构成减仓理由。
 */
export type EvidenceKind = 'ACCOUNTING' | 'FUNDAMENTAL' | 'TECHNICAL'

export const EVIDENCE_CAN_REDUCE: Record<EvidenceKind, boolean> = {
  /** 账务事实：仓位超限、熔断 —— 可以，且是最硬的 */
  ACCOUNTING: true,
  /** 基本面：财报口径的盈利/份额恶化 —— 可以，但须走战略复核 */
  FUNDAMENTAL: true,
  /** 技术/价格：均线、相对强度、量比、涨跌幅 —— **永远不可以** */
  TECHNICAL: false,
}

/**
 * 仓位生命线状态。**是状态，不是评分。**
 *
 * 这个区别很重要：评分可比较、可排序、可加权，于是会被拿去挑"哪只最好"；
 * 状态不可比较 —— P3 核心持有并不"高于" O1 右侧确认，它们是不同处境。
 */
export type LifecycleState =
  | 'O0' | 'O1'                 // 观察 / 右侧确认
  | 'P1' | 'P2' | 'P3' | 'P4'   // 初始仓 / 加仓 / 核心仓 / 追加观察
  | 'RISK_R4' | 'RISK_R2' | 'RISK_R3'
  | 'X'                          // 退出

export interface StateSpec {
  state: LifecycleState
  name: string
  /** 进入本状态的条件描述 */
  entry: string
  /** 本状态允许的动作。**不是"应该做"，是"允许做"** */
  allows: readonly Act[]
  note: string
}

/**
 * 动作。刻意不叫 BUY/SELL —— 那两个词把八种处境压成两种。
 */
export type Act =
  | 'RESEARCH'        // 继续研究
  | 'OPEN'            // 建仓
  | 'ADD'             // 加仓
  | 'TOP_UP'          // 追加
  | 'HOLD'            // 持有
  | 'STOP_ADDING'     // 持有但不再追加
  | 'REDUCE_EVAL'     // 减仓评估（不是减仓）
  | 'EXIT_EVAL'       // 退出评估
  | 'NOTHING'         // 观察，不动作

export const ACT_TEXT: Record<Act, string> = {
  RESEARCH: '继续研究',
  OPEN: '允许建仓',
  ADD: '允许加仓',
  TOP_UP: '允许追加',
  HOLD: '持有',
  STOP_ADDING: '持有，不追加',
  REDUCE_EVAL: '进入减仓评估（评估 ≠ 减仓）',
  EXIT_EVAL: '进入退出评估（评估 ≠ 退出）',
  NOTHING: '观察，不动作',
}

/**
 * 状态机定义。
 *
 * 注意 `REDUCE_EVAL` / `EXIT_EVAL` 不是 `REDUCE` / `EXIT`：
 * **状态变化 ≠ 自动卖出。** 状态只能把标的送进评估，
 * 真正的卖出仍须有一条法定理由（见 RISK_CAN_PRODUCE）。
 */
export const STATES: readonly StateSpec[] = [
  {
    state: 'O0', name: '观察',
    entry: '战略资格通过，但基本面证据不完整',
    allows: ['RESEARCH', 'NOTHING'],
    note: '观察不是"我觉得它不错"，而是「证据正在形成」',
  },
  {
    state: 'O1', name: '右侧确认',
    entry: '战略资格通过 + 关键事实初步兑现 + 预期/价格未进入风险区',
    allows: ['OPEN', 'RESEARCH', 'NOTHING'],
    note: '右侧不是"涨了所以买"，而是「更多关键事实已兑现，市场正在验证战略假设」',
  },
  {
    state: 'P1', name: '初始仓',
    entry: '已建立最小观察性头寸',
    allows: ['HOLD', 'NOTHING'],
    note: '建仓不是"可以买了"，而是「最低必要条件已满足，可以承担第一笔风险」',
  },
  {
    state: 'P2', name: '加仓',
    entry: '关键假设获得新增证据验证 + 组合风险可控',
    allows: ['ADD', 'HOLD'],
    note: '加仓不是"涨得不错继续买"，而是「关键假设得到新增证据验证」',
  },
  {
    state: 'P3', name: '核心持有',
    entry: '基本面强 + 主线强 + 无风险类别成立',
    allows: ['HOLD'],
    note: '核心仓不代表可以无限加 —— 追加须另行满足 P4',
  },
  {
    state: 'P4', name: '追加观察',
    entry: '原始投资逻辑继续兑现，且新增证据使错误概率进一步下降',
    allows: ['TOP_UP', 'HOLD'],
    note: '追加不是"越涨越买"，而是「错误概率进一步下降」',
  },
  {
    state: 'RISK_R4', name: '预期风险',
    entry: 'R4 成立：基本面未恶化，但价格已提前反映数年增长',
    // 只有 STOP_ADDING —— 这是技术/预期数据的天花板
    allows: ['STOP_ADDING', 'HOLD'],
    note: '「本状态不产生任何卖出」。R4 的唯一动作是停止追加 ——'
      + '允许它减仓，就是把被回测证伪的"技术信号 → 卖出"换个名字放回来',
  },
  {
    state: 'RISK_R2', name: '公司风险',
    entry: 'R2 成立：财报口径的盈利/竞争/订单/现金流恶化',
    allows: ['REDUCE_EVAL', 'HOLD'],
    note: '进入评估，不是自动减仓。评估须回答「什么事实变了，'
      + '以至于继续承担这部分风险不再划算」',
  },
  {
    state: 'RISK_R3', name: '主线风险',
    entry: 'R3 成立：产业蛋糕在缩小（公司可能仍是冠军）',
    allows: ['REDUCE_EVAL', 'EXIT_EVAL', 'HOLD'],
    note: '公司没问题也可能要减 —— 行业蛋糕缩小时，冠军身份不构成继续持有的理由',
  },
  {
    state: 'X', name: '退出',
    entry: '战略被证伪（四种情形之一），或公司逻辑被破坏',
    allows: ['EXIT_EVAL'],
    note: '战略改变不能因为"跌了 20%"，必须因为战略事实发生变化',
  },
]

export function specOf(s: LifecycleState): StateSpec {
  const found = STATES.find(x => x.state === s)
  if (!found) throw new Error(`未定义的生命线状态：${s}`)
  return found
}

/** 某状态是否允许某动作 */
export function allows(s: LifecycleState, act: Act): boolean {
  return specOf(s).allows.includes(act)
}

/**
 * 一只标的的三轴读数。**三条轴不能混。**
 *
 * 委员会 2026-08-17 明确：S0–S3 是「投资资格进度」，
 * 仓位生命线是另一条轴，风险生命线是第三条。
 * 混在一起的后果是：一只 S3 全过的标的会被读成"应该重仓"，
 * 而资格只说明它可以进入候选，与该持多少无关。
 */
export interface Axes {
  code: string
  name: string
  /** 轴一：投资资格进度。null = 未进入 S0 */
  qualification: 'S0' | 'S1' | 'S2' | 'S3' | 'CANDIDATE' | null
  /** 轴二：仓位生命线 */
  lifecycle: LifecycleState
  /** 轴三：成立的风险类别。可多个 */
  risks: readonly RiskCategory[]
  /** 战略资格。false 时无论其他轴如何，都不得建仓或加仓 */
  strategyAllows: boolean
}

/**
 * 由三轴推出「允许的动作集」。
 *
 * 「返回的是资格，不是建议」。允许 ≠ 应该。
 *
 * 顺序即优先级：战略否决 > 风险类别 > 生命线状态。
 * 战略否决放最前面，是因为它是唯一一条"证据再全也不放行"的闸门 ——
 * 研究证据链 ≠ 投资资格链。
 */
export interface ActVerdict {
  allowed: readonly Act[]
  /** 被挡掉的动作及理由 */
  blocked: readonly { act: Act; why: string }[]
  /** 若允许卖出，属哪一种。空数组 = 本次不产生任何卖出资格 */
  sellKinds: readonly SellKind[]
  reasoning: string
}

export function judgeActs(a: Axes): ActVerdict {
  const spec = specOf(a.lifecycle)
  const blocked: { act: Act; why: string }[] = []
  let allowed = [...spec.allows]

  // ① 战略否决：证据再全也不放行
  if (!a.strategyAllows) {
    for (const act of ['OPEN', 'ADD', 'TOP_UP'] as Act[]) {
      if (allowed.includes(act)) {
        blocked.push({ act, why: '战略层不允许该标的持仓（研究证据链 ≠ 投资资格链）' })
      }
    }
    allowed = allowed.filter(x => !['OPEN', 'ADD', 'TOP_UP'].includes(x))
  }

  // ② 风险类别决定可产生哪种卖出资格
  const sellKinds = [...new Set(a.risks.flatMap(r => RISK_CAN_PRODUCE[r]))]

  // ③ R4 单独成立时不得出现任何卖出资格 —— 这条必须显式写出来
  const onlyR4 = a.risks.length > 0 && a.risks.every(r => r === 'R4_EXPECTATION')
  if (onlyR4 && sellKinds.length > 0) {
    throw new Error('内部不一致：R4 单独成立却产生了卖出资格。RISK_CAN_PRODUCE.R4 必须为空')
  }

  const reasoning = [
    `生命线状态 ${a.lifecycle}（${spec.name}）`,
    `资格进度 ${a.qualification ?? '未进入 S0'}`,
    a.risks.length ? `风险 ${a.risks.map(r => RISK_TEXT[r]).join('、')}` : '无风险类别成立',
    a.strategyAllows ? '战略层允许' : '「战略层不允许」',
    sellKinds.length
      ? `可产生卖出资格：${sellKinds.map(k => SELL_KIND_TEXT[k]).join('；')}`
      : '不产生任何卖出资格',
    onlyR4 ? '「R4 单独成立 → 唯一动作是停止追加，不减仓」' : '',
  ].filter(Boolean).join('。')

  return { allowed, blocked, sellKinds, reasoning }
}

/**
 * 技术类证据能否构成减仓理由。**恒为 false。**
 *
 * 单独成一个函数而不是内联判断，是为了让这条约束有一个可被自检点名的位置。
 * 内联的判断会在重构中被"顺手简化"掉，而一个被自检引用的导出函数不会。
 */
export function technicalCanReduce(): boolean {
  return EVIDENCE_CAN_REDUCE.TECHNICAL
}

export function renderAxes(list: readonly Axes[]): string {
  const W = 108
  const L: string[] = ['', '═'.repeat(W), '仓位生命线 —— 每只标的处于哪个阶段', '═'.repeat(W)]
  L.push('  三条轴分开读：资格进度（能不能进候选）／生命线（该持多少）／风险（为什么要动）。')
  L.push('  「允许 ≠ 应该」。本表输出资格，不输出建议。')
  for (const a of list) {
    const v = judgeActs(a)
    const spec = specOf(a.lifecycle)
    L.push('')
    L.push(`  ${a.name}（${a.code}）　${a.lifecycle} ${spec.name}`)
    L.push(`    资格进度　${a.qualification ?? '未进入 S0'}`
      + `　战略层　${a.strategyAllows ? '允许' : '不允许'}`)
    L.push(`    风险　　　${a.risks.length ? a.risks.map(r => RISK_TEXT[r]).join('、') : '无'}`)
    L.push(`    允许动作　${v.allowed.map(x => ACT_TEXT[x]).join(' / ') || '无'}`)
    if (v.blocked.length) {
      for (const b of v.blocked) L.push(`    已挡　　　${ACT_TEXT[b.act]}：${b.why}`)
    }
    L.push(`    卖出资格　${v.sellKinds.length
      ? v.sellKinds.map(k => SELL_KIND_TEXT[k]).join('；') : '无'}`)
    L.push(`    说明　　　${spec.note}`)
  }
  L.push('')
  return L.join('\n')
}
