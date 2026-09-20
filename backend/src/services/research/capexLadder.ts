/**
 * 研究层 · C-01 鸿鹄·AI资本开支产业链迁移体检
 *
 * 这一层不生产动作。不改规则。不增加指标。不进入证据链。
 * 不进 DashboardInput。不 import makeAction。证据等级恒为 OBSERVATION。
 *
 * ── 它回答的问题 ──
 *
 * 委员会 2026-09-20 提出 H9-10：AI 算力资本开支是否正在从「核心计算 / 高速互联」
 * 向「连接承载 → 供电散热 → 数据中心基础设施」逐级扩散？
 *
 * 这张表不预测谁涨。它逐层记录：订单 → 收入 → 利润 → 相对强度 → 资金 →
 * 成交额 → 回撤修复，现在究竟走到了哪一层，以及每一列的数据到底拿不拿得到。
 *
 * ── 为什么它不能打开 Capital Permission ──
 *
 * 三道闸门与这张表的任何一列都无关：
 *   ① 执行债务未清偿 → 新增建仓封锁；
 *   ② 一级熔断成立，组合股票上限 50%；
 *   ③ 冻结令：AI 电力基础设施是研究主线，只研究不进组合；不在册标的永不输出为候选。
 *
 * 需求端强化不能推出资本迁移。价格修复不能迁移生命线。
 * 扩散叙事成立，也不等于任何一层获得建仓资格。
 */

import type { EvidenceTier } from '../cockpit/types'

const TIER = 'OBSERVATION' as const
const PUBLIC_NOT_YET_WIRED = 'PUBLIC_NOT_YET_WIRED'
const UNVERIFIED = 'UNVERIFIED'
const MONEY_RADAR_UNAVAILABLE = 'MONEY_RADAR_UNAVAILABLE'

export const CAPEX_LADDER_ID = 'C-01'
export const CAPEX_LADDER_TITLE = '鸿鹄·AI资本开支产业链迁移体检'

/** 比「PCB 接棒光模块」更接近终局的那一句。 */
export const CAPEX_LADDER_OBJECT =
  '研究的不是哪个板块轮到了，而是 AI 算力资本开支有没有逐级落到下一层的订单、收入和利润里。'

export const H910_CLAIM =
  'AI 算力资本开支正在从核心计算与高速互联，向连接承载、供电散热、数据中心基础设施逐级扩散。'

/** 扩散叙事成立，也不能推出任何一层的建仓资格。 */
export function diffusionGrantsPermission(): false {
  return false
}

/** 需求端合同金额不能推出 A 股某一层加仓。 */
export function demandContractsGrantMigration(): false {
  return false
}

/** 回撤修复、均线修复、低点抬高都是价格，不能迁移生命线。 */
export function priceRepairMigratesLifeline(): false {
  return false
}

/** 不在册标的不得被输出为候选，无论产业逻辑多顺。 */
export function notInUniverseCanBeCandidate(): false {
  return false
}

/** 液冷与电源属研究主线，当前不得进组合。 */
export function coolingAndPowerEnterPortfolio(): false {
  return false
}

/** 真实资金流免费源缺失，禁止用价格或成交额代理冒充资金验证。 */
export function moneyRadarWired(): false {
  return false
}

/** 一段视频不得改变仓位。 */
export function videoChangesPosition(): false {
  return false
}

/** 链条断在哪一层，就停在哪一层。 */
export function chainBreakStopsHere(): true {
  return true
}

export type LadderId = 'L1' | 'L2' | 'L3' | 'L4'

export interface CapexLayer {
  id: LadderId
  no: 1 | 2 | 3 | 4
  name: string
  asks: string
  proves: string
  doesNotProve: string
  /** 这一层在本系统里的战略状态 */
  standing: string
}

/**
 * 四层扩散。顺序是资本开支的传导方向，不是买卖顺序。
 * 上一层成立不推出下一层。
 */
