// MSR 扫描域 —— 四条主线 × 产业链三级节点
// 配置即战略：主线与冠军池由 CTC 冻结令决定，本文件不得擅自增删主线（战略漂移一级违规）。
// 节点内的标的可以增减 —— 那是研究，不是战略。

/** 产业证据等级：只有 B 级以上可进入候选池（委员会 2026-08-13 提出） */
export type EvidenceGrade = 'S' | 'A' | 'B' | 'C' | 'D'

export const EVIDENCE_DEFINITION: Record<EvidenceGrade, string> = {
  S: '客户订单已确认 + 产品放量 + 利润已进入报表',
  A: '客户验证完成 + 订单明显增长 + 产能释放',
  B: '送样、验证、客户导入中',
  C: '技术路线成立，商业化尚早',
  D: '纯概念',
}

/** 证据等级 → 基本面维度得分（0–5） */
export const EVIDENCE_SCORE: Record<EvidenceGrade, number> = { S: 5, A: 4, B: 3, C: 1, D: 0 }

/** 候选池门槛：B 级以上 */
export const MIN_EVIDENCE_FOR_CANDIDATE: EvidenceGrade[] = ['S', 'A', 'B']

export interface UniverseMember {
  code: string
  name: string
  /** 产业链层级：1=第一级（已被充分定价的核心）2=第二级 3=第三级（更上游/下一代） */
  tier: 1 | 2 | 3
  /** 产业链节点，如 "光模块" "光芯片" "CPO/硅光" */
  node: string
  /** 产业证据等级 —— 必须由研究档案人工维护，不得由行情推断 */
  evidence: EvidenceGrade
  /** 是否在 CTC 冻结冠军池内（仅冠军池成员适用再入场四条件） */
  champion?: boolean
  /** C级清退标的：战略层已关闭，须走冠军替换四步程序，MSR 永不输出为候选 */
  retiredC?: boolean
  /** PE 历史分位（0–1）。无值 = 评分不完整 = 不具备候选资格 */
  peHistoryPercentile?: number
  /** 收入主线归因是否已核验（委员会 2026-08-12 强制字段） */
  mainlineAttributionVerified?: boolean
  note?: string
}

export interface Mainline {
  id: string
  name: string
  /** 战略评级（CTC 层，半年一议，不因周度涨跌变动） */
  strategicStars: number
  /** 主线基准指数，用于相对强度计算 */
  benchmark: string
  members: UniverseMember[]
}

/**
 * 四条主线。第三/第四主线（AI电力、HBM/存储）处于冻结令"只研究不进组合"状态，
 * MSR 对其只输出研究结论，不输出建仓候选。
 */
