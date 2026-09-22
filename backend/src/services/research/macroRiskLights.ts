/**
 * 研究层 · M-01 鸿鹄·宏观风险三灯
 *
 * 这一层不生产动作。不改规则。不增加指标。不进入证据链。
 * 不进 DashboardInput。不 import makeAction。证据等级恒为 OBSERVATION。
 *
 * ── 它回答的问题 ──
 *
 * 委员会 2026-09-22 要求把大摩 Wilson 的宏观风险做成一套三灯，
 * 好处是"以后不用每天争论 Wilson 对不对"。
 *
 * 这个动机是对的。但一盏灯只有在它不能指挥资本的时候才安全。
 * 所以这张面板真正要回答的不是"今天几号灯"，而是：
 *
 *   当我们后来真的动了仓位，写在理由栏里的是这盏灯，还是别的东西？
 *
 * ── 为什么绿灯也不能开许可 ──
 *
 * 委员会原话是：绿灯时"AI 可以继续保持较高 Capital Permission"。
 * 这一句必须改。当前资本许可关闭的三个理由与油价、美债、美联储全都无关：
 *   ① 执行债务未清偿 → 新增建仓封锁；
 *   ② 一级熔断成立，组合股票上限 50%；
 *   ③ 研究主线只研究不进组合，不在册标的永不输出为候选。
 *
 * 宏观转绿不会清掉任何一条。所以绿灯最多只是"少了一个担心"，
 * 不是"多了一份额度"。反过来，红灯也不产生卖出令 —— T-01 已经裁定：
 * 宏观判断不能直接跳到 Action。
 *
 * 灯永远不是理由。
 */

import type { EvidenceTier } from '../cockpit/types'

const TIER = 'OBSERVATION' as const

/** 外部可核验，但未接入本系统管道。读数只能当转述，不能当系统数据 */
const EXTERNAL_NOT_WIRED = 'EXTERNAL_READ_NOT_WIRED'
/** 本系统没有这个指标，也没有定义它该怎么算 */
const NO_DEFINED_METRIC = 'NO_DEFINED_METRIC'
/** 真实资金流免费源缺失，恒为不可得 */
const MONEY_RADAR_UNAVAILABLE = 'MONEY_RADAR_UNAVAILABLE'
const UNVERIFIED = 'UNVERIFIED'

export const MACRO_LIGHTS_ID = 'M-01'
export const MACRO_LIGHTS_TITLE = '鸿鹄·宏观风险三灯'

export const MACRO_LIGHTS_OBJECT =
  '这张面板不判断 Wilson 对不对。它只记录一件事：当我们后来真的动了仓位，'
  + '写在理由栏里的是这盏灯，还是熔断缺口与未清债务这些已经存在的法定理由。'

export const HMR_CLAIM =
  '油价上行 → 通胀预期上行 → 长端美债收益率上行 → 金融条件收紧 → 股票估值承压，'
  + '这条链条正在压缩高估值资产的安全边际。'

/** 绿灯不打开资本许可 —— 关闭许可的三道闸门与宏观无关。 */
export function greenOpensPermission(): false {
  return false
}

/** 红灯不产生卖出令 —— 宏观判断不能直接跳到 Action。 */
export function redCreatesSellOrder(): false {
  return false
}

/** 灯不是法定减仓理由，任何颜色都不是。 */
export function lightIsLegalReason(): false {
  return false
}

/** 指数风险不等于主线消失；指数新高也不等于扩散健康。 */
export function indexRiskKillsMainline(): false {
  return false
}

/** 「价格+资金同步恶化」当前不可判定 —— 资金列恒为不可得。 */
export function moneySyncEvaluable(): false {
  return false
}

/** 7100 是压力情景，不是基准预测，也不是目标价。 */
export function scenarioIsForecast(): false {
  return false
}

/** 美股的板块换挡不能迁移 A 股的生命线。 */
export function usRotationMigratesLifeline(): false {
  return false
}

/** 三灯当前不可机械判定 —— 六环链条一环都没接线。 */
export function lightsMechanicallyDecidable(): false {
  return false
}

/** 宏观担忧不能推出"必须寻找替代主线"。 */
export function riskRequiresNewMainline(): false {
  return false
}

/** 现金可以是一种资产，空仓焦虑不是买入理由。 */
export function cashIsAnAsset(): true {
  return true
}

export type LinkStatus =
  | typeof EXTERNAL_NOT_WIRED
  | typeof NO_DEFINED_METRIC
  | typeof UNVERIFIED

export interface ChainLink {
  no: number
  link: string
  status: LinkStatus
  note: string
}

/**
 * 风险链条六环。逐环标出本系统能不能读到它。
 *
 * 结论先写在这里：六环一环都没接入管道。
 * 所以这套三灯今天不是"黄灯"，而是"不可判定" ——
 * 把不可判定写成黄灯，等于用一个手工读数冒充系统状态。
 */
