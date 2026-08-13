// 第③问：主线里面，谁正在获得势能？
//
// 按**产业链节点**而非个股聚合。委员会 2026-08-13 的定义：
//   「我们投资AI光通信这条产业链，并动态寻找其中风险收益比最高的利润池。」
//   「主线不是一只股票。主线内部永远存在：龙头 → 核心供应商 → 上游瓶颈 → 新技术 → 新利润池。」
//
// 两条硬约束：
//   ① 节点势能分数等级为 OBSERVATION。**分数最高 ≠ 买入。**
//      正确路径是 发现 → 候选 → 产业验证 → 盈利验证 → 估值 → 价格窗口 → 才进买入候选。
//   ② 委员会列出的节点即使**当前无覆盖标的**也必须显示，标注"无覆盖"。
//      隐去空节点会让产业链地图看起来是完整的，而事实上是研究缺口。
//      能看见缺口，才知道下一步该研究什么。

import type { DailyBar } from '../tios/types'
import { sma } from '../tios/indicators'
import { MAINLINES, findMember, type UniverseMember } from '../msr/universe'
import type { Answer, AnswerRow, Light, Metric } from './types'

/**
 * 委员会 2026-08-13 给出的节点清单（原样保留顺序，代表产业链上下游次序）。
 * `aliases` 用于把 universe.ts 里的 node 字段映射到本清单。
 */
export interface NodeSpec {
  mainlineId: string
  name: string
  aliases: string[]
}

export const NODE_TAXONOMY: NodeSpec[] = [
  // ── AI光通信 ──
  { mainlineId: 'optical', name: '光模块', aliases: ['光模块', '光模块/光器件'] },
  { mainlineId: 'optical', name: '光芯片', aliases: ['光芯片/AWG/FAU', '光芯片'] },
  { mainlineId: 'optical', name: '激光器', aliases: ['光芯片/CW激光器'] },
  { mainlineId: 'optical', name: 'EML', aliases: ['EML'] },
  { mainlineId: 'optical', name: '硅光', aliases: ['硅光'] },
  { mainlineId: 'optical', name: 'CPO', aliases: ['CPO', 'CPO/硅光'] },
  { mainlineId: 'optical', name: 'FAU/AWG', aliases: ['FAU/AWG'] },
  { mainlineId: 'optical', name: '光器件/光引擎', aliases: ['光器件/光引擎', '光器件/调制器'] },
  { mainlineId: 'optical', name: '光纤', aliases: ['光纤'] },
  { mainlineId: 'optical', name: '高速连接', aliases: ['高速连接'] },
  // ── 半导体 ──
  { mainlineId: 'semi', name: '设备平台', aliases: ['设备平台'] },
  { mainlineId: 'semi', name: '刻蚀', aliases: ['刻蚀/MOCVD', '刻蚀'] },
  { mainlineId: 'semi', name: '薄膜沉积', aliases: ['薄膜沉积'] },
  { mainlineId: 'semi', name: '清洗', aliases: ['清洗'] },
  { mainlineId: 'semi', name: 'CMP', aliases: ['CMP'] },
  { mainlineId: 'semi', name: '量检测', aliases: ['量测/检测', '检测装备'] },
  { mainlineId: 'semi', name: '材料', aliases: ['材料'] },
  { mainlineId: 'semi', name: '零部件', aliases: ['零部件'] },
  { mainlineId: 'semi', name: '存储/互连（已清退）', aliases: ['存储', '互连芯片'] },
  // ── AI算力 ──
  { mainlineId: 'compute', name: 'CPU/DCU', aliases: ['CPU/DCU'] },
  { mainlineId: 'compute', name: '系统集成', aliases: ['系统集成'] },
  { mainlineId: 'compute', name: '高速互联PCB', aliases: ['互连PCB', 'PCB/精密制造'] },
  { mainlineId: 'compute', name: 'CCL材料', aliases: ['CCL材料'] },
  // ── AI电力 ──
  { mainlineId: 'power', name: '变压器', aliases: ['变压器'] },
  { mainlineId: 'power', name: '配电', aliases: ['配电'] },
  { mainlineId: 'power', name: '电网', aliases: ['电网升级', '电网设备'] },
  // 液冷归在 AI电力（委员会原始清单口径），且 universe.ts 里英维克确实挂在 power 下。
  // 曾把它错列在 AI算力 名下，后果是英维克在第③问里被整条漏掉 ——
  // 节点清单与扫描域不一致时，标的会静默消失而不是报错，故下方增设覆盖率不变量。
  { mainlineId: 'power', name: '液冷', aliases: ['液冷'] },
  { mainlineId: 'power', name: 'UPS', aliases: ['UPS'] },
  { mainlineId: 'power', name: '储能', aliases: ['储能'] },
  { mainlineId: 'power', name: '电源管理', aliases: ['AI服务器电源', '电源管理'] },
]

