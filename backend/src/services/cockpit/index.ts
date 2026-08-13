// 每日投资驾驶舱 —— 六问编排器
//
// 设计原则（委员会 2026-08-13）：
//   数据自动化 > 规则自动化 > 决策结构化 > 人工最终确认。
//   小程序不假装能预测涨跌。它负责把事实、风险、机会和纪律摆在面前，
//   然后**只按已验证过的规则**给出动作建议。
//
// 因此本文件里动作的来源被严格限定：
//   减仓动作 ← 只来自第①问（账务事实：仓位超限/熔断/安全垫/硬止损）
//   买入动作 ← 只来自第④问且必须 S3 + 四道闸门全放行
//   其余一切（技术结构、节点势能、雷达评分）→ 只能进 reviewTriggers
//
// "今日什么都不要做" 是**合法且常见**的输出，不是失败。系统不需要每天有动作。

import type { DailyBar, Position, AccountSnapshot } from '../tios/types'
import { runMsr, MSR_BACKTEST_EVIDENCE, BLOCK_TEXT, type MsrReport, type MsrCandidate } from '../msr'
import { STAGE_TEXT, WINDOW_COLOR_TEXT } from '../msr/promotion'
import type { ValuationInjection } from '../msr/valuation'
import { MAINLINES } from '../msr/universe'
import type { MainlineHealth } from '../msr/health'
import { evaluateSafety, findLimitBreaches, worstLight, LIMITS, type SafetyInput } from './safety'
import { evaluateMomentum, type MomentumRow } from './momentum'
import { evaluateNodes, nodeOf } from './nodes'
import {
  makeAction, ACTION_TEXT, LEGAL_REASON_TEXT,
  type Action, type Answer, type AnswerRow, type CockpitReport, type CockpitRow,
  type Light, type Metric,
} from './types'

export interface CockpitInput {
  date: string
  snapshot: AccountSnapshot
  positions: Position[]
  barsByCode: Record<string, DailyBar[]>
  indexBarsByCode: Record<string, DailyBar[]>
  /** 未执行卖出指令条数 —— 执行债务 */
  pendingSellCount: number
  valuationByCode?: Record<string, ValuationInjection>
  /** 家庭年度刚性支出。未提供则安全垫判为数据缺失 */
  householdAnnualExpense?: number
  /** 市场阶段是否允许建仓。缺省从严按不允许 */
  marketAllows?: boolean
}

function pctStr(v: number | null): string {
  return v === null ? '缺失' : `${(v * 100).toFixed(1)}%`
}

/**
 * 主线健康度的三色与决策映射。
 * TAIL_CHASE（末端补涨）刻意映射为"不追" —— 这正是委员会要求区分健康轮动与末端补涨的落点。
 */
const HEALTH_TEXT: Record<MainlineHealth, string> = {
  ROTATION: '内部轮动',
  TAIL_CHASE: '末端补涨',
  HEALTHY_UPTREND: '龙头健康上行',
  BROAD_RETREAT: '全面退潮',
  INSUFFICIENT_DATA: '样本不足',
}

const HEALTH_LIGHT: Record<MainlineHealth, Light> = {
  ROTATION: 'YELLOW',
  TAIL_CHASE: 'RED',
  HEALTHY_UPTREND: 'GREEN',
  BROAD_RETREAT: 'RED',
  INSUFFICIENT_DATA: 'UNKNOWN',
}

const HEALTH_DECISION: Record<MainlineHealth, string> = {
  ROTATION: '继续跟踪（允许输出二线候选）',
  TAIL_CHASE: '不追（龙头调整而二线普涨，禁止输出候选）',
  HEALTHY_UPTREND: '持有（龙头未调整，无需换手）',
  BROAD_RETREAT: '主线战术降仓',
  INSUFFICIENT_DATA: '先补数据',
}

function wanStr(v: number): string {
  return `${(v / 10000).toFixed(1)}万`
}