export const RISK_CHAIN: readonly ChainLink[] = [
  {
    no: 1, link: '油价（Brent）', status: EXTERNAL_NOT_WIRED,
    note: '外部可核验到日内读数，本系统无管道。转述读数不得当成系统数据。',
  },
  {
    no: 2, link: '通胀预期', status: EXTERNAL_NOT_WIRED,
    note: '盈亏平衡通胀率外部可得，本系统无管道，且未定义用哪个期限。',
  },
  {
    no: 3, link: '长端美债收益率（10Y/30Y）', status: EXTERNAL_NOT_WIRED,
    note: '外部可核验，本系统无管道。委员会门槛只写了 10Y，未写 30Y。',
  },
  {
    no: 4, link: '金融条件收紧', status: NO_DEFINED_METRIC,
    note: '本系统没有金融条件指数，也没定义它怎么算。这一环目前只能靠形容词。',
  },
  {
    no: 5, link: '美股估值', status: EXTERNAL_NOT_WIRED,
    note: '前瞻 PE 外部可得，本系统无管道。且它是美股的估值，不是组合的估值。',
  },
  {
    no: 6, link: '传导到 A 股 AI 硬件', status: UNVERIFIED,
    note: '这一环需要额外一跳，且从未被本系统验证过。前五环全部成立也不自动有第六环。',
  },
]

export type LightColor = 'GREEN' | 'YELLOW' | 'RED'

export interface LightBand {
  color: LightColor
  name: string
  /** 委员会给出的触发条件，原样登记 */
  committeeConditions: readonly string[]
  /** 这盏灯亮起时**不会**发生什么 */
  doesNot: string
}

/**
 * 委员会 2026-09-22 给出的三灯，原样登记。
 *
 * 原样登记很重要：如果这里替委员会把门槛补齐、把重叠区抹平，
 * 那么下次读这张表的人会以为门槛一直是严密的，
 * 而真实情况是它有一个未定义区间和一个重叠区间。
 */
export const LIGHT_BANDS: readonly LightBand[] = [
  {
    color: 'GREEN', name: '风险解除',
    committeeConditions: [
      'Brent < 95 美元',
      '10Y < 4.8%',
      '美联储继续加息预期明显下降',
    ],
    doesNot:
      '不打开 Capital Permission。关闭许可的三道闸门是执行债务、一级熔断、'
      + '研究主线与不在册 —— 宏观转绿不清掉其中任何一条。',
  },
  {
    color: 'YELLOW', name: '震荡风险',
    committeeConditions: [
      'Brent 98–105 美元',
      '10Y 4.8–5.0%',
      'AI 盈利继续强',
    ],
    doesNot:
      '不构成"仓位不要满"的法定依据。仓位上限来自熔断与单票上限，'
      + '不来自这盏灯。灯是黄的而仓位合规，系统不发令。',
  },
  {
    color: 'RED', name: '启动宏观 TPO',
    committeeConditions: [
      'Brent > 105–110 美元',
      '10Y > 5% 并继续上行',
      '美联储继续强化加息预期',
      '纳指跌破关键趋势位',
      'AI 龙头出现价格与资金同步恶化',
    ],
    doesNot:
      '不产生卖出令。宏观判断不能直接跳到 Action（T-01 已裁定）。'
      + '且第五条当前不可判定 —— 资金列恒为不可得。',
  },
]

export interface SpecDefect {
  where: string
  defect: string
  why: string
}

/**
 * 门槛本身的缺陷。写出来不是挑刺，是因为一盏会自己打架的灯比没有灯更危险：
 * 它会让人以为自己在按规则走。
 */
export const SPEC_DEFECTS: readonly SpecDefect[] = [
  {
    where: 'Brent 95–98 美元',
    defect: '未定义区间。绿灯要求 < 95，黄灯从 98 起，中间三美元没有归属。',
    why: '油价落在这一段时，这套灯给不出颜色，只能靠人临时裁量 —— 而临时裁量正是三灯想消除的东西。',
  },
  {
    where: 'Brent 105–110 美元',
    defect: '重叠区间。黄灯上界写 105，红灯下界写"> 105–110"，同一段被两盏灯覆盖。',
    why: '重叠区里颜色取决于谁先读，而不是取决于油价。',
  },
  {
    where: '10Y 的 5.0% 这一点',
    defect: '黄灯上界 5.0% 与红灯下界 5.0% 贴在一起，而近五个交易日 10Y 在 4.94% 与 5.01% 之间反复。',
    why: '一盏会因为 7 个基点每天换色的灯，不可能承担资本闸门的功能。它只能当观察面板。',
  },
  {
    where: '红灯第五条：AI 龙头价格与资金同步恶化',
    defect: '不可判定。真实资金流免费源缺失，Money Radar 恒为不可得。',
    why: '禁止用价格或成交额代理冒充资金验证。一个不可判定的条件写进红灯，红灯就永远差一条。',
  },
  {
    where: '长端只写了 10Y',
    defect: '30Y 未进门槛，而它已经明显高于 10Y。',
    why: '如果链条讲的是长端与金融条件，把最长端漏在门槛外，链条就是不完整的。',
  },
]

/** 三灯当前的判定结果。不是黄灯，是不可判定 —— 因为输入一环都没接线。 */
export const LIGHT_STATE_TODAY = {
  state: 'UNDECIDABLE' as const,
  reading: '按委员会转述读数，落在黄灯带',
  systemVerdict: '按系统可核验数据，三灯不可判定',
  why:
    '六环链条一环未接入管道，红灯第五条恒不可判定，门槛另有一个未定义区间与一个重叠区间。'
    + '两个结论必须同时显示，且不得互相替代：转述读数是委员会的判断，不可判定是系统的状态。',
}

