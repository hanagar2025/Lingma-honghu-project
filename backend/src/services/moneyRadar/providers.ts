/**
 * 资金驾驶舱（R-01）· 数据适配器层
 *
 * 计算层只认 DataSet，不认数据源。任何来源 —— 交易所官网、东方财富公开接口、
 * 腾讯行情、申万官网、AKShare、Tushare —— 都通过 MoneyDataProvider 接入。
 * 换源不改计算逻辑。
 *
 * 数据源的最终选择推迟到框架走完之后（委员会 2026-09-23）。
 * 所以这里登记的是"候选"，状态如实写：哪个已经在系统里用着、哪个还没接、哪个等 token。
 */

import type { DataKind, DataSet } from './types'

export type ProviderId =
  | 'EXCHANGE_OFFICIAL'
  | 'SWS_OFFICIAL'
  | 'EASTMONEY_PUBLIC'
  | 'TENCENT_QUOTE'
  | 'AKSHARE'
  | 'TUSHARE'
  | 'FUND_REPORTS'
  | 'FIXTURE'

export type ProviderStatus =
  /** 系统里已经在用，但只覆盖部分字段 */
  | 'PARTIAL_IN_USE'
  /** 未接入 */
  | 'NOT_WIRED'
  /** 接口已知，等账号或 token */
  | 'PENDING_TOKEN'
  /** 仅供自检使用的合成数据 */
  | 'TEST_ONLY'

export interface ProviderInfo {
  id: ProviderId
  name: string
  status: ProviderStatus
  covers: readonly DataKind[]
  /** 一手来源 = 交易所、申万等发布方本身；二手 = 转载或封装 */
  firstHand: boolean
  stability: string
  note: string
}

/**
 * 候选数据源登记表。
 *
 * 东方财富的公开接口还提供"主力净流入"，那是 C 级估算，DataKind 里没有它，
 * 所以即便接入东方财富，这一项也进不来。
 */
export const PROVIDER_CANDIDATES: readonly ProviderInfo[] = [
  {
    id: 'EXCHANGE_OFFICIAL', name: '上交所 / 深交所官网披露', status: 'NOT_WIRED',
    covers: ['MARKET_AMOUNT', 'MARGIN', 'ETF_SHARE', 'TOP_INST', 'BLOCK_TRADE', 'NORTHBOUND_TURNOVER'],
    firstHand: true,
    stability: '口径最权威；页面结构偶有调整，两所格式不同，需要分别解析',
    note: '两融与 ETF 份额约 T+1 08:30 发布，这是所有数据源的物理上限',
  },
  {
    id: 'SWS_OFFICIAL', name: '申万宏源研究 · 行业分类下载', status: 'NOT_WIRED',
    covers: ['SW_INDUSTRY'],
    firstHand: true,
    stability: '分类标准多年不变（2021 版），成分调整频率低',
    note: '行业成分是低频数据，下载后本地存档，按纳入 / 剔除日期回溯',
  },
  {
    id: 'EASTMONEY_PUBLIC', name: '东方财富公开数据接口', status: 'NOT_WIRED',
    covers: ['STOCK_AMOUNT', 'MARKET_AMOUNT', 'MARGIN', 'ETF_SHARE', 'TOP_INST', 'BLOCK_TRADE'],
    firstHand: false,
    stability: '覆盖全、更新快；非正式接口，字段和限流会不定期变化',
    note: '其"主力净流入"为 C 级估算，本模块不接入',
  },
  {
    id: 'TENCENT_QUOTE', name: '腾讯行情（系统现有）', status: 'PARTIAL_IN_USE',
    covers: ['STOCK_AMOUNT'],
    firstHand: false,
    stability: '系统已稳定使用；日 K 目前只取了成交量（股数），未取成交额',
    note: '实时行情字段含成交额，适合做持仓与观察仓的双源校验',
  },
  {
    id: 'AKSHARE', name: 'AKShare（开源封装）', status: 'NOT_WIRED',
    covers: ['STOCK_AMOUNT', 'MARKET_AMOUNT', 'SW_INDUSTRY', 'MARGIN', 'ETF_SHARE', 'TOP_INST', 'BLOCK_TRADE'],
    firstHand: false,
    stability: '封装上述公开来源；上游变化时随版本更新，Python 生态',
    note: '适合快速验证；最终仍以一手来源校验',
  },
  {
    id: 'TUSHARE', name: 'Tushare Pro', status: 'PENDING_TOKEN',
    covers: ['STOCK_AMOUNT', 'MARKET_AMOUNT', 'SW_INDUSTRY', 'MARGIN', 'ETF_SHARE', 'TOP_INST', 'BLOCK_TRADE'],
    firstHand: false,
    stability: '接口稳定、口径统一；5000 积分档覆盖本方案全部所需（top_inst 要求 5000）',
    note: '委员会 2026-09-23：开通推迟到框架走完之后再定',
  },
  {
    id: 'FUND_REPORTS', name: '基金定期报告（季报 / 半年报 / 年报）', status: 'NOT_WIRED',
    covers: ['ETF_HOLDERS'],
    firstHand: true,
    stability: '法定披露，格式稳定；季度频率',
    note: '核对国家队持有份额的一手来源。季报前十大持有人按"机构 1 / 机构 2"匿名披露，需对照半年报、年报实名推断',
  },
  {
    id: 'FIXTURE', name: '合成数据（仅自检）', status: 'TEST_ONLY',
    covers: ['STOCK_AMOUNT', 'MARKET_AMOUNT', 'MARGIN', 'ETF_SHARE', 'TOP_INST'],
    firstHand: false,
    stability: '—',
    note: '只用于验证计算逻辑，永不进入驾驶舱的真实视图',
  },
]

