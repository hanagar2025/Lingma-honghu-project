/**
 * 投资哲学参考。
 *
 * 委员会 2026-08-24：巴菲特材料可以作为鸿鹄的投资哲学参考，
 * 但不能增加任何新规则。尤其不能因为「巴菲特长期持有」
 * 而削弱战术减仓和价值退出。那会把系统带回「好公司死扛」。
 *
 * 真正的王道不是「长期持有」，也不是「不卖优质资产」。
 * 真正的王道是：长期持有 + 持有理由持续成立。
 *
 * 翻译成鸿鹄：
 *
 *   长期持有不是时间长度，而是证据持续成立的结果。
 *   巴菲特的长期持有 = 长期验证 Ownership。
 *
 * 本模块不生产动作，不进规则指纹，不进入 DashboardInput。
 * tier 恒为 OBSERVATION。不 import makeAction。不改 V4.x。
 */

import type { EvidenceTier } from '../cockpit/types'
import type { HunterStage } from '../decision/hunter'

export const PHILOSOPHY_ID = 'P-01'
export const PHILOSOPHY_TITLE = '鸿鹄·投资哲学参考'

/** 比「长期持有才是王道」更严格的那一句。 */
export const PHILOSOPHY_OBJECT =
  '长期持有不是时间长度，而是证据持续成立的结果。'

export const PHILOSOPHY_CLAIM =
  '价格负责制造噪音，事实负责改变 Evidence，Evidence 决定 Ownership，'
  + 'Ownership 决定资本是否值得继续交给它。'

/** 「长期持有」本身不是战略。 */
export function longHoldIsStrategy(): false {
  return false
}

/** 「不卖优质资产」不是规则。 */
export function dontSellQualityIsRule(): false {
  return false
}

/** 「第一条不亏钱」不能直接成为鸿鹄规则。 */
export function noLossIsExecutableRule(): false {
  return false
}

/** 价格变化不能自动推翻投资逻辑。 */
export function priceChangeOverturnsLogic(): false {
  return false
}

/** 跌了不是卖出信号。 */
export function priceDropIsSellSignal(): false {
  return false
}

/** 跌了不是抄底信号。 */
export function priceDropIsBuySignal(): false {
  return false
}

/** 便宜不是 Capital Permission。 */
export function cheapIsCapitalPermission(): false {
  return false
}

/** 「好公司永远不卖」不是鸿鹄。 */
export function goodCompanyNeverSell(): false {
  return false
}

/** 不得因巴菲特长期持有而削弱战术减仓。 */
export function buffettLongHoldWeakensTacticalReduce(): false {
  return false
}

/** 不得因巴菲特长期持有而削弱价值退出。 */
export function buffettLongHoldWeakensValueExit(): false {
  return false
}

/** 本层不得增加任何新规则。 */
export function philosophyMayAddRules(): false {
  return false
}

/** 市场热度不能把题材直接送进资本池。 */
export function marketHeatEntersCapitalPool(): false {
  return false
}

/** 鸿鹄防的不是账面亏损。 */
export function bookLossIsWhatWePrevent(): false {
  return false
}

export const TRANSLATIONS = [
  {
    no: 1,
    raw: '长期持有 / 股票跌了也不要卖',
    honghu: '长期验证 Ownership。价格变化不能自动推翻投资逻辑。',
    not: '不是「跌了也不卖」这条规则。',
  },
  {
    no: 2,
    raw: '第一条：不要亏钱',
    honghu: '防的是永久性资本损失，不是账面亏损。价格波动 ≠ 资本损失。',
    not: '不是可执行的「不要亏钱」规则。优秀公司可以短期跌 30% 仍值得持有。',
  },
  {
    no: 3,
    raw: '别人恐慌我贪婪 / 美国运通丑闻抄底',
    honghu: '市场价格变化 → 提出问题 → 去寻找事实 → 更新 Ownership / Evidence。',
    not: '不是「价格跌 → 判断便宜 → 买」。',
  },
  {
    no: 4,
    raw: '1999 年拒绝互联网股',
    honghu: '不理解的东西，即使涨得再好，也不能成为战略核心。先问是不是战略主线，再进 Evidence。',
    not: '不是「AI 是泡沫」。也不是市场热点 → 研究热点 → 资本热点。',
  },
  {
    no: 5,
    raw: '极简主义',
    honghu: '数据后台越来越完整，投资人前台越来越简单。前台只问：今天有没有足以改变资本状态的新事实？',
    not: '不是指标越来越多、决策越来越频繁。',
  },
] as const

