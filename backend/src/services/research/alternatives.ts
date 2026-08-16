/**
 * 替代解释闸门。
 *
 * ── 它拦的是哪一步 ──
 *
 * 即使主线收入归因成立(即"这笔增量确实来自 AI 存储产品线"),
 * 也**还不能**得到:
 *
 *   AI 需求 → 公司业绩改善
 *
 * 因为同一笔增量至少有五种竞争性解释,它们与"AI 需求爆发"在财务数字上
 * 长得一模一样。归因回答的是「钱从哪条产品线来」,
 * 替代解释回答的是「那条产品线为什么多赚了」——**两个问题**。
 *
 * 委员会 2026-08-16 裁定:五项全部排除,才允许讨论 AI 因果;
 * 任一项未核查,AI 因果层一律保持 UNKNOWN。
 *
 * ── 为什么闸门要写成"全部排除才放行"而不是打分 ──
 *
 * 打分会让"四项排除、一项未查"变成 80 分,读起来像"基本成立"。
 * 而实际上未查的那一项可能正是全部解释 —— 例如渠道补库存,
 * 它能单独造出一整个季度的收入增长。
 * 竞争性解释不是可以加权求和的,它们是**析取关系**:任一成立即足以替代 AI。
 */

export type AltStatus =
  /** 已用数据排除该解释 */
  | 'RULED_OUT'
  /** 数据显示该解释成立 —— AI 因果被它替代 */
  | 'CONFIRMED_AS_CAUSE'
  /** 尚未核查 */
  | 'UNCHECKED'
  /** 核查过但数据不足以判断 */
  | 'INCONCLUSIVE'

export const ALT_STATUS_TEXT: Record<AltStatus, string> = {
  RULED_OUT: '已排除',
  CONFIRMED_AS_CAUSE: '成立 —— 该解释可替代 AI 因果',
  UNCHECKED: '未核查',
  INCONCLUSIVE: '数据不足，无法判断',
}

export interface Alternative {
  no: number
  name: string
  /** 这个解释具体在说什么 —— 写清楚，否则会被当成一句套话跳过 */
  claim: string
  /** 排除它需要什么数据 */
  needs: string
  status: AltStatus
  /** 当前依据。UNCHECKED 时写为什么还没查 */
  basis: string
  /** 与毛利率待核验清单的交叉引用。避免两处各写一份、改了一处忘了另一处 */
  crossRef?: string
}

export const ALTERNATIVES: readonly Alternative[] = [
  {
    no: 1,
    name: 'ASP 上涨',
    claim: '收入增长主要来自涨价，而不是需求量增加。'
      + '涨价可以来自缺货、汇率或产品线调价，与终端需求是否变大无关。',
    needs: '主线产品的销量与均价拆分（验证链第 4 环「数量/价格拆分」）',
    status: 'UNCHECKED',
    basis: '半导体公司通常不披露分产品销量与 ASP，须从下游出货量与行业价格指数间接推算。'
      + '公司公告里的「量价齐升」是定性表述，不能替代数量/价格拆分 ——'
      + '它恰好把这两项合在一起说，而这里要的是把它们分开。',
  },
  {
    no: 2,
    name: '产品结构变化',
    claim: '高毛利产品占比提升可造成利润跃升，而各产品线自身的需求与价格都没变。',
    needs: '分产品线收入与毛利率（年报附注，公开可得但尚未接入）',
    status: 'UNCHECKED',
    basis: '尚未接入分产品收入表。这是工作量缺口，不是付费数据缺口。',
    crossRef: '与毛利率待核验清单第 1 项同源；两处指向同一份数据，勿各查一遍',
  },
  {
    no: 3,
    name: '同行退出 / 供给收缩',
    claim: '公司份额提升可能来自竞争对手减产或退出，而不是需求爆发。'
      + '此时行业总量未变，只是分配变了。',
    needs: '同业收入与产能变化、行业总产量',
    status: 'UNCHECKED',
    basis: '同业毛利率对照已在管道内，但收入与产能对照尚未接入。'
      + '注意：同业毛利率同步改善不能排除本项 —— 供给收缩会让所有留存者一起受益。',
    crossRef: '与因果强度「行业同步」层相关，但不等价：'
      + '行业同步问"是否一起变好"，本项问"变好是因为需求还是因为对手退出"',
  },
  {
    no: 4,
    name: '库存周期',
    claim: '渠道补库存可制造短期收入增长，终端需求未必持续。'
      + '补库存结束时收入会掉回去，而那时"超级周期"叙事已经被用来买过了。',
    needs: '公司存货与渠道库存周转、下游客户库存水位',
    status: 'UNCHECKED',
    basis: '公司存货为公开披露项（尚未接入）；渠道与客户库存需第三方数据。'
      + '本项对判断持续性尤其关键 —— 它是"单季爆发"最常见的成因。',
  },
  {
    no: 5,
    name: '会计 / 产品分类变化',
    claim: '会计口径调整或业务重分类可在没有任何经营变化的情况下改变毛利率与收入结构。',
    needs: '财报附注中的会计政策变更、分部报告口径说明、上期数追溯调整',
    status: 'UNCHECKED',
    basis: '「本项必须保留」—— 兆易创新毛利率 37.4% → 57.1% 已被判为本期偏离自身历史，'
      + '在读过附注之前无法排除口径原因。',
    crossRef: '与毛利率待核验清单第 5 项同源',
  },
] as const

