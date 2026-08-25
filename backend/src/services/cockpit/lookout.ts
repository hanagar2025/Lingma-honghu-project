/**
 * 极简看台装配层。
 *
 * 把已经算好的生命线、变化台账、执行债务，收成投资人第一屏。
 * 不生产动作，不新增指标，不改 V4.x，不进规则指纹。
 *
 * 看台必须完整呈现四轴：Ownership / Evidence / Exposure / Action。
 * 只显示动作标签，会把「核心 + 超限 + 降暴露」读成「这家公司没价值」。
 *
 * 维持必须用各自行的 oneReason。统一写成「有能力加仓」会把死扛读成纪律。
 */

import type { Change } from '../governance/changeLog'
import {
  PHILOSOPHY_CLAIM, PHILOSOPHY_OBJECT, LIFELINE_READING,
} from '../research/ownershipPhilosophy'
import { P2 } from '../research/aiPhaseTwo'
import { DAILY_QUESTION, HOLD_AS_DECISION } from '../decision/charter'
import { HUNTER_TEXT } from '../decision/hunter'
import {
  CAPITAL_ACTION_TEXT, EVIDENCE_TONE_TEXT, OWNERSHIP_TEXT,
  type CapitalAction,
} from '../decision/triaxis'
import type { DecisionCockpit, LifelineRow, UnjudgableItem } from '../decision/cockpitV2'

/** 价格/均线/相对强弱类字段。只标复核，不进「必须处理」。 */
export const PRICE_REVIEW_FIELD = /相对|MA20|MA60|PE历史|复核触发|成交|资金代理|趋势/

const SCOPE_TEXT: Record<string, string> = {
  STRUCTURE: '市场结构',
  HOLDING: '持仓',
  MAINLINE: '主线',
  NODE: '产业节点',
  NEXT_LAYER: '下一观察层',
}

export interface LookoutName {
  code: string
  name: string
  posPct: number | null
  ownership: string
  ownYes: boolean
  evidence: string
  evidenceNote: string
  exposure: string
  hunter: string
  action: CapitalAction
  actionText: string
  oneReason: string
}

export interface LookoutChange {
  scope: string
  key: string
  field: string
  from: string
  to: string
}

export interface LookoutPortfolio {
  eyebrow: string
  stance: string
  structure: string
  cash: string
  note: string
}

export interface LookoutView {
  date: string
  dailyQuestion: typeof DAILY_QUESTION
  principle: string
  object: string
  holdIsDecision: string
  priceIsNotLoss: string
  hasNewFact: boolean
  answer: string
  spine: readonly { name: string; means: string }[]
  spineNote: string
  layer: string
  portfolio: LookoutPortfolio
  wontDo: readonly string[]
  must: LookoutName[]
  observes: LookoutName[]
  holds: LookoutName[]
  capitalChanges: LookoutChange[]
  reviewChanges: LookoutChange[]
  prevDate: string | null
  debtCount: number
  debtNote: string
  unjudgable: readonly UnjudgableItem[]
}

export interface LookoutInput {
  date: string
  cockpit: DecisionCockpit | null
  changes?: { items?: Change[]; prevDate?: string | null }
  pendingSellCount?: number
  pendingSells?: unknown[] | null
}

function isMustAction(action: string): boolean {
  return action === 'REDUCE_EXPOSURE' || action === 'EXIT' || action === 'INCREASE_CAPITAL'
}

function isPriceReview(field: string): boolean {
  return PRICE_REVIEW_FIELD.test(field ?? '')
}

function toName(r: LifelineRow): LookoutName {
  return {
    code: r.code,
    name: r.name,
    posPct: r.posPct,
    ownership: OWNERSHIP_TEXT[r.ownership] ?? r.ownership,
    ownYes: r.ownYes,
    evidence: EVIDENCE_TONE_TEXT[r.evidenceTone] ?? r.evidenceTone,
    evidenceNote: r.evidenceNote,
    exposure: r.exposure,
    hunter: HUNTER_TEXT[r.hunter] ?? r.hunter,
    action: r.action,
    actionText: CAPITAL_ACTION_TEXT[r.action] ?? r.action,
    oneReason: r.oneReason,
  }
}

export function buildLookoutView(input: LookoutInput): LookoutView {
  const lifeline = input.cockpit?.lifeline ?? []
  const items = input.changes?.items ?? []
  const capitalChanges = items.filter(c => !isPriceReview(c.field)).map(c => ({
    scope: SCOPE_TEXT[c.scope] ?? c.scope,
    key: c.key,
    field: c.field,
    from: c.from,
    to: c.to,
  }))
  const reviewChanges = items.filter(c => isPriceReview(c.field)).map(c => ({
    scope: SCOPE_TEXT[c.scope] ?? c.scope,
    key: c.key,
    field: c.field,
    from: c.from,
    to: c.to,
  }))
  const debtCount = input.pendingSells === null
    ? (input.pendingSellCount ?? 0)
    : (input.pendingSells?.length ?? input.pendingSellCount ?? 0)
  const must = lifeline.filter(r => isMustAction(r.action)).map(toName)
  const observes = lifeline.filter(r => r.action === 'OBSERVE').map(toName)
  const holds = lifeline.filter(r => r.action === 'HOLD_CAPITAL').map(toName)
  const hasNewFact = must.length > 0 || capitalChanges.length > 0 || debtCount > 0

  return {
    date: input.date,
    dailyQuestion: input.cockpit?.dailyQuestion ?? DAILY_QUESTION,
    principle: PHILOSOPHY_CLAIM,
    object: PHILOSOPHY_OBJECT,
    holdIsDecision: HOLD_AS_DECISION,
    priceIsNotLoss: '价格波动 ≠ 永久性资本损失。跌了所以减仓，已经被 V4.x 禁止。',
    hasNewFact,
    answer: hasNewFact
      ? '有。下面只列出必须处理的、以及今天真的变了的。'
      : '没有。今日维持是经过验证的决策，不是系统没看见。',
    spine: LIFELINE_READING.map(s => ({ name: s.name, means: s.means })),
    spineNote:
      '这是已冻结生命线的读法，不是新规则。'
      + '核心 = 拥有资格长期成立。战术减仓与价值退出仍然有效。好公司判断错了也会卖。',
    layer: '第一层只回答今天的资本状态。依据和研究点开再看。',
    portfolio: {
      eyebrow: '今日组合读法',
      stance: P2.stance,
      structure: '这不是分散组合，是 AI 算力硬件大组合。',
      cash:
        '约 46.5 万现金等待信息优势。事件落地前不得部署。'
        + '数字是截图留痕，不是今日 MET。',
      note: '观察，不构成动作。不得改写已冻结规则，也不产生买卖令。',
    },
    wontDo: [
      '不因情绪或 3800 点抄底',
      '不因浮亏恐慌清仓',
      '不把中际、新易盛和纯概念 AI 放进同一个篮子',
      '不把现金提前打出去',
    ],
    must,
    observes,
    holds,
    capitalChanges,
    reviewChanges,
    prevDate: input.changes?.prevDate ?? null,
    debtCount,
    debtNote: '未清完不得新增建仓。这是组合纪律，不是选股结论。',
    unjudgable: input.cockpit?.unjudgable ?? [],
  }
}

