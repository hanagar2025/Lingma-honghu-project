/**
 * 一只股票必须同时存在的三个完全不同的状态。
 *
 *   A. Ownership  值不值得拥有？（战略资格）
 *   B. Exposure   组合里应该拥有多少？（conviction × 组合风险）
 *   C. Action     现在资本动作是什么？
 *
 * 三条轴不能混。混在一起的后果已经发生过：
 *   海光超限被读成「海光没有价值」；
 *   兆易存储产业变好被读成「可以买回来」。
 *
 * ── 关于「甚至可以全仓」──
 *
 * 公司质量可以抬高 conviction 上限，但不能单独推出 100%。
 * 单一公司风险、造假、管理层、监管、流动性、相关性，仍由组合风险封顶。
 * 今日组合硬顶仍是单票 12%。质量再好，实际允许 = min(conviction, 组合硬顶)。
 *
 * 本文件不生产动作，不新增指标。
 */

import { LIMITS } from '../cockpit/safety'

export type Ownership =
  | 'STRATEGIC_CORE'
  | 'STRATEGIC_ALLOWED'
  | 'STRATEGIC_WATCH'
  | 'STRATEGIC_VETO'
  | 'RETIRED'

export const OWNERSHIP_TEXT: Record<Ownership, string> = {
  STRATEGIC_CORE: '战略核心',
  STRATEGIC_ALLOWED: '战略允许',
  STRATEGIC_WATCH: '战略观察',
  STRATEGIC_VETO: '战略否决',
  RETIRED: '清退',
}

export function ownershipAllows(o: Ownership): boolean {
  return o === 'STRATEGIC_CORE' || o === 'STRATEGIC_ALLOWED'
}

/**
 * conviction 决定「最多可以拥有多少」。
 * 这是愿望上限，不是动作。0 表示战略上不应配置。
 */
export const CONVICTION_CAP: Record<Ownership, number> = {
  STRATEGIC_CORE: 0.12,
  STRATEGIC_ALLOWED: 0.08,
  STRATEGIC_WATCH: 0,
  STRATEGIC_VETO: 0,
  RETIRED: 0,
}

/** 组合硬顶。与 safety.LIMITS.singleStock 同源，禁止手抄。 */
export const PORTFOLIO_HARD_CAP = LIMITS.singleStock

/** 公司质量永远不能单独推出满仓。 */
export const QUALITY_NEVER_IMPLIES_FULL = true

export function actualAllowed(convictionCap: number, portfolioCap: number): number {
  return Math.min(convictionCap, portfolioCap)
}

export type ExposureStatus = 'OVER' | 'WITHIN' | 'UNKNOWN'

export interface Exposure {
  currentPct: number | null
  convictionCap: number
  portfolioCap: number
  allowedPct: number
  /** 相对组合硬顶（12%）。超限是 R1，不是公司变坏。 */
  portfolioStatus: ExposureStatus
  /** 相对 conviction。清退持仓会 OVER，但那是资格问题，不得记成 R1。 */
  vsConviction: ExposureStatus
}

export function buildExposure(currentPct: number | null, ownership: Ownership): Exposure {
  const convictionCap = CONVICTION_CAP[ownership]
  const portfolioCap = PORTFOLIO_HARD_CAP
  const allowedPct = actualAllowed(convictionCap, portfolioCap)
  return {
    currentPct,
    convictionCap,
    portfolioCap,
    allowedPct,
    portfolioStatus: currentPct === null
      ? 'UNKNOWN'
      : currentPct > portfolioCap ? 'OVER' : 'WITHIN',
    vsConviction: currentPct === null
      ? 'UNKNOWN'
      : currentPct > allowedPct ? 'OVER' : 'WITHIN',
  }
}

/**
 * 投资人首屏的五个资本动作。不是 BUY/SELL。
 * 减少暴露必须再看理由，才能知道是战略、公司还是组合。
 */
export type CapitalAction =
  | 'INCREASE_CAPITAL'
  | 'HOLD_CAPITAL'
  | 'OBSERVE'
  | 'REDUCE_EXPOSURE'
  | 'EXIT'

export const CAPITAL_ACTION_TEXT: Record<CapitalAction, string> = {
  INCREASE_CAPITAL: '增加资本',
  HOLD_CAPITAL: '维持资本',
  OBSERVE: '观察',
  REDUCE_EXPOSURE: '减少暴露',
  EXIT: '退出',
}

export interface OwnershipInput {
  retiredC: boolean
  combat: boolean
  champion: boolean
  industryVerified: boolean
  earningsVerified: boolean
  inUniverse: boolean
}

export function judgeOwnership(p: OwnershipInput): Ownership {
  if (p.retiredC) return 'RETIRED'
  if (!p.inUniverse) return 'STRATEGIC_WATCH'
  if (!p.combat) return 'STRATEGIC_VETO'
  if (p.champion && p.industryVerified && p.earningsVerified) return 'STRATEGIC_CORE'
  if (p.industryVerified || p.earningsVerified) return 'STRATEGIC_ALLOWED'
  return 'STRATEGIC_WATCH'
}
