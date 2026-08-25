/**
 * AI 第二阶段观察。
 *
 * 委员会 2026-08-25：现在的市场不是「AI 逻辑结束」，
 * 而是「AI 硬件第一阶段的估值体系正在被强制重估」。
 *
 * 心态不是恐慌清仓，也不是大家都在骂所以满仓抄底。
 * 是四个字：去弱留强，等证据。
 *
 * 去弱：证据恶化或根本理由消失，才走已冻结的战术减仓 / 价值退出。
 * 留强：报表已兑现、订单可见的，不因暴跌自动否定 Ownership。
 * 等证据：46.5 万现金的价值不是现在赚钱，而是等待信息优势。
 *
 * 本模块不生产动作，不进规则指纹，不进入 DashboardInput。
 * tier 恒为 OBSERVATION。不 import makeAction。不改 V4.x。
 * 禁止九维评分。禁止把情绪当成底部确认。
 */

import type { EvidenceTier } from '../cockpit/types'

export const PHASE_TWO_ID = 'P2-01'
export const PHASE_TWO_TITLE = '鸿鹄·AI 第二阶段观察'

export const PHASE_TWO_OBJECT =
  '不是 AI 结束，而是 AI 第一阶段「GPU → 光模块 → 服务器」的单一高景气交易，'
  + '正在向「AI 基础设施全产业链重新分配利润」的第二阶段切换。'

export const PHASE_TWO_CLAIM =
  '真正该研究的是分化，不是今天到底是不是底。'
  + '问题已经不是看不看好 AI，而是太多筹码压在同一个 AI 硬件风险因子上。'

/** 情绪极端不是底部确认。 */
export function emotionIsBottomConfirmation(): false {
  return false
}

/** 3800 点不是底。 */
export function indexLevelIsBottom(): false {
  return false
}

/** 跌这么多了所以该反弹：不是可执行判断。 */
export function dropMeansRebound(): false {
  return false
}

/** 恐慌清仓不是动作。 */
export function panicExitAll(): false {
  return false
}

/** 大家都在骂所以满仓抄底：不是动作。 */
export function crowdFearIsBuySignal(): false {
  return false
}

/** 英伟达跌了，不能把光模块和纯概念 AI 放进同一个篮子。 */
export function nvidiaDropMakesOpticsEqualsConcept(): false {
  return false
}

/** 九维评分不是鸿鹄。 */
export function nineDimensionScoreIsHonghu(): false {
  return false
}

/** 股价弱于板块不是卖出令。 */
export function priceWeakerThanSectorIsSell(): false {
  return false
}

/** 砍跌得最多的：不是规则。 */
export function cutTheBiggestLoser(): false {
  return false
}

/** 英伟达财报落地前，现金弹药不得部署。 */
export function cashMayDeployBeforeNvidiaEvidence(): false {
  return false
}

/** 机器人不是下一只中际旭创。 */
export function robotIsNextZhongji(): false {
  return false
}

/** 市场热点不能把第二阶段直接送进资本池。 */
export function phaseTwoHeatEntersCapitalPool(): false {
  return false
}

/** H-P2 不得进入证据链，直到出现独立证据。 */
export function hp2MayEnterEvidenceChain(): false {
  return false
}

/** 本层不得发买卖令，也不得改 V4.x。 */
export function phaseTwoMayIssueAction(): false {
  return false
}

export const HP2 = {
  id: 'H-P2',
  title: 'H-P2',
  claim: PHASE_TWO_OBJECT,
  status: 'OBSERVATION' as const,
  mayEnterEvidenceChain: false as const,
  whyNot:
    '可以观察，但不能进入鸿鹄证据链，直到找到独立证据。'
    + '产业资本开支继续增长，不推出当前硬件估值不会被压缩。'
    + '也不推出电力、基础设施、具身智能已经获得建仓资格。',
}

export type AiLayerId = 'BRAIN' | 'NERVE' | 'BODY' | 'MEMORY' | 'EMBODIED'