export interface Reading {
  item: string
  value: string
  status: typeof EXTERNAL_NOT_WIRED
  note: string
}

export type ScenarioGroupId = 'TRIGGER' | 'STRUCTURE' | 'TIME'

export interface ScenarioGroup {
  id: ScenarioGroupId
  name: string
  question: string
  items: readonly string[]
  boundary: string
}

/**
 * Wilson 的 7100 压力情景拆成三组。
 *
 * 三组不能互相替代：
 *   · 油价和利率恶化，不能替代市场内部广度；
 *   · 指数仍在高位，不能替代盈利修正；
 *   · 11 月时间窗，不能替代任何触发因素。
 */
export const SCENARIO_GROUPS: readonly ScenarioGroup[] = [
  {
    id: 'TRIGGER',
    name: '触发因素',
    question: '外部压力有没有继续恶化？',
    items: ['Brent 油价', '10Y / 30Y 长端利率', '金融条件'],
    boundary: '只描述风险环境，不回答市场是否已经确认 7100 情景。',
  },
  {
    id: 'STRUCTURE',
    name: '市场结构',
    question: '指数表面与内部结构是否继续背离？',
    items: ['指数位置', '市场内部广度', '个股回撤', '盈利修正'],
    boundary: '指数新高不能替代广度，广度恶化也不能替代盈利验证。',
  },
  {
    id: 'TIME',
    name: '时间因素',
    question: '压力情景有没有进入它原本的时间窗口？',
    items: ['11 月中期选举窗口'],
    boundary: '时间窗口只是一枚时钟，不是触发器，也不是卖出理由。',
  },
]

export interface BreadthField {
  field: string
  status: typeof EXTERNAL_NOT_WIRED | typeof NO_DEFINED_METRIC
  note: string
}

/**
 * Index Level 与 Breadth Quality 必须拆开。
 *
 * 这是结构数据契约，不是信号。任何字段接线后仍不得直接生成买卖动作。
 */
export const BREADTH_QUALITY: readonly BreadthField[] = [
  {
    field: '指数位置',
    status: EXTERNAL_NOT_WIRED,
    note: '记录指数相对历史高点与趋势位置；只回答权重指数在哪里。',
  },
  {
    field: '新高 / 新低数量',
    status: EXTERNAL_NOT_WIRED,
    note: '记录市场内部上行与下行尾部；指数新高而新低更多，属于集中驱动警告。',
  },
  {
    field: '中位数股票表现',
    status: EXTERNAL_NOT_WIRED,
    note: '避免市值加权指数掩盖多数股票的真实表现。',
  },
  {
    field: '行业扩散度',
    status: NO_DEFINED_METRIC,
    note: '尚未定义行业上涨家数、盈利上修行业数或相对强度扩散中的哪一种，不能临时挑口径。',
  },
  {
    field: '龙头集中度',
    status: NO_DEFINED_METRIC,
    note: '尚未定义市值贡献、涨幅贡献或成交贡献口径，不能用主观印象代替。',
  },
]

export interface ContractGap {
  id: 'M-01 Data/Rule Contract Gap'
  status: 'OPEN'
  dataGaps: readonly string[]
  ruleGaps: readonly string[]
  resolutionBoundary: string
}

/**
 * 不为让灯今天亮起来临时改规则。先登记数据/规则契约缺口，
 * 等输入、口径与滞后机制都被单独验证后，再决定要不要立项。
 */
export const DATA_RULE_CONTRACT_GAP: ContractGap = {
  id: 'M-01 Data/Rule Contract Gap',
  status: 'OPEN',
  dataGaps: [
    'Brent、盈亏平衡通胀率、10Y、30Y、金融条件指数、指数位置、广度、盈利修正均未接入稳定管道。',
    '真实资金流免费源缺失，AI 龙头价格与资金同步性不可判定。',
    'Breadth Quality 五字段中三项未接线、两项连口径都未定义。',
  ],
  ruleGaps: [
    'Brent 95–98 美元未定义，105–110 美元重叠。',
    '10Y 以 5.0% 为硬切点会被 7bp 波动反复触发。',
    '尚未定义进入阈值、退出阈值、最短保持期与连续确认次数，因此没有 hysteresis。',
    '三组情景之间尚未定义 AND / OR 关系，触发、结构、时间不得互相替代。',
  ],
  resolutionBoundary:
    '保持规则指纹不变。不为了让灯今天有颜色而补阈值、加滞后或改 Capital Permission。'
    + '本缺口只进入研究与数据合同待办，不进入 Decision。',
}

/**
 * 2026-09-22 的外部读数。全部核到一手或路透/CNBC 转载，
 * 但全部标 EXTERNAL_READ_NOT_WIRED —— 核得到 ≠ 接进来了。
 */