export const CAPEX_LAYERS: readonly CapexLayer[] = [
  {
    id: 'L1', no: 1, name: '计算',
    asks: 'AI 芯片、服务器、光模块的订单与出货是否仍在扩张？',
    proves: '算力建设是否还在发生。这是我们六只核心持仓所在的一层。',
    doesNotProve: '不证明下面三层已经接棒，也不证明这一层可以加仓。',
    standing: '作战主线（optical / semi / compute）。持仓集中在此层。',
  },
  {
    id: 'L2', no: 2, name: '连接与承载',
    asks: '交换机、PCB、CCL、封装基板的订单有没有进入收入与利润？',
    proves: '资本开支是否已经落到承载层的报表里。',
    doesNotProve: '单季收入增长不证明主线迁移，也不证明 PCB 已成新主线。',
    standing: '作战主线 compute 内的节点。在册标的有沪电、深南、生益科技、东山精密。',
  },
  {
    id: 'L3', no: 3, name: '供电与散热',
    asks: '液冷、UPS、电源、配电的订单有没有转成可核验的收入与利润？',
    proves: '功率密度上升是否已经变成这一层公司的报表事实。',
    doesNotProve: '不证明可以买液冷或电源。冻结令下这一层不进组合。',
    standing: '研究主线 power：只研究不进组合。E-01 八问仍停在第 1 问。',
  },
  {
    id: 'L4', no: 4, name: '数据中心基础设施',
    asks: '机柜、IDC、电力接入是否形成可核验的中国负荷增量与资本开支？',
    proves: '必须先有中国可核验的负荷增量，才能谈这一层。',
    doesNotProve: '海外算力租金规模不能推出 A 股这一层的加仓资格。',
    standing: '无在册标的。仅研究域覆盖，记为覆盖缺口。',
  },
]

/** 这张梯子不覆盖半导体设备 —— 设备是造芯片的，不是算力扩散的下一层。 */
export const LADDER_DOES_NOT_COVER =
  '半导体设备（北方华创、中微公司）不在这四层上。它们按 semi 主线单独判，不因扩散叙事改变状态。'

export type ColumnState = '可计算' | '可得' | '尚未接入' | '不可得'

export interface ExamColumn {
  no: number
  name: string
  state: ColumnState
  sourceStatus: typeof PUBLIC_NOT_YET_WIRED | typeof MONEY_RADAR_UNAVAILABLE | 'QUOTE' | null
  what: string
  /** 这一列能不能授予资本许可。恒为 false */
  canGrantPermission: false
}

/**
 * 七列体检。诚实地分成三类：尚未接入、可得但不构成资格、根本不可得。
 *
 * 委员会要的是「逐层检查走到哪一层」。那就必须先承认：
 * 七列里只有三列现在真的有数据，而那三列全是价格类。
 */
export const EXAM_COLUMNS: readonly ExamColumn[] = [
  {
    no: 1, name: '订单', state: '尚未接入', sourceStatus: PUBLIC_NOT_YET_WIRED,
    what: '中标、在手订单、客户验证。公开公告有披露，尚未对照原文接入管道。',
    canGrantPermission: false,
  },
  {
    no: 2, name: '收入', state: '尚未接入', sourceStatus: PUBLIC_NOT_YET_WIRED,
    what: '分部收入与主线收入占比。委员会转述的半年报数字不得手抄进系统。',
    canGrantPermission: false,
  },
  {
    no: 3, name: '利润', state: '尚未接入', sourceStatus: PUBLIC_NOT_YET_WIRED,
    what: '扣非利润与毛利。必须扣掉投资收益与非主线贡献，否则归因不成立。',
    canGrantPermission: false,
  },
  {
    no: 4, name: '相对强度', state: '可计算', sourceStatus: 'QUOTE',
    what: '价格相对主线基准。它是价格，不是证据。',
    canGrantPermission: false,
  },
  {
    no: 5, name: '资金', state: '不可得', sourceStatus: MONEY_RADAR_UNAVAILABLE,
    what: '真实资金流免费源缺失。Money Radar 恒为不可得，禁止用价格或成交额代理冒充。',
    canGrantPermission: false,
  },
  {
    no: 6, name: '成交额', state: '可得', sourceStatus: 'QUOTE',
    what: '行情可得。放量只说明有人在交易，不说明谁在买。',
    canGrantPermission: false,
  },
  {
    no: 7, name: '回撤修复', state: '可计算', sourceStatus: 'QUOTE',
    what: '低点抬高与均线修复。它是价格，不能迁移生命线。',
    canGrantPermission: false,
  },
]

