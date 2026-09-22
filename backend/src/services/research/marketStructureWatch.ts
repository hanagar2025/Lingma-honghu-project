/**
 * 研究层 · B-01 鸿鹄·市场结构观察
 *
 * 这一层不生产动作。不改规则。不进入证据链。不进入 Capital Permission。
 * 不进 DashboardInput。不 import makeAction。证据等级恒为 OBSERVATION。
 *
 * 2026-09-22 委员会登记「全天放量滞涨」。
 * 本模块只把它拆成可复核的问题，不把一句盘感升级成 TPO、顶部或主线退潮。
 */

import type { EvidenceTier } from '../cockpit/types'

const TIER = 'OBSERVATION' as const
const COMMITTEE_REPORTED_NOT_WIRED = 'COMMITTEE_REPORTED_NOT_WIRED'
const QUOTE_NOT_ARCHIVED = 'QUOTE_NOT_ARCHIVED'
const MONEY_RADAR_UNAVAILABLE = 'MONEY_RADAR_UNAVAILABLE'
const NO_DEFINED_METRIC = 'NO_DEFINED_METRIC'

export const MARKET_STRUCTURE_WATCH_ID = 'B-01'
export const MARKET_STRUCTURE_WATCH_TITLE = '鸿鹄·市场结构观察'

export const B01_OBJECT =
  '检查高成交额有没有形成有效价格推进，并把指数位置、Breadth Quality、'
  + 'AI 核心相对强度与资金同步性分开记录。'

export function volumeStallIsTop(): false {
  return false
}

export function volumeStallIsAiRetreat(): false {
  return false
}

export function b01UpgradesTpo(): false {
  return false
}

export function b01ChangesCapitalPermission(): false {
  return false
}

export function b01CombinesWithM01ToSellAi(): false {
  return false
}

export function twoOfFourCreatesOrder(): false {
  return false
}

export function thirdPartyMoneyIsSystemEvidence(): false {
  return false
}

export type ObservationStatus =
  | typeof COMMITTEE_REPORTED_NOT_WIRED
  | typeof QUOTE_NOT_ARCHIVED
  | typeof MONEY_RADAR_UNAVAILABLE
  | typeof NO_DEFINED_METRIC

export interface SessionCheck {
  item: string
  asks: string
  status: ObservationStatus
  current: string
  means: string
  doesNotMean: string
}

/**
 * 四问分开判。前两问由委员会转述为成立；后两问没有完整数据。
 * 因此「高位换手 / 分歧扩大」也只能是临时解释，不是系统结论。
 */
export const SESSION_CHECKS: readonly SessionCheck[] = [
  {
    item: '成交额',
    asks: '是否明显高于近期均值？',
    status: COMMITTEE_REPORTED_NOT_WIRED,
    current: '委员会转述：放量成立；具体成交额、均值窗口与倍数未接入本记录。',
    means: '筹码交换与分歧扩大。',
    doesNotMean: '放量本身不等于派发、顶部或退潮。',
  },
  {
    item: '价格推进效率',
    asks: '放量后指数与核心资产推进了多少？',
    status: COMMITTEE_REPORTED_NOT_WIRED,
    current: '委员会转述：全天滞涨；尚未定义推进效率公式。',
    means: '高成交额下价格推进效率下降。',
    doesNotMean: '前两项同时出现，仍优先解释为高位换手 / 分歧扩大。',
  },
  {
    item: 'Breadth Quality',
    asks: '上涨/下跌、新高/新低、中位数股票与行业扩散是否恶化？',
    status: QUOTE_NOT_ARCHIVED,
    current: '9/22 完整收盘广度尚未进入可审计档案。',
    means: '用于区分指数滞涨与市场内部恶化。',
    doesNotMean: '不能用指数涨跌替代广度。',
  },
  {
    item: 'AI 核心同步性',
    asks: '中际、新易盛、澜起、海光的价格、RS 与资金是否同步转弱？',
    status: MONEY_RADAR_UNAVAILABLE,
    current: '价格与 RS 可在收盘后复算；真实资金流免费源缺失，资金同步性不可判定。',
    means: '只有多只核心在多个维度同步恶化，才值得提高 TPO 复核优先级。',
    doesNotMean: '第三方主力资金转述不是系统证据，成交额也不能冒充资金。',
  },
]

export const PROVISIONAL_STATE = {
  date: '2026-09-22',
  state: 'PROVISIONAL_HIGH_TURNOVER_LOW_ADVANCE' as const,
  label: '高位换手 / 分歧扩大（临时状态）',
  statement:
    '市场出现委员会转述的全天放量滞涨，暂记为高成交额下价格推进效率下降。'
    + '不直接解释为顶部、AI 主线退潮或 TPO 升级。',
  whyProvisional:
    '成交额与滞涨两项只有转述，Breadth Quality 尚未归档，AI 核心真实资金同步性不可得。',
}

export interface DangerousCombination {
  conditions: readonly string[]
  interpretation: string
  boundary: string
}