export const READINGS: readonly Reading[] = [
  {
    item: 'Brent 近期高点', value: '9/15 盘中 109.45 美元',
    status: EXTERNAL_NOT_WIRED,
    note: '按委员会自己的红灯门槛（> 105–110），一周前已经触过一次。',
  },
  {
    item: 'Brent 9/21 收盘', value: '100.34 美元，当日 -3.4%，11 日低点',
    status: EXTERNAL_NOT_WIRED,
    note: '下跌原因是本周联合国会议可能取得中东突破的传闻，属消息面缓和，不是供给恢复。',
  },
  {
    item: 'Brent 9/22 盘中', value: '约 101.5–101.7 美元，+1.3%',
    status: EXTERNAL_NOT_WIRED,
    note: '美财长 Bessent 称周三起关停全部伊朗航空公司后回升。压力是升的，不是降的。',
  },
  {
    item: '10Y 美债 9/22 早盘', value: '4.943%，当日 -2bp',
    status: EXTERNAL_NOT_WIRED,
    note: '同日 2Y 4.741%，30Y 5.272%。最长端已明显在 5% 之上。',
  },
  {
    item: '10Y 常数期限近五日', value: '9/18 5.01%、9/17 4.94%、9/16 5.01%、9/15 5.00%、9/14 4.97%',
    status: EXTERNAL_NOT_WIRED,
    note: '五日里三日 ≥ 5.00%。所以"稳定在 4.9%"不成立，它在黄红边界上反复。',
  },
  {
    item: '标普 9/21 收盘', value: '7764.70，+1.49%，距 8/13 高点 -0.4%',
    status: EXTERNAL_NOT_WIRED,
    note: '标普没有创新高。新高只属于纳指。',
  },
  {
    item: '纳指 9/21 收盘', value: '27122.09，+2.26%，自 6/2 以来首次收盘新高',
    status: EXTERNAL_NOT_WIRED,
    note: 'AMD 市值首破 1 万亿美元，费半 +4.3%，Intel +12.2%，Arm +17%。',
  },
  {
    item: '9/21 新高新低', value: '纳斯达克 64 新高 / 127 新低；标普 7 新高 / 29 新低',
    status: EXTERNAL_NOT_WIRED,
    note: '纳指创收盘新高那一天，新低数是新高数的两倍。指数新高不等于扩散健康。',
  },
  {
    item: '罗素 3000 广度', value: '自 6 月以来超过 40% 的成员跌幅至少 20%',
    status: EXTERNAL_NOT_WIRED,
    note: '指数外面的调整已经很深。这是 Wilson 论证的核心事实，不是他的风险预言。',
  },
  {
    item: '标普前瞻 PE', value: '回到约 19 倍，同比低约 20%，为 3 月以来最低',
    status: EXTERNAL_NOT_WIRED,
    note: '估值压缩已经发生过一轮，不是即将发生。',
  },
  {
    item: '标普中位数个股盈利增速', value: '约 15%，上修广度接近周期高位',
    status: EXTERNAL_NOT_WIRED,
    note: '估值下行与盈利上行同时出现 —— Wilson 把这个组合定义为典型的周期中段切换。',
  },
  {
    item: '7100 情景的跌幅口径', value: '相对 9/18 收盘约 -7%；相对 9/21 收盘约 -8.6%，外部已有"接近 10%"的写法',
    status: EXTERNAL_NOT_WIRED,
    note: '要记的是 7100 这个点位，不是某个百分比 —— 百分比随参照日变，点位不变。',
  },
  {
    item: '中期选举季节性', value: '常见 5%–10% 指数级回撤；当前指数回撤仅约 2%',
    status: EXTERNAL_NOT_WIRED,
    note: 'Wilson 给 7100 情景的时间锚是 11 月中期选举。委员会转述里漏了这一项。',
  },
]

/**
 * 必须改掉的口径。
 *
 * 委员会这次的读法有三分之二是对的 —— 尤其"7100 是情景不是预测"和
 * "指数风险不等于主线消失"两条都立得住。以下是需要改的部分。
 */
export const MACRO_CORRECTIONS = [
  '「伊朗可能一周内重开霍尔木兹 → 油价回落到 100 美元以下」是 9/21 的行情，'
  + '9/22 已经反转：美财长称周三起关停全部伊朗航空公司，Brent 回到约 101.5 美元。'
  + '用一天的缓和当成链条改善，会让这盏灯每天换色。',
  '「此前超过 102 美元」低估了近期高点。Brent 9/15 盘中到过 109.45 美元，'
  + '按委员会自己的红灯门槛，一周前已经触过一次。',
  '「10Y 约 4.9%」只取了日内读数。近五个交易日常数期限有三日 ≥ 5.00%，'
  + '且 30Y 已到 5.272%。长端不是稳在 4.9%，是在黄红边界上反复。',
  '「纳指创收盘新高」成立，但不能顺带读成标普也强。标普 7764.70 仍低于 8/13 高点 0.4%。',
  '新高当天的广度是负的：纳斯达克 64 新高 / 127 新低。'
  + '委员会用了"指数下跌不等于主线消失"这一面，但同一枚硬币的另一面是'
  + '"指数新高也不等于扩散健康" —— 两面都要用。',
  'Wilson 的核心不是「估值将被压缩」，而是「估值已经压缩过了，而且压缩发生在指数外面」：'
  + '前瞻 PE 已回到约 19 倍（同比低约 20%，3 月以来最低），罗素 3000 超过 40% 的成员自 6 月以来跌了至少 20%。'
  + '他的框架词是周期中段切换，不是估值见顶。',
  'Fed 那一栏不能只记 ⚠️。Wilson 自己的读法是：加息基本已被定价，'
  + '核心通胀偏强但不全面热、住房分项仍软、关税传导在消退，'
  + '因此这次加息反而增强可信度，并降低了 2022 式紧缩的概率。',
  '委员会漏了 7100 情景的时间锚：11 月中期选举季节性常见 5%–10% 的指数回撤，'
  + '而当前指数回撤只有约 2%。没有这一项，7100 就只是一个没有日期的数字。',
] as const

