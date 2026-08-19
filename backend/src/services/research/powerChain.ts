/**
 * 电力主线价值传导图。
 *
 * 委员会 2026-08-19：电力若进入战略观察池，研究的不是「电力行业会不会涨」，
 * 也不是「买电力股」。研究的是：
 *
 *   AI 时代中国电力资本开支周期
 *
 * 本模块不生产动作，不进规则指纹，不进入 DashboardInput。
 * tier 恒为 OBSERVATION。不 import makeAction。
 *
 * 链条在哪一层断，就停在哪一层。AI 耗电只能证明需求端。
 */

import type { EvidenceTier } from '../cockpit/types'

export const POWER_CHAIN_ID = 'E-01'
export const POWER_CHAIN_TITLE = '鸿鹄·电力主线价值传导图'

/** 比「买电力股」更接近终局的那一句。 */
export const POWER_OBJECT =
  '电力如果成为第二主线，研究的不是电力行业，而是 AI 时代中国电力资本开支周期。'

export const E01_CLAIM =
  'AI、高端制造、电气化和新能源并网，推动中国电力系统进入持续扩容和升级周期。'

/** 需求强化不能推出资本迁移。 */
export function demandGrowthIsBuySignal(): false {
  return false
}

/** AI 负荷（含海外 8GW 故事）不能授予任何公司加仓资格。 */
export function aiLoadCanGrantMigration(): false {
  return false
}

/** 美国缺电模板不能套到中国 A 股。 */
export function usShortageTemplateAppliesToChina(): false {
  return false
}

/** 中国进入全面缺电周期：当前不得写出。 */
export function chinaNationalShortageEstablished(): false {
  return false
}

/** 用电量增长不能推出发电公司利润爆发。 */
export function generationProfitFollowsDemand(): false {
  return false
}

/** 穿透不得从发电开始。 */
export function generationIsFirstPenetration(): false {
  return false
}

/** 现在不得把任何电力公司升到核心持仓。 */
export function openPowerCoreNow(): false {
  return false
}

/** 链条断在哪，就停在哪。 */
export function chainBreakStopsHere(): true {
  return true
}

export type LayerId =
  | 'DEMAND'
  | 'GENERATION'
  | 'GRID'
  | 'GRID_EQUIPMENT'
  | 'FLEXIBILITY'
  | 'AIDC_POWER'

export interface PowerLayer {
  no: 1 | 2 | 3 | 4 | 5 | 6
  id: LayerId
  name: string
  asks: string
  /** 这一层能证明什么，以及证明的边界 */
  proves: string
  /** 这一层明确推不出什么 */
  doesNotProve: string
  focus: boolean
}

/**
 * 六层传导。第三层电网是当前最看重的一层。
 * 顺序是传导方向，不是买卖顺序。
 */
export const POWER_LAYERS: readonly PowerLayer[] = [
  {
    no: 1, id: 'DEMAND', name: '电力需求',
    asks: '谁在增加用电？',
    proves: '需求端是否强化。当前公开口径指向数据中心、高端制造、电气化在用电。',
    doesNotProve: '不证明任何电力公司盈利，更不证明可以买电。',
    focus: false,
  },
  {
    no: 2, id: 'GENERATION', name: '电源',
    asks: '谁来发电？装机、利用小时、电价、燃料、现货是否同步变化？',
    proves: '供给是否与需求同步扩张。扩张会压低一部分发电资产的稀缺性。',
    doesNotProve: '电力需求增加不能推出发电公司赚钱。',
    focus: false,
  },
  {
    no: 3, id: 'GRID', name: '电网',
    asks: '电能不能送到需要的地方，并且保持稳定？',
    proves: '新能源越多，瓶颈越可能从「有没有发电能力」变成「能不能送出去、稳得住」。',
    doesNotProve: '不证明电价上涨，只提出资本开支可能发生在这一层。',
    focus: true,
  },
  {
    no: 4, id: 'GRID_EQUIPMENT', name: '电网设备',
    asks: '电网资本开支有没有变成招标、中标、订单、收入、利润、现金流？',
    proves: '只有订单进入报表，这一层才开始出现可验证的公司证据。',
    doesNotProve: '在册电网设备公司 ≠ 建仓资格。',
    focus: true,
  },
  {
    no: 5, id: 'FLEXIBILITY', name: '电力系统稳定性基础设施',
    asks: '电能不能在正确的时间、正确的地点稳定供应？',
    proves: 'AI 是 24 小时负荷，风光不是 24 小时输出。系统需要储能、调峰调频、调度、需求响应。',
    doesNotProve: '不等于「买储能股」。储能只是这一层的一个子集。',
    focus: false,
  },
  {
    no: 6, id: 'AIDC_POWER', name: 'AI 数据中心电力基础设施',
    asks: '中国算力扩张有没有形成可量化的电力需求增量，并落到哪些电网/设备环节？',
    proves: '必须先有中国可核验的负荷增量，才能谈这一层。',
    doesNotProve: '美国 PJM 缺口或海外 8GW 项目不能推出 A 股加仓。',
    focus: false,
  },
]

export type LookBand = '先看' | '接着看' | '后看' | '暂不看'