/**
 * 已冻结生命线的读法。不是新生命线，也不改 hunter.ts。
 * 核心 = 拥有资格长期成立。战术减仓与价值退出仍然有效。
 */
export const LIFELINE_READING: readonly {
  stage: HunterStage
  name: string
  means: string
}[] = [
  { stage: 'DISCOVER', name: '发现', means: '发现值得研究。' },
  { stage: 'OBSERVE', name: '观察', means: '证据是不是逐渐成立。' },
  { stage: 'ENTRY', name: '建仓', means: '第一次证明值得给资本。' },
  { stage: 'ADD', name: '加仓', means: '出现新的独立证据。' },
  { stage: 'TOP_UP', name: '追加', means: '未来盈利确定性进一步提高。' },
  { stage: 'CORE', name: '核心', means: '拥有资格长期成立。核心 ≠ 可以继续加仓。' },
  {
    stage: 'TACTICAL_REDUCE', name: '战术减仓',
    means: '关键证据恶化，但根本逻辑尚未完全死亡。',
  },
  {
    stage: 'VALUE_EXIT', name: '价值退出',
    means: '当初为什么拥有它的根本理由已经消失。',
  },
  { stage: 'REOBSERVE', name: '退出后重新观察', means: '退出后重新观察，不是偷偷买回来。' },
]

/** 海光读法。已有规范案例，不是新规则。 */
export const HAIGUANG_READING = [
  { when: '股价涨', then: '不能因为涨了就卖。' },
  { when: '股价跌', then: '不能因为跌了就卖。' },
  { when: '仓位超过硬上限', then: '可以降暴露。Ownership 仍可以是核心。' },
  { when: '公司核心战略证据恶化', then: '才进入战术减仓审查。' },
  { when: '拥有它的根本理由消失', then: '才进入价值退出。' },
] as const

/**
 * 价格大跌时要问的七问。
 * 不是新闸门，也不是自动加仓清单。便宜仍不是 Capital Permission。
 */
export const PRICE_DROP_ASKS = [
  { no: 1, asks: '战略假设有没有变化？' },
  { no: 2, asks: '产业链的真实需求有没有变化？' },
  { no: 3, asks: '公司在产业链中的位置有没有变化？' },
  { no: 4, asks: '收入和利润有没有变化？' },
  { no: 5, asks: '未来盈利证据有没有变化？' },
  { no: 6, asks: '市场隐含增长有没有变化？' },
  { no: 7, asks: '风险有没有变化？' },
] as const

export const PRICE_DROP_STILL = [
  '价格跌、Evidence 没有恶化：不是卖出信号。',
  '价格下降 + Evidence 稳定：最多触发 R4 重新评估。',
  '仍然不能自动加仓。必须出现新的合法资本迁移证据。',
] as const

export const P01_DOES_NOT_IMPLY = [
  '不意味着「长期持有」成为战略，或「不卖优质资产」成为规则',
  '不意味着「不要亏钱」成为可执行规则',
  '不意味着好公司永远不卖，或判断错了也死扛',
  '不意味着削弱战术减仓',
  '不意味着削弱价值退出',
  '不意味着价格跌了就卖，或价格跌了就抄底',
  '不意味着便宜就是 Capital Permission',
  '不意味着本层增加任何新规则，或改写 V4.x',
  '不意味着市场热点可以不经 Ownership 进入资本池',
  '不意味着账面亏损等于永久性资本损失',
] as const

export const P01_BLOCKERS = [
  '本层是哲学参考，不是选股系统，也不进入证据链。',
  '生命线读法对照已冻结的 hunter 段，不得据此改段、改迁移、改动作。',
  '价格大跌七问是提问顺序，不是新的七道闸门。',
  '战术减仓与价值退出必须保持可触发。削弱它们等于把系统带回好公司死扛。',
] as const

export const P01 = {
  id: PHILOSOPHY_ID,
  title: PHILOSOPHY_TITLE,
  claim: PHILOSOPHY_CLAIM,
  object: PHILOSOPHY_OBJECT,
  source: '委员会 2026-08-24 哲学参考裁定',
  loggedOn: '2026-08-24',
  pool: '哲学参考',
  stage: 1,
  tier: 'OBSERVATION' as EvidenceTier,
  doesNotImply: P01_DOES_NOT_IMPLY,
  blockers: P01_BLOCKERS,
}

export interface PhilosophyVerdict {
  object: string
  translation: string
  risk: string
  lookout: string
  stance: string
}

