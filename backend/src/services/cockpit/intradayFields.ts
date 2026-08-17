/**
 * 盘中读数的逐字段分级。
 *
 * ── 为什么需要它 ──
 *
 * 「盘中更新一次，拿到的数据是什么样子?能不能当研判依据?」
 *
 * 答案不是"能"或"不能",而是**分三类,性质完全不同**。
 * 只给一个"盘中数据仅供参考"的横幅是不够的 ——
 * 它会让人把三类东西一起打折,于是那些其实完全可靠的读数
 * (持仓、利润份额、执行债务)也被一起怀疑,
 * 而真正会误导人的那类(用不完整 K 线算出的相对强度)反倒没被单独点出来。
 *
 * ── 实测的根据 ──
 *
 * 2026-08-17 11:45 北京时间取海光信息日线,最新一根是当天的:
 *   开 281.00  高 288.10  低 279.33  收 284.05  量 13,657,150
 *   前 5 日均量 16,065,853 → 今日已达 85%,而交易时间只走了一半。
 *
 * 「收」是当前价而不是收盘价,「高/低」只是到目前为止,「量」是不完整的。
 * 任何以这根 K 线为输入的计算,拿到的都是一个"假装已完成"的日线。
 */

export type IntradayGrade =
  /** 不受盘中影响：账务事实或季报数据，盘中盘后同一个值 */
  | 'STABLE'
  /** 临时值：会随价格变，但算法本身没问题，收盘后自动正确 */
  | 'PROVISIONAL'
  /** 系统性失真：用不完整 K 线当成完整的算，等收盘不会"自动变准"，而是换一个值 */
  | 'DISTORTED'

export const GRADE_TEXT: Record<IntradayGrade, string> = {
  STABLE: '✓ 可直接用',
  PROVISIONAL: '△ 临时值',
  DISTORTED: '✗ 系统性失真',
}

export interface FieldGrade {
  field: string
  grade: IntradayGrade
  why: string
}

/**
 * 分级表。
 *
 * 「区分 PROVISIONAL 与 DISTORTED 是这张表的全部意义。」
 *
 * 临时值只是"还没定下来"——仓位 13.2% 会变成 13.0%，量级和含义都对。
 * 系统性失真是"算错了"——把半天的成交量当成一天，
 * 得出的量比不是"接近真值的估计"，而是一个不同量纲的数。
 * 等收盘它不会收敛到现在这个数附近，而是换一个数。
 */
export const FIELD_GRADES: readonly FieldGrade[] = [
  // ── 不受影响 ──
  { field: '持仓股数 / 账内现金 / 账户外现金', grade: 'STABLE',
    why: '账务事实，与价格无关' },
  { field: '执行债务条数', grade: 'STABLE', why: '台账记录，与价格无关' },
  { field: '战略资格（C 级清退等）', grade: 'STABLE', why: '战略层裁定，非数据推出' },
  { field: '节点利润规模 / 存量份额 / 四季份额变化', grade: 'STABLE',
    why: '来自季报，最新一期滞后百余天 —— 盘中盘后完全相同' },
  // 「同上」在这里是个真 bug：本表会被 byGrade() 按档筛选后分别渲染，
  // 也会在简报横幅里被逗号连排 —— 那时"上一条"已经不是原来那条了。
  // 每条理由必须自足。
  { field: '扣非占净利比 / 毛利率', grade: 'STABLE',
    why: '来自季报的扣非 EPS 与销售毛利率，与盘中价格无关' },
  { field: 'S1 产业核验 / S2 盈利核验', grade: 'STABLE',
    why: '人工维护字段，改动须委员会记录，不随行情变化' },

  // ── 临时值：会变，但算法正确 ──
  { field: '股票市值 / 组合总资产', grade: 'PROVISIONAL',
    why: '股数 × 当前价。收盘后自动为正确值' },
  { field: '单票仓位 % / 是否超限', grade: 'PROVISIONAL',
    why: '随价格变。「贴着 12% 线的标的可能盘中超限、收盘不超限」' },
  { field: '自峰值回撤 / 熔断等级', grade: 'PROVISIONAL',
    why: '随组合总资产变。2026-08-17 实测：09:58 报 15.65%（一级成立），'
      + '11:07 报 14.51%（未触发）—— 「同一上午翻转过」' },
  { field: 'PE 三年分位', grade: 'PROVISIONAL',
    why: '分子用当前价，分母是三年历史 PE 序列。收盘后自动为正确值' },

  // ── 系统性失真：等收盘不会变准，而是换一个值 ──
  { field: '今日涨跌幅', grade: 'DISTORTED',
    why: '用当前价当收盘价算。不是"接近收盘涨幅的估计"，只是此刻的值' },
  { field: '涨跌量比（资金代理）', grade: 'DISTORTED',
    why: '用不完整成交量算。实测 11:45 时成交量已达 5 日均量 85%，'
      + '而交易时间只走一半 → 收盘量能翻倍，比值随之改变' },
  { field: '成交额比值（20日/60日）', grade: 'DISTORTED',
    why: '今日成交额尚未完成即被计入 20 日与 60 日均值，两个均值同时偏低' },
  { field: '收盘相对 MA20 / MA60 的距离', grade: 'DISTORTED',
    why: '未完成的今日价进了均线，均线本身也被带偏' },
  { field: '20日 / 60日相对强度（超额收益）', grade: 'DISTORTED',
    why: '区间端点是未完成的今日价，标的与基准都受影响' },
  { field: '市场阶段判定（上升/下跌/震荡）', grade: 'DISTORTED',
    why: '以指数均线与形态为输入，同样吃到未完成 K 线' },
] as const

export function byGrade(grade: IntradayGrade): FieldGrade[] {
  return FIELD_GRADES.filter(f => f.grade === grade)
}

/**
 * 一句话结论：盘中数据能不能当研判依据?
 *
 * 刻意不给"能/不能"的二元答案 —— 那会让人把三类读数一起打折或一起采信。
 */
export function intradayVerdict(): string {
  return `盘中数据${GRADE_TEXT.STABLE.slice(2)}的部分有 ${byGrade('STABLE').length} 类`
    + `（账务事实与季报数据），可直接用于研判；`
    + `${byGrade('PROVISIONAL').length} 类为临时值，量级可信但阈值附近会翻转；`
    + `${byGrade('DISTORTED').length} 类系统性失真，`
    + `「不可用于研判」 —— 它们把不完整的当日 K 线当成完整的来算。`
}

export function renderIntradayFields(): string {
  const W = 100
  const L: string[] = ['', '═'.repeat(W), '盘中读数分级 —— 哪些能用、哪些不能', '═'.repeat(W)]
  L.push(`  ${intradayVerdict()}`)
  for (const g of ['STABLE', 'PROVISIONAL', 'DISTORTED'] as IntradayGrade[]) {
    L.push('')
    L.push(`  ${GRADE_TEXT[g]}`)
    for (const f of byGrade(g)) {
      L.push(`    · ${f.field}`)
      L.push(`        ${f.why}`)
    }
  }
  L.push('')
  L.push('  「临时值」与「系统性失真」的区别是这张表的全部意义：')
  L.push('  前者只是还没定下来（13.2% 会变 13.0%，量级和含义都对）；')
  L.push('  后者是算错了（把半天成交量当一天），等收盘不会收敛到现在这个数附近，而是换一个数。')
  L.push('')
  return L.join('\n')
}
