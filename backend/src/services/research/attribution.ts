/**
 * 主线收入归因。
 *
 * ── 要回答的问题 ──
 *
 * ❌ 不是:「兆易创新收入增长了,所以 AI 存储需求是真的。」
 * ✅ 而是:「兆易创新新增/改善的收入中,有多大比例可以被合理归因于目标存储主线?」
 *
 * 前者是把公司业绩当成产业证据用,中间跳过了归因这一步。
 *
 * 最终需要形成的链条:
 *
 *   公司收入 → 产品 → 下游应用 → AI/HBM/DDR5 等需求 → 收入变化
 *
 * 而不是一句管理层的「AI 需求旺盛」。管理层表述属于第 1 步的旁证,
 * 它不能替代后面四步 —— 一家公司说自己受益于 AI 是零成本的。
 *
 * ── 委员会 2026-08-16 指出的新漏洞 ──
 *
 * 「主线收入占比高」≠「主线是增长来源」。两个反例:
 *
 *   AI 产品占收入 60%,但 AI 同比 +5%、非 AI 同比 +30%
 *     → AI 是大业务,却不是增长驱动力
 *
 *   AI 产品只占 20%,但同比 +150%、其他业务下降
 *     → AI 可能才是当前利润变化的主要驱动力
 *
 * 故归因必须拆成两个字段,且**增长贡献比存量占比重要**:
 *
 *   stockShare        主线收入存量占比
 *   growthContribution 主线收入增长贡献 = 主线收入增量 ÷ 公司总收入增量
 *
 * 只报存量占比的系统会在第一个反例上给出错误结论,而那个反例
 * 恰恰是最常见的情形:一家公司的传统主业很大,新故事很小但增速高,
 * 或反过来主业增长而新故事停滞。
 *
 * ── 本文件当前不产出任何判定 ──
 *
 * 拆分产品线收入需要接入年报的分产品收入表(取数层级
 * PUBLIC_NOT_YET_WIRED —— 公开可得,尚未接入)。在接入之前,
 * 这里只定义结构与判据,`buildAttribution` 对缺数据的输入返回 UNKNOWN。
 * 定义结构不等于扩大研究面:它把"下一步该做什么"写成可执行的形状,
 * 而不是留在一句话里。
 */

/** 归因链的五个环节。缺任何一环,归因都不成立 */
export const ATTRIBUTION_CHAIN: readonly { no: number; name: string; asks: string }[] = [
  { no: 1, name: '公司收入', asks: '收入总额与增量是多少' },
  { no: 2, name: '产品', asks: '按产品线拆分后,各条线的收入与增量' },
  { no: 3, name: '下游应用', asks: '各产品线卖给什么下游(服务器/手机/工控/汽车)' },
  { no: 4, name: '目标需求', asks: '下游中属于 AI / HBM / DDR5 等目标需求的部分' },
  { no: 5, name: '收入变化', asks: '目标需求对应的收入增量占公司总增量的比例' },
] as const

export type AttributionVerdict =
  /** 主线既是大业务,也是增长主要来源 */
  | 'MAINLINE_IS_DRIVER'
  /** 主线是大业务,但不是增长来源 —— 委员会第一个反例 */
  | 'LARGE_BUT_NOT_DRIVER'
  /** 主线占比小,但是增长主要来源 —— 委员会第二个反例 */
  | 'SMALL_BUT_DRIVER'
  /** 主线既不大也不是增长来源 */
  | 'NEITHER_LARGE_NOR_DRIVER'
  /** 数据不足,无法归因 */
  | 'UNKNOWN'

export const ATTRIBUTION_VERDICT_TEXT: Record<AttributionVerdict, string> = {
  MAINLINE_IS_DRIVER: '主线既是大业务，也是增长主要来源',
  LARGE_BUT_NOT_DRIVER: '主线是大业务，但不是增长来源',
  SMALL_BUT_DRIVER: '主线占比小，但是增长主要来源',
  NEITHER_LARGE_NOR_DRIVER: '主线既不大，也不是增长来源',
  UNKNOWN: '数据不足，无法归因',
}

export interface AttributionInput {
  company: string
  mainline: string
  /** 本期公司总收入与去年同期 */
  revenueCur: number | null
  revenuePrev: number | null
  /** 归属主线的收入,本期与去年同期 */
  mainlineRevenueCur: number | null
  mainlineRevenuePrev: number | null
  /** 数据出处。为空即视为不可用 —— 归因不许凭管理层表述成立 */
  source: string
  /** 已完成到归因链第几环 */
  chainStep: 1 | 2 | 3 | 4 | 5
}

