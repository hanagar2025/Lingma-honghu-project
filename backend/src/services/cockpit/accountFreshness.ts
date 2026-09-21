/**
 * 账本时效守卫。
 *
 * 市值早就不手抄了 —— 它每天用最新价 × 股数重算，因为"手抄的市值会过期，
 * 而过期的市值会让仓位上限判定失真"。但同一个问题还剩下一半没解决：
 * 股数与现金本身仍然是手抄的，记在 portfolio.json 的 asOf 那一天。
 *
 * 于是出现一个没人看的缺口：行情是今天的，分子分母的另一半可能是几周前的。
 * 仓位、熔断、单票超限每天照算照报，谁也不会发现账本没对过账。
 * 一个准确算出来的百分比，分母若来自几周前的现金，它的精确只是排版上的精确。
 *
 * 这个模块只做一件事：把落差说出来。
 * 它不猜差额，也不按当前券商页面反推股数 —— 那等于用一个编出来的账本
 * 去喂真正会生成减仓指令的判定。对不上就必须由委员会对账后更新账本。
 *
 * 本模块不产生动作，不进规则指纹，不改任何上限。
 */

import { beijingToday, daysBehind } from './renderObsidian'

/**
 * 账本可以落后几天而不影响判定。超过就必须当成数据缺口。
 *
 * 取 5 天是为了跨过周末与小长假不误报，同时保证"几周没对过账"一定会显形。
 */
export const ACCOUNT_STALE_LIMIT_DAYS = 5

export interface AccountFreshness {
  asOf: string | null
  /** 落后天数。null = 账本没记日期，时点不可知 */
  staleDays: number | null
  stale: boolean
  /** 给命令行的提示行 */
  lines: string[]
  /** 进入数据缺口清单的条目 */
  gaps: string[]
}

export function accountFreshness(
  asOf: string | null | undefined,
  today?: string,
): AccountFreshness {
  const date = asOf ?? null
  const staleDays = daysBehind(date, today ?? beijingToday())

  // 没记日期比记了旧日期更糟：后者至少能算出落后多少。
  // 故它不能落到"未超阈值"那一支去。
  if (date === null || staleDays === null) {
    return {
      asOf: date,
      staleDays: null,
      stale: true,
      lines: [
        '⚠ 账本快照没有记日期（portfolio.json 缺 asOf）。',
        '  股数与现金的时点不可知 → 仓位、熔断、单票超限判定无法确认是否基于今天的事实。',
      ],
      gaps: ['账本快照缺 asOf → 股数与现金时点不可知，仓位/熔断/超限判定不可确认'],
    }
  }

  if (staleDays <= ACCOUNT_STALE_LIMIT_DAYS) {
    return { asOf: date, staleDays, stale: false, lines: [], gaps: [] }
  }

  return {
    asOf: date,
    staleDays,
    stale: true,
    lines: [
      `⚠ 账本快照 ${date} 已落后 ${staleDays} 天（股数与现金记于那天，行情取今天）。`,
      '  仓位、熔断与单票超限的分子分母可能已经不是今天的事实。',
      '  系统不会自行猜测差额，也不按券商页面反推股数 —— 须对账后更新 portfolio.json。',
    ],
    gaps: [
      `账本快照 ${date} 落后 ${staleDays} 天 → 股数与现金可能已变动，`
      + '仓位/熔断/超限判定须按"账本可能过期"读，不得当成当日资本事实',
    ],
  }
}
