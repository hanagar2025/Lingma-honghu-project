// 规则登记册与指纹 —— 让"没有偷偷新增规则"成为可验证的事实
//
// 委员会 2026-08-13 定下 30 个交易日冻结期，成功标准之一是：
//   「没有偷偷新增规则；没有因为单日行情修改战略；没有因为亏损修改规则；没有因为盈利夸大模型能力。」
//
// 问题在于：三十天后凭什么证明这一条做到了？靠回忆不行 —— 那正是我们要消灭的东西。
// 所以这里把**全部决策生效参数**登记成一份声明式清单，取其指纹，随每日审计存档。
// 三个月后比对指纹即可回答"当时的规则是不是今天这套"，不需要任何人回忆。
//
// 本文件**不含任何决策逻辑**。它只是把散落各处的阈值集中登记并取哈希。
// 这一点很重要：冻结期内不得新增决策规则，而一个登记册不是规则。

import { createHash } from 'node:crypto'
import { LEGAL_REASON_TEXT, FORBIDDEN_REASON_PHRASES } from '../cockpit/types'
import { LIMITS, SAFETY_NET_POLICY } from '../cockpit/safety'
import { PEAK_HISTORY } from './peakBasis'
import {
  RISK_CAN_PRODUCE, EVIDENCE_CAN_REDUCE, STATES,
} from '../decision/lifecycle'
import { NODE_TAXONOMY } from '../cockpit/nodes'
import { RED_EXTREME_RET10_THRESHOLD } from '../msr/promotion'
import { PE_SANITY_CEILING } from '../msr/valuation'
import {
  MAINLINES, COMBAT_MAINLINE_IDS, RESEARCH_ONLY_MAINLINE_IDS,
  MIN_EVIDENCE_FOR_CANDIDATE, EVIDENCE_SCORE,
} from '../msr/universe'

/**
 * 登记项。`value` 一律从真实定义处 import 而来，禁止在此手抄常量 ——
 * 手抄的副本会与本体分叉，而分叉的规则等于没有规则。
 */
export interface RuleEntry {
  /** 规则域 */
  domain: 'LEGAL_REASON' | 'POSITION_LIMIT' | 'PRICE_WINDOW' | 'VALUATION' | 'UNIVERSE' | 'PROMOTION' | 'GUARD'
  key: string
  value: unknown
  /** 该规则的证据等级 —— 与 cockpit/types.ts 的 EvidenceTier 同义 */
  tier: 'ACCOUNTING' | 'VALIDATED' | 'OBSERVATION'
  /** 定义位置，便于核对 */
  definedIn: string
}