export function renderLookout(view: LookoutView): string {
  const W = 122
  const L: string[] = ['', '═'.repeat(W), '看台', '═'.repeat(W)]
  L.push('  数据后台越来越完整。投资人前台只看这一问。')
  L.push(`  ${view.date}`)
  L.push('')
  L.push(`  ${view.dailyQuestion}`)
  L.push(`  ${view.answer}`)
  L.push(`  ${view.principle}`)
  L.push(`  ${view.object}`)
  L.push(`  ${view.priceIsNotLoss}`)
  L.push(`  ${view.holdIsDecision}`)
  L.push(`  ${view.layer}`)
  L.push('')
  L.push(`  ── ${view.portfolio.eyebrow}（${view.portfolio.note}）──`)
  L.push(`  ${view.portfolio.stance}`)
  L.push(`  ${view.portfolio.structure}`)
  L.push(`  ${view.portfolio.cash}`)
  L.push('')
  L.push('  ── 今日明确不做什么 ──')
  for (const w of view.wontDo) L.push(`  · ${w}`)
  L.push('')
  L.push('  ── 生命线读法（已冻结，不是新规则）──')
  L.push(`  ${view.spine.map(s => s.name).join(' → ')}`)
  L.push(`  ${view.spineNote}`)
  L.push('')
  L.push(`  ── 必须处理（${view.must.length + (view.debtCount > 0 ? 1 : 0)}）──`)
  if (view.must.length === 0 && view.debtCount === 0) {
    L.push('  今日没有必须改资本的事项。')
  }
  for (const r of view.must) {
    L.push(`  ${r.name}　${r.actionText}　Ownership ${r.ownYes ? '✓' : '✗'}${r.ownership}　Evidence ${r.evidence}　Exposure ${r.exposure}　${r.hunter}`)
    L.push(`      ${r.oneReason}`)
  }
  if (view.debtCount > 0) {
    L.push(`  执行债务　${view.debtCount} 条未清偿`)
    L.push(`      ${view.debtNote}`)
  }
  L.push('')
  L.push(`  ── 正在变化（${view.capitalChanges.length}）──`)
  if (!view.prevDate) L.push('  尚无昨日对照，变化带明天才有内容。')
  else if (view.capitalChanges.length === 0) L.push('  今日无足以改变资本状态的新事实。')
  for (const c of view.capitalChanges.slice(0, 8)) {
    L.push(`  ${c.scope} · ${c.key} · ${c.field}　${c.from} → ${c.to}`)
  }
  if (view.capitalChanges.length > 8) {
    L.push(`  其余 ${view.capitalChanges.length - 8} 项在依据里。`)
  }
  if (view.reviewChanges.length > 0) {
    L.push(`  另有 ${view.reviewChanges.length} 项价格复核，点开看（不构成动作）。`)
  }
  if (view.observes.length > 0) {
    L.push('')
    L.push(`  ── 仍在观察（${view.observes.length}，不是卖出，也不是维持资本）──`)
    for (const r of view.observes) {
      L.push(`  ${r.name}　${r.actionText}　Ownership ${r.ownYes ? '✓' : '✗'}${r.ownership}　Evidence ${r.evidence}　Exposure ${r.exposure}　${r.hunter}`)
      L.push(`      ${r.oneReason}`)
    }
  }
  L.push('')
  L.push(`  ── 明确维持（${view.holds.length}）──`)
  if (view.holds.length === 0) L.push('  今日没有记为维持的持仓。')
  for (const r of view.holds) {
    L.push(`  ${r.name}　${r.actionText}　Ownership ${r.ownYes ? '✓' : '✗'}${r.ownership}　Evidence ${r.evidence}　Exposure ${r.exposure}　${r.hunter}`)
    L.push(`      ${r.oneReason}`)
  }
  if (view.holds.length > 0) {
    L.push(`  ${view.holdIsDecision}`)
  }
  if (view.unjudgable.length > 0) {
    L.push('')
    L.push(`  ── 不可判断（${view.unjudgable.length}）──`)
    for (const u of view.unjudgable) {
      L.push(`  · ${u.topic}：${u.why}`)
      L.push(`      禁止：${u.forbidden}`)
    }
  }
  L.push('')
  return L.join('\n')
}