/**
 * 覆盖率自检：扫描域里每个标的都必须被某个节点认领。
 *
 * 节点清单与 universe.ts 是两份独立维护的配置，一旦对不上，
 * 标的会从第③问里**静默消失**而不是报错 —— 静默丢标的比报错危险得多。
 */
export function findUnclaimedMembers(): { code: string; name: string; mainline: string; node: string }[] {
  const out: { code: string; name: string; mainline: string; node: string }[] = []
  for (const ml of MAINLINES) {
    for (const m of ml.members) {
      const claimed = NODE_TAXONOMY.some(s => s.mainlineId === ml.id && s.aliases.includes(m.node))
      if (!claimed) out.push({ code: m.code, name: m.name, mainline: ml.name, node: m.node })
    }
  }
  return out
}

export interface NodeMomentum {
  mainlineId: string
  mainlineName: string
  node: string
  /** 覆盖的标的 */
  members: { code: string; name: string; tier: 1 | 2 | 3; evidence: string }[]
  /** 势能变化分数 0–10。OBSERVATION 等级 —— 分数高不代表可买 */
  score: number | null
  /** 分数拆解，供追溯 */
  breakdown: { item: string; points: number; detail: string }[]
  metrics: Metric[]
  /** 覆盖状态 */
  coverage: 'COVERED' | 'NO_MEMBER' | 'INSUFFICIENT_DATA' | 'RETIRED'
  note: string
}

function ret(bars: DailyBar[], n: number): number | null {
  if (bars.length < n + 1) return null
  return bars[bars.length - 1].close / bars[bars.length - 1 - n].close - 1
}

/** 节点合成序列：成员等权平均收盘 + 成交额加总 */
function synthesize(codes: string[], barsByCode: Record<string, DailyBar[]>): DailyBar[] {
  const usable = codes.map(c => barsByCode[c]).filter((b): b is DailyBar[] => !!b && b.length >= 65)
  if (!usable.length) return []
  const dateSets = usable.map(b => new Set(b.map(x => x.date)))
  const common = usable[0].map(b => b.date).filter(d => dateSets.every(s => s.has(d)))
  const byCode = usable.map(b => new Map(b.map(x => [x.date, x])))
  return common.map(d => {
    const hits = byCode.map(m => m.get(d)!).filter(Boolean)
    const close = hits.reduce((a, b) => a + b.close, 0) / hits.length
    const amount = hits.reduce((a, b) => a + b.close * b.volume, 0)
    return { date: d, open: close, high: close, low: close, close, volume: close > 0 ? amount / close : 0 }
  })
}

function amountRatio(bars: DailyBar[], shortN: number, longN: number): number | null {
  if (bars.length < longN) return null
  const amt = bars.map(b => b.close * b.volume)
  const s = amt.slice(-shortN).reduce((a, b) => a + b, 0) / shortN
  const l = amt.slice(-longN).reduce((a, b) => a + b, 0) / longN
  return l === 0 ? null : s / l
}

function pctStr(v: number | null): string {
  return v === null ? '缺失' : `${(v * 100).toFixed(1)}%`
}

export interface NodesInput {
  barsByCode: Record<string, DailyBar[]>
  indexBarsByCode: Record<string, DailyBar[]>
  asOf: string
}