export interface AiLayer {
  no: 1 | 2 | 3 | 4 | 5
  id: AiLayerId
  name: string
  asks: string
  proves: string
  doesNotProve: string
  focus: boolean
}

/**
 * 五层拆解。顺序是研究顺序，不是买卖名单，也不是评分。
 * 第三层身体（电力与数据中心）是当前最看重的观察层，对接 E-01。
 */
export const AI_LAYERS: readonly AiLayer[] = [
  {
    no: 1, id: 'BRAIN', name: '算力大脑',
    asks: 'GPU / ASIC / CPU / NPU 的资本开支，有没有被估值提前透支？',
    proves: '这一层最容易出现技术迭代 → 资本开支 → 估值提前透支。是最容易被强制重估的一层。',
    doesNotProve: '不证明 AI 需求消失。也不证明海光或任何国产芯片现在可以加仓。',
    focus: false,
  },
  {
    no: 2, id: 'NERVE', name: '算力神经网络',
    asks: '光模块、光互联、交换机、CPO 的增长，有没有进入报表，而不是停在故事？',
    proves: '故事和已经进报表的主线盈利必须分开。这一层目前是「报表已兑现」的观察对象。',
    doesNotProve: '不证明英伟达跌了也要把中际、新易盛清掉。更不证明可以无差别加仓。',
    focus: true,
  },
  {
    no: 3, id: 'BODY', name: 'AI 的身体：电力与数据中心',
    asks: '算力继续增长时，电网、变压器、配电、液冷、机房、电力接入是不是正在变成上游瓶颈？',
    proves: 'GPU 可以一年一代；电网和接入扩不了这么快。电力可能从外围变成瓶颈资产。',
    doesNotProve: '不证明现在可以买任何电力股。E-01 仍停在战略观察池，不得建仓。',
    focus: true,
  },
  {
    no: 4, id: 'MEMORY', name: '存储',
    asks: 'AI 服务器成本结构里，HBM / DRAM / SSD 的利润池有没有在重新分配？',
    proves: 'AI 服务器不是只有 GPU。硬件内部可以分化，而不必整个科技板块一起跌。',
    doesNotProve: '不证明存储已经是第二主线，也不证明可以买存储股。',
    focus: false,
  },
  {
    no: 5, id: 'EMBODIED', name: '具身智能',
    asks: '机器人是不是已经从机械自动化，走到算力加大脑？',
    proves: '传统零部件框架不够用。要按大脑 / 神经 / 小脑 / 肌肉 / 皮肤 / 身体重拆。',
    doesNotProve: '不证明机器人等于下一只中际旭创。不理解的东西不能成为战略核心。',
    focus: false,
  },
]

export interface RobotPart {
  no: number
  name: string
  covers: string
}

/** 具身智能拆解。不是买卖名单。 */
export const ROBOT_PARTS: readonly RobotPart[] = [
  { no: 1, name: '大脑', covers: 'AI 芯片 / 推理 / 训练 / 模型' },
  { no: 2, name: '神经', covers: '高速通信 / 传感器 / 控制' },
  { no: 3, name: '小脑', covers: '运动控制 / 伺服 / 控制器' },
  { no: 4, name: '肌肉', covers: '电机 / 减速器 / 丝杠 / 执行器' },
  { no: 5, name: '皮肤', covers: '视觉 / 力觉 / 触觉' },
  { no: 6, name: '身体', covers: '结构件 / 机身 / 电池' },
]

export type RecheckBand = '兑现观察' | '待验证' | '证据恶化才审查'

export interface HoldingRecheck {
  name: string
  band: RecheckBand
  asks: string
  sourceNote: string
}

/**
 * 现有持仓重新核验。不是 A/B/C 评分，不是买卖名单。
 * 跌得多不是砍仓理由。真正坏掉才走已冻结的减仓 / 退出。
 */
