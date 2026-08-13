// 每日决策审计
//
// 委员会 2026-08-13：
//   「三个月以后，我们可以回头看：当时为什么没买？为什么没卖？而不是凭记忆重新解释。」
//   「明明白白地输，比糊里糊涂地赢更有价值。」
//
// 因此本文件记录的重点不是"发生了什么"，而是**"当时的信息条件下，为什么这样决定"**。
// 归档时同时写入规则指纹 —— 三个月后要能回答"当时那套规则是不是今天这套"。
//
// 本文件不含任何决策逻辑，它只读 CockpitReport 并归档。冻结期内不得新增决策规则，
// 而一份审计不是规则。

import type { CockpitReport } from '../cockpit/types'
import { ACTION_TEXT, LEGAL_REASON_TEXT } from '../cockpit/types'
import { fingerprint, detectDrift, type DriftResult, type RuleFingerprint } from './ruleRegistry'
import { loadBaseline } from './freeze'

/** 审计里的一条持仓成本快照。**刻意不含市值、盈亏、涨跌幅** —— 见 E3 的类型约束 */
export interface CostSnapshot {
  code: string
  name: string
  /** 持仓总成本。价格波动不改变它，因此它的上升唯一对应"发生了买入" */
  totalCost: number
}

export interface DailyAudit {
  date: string
  /** ── 动作 ── */
  actions: {
    executionDebt: number
    newEntries: number
    legalReduces: { name: string; code: string; reason: string; detail: string; size: string }[]
    /** 技术复核但不动作 —— 委员会特别要求单列的一类 */
    reviewedNoAction: { name: string; code: string; triggerCount: number; whyNoAction: string }[]
    holds: string[]
  }
  /** ── 为什么（逐条法定理由） ── */
  why: string[]
  /** ── 为什么没有买 ── */
  whyNoBuy: string[]
  /** ── 数据缺口 ── */
  dataGaps: string[]
  /** ── 规则指纹与漂移 ── */
  rules: {
    fingerprint: RuleFingerprint
    drift: DriftResult | null
  }
  /** ── 成本基准快照，供次日检出未授权买入（E3） ── */
  costSnapshot: CostSnapshot[]
  /** 当日是否处于禁止新增建仓状态 —— E3 判定的前提条件 */
  buyFrozen: boolean
  coreDecision: string
}

export interface AuditInput {
  report: CockpitReport
  /** 持仓成本快照。总成本 = 成本价 × 股数 */
  costSnapshot: CostSnapshot[]
}

export function buildAudit(input: AuditInput): DailyAudit {
  const { report, costSnapshot } = input
  const acts = report.actions

  const legalReduces = acts.filter(a => a.kind === 'REDUCE').map(a => ({
    name: a.name, code: a.code,
    reason: LEGAL_REASON_TEXT[a.reason],
    detail: a.reasonDetail,
    size: a.size.display,
  }))

  // 技术复核但不动作：有观察触发项、却无任何法定理由 —— 这一类是本系统最重要的产出之一，
  // 因为它证明"发现风险"与"决定动作"已经分离。
  const reviewedNoAction = acts
    .filter(a => a.kind === 'NONE' && a.reviewTriggers.length > 0)
    .map(a => ({
      name: a.name, code: a.code,
      triggerCount: a.reviewTriggers.length,
      whyNoAction: a.reasonDetail,
    }))

  const why = [
    ...legalReduces.map(r => `${r.name}：${r.detail}（法定理由：${r.reason}）`),
    ...reviewedNoAction.map(r => `${r.name}：${r.whyNoAction}`),
  ]

  const base = loadBaseline()
  const fp = fingerprint()

  return {
    date: report.date,
    actions: {
      executionDebt: Number(
        report.table.find(r => r.item === '执行债务')?.todayStatus.replace(/[^\d]/g, '') ?? 0
      ),
      newEntries: acts.filter(a => a.kind === 'BUY').length,
      legalReduces,
      reviewedNoAction,
      holds: acts.filter(a => a.kind === 'HOLD').map(a => a.name),
    },
    why,
    whyNoBuy: report.noNewEntry.verdict ? report.noNewEntry.reasons : [],
    dataGaps: report.dataGaps,
    rules: { fingerprint: fp, drift: base ? detectDrift(base, fp) : null },
    costSnapshot,
    buyFrozen: report.noNewEntry.verdict,
    coreDecision: report.coreDecision,
  }
}