export interface RotationConflict {
  wilsonFrom: readonly string[]
  wilsonTo: readonly string[]
  committeeMapping: readonly string[]
  finding: string
  why: string
  handling: string
}

/**
 * 这是本模块最重要的一节。
 *
 * 委员会把 Wilson 的「换挡」对应到了 A 股的资本开支扩散梯子，
 * 并认为两者"有很强的对应关系"。方向对不上。
 *
 * Wilson 的换挡是：从 early-cycle、资本密集型赢家（他点名半导体）
 * 换到更高质量、更轻资产、自由现金流更强的公司（软件、金融服务、保险、医疗服务）。
 *
 * 而 C-01 的梯子越往下走越重资产：PCB/CCL、电源、液冷、数据中心，
 * 资本密集度高于光模块，自由现金流弱于光模块。
 *
 * 所以照 Wilson 的逻辑推 A 股，它反对那张梯子，而不是支持它。
 * 这个冲突必须照实记，不能抹平成"都在说换挡"。
 */
export const ROTATION_CONFLICT: RotationConflict = {
  wilsonFrom: ['early-cycle', '资本密集型赢家', '半导体与其他周期股'],
  wilsonTo: ['更高质量', '更轻资产', '自由现金流更强', '软件 / 金融服务 / 保险 / 医疗服务'],
  committeeMapping: ['光模块', 'PCB/CCL', '电源', '液冷', '数据中心', 'AI 应用'],
  finding:
    'M-01 与 C-01 方向冲突但可以同时成立。Wilson 的换挡是从重资产换到轻资产；'
    + 'C-01 的梯子是从光模块往更重资产的承载层、供电散热层、数据中心层扩散。'
    + '两者不是同一个方向：一个讨论资本市场给谁估值，一个讨论产业需求流向哪里。',
  why:
    'PCB/CCL、电源、液冷、数据中心的资本密集度高于光模块，自由现金流弱于光模块。'
    + '因此可能同时发生：AI 需求继续向下游扩散，但资本市场不给这些资本密集型环节更高估值。'
    + 'Wilson 点名要换出的包括半导体，故不能把他的风格切换偷换成"AI 硬件内部换挡"。',
  handling:
    '冲突共存，暂不裁决；两边都不因此获得或失去资格：C-01 的订单、收入、利润三列尚未接入，'
    + 'M-01 的六环链条一环未接线，两边都没有能定胜负的证据列。'
    + '把冲突抹平成"都在说换挡"，是这次最需要避免的一步 ——'
    + '一个被抹平的冲突，以后会被当成两份互相印证的证据引用。',
}

export interface CashClaimAudit {
  claim: string
  macroIsNotReason: string
  lawfulChannels: readonly string[]
  concentrationClaim: string
  conclusion: string
}

/**
 * 「利用反弹把现金提高到 18%–20%」这条主张的法理审查。
 *
 * 结论不是"不能提现金"。结论是"提现金的理由不能写 Wilson"。
 * 而且巧的是，同一个动作在本系统里本来就有两条法定通道 ——
 * 其中一条还已经欠着没执行。
 */
export const CASH_CLAIM_AUDIT: CashClaimAudit = {
  claim: '利用反弹把现金提高到 18%–20%，并降低中际+新易盛这类高相关资产的集中度。',
  macroIsNotReason:
    '宏观风险不在法定减仓理由白名单里。T-01 已裁定：宏观判断不能直接跳到 Action。'
    + '所以"因为油价与美债所以提现金"这条路径本身不成立。',
  lawfulChannels: [
    '一级熔断的股票上限缺口 —— 这是账务事实，本来就要求降敞口，与油价无关。',
    '澜起科技的 C 级清退债务未执行 —— 这笔卖出本来就欠着。',
    '兆易创新的硬止损债务未执行 —— 同上。',
  ],
  concentrationClaim:
    '「降低中际+新易盛集中度」在组合口径下没有超过单票上限，故没有法定理由。'
    + '委员会 2026-08-15 已因口径变更判这两条挂单失效。不超限就不是减仓理由，'
    + '哪怕两只加起来确实是同一个风险因子。',
  conclusion:
    '反弹改善的是债务执行窗口，不是产生"逢高减仓"信号。这是"利用反弹提高现金"在本系统里'
    + '唯一有法定基础的版本 —— 先把欠着的两笔执行掉，现金自然上来，'
    + '熔断缺口同时补上，而且不用动中际和新易盛，也不用引用 Wilson。',
}

/** 仓位百分比的口径守卫。券商口径不参与上限判定。 */
export const BASIS_GUARD = {
  rule: '本表不写任何仓位百分比。要读集中度与现金率，一律用组合口径，不用券商账户口径。',
  why:
    '委员会给出的 85.5% 仓位、36.3% 双光模块、65.9% 四只合计，全部是券商账户口径。'
    + '券商口径把账户外股票资金排除在分母外，会把同一笔持仓算出高得多的百分比。'
    + '委员会 2026-08-15 已裁定上限一律用组合口径。'
    + '另：当前账本 asOf 落后于今日，账户时效守卫已判为数据缺口，'
    + '故任何由它推出的百分比都是指示性的，不具备判定效力。',
}