/**
 * 委员会 2026-08-16 指定的四个字段。顺序即阅读顺序,**最后一项最重要**。
 *
 * 前三项都可能给出"看着不错"的读数而结论错误:
 *   有主线收入            → 不说明它是核心业务
 *   占比高                → 不说明它是增长来源（本文件顶部第一个反例）
 *   自身增速高            → 不说明它是公司增长的主要来源（基数可能极小）
 * 只有第四项直接回答"公司这次增长到底是不是它贡献的"。
 */
export interface Attribution {
  company: string
  mainline: string
  /** ① 主线产品收入(元)。公司有多少收入来自目标主线 */
  mainlineRevenue: number | null
  /** ② 主线收入占比。这是不是公司的核心业务 */
  stockShare: number | null
  /** ③ 主线收入同比增速。这条业务本身是否在增长 */
  mainlineYoy: number | null
  /**
   * 主线收入增长贡献 = 主线收入增量 ÷ 公司总收入增量。
   *
   * 「这个字段比存量占比重要」。它可以大于 1（其他业务下滑时）,
   * 也可以为负（主线自身下滑而公司仍增长）—— 两种都是有意义的读数,
   * 不得截断到 0–1 区间。截断会把"主线在拖累公司"这个信息抹掉。
   */
  growthContribution: number | null
  verdict: AttributionVerdict
  chainStep: 1 | 2 | 3 | 4 | 5
  /** 缺什么。空数组表示归因链已走完 */
  missing: string[]
  note: string
}

/** 判据阈值。**属研究层描述性参数,不进规则指纹** —— 它不产生任何交易动作。 */
export const ATTRIBUTION_THRESHOLDS = {
  /** 存量占比达此值视为"大业务" */
  largeShare: 0.40,
  /** 增长贡献达此值视为"增长主要来源" */
  driverContribution: 0.50,
} as const

export function buildAttribution(input: AttributionInput): Attribution {
  const {
    company, mainline, revenueCur, revenuePrev,
    mainlineRevenueCur, mainlineRevenuePrev, source, chainStep,
  } = input

  const missing: string[] = []
  if (!source) missing.push('无数据出处 —— 归因不得凭管理层「AI 需求旺盛」一类表述成立')
  if (mainlineRevenueCur == null || mainlineRevenuePrev == null) {
    missing.push('缺按产品线拆分的主线收入（年报分产品收入表，公开可得但尚未接入）')
  }
  if (revenueCur == null || revenuePrev == null) missing.push('缺公司总收入的本期与基期')
  if (chainStep < ATTRIBUTION_CHAIN.length) {
    const cur = ATTRIBUTION_CHAIN[chainStep - 1]
    const next = ATTRIBUTION_CHAIN[chainStep]
    missing.push(`归因链仅走到第 ${chainStep}/${ATTRIBUTION_CHAIN.length} 环`
      + `「${cur?.name ?? '?'}」，下一环要回答：${next?.asks ?? '?'}`)
  }

  const stockShare = revenueCur != null && revenueCur > 0 && mainlineRevenueCur != null
    ? mainlineRevenueCur / revenueCur : null

  // ③ 主线自身增速。与 ④ 增长贡献是两个不同的问题:
  // 增速高说明这条业务在长，贡献高说明公司的增长主要由它带来。
  // 基数极小时增速可以很高而贡献极低 —— 那是"故事很好但不影响业绩"。
  const mainlineYoy = mainlineRevenuePrev != null && mainlineRevenuePrev > 0
    && mainlineRevenueCur != null
    ? mainlineRevenueCur / mainlineRevenuePrev - 1 : null

  let growthContribution: number | null = null
  if (revenueCur != null && revenuePrev != null
    && mainlineRevenueCur != null && mainlineRevenuePrev != null) {
    const totalDelta = revenueCur - revenuePrev
    const mainlineDelta = mainlineRevenueCur - mainlineRevenuePrev
    // 总增量为 0 或负时,"贡献占比"没有意义:分母趋零会让比值爆炸,
    // 分母为负会让符号反转。此时返回 null 并在 note 里说明,而不是硬算一个数。
    growthContribution = totalDelta > 0 ? mainlineDelta / totalDelta : null
    if (totalDelta <= 0) {
      missing.push(`公司总收入增量为 ${(totalDelta / 1e8).toFixed(2)} 亿（非正），`
        + '增长贡献占比无定义 —— 须改用绝对增量对比,不得硬算比值')
    }
  }

  const verdict: AttributionVerdict = (() => {
    if (missing.length || stockShare === null || growthContribution === null) return 'UNKNOWN'
    const large = stockShare >= ATTRIBUTION_THRESHOLDS.largeShare
    const driver = growthContribution >= ATTRIBUTION_THRESHOLDS.driverContribution
    return large && driver ? 'MAINLINE_IS_DRIVER'
      : large ? 'LARGE_BUT_NOT_DRIVER'
        : driver ? 'SMALL_BUT_DRIVER' : 'NEITHER_LARGE_NOR_DRIVER'
  })()

  const mainlineRevenue = mainlineRevenueCur
  const pct = (v: number | null) => (v === null ? '?' : `${(v * 100).toFixed(1)}%`)
  const note = verdict === 'UNKNOWN'
    ? `${company} 的${mainline}归因尚不成立：${missing.length} 项缺口。`
      + '「不得以"主线收入占比高"代替"主线是增长来源"」 —— 两者是不同的问题。'
    : `${company}：${mainline}收入 ${
      mainlineRevenue === null ? '?' : `${(mainlineRevenue / 1e8).toFixed(2)}亿`
    }，存量占比 ${pct(stockShare)}，自身同比 ${pct(mainlineYoy)}，`
      + `对公司收入增量的贡献 ${pct(growthContribution)}。`
      + `${ATTRIBUTION_VERDICT_TEXT[verdict]}。`
      + (verdict === 'LARGE_BUT_NOT_DRIVER'
        ? '占比高但不驱动增长 —— 这种情形下"主线景气"无法解释公司当期变化。'
        : verdict === 'SMALL_BUT_DRIVER'
          ? '占比虽小但驱动增长 —— 须核查基数是否过小导致增速失真。'
          : '')

  return {
    company, mainline,
    mainlineRevenue: mainlineRevenueCur,
    stockShare,
    mainlineYoy,
    growthContribution,
    verdict, chainStep, missing, note,
  }
}