/** 第④问：有没有真正值得研究的新核心？只给 Top 3 */
function evaluateNewCores(msr: MsrReport, asOf: string): { answer: Answer; top: MsrCandidate[] } {
  const top = msr.potentialCores.slice(0, 3)
  const rows: AnswerRow[] = top.map(c => {
    const r = c.radar
    const metrics: Metric[] = [
      {
        label: '雷达合计', value: r.total, display: `${r.total.toFixed(1)}/25`,
        source: 'MSR五维雷达', asOf, tier: 'OBSERVATION',
        formula: `资金${r.capital.score} + 相对强度${r.relativeStrength.score} + 趋势${r.trend.score} + 产业证据${r.evidence.score} + 估值${r.valuation.score}`,
      },
      {
        label: '资金', value: r.capital.score, display: `${r.capital.score.toFixed(1)}/5`,
        source: '成交额与涨跌量比（真实资金结构数据缺失，此为代理指标）',
        formula: r.capital.detail, asOf, tier: 'OBSERVATION',
      },
      {
        label: '相对强度', value: r.relativeStrength.score, display: `${r.relativeStrength.score.toFixed(1)}/5`,
        source: '对主线基准超额', formula: r.relativeStrength.detail, asOf, tier: 'OBSERVATION',
      },
      {
        label: '产业证据', value: r.evidence.score, display: `${r.evidence.score.toFixed(1)}/5`,
        source: 'msr/universe.ts 人工维护的证据等级', formula: r.evidence.detail, asOf, tier: 'ACCOUNTING',
      },
      {
        label: 'PE历史分位', value: r.valuation.score, display: `${r.valuation.score.toFixed(1)}/5`,
        source: '东方财富财报 + 未复权价格，按公告日对齐',
        formula: r.valuation.detail, asOf, tier: 'ACCOUNTING',
      },
      {
        label: '价格窗口', value: null, display: WINDOW_COLOR_TEXT[c.promotion.priceWindow.color],
        source: 'promotion.evaluatePriceWindow（五判据已删四留一）',
        formula: c.promotion.priceWindow.detail, asOf,
        tier: c.promotion.priceWindow.color === 'RED_EXTREME' ? 'VALIDATED' : 'OBSERVATION',
      },
    ]
    const blocked = c.promotion.blockedBy.length > 0 || c.blocks.length > 0
    return {
      label: `${r.name}（${nodeOf(r.code) ?? r.node}）`,
      status: `${r.total.toFixed(1)}/25｜${STAGE_TEXT[c.promotion.stage]}`,
      light: c.actionable ? 'GREEN' : 'YELLOW',
      decision: c.actionable
        ? '晋级S3且闸门放行 → 进入买入候选'
        : `进入候选池，不建议立即买。卡点：${[...c.promotion.blockedBy, ...c.blocks.map(b => BLOCK_TEXT[b])].slice(0, 3).join('；') || '无'}`,
      metrics,
      reviewTriggers: blocked ? c.promotion.blockedBy : [],
    }
  })

  const headline = top.length === 0
    ? '今日无新势能位置进入候选'
    : `Top ${top.length}：${top.map(c => `${c.radar.name} ${c.radar.total.toFixed(1)}/25`).join('、')}` +
      `。${top.filter(c => c.actionable).length}个通过全部闸门`

  return {
    answer: { no: 4, question: '有没有真正值得研究的新核心？', light: 'GREEN', headline, metrics: [], rows },
    top,
  }
}

