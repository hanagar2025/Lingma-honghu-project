/**
 * CY-01 · 证据采集
 *
 * 只读现有模块的已发布输出与已登记字段，把它们整理成带出处、日期、可得性的证据条目。
 * 这里唯一的计算是：距今天数、是否超过更新周期、相邻两期的变化方向。不复算任何已有指标。
 *
 * 可得性是显示口径，不是判定参数：
 *   日频数据距今超过 7 个自然日 → 已过时；
 *   季频数据在下一报告期的法定披露截止日之后仍是旧期 → 已过时。
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { READINGS } from '../research/macroRiskLights'
import { buildAiFinancingQualityView } from '../research/aiFinancingQuality'
import { buildAiFourActsView } from '../research/aiFourActs'
import { DEMAND_EVIDENCE } from '../research/capexLadder'
import { SESSION_CHECKS } from '../research/marketStructureWatch'
import { NODE_ORDER, nodeMembers, type NodeMember } from './nodes'
import { INDICATORS, indicatorById } from './registry'
import type { Availability, Change, Evidence, EvidenceKind, FactEntry, NodeId, SourceRef, UpdateFreq } from './types'

export const DAILY_STALE_DAYS = 7

export interface R02Quarter { reportDate: string; netProfitYoy: number | null; grossMargin: number | null }
export interface R02View {
  code: string
  name: string
  group?: string
  pePercentile3y: number | null
  latest: { reportDate: string; revenueYoy: number | null; deductNetProfitYoy: number | null } | null
  quarters: R02Quarter[]
  cashConversion: number | null
  balanceYoy: { reportDate: string; inventory: number | null; receivables: number | null; contractLiab: number | null; constructionInProgress: number | null } | null
  consensusPace: { ratio: number | null; basis: string } | null
  ret20: number | null
  ret60: number | null
  rs20: number | null
  rs60: number | null
  drawdown250: number | null
}

export interface MoneyObject { id: string; name: string; state: string; stateText: string; divergence: string; dataStatus: string }
export interface RiskBlock {
  pricedAt: string
  sectors: { label: string; pct: number; limit: number; holdings: { code: string; name: string; pct: number }[] }[]
  themes: { label: string; pct: number; limit: number; holdings: { code: string; name: string; pct: number }[] }[]
}

export interface RawInputs {
  today: string
  rerating: { file: string; asOf: string; priceDate: string; views: R02View[] }[]
  money: { file: string; asOf: string; objects: MoneyObject[] } | null
  ladderRisk: { file: string; risk: RiskBlock } | null
  portfolio: { file: string; asOf: string; pendingSells: number; peakVerified: boolean } | null
  card: { file: string; marketDate: string | null; account: string | null; circuit: string | null } | null
  facts: FactEntry[]
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to.slice(0, 10)}T00:00:00Z`) - Date.parse(`${from.slice(0, 10)}T00:00:00Z`)) / 86_400_000)
}

/** 下一报告期的法定披露截止日：一季报 4/30、半年报 8/31、三季报 10/31、年报次年 4/30 */
export function nextDisclosureDeadline(reportDate: string): string {
  const y = +reportDate.slice(0, 4)
  switch (reportDate.slice(5, 10)) {
    case '03-31': return `${y}-08-31`
    case '06-30': return `${y}-10-31`
    case '09-30': return `${y + 1}-04-30`
    default: return `${y + 1}-04-30`
  }
}

export function availabilityOf(freq: UpdateFreq, asOf: string | null, today: string): Availability {
  if (!asOf) return 'MISSING'
  if (freq === 'DAILY') return daysBetween(asOf, today) > DAILY_STALE_DAYS ? 'STALE' : 'AVAILABLE'
  if (freq === 'QUARTERLY') return today > nextDisclosureDeadline(asOf) ? 'STALE' : 'AVAILABLE'
  return 'AVAILABLE'
}

export function changeOf(cur: number | null, prev: number | null): Change | null {
  if (cur == null || prev == null) return null
  return cur > prev ? 'UP' : cur < prev ? 'DOWN' : 'FLAT'
}

const pct = (x: number | null, digits = 1) => x == null ? '缺' : `${x > 0 ? '+' : ''}${(x * 100).toFixed(digits)}%`
const pctRaw = (x: number | null, digits = 1) => x == null ? '缺' : `${x > 0 ? '+' : ''}${x.toFixed(digits)}%`

