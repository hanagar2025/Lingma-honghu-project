// 执行债务重审 —— 按 2026-08-15 组合口径逐条分类
//
// 委员会 2026-08-15：「先纠正账，再统计执行率。否则你会拿一个错误的仓位模型，
// 去惩罚自己的执行能力 —— 这才是真正危险的系统错误。」
// 并明确要求：「不要用『撤销/不撤销』二元处理」，只允许四种终态。
//
// ── 三条刻意的约束 ──
//
// 一、**不生成任何交易指令。** 这一层只回答"原指令的法定前提是否仍成立"。
//    撤销与执行都属执行层，须委员会逐笔确认。一次数据校准不该自行变成一次交易决策。
//
// 二、**分类依据必须可查。** 每条债务的原始法定理由与出处行号存在
//    executionDebts.json 里，由决策日志重建。凭记忆分类等于重新编一遍 ——
//    而这次重审的全部意义就在于"原命题的输入口径错了"，
//    要判断这一点，必须先确知原命题是什么。
//
// 三、**熔断类不得凭现值判断。** 峰值仍是券商账户口径，回撤不可比，
//    故熔断类债务只能判为需重算，不能因为"现在看着没超"就消掉。

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { LIMITS, singleNameWeight } from '../cockpit/safety'
import type { AccountSnapshot, Position } from '../tios/types'

const HERE = dirname(fileURLToPath(import.meta.url))
export const DEBTS_FILE = join(HERE, 'data', 'executionDebts.json')

export interface DebtRecord {
  id: string
  target: string
  code: string | null
  order: string
  legalReason: string
  legalReasonText: string
  dependsOnPositionDenominator: boolean
  dependsOnPeakBasis?: boolean
  sourceLine: number
}

/** 四种终态。委员会明确不允许出现模糊的"建议卖" */
export type DebtVerdict =
  | 'VALID'
  | 'INVALIDATED_BY_BASIS_CHANGE'
  | 'RECALC_REQUIRED'
  | 'PENDING_CONFIRMATION'

export interface DebtReaudit {
  debt: DebtRecord
  verdict: DebtVerdict
  /** 旧分母下的仓位。与分母无关的债务为 null */
  oldPct: number | null
  newPct: number | null
  oldOver: boolean | null
  newOver: boolean | null
  reasoning: string
  /** 是否仍计入 E1 执行率的分母 */
  countsTowardE1: boolean
}

export function loadDebts(file = DEBTS_FILE): DebtRecord[] {
  const raw = JSON.parse(readFileSync(file, 'utf-8')) as { debts: DebtRecord[] }
  return raw.debts
}

export function reauditDebts(
  debts: DebtRecord[], snapshot: AccountSnapshot, positions: Position[]
): DebtReaudit[] {
  const mvOf = new Map(positions.map(p => [p.code, p.marketValue]))
  const peakComparable = snapshot.peakBasis === 'PORTFOLIO'

  return debts.map(d => {
    // ── 与分母无关的债务：分母变了不影响它，但也不因此自动作废 ──
    if (!d.dependsOnPositionDenominator) {
      if (d.dependsOnPeakBasis) {
        return {
          debt: d, verdict: 'RECALC_REQUIRED' as DebtVerdict,
          oldPct: null, newPct: null, oldOver: null, newOver: null,
          reasoning: peakComparable
            ? '熔断类：峰值已按组合口径认定，可重算强制降仓缺口'
            : '熔断类：净值峰值仍记于券商账户口径，与组合口径不可比 → 回撤无法计算，'
              + '强制降仓缺口无法重算。**不得因"现在看着没超"而消掉** —— '
              + '那是把"不知道"当成"没问题"。须先完成峰值口径迁移。',
          countsTowardE1: true,
        }
      }
      return {
        debt: d, verdict: 'PENDING_CONFIRMATION' as DebtVerdict,
        oldPct: null, newPct: null, oldOver: null, newOver: null,
        reasoning: `法定理由为 ${d.legalReason}，完全不依赖仓位分母 →`
          + ' 本次口径校准不触碰它，继续有效，等待执行或委员会另行裁定。'
          + '不得因为这次资产口径修正顺手消掉。',
        countsTowardE1: true,
      }
    }

    // ── 仅依赖仓位分母的债务：逐条重算 ──
    const mv = d.code ? mvOf.get(d.code) : undefined
    if (mv === undefined) {
      return {
        debt: d, verdict: 'RECALC_REQUIRED' as DebtVerdict,
        oldPct: null, newPct: null, oldOver: null, newOver: null,
        reasoning: `标的 ${d.target}（${d.code ?? '无代码'}）不在当前持仓表里 →`
          + ' 无法重算。可能已清仓，也可能是持仓表缺录（本次校准刚发现过沪电股份整只缺失）。',
        countsTowardE1: true,
      }
    }
    const oldPct = snapshot.brokerTotal > 0 ? mv / snapshot.brokerTotal : 0
    const newPct = singleNameWeight(mv, snapshot.portfolioTotal)
    const oldOver = oldPct > LIMITS.singleStock
    const newOver = newPct > LIMITS.singleStock

    if (oldOver && !newOver) {
      return {
        debt: d, verdict: 'INVALIDATED_BY_BASIS_CHANGE' as DebtVerdict,
        oldPct, newPct, oldOver, newOver,
        reasoning: `原指令的唯一法定理由是"券商账户口径下超过 ${(LIMITS.singleStock * 100).toFixed(0)}%"`
          + `（${(oldPct * 100).toFixed(1)}%）。组合口径下为 ${(newPct * 100).toFixed(2)}%，未超限 →`
          + ' 原命题的输入数据口径错误，因此原指令失效。'
          + '**这不是"市场观点改变"**，也不构成对该标的的任何新判断。',
        countsTowardE1: false,
      }
    }
    if (newOver) {
      return {
        debt: d, verdict: 'VALID' as DebtVerdict,
        oldPct, newPct, oldOver, newOver,
        reasoning: `两个口径下均超限（${(oldPct * 100).toFixed(1)}% → ${(newPct * 100).toFixed(2)}%）→`
          + ` 法定理由仍成立，但**幅度须按新口径重算**：超出 ${((newPct - LIMITS.singleStock) * 100).toFixed(2)}pct。`
          + '原指令记录的股数是按旧分母算的，不可直接沿用。',
        countsTowardE1: true,
      }
    }
    return {
      debt: d, verdict: 'RECALC_REQUIRED' as DebtVerdict,
      oldPct, newPct, oldOver, newOver,
      reasoning: '两个口径下均未超限，但原指令登记时确实成立 →'
        + ' 说明分子（股数或现金）在期间发生过变化。须核对原始成交与当前持仓后再定。',
      countsTowardE1: true,
    }
  })
}