export const ACCOUNT_BASIS_AUDIT = {
  status: 'INDICATIVE_ONLY' as const,
  inputs: {
    brokerTotalWan: 321.9,
    positionsValueWan: 275.4,
    brokerCashWan: 46.5,
    externalCashWan: 200,
    source: '委员会 2026-09-22 口头约数；不是已更新的 portfolio.json',
  },
  formula:
    '组合总资产 = 券商总资产 321.9万 + 账户外股票现金 200万 = 521.9万；'
    + '股票仓位 = 275.4 ÷ 521.9 = 52.8%；总现金 = 46.5 + 200 = 246.5万，现金率 = 47.2%。',
  correction:
    '按这组口头约数重算，不是上一版的 51.7% / 48.3%。'
    + '一级熔断 50% 股票上限对应的指示性缺口约 14.45万，而不是 8.6万。',
  debtEstimate:
    '澜起 + 兆易约 33万同样是估算：股数来自 2026-08-15 旧账本，价格来自盘中转述，'
    + '未形成同一 asOf 的可审计快照。',
  decisionBoundary:
    '52.8%、47.2%、14.45万、约33万全部只能标 indicative / 非判定。'
    + '在更新股数、现金、外部现金归属与同一时点价格之前，不得驱动实际交易。',
}

export const FINAL_STATE_LOCKS = [
  {
    item: 'M-01 宏观风险',
    status: 'UNDECIDABLE',
    boundary: '数据可查，但没有完整系统管道、稳定阈值与 hysteresis；不是黄、绿或红。',
  },
  {
    item: 'Wilson',
    status: 'RESEARCH_HYPOTHESIS',
    boundary: '周期中段、资本密集型 → 更轻资产 / 高 FCF；不进入 Capital Permission。',
  },
  {
    item: 'C-01 AI 产业链扩散',
    status: 'INDEPENDENT_RESEARCH_HYPOTHESIS',
    boundary: '订单、收入、利润尚未完整接入；不因 Wilson 降级，也不因 AI 故事升级。',
  },
  {
    item: '海光 1000 系列',
    status: 'SECOND_CURVE_EVIDENCE',
    boundary:
      '1000 系列 → Edge AI → Physical AI 只登记为第二曲线形成证据；'
      + '收入与利润尚未验证，研究加分不等于买入权限。',
  },
  {
    item: '当前现金动作',
    status: 'WAIT_FOR_FRESH_ACCOUNT',
    boundary:
      '账本更新后若仍确认一级熔断超限且澜起 / 兆易执行债务成立，则执行债务。'
      + '不是因为 Wilson 卖，也不是因为看空 AI 卖。',
  },
] as const

export const M01_DOES_NOT_IMPLY = [
  '不意味着 7100 是基准预测 —— 它是压力情景，年末目标仍是 8000',
  '不意味着美股要跌所以 AI 要卖',
  '不意味着绿灯可以打开 Capital Permission',
  '不意味着红灯可以产生卖出令',
  '不意味着黄灯构成"仓位不要满"的法定依据',
  '不意味着 Wilson 的板块换挡可以迁移 A 股的生命线',
  '不意味着 Wilson 的换挡支持 C-01 的资本开支扩散梯子 —— 方向相反',
  '不意味着看到风险就必须寻找替代主线',
  '不意味着可以用价格或成交额代理冒充资金验证',
  '不意味着海光的价格与资金背离构成法定减仓理由',
  '不意味着澜起与兆易因为反弹就可以免除未执行的债务',
  '不改 V4.x。不加 V5。本层不发令。',
] as const

export const M01_BLOCKERS = [
  '六环风险链条一环都没接入本系统管道 → 三灯今天只能手工读，不能自动判。',
  '红灯第五条依赖资金同步性，而 Money Radar 恒为不可得 → 红灯永远差一条。',
  '门槛有一个未定义区间（Brent 95–98）与一个重叠区间（105–110）→ 尚不可机械判定。',
  '10Y 在 4.94% 与 5.01% 之间反复 → 黄红边界一周内被多次跨过，灯不能当闸门。',
  '尚未定义 hysteresis（进入阈值、退出阈值、保持期、连续确认次数）→ 不能让 7bp 波动反复开关。',
  '关闭资本许可的三道闸门与宏观无关 → 宏观转绿也不产生任何额度。',
  '账本 asOf 落后于今日 → 由它推出的仓位百分比只是指示性的。',
] as const

export const M01 = {
  id: MACRO_LIGHTS_ID,
  title: MACRO_LIGHTS_TITLE,
  claim: HMR_CLAIM,
  object: MACRO_LIGHTS_OBJECT,
  source: '委员会 2026-09-22 宏观层证据登记（大摩 Wilson 9/15 与 9/21 两次表述）',
  loggedOn: '2026-09-22',
  pool: '战略观察池',
  hypothesis: 'H-MR',
  status: 'OPEN' as const,
  tier: TIER as EvidenceTier,
  doesNotImply: M01_DOES_NOT_IMPLY,
  blockers: M01_BLOCKERS,
}

export interface MacroVerdict {
  object: string
  chain: string
  wilson: string
  rotation: string
  permission: string
  cash: string
  mainline: string
  dataContract: string
}