export type Standing =
  | '作战主线在册'
  | '研究主线在册'
  | '在册但C级清退'
  | '不在册'

export interface RosterRow {
  name: string
  layer: LadderId
  node: string
  standing: Standing
  /** 是否为当前持仓 */
  held: boolean
  /** 产业证据等级。不在册者无等级 */
  grade: 'S' | 'A' | 'B' | 'C' | null
  verdict: string
}

/**
 * 名单。委员会点名的十六只，逐只标出在册状态。
 *
 * 在册状态是本表最重要的一列 —— 它决定这只股票能不能进入候选流程，
 * 而这与它的产业逻辑多顺、图形多好无关。
 */
export const ROSTER: readonly RosterRow[] = [
  {
    name: '海光信息', layer: 'L1', node: 'CPU/DCU', standing: '作战主线在册', held: true, grade: 'S',
    verdict: '拥有资格成立。扩散叙事不改变它的状态，也不授予加仓。',
  },
  {
    name: '中际旭创', layer: 'L1', node: '光模块', standing: '作战主线在册', held: true, grade: 'S',
    verdict: '拥有资格成立。组合口径未超单票上限，不构成法定减仓理由。',
  },
  {
    name: '新易盛', layer: 'L1', node: '光模块', standing: '作战主线在册', held: true, grade: 'S',
    verdict: '拥有资格成立。组合口径未超单票上限，不构成法定减仓理由。',
  },
  {
    name: '天孚通信', layer: 'L1', node: '光器件/光引擎', standing: '作战主线在册', held: false, grade: 'A',
    verdict: '在册未持仓。扣非口径待中报，S2 盈利验证未完成。',
  },
  {
    name: '沪电股份', layer: 'L2', node: '互连PCB', standing: '作战主线在册', held: true, grade: 'S',
    verdict: '承载层唯一持仓。它属于 compute 主线，不是新主线的证据。',
  },
  {
    name: '深南电路', layer: 'L2', node: '互连PCB', standing: '作战主线在册', held: false, grade: 'A',
    verdict: '在册未持仓，节点与沪电相同。收入兑现须走订单到利润的接入，不能用委员会转述结案。',
  },
  {
    name: '生益科技', layer: 'L2', node: 'CCL材料', standing: '作战主线在册', held: false, grade: 'A',
    verdict: '在册未持仓。CCL 节点份额不低，但 S1、S2 未完成。',
  },
  {
    name: '东山精密', layer: 'L2', node: 'PCB/精密制造', standing: '作战主线在册', held: false, grade: 'B',
    verdict: '在册未持仓。B 级为送样验证档，不足以进入候选。',
  },
  {
    name: '生益电子', layer: 'L2', node: 'PCB', standing: '不在册', held: false, grade: null,
    verdict: '不在册。MSR 永不输出为候选。要进必须先走战略层在册程序。',
  },
  {
    name: '胜宏科技', layer: 'L2', node: 'PCB', standing: '不在册', held: false, grade: null,
    verdict: '不在册。同上。产业逻辑顺不等于可以进流程。',
  },
  {
    name: '澜起科技', layer: 'L2', node: '互连芯片', standing: '在册但C级清退', held: true, grade: 'C',
    verdict: '战略资格已否决，执行债务未清。承载层扩散不能给它翻案。',
  },
  {
    name: '兆易创新', layer: 'L2', node: '存储', standing: '在册但C级清退', held: true, grade: 'C',
    verdict: '战略资格已否决，另有硬止损债未执行。不是小仓观察。',
  },
  {
    name: '英维克', layer: 'L3', node: '液冷', standing: '研究主线在册', held: false, grade: 'B',
    verdict: '在研究主线 power 内。冻结令：只研究不进组合。',
  },
  {
    name: '麦格米特', layer: 'L3', node: 'AI服务器电源', standing: '研究主线在册', held: false, grade: 'B',
    verdict: '同属研究主线。估值分位不可用时不具备候选资格。',
  },
  {
    name: '欧陆通', layer: 'L3', node: 'AI服务器电源', standing: '研究主线在册', held: false, grade: 'B',
    verdict: '同属研究主线。不得因扩散叙事升为作战。',
  },
  {
    name: '高澜股份', layer: 'L3', node: '液冷', standing: '不在册', held: false, grade: null,
    verdict: '不在册。跌完又爬起来是价格，不是资格。MSR 永不输出为候选。',
  },
  {
    name: '同飞股份', layer: 'L3', node: '液冷', standing: '不在册', held: false, grade: null,
    verdict: '不在册。要求「至少 2 只同步」本身也不是在册程序。',
  },
  {
    name: '申菱环境', layer: 'L3', node: '液冷', standing: '不在册', held: false, grade: null,
    verdict: '不在册。同上。',
  },
  {
    name: '科士达', layer: 'L3', node: 'UPS/数据中心电源', standing: '不在册', held: false, grade: null,
    verdict: '不在册。UPS 节点在研究域已记为无在册标的。',
  },
  {
    name: '科华数据', layer: 'L3', node: 'UPS/数据中心电源', standing: '不在册', held: false, grade: null,
    verdict: '不在册。同上。',
  },
]