export interface AltGate {
  /** 是否允许讨论 AI 因果 */
  allowsCausalClaim: boolean
  ruledOut: number
  unchecked: number
  inconclusive: number
  /** 已被证实可替代 AI 的解释 */
  confirmedAlternatives: string[]
  verdict: string
}

/**
 * 闸门判定。
 *
 * 放行条件刻意严格:**五项全部 RULED_OUT**。
 * 任一项处于 UNCHECKED / INCONCLUSIVE / CONFIRMED_AS_CAUSE 都不放行。
 */
export function judgeAlternatives(list: readonly Alternative[] = ALTERNATIVES): AltGate {
  const ruledOut = list.filter(a => a.status === 'RULED_OUT').length
  const unchecked = list.filter(a => a.status === 'UNCHECKED').length
  const inconclusive = list.filter(a => a.status === 'INCONCLUSIVE').length
  const confirmed = list.filter(a => a.status === 'CONFIRMED_AS_CAUSE')
  const allowsCausalClaim = ruledOut === list.length

  const verdict = allowsCausalClaim
    ? `五项竞争性解释全部排除 → 允许进入 AI 因果讨论（仍不等于允许买入）。`
    : confirmed.length
      ? `${confirmed.map(a => a.name).join('、')} 已被证实成立 →`
        + ' AI 因果被该解释替代，不得再以 AI 需求解释本次改善。'
      : `${list.length} 项竞争性解释中 ${ruledOut} 项已排除、${unchecked} 项未核查`
        + `${inconclusive ? `、${inconclusive} 项数据不足` : ''} →`
        + ' AI 因果层保持未知。'
        + '「竞争性解释是析取关系，不是可加权求和的分数」——'
        + '未查的那一项可能正是全部解释（例如渠道补库存能单独造出一个季度的增长）。'

  return {
    allowsCausalClaim, ruledOut, unchecked, inconclusive,
    confirmedAlternatives: confirmed.map(a => a.name),
    verdict,
  }
}

export function renderAlternatives(list: readonly Alternative[] = ALTERNATIVES): string {
  const g = judgeAlternatives(list)
  const L: string[] = ['', '替代解释闸门', '─'.repeat(78)]
  L.push('  归因回答「钱从哪条产品线来」；本闸门回答「那条产品线为什么多赚了」。')
  L.push('  即使主线收入归因成立，五项未全部排除前，AI 因果一律保持未知。')
  L.push('')
  for (const a of list) {
    const mk = a.status === 'RULED_OUT' ? '✓'
      : a.status === 'CONFIRMED_AS_CAUSE' ? '✗' : '·'
    L.push(`  ${mk} ${a.no}. ${a.name}　【${ALT_STATUS_TEXT[a.status]}】`)
    L.push(`      主张：${a.claim}`)
    L.push(`      排除需要：${a.needs}`)
    L.push(`      当前：${a.basis}`)
    if (a.crossRef) L.push(`      交叉引用：${a.crossRef}`)
  }
  L.push('')
  L.push(`  闸门：${g.allowsCausalClaim ? '放行' : '不放行'}　${g.verdict}`)
  L.push('')
  return L.join('\n')
}
