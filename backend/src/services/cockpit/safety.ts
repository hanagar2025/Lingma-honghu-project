// 第①问：今天组合安全吗？
//
// 本问全部由**账务事实**构成（ACCOUNTING 等级），不含任何预测。
// 因此它是驾驶舱里唯一可以直接产生减仓动作的一问 —— 也是回测唯一没有否掉的部分。
//
// 缺数据时的处理原则：显示"缺失"并按 UNKNOWN（等同必须处理）对待，
// **绝不用默认值糊过去**。/portfolio/summary 里那个硬编码的 10万现金就是反面教材。

import type { Position, AccountSnapshot } from '../tios/types'
import { findMember } from '../msr/universe'
import type { Answer, AnswerRow, Light, Metric } from './types'

/** 仓位与风险预算上限 —— 与 tios/gates.ts、executionEngine.ts 同源，改这里须同步改那里 */
export const LIMITS = {
  singleStock: 0.12,
  sector: 0.30,
  theme: 0.45,
  cashFloor: 0.10,
  /** 组合回撤触发点：15% 降仓至50%，25% 降至30%且只卖不买 */
  circuitLevel1: 0.15,
  circuitLevel2: 0.25,
  /** 家庭安全垫：现金须覆盖的刚性支出年数 */
  safetyNetYears: 2,
} as const

export interface SafetyInput {
  snapshot: AccountSnapshot
  positions: Position[]
  /** 家庭年度刚性支出。未提供则安全垫一项判为数据缺失 —— 不猜 */
  householdAnnualExpense?: number
  /** 主线集中度按 MSR universe 的主线归属聚合 */
  asOf: string
}

function m(
  label: string, value: number | null, display: string,
  source: string, formula: string, asOf: string, missingReason?: string
): Metric {
  return { label, value, display, source, formula, asOf, tier: 'ACCOUNTING', missingReason }
}

function pctStr(v: number | null): string {
  return v === null ? '缺失' : `${(v * 100).toFixed(1)}%`
}

function wanStr(v: number | null): string {
  return v === null ? '缺失' : `${(v / 10000).toFixed(1)}万`
}

/**
 * 三色灯取最严：任一项 RED 则整体 RED；UNKNOWN 等同 RED 对待但单独标注。
 *
 * `EXCLUDED` 被直接跳过,不参与取严 —— 被战略层裁定不使用的维度既不应变红,
 * 也不应像 UNKNOWN 那样持续提示补数据。若它参与取严,
 * 「不纳入模型」就会退化成「永久亮灯的待办」。
 */
export function worstLight(lights: Light[]): Light {
  const active = lights.filter(l => l !== 'EXCLUDED')
  if (active.length === 0) return 'GREEN'
  if (active.includes('RED')) return 'RED'
  if (active.includes('UNKNOWN')) return 'UNKNOWN'
  if (active.includes('YELLOW')) return 'YELLOW'
  return 'GREEN'
}

/**
 * 家庭刚性支出的处置方式。**属于决策生效参数,已纳入规则指纹。**
 *
 * 委员会 2026-08-15 裁定不纳入 TIOS 风控模型。这不是「暂缺数据」——
 * 两者在系统里的表现必须不同:缺数据要持续提示补,裁定排除则不再出现在待办里。
 * 直接推论:FAMILY_SAFETY_NET 同时退出减仓法定理由白名单。
 */
/**
 * 回撤与熔断的**唯一**计算入口。
 *
 * 存在理由是两次真实事故。同一个公式散在五个地方，两处用了错的分母：
 *
 * | 位置 | 用的分母 | 算出回撤 | 后果 |
 * |---|---|---|---|
 * | 动作层熔断 | brokerTotal | 46.9% | 误判二级，索要 175.7 万降仓 |
 * | 禁止建仓理由 | brokerTotal | 46.9% | 误判"只卖不买"，封死全部买入 |
 * | 显示层 | portfolioTotal | 15.2% | 正确 |
 *
 * 值得单独记一句：**两次泄漏都是偏严方向。** 偏严的错误比偏松的更难发现 ——
 * 它看起来像谨慎，没人会去质疑一个"要求你少买、多卖"的风控。
 * 所以不能靠"输出看着合理"来验证分母，只能靠唯一入口。
 *
 * 口径不可比时返回 null，而不是 0：0% 读作"没跌过"，null 读作"算不出"。
 */