/** 全部决策生效参数。新增决策规则必然导致本表变化，从而导致指纹变化。 */
export function buildRuleRegistry(): RuleEntry[] {
  const out: RuleEntry[] = []

  // ── 法定理由白名单（封闭枚举） ──
  out.push({
    domain: 'LEGAL_REASON', key: 'whitelist',
    value: Object.keys(LEGAL_REASON_TEXT).sort(),
    tier: 'ACCOUNTING', definedIn: 'cockpit/types.ts:LegalReason',
  })
  out.push({
    domain: 'GUARD', key: 'forbiddenPhrases',
    value: [...FORBIDDEN_REASON_PHRASES].sort(),
    tier: 'ACCOUNTING', definedIn: 'cockpit/types.ts:FORBIDDEN_REASON_PHRASES',
  })

  // ── 仓位与风险预算 ──
  for (const [k, v] of Object.entries(LIMITS).sort(([a], [b]) => a.localeCompare(b))) {
    out.push({
      domain: 'POSITION_LIMIT', key: k, value: v,
      tier: 'ACCOUNTING', definedIn: 'cockpit/safety.ts:LIMITS',
    })
  }

  // ── 分母口径也必须进指纹 ──
  //
  // 这一条是补上的漏洞。2026-08-15 的口径裁定把单票上限的分母从"券商账户合计"
  // 换成"组合总资产"，直接把新易盛从"必须减仓 2.9pct"翻转成"不超限"，
  // 把海光从"超 6.6pct"改成"超 1.1pct" —— 而**指纹一个字都没变**，
  // 因为它只覆盖 12% 这个数值，不覆盖 12% 作用在什么之上。
  //
  // 指纹的用途正是"判定是否属于新增规则的机械标准"。一个能翻转动作结论的改动
  // 若对它不可见，这个机制就是有洞的。故把口径与安全垫基数一并纳入。
  out.push({
    domain: 'POSITION_LIMIT', key: 'limitDenominator', value: 'portfolioTotal',
    tier: 'ACCOUNTING',
    definedIn: 'cockpit/safety.ts:findLimitBreaches（= 持仓 + 账内现金 + 账户外股票现金）',
  })
  // 安全垫由"用哪个基数"变成"是否纳入模型"。
  // 这不是同一个参数换值 —— 它退掉了一条减仓法定理由，属于能翻转动作结论的改动，
  // 故必须对指纹可见。若哪天有人把 mode 改回 REQUIRED，指纹会变。
  out.push({
    domain: 'POSITION_LIMIT', key: 'safetyNetMode', value: SAFETY_NET_POLICY.mode,
    tier: 'ACCOUNTING',
    definedIn: 'cockpit/safety.ts:SAFETY_NET_POLICY'
      + `（${SAFETY_NET_POLICY.ruledOn} 战略层裁定不纳入 TIOS 风控模型）`,
  })
  out.push({
    domain: 'LEGAL_REASON', key: 'reduceReasonsRetired', value: 'FAMILY_SAFETY_NET',
    tier: 'ACCOUNTING',
    definedIn: 'cockpit/types.ts:makeAction（安全垫不纳入模型的直接推论：退出减仓白名单）',
  })
  // 峰值口径与取值：情形 B 的裁定直接决定熔断是否成立，
  // 故峰值本身也是决策生效参数，而不只是一个数据点。
  out.push({
    domain: 'GUARD', key: 'portfolioPeakBasis', value: 'portfolio_basis_v1',
    tier: 'ACCOUNTING',
    definedIn: 'governance/peakBasis.ts（2026-08-15 裁定采用情形 B：430万 + 200万 = 630万）',
  })
  out.push({
    domain: 'GUARD', key: 'portfolioPeakValue',
    value: PEAK_HISTORY.find(r => r.basis === 'portfolio_basis_v1')?.peak ?? null,
    tier: 'ACCOUNTING',
    definedIn: 'governance/peakBasis.ts:PEAK_HISTORY',
  })
  out.push({
    domain: 'GUARD', key: 'drawdownRequiresSamePeakBasis', value: true,
    tier: 'ACCOUNTING',
    definedIn: 'cockpit/safety.ts:peakComparable（口径不可比时回撤为 null，不得当作 0）',
  })

  // ── 决策语义层（委员会 2026-08-17 裁定）──
  //
  // 这一层决定"允许做什么"，属决策生效，故必须对指纹可见。
  // 其中 R4 那一条尤其重要：它是技术/预期数据的天花板，
  // 一旦有人把它从空数组改成含 TACTICAL_REDUCE，
  // 被回测证伪的"技术信号 → 卖出"就回来了 —— 而指纹会立刻变。
  out.push({
    domain: 'LEGAL_REASON', key: 'sellKinds', value: 'VALUE_EXIT|TACTICAL_REDUCE|PORTFOLIO_REDUCE',
    tier: 'ACCOUNTING',
    definedIn: 'decision/lifecycle.ts:SellKind（三种卖出严格区分，不得合并为"减仓"）',
  })
  out.push({
    domain: 'GUARD', key: 'r4CanProduceSell',
    value: RISK_CAN_PRODUCE.R4_EXPECTATION.length,
    tier: 'ACCOUNTING',
    definedIn: 'decision/lifecycle.ts:RISK_CAN_PRODUCE.R4_EXPECTATION'
      + '（必须为 0 —— 预期/价格风险只能停止追加，不能减仓）',
  })
  out.push({
    domain: 'GUARD', key: 'technicalCanReduce', value: EVIDENCE_CAN_REDUCE.TECHNICAL,
    tier: 'ACCOUNTING',
    definedIn: 'decision/lifecycle.ts:EVIDENCE_CAN_REDUCE（技术类证据不得构成减仓理由）',
  })
  out.push({
    domain: 'GUARD', key: 'lifecycleStates', value: STATES.map(x => x.state).join(','),
    tier: 'ACCOUNTING',
    definedIn: 'decision/lifecycle.ts:STATES（状态机取值；风险状态只允许评估，不允许终局动作）',
  })

  // ── 价格窗口（唯一具备决策效力的价格阈值） ──
  out.push({
    domain: 'PRICE_WINDOW', key: 'redExtremeRet10', value: RED_EXTREME_RET10_THRESHOLD,
    tier: 'VALIDATED', definedIn: 'msr/promotion.ts:RED_EXTREME_RET10_THRESHOLD',
  })

  // ── 估值 ──
  out.push({
    domain: 'VALUATION', key: 'peSanityCeiling', value: PE_SANITY_CEILING,
    tier: 'ACCOUNTING', definedIn: 'msr/valuation.ts:PE_SANITY_CEILING',
  })
  out.push({
    domain: 'VALUATION', key: 'percentileBlockAbove', value: 0.8,
    tier: 'ACCOUNTING', definedIn: 'msr/index.ts:collectBlocks',
  })

  // ── 晋级与候选门槛 ──
  out.push({
    domain: 'PROMOTION', key: 'minEvidenceForCandidate',
    value: [...MIN_EVIDENCE_FOR_CANDIDATE].sort(),
    tier: 'ACCOUNTING', definedIn: 'msr/universe.ts',
  })
  out.push({
    domain: 'PROMOTION', key: 'evidenceScore', value: EVIDENCE_SCORE,
    tier: 'OBSERVATION', definedIn: 'msr/universe.ts:EVIDENCE_SCORE',
  })

  // ── 扫描域（战略配置：主线、成员、证据等级、清退状态） ──
  out.push({ domain: 'UNIVERSE', key: 'combatMainlines', value: [...COMBAT_MAINLINE_IDS].sort(), tier: 'ACCOUNTING', definedIn: 'msr/universe.ts' })
  out.push({ domain: 'UNIVERSE', key: 'researchOnlyMainlines', value: [...RESEARCH_ONLY_MAINLINE_IDS].sort(), tier: 'ACCOUNTING', definedIn: 'msr/universe.ts' })
  for (const ml of MAINLINES) {
    out.push({
      domain: 'UNIVERSE', key: `mainline:${ml.id}`,
      value: {
        name: ml.name, strategicStars: ml.strategicStars, benchmark: ml.benchmark,
        members: ml.members
          .map(m => `${m.code}|${m.tier}|${m.node}|${m.evidence}` +
            `|champion=${m.champion ? 1 : 0}|retiredC=${m.retiredC ? 1 : 0}` +
            `|attr=${m.mainlineAttributionVerified === undefined ? 'NA' : m.mainlineAttributionVerified ? 1 : 0}` +
            `|ind=${m.industryVerified ? 1 : 0}|earn=${m.earningsVerified ? 1 : 0}`)
          .sort(),
      },
      tier: 'ACCOUNTING', definedIn: 'msr/universe.ts:MAINLINES',
    })
  }

  // ── 产业链节点清单 ──
  out.push({
    domain: 'UNIVERSE', key: 'nodeTaxonomy',
    value: NODE_TAXONOMY.map(n => `${n.mainlineId}/${n.name}:${[...n.aliases].sort().join(',')}`).sort(),
    tier: 'ACCOUNTING', definedIn: 'cockpit/nodes.ts:NODE_TAXONOMY',
  })

  return out
}