/** 第⑤问：今天有没有真正可以执行的动作？ */
function evaluateActions(
  input: CockpitInput, momentumRows: MomentumRow[], msr: MsrReport, asOf: string
): { answer: Answer; actions: Action[] } {
  const actions: Action[] = []
  const total = input.snapshot.totalAssets
  const breaches = findLimitBreaches({ snapshot: input.snapshot, positions: input.positions, asOf })
  const triggerByCode = new Map(momentumRows.map(r => [r.code, r.reviewTriggers]))

  // ── 减仓：只由账务事实产生 ──
  for (const b of breaches) {
    const px = input.barsByCode[b.code]?.slice(-1)[0]?.close ?? null
    const shares = px && px > 0 ? Math.floor(b.excessValue / px / 100) * 100 : null
    actions.push(makeAction({
      code: b.code, name: b.name, kind: 'REDUCE', reason: 'POSITION_LIMIT',
      reasonDetail:
        `仓位${pctStr(b.currentPct)} > 上限${pctStr(b.limitPct)}，` +
        `超出${((b.currentPct - b.limitPct) * 100).toFixed(1)}pct，需卖出约${wanStr(b.excessValue)}`,
      notReason: [
        '不是因为对该标的的股价判断',
        '不是因为主线逻辑变化（战略评级不变）',
        '不是因为技术指标（技术项仅触发复核，见下方观察项）',
      ],
      reviewTriggers: triggerByCode.get(b.code) ?? [],
      size: {
        display: shares === null ? '待补价格' : `约${shares}股`,
        value: shares,
        note: shares === null
          ? '缺当前价，无法换算股数'
          : `${wanStr(b.excessValue)} ÷ ${px!.toFixed(2)}元 ≈ ${shares}股（向下取整至100股）`,
      },
      metrics: [{
        label: '当前仓位占比', value: b.currentPct, display: pctStr(b.currentPct),
        source: 'positions.market_value / 总资产',
        formula: `市值 ÷ 总资产${wanStr(total)}`, asOf, tier: 'ACCOUNTING',
      }],
    }))
  }

  // ── 熔断强制降仓 ──
  const dd = input.snapshot.peakAssets > 0 ? 1 - total / input.snapshot.peakAssets : null
  const capByDd = dd === null ? null : dd >= LIMITS.circuitLevel2 ? 0.30 : dd >= LIMITS.circuitLevel1 ? 0.50 : null
  const posPct = total > 0 ? input.snapshot.positionsValue / total : null
  if (capByDd !== null && posPct !== null && posPct > capByDd) {
    const need = (posPct - capByDd) * total
    actions.push(makeAction({
      code: 'PORTFOLIO', name: '组合整体', kind: 'REDUCE', reason: 'CIRCUIT_BREAKER',
      reasonDetail:
        `自峰值回撤${pctStr(dd)}（≥${pctStr(capByDd === 0.30 ? LIMITS.circuitLevel2 : LIMITS.circuitLevel1)}），` +
        `仓位上限${pctStr(capByDd)}，当前${pctStr(posPct)}，需卖出约${wanStr(need)}` +
        (capByDd === 0.30 ? '，且进入只卖不买状态' : ''),
      notReason: ['不是对后市方向的判断', '不是因为主线被证伪'],
      reviewTriggers: [],
      size: { display: wanStr(need), value: need, note: `(${pctStr(posPct)} − ${pctStr(capByDd)}) × 总资产${wanStr(total)}` },
      metrics: [{
        label: '自峰值回撤', value: dd, display: pctStr(dd),
        source: 'account_state.peak_assets',
        formula: `1 − ${wanStr(total)} ÷ ${wanStr(input.snapshot.peakAssets)}`, asOf, tier: 'ACCOUNTING',
      }],
    }))
  }

  // ── 买入：必须 S3 + 全部闸门放行 + 执行债务清零 ──
  const buyable = msr.potentialCores.filter(c => c.actionable)
  for (const c of buyable) {
    actions.push(makeAction({
      code: c.radar.code, name: c.radar.name, kind: 'BUY', reason: 'S3_PASSED_ALL_GATES',
      reasonDetail:
        `晋级${STAGE_TEXT[c.promotion.stage]}，四道闸门无阻断，` +
        `PE分位${c.radar.valuation.detail}，价格窗口${WINDOW_COLOR_TEXT[c.promotion.priceWindow.color]}`,
      notReason: ['不是因为雷达评分最高（评分为观察指标，实测无显著择时优势）'],
      reviewTriggers: [],
      size: {
        display: '由委员会按仓位预算决定', value: null,
        note: '首仓规模不由本系统决定；单票不得超过12%上限',
      },
      metrics: [],
    }))
  }

  // ── 持有 / 不动作 ──
  const actedCodes = new Set(actions.map(a => a.code))
  for (const r of momentumRows) {
    if (actedCodes.has(r.code)) continue
    actions.push(makeAction({
      code: r.code, name: r.name,
      kind: r.reviewTriggers.length > 0 ? 'NONE' : 'HOLD',
      reason: 'NO_LEGAL_TRIGGER',
      reasonDetail: r.reviewTriggers.length > 0
        ? `有${r.reviewTriggers.length}项观察触发复核，但无任何法定理由成立 → 不动作`
        : '无法定理由成立且无复核触发项 → 持有',
      notReason: r.reviewTriggers.length > 0
        ? ['观察项不构成减仓理由（实测该类判据识别不出后续跑输）']
        : [],
      reviewTriggers: r.reviewTriggers,
      size: { display: '—', value: null, note: '无动作' },
      metrics: [],
    }))
  }

  const reduceCount = actions.filter(a => a.kind === 'REDUCE').length
  const buyCount = actions.filter(a => a.kind === 'BUY').length
  const light: Light = reduceCount > 0 ? 'RED' : 'GREEN'

  const rows: AnswerRow[] = actions
    .slice()
    .sort((a, b) => {
      const order = { REDUCE: 0, BUY: 1, NONE: 2, HOLD: 3 }
      return order[a.kind] - order[b.kind]
    })
    .map(a => ({
      label: `${a.name} → ${ACTION_TEXT[a.kind]}`,
      status: a.size.display,
      light: a.kind === 'REDUCE' ? 'RED' : a.kind === 'BUY' ? 'GREEN' : 'GREEN',
      decision: `法定理由：${LEGAL_REASON_TEXT[a.reason]}｜${a.reasonDetail}` +
        (a.notReason.length ? `｜非理由：${a.notReason.join('；')}` : ''),
      metrics: a.metrics,
      reviewTriggers: a.reviewTriggers,
    }))

  const headline =
    reduceCount === 0 && buyCount === 0
      ? '今日无买入、无减仓 —— 全部持有或不动作'
      : `减仓${reduceCount}项、买入${buyCount}项。每项均附法定理由，且法定理由中不含任何预测性表述`

  return {
    answer: { no: 5, question: '今天有没有真正可以执行的动作？', light, headline, metrics: [], rows },
    actions,
  }
}