export interface CircuitCalc {
  /** 自峰值回撤。null = 峰值与当前值不同口径或峰值缺失 */
  drawdown: number | null
  /** 触发的股票占比上限。null = 未触发或不可判定 */
  equityCap: number | null
  /** 二级熔断：只卖不买 */
  sellOnly: boolean
  level: 'NORMAL' | 'LEVEL1' | 'LEVEL2' | 'INCOMPARABLE'
}

export function computeCircuit(snapshot: {
  portfolioTotal: number
  peakAssets: number
  peakBasis: 'BROKER' | 'PORTFOLIO'
}): CircuitCalc {
  if (snapshot.peakBasis !== 'PORTFOLIO' || !(snapshot.peakAssets > 0)) {
    return { drawdown: null, equityCap: null, sellOnly: false, level: 'INCOMPARABLE' }
  }
  const drawdown = 1 - snapshot.portfolioTotal / snapshot.peakAssets
  if (drawdown >= LIMITS.circuitLevel2) {
    return { drawdown, equityCap: 0.30, sellOnly: true, level: 'LEVEL2' }
  }
  if (drawdown >= LIMITS.circuitLevel1) {
    return { drawdown, equityCap: 0.50, sellOnly: false, level: 'LEVEL1' }
  }
  return { drawdown, equityCap: null, sellOnly: false, level: 'NORMAL' }
}

export const SAFETY_NET_POLICY = {
  mode: 'EXCLUDED_BY_STRATEGY' as 'REQUIRED' | 'EXCLUDED_BY_STRATEGY',
  ruledOn: '2026-08-15',
  statement: '家庭刚性支出约束：不纳入 TIOS 风控模型（战略层裁定）',
  rationale:
    '家庭年度刚性支出由家庭财务层管理,不作为本投资系统的风控输入。'
    + '裁定排除 ≠ 数据缺失 —— 前者系统完整,后者系统不完整。',
} as const