export function evaluateNodes(input: NodesInput): { answer: Answer; nodes: NodeMomentum[] } {
  const { barsByCode, indexBarsByCode, asOf } = input
  const out: NodeMomentum[] = []

  for (const spec of NODE_TAXONOMY) {
    const mainline = MAINLINES.find(m => m.id === spec.mainlineId)!
    const members = mainline.members.filter(m => spec.aliases.includes(m.node))
    const active = members.filter(m => !m.retiredC)
    const base = {
      mainlineId: spec.mainlineId, mainlineName: mainline.name, node: spec.name,
      members: members.map(m => ({ code: m.code, name: m.name, tier: m.tier, evidence: m.evidence })),
    }

    if (members.length === 0) {
      out.push({
        ...base, score: null, breakdown: [], metrics: [], coverage: 'NO_MEMBER',
        note: '委员会已列入产业链地图，但当前无覆盖标的 → 这是研究缺口，不是"没有机会"',
      })
      continue
    }
    if (active.length === 0) {
      out.push({
        ...base, score: null, breakdown: [], metrics: [], coverage: 'RETIRED',
        note: '节点内标的均已C级清退，须走冠军替换四步程序',
      })
      continue
    }

    const syn = synthesize(active.map(m => m.code), barsByCode)
    if (syn.length < 65) {
      out.push({
        ...base, score: null, breakdown: [], metrics: [], coverage: 'INSUFFICIENT_DATA',
        note: `合成序列仅${syn.length}根，不足65根`,
      })
      continue
    }

    const index = indexBarsByCode[mainline.benchmark]
    const breakdown: NodeMomentum['breakdown'] = []
    const metrics: Metric[] = []

    // ① 相对主线基准的 20 日超额（0–3分）
    const r20 = ret(syn, 20)
    const i20 = index ? ret(index, 20) : null
    const e20 = r20 === null || i20 === null ? null : r20 - i20
    const p1 = e20 === null ? 0 : e20 > 0.10 ? 3 : e20 > 0.05 ? 2 : e20 > 0 ? 1 : 0
    breakdown.push({ item: '20日相对主线超额', points: p1, detail: `${pctStr(e20)}（>10%得3，>5%得2，>0得1）` })
    metrics.push({
      label: '节点20日相对超额', value: e20, display: pctStr(e20),
      source: `节点内${active.length}只等权合成 vs ${mainline.benchmark}`,
      formula: `节点20日涨幅${pctStr(r20)} − 基准${pctStr(i20)}`, asOf, tier: 'OBSERVATION',
    })

    // ② 60 日超额（0–2分）：过滤掉只有一周热度的节点
    const r60 = ret(syn, 60)
    const i60 = index ? ret(index, 60) : null
    const e60 = r60 === null || i60 === null ? null : r60 - i60
    const p2 = e60 === null ? 0 : e60 > 0.15 ? 2 : e60 > 0 ? 1 : 0
    breakdown.push({ item: '60日相对主线超额', points: p2, detail: `${pctStr(e60)}（>15%得2，>0得1）` })
    metrics.push({
      label: '节点60日相对超额', value: e60, display: pctStr(e60),
      source: `节点内${active.length}只等权合成 vs ${mainline.benchmark}`,
      formula: `节点60日涨幅${pctStr(r60)} − 基准${pctStr(i60)}`, asOf, tier: 'OBSERVATION',
    })

    // ③ 节点成交额扩张（0–2分）
    const amt = amountRatio(syn, 20, 60)
    const p3 = amt === null ? 0 : amt >= 1.3 ? 2 : amt >= 1.0 ? 1 : 0
    breakdown.push({ item: '成交额20/60', points: p3, detail: `${amt?.toFixed(2) ?? '缺失'}（≥1.3得2，≥1.0得1）` })
    metrics.push({
      label: '节点成交额20/60', value: amt, display: amt?.toFixed(2) ?? '缺失',
      source: '节点内成员成交额加总', formula: '近20日均成交额 ÷ 近60日均成交额', asOf, tier: 'OBSERVATION',
    })

    // ④ 趋势位置（0–2分）
    const close = syn[syn.length - 1].close
    const ma20 = sma(syn, 20)
    const ma60 = sma(syn, 60)
    const aboveMa20 = ma20 !== null && close > ma20
    const aboveMa60 = ma60 !== null && close > ma60
    const p4 = (aboveMa20 ? 1 : 0) + (aboveMa60 ? 1 : 0)
    breakdown.push({
      item: '趋势位置', points: p4,
      detail: `${aboveMa20 ? '站上MA20' : '低于MA20'}、${aboveMa60 ? '站上MA60' : '低于MA60'}（各1分）`,
    })
    metrics.push({
      label: '节点距MA60', value: ma60 === null ? null : close / ma60 - 1,
      display: pctStr(ma60 === null ? null : close / ma60 - 1),
      source: '节点合成序列', formula: `合成收盘${close.toFixed(2)} ÷ MA60${ma60?.toFixed(2) ?? 'NA'} − 1`,
      asOf, tier: 'OBSERVATION',
    })

    // ⑤ 产业证据（0–1分）：节点内是否存在 S/A 级证据
    const bestEvidence = active.some(x => x.evidence === 'S') ? 'S'
      : active.some(x => x.evidence === 'A') ? 'A'
        : active.some(x => x.evidence === 'B') ? 'B' : 'C'
    const p5 = bestEvidence === 'S' || bestEvidence === 'A' ? 1 : 0
    breakdown.push({ item: '节点最高产业证据', points: p5, detail: `${bestEvidence}级（S/A得1分）` })

    const score = p1 + p2 + p3 + p4 + p5
    out.push({
      ...base, score, breakdown, metrics, coverage: 'COVERED',
      note: `${active.length}只覆盖，最高证据${bestEvidence}级`,
    })
  }

  const covered = out.filter(n => n.coverage === 'COVERED' && n.score !== null)
  covered.sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
  const gaps = out.filter(n => n.coverage === 'NO_MEMBER')

  const rows: AnswerRow[] = covered.map(n => ({
    label: `${n.mainlineName} / ${n.node}`,
    status: `势能${n.score}/10（${n.members.map(x => x.name).join('、')}）`,
    // 灯色表示"是否值得研究"，不表示"是否可买"
    light: (n.score ?? 0) >= 7 ? 'YELLOW' : 'GREEN',
    decision: (n.score ?? 0) >= 7
      ? '进入研究序列（发现≠可买，须过S1产业→S2盈利→估值→价格窗口）'
      : '继续跟踪',
    metrics: n.metrics,
    reviewTriggers: n.breakdown.map(b => `${b.item} +${b.points}：${b.detail}`),
  }))

  if (gaps.length) {
    rows.push({
      label: '未覆盖节点（研究缺口）',
      status: `${gaps.length}个：${gaps.map(g => `${g.mainlineName}/${g.node}`).join('、')}`,
      light: 'YELLOW',
      decision: '这些节点在产业链地图上，但我们没有标的可扫 → 下一步研究方向',
    })
  }

  const top = covered[0]
  const headline = top
    ? `势能最高节点：${top.mainlineName}/${top.node} ${top.score}/10（${top.members.map(x => x.name).join('、')}）` +
      `。分数是观察指标，**不构成买入依据**` +
      (gaps.length ? `；另有${gaps.length}个节点无覆盖标的` : '')
    : '无可计算节点'

  return {
    answer: {
      no: 3, question: '主线里面，谁正在获得势能？',
      light: 'GREEN', headline, metrics: [], rows,
    },
    nodes: out,
  }
}

/** 给定标的，返回它所属的节点名（用于第④问展示） */
export function nodeOf(code: string): string | null {
  const hit = findMember(code)
  if (!hit) return null
  const spec = NODE_TAXONOMY.find(s => s.mainlineId === hit.mainline.id && s.aliases.includes(hit.member.node))
  return spec?.name ?? hit.member.node
}

export function memberEvidence(m: UniverseMember): string {
  return m.evidence
}
