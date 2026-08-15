// 净值峰值的双口径历史
//
// 委员会 2026-08-15：「把峰值重建成两套历史，不要粗暴覆盖。」
//
// ── 为什么不能覆盖 ──
//
// 旧峰值 430 万记于券商账户口径；组合口径当前 533 万已大于它。
// 三件事都不能做：
//   ① 直接相减 → 得出负回撤 → 熔断静默失效，而页面上一切正常；
//   ② 宣布 533 万为新峰值 → 一次口径迁移把历史回撤记录整段抹掉；
//   ③ 判为"回撤 0%、无熔断" → 把"不知道"当成"没问题"。
//
// 正确做法是并存两套，且**新口径只从能可靠重建的最早日期开始**。
// 重建不了的日期标 NOT_COMPARABLE —— 因为历史上每一天的"账户外股票现金"
// 我们并没有记录，而缺失的那部分不能用今天的 200 万往回抹平：
// 那等于假设这笔钱一直存在且金额不变，而这个假设没有任何依据。

export type PeakBasis = 'legacy_account_basis' | 'portfolio_basis_v1'

export interface PeakRecord {
  basis: PeakBasis
  /** 峰值金额（元）。null 表示该口径下尚无可靠数据 */
  peak: number | null
  /** 峰值出现日期 */
  peakDate: string | null
  /** 该口径可信区间的起始日。此前的日期一律 NOT_COMPARABLE */
  reliableFrom: string | null
  note: string
}

/** 两套历史。legacy 永不删除 */
export const PEAK_HISTORY: PeakRecord[] = [
  {
    basis: 'legacy_account_basis',
    peak: 4_300_000,
    peakDate: null,
    reliableFrom: null,
    note: '券商账户口径（持仓 + 账内现金）历史峰值 430 万。'
      + '**永不删除。** 它是 7/17–8/14 期间全部熔断判定与执行债务的依据，'
      + '删掉它等于让那段历史无法复核。'
      + '峰值出现的具体日期尚未从日志中考据，故留 null —— 不猜。',
  },
  {
    basis: 'portfolio_basis_v1',
    peak: null,
    peakDate: null,
    reliableFrom: null,
    note: '组合口径（持仓 + 账内现金 + 账户外股票现金）。'
      + '尚未建立：历史上每一天的账户外股票现金余额没有记录，'
      + '而用今天的 200 万往回抹平等于假设它一直存在且金额不变 —— 这个假设没有依据。'
      + '须由委员会给出该笔资金的起始日与期间变动，才能确定 reliableFrom 并回溯峰值。',
  },
]

export type CircuitState = 'NORMAL' | 'LEVEL1' | 'LEVEL2' | 'INCOMPARABLE'

export interface CircuitVerdict {
  state: CircuitState
  drawdown: number | null
  /** 用于判定的峰值与其口径 */
  usedPeak: number | null
  usedBasis: PeakBasis | null
  reason: string
}

/**
 * 熔断判定。
 *
 * **口径不一致时返回 INCOMPARABLE，而不是 NORMAL。**
 * 这个区别是本模块存在的全部理由：NORMAL 意味着"已检查，没问题"，
 * INCOMPARABLE 意味着"无法检查"。把后者显示成前者，
 * 等于在风控开关坏掉的时候亮一盏绿灯。
 */
export function judgeCircuit(
  portfolioTotal: number,
  history: PeakRecord[] = PEAK_HISTORY,
  levels: { level1: number; level2: number } = { level1: 0.15, level2: 0.25 }
): CircuitVerdict {
  const v1 = history.find(h => h.basis === 'portfolio_basis_v1')
  if (!v1 || v1.peak === null) {
    const legacy = history.find(h => h.basis === 'legacy_account_basis')
    return {
      state: 'INCOMPARABLE',
      drawdown: null,
      usedPeak: null,
      usedBasis: null,
      reason: '组合口径峰值尚未建立，无法计算回撤。'
        + `旧口径峰值 ${legacy?.peak !== null && legacy?.peak !== undefined ? `${(legacy.peak / 10000).toFixed(0)}万` : '缺失'}`
        + '记于券商账户口径，与组合口径不可比 —— '
        + '**不得据此判为"回撤 0%"或"无熔断"**，那是把"无法检查"显示成"已检查无问题"。',
    }
  }
  const dd = 1 - portfolioTotal / v1.peak
  const state: CircuitState = dd >= levels.level2 ? 'LEVEL2' : dd >= levels.level1 ? 'LEVEL1' : 'NORMAL'
  return {
    state, drawdown: dd, usedPeak: v1.peak, usedBasis: 'portfolio_basis_v1',
    reason: `组合口径回撤 ${(dd * 100).toFixed(1)}%`
      + `（峰值 ${(v1.peak / 10000).toFixed(1)}万，${v1.peakDate ?? '日期未记录'}）`,
  }
}

