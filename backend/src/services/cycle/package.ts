/**
 * CY-01 · 按产业节点装配带日期的证据包，并渲染为可读文本。
 *
 * 证据包只列证据：数值、日期、可得性、变化方向、出处、缺口。
 * 支持 / 反证的归类依赖恶化条件，恶化条件待裁定，所以证据包不归类，也不给出 C0–C3；
 * 归类和逐节点状态写在研判记录里，并引用本包的证据编号与指纹。
 */

import {
  contextEvidence, daysBetween, memberEvidence, moneyEvidence, nodeGapEvidence, portfolioEvidence,
  availabilityOf, type RawInputs, type R02View,
} from './collect'
import { NODE_NAME, NODE_ORDER, NODE_SCOPE, nodeMembers } from './nodes'
import { CYCLE_RULES, INDICATORS } from './registry'
import {
  AVAILABILITY_TEXT, CHANGE_TEXT, GAP_TEXT, LINE_TEXT,
  type Availability, type Evidence, type EvidencePackage, type NodeView,
} from './types'

export const PERMISSIONS = [
  '证据包只触发复核，不触发仓位动作；不改变冠军池、主线冻结、买入关闭状态与每日执行单。',
  'C0–C3 是产业周期状态，不是熔断等级，也不是卖出信号。现行卖出规则只有 C 级清退、单票归位、熔断三类。',
  'TPO 仍是诊断工具；MA60 仍在模拟层。',
]

export const CONSTRAINTS = [
  '总表是映射与证据汇总：已有模块负责计算，这里只引用字段、标缺口、呈现证据与复核事项，不复制计算。',
  '每个产业节点独立判定，不加权、不合成总分；一个节点恶化不代表其他节点同步恶化。',
  '缺数据是独立的证据状态，既不解释为风险恶化，也不解释为风险解除。',
  '新闻事实与市场解读分栏，各带来源日期、原始口径和适用节点；分析师观点不填进经营或供需字段。',
  '未经裁定的参数标「待裁定」，不生效。',
]

export function cycleProducesAction(): false { return false }

const emptyCounts = (): Record<Availability, number> => ({ AVAILABLE: 0, STALE: 0, TRANSCRIBED: 0, MISSING: 0 })

export function buildPackage(raw: RawInputs, generatedAt: string): EvidencePackage {
  const { today } = raw
  const members = nodeMembers()
  const viewBy = new Map<string, { view: R02View; snap: RawInputs['rerating'][number] }>()
  for (const snap of raw.rerating) for (const v of snap.views) if (!viewBy.has(v.code)) viewBy.set(v.code, { view: v, snap })
  const nodeOfCode = (code: string) => members.find(m => m.code === code)?.node ?? null
  const portfolio = portfolioEvidence(raw, nodeOfCode)
  const heldPct = new Map(portfolio.filter(e => e.indicator === 'L5-03' && e.code).map(e => [e.code!, e]))

  const nodes: NodeView[] = NODE_ORDER.map(node => {
    const ms = members.filter(m => m.node === node)
    const ev = [
      ...ms.flatMap(m => {
        const hit = viewBy.get(m.code)
        return [...memberEvidence(m, hit?.view ?? null, hit?.snap ?? null, today), moneyEvidence(m, raw.money, today)]
      }),
      ...nodeGapEvidence(node, today),
    ]
    const counts = emptyCounts()
    for (const e of ev) counts[e.availability]++
    return {
      node, name: NODE_NAME[node], scope: NODE_SCOPE[node],
      members: ms.map(m => ({ code: m.code, name: m.name, champion: m.champion, held: heldPct.has(m.code), universeNode: m.universeNode, scope: m.scope })),
      price: ev.filter(e => e.line === 'PRICE'),
      operating: ev.filter(e => e.line === 'OPERATING'),
      gaps: INDICATORS.filter(i => (i.nodes?.includes(node) ?? false) && i.gaps.length > 0).map(i => ({ indicator: i.id, name: i.name, gap: i.gaps })),
      facts: raw.facts.filter(f => f.nodes?.includes(node)).map(f => f.id),
      cycleState: { state: null, status: 'NOT_DETERMINED', reason: CYCLE_RULES.note },
      counts,
    }
  })

  const mapped = new Set(members.map(m => m.code))
  const unmapped = [...viewBy.values()].filter(({ view }) => !mapped.has(view.code))
    .map(({ view }) => ({ code: view.code, name: view.name, group: view.group ?? '' }))

  const input = (module: string, path: string, asOf: string | null, freq: 'DAILY' | 'QUARTERLY' | 'MANUAL') => ({
    module, path, asOf, ageDays: asOf ? daysBetween(asOf, today) : null, availability: availabilityOf(freq, asOf, today),
  })
  const inputs = [
    ...raw.rerating.map(s => input('R-02 价格字段', s.file, s.priceDate, 'DAILY')),
    ...raw.rerating.map(s => {
      const rd = s.views.map(v => v.latest?.reportDate).filter((d): d is string => !!d).sort().at(-1) ?? null
      return input('R-02 财报字段（最新报告期）', s.file, rd, 'QUARTERLY')
    }),
    input('R-01 资金哨兵', raw.money?.file ?? 'share/money/latest.json', raw.money?.asOf ?? null, 'DAILY'),
    input('L-01 名单主表风险块', raw.ladderRisk?.file ?? 'share/ladder/latest.json', raw.ladderRisk?.risk.pricedAt.slice(0, 10) ?? null, 'DAILY'),
    input('执行单', raw.card?.file ?? 'share/decision/latest.md', raw.card?.marketDate ?? null, 'DAILY'),
    input('账本', raw.portfolio?.file ?? 'backend/src/services/cockpit/data/portfolio.json', raw.portfolio?.asOf ?? null, 'DAILY'),
    { module: 'M-01 / F-01 / A-01 / C-01 / B-01', path: 'backend/src/services/research/*.ts', asOf: null, ageDays: null, availability: 'TRANSCRIBED' as const },
  ]

  return {
    id: 'CY-01', kind: 'EVIDENCE_PACKAGE', version: 'V1.0', asOf: today, generatedAt,
    inputs, context: contextEvidence(today), nodes, portfolio, facts: raw.facts, unmapped,
    cycleRules: CYCLE_RULES, permissions: PERMISSIONS, constraints: CONSTRAINTS, producesAction: false,
  }
}