export const DANGEROUS_COMBINATION: DangerousCombination = {
  conditions: [
    '成交额持续放大',
    '价格继续无法推进',
    'AI 核心多只价格与 RS 同步转弱',
    'Breadth Quality 恶化',
  ],
  interpretation:
    '四类信息共同出现，才说明资金供给增加而价格承接能力下降，值得进入 TPO-1 / TPO-2 人工复核。',
  boundary:
    '进入复核不等于 TPO 已升级，更不等于产生减仓动作。真实资金同步性不可判定时，不得写成完整风险传导。',
}

export interface NextSessionPath {
  id: 'S1' | 'S2' | 'S3' | 'S4'
  observation: string
  interpretation: string
  tpo: string
}

export const NEXT_SESSION_PATHS: readonly NextSessionPath[] = [
  {
    id: 'S1',
    observation: '9/23 缩量但价格稳住',
    interpretation: '9/22 更像换手。',
    tpo: '不升级；仍等待 Breadth 与 AI 核心收盘数据。',
  },
  {
    id: 'S2',
    observation: '9/23 放量突破 9/22 高点',
    interpretation: '9/22 的放量可能是有效换手，而不是派发。',
    tpo: '不因突破自动降级或升级；价格不能迁移生命线。',
  },
  {
    id: 'S3',
    observation: '9/23 继续放量，但指数与 AI 核心不涨',
    interpretation: '资金供给增加，价格承接能力下降。',
    tpo: '提高 TPO 复核优先级；仍不产生动作。',
  },
  {
    id: 'S4',
    observation: '9/23 放量下跌，且 AI 核心价格、RS 与资金同步转负',
    interpretation: '若所有字段均可核验，才接近完整的风险传导。',
    tpo:
      '进入 TPO-1 / TPO-2 人工复核；当前资金列不可得，故不得提前把这一情形判为已发生。',
  },
]

export const AI_BETA_CORE = {
  names: ['中际旭创', '新易盛', '澜起科技', '海光信息'] as const,
  watch:
    '分别看价格、相对强度与资金；不得把四只股票压成一条综合分数。',
  provisionalThreshold:
    '委员会提出“四只中至少 2–3 只价格走弱 + RS 下降 + 资金恶化”作为不同信号。',
  boundary:
    '这只是人工复核描述，不是机械阈值。资金列恒不可得，因此当前无法判定“2–3只三维同步恶化”。',
}

export const MODULE_FIREWALL = [
  {
    layer: 'M-01',
    asks: '外部宏观风险环境发生了什么？',
    cannot: '不能与 B-01 相加推出“AI 要撤”。',
  },
  {
    layer: 'B-01',
    asks: 'A 股成交额是否形成有效价格推进，市场内部结构是否恶化？',
    cannot: '不能把放量滞涨写成顶部、退潮或卖出理由。',
  },
  {
    layer: 'AI 主线 / Momentum',
    asks: '核心标的价格、RS 与可得数据是否同步恶化？',
    cannot: '技术与结构信息只能触发复核，不能替代 Ownership 或法定理由。',
  },
  {
    layer: 'Portfolio / Decision',
    asks: '新鲜账本是否触发既有法定理由？',
    cannot: '不得把 M-01、B-01 或 C-01 研究结论写进动作理由。',
  },
] as const

export const ACCOUNT_FIREWALL = {
  reported:
    '旧账本与口头约数复算得到股票约 52.8%、一级熔断指示性缺口约 14.45 万。',
  status: 'INDICATIVE_ONLY' as const,
  action:
    '先更新同一 asOf 的股数、现金、外部现金归属与价格。'
    + '若更新后仍确认一级熔断超限及既有执行债务，则优先执行债务。',
  wording:
    '若反弹改善执行条件，原词固定为“债务执行窗口改善”，不得改写成“放量滞涨所以减仓”或“逢高减仓”。',
  boundary:
    '不得因为 9/22 放量滞涨扩大减仓范围，也不得让 14.45 万这个 indicative 数字直接驱动交易。',
}

export const CAPITAL_PERMISSION_STATE = {
  before: 'CLOSED' as const,
  after: 'CLOSED' as const,
  changed: false as const,
  reason:
    'Capital Permission 在 9/22 之前已因执行债务、熔断与资格约束关闭。'
    + '今天这根 K 线没有让它“更关闭”，也没有新增法定阻断。',
  not:
    '“停止追 AI”不是 B-01 产生的新动作；系统只是继续维持既有的不新增状态。',
}

export const B01_DOES_NOT_IMPLY = [
  '不意味着市场见顶',
  '不意味着 AI 主线退潮',
  '不意味着 TPO-1 或 TPO-2 已升级',
  '不意味着 M-01 + 放量滞涨可以推出 AI 要撤',
  '不意味着两只或三只核心走弱就自动产生动作',
  '不意味着第三方主力资金可以进入系统证据',
  '不意味着 Capital Permission 今天发生了变化',
  '不意味着 14.45 万指示性缺口可以直接驱动交易',
  '不改 V4.x。不加新规则。本层不发令。',
] as const

