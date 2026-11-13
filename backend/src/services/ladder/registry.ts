/**
 * 名单治理（L-01）· 名单主表
 *
 * 委员会 2026-10-16 裁定一：六份观察名单统一纳入一条六级梯子。
 *   全市场 → 研究池 → 观察池 → 备选池 → 可申请建仓 → 持仓
 *
 * 纪律：
 *   - 每只股票只有一个当前层级；来源可以有多个，但来源本身不授予层级。
 *   - 层级逐级计算：上一级条件不满足，就不看下一级。
 *   - 委员会点名只能触发研究，不能直接指定买入资格。
 *   - 资金信号只改变研究优先级：只有资金异动观察计划的股票，到不了备选池。
 *   - 备选池的三道条件（产业证据、盈利核验、主线归因）分别检查、分别列出，不合并成「研究通过」。
 *   - 买入权限关闭时，第 5 级为空，不评估第四级闸门。
 *
 * 本文件是纯函数：不读行情、不写台账、不产生动作。
 */

import { COMBAT_MAINLINE_IDS, MIN_EVIDENCE_FOR_CANDIDATE, RESEARCH_ONLY_MAINLINE_IDS, findMember } from '../msr/universe'
import { radarGroupsOf, radarLockText } from '../moneyRadar/config'
import { collectSources, type PortfolioLite, type SourcedName } from './sources'
import {
  LEVEL_NAME, TODO_RANK, type BuyPermissionState, type GateCheck, type LadderEntry, type LadderLevel,
  type LadderView, type ObservePlan, type ObservePurpose, type ReviewRecord, type ReviewTodo, type SourceId,
  type SourceTag, type StrategyScope,
} from './types'

export const LADDER_ID = 'L-01'

/**
 * 观察期限（2026-10-16 预登记；委员会同日批准为预登记试行参数）。
 *
 * 委员会要求按观察目的分别设定，不先拍一个统一数字。三个目的的口径：
 *   资金异动：30 个自然日，约 20 个交易日，与资金哨兵 20 日成交额份额窗口一致。
 *             交易所日历接入前按自然日计；接入后改按交易日。
 *   盈利验证：到下一个定期报告的法定披露截止日（一季报与年报 4/30、中报 8/31、三季报 10/31）。
 *             利润只能在报告披露后核验；披露前是「等待披露」，不等于「证据已失效」。
 *   产业验证：90 个自然日，约一个季度，覆盖一次送样 → 认证的节点。
 *
 * 到期硬规则（委员会 2026-10-16）：到期必须产生一条明确的复核结论。
 *   不自动续期，不因到期自动升级；到期未复核标「逾期未复核」，不得静默续留。
 */
export const OBSERVE_PERIODS = {
  status: 'TRIAL' as const,
  registeredOn: '2026-10-16',
  approvedOn: '2026-10-16',
  approver: '投资委员会',
  MONEY: { days: 30, rule: '自加入起 30 个自然日（约 20 个交易日）；续留须写明新期限' },
  EARNINGS: { days: null, rule: '下一个定期报告法定披露截止日（4/30、8/31、10/31）；续留须写明新期限' },
  INDUSTRY: { days: 90, rule: '自加入起 90 个自然日（约一个季度）；续留须写明新期限' },
}

/** 复核责任人。委员会尚未指派到人，先记委员会；指派后改这里 */
export const REVIEW_OWNER: Record<ObservePurpose, string> = {
  MONEY: '投资委员会（具体责任人待指派）',
  EARNINGS: '投资委员会（具体责任人待指派）',
  INDUSTRY: '投资委员会（具体责任人待指派）',
}

