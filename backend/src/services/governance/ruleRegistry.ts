// 规则登记册与指纹 —— 让"没有偷偷新增规则"成为可验证的事实
//
// 把全部现行生效的规则参数登记成一份清单，取其指纹。
// 之后任何时候比对指纹，就能回答"当时的规则是不是今天这套"，不靠回忆。
//
// 本文件不含决策逻辑，只登记并取哈希。value 一律从真实定义处 import，不手抄。
//
// 2026-11-24 起登记的是《半年计划》的规则：卖出只由资金分和趋势触发、加仓上限按证据分、
// 三条线、指令有效期、缺数据时的口径、账本新鲜度与两源核价、AI 全链环节与核心股名单。
// 旧的单票 12%、回撤熔断、委员会清退名单、四条主线名单随规则一并删除，不再登记。
// peakBasis.ts（峰值的两套历史）不再被任何规则读取，文件按委员会 2026-08-15 的要求保留。

import { createHash } from 'node:crypto'
import { PLAN } from '../dailyDecision/rules'
import { ACCOUNT_STALE_LIMIT_DAYS } from '../dailyDecision/ledger'
import { SEGMENTS } from '../chain/universe'

export interface RuleEntry {
  domain: 'SELL_RULE' | 'BUY_RULE' | 'LINES' | 'ACCOUNT' | 'UNIVERSE' | 'GUARD'
  key: string
  value: unknown
  /** 定义位置，便于核对 */
  definedIn: string
}

/** 全部现行生效的规则参数。新增或改动规则必然导致本表变化，从而导致指纹变化。 */
export function buildRuleRegistry(): RuleEntry[] {
  const out: RuleEntry[] = []

  out.push({
    domain: 'SELL_RULE', key: 'liveSellRules', value: ['RULE_HALVE', 'RULE_TREND', 'RULE_ZERO', 'STRATEGY', 'WATCH'],
    definedIn: 'dailyDecision/book.ts（资金分减半、破 60 日线清仓、资金 0 分清仓、策略方登记、带卖出档位的盯线）',
  })
  out.push({
    domain: 'SELL_RULE', key: 'thresholds', value: PLAN.sell,
    definedIn: 'dailyDecision/rules.ts:PLAN.sell（evidence.ts:sellCheck 照此判定）',
  })
  out.push({
    domain: 'SELL_RULE', key: 'sizeNeverTriggersSell', value: true,
    definedIn: 'dailyDecision/card.ts（单票 20%、相关环节 30% 只限加仓，超过不卖）',
  })
  out.push({
    domain: 'SELL_RULE', key: 'missingData', value: 'MET_ONLY_IF_CERTAIN',
    definedIn: 'dailyDecision/evidence.ts:sellCheck（缺的数补齐后也必然成立才算成立；否则写核对不了）',
  })
  out.push({
    domain: 'SELL_RULE', key: 'provisionalScore', value: 'NOTICE_ONLY',
    definedIn: 'dailyDecision/book.ts:syncBook（融资没公布时的初算只提示，定稿仍成立才生成指令）',
  })
  out.push({
    domain: 'SELL_RULE', key: 'instructionValidTradingDays', value: PLAN.validTradingDays,
    definedIn: 'dailyDecision/rules.ts:PLAN.validTradingDays（执行日加顺延 3 个交易日，之后作废）',
  })
  out.push({
    domain: 'SELL_RULE', key: 'lotRounding', value: { fraction: 'NEAREST_LOT', buy: 'DOWN', lot: 100, starBoardMin: 200 },
    definedIn: 'dailyDecision/rules.ts:sharesForFraction、sharesForBuyValue',
  })

  out.push({
    domain: 'BUY_RULE', key: 'buyPermission', value: 'STRATEGY_REGISTERED_ONLY',
    definedIn: 'dailyDecision/book.ts:registerOrder（系统自己不生成买入；登记的买入逐条过规则）',
  })
  for (const k of ['addCap', 'related', 'entry', 'backup'] as const) {
    out.push({ domain: 'BUY_RULE', key: k, value: PLAN[k], definedIn: `dailyDecision/rules.ts:PLAN.${k}` })
  }
  out.push({
    domain: 'BUY_RULE', key: 'limitDenominator', value: 'portfolioTotal',
    definedIn: 'dailyDecision/input.ts（= 持仓市值 + 账内现金 + 账外股票现金）',
  })

  for (const k of ['lines', 'ratchets', 'equityCap', 'checkpoints'] as const) {
    out.push({ domain: 'LINES', key: k, value: PLAN[k], definedIn: `dailyDecision/rules.ts:PLAN.${k}` })
  }

  out.push({
    domain: 'ACCOUNT', key: 'staleLimitDays', value: ACCOUNT_STALE_LIMIT_DAYS,
    definedIn: 'dailyDecision/ledger.ts:ACCOUNT_STALE_LIMIT_DAYS（账本落后超过这个天数不下单）',
  })
  out.push({
    domain: 'ACCOUNT', key: 'priceCheck', value: 'TWO_SOURCES_MUST_AGREE',
    definedIn: 'dailyDecision/verify.ts（腾讯与新浪不一致或取不到，不出股数）',
  })

  out.push({
    domain: 'GUARD', key: 'navIndexUnknownBlocksBuys', value: true,
    definedIn: 'dailyDecision/rules.ts:computeLines（净值指数算不出时不买，不当作没触线）',
  })
  out.push({
    domain: 'GUARD', key: 'bookSyncRequiresVerifiedPrices', value: true,
    definedIn: 'dailyDecision/produce.ts（价格两源核对没通过时不动指令簿）',
  })

  // 执行单用这份名单判断“链内还是链外”，相关环节上限也按它的环节名归组
  for (const seg of SEGMENTS) {
    out.push({
      domain: 'UNIVERSE', key: `chain.${seg.layer}.${seg.segment}`,
      value: [...seg.codes].sort(),
      definedIn: 'chain/universe.ts:SEGMENTS（由 scripts/ai-mainline-map.py 导出）',
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