// ════════════════════════════════════════════════════════════════════════════
//  KPI E1–E4
// ════════════════════════════════════════════════════════════════════════════

/**
 * E3 的输入类型 —— **刻意不含任何盈亏、收益率、价格字段**。
 *
 * 委员会 2026-08-13：
 *   「不要因为结果赚钱就证明模型正确，也不要因为结果亏钱就证明模型错误。
 *     我们要统计的是：当时的信息条件下，这个决策是否符合规则？否则又会出现事后归因。」
 *
 * 与 makeAction() 同一手法：把纪律写进类型，而不是写进注释。
 * 只要 E3 的计算函数只能读到本类型，它在物理上就无法用盈亏评判模型。
 * 想让 E3 看见收益率，必须先修改这个接口 —— 那会在 code review 里显形。
 */
export interface E3Input {
  /** 按日期升序的审计序列 */
  audits: {
    date: string
    buyFrozen: boolean
    costSnapshot: CostSnapshot[]
    /** 当日全部动作是否都带法定理由 */
    allActionsHadLegalReason: boolean
    /** 当日规则是否相对基线漂移 */
    ruleDrifted: boolean
  }[]
}

export interface E3Result {
  /** 规则一致性得分：合规检查项通过数 / 总检查项 */
  complianceRate: number | null
  checks: { name: string; passed: boolean; detail: string }[]
  /** 未授权买入：在禁止建仓期间持仓总成本上升 */
  unauthorizedBuys: { date: string; code: string; name: string; costIncrease: number }[]
  /** 明确声明本指标与盈亏无关 */
  methodology: string
}

/**
 * E3 规则一致性。
 *
 * 检出未授权买入的原理：持仓**总成本**只在买入时上升，不随价格波动。
 * 因此"禁止建仓日 + 总成本上升"= 一次未授权买入。
 * 这正是历史上 Case-004/005/006 三笔未记录资金流出的形态。
 */
export function computeE3(input: E3Input): E3Result {
  const { audits } = input
  const checks: E3Result['checks'] = []
  const unauthorizedBuys: E3Result['unauthorizedBuys'] = []

  for (let i = 1; i < audits.length; i++) {
    const prev = audits[i - 1]
    const cur = audits[i]
    if (!cur.buyFrozen) continue
    const prevByCode = new Map(prev.costSnapshot.map(c => [c.code, c]))
    for (const c of cur.costSnapshot) {
      const p = prevByCode.get(c.code)
      // 容差 1 元，避免浮点与手工录入的分位差被当成买入
      const inc = c.totalCost - (p?.totalCost ?? 0)
      if (inc > 1) {
        unauthorizedBuys.push({ date: cur.date, code: c.code, name: c.name, costIncrease: inc })
      }
    }
  }

  checks.push({
    name: '全部动作均带法定理由',
    passed: audits.every(a => a.allActionsHadLegalReason),
    detail: `${audits.filter(a => a.allActionsHadLegalReason).length}/${audits.length} 日通过`,
  })
  checks.push({
    name: '禁止建仓期间无未授权买入',
    passed: unauthorizedBuys.length === 0,
    detail: unauthorizedBuys.length === 0
      ? '无'
      : unauthorizedBuys.map(u => `${u.date} ${u.name} 成本+${(u.costIncrease / 10000).toFixed(1)}万`).join('；'),
  })
  checks.push({
    name: '规则未在冻结期内漂移',
    passed: audits.every(a => !a.ruleDrifted),
    detail: `${audits.filter(a => a.ruleDrifted).length} 日检出漂移`,
  })

  return {
    complianceRate: checks.length ? checks.filter(c => c.passed).length / checks.length : null,
    checks,
    unauthorizedBuys,
    methodology:
      '本指标只回答"当时的信息条件下决策是否符合规则"，**不使用盈亏、收益率或任何价格结果**。' +
      '输入类型 E3Input 在结构上不含此类字段，故无法据此评判模型对错。',
  }
}