export interface PenetrateStep {
  order: number
  band: LookBand
  name: string
  layerId: LayerId
  why: string
}

/**
 * 观察穿透顺序。不是评分，不是买卖名单。
 * 禁止把它读成 S/A/B/C 评级。
 */
export const PENETRATE_ORDER: readonly PenetrateStep[] = [
  {
    order: 1, band: '先看', name: '电网 / 特高压 / 核心电网设备',
    layerId: 'GRID',
    why: '无论电源是什么，电都要经过电网。新能源越多，电网越重要。',
  },
  {
    order: 2, band: '先看', name: '变压器 / 输配电设备',
    layerId: 'GRID_EQUIPMENT',
    why: '电网资本开支最先落到这一层的订单。',
  },
  {
    order: 3, band: '接着看', name: '电网数字化 / 调度 / 电力电子',
    layerId: 'GRID_EQUIPMENT',
    why: '稳定与消纳问题会把开支推向调度与电力电子。',
  },
  {
    order: 4, band: '接着看', name: '储能 / 电力灵活性',
    layerId: 'FLEXIBILITY',
    why: '解决的是「电够不够」之后的第二个问题：对的时间、对的地点。',
  },
  {
    order: 5, band: '接着看', name: '核电',
    layerId: 'GENERATION',
    why: '基荷与长期资本开支，但是发电层，排在电网之后。',
  },
  {
    order: 6, band: '后看', name: '优质水电',
    layerId: 'GENERATION',
    why: '供给层。电量增长成立时，稀缺性仍可能被装机扩张抵消。',
  },
  {
    order: 7, band: '后看', name: '高效火电 / 灵活性改造',
    layerId: 'GENERATION',
    why: '若成立，成立在调峰角色，不是「缺电所以火电暴利」。',
  },
  {
    order: 8, band: '后看', name: '燃气发电',
    layerId: 'GENERATION',
    why: '美国路径的一部分。中国能源禀赋不同，不得照搬。',
  },
  {
    order: 9, band: '暂不看', name: '普通新能源发电',
    layerId: 'GENERATION',
    why: '装机正在快速增加。需求增长不足以推出这一层的利润爆发。',
  },
  {
    order: 10, band: '暂不看', name: '纯「电力需求增长故事」公司',
    layerId: 'DEMAND',
    why: '叙事停在需求端。链条在需求层就断了，不得往下推。',
  },
]

export interface PowerQuestion {
  no: number
  asks: string
  status: 'UNVERIFIED'
  sourceNote: string
}

/**
 * 八问。停在最早一个未完成的问题上。
 * 现在全部未验证：委员会转述的 2026H1 数字尚未对照原始公告接入管道。
 */
export const POWER_QUESTIONS: readonly PowerQuestion[] = [
  {
    no: 1, asks: '电力需求是否持续强化？哪一种需求在增长？',
    status: 'UNVERIFIED',
    sourceNote: '中电联等公开用电量、数据中心用电、高技术制造业用电。数字不得手抄进系统。',
  },
  {
    no: 2, asks: '供给是否同步扩张？新增装机、利用小时、备用率如何？',
    status: 'UNVERIFIED',
    sourceNote: '公开装机与发电量结构。供给扩张会压低稀缺性。',
  },
  {
    no: 3, asks: '真正的瓶颈在哪里：发电、输电、配电、变压器、储能、调度、电力电子？',
    status: 'UNVERIFIED',
    sourceNote: '不得用价格或板块轮动代替瓶颈定位。',
  },
  {
    no: 4, asks: '瓶颈是否产生资本开支？国家电网 / 南方电网投资与招标往哪走？',
    status: 'UNVERIFIED',
    sourceNote: '公开投资计划与招标公告。这是电网层的关键兑现。',
  },
  {
    no: 5, asks: '哪些上市公司真正拿到订单，并转化成收入与利润？',
    status: 'UNVERIFIED',
    sourceNote: '中标 → 在手订单 → 收入 → 毛利 → 现金流。同一份订单不得拆成三个独立族。',
  },
  {
    no: 6, asks: '利润有多少可核验为此主线贡献，而不是公司总利润在涨？',
    status: 'UNVERIFIED',
    sourceNote: '目标主线核验。收入增长不能代替归因。',
  },
  {
    no: 7, asks: '未来盈利是否已经可以验证：订单、产能、交付、价格、指引？',
    status: 'UNVERIFIED',
    sourceNote: '前瞻无细项必须 UNKNOWN。价格不能冒充前瞻。',
  },
  {
    no: 8, asks: '当前价格已经要求多少增长？证据支持多少增长？',
    status: 'UNVERIFIED',
    sourceNote: '这是 R4。PE、均线、美国缺电故事都不能填。两端缺失则 UNKNOWN。',
  },
]

export const E01_DOES_NOT_IMPLY = [
  '不意味着现在可以买任何电力股',
  '不意味着中国进入全面缺电周期',
  '不意味着发电量增长等于发电利润高速增长',
  '不意味着 AI 耗电可以直接推出某家变压器或电网设备公司加仓',
  '不意味着美国 PJM / 海外数据中心项目可以套用到 A 股',
  '不意味着现有在册标的（许继电气、平高电气、思源电气、麦格米特、欧陆通、英维克）获得建仓或核心持仓资格',
  '不意味着把「AI 电力基础设施」主线从研究升为作战',
  '命题「需求强化」即使后来被公开数据证实，也不能推出「资本应当向上迁移」',
] as const