export const HOLDING_RECHECKS: readonly HoldingRecheck[] = [
  {
    name: '中际旭创',
    band: '兑现观察',
    asks: '半年报是否仍是主线盈利进入报表，而不是故事？订单能见度有没有被独立证据核验？',
    sourceNote: '委员会转述 2026 半年报：营收约 417.78 亿，归母净利约 136.51 亿。PUBLIC_NOT_YET_WIRED，不得写成 MET。',
  },
  {
    name: '新易盛',
    band: '兑现观察',
    asks: '半年报有没有出现最担心的业绩坍塌？高速率光模块是不是仍是增长核心？',
    sourceNote: '委员会转述 2026 上半年：营收约 209.1 亿，同比约 +100.34%；归母净利约 75.29 亿，同比约 +90.98%。未接入管道。',
  },
  {
    name: '海光信息',
    band: '待验证',
    asks: '不是国产替代是不是大方向，而是未来两到三个季度的利润增长，是否足以消化现在的估值？',
    sourceNote: '这是 R4 语言。两端缺失则 UNKNOWN。不能用 PE 或股价跌幅填。',
  },
  {
    name: '澜起科技',
    band: '待验证',
    asks: '互联芯片证据独立，推不出股价独立。利润增长能不能消化估值，仍是未验证。',
    sourceNote: '与海光同属算力硬件风险因子。待验证 ≠ 现在卖。',
  },
  {
    name: '北方华创',
    band: '证据恶化才审查',
    asks: '设备订单证据有没有恶化到足以改变 Ownership？价格弱于板块只触发复核。',
    sourceNote: '审查走已冻结路径：证据恶化 → 战术减仓；根本理由消失 → 价值退出。',
  },
  {
    name: '中微公司',
    band: '证据恶化才审查',
    asks: '公司盈利兑现有没有转坏？没有新事实则 Ownership 不变。',
    sourceNote: '规范读法仍是核心 + 强化 + 维持。暴跌不是卖出令。',
  },
]

export const THREE_CHECKS = [
  { no: 1, name: '主线归因', asks: '利润有多少可核验为此主线贡献，而不是公司总利润在涨？' },
  { no: 2, name: '盈利兑现', asks: '收入、利润、订单有没有进入报表，而不是停在故事？' },
  { no: 3, name: '趋势强度', asks: '这是复核信息。价格弱于板块、成交下降，不能单独产生卖出。' },
] as const

export interface PublicTrace {
  id: string
  statement: string
  status: 'UNVERIFIED'
  sourceNote: string
}

export const PORTFOLIO_TRACES: readonly PublicTrace[] = [
  {
    id: 'BOOK',
    statement: '总资产约 298.3 万，股票约 251.8 万，现金约 46.5 万，仓位约 84.4%。',
    status: 'UNVERIFIED',
    sourceNote: '2026-08-25 委员会截图留痕。不是今日实时 MET。',
  },
  {
    id: 'PNL',
    statement: '总浮亏约 47.85 万，当日约亏 11.56 万。账户跌约 3.7%，与持仓同步并不奇怪。',
    status: 'UNVERIFIED',
    sourceNote: '账面亏损不是卖出理由。鸿鹄防的是永久性资本损失。',
  },
  {
    id: 'FACTOR',
    statement: '通信 + 电子约 84.5%。新易盛约 17.6%，中际约 17.8%，海光约 19.6%，澜起约 8.5%，北方华创约 7.2%，中微约 7.3%。',
    status: 'UNVERIFIED',
    sourceNote: '这不是分散组合，是 AI 算力硬件大组合。证据独立不等于股价独立。',
  },
]

export const EVENT_TRACES: readonly PublicTrace[] = [
  {
    id: 'NVDA_PRINT',
    statement: '英伟达将在 2026-08-26 美股盘后公布财报。委员会转述：市场预期季度收入约 921.8 亿美元，下季收入或超过 1040 亿美元。',
    status: 'UNVERIFIED',
    sourceNote: '最大的定价事件尚未发生。PUBLIC_NOT_YET_WIRED。财报本身仍要对照原文。',
  },
  {
    id: 'NVDA_OPT',
    statement: '期权市场给出大约正负 5% 到 6% 的财报波动预期。',
    status: 'UNVERIFIED',
    sourceNote: '波动预期不是买卖令，更不是底部确认。',
  },
]

