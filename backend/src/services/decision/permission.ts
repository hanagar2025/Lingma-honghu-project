/**
 * 资本迁移资格。与 Ownership / 核心持有不是同一件事。
 *
 * 第一层 Ownership Gate：我为什么应该拥有它？
 * 第二层 Capital Migration Gate：为什么现在应该把更多资本给它？
 *
 * 好公司 ≠ 应该加仓。
 * 好公司 + 新的独立证据 + 风险允许 + 资本还有空间 = 才有迁移资格。
 *
 * 核心持有只回答第一层。本文件回答第二层。
 * 不生产动作，不改生命线定义。
 */

import { CORE_IS_NOT_ADD_PERMISSION, type GateVerdict } from './capitalGates'
import type { ExpectationVerdict } from './r4'
import type { HunterStage } from './hunter'
import { ownershipAllows, type Ownership } from './triaxis'

export type RaiseVerdict = 'RAISE' | 'HOLD' | 'REDUCE' | 'EXIT' | 'UNJUDGABLE'

export interface RaiseInput {
  ownership: Ownership
  hunter: HunterStage
  exposureOver: boolean
  add: GateVerdict
  topUp: GateVerdict
  r4: ExpectationVerdict
  /** 今日是否真有新的、去重后的独立族。缺省按闸门 gained。 */
  newIndependentFamilies?: number
}

export interface RaiseResult {
  ok: boolean
  verdict: RaiseVerdict
  why: string
}

export function coreGrantsAddPermission(): boolean {
  return !CORE_IS_NOT_ADD_PERMISSION
}

export function canRaiseCapital(p: RaiseInput): RaiseResult {
  if (p.ownership === 'RETIRED' || p.ownership === 'STRATEGIC_VETO') {
    return { ok: false, verdict: 'EXIT', why: '战略层不允许拥有，没有加仓资格。' }
  }
  if (!ownershipAllows(p.ownership)) {
    return { ok: false, verdict: 'UNJUDGABLE', why: '尚未获得拥有资格，谈不上提高资本权重。' }
  }
  if (p.exposureOver) {
    return { ok: false, verdict: 'REDUCE', why: '组合已超限。先降暴露，不是价值判断。' }
  }
  if (p.r4 === 'STRETCHED') {
    return {
      ok: false, verdict: 'HOLD',
      why: 'R4 透支。贵 ≠ 必须卖，但不得再增加资本。',
    }
  }
  if (p.r4 === 'UNKNOWN' && (p.add.gained.length + p.topUp.gained.length) === 0) {
    return {
      ok: false, verdict: 'UNJUDGABLE',
      why: 'R4 未测，且没有新的独立证据族。不允许把核心持有读成可以继续加仓。',
    }
  }

  const gained = p.newIndependentFamilies
    ?? Math.max(p.add.gained.length, p.topUp.gained.length)
  if (p.hunter === 'CORE' && gained === 0) {
    return {
      ok: false, verdict: 'HOLD',
      why: '核心 = 可以长期拥有。核心 ≠ 可以继续加仓。没有新的独立证据族，不得提高权重。',
    }
  }
  if (p.add.ok || p.topUp.ok) {
    if (gained <= 0) {
      return {
        ok: false, verdict: 'HOLD',
        why: '闸门表面上通过，但去重后没有新的独立族。同一件事被重复记录不算加仓理由。',
      }
    }
    return {
      ok: true, verdict: 'RAISE',
      why: p.topUp.ok ? p.topUp.why : p.add.why,
    }
  }
  return {
    ok: false, verdict: 'HOLD',
    why: p.add.why || '没有资本向上迁移资格。',
  }
}
