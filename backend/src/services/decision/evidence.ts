/**
 * 九层决策证据链。
 *
 * 委员会把鸿鹄最终固定成这九层，然后才进入组合暴露 → 生命线 → 战术动作。
 * 本模块**只组织已有数据**。测不到的层必须写 UNKNOWN，不得用均线、PE 分位
 * 或研究台账去填。
 *
 * 层名刻意不用研究台账的特征文本（例如「主线收入归因」），
 * 以免决策输出被当成研究结论的另一份拷贝。
 *
 * 本文件不 import 任何数据源，不 import makeAction。
 */

export type LayerStatus =
  | 'ESTABLISHED'
  | 'STRENGTHENING'
  | 'WEAKENING'
  | 'UNKNOWN'
  | 'FALSIFIED'

export const LAYER_STATUS_TEXT: Record<LayerStatus, string> = {
  ESTABLISHED: '成立',
  STRENGTHENING: '强化',
  WEAKENING: '弱化',
  UNKNOWN: '未知',
  FALSIFIED: '证伪',
}

export type LayerId =
  | 'MAINLINE'
  | 'NODE_PROFIT'
  | 'COMPETITIVE'
  | 'REVENUE_FLAG'
  | 'PROFIT_ATTR'
  | 'FORWARD'
  | 'CASHFLOW'
  | 'EXPECTATION'
  | 'QUALIFICATION'

export interface LayerDef {
  id: LayerId
  name: string
  /** 当前系统是否具备判定所需的数据。false = 本层只能输出 UNKNOWN */
  measurable: boolean
}

/**
 * 九层顺序即决策顺序。不可重排。
 * 后四层（利润核验 / 前瞻 / 现金流 / 预期）今日不可测。
 */
export const LAYER_DEFS: readonly LayerDef[] = [
  { id: 'MAINLINE', name: '产业主线', measurable: true },
  { id: 'NODE_PROFIT', name: '节点利润', measurable: true },
  { id: 'COMPETITIVE', name: '公司竞争地位', measurable: true },
  { id: 'REVENUE_FLAG', name: '目标主线收入核验', measurable: true },
  { id: 'PROFIT_ATTR', name: '目标主线利润核验', measurable: false },
  { id: 'FORWARD', name: '未来盈利证据', measurable: false },
  { id: 'CASHFLOW', name: '现金流与利润质量', measurable: false },
  { id: 'EXPECTATION', name: '市场预期与可证明增长', measurable: false },
  { id: 'QUALIFICATION', name: '战略资格', measurable: true },
]

export interface EvidenceLayer {
  id: LayerId
  name: string
  status: LayerStatus
  fact: string
  measurable: boolean
}

export interface EvidenceChain {
  layers: readonly EvidenceLayer[]
  /** 成立或强化的层数。这是计数，不是评分，不可排序、不可加权。 */
  standing: number
  unknown: readonly string[]
}

export interface EvidenceFacts {
  combat: boolean
  retiredC: boolean
  champion: boolean
  industryVerified: boolean
  earningsVerified: boolean
  /** true = 已核验旗标；false/undefined = 未核验。未核验 ≠ 证伪。 */
  revenueFlag: boolean | null
  strategyAllows: boolean
  nodeName: string | null
  levelShare: number | null
  delta4Q: number | null
  npAbsDeltaSum: number | null
  shareWithinNode: number | null
  npAbsDelta: number | null
}

export function standingOf(chain: EvidenceChain): number {
  return chain.layers.filter(l =>
    l.status === 'ESTABLISHED' || l.status === 'STRENGTHENING').length
}

export function layerOf(chain: EvidenceChain, id: LayerId): EvidenceLayer {
  const hit = chain.layers.find(l => l.id === id)
  if (!hit) throw new Error(`证据链缺少层 ${id}`)
  return hit
}