interface Spec {
  indicator: string
  suffix?: string
  node: NodeId | null
  code: string | null
  name: string | null
  kind: EvidenceKind
  value: number | string | null
  display: string
  asOf: string | null
  availability?: Availability
  change?: Change | null
  changeBasis?: string | null
  source?: SourceRef
  note?: string | null
}

export function makeEvidence(s: Spec, today: string): Evidence {
  const ind = indicatorById(s.indicator)
  if (!ind) throw new Error(`未登记的指标 ${s.indicator}`)
  const id = [s.indicator, s.node && !s.code ? s.node : null, s.code, s.suffix].filter(Boolean).join(':')
  const availability = s.availability
    ?? (s.value == null ? 'MISSING' : s.kind === 'TRANSCRIBED' ? 'TRANSCRIBED' : availabilityOf(ind.freq, s.asOf, today))
  return {
    id, indicator: s.indicator, layer: ind.layer, line: ind.line, node: s.node, code: s.code, name: s.name,
    kind: s.kind, value: s.value, display: s.display, asOf: s.asOf,
    ageDays: s.asOf ? daysBetween(s.asOf, today) : null,
    availability, change: s.change ?? null, changeBasis: s.changeBasis ?? null,
    source: s.source ?? ind.source ?? { module: '无', path: '无', field: '无' },
    note: s.note ?? null,
  }
}

const R02_OPERATING = ['L3-01', 'L3-02', 'L3-03', 'L3-04', 'L3-05', 'L3-06', 'L3-07', 'L3-08', 'L3-09', 'L3-11'] as const
const R02_PRICE: { indicator: string; suffix?: string }[] = [
  { indicator: 'L4-01', suffix: '20' }, { indicator: 'L4-01', suffix: '60' },
  { indicator: 'L4-02', suffix: '20' }, { indicator: 'L4-02', suffix: '60' },
  { indicator: 'L4-03' }, { indicator: 'L4-04' },
]