/** 来源提供的观察计划。没有列在这里的来源（股票池、全景图、委员会点名）只到研究池 */
const PLAN_OF: Partial<Record<SourceId, { purpose: ObservePurpose; metrics: string; exitWhen: string }>> = {
  R01_WATCH: {
    purpose: 'MONEY',
    metrics: '资金哨兵 R-01：七状态、成交额份额水位、背离与撤离提醒',
    exitWhen: '到期时没有出现启动、趋势或爆发等有效状态，或方向逻辑失效 → 降回研究池或移出；资金信号本身不能升级层级',
  },
  R01_RADAR: {
    purpose: 'MONEY',
    metrics: '资金哨兵 R-01：个股与方向篮子的七状态、成交额份额水位、背离与撤离提醒',
    exitWhen: '到期时没有出现启动、趋势或爆发等有效状态，或方向逻辑失效 → 降回研究池或移出；资金信号本身不能升级层级',
  },
  R02_PRESELECT: {
    purpose: 'EARNINGS',
    metrics: 'R-02：扣非与单季利润、经营现金流、合同负债 / 存货 / 应收、一致预期节奏',
    exitWhen: '定期报告披露后扣非利润或经营现金流证伪 → 降回研究池；核验通过 → 由研究档案更新盈利核验标记，再按第 4 级条件重算',
  },
  R02_NEXT: {
    purpose: 'EARNINGS',
    metrics: 'R-02：扣非与单季利润、经营现金流、合同负债 / 存货 / 应收、一致预期节奏',
    exitWhen: '定期报告披露后扣非利润或经营现金流证伪 → 降回研究池；核验通过 → 由研究档案更新盈利核验标记，再按第 4 级条件重算',
  },
}

/**
 * 复核结论。四种，一一对应委员会 2026-10-16 列出的结论：
 *   证据增强且满足条件 → 申请升级（APPLY_UP）：只是申请，层级仍由本级条件计算，条件不满足就不升
 *   证据不足但仍有研究价值 → 续留（KEEP）：写明理由与新期限
 *   证据失效或研究价值消失 → 降级（DOWN）或移出（REMOVE）
 * 到期未复核不是一种结论，由 reviewTodo = OVERDUE 标出。
 */
export type ReviewAction = 'APPLY_UP' | 'KEEP' | 'DOWN' | 'REMOVE'

/** 复核发现：结论必须与发现对应 */
export type ReviewFinding = 'STRONGER' | 'INSUFFICIENT' | 'INVALID' | 'NO_VALUE'

export const REVIEW_ACTION_TEXT: Record<ReviewAction, string> = {
  APPLY_UP: '申请升级（按本级条件重算，条件不满足不升）',
  KEEP: '续留',
  DOWN: '降级（降回研究池）',
  REMOVE: '移出（离开名单主表；股票池成员须另改研究档案）',
}

export const REVIEW_FINDING_TEXT: Record<ReviewFinding, string> = {
  STRONGER: '证据增强',
  INSUFFICIENT: '证据不足，仍有研究价值',
  INVALID: '证据已失效',
  NO_VALUE: '研究价值消失',
}

const FINDINGS_FOR: Record<ReviewAction, readonly ReviewFinding[]> = {
  APPLY_UP: ['STRONGER'],
  KEEP: ['INSUFFICIENT'],
  DOWN: ['INVALID', 'NO_VALUE'],
  REMOVE: ['INVALID', 'NO_VALUE'],
}

export interface ReviewDecision {
  date: string
  code: string
  action: ReviewAction
  finding: ReviewFinding
  /** 只针对某一类观察计划；不填 = 全部 */
  purpose?: ObservePurpose
  approver: string
  /** 理由；续留必须写明 */
  note: string
  /** 续留与申请升级必填：下一次复核期限，须晚于决定日。不自动续期 */
  newDeadline?: string
}

