/**
 * 委员会已裁定、尚未执行完毕的卖出指令。
 *
 * 驾驶舱只能从账务事实（单票超限、熔断）推出动作；C 级清退是战略层裁定，
 * 执行层不得替战略层生成，故单独登记在这里，并注明裁定出处。
 * 账本里该股数量归零后指令自动失效 —— 不需要人来删。
 */
export interface CommitteeOrder {
  code: string
  name: string
  /** ALL = 全部清仓，与当日股数无关 */
  sell: 'ALL'
  reason: string
  source: string
}

export const COMMITTEE_ORDERS: readonly CommitteeOrder[] = [
  {
    code: '688008', name: '澜起科技', sell: 'ALL',
    reason: 'C 级清退',
    source: '7/26 战略层终审；10/10 二次裁定第①步',
  },
  {
    code: '603986', name: '兆易创新', sell: 'ALL',
    reason: 'C 级清退（硬止损 439.75 自 7/28 击穿）',
    source: '7/26 战略层终审；10/10 二次裁定第①步',
  },
]