/** 一只股票在 R-02 里的经营兑现线与价格预期线证据 */
export function memberEvidence(m: NodeMember, v: R02View | null, snap: { file: string; priceDate: string } | null, today: string): Evidence[] {
  const base = { node: m.node, code: m.code, name: m.name }
  const src = (field: string): SourceRef => ({ module: 'R-02', path: snap?.file ?? 'R-02 快照', field })
  if (!v || !snap) {
    const miss = (indicator: string, suffix?: string) => makeEvidence({
      ...base, indicator, suffix, kind: 'MEASURED', value: null, display: '缺', asOf: null,
      note: 'R-02 研究池未覆盖该股，没有该字段',
    }, today)
    return [...R02_OPERATING.map(i => miss(i)), ...R02_PRICE.map(p => miss(p.indicator, p.suffix))]
  }
  const q0 = v.quarters[0] ?? null
  const q1 = v.quarters[1] ?? null
  const bal = v.balanceYoy
  const out: Evidence[] = []
  const op = (indicator: string, value: number | null, display: string, asOf: string | null, field: string, extra: Partial<Spec> = {}) =>
    out.push(makeEvidence({ ...base, indicator, kind: 'MEASURED', value, display, asOf: value == null ? null : asOf, source: src(field), ...extra }, today))

  op('L3-01', v.latest?.revenueYoy ?? null, pctRaw(v.latest?.revenueYoy ?? null), v.latest?.reportDate ?? null, 'latest.revenueYoy',
    { changeBasis: '只有最新累计值，没有上期对照' })
  op('L3-02', q0?.netProfitYoy ?? null, pct(q0?.netProfitYoy ?? null), q0?.reportDate ?? null, 'quarters[0].netProfitYoy',
    { change: changeOf(q0?.netProfitYoy ?? null, q1?.netProfitYoy ?? null), changeBasis: q1 ? `对照上一季单季同比 ${pct(q1.netProfitYoy)}（${q1.reportDate}）` : null })
  op('L3-03', v.latest?.deductNetProfitYoy ?? null, pctRaw(v.latest?.deductNetProfitYoy ?? null), v.latest?.reportDate ?? null, 'latest.deductNetProfitYoy',
    { changeBasis: '只有最新累计值，没有上期对照' })
  op('L3-04', q0?.grossMargin ?? null, q0?.grossMargin == null ? '缺' : `${q0.grossMargin.toFixed(1)}%`, q0?.reportDate ?? null, 'quarters[0].grossMargin',
    { change: changeOf(q0?.grossMargin ?? null, q1?.grossMargin ?? null), changeBasis: q1?.grossMargin != null ? `对照上一季单季 ${q1.grossMargin.toFixed(1)}%（${q1.reportDate}）` : null })
  op('L3-05', v.cashConversion, v.cashConversion == null ? '缺' : `${v.cashConversion.toFixed(2)} 倍`, v.latest?.reportDate ?? null, 'cashConversion',
    { changeBasis: '累计口径，没有上期对照' })
  op('L3-06', bal?.contractLiab ?? null, pct(bal?.contractLiab ?? null), bal?.reportDate ?? null, 'balanceYoy.contractLiab')
  op('L3-07', bal?.inventory ?? null, pct(bal?.inventory ?? null), bal?.reportDate ?? null, 'balanceYoy.inventory')
  op('L3-08', bal?.receivables ?? null, pct(bal?.receivables ?? null), bal?.reportDate ?? null, 'balanceYoy.receivables')
  op('L3-09', v.consensusPace?.ratio ?? null, v.consensusPace?.ratio == null ? '缺' : `${v.consensusPace.ratio.toFixed(2)}（${v.consensusPace.basis}）`,
    v.latest?.reportDate ?? null, 'consensusPace.ratio', { note: '一致预期历史从 10/15 起才有快照，下修只能从此后比较' })
  op('L3-11', bal?.constructionInProgress ?? null, pct(bal?.constructionInProgress ?? null), bal?.reportDate ?? null, 'balanceYoy.constructionInProgress')

  const pr = (indicator: string, suffix: string | undefined, value: number | null, display: string, field: string) =>
    out.push(makeEvidence({
      ...base, indicator, suffix, kind: 'MEASURED', value, display, asOf: value == null ? null : snap.priceDate, source: src(field),
      change: value == null ? null : changeOf(value, 0), changeBasis: value == null ? null : '按数值符号（正为上升，负为下降）',
    }, today))
  pr('L4-01', '20', v.ret20, pct(v.ret20), 'ret20')
  pr('L4-01', '60', v.ret60, pct(v.ret60), 'ret60')
  pr('L4-02', '20', v.rs20, pct(v.rs20), 'rs20（相对沪深 300）')
  pr('L4-02', '60', v.rs60, pct(v.rs60), 'rs60（相对沪深 300）')
  out.push(makeEvidence({ ...base, indicator: 'L4-03', kind: 'MEASURED', value: v.drawdown250, display: pct(v.drawdown250), asOf: v.drawdown250 == null ? null : snap.priceDate, source: src('drawdown250') }, today))
  out.push(makeEvidence({
    ...base, indicator: 'L4-04', kind: 'MEASURED', value: v.pePercentile3y,
    display: v.pePercentile3y == null ? '缺' : `${(v.pePercentile3y * 100).toFixed(0)} 分位`, asOf: v.pePercentile3y == null ? null : snap.priceDate, source: src('pePercentile3y'),
  }, today))
  return out
}

export function moneyEvidence(m: NodeMember, money: RawInputs['money'], today: string): Evidence {
  const o = money?.objects.find(x => x.id === `stock:${m.code}`) ?? null
  return makeEvidence({
    indicator: 'L4-05', node: m.node, code: m.code, name: m.name, kind: 'MEASURED',
    value: o && o.dataStatus === 'OK' ? o.state : null,
    display: o && o.dataStatus === 'OK' ? `${o.stateText}（${o.state}）；背离 ${o.divergence}` : '缺',
    asOf: o ? money!.asOf : null,
    source: { module: 'R-01', path: money?.file ?? 'share/money/latest.json', field: `entries[].objects[id=stock:${m.code}]` },
    note: o ? '资金状态只改变研究优先级' : money ? 'R-01 名单里没有该股' : '没有 R-01 已发布文件',
  }, today)
}