/** 第⑥问：今天是不是什么都不要做？ */
function evaluateNoNewEntry(
  input: CockpitInput, msr: MsrReport, actions: Action[], asOf: string
): { answer: Answer; noNewEntry: { verdict: boolean; reasons: string[] } } {
  const reasons: string[] = []

  if (input.pendingSellCount > 0) {
    reasons.push(`执行债务未清：${input.pendingSellCount}条卖出指令未执行`)
  }
  const s3 = msr.potentialCores.filter(c => c.promotion.stage === 'STAGE_3_PRICE_WINDOW').length
  if (s3 === 0) {
    reasons.push(`无候选晋级S3（${msr.potentialCores.length}个进入窗口但未过验证/估值/价格闸门）`)
  }
  const extreme = msr.potentialCores.filter(c => c.promotion.priceWindow.color === 'RED_EXTREME')
  if (extreme.length) {
    reasons.push(`${extreme.length}个候选处于极端急涨区（10日涨幅>50%）：${extreme.map(c => c.radar.name).join('、')}`)
  }
  const highPe = msr.potentialCores.filter(c => c.blocks.includes('VALUATION_PERCENTILE_HIGH'))
  if (highPe.length) {
    reasons.push(`${highPe.length}个候选PE历史分位>80%：${highPe.map(c => c.radar.name).join('、')}`)
  }
  const incomplete = msr.potentialCores.filter(c => c.blocks.includes('SCORE_INCOMPLETE'))
  if (incomplete.length) {
    reasons.push(`${incomplete.length}个候选评分不完整（数据缺失）`)
  }
  if (input.marketAllows !== true) {
    reasons.push('市场阶段不允许建仓（下跌期/熔断期，或阶段判定未确认）')
  }
  const dd = input.snapshot.peakAssets > 0 ? 1 - input.snapshot.totalAssets / input.snapshot.peakAssets : null
  if (dd !== null && dd >= LIMITS.circuitLevel2) {
    reasons.push(`组合回撤${pctStr(dd)} ≥ ${pctStr(LIMITS.circuitLevel2)} → 只卖不买`)
  }

  const buyCount = actions.filter(a => a.kind === 'BUY').length
  const verdict = buyCount === 0

  const light: Light = verdict ? 'GREEN' : 'YELLOW'
  const headline = verdict
    ? `今日无新增建仓。原因${reasons.length}项，逐条列明如下 —— 不为了让系统"有输出"而强行找股票买`
    : `今日有${buyCount}项买入通过全部闸门`

  return {
    answer: {
      no: 6, question: '今天是不是什么都不要做？', light, headline, metrics: [],
      rows: reasons.map(r => ({ label: '禁止建仓原因', status: r, light: 'GREEN' as Light, decision: '不建仓' })),
    },
    noNewEntry: { verdict, reasons },
  }
}