export interface DemandEvidence {
  item: string
  figure: string
  sourceStatus: typeof PUBLIC_NOT_YET_WIRED | typeof UNVERIFIED
  note: string
}

/**
 * 需求端证据。公开材料有披露，尚未接入管道，故一律 PUBLIC_NOT_YET_WIRED。
 *
 * 它只能证明「算力正在被当成可直接购买的生产资料」。
 * 它不能证明 A 股任何一层可以加仓。
 */
export const DEMAND_EVIDENCE: readonly DemandEvidence[] = [
  {
    item: 'Anthropic 算力合同',
    figure: '约 12.5 亿美元/月，至 2029 年 5 月，约 32.5 万张 NVIDIA GPU',
    sourceStatus: PUBLIC_NOT_YET_WIRED,
    note: '初始三个月后任一方可提前 90 天通知终止。名义多年，实际可退出。',
  },
  {
    item: 'Google 算力合同',
    figure: '约 9.2 亿美元/月，自 2026 年 10 月起',
    sourceStatus: PUBLIC_NOT_YET_WIRED,
    note: '附交付条件与终止条款，不是无条件锁定。',
  },
  {
    item: 'Reflection AI 算力合同',
    figure: '约 1.5 亿美元/月',
    sourceStatus: PUBLIC_NOT_YET_WIRED,
    note: '规模最小的一笔，同样附退出条款。',
  },
  {
    item: '另一笔未披露客户合同',
    figure: '约 11.1 亿美元/月，自 2026 年 12 月 1 日起，年化约 133 亿美元',
    sourceStatus: PUBLIC_NOT_YET_WIRED,
    note: '交易对手未披露。未披露对手方的合同不得当成已确认需求。',
  },
  {
    item: '合计算力租赁年化跑数',
    figure: '四笔合计约 34.3 亿美元/月，年化约 411 亿美元',
    sourceStatus: PUBLIC_NOT_YET_WIRED,
    note: '这是年化跑数，不是已实现的年度收入；四笔要到 12 月才同时在跑。',
  },
  {
    item: '轨道算力',
    figure: '尚未核到一手材料',
    sourceStatus: UNVERIFIED,
    note: '轨道算力按未验证处理，不与已产生租金的地面数据中心混为一谈。',
  },
]