export function evaluateSafety(input: SafetyInput): Answer {
  const { snapshot, positions, householdAnnualExpense, asOf } = input

  // ── 三个分母，刻意分开命名，不允许出现一个叫 total 的变量 ──
  //
  // 委员会 2026-08-15 裁定：同一笔钱放在券商账户外还是账户内，
  // 不该改变股票风险的度量。故仓位上限一律用组合口径。
  // 变量名不再用 total —— 之前就是因为只有一个 total，
  // 才会把账户口径的百分比拿去和 12% 的组合上限比较。
  const brokerTotal = snapshot.brokerTotal
  const portfolioTotal = snapshot.portfolioTotal
  const totalCash = snapshot.cash + snapshot.externalCash
  const rows: AnswerRow[] = []
  const metrics: Metric[] = []

  // ── 组合总资产（上限判定的唯一分母）──
  const mTotal = m('组合总资产', portfolioTotal, wanStr(portfolioTotal),
    'Σ positions.market_value + 账内现金 + 账户外股票现金储备',
    `持仓${wanStr(snapshot.positionsValue)} + 账内现金${wanStr(snapshot.cash)}`
    + ` + 账户外${wanStr(snapshot.externalCash)}`, asOf)
  metrics.push(mTotal)
  rows.push({
    label: '组合总资产（上限分母）', status: wanStr(portfolioTotal), light: 'GREEN',
    decision: '记录', metrics: [mTotal],
  })

  const mBroker = m('券商账户合计', brokerTotal, wanStr(brokerTotal),
    '账内现金 + 持仓市值',
    `${wanStr(snapshot.cash)} + ${wanStr(snapshot.positionsValue)}`
    + `　—— 仅回答"账户里还有多少现金可直接下单"，不用于任何上限判定`, asOf)
  metrics.push(mBroker)
  const brokerPosPct = brokerTotal > 0 ? snapshot.positionsValue / brokerTotal : null
  rows.push({
    label: '券商账户内仓位', status: `${pctStr(brokerPosPct)}（账户口径，非资产配置口径）`,
    light: 'GREEN', decision: '仅供下单参考，不构成任何减仓理由', metrics: [mBroker],
  })

  // ── 现金比例（组合口径）──
  const cashPct = portfolioTotal > 0 ? totalCash / portfolioTotal : null
  const mCash = m('现金比例', cashPct, pctStr(cashPct), '（账内现金 + 账户外股票现金）/ 组合总资产',
    `${wanStr(totalCash)} ÷ ${wanStr(portfolioTotal)}`, asOf,
    portfolioTotal > 0 ? undefined : '组合总资产为0或缺失')
  metrics.push(mCash)
  const cashLight: Light =
    cashPct === null ? 'UNKNOWN' : cashPct <= LIMITS.cashFloor ? 'RED' : cashPct < 0.15 ? 'YELLOW' : 'GREEN'
  rows.push({
    label: '现金比例', status: `${pctStr(cashPct)}（红线${pctStr(LIMITS.cashFloor)}）`,
    light: cashLight,
    decision: cashLight === 'RED' ? '禁止新增建仓' : cashLight === 'YELLOW' ? '不再扩仓' : '正常',
    metrics: [mCash],
  })

  // ── 家庭安全垫：2026-08-15 起由战略层裁定排除 ──
  if (SAFETY_NET_POLICY.mode === 'EXCLUDED_BY_STRATEGY') {
    const mEx = m('家庭刚性支出', null, '不纳入模型',
      `战略层裁定（${SAFETY_NET_POLICY.ruledOn}）`,
      SAFETY_NET_POLICY.rationale, asOf)
    // 刻意不写 missingReason —— 那个字段的语义是「该补而未补」,
    // 用在这里会让裁定排除重新变成一条待办。
    metrics.push(mEx)
    rows.push({
      label: '家庭刚性支出约束', status: '不纳入 TIOS 风控模型（战略层裁定）',
      light: 'EXCLUDED',
      decision: `不参与风控判定。${SAFETY_NET_POLICY.ruledOn} 裁定,`
        + 'FAMILY_SAFETY_NET 同时退出减仓法定理由白名单',
      metrics: [mEx],
    })
  } else {
  const needed = householdAnnualExpense === undefined ? null : householdAnnualExpense * LIMITS.safetyNetYears
  const netYears = householdAnnualExpense === undefined || householdAnnualExpense <= 0
    ? null : snapshot.cash / householdAnnualExpense
  const mNet = m('安全垫年数', netYears, netYears === null ? '缺失' : `${netYears.toFixed(1)}年`,
    '用户输入的家庭年度刚性支出',
    householdAnnualExpense === undefined
      ? `未提供家庭年度刚性支出，无法计算（需 现金 ÷ 年支出 ≥ ${LIMITS.safetyNetYears}）`
      : `${wanStr(snapshot.cash)} ÷ ${wanStr(householdAnnualExpense)} = ${netYears?.toFixed(2)}年，`
        + `要求≥${LIMITS.safetyNetYears}年。「只计账内现金」 ——`
        + `委员会已明确账户外那笔"不是家庭日常生活资产"，按其自身定义排除`,
    asOf,
    householdAnnualExpense === undefined ? '委员会尚未提供家庭年度刚性支出' : undefined)
  metrics.push(mNet)
  const netLight: Light =
    netYears === null ? 'UNKNOWN' : netYears >= LIMITS.safetyNetYears ? 'GREEN'
      : netYears >= LIMITS.safetyNetYears * 0.75 ? 'YELLOW' : 'RED'
  rows.push({
    label: '家庭安全垫', status: netYears === null ? '数据缺失' : `${netYears.toFixed(1)}年 / 要求${LIMITS.safetyNetYears}年`,
    light: netLight,
    decision: netLight === 'UNKNOWN'
      ? '待委员会提供年度刚性支出后方可判定'
      : netLight === 'GREEN' ? '正常' : '优先补足现金',
    metrics: [mNet],
  })
  }

  // ── 单股仓位 ──
  // 单票上限的分母是**组合总资产**，不是券商账户合计。
  // 这是 8/15 裁定的核心：用账户口径会把"钱放在账户外"当成"股票风险变大"。
  //
  // 判据直接复用 findLimitBreaches，不在这里再写一遍 ——
  // 那个函数是真正生成减仓动作的地方，两处各写一份的后果是：
  // 改分母时只改一处，页面显示"未超限"而动作区仍吐出减仓指令，
  // 两边互相矛盾且没有任何报错。
  const over = findLimitBreaches(input)
    .filter(b => b.kind === 'POSITION_LIMIT')
    .map(b => ({ code: b.code, name: b.name, pct: b.currentPct, excessValue: b.excessValue }))
  const maxStockPct = positions.length
    ? Math.max(...positions.map(p => singleNameWeight(p.marketValue, portfolioTotal))) : null
  const mStock = m('最大单股仓位', maxStockPct, pctStr(maxStockPct),
    'positions.market_value / 组合总资产',
    over.length
      ? over.map(o => `${o.name} ${pctStr(o.pct)}（超出${wanStr(o.excessValue)}）`).join('；')
      : `全部持仓均不超过上限${pctStr(LIMITS.singleStock)}`,
    asOf, positions.length ? undefined : '无持仓记录')
  metrics.push(mStock)
  const stockLight: Light = over.length > 0 ? 'RED' : maxStockPct === null ? 'UNKNOWN'
    : maxStockPct > LIMITS.singleStock * 0.9 ? 'YELLOW' : 'GREEN'
  rows.push({
    label: '单股仓位上限', status: over.length
      ? `${over.length}只超限：${over.map(o => `${o.name}${pctStr(o.pct)}`).join('、')}`
      : `最高${pctStr(maxStockPct)} / 上限${pctStr(LIMITS.singleStock)}`,
    light: stockLight,
    decision: over.length ? '减仓至上限（法定理由：仓位超限）' : '正常',
    metrics: [mStock],
  })

  // ── 主线集中度 ──
  const byMainline = new Map<string, number>()
  let unclassified = 0
  for (const p of positions) {
    const hit = findMember(p.code)
    if (hit) byMainline.set(hit.mainline.name, (byMainline.get(hit.mainline.name) ?? 0) + p.marketValue)
    else unclassified += p.marketValue
  }
  const mainlineRows = [...byMainline.entries()]
    .map(([name, v]) => ({ name, pct: portfolioTotal > 0 ? v / portfolioTotal : 0, value: v }))
    .sort((a, b) => b.pct - a.pct)
  const maxMainline = mainlineRows[0] ?? null
  const mMainline = m('最大主线集中度', maxMainline?.pct ?? null, pctStr(maxMainline?.pct ?? null),
    'Σ 该主线成员市值 / 总资产（主线归属取自 msr/universe.ts）',
    mainlineRows.length
      ? mainlineRows.map(r => `${r.name} ${pctStr(r.pct)}`).join('；') +
        (unclassified > 0 ? `；未归类 ${wanStr(unclassified)}` : '')
      : '无可归类持仓',
    asOf, mainlineRows.length ? undefined : '持仓未匹配到任何主线')
  metrics.push(mMainline)
  // 主线集中度沿用主题45%上限（一条主线在本组合里即一个主题）
  const mainlineLight: Light = maxMainline === null ? 'UNKNOWN'
    : maxMainline.pct > LIMITS.theme ? 'RED' : maxMainline.pct > LIMITS.theme * 0.85 ? 'YELLOW' : 'GREEN'
  rows.push({
    label: '主线集中度', status: maxMainline
      ? `${maxMainline.name} ${pctStr(maxMainline.pct)} / 上限${pctStr(LIMITS.theme)}`
      : '数据缺失',
    light: mainlineLight,
    decision: mainlineLight === 'RED' ? '减仓至上限（法定理由：主题超限）' : '继续跟踪',
    metrics: [mMainline],
  })

  // ── 最大回撤与熔断 ──
  //
  // 回撤必须与峰值同口径。旧峰值 430 万记的是券商账户口径，
  // 而组合口径当前 531 万 —— 直接相减会算出"回撤为负"，即熔断静默失效。
  // 这是换分母最危险的连带后果：风控开关被关掉，而页面上一切正常。
  // 故峰值未按组合口径重新认定时，回撤输出 null 并明写"不可比"。
  const peakComparable = snapshot.peakBasis === 'PORTFOLIO' && snapshot.peakAssets > 0
  const dd = computeCircuit(snapshot).drawdown
  const ddMissing = peakComparable
    ? undefined
    : snapshot.peakAssets > 0
      ? `峰值 ${wanStr(snapshot.peakAssets)} 记录于券商账户口径，与组合口径不可比。`
        + `须由委员会按组合口径重新认定峰值后才能计算回撤 —— `
        + `在此之前熔断判定不可用，且不得当作"回撤为0"。`
      : 'account_state.peak_assets 为0或缺失'
  const mDd = m('自峰值回撤', dd, pctStr(dd), 'account_state.peak_assets（须为组合口径）',
    peakComparable
      ? `1 − ${wanStr(portfolioTotal)} ÷ ${wanStr(snapshot.peakAssets)}`
      : '口径不可比或峰值缺失，无法计算',
    asOf, ddMissing)
  metrics.push(mDd)
  const ddLight: Light = dd === null ? 'UNKNOWN'
    : dd >= LIMITS.circuitLevel2 ? 'RED' : dd >= LIMITS.circuitLevel1 ? 'RED' : dd >= 0.10 ? 'YELLOW' : 'GREEN'
  const capByDd = dd === null ? null : dd >= LIMITS.circuitLevel2 ? 0.30 : dd >= LIMITS.circuitLevel1 ? 0.50 : null
  rows.push({
    label: '组合回撤/熔断', status: dd === null ? '数据缺失'
      : `${pctStr(dd)}${capByDd !== null ? ` → 仓位上限${pctStr(capByDd)}${dd >= LIMITS.circuitLevel2 ? '且只卖不买' : ''}` : ''}`,
    light: ddLight,
    decision: capByDd !== null ? '强制降仓（法定理由：熔断风险预算）'
      : ddLight === 'YELLOW' ? '不再扩仓' : '正常',
    metrics: [mDd],
  })

  // ── 持仓总占比（资产配置口径）──
  const posPct = portfolioTotal > 0 ? snapshot.positionsValue / portfolioTotal : null
  const mPos = m('股票占组合比例', posPct, pctStr(posPct),
    'Σ positions.market_value / 组合总资产',
    `${wanStr(snapshot.positionsValue)} ÷ ${wanStr(portfolioTotal)}`
    + `　（券商账户内仓位另为 ${pctStr(brokerPosPct)}，两者不可混用）`, asOf)
  metrics.push(mPos)
  const capOver = capByDd !== null && posPct !== null && posPct > capByDd
  rows.push({
    label: '仓位是否超熔断上限', status: capByDd === null ? `无熔断上限约束（当前${pctStr(posPct)}）`
      : `${pctStr(posPct)} vs 上限${pctStr(capByDd)}${capOver ? ' → 超限' : ''}`,
    light: capOver ? 'RED' : 'GREEN',
    decision: capOver ? `须卖出约 ${wanStr((posPct! - capByDd!) * portfolioTotal)}（法定理由：熔断风险预算）` : '正常',
    metrics: [mPos],
  })

  const light = worstLight(rows.map(r => r.light))
  const redRows = rows.filter(r => r.light === 'RED')
  const unknownRows = rows.filter(r => r.light === 'UNKNOWN')

  const headline =
    light === 'RED'
      ? `必须处理 ${redRows.length} 项：${redRows.map(r => r.label).join('、')}` +
        (unknownRows.length ? `；另有${unknownRows.length}项数据缺失` : '')
      : light === 'UNKNOWN'
        ? `${unknownRows.length}项数据缺失（${unknownRows.map(r => r.label).join('、')}），按必须处理对待`
        : light === 'YELLOW'
          ? `风险升高：${rows.filter(r => r.light === 'YELLOW').map(r => r.label).join('、')}`
          : '各项风险指标均在限额内'

  return { no: 1, question: '今天组合安全吗？', light, headline, metrics, rows }
}