/**
 * 每类数据的取数路线：主源 + 校验源。主源未定时写 null。
 * 原则：每一类数据至少有一个一手来源可以校验。
 */
export const ROUTING: Record<DataKind, { primary: ProviderId | null; check: ProviderId[]; note: string }> = {
  STOCK_AMOUNT: {
    primary: null, check: ['TENCENT_QUOTE', 'EASTMONEY_PUBLIC'],
    note: '主源待定；个股成交额没有登记一手来源，用两个相互独立的二手来源交叉校验，偏差超过 0.5% 标红',
  },
  MARKET_AMOUNT: { primary: null, check: ['EXCHANGE_OFFICIAL'], note: '交易所每日公布两市成交总额' },
  SW_INDUSTRY: { primary: 'SWS_OFFICIAL', check: [], note: '申万官网本身就是发布方' },
  MARGIN: { primary: null, check: ['EXCHANGE_OFFICIAL'], note: '交易所融资融券汇总与明细' },
  ETF_SHARE: { primary: null, check: ['EXCHANGE_OFFICIAL'], note: '交易所基金份额披露' },
  TOP_INST: { primary: null, check: ['EXCHANGE_OFFICIAL'], note: '交易所龙虎榜公开信息' },
  BLOCK_TRADE: { primary: null, check: ['EXCHANGE_OFFICIAL'], note: '交易所大宗交易公开信息' },
  NORTHBOUND_TURNOVER: { primary: 'EXCHANGE_OFFICIAL', check: [], note: '只有成交总额，无方向' },
  ETF_HOLDERS: { primary: 'FUND_REPORTS', check: [], note: 'ETF 季报 / 年报持有人，按季核对' },
}

export interface LoadRange {
  start: string
  end: string
}

export interface MoneyDataProvider {
  info: ProviderInfo
  load(range: LoadRange, codes: { stocks: string[]; etfs: string[] }): Promise<DataSet>
}

/** 自检用。直接把构造好的 DataSet 原样返回 */
export function fixtureProvider(ds: DataSet): MoneyDataProvider {
  const info = PROVIDER_CANDIDATES.find(p => p.id === 'FIXTURE')!
  return { info, load: async () => ds }
}

/** 当前有没有任何真实数据源已经接好。框架阶段恒为 false —— 驾驶舱据此显示"数据源未接入" */
export function anyRealProviderWired(): boolean {
  return PROVIDER_CANDIDATES.some(p => p.id !== 'FIXTURE' && p.status !== 'NOT_WIRED'
    && p.status !== 'PENDING_TOKEN' && p.status !== 'PARTIAL_IN_USE')
}
