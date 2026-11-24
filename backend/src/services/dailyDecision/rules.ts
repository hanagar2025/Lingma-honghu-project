/**
 * 执行单用到的全部规则。出处：《半年计划》（2026-11-24）第〇、二、三、五节。
 *
 *   卖出只由数据变坏触发，不因比例卖出：
 *     资金分连续 2 天 ≤1 → 减半；资金 0 分，或收盘跌破 60 日线且融资在降 → 清仓。
 *   单票上限 20%、相关环节合计 30% 只限制加仓，超过不卖。
 *   总仓位不设上限，由观察线 95、预警线 90、停手线 85 三条线管。
 *
 * 这里的数与 agents/honghu-digest/bot/lib/plan.ts 是同一套，两处由自检逐项比对。
 * 这里的数只能跟着《半年计划》改，不在代码里另起口径。
 */
import { CORE_CODES } from '../chain/universe'

export const PLAN = {
  /** 净值指数：基准时点的总资产记为 100 */
  lines: { target: 178, watch: 95, warn: 90, stop: 85 },
  /** 停手线只上移：到过 reach，停手线移到 stop */
  ratchets: [
    { reach: 121, stop: 100 },
    { reach: 147, stop: 125 },
  ],
  /** 进度线：到这一天净值指数要到多少 */
  checkpoints: [
    { date: '2026-12-20', index: 110 },
    { date: '2027-01-20', index: 121 },
    { date: '2027-02-20', index: 133 },
    { date: '2027-03-20', index: 147 },
    { date: '2027-04-20', index: 162 },
    { date: '2027-05-20', index: 178 },
  ],
  /** 触线后股票占比要降到多少以内 */
  equityCap: { warn: 0.5, stop: 0.3, target: 0.3 },
  /** 卖出：资金分连续 2 天不高于 halveMaxC → 减半；资金分不高于 clearMaxC，或收盘跌破 60 日线且 5 日融资为负 → 清仓 */
  sell: { halveMaxC: 1, halveDays: 2, clearMaxC: 0, trendClear: 'CLOSE_CROSSES_BELOW_MA60_AND_MARGIN5_NEGATIVE' },
  /** 加仓上限：证据分 → 单票占比上限。E≤3 不加 */
  addCap: { 6: 0.2, 5: 0.15, 4: 0.1 } as Readonly<Record<number, number>>,
  /** 相关环节合计上限，只限加仓 */
  related: { segments: ['光模块', 'PCB'] as readonly string[], cap: 0.3 },
  /** 新开仓：E≥5、当天涨幅 ≤3%、日成交 ≥10 亿、没有基本面扣分 */
  entry: { minE: 5, maxPct: 0.03, minAmount: 1_000_000_000 },
  /** 切换备用目标之后：单票上限 10%，股票 ≤50% */
  backup: { singleCap: 0.1, equityCap: 0.5 },
  /** 指令有效期：触发后的下一个交易日执行，没成交再顺延 3 个交易日，之后作废 */
  validTradingDays: 4,
} as const

/** 现在生效的停手线 */
export function stopLine(navHigh: number | null): number {
  let stop: number = PLAN.lines.stop
  for (const r of PLAN.ratchets) if (navHigh !== null && navHigh >= r.reach) stop = r.stop
  return stop
}

/** 下一个进度线对账日 */
export function nextCheckpoint(today: string): { date: string; index: number } | null {
  return PLAN.checkpoints.find(c => c.date >= today) ?? null
}

export type LineLevel = 'NO_BASE' | 'NORMAL' | 'WATCH' | 'WARN' | 'STOP' | 'TARGET'

export interface LinesCalc {
  /** 净值指数。null = 基准没填，或有持仓取不到价格 */
  navIndex: number | null
  navHigh: number | null
  /** 现在生效的停手线 */
  stop: number
  level: LineLevel
  /** 一切买入都停：停手线以下，或三条线核对不了 */
  buyBlocked: boolean
  /** 不开新股票：观察线以下 */
  newEntryBlocked: boolean
  /** 触线后股票占比的上限。null = 没有触线 */
  equityCap: number | null
}

/**
 * 三条线的唯一计算入口。指数算不出时返回 NO_BASE 而不是 NORMAL：
 * NORMAL 读作“都没触及”，NO_BASE 读作“核对不了”，核对不了时不买。
 * 指数等于线上的数算触及，与定时汇总的写法一致。
 */
export function computeLines(navIndex: number | null, navHigh: number | null): LinesCalc {
  const stop = stopLine(navHigh)
  const base = { navIndex, navHigh, stop }
  if (navIndex === null) return { ...base, level: 'NO_BASE', buyBlocked: true, newEntryBlocked: true, equityCap: null }
  if (navIndex >= PLAN.lines.target) return { ...base, level: 'TARGET', buyBlocked: true, newEntryBlocked: true, equityCap: PLAN.equityCap.target }
  if (navIndex <= stop) return { ...base, level: 'STOP', buyBlocked: true, newEntryBlocked: true, equityCap: PLAN.equityCap.stop }
  if (navIndex <= PLAN.lines.warn) return { ...base, level: 'WARN', buyBlocked: false, newEntryBlocked: true, equityCap: PLAN.equityCap.warn }
  if (navIndex <= PLAN.lines.watch) return { ...base, level: 'WATCH', buyBlocked: false, newEntryBlocked: true, equityCap: null }
  return { ...base, level: 'NORMAL', buyBlocked: false, newEntryBlocked: false, equityCap: null }
}

const isStar = (code: string): boolean => code.startsWith('688') || code.startsWith('689')

/**
 * 卖出持仓的一部分（减半、卖三分之一）要卖多少股。
 * 科创板单笔不少于 200 股、其上可按 1 股递增；其余板块按 100 股一手，四舍五入到整手，至少一手。
 * 算出来不少于持仓时就是清仓。
 */
export function sharesForFraction(code: string, held: number, fraction: number): number {
  if (!(held > 0)) return 0
  const raw = held * fraction
  const lot = isStar(code) ? Math.max(Math.round(raw), 200) : Math.max(Math.round(raw / 100) * 100, 100)
  return Math.min(lot, held)
}

/** 卖出一定金额要卖多少股。向上取整：宁多卖一股、不少卖一股 */
export function sharesForSellValue(code: string, value: number, px: number, held: number): number {
  if (!(value > 0) || !(px > 0) || !(held > 0)) return 0
  const raw = Math.ceil(value / px - 1e-9)
  const lot = isStar(code) ? Math.max(raw, 200) : Math.ceil(raw / 100) * 100
  return Math.min(lot, held)
}

/** 买入一定金额最多买多少股。向下取整：不超过上限。不足一手（科创板 200 股）时为 0 */
export function sharesForBuyValue(code: string, value: number, px: number): number {
  if (!(value > 0) || !(px > 0)) return 0
  const raw = Math.floor(value / px + 1e-9)
  if (isStar(code)) return raw >= 200 ? raw : 0
  return Math.floor(raw / 100) * 100
}

/** 不在 AI 全链核心名单内的持仓。只提示：通用卖出规则照样适用，但没有环节读数 */
export function outsideChain<T extends { code: string; quantity: number }>(holdings: readonly T[]): T[] {
  return holdings.filter(h => h.quantity > 0 && !CORE_CODES.includes(h.code))
}