export const MAINLINES: Mainline[] = [
  {
    id: 'optical',
    name: 'AI光通信',
    strategicStars: 5,
    benchmark: 'sz399006',
    members: [
      { code: '300308', name: '中际旭创', tier: 1, node: '光模块', evidence: 'S', champion: true, mainlineAttributionVerified: true },
      { code: '300502', name: '新易盛', tier: 1, node: '光模块', evidence: 'S', champion: true, mainlineAttributionVerified: true },
      { code: '300394', name: '天孚通信', tier: 2, node: '光器件/光引擎', evidence: 'A', note: '2026H1预告净利11.24–13.04亿(+25%~45%)；扣非口径待中报' },
      { code: '300620', name: '光库科技', tier: 2, node: '光器件/调制器', evidence: 'B', note: '2026H1预告扣非+199%~219%；AI收入占比待核' },
      { code: '002281', name: '光迅科技', tier: 2, node: '光模块/光器件', evidence: 'B' },
      { code: '688313', name: '仕佳光子', tier: 3, node: '光芯片/AWG/FAU', evidence: 'B', mainlineAttributionVerified: false, note: '2025扣非+670%主体为电信复苏与连接器，非AI；CPO FAU仅小批量。8/12裁定研究通过投资暂缓' },
      { code: '688498', name: '源杰科技', tier: 3, node: '光芯片/CW激光器', evidence: 'A', mainlineAttributionVerified: false, note: '2026H1预告净利6–6.5亿但扣非5–5.5亿，差额约1亿为私募基金公允价值变动' },
    ],
  },
  {
    id: 'semi',
    name: '半导体国产替代',
    strategicStars: 5,
    benchmark: 'sh000688',
    members: [
      { code: '002371', name: '北方华创', tier: 1, node: '设备平台', evidence: 'S', champion: true },
      { code: '688012', name: '中微公司', tier: 1, node: '刻蚀/MOCVD', evidence: 'S', champion: true },
      { code: '688072', name: '拓荆科技', tier: 2, node: '薄膜沉积', evidence: 'A' },
      { code: '688120', name: '华海清科', tier: 2, node: 'CMP', evidence: 'A' },
      { code: '300567', name: '精测电子', tier: 3, node: '量测/检测', evidence: 'B' },
      { code: '688361', name: '中科飞测', tier: 3, node: '量测/检测', evidence: 'B', note: 'PE 21683x，绝对估值不可比，须用历史分位' },
      { code: '688003', name: '天准科技', tier: 3, node: '检测装备', evidence: 'C' },
      { code: '603986', name: '兆易创新', tier: 3, node: '存储', evidence: 'C', retiredC: true, note: 'C级清退，7/26战略层终审关闭' },
      { code: '688008', name: '澜起科技', tier: 3, node: '互连芯片', evidence: 'C', retiredC: true, note: 'C级清退，7/26战略层终审关闭' },
    ],
  },
  {
    id: 'compute',
    name: 'AI算力',
    strategicStars: 5,
    benchmark: 'sh000688',
    members: [
      { code: '688041', name: '海光信息', tier: 1, node: 'CPU/DCU', evidence: 'S', champion: true },
      { code: '603019', name: '中科曙光', tier: 1, node: '系统集成', evidence: 'A', champion: true, note: '研究席位；是否持仓属战术层' },
      { code: '002463', name: '沪电股份', tier: 2, node: '互连PCB', evidence: 'S', champion: true },
      { code: '002916', name: '深南电路', tier: 2, node: '互连PCB', evidence: 'A', champion: true },
      { code: '600183', name: '生益科技', tier: 2, node: 'CCL材料', evidence: 'A' },
      { code: '002384', name: '东山精密', tier: 3, node: 'PCB/精密制造', evidence: 'B' },
    ],
  },
  {
    id: 'power',
    name: 'AI电力基础设施',
    strategicStars: 4,
    benchmark: 'sh000001',
    members: [
      { code: '000400', name: '许继电气', tier: 1, node: '电网升级', evidence: 'A' },
      { code: '600312', name: '平高电气', tier: 1, node: '电网升级', evidence: 'A' },
      { code: '002028', name: '思源电气', tier: 1, node: '电网设备', evidence: 'A', note: '60日波动率62.7%、PE 39x、7/17–7/31逆势+6.4%，全样本唯一低波低估低相关位置' },
      { code: '002851', name: '麦格米特', tier: 2, node: 'AI服务器电源', evidence: 'B', note: 'PE 480x' },
      { code: '300870', name: '欧陆通', tier: 2, node: 'AI服务器电源', evidence: 'B', note: 'PE 182x' },
      { code: '688292', name: '英维克', tier: 3, node: '液冷', evidence: 'B', note: 'PE 148x' },
    ],
  },
]

/** 冻结令：仅前两条为作战主线，第三第四只研究不进组合 */
export const COMBAT_MAINLINE_IDS = ['optical', 'semi', 'compute']
export const RESEARCH_ONLY_MAINLINE_IDS = ['power']

export function findMember(code: string): { mainline: Mainline; member: UniverseMember } | null {
  for (const m of MAINLINES) {
    const hit = m.members.find(x => x.code === code)
    if (hit) return { mainline: m, member: hit }
  }
  return null
}

export function allCodes(): string[] {
  return MAINLINES.flatMap(m => m.members.map(x => x.code))
}

export function allBenchmarks(): string[] {
  return Array.from(new Set(MAINLINES.map(m => m.benchmark)))
}