export function philosophyVerdict(): PhilosophyVerdict {
  return {
    object: PHILOSOPHY_OBJECT,
    translation:
      '巴菲特的长期持有，翻译成鸿鹄是长期验证 Ownership。'
      + '好公司可以拿几十年，但判断错了也会卖。',
    risk:
      '鸿鹄防的是永久性资本损失，不是账面亏损。'
      + '价格波动 ≠ 资本损失。这就是 V4.x 禁止「跌了所以减仓」的原因。',
    lookout:
      '极简主义：后台是财报、产业、订单、客户、现金流、估值、历史快照；'
      + '前台只问今天有没有足以改变资本状态的新事实。',
    stance:
      '本层不增加规则。不得削弱战术减仓，不得削弱价值退出。',
  }
}

export function buildOwnershipPhilosophyView() {
  return {
    ...P01,
    translations: TRANSLATIONS,
    lifelineReading: LIFELINE_READING,
    haiguang: HAIGUANG_READING,
    priceDropAsks: PRICE_DROP_ASKS,
    priceDropStill: PRICE_DROP_STILL,
    verdict: philosophyVerdict(),
    flags: {
      longHoldIsStrategy: longHoldIsStrategy(),
      dontSellQualityIsRule: dontSellQualityIsRule(),
      noLossIsExecutableRule: noLossIsExecutableRule(),
      priceChangeOverturnsLogic: priceChangeOverturnsLogic(),
      priceDropIsSellSignal: priceDropIsSellSignal(),
      priceDropIsBuySignal: priceDropIsBuySignal(),
      cheapIsCapitalPermission: cheapIsCapitalPermission(),
      goodCompanyNeverSell: goodCompanyNeverSell(),
      buffettLongHoldWeakensTacticalReduce: buffettLongHoldWeakensTacticalReduce(),
      buffettLongHoldWeakensValueExit: buffettLongHoldWeakensValueExit(),
      philosophyMayAddRules: philosophyMayAddRules(),
      marketHeatEntersCapitalPool: marketHeatEntersCapitalPool(),
      bookLossIsWhatWePrevent: bookLossIsWhatWePrevent(),
    },
  }
}

export function renderOwnershipPhilosophy(): string {
  const W = 122
  const v = philosophyVerdict()
  const L: string[] = ['', '═'.repeat(W), PHILOSOPHY_TITLE, '═'.repeat(W)]
  L.push('  本区不打分、不排序、不产生候选、不产生动作。证据等级恒为 OBSERVATION。')
  L.push('  本层是投资哲学参考，不能增加任何新规则。')
  L.push(`  ${PHILOSOPHY_OBJECT}`)
  L.push(`  ${P01.id}｜${P01.pool}　登记于 ${P01.loggedOn}`)
  L.push(`  ${PHILOSOPHY_CLAIM}`)
  L.push(`  来源：${P01.source}`)
  L.push('')
  L.push('  ── 机器结论 ──')
  L.push(`  1. ${v.object}`)
  L.push(`  2. ${v.translation}`)
  L.push(`  3. ${v.risk}`)
  L.push(`  4. ${v.lookout}`)
  L.push(`  5. ${v.stance}`)
  L.push('')
  L.push('  ── 翻译（原材料 → 鸿鹄语言）──')
  for (const t of TRANSLATIONS) {
    L.push(`  ${t.no}. 原料：${t.raw}`)
    L.push(`      鸿鹄：${t.honghu}`)
    L.push(`      不是：${t.not}`)
  }
  L.push('')
  L.push('  ── 已冻结生命线的读法（不是新生命线）──')
  for (const s of LIFELINE_READING) {
    L.push(`  ${s.name}　${s.means}`)
  }
  L.push('')
  L.push('  ── 海光读法（已有规范案例）──')
  for (const h of HAIGUANG_READING) {
    L.push(`  · ${h.when} → ${h.then}`)
  }
  L.push('')
  L.push('  ── 价格大跌时要问的七问（不是新闸门，不能自动加仓）──')
  for (const q of PRICE_DROP_ASKS) {
    L.push(`  ${q.no}. ${q.asks}`)
  }
  for (const s of PRICE_DROP_STILL) L.push(`  · ${s}`)
  L.push('')
  L.push('  本条成立也不意味着：')
  for (const d of P01.doesNotImply) L.push(`    · ${d}`)
  L.push('')
  L.push('  阻塞项：')
  for (const b of P01.blockers) L.push(`    · ${b}`)
  L.push('')
  return L.join('\n')
}
