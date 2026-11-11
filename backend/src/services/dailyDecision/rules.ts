/**
 * 执行单用到的全部规则：仓位上限、回撤熔断、单票超限、卖出股数取整、主线外持仓。
 *
 * 只由账务事实构成，不含任何预测。执行单不依赖研究模块：
 * 研究模块出错或被删除，都不应让"今天规则要求做什么"这句话出不来。
 */
import { findMember } from '../msr/universe'

export const LIMITS = {
  singleStock: 0.12,
  sector: 0.30,
  theme: 0.45,
  cashFloor: 0.10,
  /** 组合回撤触发点：15% 降仓至 50%，25% 降至 30% 且只卖不买 */
  circuitLevel1: 0.15,
  circuitLevel2: 0.25,
} as const

export interface CircuitCalc {
  /** 自峰值回撤。null = 峰值与当前值不同口径或峰值缺失 */
  drawdown: number | null
  /** 触发的股票占比上限。null = 未触发或不可判定 */
  equityCap: number | null
  /** 二级熔断：只卖不买 */
  sellOnly: boolean
  level: 'NORMAL' | 'LEVEL1' | 'LEVEL2' | 'INCOMPARABLE'
}

/** 回撤与熔断的唯一计算入口。口径不可比时返回 null 而不是 0：0 读作"没跌过"，null 读作"算不出" */
export function computeCircuit(snapshot: {
  portfolioTotal: number
  peakAssets: number
  peakBasis: 'BROKER' | 'PORTFOLIO'
}): CircuitCalc {
  if (snapshot.peakBasis !== 'PORTFOLIO' || !(snapshot.peakAssets > 0)) {
    return { drawdown: null, equityCap: null, sellOnly: false, level: 'INCOMPARABLE' }
  }
  const drawdown = 1 - snapshot.portfolioTotal / snapshot.peakAssets
  if (drawdown >= LIMITS.circuitLevel2) {
    return { drawdown, equityCap: 0.30, sellOnly: true, level: 'LEVEL2' }
  }
  if (drawdown >= LIMITS.circuitLevel1) {
    return { drawdown, equityCap: 0.50, sellOnly: false, level: 'LEVEL1' }
  }
  return { drawdown, equityCap: null, sellOnly: false, level: 'NORMAL' }
}

export interface LimitBreach {
  code: string
  name: string
  currentPct: number
  excessValue: number
}

export function findLimitBreaches(
  positions: readonly { code: string; name: string; marketValue: number }[],
  portfolioTotal: number,
): LimitBreach[] {
  if (portfolioTotal <= 0) return []
  const out: LimitBreach[] = []
  for (const p of positions) {
    const pct = p.marketValue / portfolioTotal
    if (pct > LIMITS.singleStock) {
      out.push({ code: p.code, name: p.name, currentPct: pct, excessValue: p.marketValue - portfolioTotal * LIMITS.singleStock })
    }
  }
  return out.sort((a, b) => b.currentPct - a.currentPct)
}

/**
 * 卖回上限所需股数。必须向上取整：向下取整会让卖完仍超限
 * （海光 10/9：超出 1002.7 股，取 1000 股后仍为 12.02%）。
 * 科创板单笔不少于 200 股、其上可按 1 股递增；其余板块按 100 股一手；卖出量超过持仓时清仓。
 */
export function sharesToClearExcess(code: string, excessValue: number, px: number, held: number | null): number {
  const raw = Math.ceil(excessValue / px - 1e-9)
  const star = code.startsWith('688') || code.startsWith('689')
  const lot = star ? Math.max(raw, 200) : Math.ceil(raw / 100) * 100
  return held !== null && lot > held ? held : lot
}

/** 不在四条主线名单内的持仓。只提示，不产生指令：是否保留由委员会裁定 */
export function outsideMainline<T extends { code: string; quantity: number }>(holdings: readonly T[]): T[] {
  return holdings.filter(h => h.quantity > 0 && findMember(h.code) === null)
}
