/**
 * CY-01 · 产业节点
 *
 * 节点成员取自 MSR 股票池（msr/universe.ts）的节点归属；R-02 研究池里未进股票池、
 * 但明确属于某节点的股票作为「研究对照」列入，不改变它们的名单层级。
 * 存储节点只有 C 级清退的研究记录，用于承接韩国存储与国产存储的证据，不对应任何持仓。
 */

import { MAINLINES, findMember } from '../msr/universe'
import type { NodeId } from './types'

export const NODE_NAME: Record<NodeId, string> = {
  OPTICAL: '光连接（光模块与光器件）',
  PCB: 'PCB 与覆铜板',
  COMPUTE: '算力芯片与系统',
  SEMI_EQUIP: '国产半导体设备',
  STORAGE: '存储',
  POWER: 'AI 电力基础设施',
}

/** 股票池节点 → 周期监控节点 */
const UNIVERSE_NODE: Record<string, NodeId> = {
  '光模块': 'OPTICAL', '光器件/光引擎': 'OPTICAL', '光器件/调制器': 'OPTICAL', '光模块/光器件': 'OPTICAL',
  '光芯片/AWG/FAU': 'OPTICAL', '光芯片/CW激光器': 'OPTICAL',
  '互连PCB': 'PCB', 'CCL材料': 'PCB', 'PCB/精密制造': 'PCB',
  'CPU/DCU': 'COMPUTE', '系统集成': 'COMPUTE',
  '设备平台': 'SEMI_EQUIP', '刻蚀/MOCVD': 'SEMI_EQUIP', '薄膜沉积': 'SEMI_EQUIP', 'CMP': 'SEMI_EQUIP',
  '量测/检测': 'SEMI_EQUIP', '检测装备': 'SEMI_EQUIP',
  '存储': 'STORAGE', '互连芯片': 'STORAGE',
  '电网升级': 'POWER', '电网设备': 'POWER', 'AI服务器电源': 'POWER', '液冷': 'POWER',
}

/** 未进股票池、但 R-02 研究池按节点分组的股票：只作研究对照 */
const RESEARCH_REFERENCE: { code: string; name: string; node: NodeId; group: string }[] = [
  { code: '300476', name: '胜宏科技', node: 'PCB', group: 'R-02 PCB 材料与制造' },
  { code: '300604', name: '长川科技', node: 'SEMI_EQUIP', group: 'R-02 先进封装与测试（测试设备）' },
  { code: '688676', name: '金盘科技', node: 'POWER', group: 'R-02 AIDC 供电' },
  { code: '002335', name: '科华数据', node: 'POWER', group: 'R-02 AIDC 供电' },
  { code: '301086', name: '鸿富瀚', node: 'POWER', group: 'R-02 液冷' },
  { code: '300499', name: '高澜股份', node: 'POWER', group: 'R-02 液冷' },
  { code: '002600', name: '领益智造', node: 'POWER', group: 'R-02 液冷' },
]

export interface NodeMember {
  code: string
  name: string
  node: NodeId
  champion: boolean
  universeNode: string | null
  /** 作战主线 / 只研究主线 / 研究对照 */
  scope: string
}

export const NODE_ORDER: NodeId[] = ['OPTICAL', 'PCB', 'COMPUTE', 'SEMI_EQUIP', 'STORAGE', 'POWER']

export function nodeMembers(): NodeMember[] {
  const out: NodeMember[] = []
  for (const ml of MAINLINES) {
    for (const m of ml.members) {
      const node = UNIVERSE_NODE[m.node]
      if (!node) continue
      out.push({
        code: m.code, name: m.name, node, champion: !!m.champion, universeNode: `${ml.name} · ${m.node}`,
        scope: ml.id === 'power' ? '只研究主线，仓位为零' : m.retiredC ? 'C 级清退，只保留研究记录' : '作战主线',
      })
    }
  }
  for (const r of RESEARCH_REFERENCE) {
    if (findMember(r.code)) continue
    out.push({ code: r.code, name: r.name, node: r.node, champion: false, universeNode: null, scope: `研究对照（${r.group}，未进股票池）` })
  }
  return out
}

/** 股票池里没有映射到节点的成员；自检要求为空，防止新增成员被静默漏掉 */
export function unmappedUniverseNodes(): string[] {
  return MAINLINES.flatMap(ml => ml.members.filter(m => !UNIVERSE_NODE[m.node]).map(m => `${ml.name} · ${m.node}（${m.code}）`))
}

export const NODE_SCOPE: Record<NodeId, string> = {
  OPTICAL: '作战主线（AI光通信）',
  PCB: '作战主线（AI算力 · 互连PCB / CCL）',
  COMPUTE: '作战主线（AI算力 · CPU/DCU / 系统集成）',
  SEMI_EQUIP: '作战主线（半导体国产替代 · 设备）',
  STORAGE: '研究记录（存储与互连芯片均为 C 级清退，无持仓）',
  POWER: '只研究主线，仓位为零（CTC 冻结令）',
}