export function runCockpit(input: CockpitInput): CockpitReport {
  const asOf = input.date
  const dataGaps: string[] = []

  // 第①问
  const safetyInput: SafetyInput = {
    snapshot: input.snapshot, positions: input.positions,
    householdAnnualExpense: input.householdAnnualExpense, asOf,
  }
  const safety = evaluateSafety(safetyInput)
  const breaches = findLimitBreaches(safetyInput)
  if (input.householdAnnualExpense === undefined) dataGaps.push('家庭年度刚性支出未提供 → 安全垫无法判定')
  if (input.snapshot.peakAssets <= 0) dataGaps.push('account_state.peak_assets 缺失 → 回撤与熔断线无法判定')

  // 第②问
  const momentum = evaluateMomentum({
    positions: input.positions, barsByCode: input.barsByCode, indexBarsByCode: input.indexBarsByCode,
    marketBars: input.indexBarsByCode['sz399006'], valuationByCode: input.valuationByCode,
    breaches, asOf,
  })

  // 第③问
  const nodes = evaluateNodes({
    barsByCode: input.barsByCode, indexBarsByCode: input.indexBarsByCode, asOf,
  })
  const gapNodes = nodes.nodes.filter(n => n.coverage === 'NO_MEMBER')
  if (gapNodes.length) {
    dataGaps.push(`${gapNodes.length}个产业链节点无覆盖标的：${gapNodes.map(n => `${n.mainlineName}/${n.node}`).join('、')}`)
  }

  // MSR
  const msr = runMsr({
    date: input.date, barsByCode: input.barsByCode, indexBarsByCode: input.indexBarsByCode,
    pendingSellCount: input.pendingSellCount, marketAllows: input.marketAllows,
    valuationByCode: input.valuationByCode,
  })
  const unusableVal = Object.entries(input.valuationByCode ?? {}).filter(([, v]) => !v.usable)
  if (unusableVal.length) {
    dataGaps.push(`${unusableVal.length}只标的PE分位不可用（TTM亏损或PE极端）`)
  }
  if (!input.valuationByCode || Object.keys(input.valuationByCode).length === 0) {
    dataGaps.push('PE历史分位未生成 → 估值维度全部记0，S3全部阻断。先跑 npm run msr:valuation')
  }
  dataGaps.push('资金结构数据缺失（北向/融资余额/龙虎榜/机构持仓/大宗）→ 资金维度使用成交额与涨跌量比作代理')
  dataGaps.push('扣非利润与主线收入占比尚未接入 → S2盈利验证仍靠人工维护字段')

  // 第④问
  const cores = evaluateNewCores(msr, asOf)

  // 第⑤问
  const acts = evaluateActions(input, momentum.rows, msr, asOf)

  // 第⑥问
  const none = evaluateNoNewEntry(input, msr, acts.actions, asOf)

  const answers = [safety, momentum.answer, nodes.answer, cores.answer, acts.answer, none.answer]

  // ── 首页单表 ──
  const reduceCount = acts.actions.filter(a => a.kind === 'REDUCE').length
  const buyCount = acts.actions.filter(a => a.kind === 'BUY').length
  const reviewCount = momentum.rows.filter(r => r.reviewTriggers.length > 0).length
  const s3Count = msr.potentialCores.filter(c => c.promotion.stage === 'STAGE_3_PRICE_WINDOW').length
  const cashPct = input.snapshot.totalAssets > 0 ? input.snapshot.cash / input.snapshot.totalAssets : null

  const table: CockpitRow[] = [
    {
      item: '总组合风险', todayStatus: safety.headline, light: safety.light,
      decision: safety.light === 'RED' ? '按法定理由降仓'
        : safety.light === 'UNKNOWN' ? '先补数据' : safety.light === 'YELLOW' ? '控制仓位' : '正常',
    },
    {
      item: '现金', todayStatus: pctStr(cashPct),
      light: cashPct === null ? 'UNKNOWN' : cashPct <= LIMITS.cashFloor ? 'RED' : cashPct < 0.15 ? 'YELLOW' : 'GREEN',
      decision: cashPct !== null && cashPct <= LIMITS.cashFloor ? '禁止新增建仓' : '正常',
    },
    ...MAINLINES.map(ml => {
      const h = msr.health.find(x => x.mainlineId === ml.id)!
      return {
        item: ml.name,
        todayStatus: `${h.health}（${HEALTH_TEXT[h.health]}）`,
        light: HEALTH_LIGHT[h.health],
        decision: HEALTH_DECISION[h.health],
      }
    }),
    {
      item: 'TPO（谁在失去势能）', todayStatus: `${reviewCount}只触发复核`,
      light: reviewCount > 0 ? 'YELLOW' : 'GREEN',
      decision: reviewCount > 0 ? '复核（观察项，不构成减仓理由）' : '正常',
    },
    {
      item: 'MSR（谁在获得势能）', todayStatus: `${msr.potentialCores.length}只新势能`,
      light: 'GREEN', decision: '研究',
    },
    {
      item: 'S3可买', todayStatus: `${s3Count}/${msr.potentialCores.length}`,
      light: s3Count > 0 ? 'GREEN' : 'GREEN',
      decision: buyCount > 0 ? `买入${buyCount}项` : '不买',
    },
    {
      item: '执行债务', todayStatus: `${input.pendingSellCount}项未执行`,
      light: input.pendingSellCount > 0 ? 'RED' : 'GREEN',
      decision: input.pendingSellCount > 0 ? '优先执行' : '已清零',
    },
    {
      item: '数据完整性', todayStatus: `${dataGaps.length}项缺口`,
      light: dataGaps.length > 2 ? 'YELLOW' : 'GREEN',
      decision: dataGaps.length ? '缺口已列明，不用默认值替代' : '完整',
    },
  ]

  // ── 今日核心决策一句话 ──
  const coreDecision =
    input.pendingSellCount > 0
      ? `优先清偿执行债务（${input.pendingSellCount}条未执行卖出指令），今日无新增建仓。` +
        (reduceCount ? `另有${reduceCount}项法定减仓待执行。` : '')
      : reduceCount > 0
        ? `执行${reduceCount}项法定减仓（理由：${[...new Set(acts.actions.filter(a => a.kind === 'REDUCE').map(a => LEGAL_REASON_TEXT[a.reason]))].join('、')}），今日${buyCount ? `买入${buyCount}项` : '无新增建仓'}。`
        : buyCount > 0
          ? `买入${buyCount}项（已过S3与四道闸门），无减仓。`
          : '今日什么都不要做。无法定减仓理由成立，无候选通过S3闸门。'

  return {
    date: input.date,
    table,
    coreDecision,
    answers,
    actions: acts.actions,
    noNewEntry: none.noNewEntry,
    disclosure: {
      headline:
        '本系统不预测涨跌。未经样本外检验的模型只作"观察指标"，不得产生动作 —— ' +
        '这条约束写在类型层（cockpit/types.ts），绕过它需要改代码并通过CI自检。',
      items: [
        {
          model: 'MSR 主线内部轮动雷达', tier: 'OBSERVATION',
          measured: `入场信号相对基准优势 +1.05pct，95%区间 [-0.89, +3.40] 跨0；组合择时贡献 ${(MSR_BACKTEST_EVIDENCE.timingContribution * 100).toFixed(1)}pct，回撤更深。结论：未被证明有择时能力`,
        },
        {
          model: 'TPO 技术结构判据', tier: 'OBSERVATION',
          measured: '退出信号后继续持有的超额代价：20日 -1.02pct、60日 +0.56pct → 识别不出后续跑输，仅可触发复核',
        },
        {
          model: '价格窗口 10日涨幅>50%', tier: 'VALIDATED',
          measured: '减同期基准 -7.25pct，95%区间 [-12.6, -1.4] 不含0 → 五个价格判据中唯一存活，保留硬否决权',
        },
        {
          model: '价格窗口 其余四判据（长上影/爆量/距MA20>15%/10日涨>30%）', tier: 'OBSERVATION',
          measured: '区间全部跨0，其中长上影反向且显著（+1.14pct，[+0.2,+3.2]）→ 已从代码中删除否决权',
        },
        {
          model: '仓位上限12% / 熔断15%·25% / 现金红线10%', tier: 'ACCOUNTING',
          measured: '与预测无关的风险预算约束，不需要检验也不受回测影响 → 当前唯一确定有价值的部分',
        },
      ],
    },
    dataGaps,
    // 供五层驾驶舱装配层复用。刻意不重算 —— 两处各算一遍必然漂移。
    internals: { momentumRows: momentum.rows, msr, nodes: nodes.nodes },
  }
}

export { worstLight }
export type { Action, CockpitReport, Answer, CockpitRow }