/** 现有模块没有数据源的节点指标 */
export function nodeGapEvidence(node: NodeId, today: string): Evidence[] {
  return INDICATORS.filter(i => i.layer === 'L3' && i.source == null && i.nodes?.includes(node))
    .map(i => makeEvidence({ indicator: i.id, node, code: null, name: null, kind: 'MEASURED', value: null, display: '缺', asOf: null, note: i.dataSource }, today))
}

/** 背景层：宏观与资本开支只有委员会转录，原样引用 */
export function contextEvidence(today: string): Evidence[] {
  const out: Evidence[] = []
  const t = (indicator: string, suffix: string, display: string, asOf: string | null, source: SourceRef, note: string | null = null) =>
    out.push(makeEvidence({ indicator, suffix, node: null, code: null, name: null, kind: 'TRANSCRIBED', value: display, display, asOf, source, note }, today))
  const miss = (indicator: string, note: string) =>
    out.push(makeEvidence({ indicator, node: null, code: null, name: null, kind: 'MEASURED', value: null, display: '缺', asOf: null, note }, today))

  READINGS.filter(r => r.item.includes('10Y')).forEach((r, i) =>
    t('L1-01', `M01-${i + 1}`, `${r.item}：${r.value}`, '2026-09-22', { module: 'M-01', path: 'backend/src/services/research/macroRiskLights.ts', field: `READINGS[item=${r.item}]` }, r.status))
  miss('L1-02', '现有模块没有美元指数')
  miss('L1-03', 'M-01 无通胀与政策预期数值')

  const fq = buildAiFinancingQualityView()
  const fqPath = 'backend/src/services/research/aiFinancingQuality.ts'
  const notes = fq.firstJudgment.bondIssuance.committeeNotes
  const spread = notes.find(n => n.includes('利差'))
  if (spread) t('L1-04', 'F01', spread, null, { module: 'F-01', path: fqPath, field: 'firstJudgment.bondIssuance.committeeNotes' }, '转录日期未在模块中单独登记；不是利差序列')
  else miss('L1-04', 'F-01 没有利差转录')
  const obs = (item: string) => fq.observationTable.find(r => r.item === item)
  const OBS = [['L1-05', 'AI相关债务融资'], ['L1-05', '融资成本'], ['L2-01', 'Hyperscaler CapEx'], ['L2-03', 'FCF'], ['L2-03', 'AI CapEx ROI'], ['L2-03', 'AI收入兑现']] as const
  for (const [indicator, item] of OBS) {
    const r = obs(item)
    const n = OBS.filter(o => o[0] === indicator).findIndex(o => o[1] === item) + 1
    if (r) t(indicator, `F01-${n}`, `${r.item}：${r.state}`, null, { module: 'F-01', path: fqPath, field: `observationTable[item=${r.item}]` }, `来源状态 ${r.sourceStatus}；定性观察，不是数值`)
  }
  const capex = notes.find(n => n.includes('资本开支指引'))
  if (capex) t('L2-01', 'F01-G', capex, null, { module: 'F-01', path: fqPath, field: 'firstJudgment.bondIssuance.committeeNotes' })

  DEMAND_EVIDENCE.forEach((d, i) =>
    t('L2-02', `C01-${i + 1}`, `${d.item}：${d.figure}`, '2026-09-20', { module: 'C-01', path: 'backend/src/services/research/capexLadder.ts', field: `DEMAND_EVIDENCE[item=${d.item}]` }, `${d.sourceStatus}；${d.note}`))

  const fa = buildAiFourActsView()
  fa.facts.nvidiaEarnings.committeeNotes.forEach((n, i) =>
    t('L2-04', `A01-${i + 1}`, n, null, { module: 'A-01', path: 'backend/src/services/research/aiFourActs.ts', field: 'facts.nvidiaEarnings.committeeNotes' }, fa.facts.nvidiaEarnings.sourceStatus))

  miss('L4-06', '现有模块没有 NVDA、AVGO 行情')
  const breadth = SESSION_CHECKS.find(c => c.item === 'Breadth Quality')
  out.push(makeEvidence({
    indicator: 'L4-07', suffix: 'B01', node: null, code: null, name: null, kind: 'MEASURED', value: null, display: '缺',
    asOf: null, source: { module: 'B-01', path: 'backend/src/services/research/marketStructureWatch.ts', field: 'SESSION_CHECKS[item=Breadth Quality]' },
    note: breadth ? `${breadth.status}：${breadth.current}` : 'B-01 没有广度检查',
  }, today))
  READINGS.filter(r => r.item.includes('新高新低')).forEach((r, i) =>
    t('L4-07', `M01-${i + 1}`, `${r.item}：${r.value}`, '2026-09-22', { module: 'M-01', path: 'backend/src/services/research/macroRiskLights.ts', field: `READINGS[item=${r.item}]` }, `美股广度，不是 A 股；${r.status}`))
  return out
}

