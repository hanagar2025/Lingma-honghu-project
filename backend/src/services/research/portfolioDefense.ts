/**
 * 组合防守层（资产配置审计）。
 *
 * 委员会 2026-08-21：方三文这套方法，作为普通人的资产配置底盘可以认可；
 * 作为鸿鹄的投资方法，不会照搬。不改 V4.x。
 *
 * 方三文与鸿鹄不是竞争关系，而是两个层级。
 *
 *   方三文解决：不确定未来哪个主线最强，所以把风险分散掉。
 *   鸿鹄解决：已经有战略假设，那么在证据不断变化时，
 *             下一单位资本是否仍然值得交给这个假设？
 *
 * 不能因为 AI 波动，就把鸿鹄退化成「红利低波 + 定投」。
 * 那是从主动研究退回到被动资产配置。
 *
 * 本模块只观察第三层：即使每家公司都值得拥有，
 * 是不是把太多资本暴露在同一个宏观因子上？
 *
 * 不生产动作，不进规则指纹，不进入 DashboardInput。
 * tier 恒为 OBSERVATION。不 import makeAction。
 */

import type { EvidenceTier } from '../cockpit/types'

export const DEFENSE_ID = 'D-01'
export const DEFENSE_TITLE = '鸿鹄·组合防守层（资产配置审计）'

/** 比「卖 AI、买红利」更接近终局的那一句。 */
export const DEFENSE_OBJECT =
  '现在真正值得研究的，不是要不要卖 AI、买红利，而是 AI 主线如果进入估值压缩期，组合里面有没有第二风险源能够承接资本。'

export const D01_CLAIM =
  '组合实际承担的是 AI 算力 / 半导体资本周期这一个因子。'
  + '证据独立不等于股价独立。公司仍然值得拥有，不推出组合暴露不过度。'

/** 高股息不是买入信号。 */
export function highDividendMeansGoodCompany(): false {
  return false
}

/** 禁止：股息率大于某个数字就买。 */
export function dividendYieldAboveXIsBuySignal(): false {
  return false
}

/** 红利低波不是无脑避风港，更不是「不会跌」。 */
export function dividendLowVolIsCrashProof(): false {
  return false
}

/** 方三文方法不替代鸿鹄。 */
export function fangSanwenReplacesHonghu(): false {
  return false
}

/** 方三文与鸿鹄不是竞争关系。 */
export function fangSanwenCompetesWithHonghu(): false {
  return false
}

/** 鸿鹄不得退化成红利低波加定投。 */
export function honghuMayDegenerateToDividendDca(): false {
  return false
}

/** 证据独立推不出股价独立。 */
export function evidenceIndependenceMeansPriceIndependence(): false {
  return false
}

/** 不得因为 AI 波动就切红利。 */
export function sellAiBuyDividend(): false {
  return false
}

/** 产业逻辑未被证伪，推不出估值不会被压缩。 */
export function industryLogicUnfalsifiedMeansValuationSafe(): false {
  return false
}

/**
 * H-AI 可以观察，但不能进入鸿鹄证据链，直到出现独立证据。
 * 这正符合 V4.x。
 */
export function haiMayEnterEvidenceChain(): false {
  return false
}

/** 不建议为了本层去改 V4.x。规则已经冻结。 */
export function modifyV4xForDefenseLayer(): false {
  return false
}

/** 本层不发令。降暴露若发生，只能来自已冻结的组合硬约束。 */
export function defenseLayerCanIssueAction(): false {
  return false
}

export type SystemLayerId =
  | 'HONGHU_OWNERSHIP'
  | 'CAPITAL_MIGRATION'
  | 'ALLOCATION_AUDIT'

export interface SystemLayer {
  no: 1 | 2 | 3
  id: SystemLayerId
  name: string
  asks: string
  answers: string
  doesNotAnswer: string
}

/**
 * 三层体系。命名刻意不用 L1 / L2 / L3，避免和风控熔断层撞车。
 * 顺序是职责分层，不是买卖顺序，也不是评分。
 */