/**
 * 存储 H1 的归因现状。
 *
 * 全部为 null 是**当前的真实状态**,不是占位符:
 * 分产品收入表尚未接入管道,故归因链停在第 1 环。
 * 写成这样而不是留空,是为了让"下一步该做什么"有一个可执行的形状。
 */
export const STORAGE_ATTRIBUTION: AttributionInput = {
  company: '兆易创新',
  mainline: 'AI 存储',
  revenueCur: null,
  revenuePrev: null,
  mainlineRevenueCur: null,
  mainlineRevenuePrev: null,
  source: '',
  chainStep: 1,
}

export function renderAttribution(a: Attribution): string {
  const L: string[] = ['', '主线收入归因', '─'.repeat(78)]
  L.push(`  ${a.company} × ${a.mainline}`)
  L.push('')
  L.push('  要回答的不是「公司收入有没有增长」，而是')
  L.push('  「新增/改善的收入中，有多大比例可合理归因于目标主线」。')
  L.push('')
  L.push('  归因链：')
  for (const s of ATTRIBUTION_CHAIN) {
    const done = s.no <= a.chainStep
    L.push(`    ${done ? '▣' : '□'} ${s.no}. ${s.name}　${s.asks}`)
  }
  L.push('')
  const pct = (v: number | null) => (v === null ? '缺失' : `${(v * 100).toFixed(1)}%`)
  const yi = (v: number | null) => (v === null ? '缺失' : `${(v / 1e8).toFixed(2)}亿`)
  L.push('  四个字段（顺序即阅读顺序，最后一项最重要）：')
  L.push(`    ① 主线产品收入　　　　　　　${yi(a.mainlineRevenue)}`)
  L.push(`    ② 主线收入占比　　　　　　　${pct(a.stockShare)}　是不是核心业务`)
  L.push(`    ③ 主线收入同比增速　　　　　${pct(a.mainlineYoy)}　这条业务本身是否在增长`)
  L.push(`    ④ 对公司收入增量的贡献　　　${pct(a.growthContribution)}　`
    + '← 「最重要」：这次增长到底是不是它贡献的')
  L.push(`  判定　${ATTRIBUTION_VERDICT_TEXT[a.verdict]}`)
  if (a.missing.length) {
    L.push('')
    L.push('  缺口：')
    for (const m of a.missing) L.push(`    · ${m}`)
  }
  L.push('')
  L.push(`  ${a.note}`)
  L.push('')
  return L.join('\n')
}