/** 复核记录是否有效。无效记录不计入，相关观察计划按未复核处理 */
export function validateDecision(d: ReviewDecision): string | null {
  if (!REVIEW_ACTION_TEXT[d.action]) return `未知结论 ${String(d.action)}`
  if (!FINDINGS_FOR[d.action].includes(d.finding)) {
    return `结论「${REVIEW_ACTION_TEXT[d.action]}」须对应发现：${FINDINGS_FOR[d.action].map(f => REVIEW_FINDING_TEXT[f]).join(' 或 ')}`
  }
  if (!d.approver?.trim()) return '缺审批人'
  if (!d.note?.trim()) return '缺理由'
  if (d.action === 'KEEP' || d.action === 'APPLY_UP') {
    if (!d.newDeadline || !/^\d{4}-\d{2}-\d{2}$/.test(d.newDeadline)) return '续留与申请升级须写明新期限（YYYY-MM-DD）'
    if (d.newDeadline <= d.date) return `新期限 ${d.newDeadline} 不晚于决定日 ${d.date}`
  }
  return null
}

/** 观察计划的待办状态 */
export function reviewTodoOf(purpose: ObservePurpose, reviewBy: string, asOf: string): ReviewTodo {
  if (reviewBy < asOf) return 'OVERDUE'
  if (reviewBy === asOf) return 'DUE_TODAY'
  return purpose === 'EARNINGS' ? 'WAITING_DISCLOSURE' : 'OBSERVING'
}

export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** 下一个定期报告法定披露截止日（含当日） */
export function nextReportDeadline(iso: string): string {
  const y = Number(iso.slice(0, 4))
  for (const d of [`${y}-04-30`, `${y}-08-31`, `${y}-10-31`, `${y + 1}-04-30`]) {
    if (d >= iso) return d
  }
  return `${y + 1}-04-30`
}

export function reviewDeadline(purpose: ObservePurpose, from: string): string {
  if (purpose === 'EARNINGS') return nextReportDeadline(from)
  return addDays(from, purpose === 'MONEY' ? OBSERVE_PERIODS.MONEY.days : OBSERVE_PERIODS.INDUSTRY.days)
}

const EVIDENCE_RANK: Record<string, number> = { S: 5, A: 4, B: 3, C: 2, D: 1 }

function scopeOf(mainlineId: string | null): StrategyScope {
  if (!mainlineId) return 'OUT_OF_UNIVERSE'
  if (COMBAT_MAINLINE_IDS.includes(mainlineId)) return 'COMBAT'
  if (RESEARCH_ONLY_MAINLINE_IDS.includes(mainlineId)) return 'RESEARCH_ONLY'
  return 'OUT_OF_UNIVERSE'
}

export interface LadderInput {
  asOf: string
  generatedAt: string
  portfolio: PortfolioLite
  decisions: readonly ReviewDecision[]
  buyPermission: BuyPermissionState
  /** 第四级闸门（价格窗口、PE 分位等）的结果。买入权限关闭时不评估，传 {} 即可 */
  s3Gates?: Record<string, GateCheck[]>
  /** 自检用：替换来源展开 */
  collect?: (p: PortfolioLite) => SourcedName[]
}

/** 账户层买入权限。任何一条原因成立即关闭 */
export function buyPermissionOf(p: PortfolioLite, opts: { productionBuyApproved: boolean; exchangeCalendar: boolean }): BuyPermissionState {
  const reasons: string[] = []
  if (!opts.productionBuyApproved) reasons.push('生产买入权限未批准（须单独提交委员会审批）')
  if (!opts.exchangeCalendar) reasons.push('交易所日历未接入（买入逻辑离开模拟的前提）')
  if (!p.peakVerified) reasons.push(`峰值 ${(p.peakAssets / 1e4).toFixed(0)} 万待核验：熔断按待核验峰值计，只卖不买照常；名单治理上线不恢复买入`)
  if (p.pendingSells > 0) reasons.push(`执行债务 ${p.pendingSells} 条未清：锁死全部建仓`)
  return { open: reasons.length === 0, reasons }
}