export const SYSTEM_LAYERS: readonly SystemLayer[] = [
  {
    no: 1, id: 'HONGHU_OWNERSHIP', name: '鸿鹄',
    asks: '谁值得拥有？',
    answers: '公司基本面、战略假设、证据、预期风险是否支持 Ownership。',
    doesNotAnswer: '不回答下一单位资本该给多少，也不回答宏观因子是否过度集中。',
  },
  {
    no: 2, id: 'CAPITAL_MIGRATION', name: '资本迁移',
    asks: '给多少？',
    answers: '新的独立证据族有没有资格让下一单位资本迁入。价格不是迁移原因。',
    doesNotAnswer: '不回答「因为跌了所以该加」或「因为涨了所以该减」。',
  },
  {
    no: 3, id: 'ALLOCATION_AUDIT', name: '资产配置审计',
    asks: '即使每家都值得拥有，是不是把太多资本暴露在同一个宏观因子上？',
    answers: '组合相关性与宏观风险暴露。这是方三文方法真正能补鸿鹄的地方。',
    doesNotAnswer: '不回答谁该买、谁该卖，也不产生新的选股系统。',
  },
]

export interface DividendQualityItem {
  no: number
  name: string
  asks: string
  status: 'UNVERIFIED'
  sourceNote: string
}

/**
 * 若真的研究红利，用的是鸿鹄语言，不是股息率筛子。
 * 这张清单不是买卖名单。五项全部未验证。
 */
export const DIVIDEND_QUALITY_CHECKLIST: readonly DividendQualityItem[] = [
  {
    no: 1, name: '股息可持续性',
    asks: '利润若在衰退，高股息率是不是市场已经在定价未来要降息？',
    status: 'UNVERIFIED',
    sourceNote: '高股息不等于好公司。不得用股息率大于某值当作买入。',
  },
  {
    no: 2, name: '自由现金流覆盖',
    asks: '现金分红有没有被自由现金流盖住，而不是靠账面利润或加杠杆维持？',
    status: 'UNVERIFIED',
    sourceNote: '未对照原始现金流表接入管道。不得手抄股息率进系统。',
  },
  {
    no: 3, name: '盈利稳定性',
    asks: '盈利是不是相对稳定，而不是景气高点上的一次性高派息？',
    status: 'UNVERIFIED',
    sourceNote: '现金回报要和较低波动、相对稳定的盈利放在一起看。',
  },
  {
    no: 4, name: '资产负债表',
    asks: '派息有没有消耗安全垫，使公司在利率上升或融资收紧时更脆弱？',
    status: 'UNVERIFIED',
    sourceNote: '长端利率上升会同时压制估值折现率与企业融资成本。',
  },
  {
    no: 5, name: '估值',
    asks: '现金回报 + 较低估值 + 较低波动 + 相对稳定盈利，有没有形成对估值压缩更有抵抗力的结构？',
    status: 'UNVERIFIED',
    sourceNote: '这是结构问题，不是「红利股一定涨」。避免买入估值过高有道理，但不能说得太绝对。',
  },
]

export interface SnowballNote {
  no: number
  axis: string
  examples: string
  purpose: string
}

/**
 * 雪球三分法。只作组合笔记，不是交易规则。
 * 最重要的不是提高收益率，而是降低「必须在某一个市场、某一个时间点、某一个资产上做对」的要求。
 */
export const SNOWBALL_NOTES: readonly SnowballNote[] = [
  {
    no: 1, axis: '市场分散',
    examples: 'A股 / 港股 / 美股',
    purpose: '降低「必须押对某一个市场」的要求。',
  },
  {
    no: 2, axis: '资产分散',
    examples: '股票 / 债券 / 黄金 / 现金',
    purpose: '降低「必须押对某一个资产」的要求。',
  },
  {
    no: 3, axis: '时间分散',
    examples: '一次性投入 / 分批 / 定投',
    purpose: '降低「必须在某一个时间点做对」的要求。',
  },
]