/** 稳定序列化：键排序，确保同一套规则在任何机器上得到同一指纹 */
function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null'
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`
  const keys = Object.keys(v as Record<string, unknown>).sort()
  return `{${keys.map(k => `${JSON.stringify(k)}:${stableStringify((v as Record<string, unknown>)[k])}`).join(',')}}`
}

export interface RuleFingerprint {
  /** 全表指纹（12位十六进制，足够区分而便于人眼比对） */
  hash: string
  /** 登记项条数 */
  entryCount: number
  /** 分域指纹，便于定位改动落在哪一域 */
  byDomain: Record<string, string>
  /** 各证据等级的规则条数 —— OBSERVATION 增多即"聪明东西变多"的量化信号 */
  tierCounts: Record<string, number>
}

function hash12(s: string): string {
  return createHash('sha256').update(s).digest('hex').slice(0, 12)
}

export function fingerprint(registry = buildRuleRegistry()): RuleFingerprint {
  const sorted = [...registry].sort((a, b) => `${a.domain}:${a.key}`.localeCompare(`${b.domain}:${b.key}`))
  const byDomain: Record<string, string> = {}
  const domains = [...new Set(sorted.map(e => e.domain))].sort()
  for (const d of domains) {
    byDomain[d] = hash12(stableStringify(sorted.filter(e => e.domain === d).map(e => [e.key, e.value])))
  }
  const tierCounts: Record<string, number> = {}
  for (const e of sorted) tierCounts[e.tier] = (tierCounts[e.tier] ?? 0) + 1
  return {
    hash: hash12(stableStringify(sorted.map(e => [e.domain, e.key, e.value]))),
    entryCount: sorted.length,
    byDomain,
    tierCounts,
  }
}

export interface FreezeBaseline {
  /** 冻结起始日 */
  frozenAt: string
  /** 冻结期交易日数 */
  tradingDays: number
  hash: string
  entryCount: number
  byDomain: Record<string, string>
  tierCounts: Record<string, number>
  note: string
}

export interface DriftResult {
  drifted: boolean
  /** 变动的规则域 */
  changedDomains: string[]
  currentHash: string
  baselineHash: string
  /** 条数变化。正数=新增规则 */
  entryDelta: number
  /** 各等级条数变化。OBSERVATION 增加须格外警觉 */
  tierDelta: Record<string, number>
  detail: string
}

/**
 * 与冻结基线比对。
 *
 * 刻意**不抛错**：漂移本身不是罪，偷偷漂移才是。所以这里只负责把漂移摆到审计里，
 * 由委员会判断该次改动是否经过授权。系统的职责是让改动无法隐身。
 */
export function detectDrift(baseline: FreezeBaseline, current = fingerprint()): DriftResult {
  const changedDomains = Object.keys(current.byDomain)
    .filter(d => current.byDomain[d] !== baseline.byDomain[d])
    .concat(Object.keys(baseline.byDomain).filter(d => !(d in current.byDomain)))
  const tierDelta: Record<string, number> = {}
  for (const t of new Set([...Object.keys(current.tierCounts), ...Object.keys(baseline.tierCounts)])) {
    const d = (current.tierCounts[t] ?? 0) - (baseline.tierCounts[t] ?? 0)
    if (d !== 0) tierDelta[t] = d
  }
  const drifted = current.hash !== baseline.hash
  const entryDelta = current.entryCount - baseline.entryCount
  return {
    drifted,
    changedDomains: [...new Set(changedDomains)].sort(),
    currentHash: current.hash,
    baselineHash: baseline.hash,
    entryDelta,
    tierDelta,
    detail: drifted
      ? `规则已变动：${changedDomains.join('、')}；条数 ${entryDelta >= 0 ? '+' : ''}${entryDelta}` +
        (Object.keys(tierDelta).length
          ? `；等级变化 ${Object.entries(tierDelta).map(([t, d]) => `${t}${d >= 0 ? '+' : ''}${d}`).join('、')}`
          : '') +
        '。冻结期内的任何变动须在审计中说明授权来源。'
      : `规则与冻结基线一致（${baseline.hash}，${baseline.entryCount}条）。冻结自 ${baseline.frozenAt} 起。`,
  }
}