/** 视频与转述里必须改掉的三处口径。 */
export const DEMAND_CORRECTIONS = [
  '「已经达到 411 亿美元/年」应改为「年化跑数约 411 亿美元」。四笔合同要到 2026 年 12 月才同时计费，年化跑数不等于已实现年收入。',
  '合同久期不能按名义年限读。CFO 自述结构是 90 天承诺加 90 天退出，约等于半年承诺；Anthropic 那笔也在初始三个月后可提前 90 天终止。',
  'GPU 口径两说并存（约 22 万与约 32.5 万），公开材料未对齐。不得用月费除以 GPU 数推算单价，那会高估已披露的内容。',
] as const

export const C01_DOES_NOT_IMPLY = [
  '不意味着 PCB 已经接棒光模块',
  '不意味着液冷或电源已经形成独立主线',
  '不意味着可以买高澜、同飞、申菱、科士达、科华、生益电子、胜宏',
  '不意味着深南、生益科技、东山精密获得建仓资格',
  '不意味着英维克、麦格米特、欧陆通可以从研究主线升为作战主线',
  '不意味着海外算力租金规模可以推出 A 股任何一层加仓',
  '不意味着低点抬高与均线修复构成资本迁移证据',
  '不意味着可以打开任何一部分 Capital Permission',
  '不意味着组合集中在第一层就必须减仓 —— 跑输不是法定理由',
  '不改 V4.x。不加 V5。本层不发令。',
] as const

export const C01_BLOCKERS = [
  '执行债务未清偿 → 新增建仓封锁。研究结论不能绕过它。',
  '一级熔断成立，组合股票上限 50%，当前贴线 → 没有可分配的新资本。',
  '冻结令：AI 电力基础设施是研究主线，只研究不进组合 → 第三层整层不可建仓。',
  '不在册标的永不输出为候选 → 第三层多数点名标的连流程都进不去。',
  '七列体检里订单、收入、利润三列尚未接入；资金列恒为不可得 → 迁移无法被证据确认。',
] as const

export interface BasisGuard {
  rule: string
  why: string
}

/** 仓位百分比的口径守卫。券商口径不参与上限判定。 */
export const BASIS_GUARD: BasisGuard = {
  rule: '本表不写任何仓位百分比。要读集中度，一律用组合口径，不用券商账户口径。',
  why:
    '券商口径把账户外股票资金排除在分母外，会把同一笔持仓算出高得多的百分比，'
    + '从而凭空造出「集中度过高必须减仓」的结论。委员会 2026-08-15 已裁定上限一律用组合口径。',
}

export const C01 = {
  id: CAPEX_LADDER_ID,
  title: CAPEX_LADDER_TITLE,
  claim: H910_CLAIM,
  object: CAPEX_LADDER_OBJECT,
  source: '委员会 2026-09-20 产业层证据登记',
  loggedOn: '2026-09-20',
  pool: '战略观察池',
  hypothesis: 'H9-10',
  status: 'OPEN' as const,
  tier: TIER as EvidenceTier,
  doesNotImply: C01_DOES_NOT_IMPLY,
  blockers: C01_BLOCKERS,
}

export interface CapexVerdict {
  object: string
  diffusion: string
  demand: string
  permission: string
  firstCurve: string
}

export function capexVerdict(): CapexVerdict {
  return {
    object: CAPEX_LADDER_OBJECT,
    diffusion:
      '扩散只走到叙事与价格。第二层有在册标的但订单、收入、利润三列尚未接入；'
      + '第三层整层属研究主线；第四层无在册标的。链条停在第二层的报表接入上。',
    demand:
      '需求端记为值得跟踪：算力已经像基础设施商品一样被按月出租。'
      + '但合同可退出、年化跑数不等于已实现收入、GPU 口径未对齐，'
      + '且需求强化从来不能推出资本迁移。',
    permission:
      'Capital Permission 不开。理由不是价格不好，而是三道闸门：'
      + '执行债务未清、一级熔断贴线、第三层与不在册标的不具备流程资格。',
    firstCurve:
      '继续守第一曲线。守的理由是六只核心的拥有资格仍然成立，'
      + '不是因为第二第三层不好。组合集中在第一层而阶段性跑输，不是法定减仓理由。',
  }
}