export interface FactorTrace {
  kind: 'SECTOR' | 'NAME'
  name: string
  committeeTrace: string
  asOf: '2026-08-19'
  status: 'UNVERIFIED'
  sourceNote: string
}

/**
 * 委员会 2026-08-19 截图留痕。
 * 这是审计样本，不是今日实时仓位，不得写成会过期的 MET。
 */
export const FACTOR_TRACES: readonly FactorTrace[] = [
  {
    kind: 'SECTOR', name: '通信', committeeTrace: '约 34.8%',
    asOf: '2026-08-19', status: 'UNVERIFIED',
    sourceNote: '截图留痕。不是今日实时仓位。',
  },
  {
    kind: 'SECTOR', name: '电子', committeeTrace: '约 50.1%',
    asOf: '2026-08-19', status: 'UNVERIFIED',
    sourceNote: '截图留痕。不是今日实时仓位。',
  },
  {
    kind: 'NAME', name: '海光', committeeTrace: '约 21.2%',
    asOf: '2026-08-19', status: 'UNVERIFIED',
    sourceNote: '规范案例仍是：核心 + 超限 + 降暴露。减仓不等于看空。',
  },
  {
    kind: 'NAME', name: '新易盛', committeeTrace: '约 17.1%',
    asOf: '2026-08-19', status: 'UNVERIFIED',
    sourceNote: '业务与海光不同，市场风险因子可能仍高度相关。',
  },
  {
    kind: 'NAME', name: '中际旭创', committeeTrace: '约 17.7%',
    asOf: '2026-08-19', status: 'UNVERIFIED',
    sourceNote: '业务与新易盛同属光模块，但本层问的是因子，不是同业。',
  },
  {
    kind: 'NAME', name: '澜起科技', committeeTrace: '约 8.4%',
    asOf: '2026-08-19', status: 'UNVERIFIED',
    sourceNote: '互联芯片与算力资本周期仍可能同向。',
  },
  {
    kind: 'NAME', name: '中微公司', committeeTrace: '约 7.2%',
    asOf: '2026-08-19', status: 'UNVERIFIED',
    sourceNote: '设备订单证据独立，推不出股价独立。',
  },
  {
    kind: 'NAME', name: '北方华创', committeeTrace: '约 7.0%',
    asOf: '2026-08-19', status: 'UNVERIFIED',
    sourceNote: '设备订单证据独立，推不出股价独立。',
  },
]

export const SHARED_FACTOR = {
  id: 'AI_CAPEX_SEMI_CYCLE',
  name: 'AI 算力 / 半导体资本周期',
  note:
    '持有的不是互不相关的几只股票，而是同一个宏观因子的多层暴露。'
    + '真正的风险不是选错了一家公司，而是很多正确的公司可能同时受到同一个宏观因子打击。',
} as const

export interface PublicTrace {
  id: string
  statement: string
  status: 'UNVERIFIED'
  sourceNote: string
}

/**
 * 长端利率与红利指数数字都是委员会转述。
 * PUBLIC_NOT_YET_WIRED：不得抄进会过期的 MET，也不得据此发买卖令。
 */
export const RATE_TRACES: readonly PublicTrace[] = [
  {
    id: 'US_30Y',
    statement: '美国 30 年期国债收益率近期一度超过 5.3%，达到 2007 年以来高位。',
    status: 'UNVERIFIED',
    sourceNote: '委员会转述，PUBLIC_NOT_YET_WIRED。数字不得手抄成会过期的 MET。',
  },
  {
    id: 'US_10Y',
    statement: '美国 10 年期国债收益率接近 4.7%；全球长债同步承压。',
    status: 'UNVERIFIED',
    sourceNote: '委员会转述，PUBLIC_NOT_YET_WIRED。不得单独据此改 Ownership。',
  },
]

