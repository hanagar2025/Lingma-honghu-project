/**
 * 战略侧登记的预判。每一条都有出处和登记日期，程序只照着读、到期对照，不自己下判断。
 *
 * 2026-11-24 起，仓位规则以《半年计划》为准：个股去留只看资金分和趋势，执行单按规则出指令。
 * 此前这里登记的个股结论（11/11 的“拿住、降仓顺序”）、可买范围和机会闸门参数都已被取代，不再保留。
 */

/** 新低的窗口：60 个交易日 */
export const LOW_WINDOW = 60

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