function researchQuestion(e: { inUniverse: boolean; industryVerified?: boolean; earningsVerified?: boolean; attribution?: boolean; retiredC: boolean; sources: SourceTag[] }): string | null {
  if (e.retiredC) return '只能走冠军替换四步重新申请；在此之前只保留研究记录'
  if (e.inUniverse) {
    const gaps: string[] = []
    if (!e.industryVerified) gaps.push('产业验证：客户、产品、订单、竞争格局建档')
    if (!e.earningsVerified) gaps.push('盈利验证：扣非利润、现金流、毛利率核验')
    if (!e.attribution) gaps.push('主线收入归因核验')
    return gaps.length ? gaps.join('；') : '持续跟踪：竞争力是否连续两季下降（冠军替换四步第①步）'
  }
  const s = e.sources.map(t => t.source)
  if (s.includes('R02_PRESELECT') || s.includes('R02_NEXT')) return '利润兑现、市值计入了多少、市场是否重新认可（R-02）；未进股票池，须先建产业档案'
  if (s.includes('R01_RADAR') || s.includes('R01_WATCH')) return '资金是否持续流向该方向（R-01）；未进股票池，须先建产业档案'
  if (s.includes('MAP_V1')) return '是否值得建立公司档案（全景图初稿名单）'
  return null
}