export const INDEX_TRACES: readonly PublicTrace[] = [
  {
    id: 'SP_CN_DIV_OPP',
    statement: '标普中国 A 股红利机会指数截至 2026 年 7 月底：过去一年价格回报约 8.13%，5 年年化约 7.33%。',
    status: 'UNVERIFIED',
    sourceNote: '用来反驳「红利是无脑避风港」，不是买入理由。它也会回撤。',
  },
  {
    id: 'SP_CN_LOWVOL_DIV50',
    statement: '标普中国 A 股大盘低波红利 50 指数截至 7 月底：过去一年约 1.58%，5 年年化约 7.72%。',
    status: 'UNVERIFIED',
    sourceNote: '红利低波不是不会跌，而是试图改变收益来源和风险结构。',
  },
]

export const HAI = {
  id: 'H-AI',
  title: 'H-AI',
  claim:
    'AI 产业景气仍然成立，但资本市场给予 AI 产业的估值溢价'
    + '正在受到长端利率、融资成本和资本回报要求的约束。',
  status: 'OBSERVATION' as const,
  mayEnterEvidenceChain: false as const,
  whyNot:
    '可以观察，但不能进入鸿鹄证据链，直到找到独立证据。'
    + '产业逻辑没有被证伪，不代表股票估值不会被压缩。这正符合 V4.x。',
}

export interface DefenseQuestion {
  no: number
  asks: string
  status: 'UNVERIFIED'
  sourceNote: string
}

/**
 * 六问。停在最早一个未完成的问题上。
 * 现在全部未验证：截图仓位与利率转述都尚未对照原始来源接入管道。
 */
export const DEFENSE_QUESTIONS: readonly DefenseQuestion[] = [
  {
    no: 1,
    asks: '组合是不是把过多资本暴露在同一个宏观因子上？',
    status: 'UNVERIFIED',
    sourceNote: '2026-08-19 截图显示通信与电子、以及海光 / 新易盛 / 中际旭创等高度同向。数字未接入实时管道。',
  },
  {
    no: 2,
    asks: '持仓公司的市场风险因子是否高度相关？证据独立是否被误读成股价独立？',
    status: 'UNVERIFIED',
    sourceNote: '新易盛、中际旭创、海光、澜起、中微、北方华创业务不同，不推出因子分散。',
  },
  {
    no: 3,
    asks: 'AI 公司基本面有没有恶化到足以改变 Ownership？',
    status: 'UNVERIFIED',
    sourceNote: '这是第一层的问题。本层不重判。没有新事实则 Ownership 不变。',
  },
  {
    no: 4,
    asks: 'H-AI 有没有出现独立证据，足以进入鸿鹄证据链？',
    status: 'UNVERIFIED',
    sourceNote: '当前答案必须是没有。利率转述与融资观察都还不够。',
  },
  {
    no: 5,
    asks: '若 AI 进入估值压缩期，组合里有没有第二风险源能承接资本？',
    status: 'UNVERIFIED',
    sourceNote: '第二风险源不是「红利看起来安全所以买」。承接资格仍要过鸿鹄第一层。',
  },
  {
    no: 6,
    asks: '若组合暴露过高，降暴露是否仍读成「核心 + 超限 + 降暴露」，而不是看空 AI？',
    status: 'UNVERIFIED',
    sourceNote: '与海光已定义的读法完全一致。公司仍值得拥有，资本暴露可以下降。',
  },
]

export const D01_DOES_NOT_IMPLY = [
  '不意味着现在卖 AI、买红利',
  '不意味着高股息就是好公司',
  '不意味着股息率大于某个数字就可以买',
  '不意味着红利低波不会跌、或红利股一定涨',
  '不意味着方三文方法替代鸿鹄，或两者是竞争关系',
  '不意味着鸿鹄退化成红利低波加定投',
  '不意味着证据独立等于股价独立',
  '不意味着 H-AI 已进入鸿鹄证据链',
  '不意味着产业逻辑未被证伪，估值就不会被压缩',
  '不意味着 2026-08-19 截图仓位是今日实时 MET',
  '不意味着雪球三分法是交易规则',
  '不意味着要修改 V4.x，或本层可以发买卖令',
] as const