const pctOf = (line: string | null, re: RegExp): number | null => {
  const m = line?.match(re)
  return m ? +m[1]! / 100 : null
}

/** 组合层：只引用执行单、名单主表风险块、账本的现成结果，不显示金额 */
export function portfolioEvidence(raw: RawInputs, nodeOfCode: (code: string) => NodeId | null): Evidence[] {
  const { today, card, ladderRisk, portfolio } = raw
  const out: Evidence[] = []
  const cardSrc = (field: string): SourceRef => ({ module: '执行单', path: card?.file ?? 'share/decision/latest.md', field })
  const dd = pctOf(card?.circuit ?? null, /自峰值回撤\s*([\d.]+)%/)
  const level = card?.circuit?.match(/达(一级|二级)线/)?.[1] ?? null
  out.push(makeEvidence({
    indicator: 'L5-01', node: null, code: null, name: null, kind: 'MEASURED', value: dd,
    display: dd == null ? '缺' : `自峰值回撤 ${(dd * 100).toFixed(1)}%${level ? `，按待核验峰值计达${level}线` : ''}`,
    asOf: card?.marketDate ?? null, source: cardSrc('「熔断：」行'), note: '只卖不买由执行单执行；峰值待核验，熔断补足不执行、不撤销',
  }, today))
  const cash = pctOf(card?.account ?? null, /现金\s*([\d.]+)%/)
  const stock = pctOf(card?.account ?? null, /股票\s*([\d.]+)%/)
  out.push(makeEvidence({
    indicator: 'L5-02', node: null, code: null, name: null, kind: 'MEASURED', value: cash,
    display: cash == null ? '缺' : `现金 ${(cash * 100).toFixed(1)}%，股票 ${stock == null ? '缺' : `${(stock * 100).toFixed(1)}%`}`,
    asOf: card?.marketDate ?? null, source: cardSrc('「账户：」行'),
  }, today))
  const priced = ladderRisk?.risk.pricedAt.slice(0, 10) ?? null
  const riskSrc = (field: string): SourceRef => ({ module: 'L-01', path: ladderRisk?.file ?? 'share/ladder/latest.json', field })
  const seen = new Set<string>()
  for (const s of ladderRisk?.risk.sectors ?? []) {
    for (const h of s.holdings) {
      if (seen.has(h.code)) continue
      seen.add(h.code)
      out.push(makeEvidence({
        indicator: 'L5-03', node: nodeOfCode(h.code), code: h.code, name: h.name, kind: 'MEASURED', value: h.pct,
        display: `${h.name} ${(h.pct * 100).toFixed(1)}%（上限 12%）`, asOf: priced, source: riskSrc(`risk.sectors[label=${s.label}].holdings[code=${h.code}].pct`),
      }, today))
    }
  }
  for (const [kind, rows] of [['板块', ladderRisk?.risk.sectors ?? []], ['主题', ladderRisk?.risk.themes ?? []]] as const) {
    for (const s of rows) {
      out.push(makeEvidence({
        indicator: 'L5-04', suffix: `${kind}-${s.label}`, node: null, code: null, name: null, kind: 'MEASURED', value: s.pct,
        display: `${kind}「${s.label}」${(s.pct * 100).toFixed(1)}%（上限 ${(s.limit * 100).toFixed(0)}%${s.pct > s.limit ? `，超出 ${((s.pct - s.limit) * 100).toFixed(1)} 个百分点，只显示` : ''}）`,
        asOf: priced, source: riskSrc(`risk.${kind === '板块' ? 'sectors' : 'themes'}[label=${s.label}].pct`),
        note: s.pct > s.limit ? '不是豁免；单票归位不等于板块风险解决' : null,
      }, today))
    }
  }
  if (!ladderRisk) out.push(makeEvidence({ indicator: 'L5-03', node: null, code: null, name: null, kind: 'MEASURED', value: null, display: '缺', asOf: null, note: '没有名单主表风险块' }, today))
  out.push(makeEvidence({
    indicator: 'L5-05', node: null, code: null, name: null, kind: 'MEASURED',
    value: portfolio ? `${portfolio.pendingSells}/${portfolio.peakVerified}` : null,
    display: portfolio ? `执行债务 ${portfolio.pendingSells} 条；峰值${portfolio.peakVerified ? '已' : '待'}核验` : '缺',
    asOf: portfolio?.asOf ?? null, availability: portfolio ? (daysBetween(portfolio.asOf, today) > DAILY_STALE_DAYS ? 'STALE' : 'AVAILABLE') : 'MISSING',
    source: { module: '账本', path: portfolio?.file ?? 'backend/src/services/cockpit/data/portfolio.json', field: 'pendingSells / peakVerified' },
    note: '账本日期即持仓截图日期',
  }, today))
  out.push(makeEvidence({
    indicator: 'L5-06', node: null, code: null, name: null, kind: 'MEASURED', value: null, display: '缺', asOf: null,
    note: 'TPO 诊断只在驾驶舱页面与 SHARE=1 的 CSV 中出现，未落盘到仓库',
  }, today))
  return out
}