export const NVIDIA_SCENARIOS = [
  {
    id: 'BEAT_AND_GUIDE',
    name: '业绩超预期且指引上调',
    means: '若 AI 资本开支、云厂商回报、下一代订单、GPU 需求、融资风险同时没有恶化，主线可能仍在。',
    not: '不是所有 AI 股票一起买。优先看已经兑现利润、订单能见度高、估值没有完全透支的，而且仍须新的合法迁移证据。',
  },
  {
    id: 'BEAT_BUT_DOWN',
    name: '业绩很好但股价继续跌',
    means: '市场在交易预期差。这在提示 AI 硬件估值中枢可能下降，不是坏到需求消失。',
    not: '不能马上抄底。等事实：龙头止跌、板块缩量、再谈是否出现新的独立证据。价格稳不是加仓许可。',
  },
  {
    id: 'MISS_AND_CUT',
    name: '业绩不及预期或指引明显下降',
    means: '若同时出现资本开支下降与 GPU 需求下降，必须承认硬件第一主线可能进入周期拐点。',
    not: '不要幻想利空出尽。组合必须走已冻结的降暴露 / 战术减仓 / 价值退出，不是等反弹。',
  },
] as const

export const NEXT_WATCH = [
  { no: 1, text: '先保住现金弹药。这笔钱现在的价值是等待信息优势。' },
  { no: 2, text: '等英伟达财报验证 AI 总需求。事件落地前不得把转述当成兑现。' },
  { no: 3, text: '对现有持仓做主线归因、盈利兑现、趋势强度三问核验。不是九维评分。' },
  { no: 4, text: '砍掉真正已经坏掉的，不是简单砍跌得最多的。坏掉走已冻结路径。' },
  { no: 5, text: '释放出来的研究注意力，看电力 / 基础设施 / 具身智能，而不是无差别加仓 AI 硬件。' },
] as const

export const P2_DOES_NOT_IMPLY = [
  '不意味着 AI 逻辑结束，或现在应该恐慌清仓',
  '不意味着大家都在骂、情绪极差、或 3800 点就是底',
  '不意味着跌这么多了所以该反弹、该抄底',
  '不意味着英伟达跌了，中际和新易盛就等于纯概念 AI',
  '不意味着可以动用约 46.5 万现金去抢反弹',
  '不意味着九维评分，或对本层做任何打分排序',
  '不意味着股价弱于板块就必须卖',
  '不意味着机器人是下一只中际旭创',
  '不意味着电力、存储、具身智能获得建仓资格',
  '不意味着 H-P2 已进入证据链，或本层可以发买卖令',
  '不意味着改写 V4.x，或削弱战术减仓和价值退出',
] as const

export const P2_BLOCKERS = [
  '英伟达财报尚未对照原文落地。停在等待信息优势。',
  '截图仓位、半年报数字、收入预期都是委员会转述，PUBLIC_NOT_YET_WIRED。',
  'H-P2 尚无独立证据，不得进入鸿鹄证据链。',
  '第三层电力仍对接 E-01：战略观察池，不得建仓。',
  '本层不产生动作。去弱留强走已冻结的 Ownership / Evidence / Exposure。',
] as const

export const P2 = {
  id: PHASE_TWO_ID,
  title: PHASE_TWO_TITLE,
  claim: PHASE_TWO_CLAIM,
  object: PHASE_TWO_OBJECT,
  stance: '去弱留强，等证据。',
  source: '委员会 2026-08-25 AI 第二阶段裁定',
  loggedOn: '2026-08-25',
  pool: '阶段观察',
  stage: 1,
  tier: 'OBSERVATION' as EvidenceTier,
  doesNotImply: P2_DOES_NOT_IMPLY,
  blockers: P2_BLOCKERS,
}

export interface PhaseTwoQuestion {
  no: number
  asks: string
  status: 'UNVERIFIED'
  sourceNote: string
}