export const D01_BLOCKERS = [
  '六问全部未验证。停在第 1 问：组合因子暴露仍以 2026-08-19 截图留痕为样本，未对照实时仓位接入管道。',
  'H-AI 尚无独立证据，不得进入鸿鹄证据链。',
  '长端利率与红利指数数字都是委员会转述，PUBLIC_NOT_YET_WIRED。',
  '本层不产生动作。若出现降暴露，只能来自已冻结的组合硬约束（例如单票超限），不是本层发令。',
  '第一层 Ownership 与第三层暴露必须分开读：核心持仓仍可同时是超限、须降暴露。',
] as const

export const D01 = {
  id: DEFENSE_ID,
  title: DEFENSE_TITLE,
  claim: D01_CLAIM,
  object: DEFENSE_OBJECT,
  source: '委员会 2026-08-21 组合防守层裁定',
  loggedOn: '2026-08-21',
  pool: '配置审计观察',
  stage: 1,
  tier: 'OBSERVATION' as EvidenceTier,
  doesNotImply: D01_DOES_NOT_IMPLY,
  blockers: D01_BLOCKERS,
}

export interface DefenseVerdict {
  object: string
  layers: string
  factor: string
  hai: string
  stance: string
}

export function defenseVerdict(): DefenseVerdict {
  return {
    object: DEFENSE_OBJECT,
    layers:
      '方三文补的是第三层资产配置审计，不是新的选股系统。'
      + '第一层仍由鸿鹄决定谁值得拥有；第二层仍由独立证据决定给多少。',
    factor:
      '2026-08-19 截图样本显示：通信与电子、以及海光 / 新易盛 / 中际旭创 / 澜起 / 中微 / 北方华创'
      + '可能共享 AI 算力 / 半导体资本周期。证据独立不等于股价独立。数字不是今日 MET。',
    hai:
      'H-AI 只观察：产业景气仍可成立，估值溢价却可能被长端利率、融资成本和资本回报要求约束。'
      + '在找到独立证据之前，不得进入鸿鹄证据链。',
    stance:
      '不因 AI 波动切红利，也不因红利看起来安全就买。不改 V4.x。'
      + '完全可以出现：Ownership 仍核心、Evidence 未恶化、组合暴露过高、Capital Exposure 下降。'
      + '这就是海光已经定义过的「核心 + 超限 + 降暴露」，不是看空 AI。',
  }
}

export function buildPortfolioDefenseView() {
  return {
    ...D01,
    layers: SYSTEM_LAYERS,
    checklist: DIVIDEND_QUALITY_CHECKLIST,
    snowball: SNOWBALL_NOTES,
    factorTraces: FACTOR_TRACES,
    sharedFactor: SHARED_FACTOR,
    rateTraces: RATE_TRACES,
    indexTraces: INDEX_TRACES,
    hai: HAI,
    questions: DEFENSE_QUESTIONS,
    verdict: defenseVerdict(),
    flags: {
      highDividendMeansGoodCompany: highDividendMeansGoodCompany(),
      dividendYieldAboveXIsBuySignal: dividendYieldAboveXIsBuySignal(),
      dividendLowVolIsCrashProof: dividendLowVolIsCrashProof(),
      fangSanwenReplacesHonghu: fangSanwenReplacesHonghu(),
      fangSanwenCompetesWithHonghu: fangSanwenCompetesWithHonghu(),
      honghuMayDegenerateToDividendDca: honghuMayDegenerateToDividendDca(),
      evidenceIndependenceMeansPriceIndependence: evidenceIndependenceMeansPriceIndependence(),
      sellAiBuyDividend: sellAiBuyDividend(),
      industryLogicUnfalsifiedMeansValuationSafe: industryLogicUnfalsifiedMeansValuationSafe(),
      haiMayEnterEvidenceChain: haiMayEnterEvidenceChain(),
      modifyV4xForDefenseLayer: modifyV4xForDefenseLayer(),
      defenseLayerCanIssueAction: defenseLayerCanIssueAction(),
    },
  }
}