export function buildCapexLadderView() {
  return {
    ...C01,
    layers: CAPEX_LAYERS,
    doesNotCover: LADDER_DOES_NOT_COVER,
    columns: EXAM_COLUMNS,
    roster: ROSTER,
    demand: DEMAND_EVIDENCE,
    corrections: DEMAND_CORRECTIONS,
    basisGuard: BASIS_GUARD,
    verdict: capexVerdict(),
    flags: {
      diffusionGrantsPermission: diffusionGrantsPermission(),
      demandContractsGrantMigration: demandContractsGrantMigration(),
      priceRepairMigratesLifeline: priceRepairMigratesLifeline(),
      notInUniverseCanBeCandidate: notInUniverseCanBeCandidate(),
      coolingAndPowerEnterPortfolio: coolingAndPowerEnterPortfolio(),
      moneyRadarWired: moneyRadarWired(),
      videoChangesPosition: videoChangesPosition(),
      chainBreakStopsHere: chainBreakStopsHere(),
    },
  }
}

export function renderCapexLadder(): string {
  const W = 122
  const v = buildCapexLadderView()
  const d = v.verdict
  const L: string[] = ['', '═'.repeat(W), `${v.id}｜${v.title}`, '═'.repeat(W)]
  L.push('  本区不打分、不排序、不产生候选、不产生动作。证据等级恒为 OBSERVATION。')
  L.push(`  ${v.object}`)
  L.push(`  ${v.hypothesis}｜${v.claim}　${v.status}`)
  L.push(`  ${v.pool}　登记于 ${v.loggedOn}　来源：${v.source}`)
  L.push('')
  L.push('  ── 机器结论 ──')
  L.push(`  1. ${d.diffusion}`)
  L.push(`  2. ${d.demand}`)
  L.push(`  3. ${d.permission}`)
  L.push(`  4. ${d.firstCurve}`)
  L.push('')
  L.push('  ── 四层扩散（上一层成立不推出下一层；断在哪一层就停在哪一层）──')
  for (const layer of v.layers) {
    L.push(`  ${layer.id}　${layer.no}. ${layer.name}　问：${layer.asks}`)
    L.push(`      能证明：${layer.proves}`)
    L.push(`      推不出：${layer.doesNotProve}`)
    L.push(`      当前状态：${layer.standing}`)
  }
  L.push(`  不覆盖：${v.doesNotCover}`)
  L.push('')
  L.push('  ── 七列体检（每一列都不能授予资本许可）──')
  for (const c of v.columns) {
    const src = c.sourceStatus === null ? '' : `　${c.sourceStatus}`
    L.push(`  ${c.no}. ${c.name}　${c.state}${src}`)
    L.push(`      ${c.what}`)
  }
  L.push('  七列里只有相对强度、成交额、回撤修复三列现在有数据，而这三列全是价格类。')
  L.push('  订单、收入、利润尚未接入；资金恒为不可得。故迁移当前无法被证据确认。')
  L.push('')
  L.push('  ── 名单（在册状态决定能不能进流程，与产业逻辑是否顺无关）──')
  for (const layer of v.layers) {
    const rows = v.roster.filter(r => r.layer === layer.id)
    if (rows.length === 0) {
      L.push(`  ${layer.id} ${layer.name}　无点名标的`)
      continue
    }
    L.push(`  ${layer.id} ${layer.name}`)
    for (const r of rows) {
      const grade = r.grade === null ? '无等级' : `${r.grade}级`
      L.push(`      ${r.name}　${r.node}　${r.standing}　${grade}　${r.held ? '持仓' : '未持仓'}`)
      L.push(`          ${r.verdict}`)
    }
  }
  L.push('')
  L.push('  ── 需求端证据（公开有披露，尚未接入管道）──')
  for (const x of v.demand) {
    L.push(`  ${x.item}　${x.figure}　${x.sourceStatus}`)
    L.push(`      ${x.note}`)
  }
  L.push('')
  L.push('  ── 必须改掉的口径 ──')
  for (const c of v.corrections) L.push(`  · ${c}`)
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