// ── 读取已发布文件 ──

const R02_DIR = 'backend/src/services/research/data/rerating'

function latestR02(root: string): { file: string; asOf: string; priceDate: string; views: R02View[] }[] {
  const dir = join(root, R02_DIR)
  if (!existsSync(dir)) return []
  const files = readdirSync(dir).filter(f => /^\d{4}-\d{2}-\d{2}(-next)?\.json$/.test(f)).sort()
  const latest = files.map(f => f.slice(0, 10)).sort().at(-1)
  if (!latest) return []
  return files.filter(f => f.startsWith(latest)).map(f => {
    const j = JSON.parse(readFileSync(join(dir, f), 'utf8'))
    const quotes = Object.values(j.quoteTime ?? {}) as string[]
    const q = quotes.sort().at(-1)
    const priceDate = q && /^\d{8}/.test(q) ? `${q.slice(0, 4)}-${q.slice(4, 6)}-${q.slice(6, 8)}` : j.asOf
    return { file: `${R02_DIR}/${f}`, asOf: j.asOf, priceDate, views: j.views as R02View[] }
  })
}

function readJson(root: string, rel: string): any | null {
  const p = join(root, rel)
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null
}

export function loadInputs(root: string, today: string): RawInputs {
  const moneyJ = readJson(root, 'share/money/latest.json')
  const ladderJ = readJson(root, 'share/ladder/latest.json')
  const pfRel = 'backend/src/services/cockpit/data/portfolio.json'
  const pfJ = readJson(root, pfRel)
  const cardRel = 'share/decision/latest.md'
  const cardText = existsSync(join(root, cardRel)) ? readFileSync(join(root, cardRel), 'utf8') : null
  const line = (prefix: string) => cardText?.split('\n').find(l => l.startsWith(prefix)) ?? null
  const factsJ = readJson(root, 'backend/src/services/cycle/data/facts.json')
  return {
    today,
    rerating: latestR02(root),
    money: moneyJ ? {
      file: 'share/money/latest.json', asOf: moneyJ.asOf,
      objects: (moneyJ.entries as { objects: MoneyObject[] }[]).flatMap(e => e.objects),
    } : null,
    ladderRisk: ladderJ?.risk ? { file: 'share/ladder/latest.json', risk: ladderJ.risk } : null,
    portfolio: pfJ ? { file: pfRel, asOf: pfJ.asOf, pendingSells: pfJ.pendingSells, peakVerified: pfJ.peakVerified } : null,
    card: cardText ? {
      file: cardRel,
      marketDate: cardText.match(/市场日期[^：]*：(\d{4}-\d{2}-\d{2})/)?.[1] ?? null,
      account: line('账户：'), circuit: line('熔断：'),
    } : null,
    facts: factsJ?.entries ?? [],
  }
}

export { NODE_ORDER, nodeMembers }