export function renderPortfolioDefense(): string {
  const W = 122
  const v = defenseVerdict()
  const L: string[] = ['', '═'.repeat(W), DEFENSE_TITLE, '═'.repeat(W)]
  L.push('  本区不打分、不排序、不产生候选、不产生动作。证据等级恒为 OBSERVATION。')
  L.push(`  ${DEFENSE_OBJECT}`)
  L.push(`  ${D01.id}｜${D01.pool}　登记于 ${D01.loggedOn}`)
  L.push(`  原始主张：${D01.claim}`)
  L.push(`  来源：${D01.source}`)
  L.push('')
  L.push('  ── 机器结论 ──')
  L.push(`  1. ${v.object}`)
  L.push(`  2. ${v.layers}`)
  L.push(`  3. ${v.factor}`)
  L.push(`  4. ${v.hai}`)
  L.push(`  5. ${v.stance}`)
  L.push('')
  L.push('  ── 三层体系（方三文补的是第三层，不是选股系统）──')
  for (const layer of SYSTEM_LAYERS) {
    L.push(`  ${layer.no}. ${layer.name}　问：${layer.asks}`)
    L.push(`      回答：${layer.answers}`)
    L.push(`      不回答：${layer.doesNotAnswer}`)
  }
  L.push('')
  L.push('  ── 若研究红利：鸿鹄语言，不是股息率筛子。不是买卖名单 ──')
  for (const c of DIVIDEND_QUALITY_CHECKLIST) {
    L.push(`  ${c.no}. ${c.name}　${c.status}`)
    L.push(`      ${c.asks}`)
    L.push(`      ${c.sourceNote}`)
  }
  L.push('')
  L.push('  ── 雪球三分法（组合笔记，不是交易规则）──')
  for (const s of SNOWBALL_NOTES) {
    L.push(`  ${s.no}. ${s.axis}　${s.examples}`)
    L.push(`      ${s.purpose}`)
  }
  L.push('')
  L.push(`  ── 因子集中审计（共享因子：${SHARED_FACTOR.name}）──`)
  L.push(`  ${SHARED_FACTOR.note}`)
  L.push('  以下数字是 2026-08-19 委员会截图留痕，不是今日实时仓位。')
  for (const t of FACTOR_TRACES) {
    L.push(`  · [${t.kind === 'SECTOR' ? '板块' : '个股'}] ${t.name}　${t.committeeTrace}　${t.status}`)
    L.push(`      ${t.sourceNote}`)
  }
  L.push('')
  L.push('  ── 宏观转述（PUBLIC_NOT_YET_WIRED，不得写成 MET）──')
  for (const r of RATE_TRACES) {
    L.push(`  · ${r.statement}`)
    L.push(`      ${r.sourceNote}`)
  }
  for (const r of INDEX_TRACES) {
    L.push(`  · ${r.statement}`)
    L.push(`      ${r.sourceNote}`)
  }
  L.push('')
  L.push(`  ── ${HAI.title}（只观察，不进证据链）──`)
  L.push(`  ${HAI.claim}`)
  L.push(`  进入证据链：否。${HAI.whyNot}`)
  L.push('')
  L.push('  ── 六问（停在最早一个未完成的问题）──')
  for (const q of DEFENSE_QUESTIONS) {
    const cur = q.no === D01.stage
    L.push(`  ${cur ? '▶' : ' '} ${q.no}. ${q.asks}　${q.status}${cur ? '  ← 当前停在此问' : ''}`)
    L.push(`      ${q.sourceNote}`)
  }
  L.push('')
  L.push('  本条成立也不意味着：')
  for (const d of D01.doesNotImply) L.push(`    · ${d}`)
  L.push('')
  L.push('  阻塞项：')
  for (const b of D01.blockers) L.push(`    · ${b}`)
  L.push('')
  return L.join('\n')
}