/**
 * 组合口径峰值的两种候选情形。
 *
 * 取哪一种，取决于一个只有委员会知道的事实：
 * **账户峰值 430 万出现时，那 200 万是否已经存在且已划为股票投资用途。**
 *
 * 两种结论相差一次强制降仓，所以不能由代码挑一个默认值 ——
 * 而且默认值天然会偏向"不触发"，因为那是什么都不用做的那个。
 */
export interface PeakScenario {
  id: 'A_NEW_SERIES' | 'B_INCLUDED_AT_PEAK'
  question: string
  peak: number
  drawdown: number
  circuit: CircuitState
  equityCapPct: number | null
  requiredReduction: number | null
  note: string
}

export function peakScenarios(
  portfolioTotal: number,
  positionsValue: number,
  legacyAccountPeak: number,
  externalCash: number,
  levels: { level1: number; level2: number } = { level1: 0.15, level2: 0.25 }
): PeakScenario[] {
  const build = (
    id: PeakScenario['id'], question: string, peak: number, note: string
  ): PeakScenario => {
    const dd = 1 - portfolioTotal / peak
    const circuit: CircuitState = dd >= levels.level2 ? 'LEVEL2'
      : dd >= levels.level1 ? 'LEVEL1' : 'NORMAL'
    const cap = circuit === 'LEVEL2' ? 0.30 : circuit === 'LEVEL1' ? 0.50 : null
    const target = cap === null ? null : portfolioTotal * cap
    return {
      id, question, peak, drawdown: dd, circuit,
      equityCapPct: cap,
      requiredReduction: target === null ? null : Math.max(0, positionsValue - target),
      note,
    }
  }
  return [
    build(
      'A_NEW_SERIES',
      '这 200 万是最近才划为股票投资用途的？',
      portfolioTotal,
      '组合口径序列自今日起建立，今日值即当前峰值 → 回撤 0%。'
      + '**注意这等于把回撤时钟归零**：账户口径下已发生的回撤不再触发熔断。'
      + 'legacy_account_basis 仍保留 430 万，那段历史可复核，但不再产生约束。'
    ),
    build(
      'B_INCLUDED_AT_PEAK',
      '账户峰值 430 万出现时，这 200 万已经存在且已划为股票投资用途？',
      legacyAccountPeak + externalCash,
      '组合峰值 = 账户峰值 + 账户外现金。这是把旧峰值平移到新口径，'
      + '前提是那笔钱当时确实已在"股票投资资产"之内。'
    ),
  ]
}

export function renderPeakScenarios(rows: PeakScenario[]): string {
  const w = (v: number) => `${(v / 10000).toFixed(2)}万`
  const L: string[] = ['', '组合口径峰值：两种候选情形', '─'.repeat(78)]
  for (const r of rows) {
    L.push('')
    L.push(`  ${r.id}`)
    L.push(`    前提问题：${r.question}`)
    L.push(`    峰值 ${w(r.peak)}　回撤 ${(r.drawdown * 100).toFixed(2)}%　熔断 ${r.circuit}`)
    if (r.equityCapPct !== null) {
      L.push(`    股票上限 ${(r.equityCapPct * 100).toFixed(0)}%`
        + `　须减约 ${w(r.requiredReduction ?? 0)}`)
    }
    L.push(`    说明：${r.note}`)
  }
  L.push('')
  L.push('  两者相差一次强制降仓，故不由代码挑默认值 ——')
  L.push('  而且默认值天然会偏向"不触发"，因为那是什么都不用做的那个。')
  L.push('')
  return L.join('\n')
}

export function renderPeakHistory(history: PeakRecord[] = PEAK_HISTORY): string {
  const L: string[] = ['净值峰值双口径历史', '─'.repeat(78)]
  for (const h of history) {
    L.push('')
    L.push(`  ${h.basis}`)
    L.push(`    峰值　　 ${h.peak === null ? '尚未建立' : `${(h.peak / 10000).toFixed(1)}万`}`)
    L.push(`    峰值日期 ${h.peakDate ?? '未考据'}`)
    L.push(`    可信起始 ${h.reliableFrom ?? '未确定'}`)
    L.push(`    说明　　 ${h.note}`)
  }
  return L.join('\n')
}