export const E01_BLOCKERS = [
  '八问全部未验证。停在第 1 问：公开用电与装机数据尚未对照原文接入管道。',
  '全国电力供需仍按「总体平衡」处理，禁止写出全面缺电。',
  '研究证据链 ≠ 投资资格链。战略观察池准入，不等于 S0–S3 通过。',
  '执行债务与组合硬约束仍在。研究结论不能绕过它们。',
] as const

export const E01 = {
  id: POWER_CHAIN_ID,
  title: POWER_CHAIN_TITLE,
  claim: E01_CLAIM,
  object: POWER_OBJECT,
  source: '委员会 2026-08-19 战略观察裁定',
  loggedOn: '2026-08-19',
  pool: '战略观察池',
  stage: 1,
  tier: 'OBSERVATION' as EvidenceTier,
  doesNotImply: E01_DOES_NOT_IMPLY,
  blockers: E01_BLOCKERS,
}

export interface PowerVerdict {
  object: string
  demand: string
  shortage: string
  candidacy: string
}

export function powerVerdict(): PowerVerdict {
  return {
    object: POWER_OBJECT,
    demand:
      '需求端被委员会记为「值得跟踪」，但 2026H1 用电与投资数字尚未对照原始公告接入管道，'
      + '故第 1 问仍是未验证。不得把转述当成兑现。',
    shortage:
      '供给同步扩张的可能未被排除。全国供需按总体平衡处理。'
      + '系统不得写出「中国进入全面缺电周期」。',
    candidacy:
      'E-01 只进入战略观察池。不得建仓、不得加仓、不得把任何电力公司升为核心持仓。',
  }
}

export function buildPowerChainView() {
  return {
    ...E01,
    layers: POWER_LAYERS,
    penetrate: PENETRATE_ORDER,
    questions: POWER_QUESTIONS,
    verdict: powerVerdict(),
    flags: {
      demandGrowthIsBuySignal: demandGrowthIsBuySignal(),
      aiLoadCanGrantMigration: aiLoadCanGrantMigration(),
      usShortageTemplateAppliesToChina: usShortageTemplateAppliesToChina(),
      chinaNationalShortageEstablished: chinaNationalShortageEstablished(),
      generationProfitFollowsDemand: generationProfitFollowsDemand(),
      generationIsFirstPenetration: generationIsFirstPenetration(),
      openPowerCoreNow: openPowerCoreNow(),
      chainBreakStopsHere: chainBreakStopsHere(),
    },
  }
}

export function renderPowerChain(): string {
  const W = 122
  const v = powerVerdict()
  const L: string[] = ['', '═'.repeat(W), POWER_CHAIN_TITLE, '═'.repeat(W)]
  L.push('  本区不打分、不排序、不产生候选、不产生动作。证据等级恒为 OBSERVATION。')
  L.push(`  ${POWER_OBJECT}`)
  L.push(`  ${E01.id}｜${E01.pool}　登记于 ${E01.loggedOn}`)
  L.push(`  原始主张：${E01.claim}`)
  L.push(`  来源：${E01.source}`)
  L.push('')
  L.push('  ── 机器结论 ──')
  L.push(`  1. ${v.object}`)
  L.push(`  2. ${v.demand}`)
  L.push(`  3. ${v.shortage}`)
  L.push(`  4. ${v.candidacy}`)
  L.push('')
  L.push('  ── 六层传导（上一层成立不推出下一层；断在哪一层就停在哪一层）──')
  for (const layer of POWER_LAYERS) {
    L.push(`  ${layer.focus ? '▶' : ' '} ${layer.no}. ${layer.name}　问：${layer.asks}`)
    L.push(`      能证明：${layer.proves}`)
    L.push(`      推不出：${layer.doesNotProve}`)
  }
  L.push('')
  L.push('  ── 观察穿透顺序（先看 / 接着看 / 后看 / 暂不看。不是买卖名单）──')
  for (const p of PENETRATE_ORDER) {
    L.push(`  ${String(p.order).padStart(2)}. [${p.band}] ${p.name}`)
    L.push(`      ${p.why}`)
  }
  L.push('')
  L.push('  ── 八问（停在最早一个未完成的问题）──')
  for (const q of POWER_QUESTIONS) {
    const cur = q.no === E01.stage
    L.push(`  ${cur ? '▶' : ' '} ${q.no}. ${q.asks}　${q.status}${cur ? '  ← 当前停在此问' : ''}`)
    L.push(`      ${q.sourceNote}`)
  }
  L.push('')
  L.push('  本条成立也不意味着：')
  for (const d of E01.doesNotImply) L.push(`    · ${d}`)
  L.push('')
  L.push('  阻塞项：')
  for (const b of E01.blockers) L.push(`    · ${b}`)
  L.push('')
  return L.join('\n')
}