export const PHASE_TWO_QUESTIONS: readonly PhaseTwoQuestion[] = [
  {
    no: 1,
    asks: '这是 AI 需求消失，还是硬件第一阶段估值被强制重估？',
    status: 'UNVERIFIED',
    sourceNote: '当前主张是后者。在英伟达财报与独立订单证据落地前，不得写成已验证。',
  },
  {
    no: 2,
    asks: '组合是不是仍然把过多资本暴露在同一个 AI 硬件因子上？',
    status: 'UNVERIFIED',
    sourceNote: '2026-08-25 截图样本：通信加电子约 84.5%。数字未接入实时管道。',
  },
  {
    no: 3,
    asks: '光模块半年报有没有继续进入报表，而不是跟着英伟达股价一起被否定？',
    status: 'UNVERIFIED',
    sourceNote: '转述很强，仍须对照原文。转述成立也不推出加仓。',
  },
  {
    no: 4,
    asks: '海光、澜起未来两到三个季度的利润，是否足以消化估值？',
    status: 'UNVERIFIED',
    sourceNote: '这是 R4。不能用国产替代叙事或股价跌幅填。',
  },
  {
    no: 5,
    asks: '电力与数据中心有没有从外围变成可验证的上游瓶颈？',
    status: 'UNVERIFIED',
    sourceNote: '对接 E-01。链条断在哪一层就停在哪一层。',
  },
  {
    no: 6,
    asks: '具身智能有没有独立证据，还是仍是市场热度？',
    status: 'UNVERIFIED',
    sourceNote: '不理解的东西不能成为战略核心。先问是不是主线，再进 Evidence。',
  },
]

export interface PhaseTwoVerdict {
  object: string
  stance: string
  cash: string
  split: string
  after: string
}

export function phaseTwoVerdict(): PhaseTwoVerdict {
  return {
    object: PHASE_TWO_OBJECT,
    stance:
      '去弱留强，等证据。不去赌跌这么多了肯定该反弹。'
      + '情绪可以靠近底部附近，但情绪不是底部确认信号。',
    cash:
      '约 46.5 万现金暂时不动。不是看空，是这笔钱现在的价值是等待信息优势。'
      + '数字是截图留痕，不是今日 MET。',
    split:
      'AI 不是一个东西。大脑最容易被估值重估；神经层要看报表；'
      + '身体层（电力）是当前最想研究的；存储看利润池再分配；具身智能要重拆，不是下一只中际。',
    after:
      '财报之后只看三个情景模板，没有一个会自动买卖。'
      + '真正该升级的是组合结构：大脑 / 神经 / 电力 / 基础设施 / 具身智能 / 现金，而不是继续找第 15 只硬件股。',
  }
}

export function buildAiPhaseTwoView() {
  return {
    ...P2,
    hai: HP2,
    layers: AI_LAYERS,
    robotParts: ROBOT_PARTS,
    rechecks: HOLDING_RECHECKS,
    threeChecks: THREE_CHECKS,
    portfolioTraces: PORTFOLIO_TRACES,
    eventTraces: EVENT_TRACES,
    scenarios: NVIDIA_SCENARIOS,
    nextWatch: NEXT_WATCH,
    questions: PHASE_TWO_QUESTIONS,
    verdict: phaseTwoVerdict(),
    flags: {
      emotionIsBottomConfirmation: emotionIsBottomConfirmation(),
      indexLevelIsBottom: indexLevelIsBottom(),
      dropMeansRebound: dropMeansRebound(),
      panicExitAll: panicExitAll(),
      crowdFearIsBuySignal: crowdFearIsBuySignal(),
      nvidiaDropMakesOpticsEqualsConcept: nvidiaDropMakesOpticsEqualsConcept(),
      nineDimensionScoreIsHonghu: nineDimensionScoreIsHonghu(),
      priceWeakerThanSectorIsSell: priceWeakerThanSectorIsSell(),
      cutTheBiggestLoser: cutTheBiggestLoser(),
      cashMayDeployBeforeNvidiaEvidence: cashMayDeployBeforeNvidiaEvidence(),
      robotIsNextZhongji: robotIsNextZhongji(),
      phaseTwoHeatEntersCapitalPool: phaseTwoHeatEntersCapitalPool(),
      hp2MayEnterEvidenceChain: hp2MayEnterEvidenceChain(),
      phaseTwoMayIssueAction: phaseTwoMayIssueAction(),
    },
  }
}