export function buildEvidence(f: EvidenceFacts): EvidenceChain {
  const layers: EvidenceLayer[] = LAYER_DEFS.map(def => {
    switch (def.id) {
      case 'MAINLINE': return layer(def, mainlineOf(f))
      case 'NODE_PROFIT': return layer(def, nodeOf(f))
      case 'COMPETITIVE': return layer(def, competitiveOf(f))
      case 'REVENUE_FLAG': return layer(def, revenueOf(f))
      case 'PROFIT_ATTR': return layer(def, {
        status: 'UNKNOWN',
        fact: '目标主线对利润的贡献尚未可测。公司净利增量 ≠ 主线利润核验。',
      })
      case 'FORWARD': return layer(def, {
        status: 'UNKNOWN',
        fact: '订单、客户、产能、ASP、出货、资本开支、库存与指引尚未接入决策层。',
      })
      case 'CASHFLOW': return layer(def, {
        status: 'UNKNOWN',
        fact: '经营现金流、应收、存货、资本开支与自由现金流尚未接入决策层。盈利验证旗标不是现金流质量。',
      })
      case 'EXPECTATION': return layer(def, {
        status: 'UNKNOWN',
        fact: 'R4 预期—估值错配尚未可测。不得用 PE 历史分位或均线位置代替。',
      })
      case 'QUALIFICATION': return layer(def, qualificationOf(f))
    }
  })
  const chain: EvidenceChain = {
    layers,
    standing: 0,
    unknown: layers.filter(l => l.status === 'UNKNOWN').map(l => l.name),
  }
  return { ...chain, standing: standingOf(chain) }
}

function layer(def: LayerDef, body: { status: LayerStatus; fact: string }): EvidenceLayer {
  return { id: def.id, name: def.name, measurable: def.measurable, ...body }
}

function mainlineOf(f: EvidenceFacts): { status: LayerStatus; fact: string } {
  if (!f.combat) {
    return { status: 'UNKNOWN', fact: '该主线处于只研究不进组合，不能作为资本配置主线判断。' }
  }
  return { status: 'ESTABLISHED', fact: '作战主线仍在册，战略层未关闭这条产业方向。' }
}

function nodeOf(f: EvidenceFacts): { status: LayerStatus; fact: string } {
  if (!f.nodeName || f.delta4Q === null) {
    return { status: 'UNKNOWN', fact: '节点利润份额或四季变化缺失。' }
  }
  const share = f.levelShare === null ? '缺失' : `${(f.levelShare * 100).toFixed(0)}%`
  const d = `${f.delta4Q > 0 ? '+' : ''}${f.delta4Q.toFixed(1)}pct`
  if (f.delta4Q > 0) {
    return {
      status: 'STRENGTHENING',
      fact: `节点「${f.nodeName}」利润份额 ${share}，四季 ${d}。利润未从该节点逃走。`,
    }
  }
  if (f.delta4Q < 0) {
    const cake = f.npAbsDeltaSum !== null && f.npAbsDeltaSum < 0
    return {
      status: 'WEAKENING',
      fact: cake
        ? `节点「${f.nodeName}」份额四季 ${d}，且节点利润绝对增量 < 0。须核查蛋糕是否在缩小。`
        : `节点「${f.nodeName}」份额四季 ${d}。份额下降是复核，不是主线证伪。`,
    }
  }
  return {
    status: 'ESTABLISHED',
    fact: `节点「${f.nodeName}」利润份额 ${share}，四季变化为 0。`,
  }
}

function competitiveOf(f: EvidenceFacts): { status: LayerStatus; fact: string } {
  if (f.champion) {
    const share = f.shareWithinNode === null
      ? '节点内份额缺失'
      : `节点内份额 ${(f.shareWithinNode * 100).toFixed(0)}%`
    return { status: 'ESTABLISHED', fact: `仍是节点冠军席位。${share}。` }
  }
  return { status: 'UNKNOWN', fact: '不是冠军席位，竞争地位不能从现有字段判定。' }
}

function revenueOf(f: EvidenceFacts): { status: LayerStatus; fact: string } {
  if (f.revenueFlag === true) {
    return { status: 'ESTABLISHED', fact: '目标主线收入核验旗标已通过。这是旗标，不是产品线拆分。' }
  }
  return { status: 'UNKNOWN', fact: '目标主线收入核验尚未完成。收入增长 ≠ 目标主线在创造增长。' }
}

function qualificationOf(f: EvidenceFacts): { status: LayerStatus; fact: string } {
  if (f.retiredC) {
    return { status: 'FALSIFIED', fact: 'C 级清退：战略资格已关闭。产业向好不能恢复资格。' }
  }
  if (!f.strategyAllows) {
    return { status: 'FALSIFIED', fact: '战略层不允许该标的进入组合。' }
  }
  if (f.industryVerified && f.earningsVerified) {
    return { status: 'ESTABLISHED', fact: '产业验证与盈利验证均已通过，战略资格未关闭。' }
  }
  return { status: 'UNKNOWN', fact: '战略层允许研究，但产业或盈利验证尚未完成。' }
}