const VERDICT_TEXT: Record<DebtVerdict, string> = {
  VALID: '仍然有效',
  INVALIDATED_BY_BASIS_CHANGE: '因口径变更失效',
  RECALC_REQUIRED: '需重新计算',
  PENDING_CONFIRMATION: '保留，待确认',
}

export function renderReaudit(rows: DebtReaudit[], snapshot: AccountSnapshot): string {
  const L: string[] = []
  const w = (s = '') => L.push(s)
  const wan = (v: number) => `${(v / 10000).toFixed(1)}万`
  const line = '─'.repeat(96)

  w(`\n${'═'.repeat(96)}`)
  w('执行债务重审 —— 按 2026-08-15 组合口径逐条分类')
  w('═'.repeat(96))
  w()
  w(`  旧分母（券商账户合计）${wan(snapshot.brokerTotal)}`)
  w(`  新分母（组合总资产）  ${wan(snapshot.portfolioTotal)}`)
  w(`  峰值口径 ${snapshot.peakBasis}${snapshot.peakBasis === 'PORTFOLIO' ? '' : ' → 回撤不可比，熔断类无法重算'}`)
  w()

  for (const r of rows) {
    w(line)
    w(`  ${r.debt.id}　${r.debt.target}　${r.debt.order}`)
    w(`     法定理由：${r.debt.legalReason} —— ${r.debt.legalReasonText}`)
    if (r.oldPct !== null && r.newPct !== null) {
      w(`     仓位：旧口径 ${(r.oldPct * 100).toFixed(1)}%（${r.oldOver ? '超限' : '未超'}）`
        + ` → 新口径 ${(r.newPct * 100).toFixed(2)}%（${r.newOver ? '超限' : '未超'}）`)
    }
    w(`     终态：【${VERDICT_TEXT[r.verdict]}】${r.verdict}`)
    w(`     依据：${r.reasoning}`)
    w(`     计入 E1 分母：${r.countsTowardE1 ? '是' : '否'}`)
  }
  w(line)
  w()

  const byVerdict = new Map<DebtVerdict, number>()
  for (const r of rows) byVerdict.set(r.verdict, (byVerdict.get(r.verdict) ?? 0) + 1)
  w('  终态汇总：')
  for (const [v, n] of byVerdict) w(`    ${VERDICT_TEXT[v].padEnd(10)} ${n} 条　（${v}）`)
  const e1Denom = rows.filter(r => r.countsTowardE1).length
  w()
  w(`  E1 执行率分母：由 ${rows.length} 条修正为 ${e1Denom} 条`)
  w(`    —— 因口径变更失效的 ${rows.length - e1Denom} 条不应继续计入。`)
  w(`    拿错误的仓位模型去惩罚执行能力，比不执行更危险。`)
  w()
  w('  本重审不生成、不撤销任何交易指令。终态仅表示"原法定前提是否仍成立"，')
  w('  撤销与执行属执行层，须委员会逐笔确认后记录。')
  w()
  return L.join('\n')
}
