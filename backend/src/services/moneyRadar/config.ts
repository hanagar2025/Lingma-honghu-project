/**
 * 资金驾驶舱（R-01）· 配置层
 *
 * 三样东西登记在这里：三个入口的名单、国家队观察名单、预先登记的阈值。
 *
 * 阈值的纪律（方案 9.4，2026-09-23 委员会确认）：
 *   预先登记 → 在样本内历史上校准一次（留档）→ 冻结 → 样本外检验与影子运行期间不再调整。
 * 所以这里的 status 只有三种：PRE_REGISTERED、CALIBRATED、FROZEN，
 * 而且只能往前走。边看边调就是过拟合。
 */

import { readFileSync } from 'node:fs'
import { MAINLINES, findMember } from '../msr/universe'
import type { EntryNo, MoneyObject } from './types'

// ─────────────────────────── 三个入口 ───────────────────────────

const PORTFOLIO_URL = new URL('../cockpit/data/portfolio.json', import.meta.url)

interface PortfolioFileLite {
  asOf?: string
  positions: { code: string; name: string }[]
}

/** 入口①：持仓。直接读账本，不另抄一份名单 —— 另抄一份迟早和账本对不上 */
export function holdingCodes(): { code: string; name: string }[] {
  const raw = JSON.parse(readFileSync(PORTFOLIO_URL, 'utf-8')) as PortfolioFileLite
  return raw.positions.map(p => ({ code: p.code, name: p.name }))
}

/** 入口②：观察仓起始名单（委员会 2026-09-23 确认，按系统现有在册股票起步） */
export const WATCHLIST: readonly { code: string; name: string }[] = [
  { code: '300394', name: '天孚通信' },
  { code: '002916', name: '深南电路' },
  { code: '600183', name: '生益科技' },
  { code: '002384', name: '东山精密' },
  { code: '002837', name: '英维克' },
  { code: '002851', name: '麦格米特' },
  { code: '300870', name: '欧陆通' },
]

export const WATCHLIST_CONFIRMED_ON = '2026-09-23'

/**
 * 入口③ 的行业骨架口径。申万 2021 二级 134 个，三级只在下钻时用。
 * 成分由数据源提供（SW_INDUSTRY），这里只登记口径，不硬编码成分。
 */
export const INDUSTRY_TAXONOMY = {
  standard: '申万 2021',
  level: 'L2' as const,
  expectedCount: 134,
  drillDown: 'L3' as const,
  conceptBoards: '只作命名标签，不参与份额计算' as const,
}

/**
 * 股票池里的代码缺陷。2026-09-23 用腾讯行情核实：
 * universe.ts 把英维克登记为 688292，而 688292 是浩瀚深度，英维克是 002837。
 *
 * 成员代码计入规则指纹（UNIVERSE 域），改 universe.ts 会改变指纹，须委员会裁定。
 * 所以这里不改 universe.ts，只在资金驾驶舱内部按更正后的代码取数，并把缺陷登记在案。
 * 委员会修正 universe.ts 之后，自检会提示删除这条更正。
 */
export const UNIVERSE_CODE_DEFECTS: readonly {
  name: string
  registered: string
  registeredIs: string
  correct: string
  verifiedOn: string
  verifiedBy: string
}[] = [
  {
    name: '英维克',
    registered: '688292',
    registeredIs: '浩瀚深度',
    correct: '002837',
    verifiedOn: '2026-09-23',
    verifiedBy: '腾讯行情 qt.gtimg.cn',
  },
]

function correctedCode(code: string): string {
  return UNIVERSE_CODE_DEFECTS.find(d => d.registered === code)?.correct ?? code
}

/** 主线篮子：取自 msr/universe.ts，不另起一套主线定义；只套用已登记的代码更正 */
export function basketObjects(entry: EntryNo | null = null): MoneyObject[] {
  return MAINLINES.map(ml => ({
    id: `basket:${ml.id}`,
    name: `${ml.name}（主线篮子）`,
    kind: 'BASKET' as const,
    entry,
    codes: ml.members.map(m => correctedCode(m.code)),
    themeEtfs: [],
  }))
}

/** 某只股票所在的主线篮子 id；不在册返回 null */
export function basketOf(code: string): string | null {
  const registered = UNIVERSE_CODE_DEFECTS.find(d => d.correct === code)?.registered ?? code
  const hit = findMember(registered)
  return hit ? `basket:${hit.mainline.id}` : null
}

export function stockObject(code: string, name: string, entry: EntryNo): MoneyObject {
  return { id: `stock:${code}`, name, kind: 'STOCK', entry, codes: [code], themeEtfs: [] }
}