export const B01 = {
  id: MARKET_STRUCTURE_WATCH_ID,
  title: MARKET_STRUCTURE_WATCH_TITLE,
  object: B01_OBJECT,
  source: '委员会 2026-09-22 盘后市场结构观察',
  loggedOn: '2026-09-22',
  pool: '战略观察池',
  hypothesis: 'H-BQ',
  claim: '高成交额下价格推进效率下降，需要下一交易日用 Breadth Quality 与 AI 核心同步性确认。',
  status: 'OPEN' as const,
  tier: TIER as EvidenceTier,
  doesNotImply: B01_DOES_NOT_IMPLY,
}

export function buildMarketStructureWatchView() {
  return {
    ...B01,
    provisionalState: PROVISIONAL_STATE,
    checks: SESSION_CHECKS,
    dangerousCombination: DANGEROUS_COMBINATION,
    nextSessionPaths: NEXT_SESSION_PATHS,
    aiBetaCore: AI_BETA_CORE,
    moduleFirewall: MODULE_FIREWALL,
    accountFirewall: ACCOUNT_FIREWALL,
    capitalPermission: CAPITAL_PERMISSION_STATE,
    flags: {
      volumeStallIsTop: volumeStallIsTop(),
      volumeStallIsAiRetreat: volumeStallIsAiRetreat(),
      b01UpgradesTpo: b01UpgradesTpo(),
      b01ChangesCapitalPermission: b01ChangesCapitalPermission(),
      b01CombinesWithM01ToSellAi: b01CombinesWithM01ToSellAi(),
      twoOfFourCreatesOrder: twoOfFourCreatesOrder(),
      thirdPartyMoneyIsSystemEvidence: thirdPartyMoneyIsSystemEvidence(),
    },
  }
}

export function renderMarketStructureWatch(): string {
  const W = 122
  const v = buildMarketStructureWatchView()
  const L: string[] = ['', '═'.repeat(W), `${v.id}｜${v.title}`, '═'.repeat(W)]
  L.push('  本区不打分、不排序、不产生候选、不产生动作。证据等级恒为 OBSERVATION。')
  L.push('  放量滞涨只触发复核，不升级 TPO，本层不发令。')
  L.push(`  ${v.object}`)
  L.push(`  ${v.hypothesis}｜${v.claim}　${v.status}`)
  L.push(`  ${v.pool}　登记于 ${v.loggedOn}　来源：${v.source}`)
  L.push('')
  L.push('  ── 9/22 临时状态 ──')
  L.push(`  ${v.provisionalState.state}｜${v.provisionalState.label}`)
  L.push(`  ${v.provisionalState.statement}`)
  L.push(`  为什么只是临时状态：${v.provisionalState.whyProvisional}`)
  L.push('')
  L.push('  ── 四问分开判 ──')
  for (const c of v.checks) {
    L.push(`  ${c.item}　${c.status}`)
    L.push(`      问：${c.asks}`)
    L.push(`      当前：${c.current}`)
    L.push(`      能说明：${c.means}`)
    L.push(`      推不出：${c.doesNotMean}`)
  }
  L.push('')
  L.push('  ── 真正危险的组合 ──')
  L.push(`  ${v.dangerousCombination.conditions.join(' + ')}`)
  L.push(`  ${v.dangerousCombination.interpretation}`)
  L.push(`  边界：${v.dangerousCombination.boundary}`)
  L.push('')
  L.push('  ── 9/23 四种确认路径 ──')
  for (const p of v.nextSessionPaths) {
    L.push(`  ${p.id}　${p.observation}`)
    L.push(`      解释：${p.interpretation}`)
    L.push(`      TPO：${p.tpo}`)
  }
  L.push('')
  L.push('  ── AI β 核心四只 ──')
  L.push(`  ${v.aiBetaCore.names.join(' / ')}`)
  L.push(`  看什么：${v.aiBetaCore.watch}`)
  L.push(`  委员会临时描述：${v.aiBetaCore.provisionalThreshold}`)
  L.push(`  边界：${v.aiBetaCore.boundary}`)
  L.push('')
  L.push('  ── 跨模块防火墙 ──')
  for (const f of v.moduleFirewall) {
    L.push(`  ${f.layer}　问：${f.asks}`)
    L.push(`      不能：${f.cannot}`)
  }
  L.push('')
  L.push('  ── 账本与执行边界 ──')
  L.push(`  ${v.accountFirewall.reported}　${v.accountFirewall.status}`)
  L.push(`  ${v.accountFirewall.action}`)
  L.push(`  固定措辞：${v.accountFirewall.wording}`)
  L.push(`  边界：${v.accountFirewall.boundary}`)
  L.push('')
  L.push('  ── Capital Permission ──')
  L.push(`  ${v.capitalPermission.before} → ${v.capitalPermission.after}　changed=${v.capitalPermission.changed}`)
  L.push(`  ${v.capitalPermission.reason}`)
  L.push(`  ${v.capitalPermission.not}`)
  L.push('')
  L.push('  本条成立也不意味着：')
  for (const x of v.doesNotImply) L.push(`    · ${x}`)
  L.push('')
  return L.join('\n')
}
