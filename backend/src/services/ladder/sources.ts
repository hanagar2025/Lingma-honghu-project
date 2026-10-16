/**
 * 名单治理（L-01）· 来源登记
 *
 * 六份既有名单都从各自的代码常量读，不另抄一份 —— 另抄一份迟早和原名单对不上。
 * 唯一的例外是全景图名单：它只存在于文档里，没有代码，这里按文档逐只登记代码
 * （2026-10-16 已用腾讯行情逐只核对名称）。
 */

import { readFileSync } from 'node:fs'
import { MAINLINES } from '../msr/universe'
import { LEFT_RADAR, LEFT_RADAR_CONFIRMED_ON, WATCHLIST, WATCHLIST_CONFIRMED_ON } from '../moneyRadar/config'
import { NEXT_WAVE_POOL, PRESELECT_POOL } from '../research/rerating'
import type { SourceId, SourceTag } from './types'

export interface SourceInfo {
  id: SourceId
  label: string
  file: string
  /** 该来源能提供的最高资格。委员会点名与研究名单只到研究池；观察计划另由 PLAN_OF 决定 */
  grants: '持仓' | '研究' | '研究 + 观察计划'
}

export const SOURCES: Record<SourceId, SourceInfo> = {
  HOLDING: { id: 'HOLDING', label: '账本持仓', file: 'backend/src/services/cockpit/data/portfolio.json', grants: '持仓' },
  MSR_UNIVERSE: { id: 'MSR_UNIVERSE', label: 'MSR 股票池', file: 'backend/src/services/msr/universe.ts', grants: '研究' },
  R01_WATCH: { id: 'R01_WATCH', label: '资金哨兵入口② 起始名单', file: 'backend/src/services/moneyRadar/config.ts', grants: '研究 + 观察计划' },
  R01_RADAR: { id: 'R01_RADAR', label: '资金哨兵入口② 左侧雷达', file: 'backend/src/services/moneyRadar/config.ts', grants: '研究 + 观察计划' },
  R02_PRESELECT: { id: 'R02_PRESELECT', label: 'R-02 第一批', file: 'backend/src/services/research/rerating.ts', grants: '研究 + 观察计划' },
  R02_NEXT: { id: 'R02_NEXT', label: 'R-02 第二批', file: 'backend/src/services/research/rerating.ts', grants: '研究 + 观察计划' },
  MAP_V1: { id: 'MAP_V1', label: '全景图观察名单初稿', file: '战略组合2026-2030/AI产业链全景图与观察名单V1.0.md', grants: '研究' },
}

/** R-02 两批名单的委员会点名日期 */
export const R02_CONFIRMED_ON = '2026-10-15'
/** 全景图名单入库日期（总纲第三章初稿，已被 CTC 冻结令覆盖，只作研究来源） */
export const MAP_V1_SINCE = '2026-07-19'