export function buildLadder(input: LadderInput): LadderView {
  const { asOf, portfolio, buyPermission } = input
  const invalidDecisions: LadderView['invalidDecisions'] = []
  const decisions = input.decisions.filter(d => {
    const why = validateDecision(d)
    if (why) invalidDecisions.push({ date: d.date, code: d.code, action: String(d.action), reason: why })
    return !why
  })
  const held = new Set(portfolio.positions.map(p => p.code))
  const byCode = new Map<string, { name: string; tags: SourceTag[] }>()
  for (const s of (input.collect ?? collectSources)(portfolio)) {
    const cur = byCode.get(s.code) ?? { name: s.name, tags: [] }
    if (s.tag.source === 'HOLDING' || s.tag.source === 'MSR_UNIVERSE') cur.name = s.name
    if (!cur.tags.some(t => t.source === s.tag.source && t.group === s.tag.group)) cur.tags.push(s.tag)
    byCode.set(s.code, cur)
  }

  const entries: LadderEntry[] = []
  for (const [code, { name, tags }] of byCode) {
    const hit = findMember(code)
    const m = hit?.member
    const mainlineId = hit?.mainline.id ?? null
    const scope = scopeOf(mainlineId)
    const retiredC = !!m?.retiredC
    const champion = !!m?.champion
    const radar = radarGroupsOf(code)
    const mine = decisions.filter(d => d.code === code).sort((a, b) => a.date.localeCompare(b.date))
    const removed = mine.some(d => d.action === 'REMOVE')

    // 观察计划：来源给出期限；续留 / 申请升级用决定里写明的新期限，降级 / 移出的作废
    const plans: ObservePlan[] = []
    let lastReview: ReviewRecord | null = null
    for (const t of tags) {
      const spec = PLAN_OF[t.source]
      if (!spec) continue
      const after = mine.filter(d => d.date >= t.since && (!d.purpose || d.purpose === spec.purpose))
      const last = after.at(-1)
      if (last && (!lastReview || last.date >= lastReview.date)) {
        lastReview = { date: last.date, purpose: last.purpose ?? null, action: last.action, finding: last.finding, approver: last.approver, note: last.note }
      }
      if (last && (last.action === 'DOWN' || last.action === 'REMOVE')) continue
      if (plans.some(p => p.purpose === spec.purpose)) continue
      const reviewBy = last?.newDeadline ?? reviewDeadline(spec.purpose, t.since)
      plans.push({
        purpose: spec.purpose, source: t.source, metrics: spec.metrics,
        reviewBy,
        periodRule: OBSERVE_PERIODS[spec.purpose].rule,
        exitWhen: spec.exitWhen,
        todo: reviewTodoOf(spec.purpose, reviewBy, asOf),
        owner: REVIEW_OWNER[spec.purpose],
        upgradeApplied: last?.action === 'APPLY_UP',
      })
    }

    const question = removed && !m && !held.has(code) ? null : researchQuestion({
      inUniverse: !!m, industryVerified: m?.industryVerified, earningsVerified: m?.earningsVerified,
      attribution: m?.mainlineAttributionVerified, retiredC, sources: tags,
    })

    const gates: GateCheck[] = []
    const locks: string[] = []
    const flags: string[] = []
    for (const g of radar) locks.push(`左侧雷达·${g.name}：${radarLockText(g.scope)}`)
    if (scope === 'RESEARCH_ONLY') locks.push('所在主线只研究、仓位为零（CTC 冻结令）')

    // ── 逐级计算 ──
    let level: LadderLevel = 1
    let ceiling = ''
    let entryReason = '默认全集'
    if (!question) {
      ceiling = '没有明确的研究问题'
    } else {
      level = 2
      entryReason = m ? `MSR 股票池节点「${hit!.mainline.name} · ${m.node}」` : `来源：${tags.map(t => t.group ?? t.source).join('、')}`
      if (retiredC) {
        ceiling = 'C 级清退：只能走冠军替换四步重新申请，不进观察池'
      } else if (!plans.length) {
        ceiling = '没有观察计划（监测指标、观察周期、退出条件）'
      } else {
        level = 3
        entryReason = `观察计划：${[...new Set(plans.map(p => p.purpose))].map(p => ({ MONEY: '资金异动', EARNINGS: '盈利验证', INDUSTRY: '产业验证' })[p]).join('、')}`
        const evidenceOk = !!m && MIN_EVIDENCE_FOR_CANDIDATE.includes(m.evidence)
        gates.push({
          id: 'INDUSTRY', label: '产业证据',
          pass: m ? evidenceOk && m.industryVerified === true : false,
          detail: m ? `证据 ${m.evidence}（门槛 B 及以上）；产业档案${m.industryVerified ? '已建' : '未建'}` : '未进股票池，没有产业档案',
        })
        gates.push({
          id: 'EARNINGS', label: '盈利核验',
          pass: m?.earningsVerified === true,
          detail: m?.earningsVerified ? '扣非利润、现金流、毛利率已核验' : '未核验',
        })
        gates.push({
          id: 'ATTRIBUTION', label: '主线收入归因',
          pass: m?.mainlineAttributionVerified === true,
          detail: m?.mainlineAttributionVerified ? '已核验' : m?.mainlineAttributionVerified === false ? '已核验为不成立' : '未核验',
        })
        const verifyPlan = plans.some(p => p.purpose !== 'MONEY')
        if (scope !== 'COMBAT') {
          ceiling = scope === 'RESEARCH_ONLY' ? '所在主线只研究、仓位为零' : '未进股票池：先建产业档案，挂到作战主线的节点下'
        } else if (!verifyPlan) {
          ceiling = '只有资金异动观察：资金信号只改变研究优先级，须先有盈利或产业验证观察'
        } else if (gates.some(g => !g.pass)) {
          ceiling = `未过：${gates.filter(g => !g.pass).map(g => g.label).join('、')}`
        } else {
          level = 4
          entryReason = '产业证据、盈利核验、主线收入归因三道条件分别通过'
          if (!buyPermission.open) {
            ceiling = `买入权限关闭，第四级闸门不评估：${buyPermission.reasons.join('；')}`
          } else {
            const s3 = input.s3Gates?.[code] ?? []
            gates.push(...s3)
            if (!s3.length || s3.some(g => g.pass !== true)) {
              ceiling = s3.length ? `第四级闸门未过：${s3.filter(g => g.pass !== true).map(g => g.label).join('、')}` : '第四级闸门未评估'
            } else {
              level = 5
              entryReason = '第四级闸门全部通过，买入权限开放'
              ceiling = '只能申请，不代表批准；建仓须获批且属冻结冠军池'
            }
          }
        }
      }
    }

    if (held.has(code)) {
      level = 6
      entryReason = '账本持仓'
      ceiling = ''
      if (!champion) flags.push('持仓不在冻结冠军池：持仓资格不符，须按清退或正式裁定处理（本表不出动作）')
    }

    const watched = level === 3 || level === 4
    const first = watched
      ? [...plans].sort((a, b) => a.reviewBy.localeCompare(b.reviewBy) || TODO_RANK[b.todo] - TODO_RANK[a.todo])[0] ?? null
      : null
    const reviewBy = first?.reviewBy ?? null
    const reviewTodo: ReviewTodo | null = first?.todo ?? null
    if (watched && level === 3 && plans.some(p => p.upgradeApplied)) {
      flags.push(`已申请升级，但备选池条件未满足，层级不变：${ceiling}`)
    }
    const exitCondition = level === 6
      ? '触发 C 级清退、单票归位、熔断降仓，或正式批准的退出规则（均由执行单执行）'
      : level === 5 ? '任一闸门失效、价格窗口关闭或风险权限关闭'
      : level === 4 ? '盈利证据失效、主线归因不成立或复核不通过'
      : level === 3 ? plans.map(p => p.exitWhen).filter((x, i, a) => a.indexOf(x) === i).join('；')
      : level === 2 ? '研究价值消失或产业节点不再相关'
      : '退市或数据不可用'

    entries.push({
      code, name, level, sources: tags, scope,
      mainline: hit?.mainline.name ?? null, node: m?.node ?? tags.find(t => t.group)?.group ?? null,
      evidence: m?.evidence ?? null, champion, retiredC,
      researchQuestion: question, plans, gates, ceiling, entryReason, exitCondition,
      reviewBy, reviewOverdue: reviewTodo === 'OVERDUE', reviewTodo,
      reviewOwner: watched && plans.length ? [...new Set(plans.map(p => p.owner))].join('；') : null,
      lastReview,
      buyPermission: level === 6 ? 'EXECUTION_CARD' : level === 5 ? 'APPLY_ONLY' : 'NONE',
      locks, flags,
    })
  }

  entries.sort((a, b) => b.level - a.level || (EVIDENCE_RANK[b.evidence ?? ''] ?? 0) - (EVIDENCE_RANK[a.evidence ?? ''] ?? 0) || a.code.localeCompare(b.code))
  const counts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 } as Record<LadderLevel, number>
  for (const e of entries) counts[e.level]++

  return {
    id: LADDER_ID, asOf, generatedAt: input.generatedAt, entries, buyPermission, counts,
    marketCount: null,
    invalidDecisions,
    notes: [
      '全市场（第 1 级）由资金哨兵入口③ 申万二级行业覆盖，不逐只列出；本表只列至少有一个来源的股票',
      `观察期限为${OBSERVE_PERIODS.approver} ${OBSERVE_PERIODS.approvedOn} 批准的预登记试行参数：${(['MONEY', 'EARNINGS', 'INDUSTRY'] as const).map(p => `${{ MONEY: '资金异动', EARNINGS: '盈利验证', INDUSTRY: '产业验证' }[p]} ${OBSERVE_PERIODS[p].rule}`).join('；')}`,
      '到期必须产生一条明确的复核结论：不自动续期，不因到期自动升级；到期未复核标「逾期未复核」，不得静默续留',
      '层级由条件逐级计算，名单来源不授予层级；委员会点名只能触发研究，不能直接指定买入资格',
    ],
  }
}

/** 第 n 级的中文名，供渲染用 */
export function levelLabel(l: LadderLevel): string { return `${l}. ${LEVEL_NAME[l]}` }

/** 名单治理不产生任何动作 */
export function ladderProducesAction(): false { return false }