export function renderAiPhaseTwo(): string {
  const W = 122
  const v = phaseTwoVerdict()
  const L: string[] = ['', '═'.repeat(W), PHASE_TWO_TITLE, '═'.repeat(W)]
  L.push('  本区不打分、不排序、不产生候选、不产生动作。证据等级恒为 OBSERVATION。')
  L.push(`  ${PHASE_TWO_OBJECT}`)
  L.push(`  ${P2.id}｜${P2.pool}　${P2.stance}　登记于 ${P2.loggedOn}`)
  L.push(`  ${PHASE_TWO_CLAIM}`)
  L.push(`  来源：${P2.source}`)
  L.push('')
  L.push('  ── 机器结论 ──')
  L.push(`  1. ${v.object}`)
  L.push(`  2. ${v.stance}`)
  L.push(`  3. ${v.cash}`)
  L.push(`  4. ${v.split}`)
  L.push(`  5. ${v.after}`)
  L.push('')
  L.push('  ── 五层拆解（不是买卖名单）──')
  for (const layer of AI_LAYERS) {
    L.push(`  ${layer.focus ? '▶' : ' '} ${layer.no}. ${layer.name}　问：${layer.asks}`)
    L.push(`      能证明：${layer.proves}`)
    L.push(`      推不出：${layer.doesNotProve}`)
  }
  L.push('')
  L.push('  ── 具身智能重拆（不是下一只中际旭创）──')
  for (const p of ROBOT_PARTS) L.push(`  ${p.no}. ${p.name}　${p.covers}`)
  L.push('')
  L.push('  ── 现有持仓核验带（不是评分）──')
  for (const r of HOLDING_RECHECKS) {
    L.push(`  · [${r.band}] ${r.name}`)
    L.push(`      ${r.asks}`)
    L.push(`      ${r.sourceNote}`)
  }
  L.push('')
  L.push('  ── 三问核验（取代所谓九维评分）──')
  for (const c of THREE_CHECKS) L.push(`  ${c.no}. ${c.name}　${c.asks}`)
  L.push('')
  L.push('  ── 截图留痕与事件（PUBLIC_NOT_YET_WIRED）──')
  for (const t of [...PORTFOLIO_TRACES, ...EVENT_TRACES]) {
    L.push(`  · ${t.statement}`)
    L.push(`      ${t.sourceNote}`)
  }
  L.push('')
  L.push('  ── 财报之后的三个情景模板（没有一个会自动买卖）──')
  for (const s of NVIDIA_SCENARIOS) {
    L.push(`  · ${s.name}`)
    L.push(`      ${s.means}`)
    L.push(`      不是：${s.not}`)
  }
  L.push('')
  L.push(`  ── ${HP2.title}（只观察，不进证据链）──`)
  L.push(`  ${HP2.claim}`)
  L.push(`  进入证据链：否。${HP2.whyNot}`)
  L.push('')
  L.push('  ── 六问（停在最早一个未完成的问题）──')
  for (const q of PHASE_TWO_QUESTIONS) {
    const cur = q.no === P2.stage
    L.push(`  ${cur ? '▶' : ' '} ${q.no}. ${q.asks}　${q.status}${cur ? '  ← 当前停在此问' : ''}`)
    L.push(`      ${q.sourceNote}`)
  }
  L.push('')
  L.push('  ── 下一步只观察，不发令 ──')
  for (const n of NEXT_WATCH) L.push(`  ${n.no}. ${n.text}`)
  L.push('')
  L.push('  本条成立也不意味着：')
  for (const d of P2.doesNotImply) L.push(`    · ${d}`)
  L.push('')
  L.push('  阻塞项：')
  for (const b of P2.blockers) L.push(`    · ${b}`)
  L.push('')
  return L.join('\n')
}