export function allEvidence(p: EvidencePackage): Evidence[] {
  return [...p.context, ...p.nodes.flatMap(n => [...n.operating, ...n.price]), ...p.portfolio]
}

// ── 渲染 ──

const cell = (s: string | null | undefined) => (s ?? '').replace(/\|/g, '／').replace(/\n/g, ' ')
const mark = (e: Evidence) => {
  const tag = e.availability === 'AVAILABLE' ? '' : e.availability === 'MISSING' ? '' : `［${AVAILABILITY_TEXT[e.availability]}］`
  const ch = e.change ? `（${CHANGE_TEXT[e.change]}）` : ''
  return `${e.display}${ch}${tag}`
}

const OPERATING_COLS = ['L3-01', 'L3-02', 'L3-03', 'L3-04', 'L3-05', 'L3-06', 'L3-07', 'L3-08', 'L3-09', 'L3-11']
const OPERATING_HEAD = ['累计营收同比', '单季归母同比', '累计扣非同比', '单季毛利率', '现金/利润', '合同负债同比', '存货同比', '应收同比', '一致预期节奏', '在建工程同比']
const PRICE_COLS = ['L4-01:20', 'L4-01:60', 'L4-02:20', 'L4-02:60', 'L4-03', 'L4-04', 'L4-05']
const PRICE_HEAD = ['20日收益', '60日收益', '20日相对沪深300', '60日相对沪深300', '距250日高点', 'PE 3年分位', '资金状态（R-01）']

function colKey(e: Evidence): string {
  return e.id.split(':').length > 2 && /^\d+$/.test(e.id.split(':').at(-1)!) ? `${e.indicator}:${e.id.split(':').at(-1)}` : e.indicator
}