export function macroVerdict(): MacroVerdict {
  return {
    object: MACRO_LIGHTS_OBJECT,
    chain:
      '链条存在，但本系统一环都读不到。六环全部未接线，红灯第五条恒不可判定，'
      + '门槛另有未定义区间与重叠区间。故三灯今天的系统状态是不可判定，不是黄灯。'
      + '委员会的黄灯读数照实登记，但它是转述，不是系统数据。',
    wilson:
      '值得记，但要记对：Wilson 的论证核心是"估值已经压缩过了，而且压缩发生在指数外面" ——'
      + '前瞻 PE 已回到约 19 倍，罗素 3000 超过 40% 的成员自 6 月以来跌了至少 20%，'
      + '而中位数个股盈利仍增长约 15%。他的框架词是周期中段切换。'
      + '7100 是压力情景，时间锚是 11 月中期选举，年末目标仍是 8000。',
    rotation:
      '与 C-01 方向冲突但可以同时成立，冲突共存、暂不裁决。Wilson 要换出的是资本密集型赢家（他点名半导体），'
      + '换入的是轻资产、强自由现金流；而 C-01 的梯子越往下越重资产。'
      + '可能同时发生：需求继续向下游扩散，但资本市场不给重资产环节更高估值。'
      + '两边都没有能定胜负的证据列，所以两边都不因此获得或失去资格。冲突不抹平。',
    permission:
      '灯不改资本许可。绿灯不开，因为关闭许可的三道闸门是执行债务、一级熔断、'
      + '研究主线与不在册，全部与宏观无关；红灯不卖，因为宏观判断不能直接跳到 Action。',
    cash:
      '提现金可以，但理由不能写 Wilson。同一个动作本来就有两条法定通道：'
      + '熔断的股票上限缺口，以及澜起与兆易两笔未执行的债务。'
      + '反弹改善的是债务执行窗口，不是产生"逢高减仓"信号。'
      + '而中际与新易盛在组合口径下未超单票上限，没有法定减仓理由。',
    mainline:
      '主线不变，且不需要寻找替代主线。看到风险不等于必须换主线 ——'
      + '没有新的产业链加资金加相对强度加龙头的同步证据，就没有迁仓权限。'
      + '现金可以是一种资产，空仓焦虑不是买入理由。',
    dataContract:
      'M-01 Data/Rule Contract Gap 保持 OPEN。先补数据接口与稳定契约，不改规则指纹，'
      + '不为了让灯今天有颜色而临时添加阈值或 hysteresis。'
      + '旧账本重算的 52.8% 股票、47.2% 现金、14.45万熔断缺口和约33万债务都只是 indicative，'
      + '更新同一 asOf 的账本前不得驱动交易。',
  }
}

export function buildMacroRiskLightsView() {
  return {
    ...M01,
    chain: RISK_CHAIN,
    scenarioGroups: SCENARIO_GROUPS,
    breadthQuality: BREADTH_QUALITY,
    contractGap: DATA_RULE_CONTRACT_GAP,
    bands: LIGHT_BANDS,
    specDefects: SPEC_DEFECTS,
    lightState: LIGHT_STATE_TODAY,
    readings: READINGS,
    corrections: MACRO_CORRECTIONS,
    rotationConflict: ROTATION_CONFLICT,
    cashAudit: CASH_CLAIM_AUDIT,
    basisGuard: BASIS_GUARD,
    accountBasisAudit: ACCOUNT_BASIS_AUDIT,
    finalStateLocks: FINAL_STATE_LOCKS,
    verdict: macroVerdict(),
    moneyRadar: MONEY_RADAR_UNAVAILABLE,
    flags: {
      greenOpensPermission: greenOpensPermission(),
      redCreatesSellOrder: redCreatesSellOrder(),
      lightIsLegalReason: lightIsLegalReason(),
      indexRiskKillsMainline: indexRiskKillsMainline(),
      moneySyncEvaluable: moneySyncEvaluable(),
      scenarioIsForecast: scenarioIsForecast(),
      usRotationMigratesLifeline: usRotationMigratesLifeline(),
      lightsMechanicallyDecidable: lightsMechanicallyDecidable(),
      riskRequiresNewMainline: riskRequiresNewMainline(),
      cashIsAnAsset: cashIsAnAsset(),
    },
  }
}