/** 全景图观察名单初稿（「待补充」的空缺赛道不登记） */
export const MAP_V1: readonly { code: string; name: string; track: string }[] = [
  { code: '688041', name: '海光信息', track: 'L1 国产GPU/AI芯片' },
  { code: '688256', name: '寒武纪', track: 'L1 国产GPU/AI芯片' },
  { code: '603019', name: '中科曙光', track: 'L1 CPU/服务器芯片' },
  { code: '688702', name: '盛科通信', track: 'L1 交换芯片' },
  { code: '688008', name: '澜起科技', track: 'L2 内存接口/HBM生态' },
  { code: '603986', name: '兆易创新', track: 'L2 存储' },
  { code: '688123', name: '聚辰股份', track: 'L2 EEPROM/接口' },
  { code: '300475', name: '香农芯创', track: 'L2 HBM相关' },
  { code: '688525', name: '佰维存储', track: 'L2 HBM相关' },
  { code: '300308', name: '中际旭创', track: 'L3 光模块' },
  { code: '300502', name: '新易盛', track: 'L3 光模块' },
  { code: '300394', name: '天孚通信', track: 'L3 光器件' },
  { code: '300570', name: '太辰光', track: 'L3 光引擎/CPO' },
  { code: '000977', name: '浪潮信息', track: 'L4 AI服务器' },
  { code: '601138', name: '工业富联', track: 'L4 AI服务器/代工' },
  { code: '002463', name: '沪电股份', track: 'L4 PCB' },
  { code: '300476', name: '胜宏科技', track: 'L4 PCB' },
  { code: '600183', name: '生益科技', track: 'L4 覆铜板' },
  { code: '688981', name: '中芯国际', track: 'L5 晶圆代工' },
  { code: '600584', name: '长电科技', track: 'L5 先进封装' },
  { code: '002156', name: '通富微电', track: 'L5 先进封装' },
  { code: '002371', name: '北方华创', track: 'L6 平台型设备' },
  { code: '688012', name: '中微公司', track: 'L6 刻蚀' },
  { code: '688072', name: '拓荆科技', track: 'L6 薄膜沉积' },
  { code: '688200', name: '华峰测控', track: 'L6 测试设备' },
  { code: '300604', name: '长川科技', track: 'L6 测试设备' },
  { code: '301269', name: '华大九天', track: 'L7 国产EDA' },
  { code: '688206', name: '概伦电子', track: 'L7 国产EDA' },
  { code: '688126', name: '沪硅产业', track: 'L8 硅片' },
  { code: '603650', name: '彤程新材', track: 'L8 光刻胶' },
  { code: '300346', name: '南大光电', track: 'L8 光刻胶' },
  { code: '688268', name: '华特气体', track: 'L8 电子特气' },
  { code: '688019', name: '安集科技', track: 'L8 抛光材料' },
  { code: '300054', name: '鼎龙股份', track: 'L8 抛光材料' },
  { code: '300124', name: '汇川技术', track: '工控/伺服（机器人主线未认定前仅建档）' },
]

const PORTFOLIO_URL = new URL('../cockpit/data/portfolio.json', import.meta.url)

export interface PortfolioLite {
  asOf: string
  cash: number
  externalCash: number
  peakAssets: number
  peakVerified: boolean
  pendingSells: number
  positions: { code: string; name: string; quantity: number; sector: string; theme: string }[]
}

export function loadPortfolio(url: URL = PORTFOLIO_URL): PortfolioLite {
  return JSON.parse(readFileSync(url, 'utf-8')) as PortfolioLite
}

export interface SourcedName { code: string; name: string; tag: SourceTag }

/** 把六份名单与账本持仓展开成 (股票, 来源) 列表 */
export function collectSources(portfolio: PortfolioLite): SourcedName[] {
  const out: SourcedName[] = []
  for (const p of portfolio.positions) {
    out.push({ code: p.code, name: p.name, tag: { source: 'HOLDING', group: null, since: portfolio.asOf, by: '账本' } })
  }
  for (const ml of MAINLINES) {
    for (const m of ml.members) {
      out.push({ code: m.code, name: m.name, tag: { source: 'MSR_UNIVERSE', group: `${ml.name} · ${m.node}`, since: '2026-07-26', by: '研究档案' } })
    }
  }
  for (const w of WATCHLIST) {
    out.push({ code: w.code, name: w.name, tag: { source: 'R01_WATCH', group: null, since: WATCHLIST_CONFIRMED_ON, by: '委员会' } })
  }
  for (const g of LEFT_RADAR) {
    for (const m of g.members) {
      out.push({ code: m.code, name: m.name, tag: { source: 'R01_RADAR', group: g.name, since: LEFT_RADAR_CONFIRMED_ON, by: '委员会' } })
    }
  }
  for (const m of PRESELECT_POOL) {
    out.push({ code: m.code, name: m.name, tag: { source: 'R02_PRESELECT', group: m.group, since: R02_CONFIRMED_ON, by: '委员会' } })
  }
  for (const m of NEXT_WAVE_POOL) {
    if (m.group.includes('对照')) continue
    out.push({ code: m.code, name: m.name, tag: { source: 'R02_NEXT', group: m.group, since: R02_CONFIRMED_ON, by: '委员会' } })
  }
  for (const m of MAP_V1) {
    out.push({ code: m.code, name: m.name, tag: { source: 'MAP_V1', group: m.track, since: MAP_V1_SINCE, by: '总纲初稿' } })
  }
  return out
}