export interface RequiredAction {
  id: number
  reportDate: string
  code: string
  clause: string
  requiredAction: string
  executed: boolean
  /** 执行回填时间。缺失则延迟无法计算 */
  executedAt: string | null
}

export interface KpiBoard {
  /** E1 执行率 */
  e1: {
    rate: number | null
    total: number
    done: number
    pending: { code: string; clause: string; reportDate: string; ageDays: number }[]
    detail: string
  }
  /** E2 数据完整度 */
  e2: {
    rate: number | null
    present: number
    required: number
    missing: string[]
    detail: string
  }
  /** E3 规则一致性（非盈亏） */
  e3: E3Result
  /** E4 决策到执行的延迟 */
  e4: {
    medianDays: number | null
    maxDays: number | null
    samples: number
    /** 尚未执行的最长挂账天数 —— 比中位数更能说明问题 */
    oldestPendingDays: number | null
    detail: string
  }
}

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000)
}

export interface KpiInput {
  today: string
  requiredActions: RequiredAction[]
  /** 数据完整度检查项 */
  dataChecks: { name: string; present: boolean }[]
  e3: E3Input
}

export function computeKpis(input: KpiInput): KpiBoard {
  const { today, requiredActions, dataChecks } = input

  // ── E1 执行率 ──
  const total = requiredActions.length
  const done = requiredActions.filter(a => a.executed).length
  const pending = requiredActions
    .filter(a => !a.executed)
    .map(a => ({
      code: a.code, clause: a.clause, reportDate: a.reportDate,
      ageDays: daysBetween(a.reportDate, today),
    }))
    .sort((x, y) => y.ageDays - x.ageDays)

  // ── E2 数据完整度 ──
  const present = dataChecks.filter(c => c.present).length
  const missing = dataChecks.filter(c => !c.present).map(c => c.name)

  // ── E4 延迟 ──
  const lat = requiredActions
    .filter(a => a.executed && a.executedAt)
    .map(a => daysBetween(a.reportDate, a.executedAt!.slice(0, 10)))
    .filter(d => d >= 0)
    .sort((x, y) => x - y)
  const median = lat.length
    ? lat.length % 2 === 1
      ? lat[(lat.length - 1) / 2]
      : (lat[lat.length / 2 - 1] + lat[lat.length / 2]) / 2
    : null

  return {
    e1: {
      rate: total > 0 ? done / total : null,
      total, done, pending,
      detail: total === 0
        ? '尚无应执行动作'
        : `${done}/${total} 已执行${pending.length ? `，最久挂账 ${pending[0].ageDays} 天（${pending[0].code} ${pending[0].clause}）` : ''}`,
    },
    e2: {
      rate: dataChecks.length ? present / dataChecks.length : null,
      present, required: dataChecks.length, missing,
      detail: missing.length === 0 ? '决策所需数据完整' : `缺 ${missing.length} 项：${missing.join('、')}`,
    },
    e3: computeE3(input.e3),
    e4: {
      medianDays: median,
      maxDays: lat.length ? lat[lat.length - 1] : null,
      samples: lat.length,
      oldestPendingDays: pending.length ? pending[0].ageDays : null,
      detail: lat.length === 0
        ? (pending.length
          ? `尚无已回填执行时间的样本；当前最久挂账 ${pending[0].ageDays} 天`
          : '尚无样本')
        : `中位 ${median} 天，最长 ${lat[lat.length - 1]} 天，样本 ${lat.length} 条`,
    },
  }
}

// ════════════════════════════════════════════════════════════════════════════
//  Markdown 归档
// ════════════════════════════════════════════════════════════════════════════

