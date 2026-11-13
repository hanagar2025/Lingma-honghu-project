// 规则登记册与指纹 —— 让"没有偷偷新增规则"成为可验证的事实
//
// 把全部现行生效的规则参数登记成一份清单，取其指纹。
// 之后任何时候比对指纹，就能回答"当时的规则是不是今天这套"，不靠回忆。
//
// 本文件不含决策逻辑，只登记并取哈希。value 一律从真实定义处 import，不手抄。
//
// 2026-11-11 委员会同意留改砍清单后，登记范围收窄为实盘真正在用的规则：
// 三条卖出规则、仓位上限与熔断线、账本新鲜度、委员会指令、四条主线名单、峰值口径。
// 研究层与决策语义层随模块一并删除，不再登记。

import { createHash } from 'node:crypto'
import { LIMITS } from '../dailyDecision/rules'
import { ACCOUNT_STALE_LIMIT_DAYS } from '../dailyDecision/ledger'
import { COMMITTEE_ORDERS } from '../dailyDecision/orders'
import { MAINLINES } from '../msr/universe'
import { ACTIVE_PEAK_BASIS, PEAK_HISTORY } from './peakBasis'

export interface RuleEntry {
  domain: 'SELL_RULE' | 'POSITION_LIMIT' | 'ACCOUNT' | 'UNIVERSE' | 'GUARD'
  key: string
  value: unknown
  /** 定义位置，便于核对 */
  definedIn: string
}

/** 全部现行生效的规则参数。新增或改动规则必然导致本表变化，从而导致指纹变化。 */
export function buildRuleRegistry(): RuleEntry[] {
  const out: RuleEntry[] = []

  out.push({
    domain: 'SELL_RULE', key: 'liveSellRules', value: ['CIRCUIT_BREAKER', 'C_TIER_EXIT', 'POSITION_LIMIT'],
    definedIn: 'dailyDecision/card.ts（实盘卖出只有这三条；研究读数不产生卖出）',
  })
  out.push({
    domain: 'SELL_RULE', key: 'committeeOrders',
    value: COMMITTEE_ORDERS.map(o => [o.code, o.sell]).sort(),
    definedIn: 'dailyDecision/orders.ts:COMMITTEE_ORDERS',
  })
  out.push({
    domain: 'SELL_RULE', key: 'buyPermission', value: 'REBUILD_PLAN_ONLY',
    definedIn: 'dailyDecision/input.ts:noNewEntry（执行单不产生买入；买入只通过分段重建计划）',
  })
  out.push({
    domain: 'SELL_RULE', key: 'lotRounding', value: { direction: 'UP', lot: 100, starBoardMinSell: 200 },
    definedIn: 'dailyDecision/rules.ts:sharesToClearExcess（宁多卖一股、不少卖一股）',
  })

  for (const [k, v] of Object.entries(LIMITS).sort(([a], [b]) => a.localeCompare(b))) {
    out.push({ domain: 'POSITION_LIMIT', key: k, value: v, definedIn: 'dailyDecision/rules.ts:LIMITS' })
  }
  // 12% 作用在什么之上，和 12% 本身同样能翻转结论，所以分母口径也进指纹
  out.push({
    domain: 'POSITION_LIMIT', key: 'limitDenominator', value: 'portfolioTotal',
    definedIn: 'dailyDecision/rules.ts:findLimitBreaches（= 持仓市值 + 账内现金）',
  })

  out.push({
    domain: 'ACCOUNT', key: 'staleLimitDays', value: ACCOUNT_STALE_LIMIT_DAYS,
    definedIn: 'dailyDecision/ledger.ts:ACCOUNT_STALE_LIMIT_DAYS（账本落后超过这个天数不下单）',
  })
  out.push({
    domain: 'ACCOUNT', key: 'priceCheck', value: 'TWO_SOURCES_MUST_AGREE',
    definedIn: 'dailyDecision/verify.ts（腾讯与新浪不一致或取不到，不出股数）',
  })

  out.push({
    domain: 'GUARD', key: 'portfolioPeakBasis', value: ACTIVE_PEAK_BASIS,
    definedIn: 'governance/peakBasis.ts',
  })
  out.push({
    domain: 'GUARD', key: 'portfolioPeakValue',
    // 只登记摘要：峰值变了指纹就变，但登记册与 CI 日志里不出现金额
    value: hash12(String(PEAK_HISTORY.find(r => r.basis === ACTIVE_PEAK_BASIS)?.peak ?? null)),
    definedIn: 'governance/peakBasis.ts:PEAK_HISTORY',
  })
  out.push({
    domain: 'GUARD', key: 'drawdownRequiresSamePeakBasis', value: true,
    definedIn: 'dailyDecision/rules.ts:computeCircuit（口径不可比时回撤为空，不当作 0）',
  })
  out.push({
    domain: 'GUARD', key: 'unverifiedPeakBlocksCircuitOrder', value: true,
    definedIn: 'dailyDecision/input.ts（峰值待核验时，熔断补足不成为指令，也不撤销）',
  })

  for (const m of MAINLINES) {
    out.push({
      domain: 'UNIVERSE', key: `mainline.${m.id}`,
      value: m.members.map(x => x.code).sort(),
      definedIn: 'msr/universe.ts:MAINLINES',
    })
  }
  return out
}