export function renderMacroRiskLights(): string {
  const W = 122
  const v = buildMacroRiskLightsView()
  const d = v.verdict
  const L: string[] = ['', '═'.repeat(W), `${v.id}｜${v.title}`, '═'.repeat(W)]
  L.push('  本区不打分、不排序、不产生候选、不产生动作。证据等级恒为 OBSERVATION。')
  L.push('  灯永远不是理由。绿灯不开许可，红灯不产生卖出令。')
  L.push(`  ${v.object}`)
  L.push(`  ${v.hypothesis}｜${v.claim}　${v.status}`)
  L.push(`  ${v.pool}　登记于 ${v.loggedOn}　来源：${v.source}`)
  L.push('')
  L.push('  ── 机器结论 ──')
  L.push(`  1. ${d.chain}`)
  L.push(`  2. ${d.wilson}`)
  L.push(`  3. ${d.rotation}`)
  L.push(`  4. ${d.permission}`)
  L.push(`  5. ${d.cash}`)
  L.push(`  6. ${d.mainline}`)
  L.push(`  7. ${d.dataContract}`)
  L.push('')
  L.push('  ── 7100 压力情景三组（触发、结构、时间不能互相替代）──')
  for (const g of v.scenarioGroups) {
    L.push(`  ${g.id}　${g.name}　问：${g.question}`)
    L.push(`      字段：${g.items.join(' / ')}`)
    L.push(`      边界：${g.boundary}`)
  }
  L.push('')
  L.push('  ── Breadth Quality（结构数据，不直接生成买卖指令）──')
  for (const b of v.breadthQuality) {
    L.push(`  ${b.field}　${b.status}`)
    L.push(`      ${b.note}`)
  }
  L.push('  Index Level 与 Breadth Quality 必须拆开：指数新高 ≠ 市场扩散健康。')
  L.push('')
  L.push(`  ── ${v.contractGap.id}　${v.contractGap.status} ──`)
  L.push('  数据缺口：')
  for (const x of v.contractGap.dataGaps) L.push(`    · ${x}`)
  L.push('  规则契约缺口：')
  for (const x of v.contractGap.ruleGaps) L.push(`    · ${x}`)
  L.push(`  边界：${v.contractGap.resolutionBoundary}`)
  L.push('')
  L.push('  ── 风险链条六环（逐环标出本系统能不能读到它）──')
  for (const c of v.chain) {
    L.push(`  ${c.no}. ${c.link}　${c.status}`)
    L.push(`      ${c.note}`)
  }
  L.push('  六环一环未接线。故这套灯今天只能手工读，不能自动判。')
  L.push('')
  L.push('  ── 三灯（原样登记委员会门槛，并写明每盏灯不会做什么）──')
  for (const b of v.bands) {
    L.push(`  ${b.color}　${b.name}`)
    for (const c of b.committeeConditions) L.push(`      条件：${c}`)
    L.push(`      不会：${b.doesNot}`)
  }
  L.push('')
  L.push('  ── 门槛缺陷（一盏会自己打架的灯比没有灯更危险）──')
  for (const s of v.specDefects) {
    L.push(`  ${s.where}`)
    L.push(`      缺陷：${s.defect}`)
    L.push(`      为什么要紧：${s.why}`)
  }
  L.push('')
  L.push('  ── 今日灯态 ──')
  L.push(`  ${v.lightState.state}`)
  L.push(`  ${v.lightState.reading}`)
  L.push(`  ${v.lightState.systemVerdict}`)
  L.push(`  ${v.lightState.why}`)
  L.push('')
  L.push('  ── 外部读数（核得到 ≠ 接进来了，故一律 EXTERNAL_READ_NOT_WIRED）──')
  for (const r of v.readings) {
    L.push(`  ${r.item}　${r.value}　${r.status}`)
    L.push(`      ${r.note}`)
  }
  L.push('')
  L.push('  ── 必须改掉的口径 ──')
  for (const c of v.corrections) L.push(`  · ${c}`)
  L.push('')
  L.push('  ── 换挡方向冲突（不抹平）──')
  L.push(`  Wilson 换出：${v.rotationConflict.wilsonFrom.join(' / ')}`)
  L.push(`  Wilson 换入：${v.rotationConflict.wilsonTo.join(' / ')}`)
  L.push(`  委员会对应到：${v.rotationConflict.committeeMapping.join(' → ')}`)
  L.push(`  发现：${v.rotationConflict.finding}`)
  L.push(`  为什么：${v.rotationConflict.why}`)
  L.push(`  处置：${v.rotationConflict.handling}`)
  L.push('')
  L.push('  ── 「提现金到 18%–20%」的法理审查 ──')
  L.push(`  主张：${v.cashAudit.claim}`)
  L.push(`  ${v.cashAudit.macroIsNotReason}`)
  L.push('  法定通道：')
  for (const x of v.cashAudit.lawfulChannels) L.push(`    · ${x}`)
  L.push(`  ${v.cashAudit.concentrationClaim}`)
  L.push(`  ${v.cashAudit.conclusion}`)
  L.push('')
  L.push('  ── 旧账本组合口径复算（INDICATIVE_ONLY）──')
  L.push(`  输入：${v.accountBasisAudit.inputs.source}`)
  L.push(`  ${v.accountBasisAudit.formula}`)
  L.push(`  修正：${v.accountBasisAudit.correction}`)
  L.push(`  债务估算：${v.accountBasisAudit.debtEstimate}`)
  L.push(`  判定边界：${v.accountBasisAudit.decisionBoundary}`)
  L.push('')
  L.push('  ── 最终状态锁 ──')
  for (const s of v.finalStateLocks) {
    L.push(`  ${s.item}　${s.status}`)
    L.push(`      ${s.boundary}`)
  }
  L.push('')
  L.push('  ── 口径守卫 ──')
  L.push(`  ${v.basisGuard.rule}`)
  L.push(`  ${v.basisGuard.why}`)
  L.push('')
  L.push('  本条成立也不意味着：')
  for (const x of v.doesNotImply) L.push(`    · ${x}`)
  L.push('')
  L.push('  阻塞项：')
  for (const x of v.blockers) L.push(`    · ${x}`)
  L.push('')
  return L.join('\n')
}