function pct(v: number | null): string {
  return v === null ? '—' : `${(v * 100).toFixed(1)}%`
}

/**
 * 渲染为 Markdown。
 *
 * 为什么要落成 Markdown 而不只存 JSON：三个月后回看时，读者可能没有跑起来的系统，
 * 也可能已经改过了数据库结构。一份纯文本能独立于系统存活。
 */
export function renderAuditMarkdown(audit: DailyAudit, kpi?: KpiBoard): string {
  const L: string[] = []
  const a = audit.actions

  L.push(`## ${audit.date} 决策审计`)
  L.push('')
  L.push(`**今日核心决策：${audit.coreDecision}**`)
  L.push('')

  L.push('### 动作')
  L.push('')
  L.push(`- 执行债务：${a.executionDebt} 项`)
  L.push(`- 新增建仓：${a.newEntries}`)
  L.push(`- 法定减仓：${a.legalReduces.length ? a.legalReduces.map(r => r.name).join('、') : '无'}`)
  L.push(`- 技术复核但不动作：${a.reviewedNoAction.length ? a.reviewedNoAction.map(r => `${r.name}（${r.triggerCount}项）`).join('、') : '无'}`)
  if (a.holds.length) L.push(`- 持有（无复核项）：${a.holds.join('、')}`)
  L.push('')

  L.push('### 为什么？')
  L.push('')
  if (audit.why.length === 0) L.push('- 无动作，无须理由')
  else for (const w of audit.why) L.push(`- ${w}`)
  L.push('')

  L.push('### 为什么没有买？')
  L.push('')
  if (audit.whyNoBuy.length === 0) L.push('- 本日不处于禁止建仓状态')
  else for (const r of audit.whyNoBuy) L.push(`- ${r}`)
  L.push('')

  L.push('### 数据缺口')
  L.push('')
  for (const g of audit.dataGaps) L.push(`- ${g}`)
  L.push('')

  if (!kpi) {
    // 不写 KPI 小节会让三个月后的读者以为当天没统计过。明说缺在哪里，与"数据缺口不用默认值"同理。
    L.push('### KPI')
    L.push('')
    L.push('- 本条由命令行归档（`npm run cockpit`），不连数据库。')
    L.push('- E1 执行率 / E3 规则一致性 / E4 延迟 需要执行台账与历史审计序列，见 API 版审计（`GET /api/cockpit/today`）。')
    L.push('')
  }

  if (kpi) {
    L.push('### KPI')
    L.push('')
    L.push('| 指标 | 值 | 说明 |')
    L.push('|---|---|---|')
    L.push(`| E1 执行率 | ${pct(kpi.e1.rate)} | ${kpi.e1.detail} |`)
    L.push(`| E2 数据完整度 | ${pct(kpi.e2.rate)} | ${kpi.e2.detail} |`)
    L.push(`| E3 规则一致性 | ${pct(kpi.e3.complianceRate)} | ${kpi.e3.checks.map(c => `${c.passed ? '✓' : '✗'}${c.name}`).join('；')} |`)
    L.push(`| E4 延迟 | ${kpi.e4.medianDays === null ? '—' : `${kpi.e4.medianDays}天`} | ${kpi.e4.detail} |`)
    L.push('')
    L.push(`> E3 方法论：${kpi.e3.methodology}`)
    L.push('')
  }

  L.push('### 规则指纹')
  L.push('')
  L.push(`- 指纹 \`${audit.rules.fingerprint.hash}\`，共 ${audit.rules.fingerprint.entryCount} 条决策生效参数`)
  L.push(`- 等级分布：${Object.entries(audit.rules.fingerprint.tierCounts).map(([t, n]) => `${t}=${n}`).join('，')}`)
  if (audit.rules.drift) {
    L.push(`- ${audit.rules.drift.drifted ? '⚠ **规则已漂移**' : '规则未漂移'}：${audit.rules.drift.detail}`)
  } else {
    L.push('- 未找到冻结基线，无法判定漂移')
  }
  L.push('')

  return L.join('\n')
}

export { ACTION_TEXT }