function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`
  if (v && typeof v === 'object') {
    return `{${Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => `${JSON.stringify(k)}:${stableStringify(x)}`).join(',')}}`
  }
  return JSON.stringify(v)
}

export interface RuleFingerprint {
  /** 全表指纹（12 位十六进制） */
  hash: string
  entryCount: number
  /** 分域指纹，便于定位改动落在哪一域 */
  byDomain: Record<string, string>
}

function hash12(s: string): string {
  return createHash('sha256').update(s).digest('hex').slice(0, 12)
}

export function fingerprint(registry = buildRuleRegistry()): RuleFingerprint {
  const sorted = [...registry].sort((a, b) => `${a.domain}:${a.key}`.localeCompare(`${b.domain}:${b.key}`))
  const byDomain: Record<string, string> = {}
  for (const d of [...new Set(sorted.map(e => e.domain))].sort()) {
    byDomain[d] = hash12(stableStringify(sorted.filter(e => e.domain === d).map(e => [e.key, e.value])))
  }
  return {
    hash: hash12(stableStringify(sorted.map(e => [e.domain, e.key, e.value]))),
    entryCount: sorted.length,
    byDomain,
  }
}

export interface FreezeBaseline {
  frozenAt: string
  hash: string
  entryCount: number
  byDomain: Record<string, string>
  note: string
  /** 被本基线取代的上一版。只记最近一版，完整历史在 git 里 */
  supersedes?: { hash: string; note: string }
}

export interface DriftResult {
  drifted: boolean
  changedDomains: string[]
  currentHash: string
  baselineHash: string
  /** 条数变化。正数 = 新增规则 */
  entryDelta: number
  detail: string
}

/** 与基线比对。不抛错：系统的职责是让改动无法隐身，是否经过授权由委员会判断 */
export function detectDrift(baseline: FreezeBaseline, current = fingerprint()): DriftResult {
  const changedDomains = [...new Set([
    ...Object.keys(current.byDomain).filter(d => current.byDomain[d] !== baseline.byDomain[d]),
    ...Object.keys(baseline.byDomain).filter(d => !(d in current.byDomain)),
  ])].sort()
  const drifted = current.hash !== baseline.hash
  const entryDelta = current.entryCount - baseline.entryCount
  return {
    drifted, changedDomains, currentHash: current.hash, baselineHash: baseline.hash, entryDelta,
    detail: drifted
      ? `规则已变动：${changedDomains.join('、')}；条数 ${entryDelta >= 0 ? '+' : ''}${entryDelta}。任何变动须写明授权来源。`
      : `规则与基线一致（${baseline.hash}，${baseline.entryCount} 条）。基线自 ${baseline.frozenAt} 起。`,
  }
}