/** 供第⑤问生成减仓动作使用的结构化超限结果 */
export interface LimitBreach {
  code: string
  name: string
  currentPct: number
  limitPct: number
  excessValue: number
  kind: 'POSITION_LIMIT' | 'THEME_LIMIT'
}

/**
 * 超限清单 —— **这里是真正生成减仓动作的地方。**
 *
 * 分母必须是组合口径。这个函数曾经用 `snapshot.brokerTotal`（券商账户口径），
 * 而 evaluateSafety 里还有一份同样的 12% 判据 —— 同一条规则两份实现，
 * 改分母时若只改一处，页面显示"未超限"而动作区仍然吐出减仓指令，
 * 两边互相矛盾且没有任何报错。
 *
 * 故这里与 evaluateSafety 共用同一个纯函数，不再各写一遍。
 */
export function singleNameWeight(marketValue: number, portfolioTotal: number): number {
  return portfolioTotal > 0 ? marketValue / portfolioTotal : 0
}

export function findLimitBreaches(input: SafetyInput): LimitBreach[] {
  const { snapshot, positions } = input
  const portfolioTotal = snapshot.portfolioTotal
  if (portfolioTotal <= 0) return []
  const out: LimitBreach[] = []
  for (const p of positions) {
    const pct = singleNameWeight(p.marketValue, portfolioTotal)
    if (pct > LIMITS.singleStock) {
      out.push({
        code: p.code, name: p.name, currentPct: pct, limitPct: LIMITS.singleStock,
        excessValue: p.marketValue - portfolioTotal * LIMITS.singleStock, kind: 'POSITION_LIMIT',
      })
    }
  }
  return out.sort((a, b) => b.currentPct - a.currentPct)
}
