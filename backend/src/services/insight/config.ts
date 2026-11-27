/**
 * 战略侧登记的内容。这里的每一条都有出处和登记日期，程序只照着读，不自己下判断。
 *
 * 两类东西，更新节奏不同：
 *   每季度财报后更新：个股结论、可买范围、盈利前提（前提五）。
 *   委员会裁定后更新：闸门参数、待裁定事项。
 * 两次更新之间不因行情改动。价格下跌本身不改变任何一条结论。
 */

export const REGISTERED = {
  date: '2026-11-11',
  basis: '2026 年三季报',
  source: '《风险与机会-2026-11-11》第四、六、七节',
  nextReview: '2027-01-31 之后（年报预告）',
} as const

export type Stance = 'HOLD' | 'TRIM' | 'WATCH' | 'OUTSIDE'

export interface StockView {
  code: string
  name: string
  stance: Stance
  /** 熔断降仓时的建议顺序，1 最先。只有 TRIM 有 */
  order?: number
  basis: string
}

/** 个股结论（估值为 11/10 读数）。委员会尚未裁定，降仓由委员会指派 */
export const STOCK_VIEWS: readonly StockView[] = [
  { code: '002463', name: '沪电股份', stance: 'HOLD', basis: '三季度扣非环比 +64%，滚动市盈率 23 倍。持仓里盈利与估值匹配最好' },
  { code: '002916', name: '深南电路', stance: 'HOLD', basis: '三季度扣非环比 +34%，滚动市盈率 28 倍。盈利好，价格是持仓里最弱的' },
  { code: '300308', name: '中际旭创', stance: 'HOLD', basis: '三季度扣非环比 +22%，滚动市盈率 21 倍。光模块里唯一盈利仍在加速的龙头；降到 12% 以内后保留' },
  { code: '688041', name: '海光信息', stance: 'TRIM', order: 1, basis: '三季度扣非环比 -8%，应收较年中 +68%，滚动市盈率 129 倍。盈利减速、估值最贵' },
  { code: '688012', name: '中微公司', stance: 'TRIM', order: 2, basis: '扣非利润只占账面利润 38%，扣非环比 -22%，扣非口径市盈率 103 倍。利润质量差' },
  { code: '002371', name: '北方华创', stance: 'TRIM', order: 3, basis: '三季度营收同比 +1%，滚动市盈率 68 倍。质量好但几乎不增长' },
  { code: '600183', name: '生益科技', stance: 'WATCH', basis: '三季度扣非环比 +90%，滚动市盈率 23 倍；不在冠军池，研究升级未完成。规则外买入，不加仓' },
]

export const HOLD_VOID_IF = '年报预告（1 月底前）显示四季度盈利环比下滑，或连续两个季度存货增速高于营收增速'

/** 可买范围：冠军池内、三项核验完成、最新财报通过前提五。出处《分段重建计划》第二节 */
export const BUYABLE: readonly { code: string; name: string; earningsOk: boolean; earningsBasis: string }[] = [
  { code: '300308', name: '中际旭创', earningsOk: true, earningsBasis: '三季报：单季扣非环比 +22%，存货与营收同步' },
  { code: '002463', name: '沪电股份', earningsOk: true, earningsBasis: '三季报：单季扣非环比 +64%' },
  { code: '002916', name: '深南电路', earningsOk: true, earningsBasis: '三季报：单季扣非环比 +34%' },
]

/** 盈利来自海外资本开支的股票（光模块、PCB）。前提四只对它们适用 */
export const OVERSEAS_DRIVEN: readonly string[] = ['300308', '002463', '002916']

/**
 * 闸门参数。《分段重建计划》草案 v0 未生效，N、M 的候选集是 5、10、15 个交易日，尚未回测。
 * 按草案第六节第 4 条取最保守一档，并写明"未经验证"。前提三（去杠杆）的参数未裁定，一律按不成立。
 */
export const GATE = {
  version: '《分段重建计划》草案 v0（未生效，参数未经回测）',
  lowWindow: 60,
  candidates: [5, 10, 15] as readonly number[],
  quietDays: 15,
  /** 仓位空间按候选里最小的一批（总资产 2%）试算 */
  batchPct: 0.02,
  themeCap: 0.45,
  sectorCap: 0.30,
  cashFloor: 0.10,
  singleCap: 0.12,
  /** AI 主题 = 光通信 + 算力两条主线 */
  aiMainlines: ['optical', 'compute'] as readonly string[],
} as const

export interface Forecast {
  no: string
  text: string
  confidence: string
  review: string
}

/** 事先登记的预判，到期对照。出处《风险与机会-2026-11-11》第八节 */
export const FORECASTS: readonly Forecast[] = [
  { no: '二', text: '主导变量是海外 AI 资本开支预期。美股链条止跌之前，A 股光模块和 PCB 的反弹不可靠', confidence: '中', review: '11/11 起 20 个交易日内美股链条是否继续创新低' },
  { no: '三', text: '持仓中风险收益最差的是海光信息，其次中微公司、北方华创；最好的是沪电股份', confidence: '中', review: '到 2027/1/31 的相对涨跌；年报预告' },
  { no: '四', text: '盈利不出现断崖的话，先修复的是生益科技、沪电股份、中际旭创，不是现在最强的半导体设备', confidence: '小', review: '同上' },
  { no: '五', text: '新易盛三季度的环比下滑不是一次性的', confidence: '小', review: '年报预告' },
]
export const FORECAST_FROM = '2026-11-10'

/** 只有委员会能定的事。哪几条出现，由程序按账户状态判断 */
export const PENDING = {
  peak: '峰值待核验。它决定股票上限是不是 30%。请提供峰值当日的账户总览或资金流水',
  circuit: '熔断降仓由委员会指派卖哪一只。战略侧 11/11 的建议顺序：海光信息、中微公司、北方华创；不建议卖沪电股份、深南电路',
  outside: '不在四条主线内，现行规则没有卖出指令，去留请裁定',
  gate: '机会闸门的参数未裁定：《分段重建计划》第七节五项、去杠杆三信号的阈值。裁定并回测之前，闸门不会打开',
  goal: '目标未填：这笔钱几年内不取用、再亏多少必须停手、是否还会转入资金（《战略书》第三节）',
} as const