// ─────────────────────────── 国家队 ───────────────────────────

/**
 * 国家队观察名单：已知由中央汇金体系持有的宽基 ETF（2025 年二季报、四季报、年报持有人披露）。
 *
 * 用途是背景层"温度计"：大跌日大额申购读作托底，上涨中持续赎回读作降温。
 * **不进入主线份额比较** —— 它的目的是维护市场平稳，不是选主线。
 * 代码须在 0 期逐只对照季报持有人核对，此后每季度更新一次。
 */
export const NATIONAL_TEAM_ETFS: readonly { code: string; name: string; index: string }[] = [
  { code: '510300', name: '华泰柏瑞沪深300ETF', index: '沪深300' },
  { code: '510310', name: '易方达沪深300ETF', index: '沪深300' },
  { code: '510330', name: '华夏沪深300ETF', index: '沪深300' },
  { code: '159919', name: '嘉实沪深300ETF', index: '沪深300' },
  { code: '510050', name: '华夏上证50ETF', index: '上证50' },
  { code: '510180', name: '华安上证180ETF', index: '上证180' },
  { code: '510500', name: '南方中证500ETF', index: '中证500' },
  { code: '512500', name: '华夏中证500ETF', index: '中证500' },
  { code: '159922', name: '嘉实中证500ETF', index: '中证500' },
  { code: '512100', name: '南方中证1000ETF', index: '中证1000' },
  { code: '159845', name: '华夏中证1000ETF', index: '中证1000' },
  { code: '560010', name: '广发中证1000ETF', index: '中证1000' },
  { code: '159629', name: '富国中证1000ETF', index: '中证1000' },
  { code: '159915', name: '易方达创业板ETF', index: '创业板' },
  { code: '159977', name: '天弘创业板ETF', index: '创业板' },
  { code: '588080', name: '易方达科创50ETF', index: '科创50' },
  { code: '588000', name: '华夏科创50ETF', index: '科创50' },
  { code: '159901', name: '易方达深证100ETF', index: '深证100' },
]

export const NATIONAL_TEAM_VERIFIED = false as const

// ─────────────────────────── 阈值 ───────────────────────────

export type ThresholdStatus = 'PRE_REGISTERED' | 'CALIBRATED' | 'FROZEN'

/**
 * 预先登记的初值（方案 9.4 节，2026-09-23）。
 *
 * 分位数都按"该对象自身"的历史计算 —— 光模块和银行的正常份额差十倍，
 * 用同一个绝对阈值会让大行业永远"启动"、小行业永远"潜伏"。
 */
export const THRESHOLDS = {
  registeredOn: '2026-09-23',
  status: 'PRE_REGISTERED' as ThresholdStatus,

  baselineWindow: 250,
  /** 历史不足这个长度时，水位按"样本不足"处理，不出状态 */
  baselineMinWindow: 120,
  bandLow: 0.25,
  bandHigh: 0.75,
  burstQuantile: 0.95,

  startConfirmDays: 3,
  startExitDays: 3,
  trendPersistDays: 10,
  trendExitDays: 5,
  failWindowDays: 10,
  burstExitDays: 3,
  exhaustConfirmDays: 3,
  /** 衰竭：10 日价格响应低于其 60 日均值的这个比例 */
  exhaustResponseRatio: 0.5,
  retreatRecoverDays: 5,
  burstReturnQuantile: 0.9,

  minHoldDays: 5,

  /** A2 方向性确认的观察窗口 */
  a2WindowDays: 10,

  divergencePoolQuantile: 0.9,
  divergencePersistRatio: 0.9,
  divergenceShareDays: 5,
  divergenceMarginDays: 5,
  divergenceNearHigh: 0.03,
  divergenceHighWindow: 60,
  divergencePoolHistoryDays: 750,

  migrationPersistDays: 10,
  coreSwitchPersistDays: 10,
  coreSwitchTopN: 2,

  /** 个股日均成交额下限（元）。低于下限只并入行业计算，不单独出信号 */
  stockMinAvgAmount: 1e8,

  nationalTeamRescueQuantile: 0.95,
  nationalTeamCoolQuantile: 0.05,

  /** 每条规则进入委员会裁定前需要的独立触发样本数 */
  minTriggersForVerdict: 30,
} as const

/** 阈值状态只能向前：PRE_REGISTERED → CALIBRATED → FROZEN */
export function thresholdTransitionAllowed(from: ThresholdStatus, to: ThresholdStatus): boolean {
  const order: ThresholdStatus[] = ['PRE_REGISTERED', 'CALIBRATED', 'FROZEN']
  return order.indexOf(to) === order.indexOf(from) + 1
}