export function renderPackage(p: EvidencePackage, fingerprint: string | null = null): string {
  const L: string[] = []
  L.push(`# CY-01 AI 基建周期证据包 ${p.asOf}`)
  L.push('')
  L.push(`生成时间：${p.generatedAt}　版本：${p.version}　性质：证据汇总（不产生动作）`)
  if (fingerprint) L.push(`JSON 指纹（SHA-256）：${fingerprint}`)
  L.push('')
  L.push('## 边界')
  for (const s of [...p.permissions, ...p.constraints]) L.push(`- ${s}`)
  L.push(`- 周期状态：${p.cycleRules.note}`)
  L.push('')
  L.push('## 输入与时点')
  L.push('| 来源 | 文件 | 数据日期 | 距今天数 | 可得性 |')
  L.push('|---|---|---|---|---|')
  for (const i of p.inputs) L.push(`| ${i.module} | ${i.path} | ${i.asOf ?? '—'} | ${i.ageDays ?? '—'} | ${AVAILABILITY_TEXT[i.availability]} |`)
  L.push('')
  L.push('可得性是显示口径：日频数据距今超过 7 个自然日记「已过时」；季频数据在下一报告期法定披露截止日之后仍是旧期记「已过时」。已过时的数据照样列出。')
  L.push('')

  for (const n of p.nodes) {
    L.push(`## 节点：${n.name}`)
    L.push('')
    L.push(`范围：${n.scope}`)
    L.push(`周期状态：未判定（${n.cycleState.reason}）`)
    L.push(`证据计数：可用 ${n.counts.AVAILABLE}，已过时 ${n.counts.STALE}，转录 ${n.counts.TRANSCRIBED}，缺数据 ${n.counts.MISSING}`)
    L.push('')
    const members = n.members
    L.push(`### ${LINE_TEXT.OPERATING}`)
    L.push(`| 股票 | 范围 | ${OPERATING_HEAD.join(' | ')} |`)
    L.push(`|---|---|${OPERATING_HEAD.map(() => '---').join('|')}|`)
    for (const m of members) {
      const by = new Map(n.operating.filter(e => e.code === m.code).map(e => [colKey(e), e]))
      L.push(`| ${m.name}（${m.code}）${m.champion ? ' 冠军' : ''}${m.held ? ' 持仓' : ''} | ${cell(m.scope)} | ${OPERATING_COLS.map(c => { const e = by.get(c); return e ? cell(mark(e)) : '—' }).join(' | ')} |`)
    }
    const dates = [...new Set(n.operating.filter(e => e.asOf && e.code).map(e => e.asOf!))].sort()
    L.push('')
    L.push(`报告期：${dates.join('、') || '无'}。变化方向只在有相邻两期时给出（单季同比、单季毛利率对照上一季）。`)
    const nodeGaps = n.operating.filter(e => !e.code)
    for (const g of nodeGaps) L.push(`- ${g.indicator} 缺数据：${g.note ?? ''}`)
    L.push('')
    L.push(`### ${LINE_TEXT.PRICE}`)
    L.push(`| 股票 | ${PRICE_HEAD.join(' | ')} |`)
    L.push(`|---|${PRICE_HEAD.map(() => '---').join('|')}|`)
    for (const m of members) {
      const by = new Map(n.price.filter(e => e.code === m.code).map(e => [colKey(e), e]))
      L.push(`| ${m.name}（${m.code}） | ${PRICE_COLS.map(c => { const e = by.get(c); return e ? cell(mark(e)) : '—' }).join(' | ')} |`)
    }
    const pd = [...new Set(n.price.filter(e => e.asOf).map(e => `${e.indicator === 'L4-05' ? 'R-01 ' : 'R-02 '}${e.asOf}`))].sort()
    L.push('')
    L.push(`行情日期：${pd.join('、') || '无'}。`)
    L.push('')
    if (n.facts.length) {
      L.push(`适用本节点的事实台账条目：${n.facts.join('、')}（见文末事实与解读分栏）`)
      L.push('')
    }
    L.push('数据缺口（按类型）：')
    for (const t of ['SOURCE', 'UPDATE', 'NORMAL_RANGE', 'DETERIORATION'] as const) {
      const ids = n.gaps.filter(g => g.gap.includes(t)).map(g => g.indicator)
      if (ids.length) L.push(`- ${GAP_TEXT[t]}：${ids.join('、')}`)
    }
    const uncovered = n.members.filter(m => n.operating.some(e => e.code === m.code && e.note === 'R-02 研究池未覆盖该股，没有该字段')).map(m => m.name)
    if (uncovered.length) L.push(`- R-02 研究池未覆盖：${uncovered.join('、')}`)
    L.push('')
  }

  L.push('## 背景层（各节点共用，不归入任何节点）')
  L.push('| 编号 | 层 | 内容 | 日期 | 可得性 | 出处 | 说明 |')
  L.push('|---|---|---|---|---|---|---|')
  for (const e of p.context) L.push(`| ${e.id} | ${e.layer} | ${cell(e.display)} | ${e.asOf ?? '—'} | ${AVAILABILITY_TEXT[e.availability]} | ${e.source.module === '无' ? '—' : `${e.source.module} ${cell(e.source.field)}`} | ${cell(e.note)} |`)
  L.push('')
  L.push('## 组合风险（引用执行单与名单主表；动作只由执行单给出）')
  L.push('| 编号 | 内容 | 日期 | 可得性 | 说明 |')
  L.push('|---|---|---|---|---|')
  for (const e of p.portfolio) L.push(`| ${e.id} | ${cell(e.display)} | ${e.asOf ?? '—'} | ${AVAILABILITY_TEXT[e.availability]} | ${cell(e.note)} |`)
  L.push('')
  L.push('## 事实与解读（分栏）')
  L.push('| 编号 | 事件日期 | 来源（日期） | 适用节点 | 已核实的事实 | 市场解读 | 不能推出 | 性质 |')
  L.push('|---|---|---|---|---|---|---|---|')
  for (const f of p.facts) {
    L.push(`| ${f.id} | ${f.eventDate} | ${cell(f.source)}（${f.sourceDate}） | ${f.nodes ? f.nodes.map(x => NODE_NAME[x]).join('、') : '不指定节点'} | ${cell(f.fact)} | ${cell(f.interpretation ?? '无')} | ${cell(f.cannotInfer)} | ${f.status === 'HYPOTHESIS' ? '待检验假设' : '已核实事实'} |`)
  }
  L.push('')
  if (p.unmapped.length) {
    L.push('## R-02 覆盖但不属于任何节点的股票（列出，不归入节点）')
    for (const u of p.unmapped) L.push(`- ${u.name}（${u.code}）：${u.group}`)
    L.push('')
  }
  L.push('## 研判须知')
  L.push('- 研判记录引用本包时写明文件名与 JSON 指纹；证据编号即上表「编号」或「指标编号:股票代码[:窗口]」。')
  L.push('- 缺数据的条目不能被引为支持或反证，只能列入「已考虑的缺口」。')
  L.push('- 研判必须在看到后续结果之前落档；事后验证另起一条记录，回指原研判。')
  L.push('')
  return L.join('\n')
}
