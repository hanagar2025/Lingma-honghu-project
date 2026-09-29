/**
 * 资金驾驶舱（R-01）· 资金信号时效检验
 *
 *   npm run money:leadlag
 *
 * 回答两个问题：
 *   ① 资金信号是"领先价格"还是"跟着价格走"？领先的话领先多少天、多久衰减完？
 *   ② 按"数据什么时候真正拿得到"来算，结论还站得住吗？
 *
 * 做法（事先写死，不按结果挑窗口）：
 *   · 每个交易日，在一个股票池里横截面地比较"资金信号"和"前后各段超额收益（相对两市基准）"的秩相关（IC）；
 *     过去窗口的 IC 衡量"资金跟随价格"，未来窗口的 IC 衡量"资金领先价格"。
 *   · 未来收益一律从 T+1 收盘起算：成交额 T 日 16:30 定稿、融资余额 T+1 早上才发布，T 日收盘价买不到。
 *     另算一列"从 T 日收盘起算"，两者之差就是回测里如果按 T 日收盘对齐会多算的隔夜偏差。
 *   · 均值的置信区间用连续 20 日为一块的块自助抽样 —— 相邻交易日的 20 日收益高度重叠，逐日独立抽样会让区间假性变窄。
 *   · 前后两半分别算一次，方向不一致的结论不采信。
 *
 * 只登记证据，不改冻结阈值，不产生任何动作。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { excessReturn } from './backtest'
import { stockObject } from './config'
import { computeMetrics, rawSeries, rollingMean, type Num } from './metrics'
import type { SlowEvidence } from './slowMoney'
import type { DataSet, MoneyObject } from './types'

const HERE = dirname(fileURLToPath(import.meta.url))
export const LEADLAG_DIR = join(HERE, 'data', 'leadlag')

// ─────────────────────────── 事先登记 ───────────────────────────

export const LEADLAG_REGISTERED_ON = '2026-09-24'

export type SignalId = 'A1_ACCEL' | 'A1_LEVEL' | 'A2_MARGIN'

export const SIGNALS: Record<SignalId, { grade: 'A1' | 'A2'; text: string; knownAt: string }> = {
  A1_ACCEL: { grade: 'A1', text: '短期放量：成交占比 5 日均 ÷ 20 日均', knownAt: 'T 日 16:30' },
  A1_LEVEL: { grade: 'A1', text: '资金集中度：成交占比 20 日均 ÷ 自身 250 日水位', knownAt: 'T 日 16:30' },
  A2_MARGIN: { grade: 'A2', text: '融资余额 5 日变化率', knownAt: 'T+1 日 08:30' },
}

export type WindowId = 'P20' | 'P5' | 'F0_20' | 'F1_5' | 'F6_10' | 'F11_20' | 'F21_40' | 'F41_60' | 'F1_20' | 'F1_60'

/** 收益区间 [t+a, t+b]（收盘到收盘） */
export const WINDOWS: Record<WindowId, { a: number; b: number; text: string }> = {
  P20: { a: -20, b: 0, text: '过去 20 日' },
  P5: { a: -5, b: 0, text: '过去 5 日' },
  F0_20: { a: 0, b: 20, text: 'T 收盘起 20 日（含买不到的隔夜）' },
  F1_5: { a: 1, b: 6, text: '第 1–5 日' },
  F6_10: { a: 6, b: 11, text: '第 6–10 日' },
  F11_20: { a: 11, b: 21, text: '第 11–20 日' },
  F21_40: { a: 21, b: 41, text: '第 21–40 日' },
  F41_60: { a: 41, b: 61, text: '第 41–60 日' },
  F1_20: { a: 1, b: 21, text: '之后 20 日' },
  F1_60: { a: 1, b: 61, text: '之后 60 日' },
}

const DECAY: WindowId[] = ['F1_5', 'F6_10', 'F11_20', 'F21_40', 'F41_60']

export type UniverseId = 'ALL' | 'STAR' | 'CHINEXT' | 'TECH' | 'INDUSTRY'

export const UNIVERSES: Record<UniverseId, string> = {
  ALL: '沪深全部个股（剔除 ST）',
  STAR: '科创板',
  CHINEXT: '创业板',
  TECH: '科技（申万电子、通信、计算机下属二级行业成分）',
  INDUSTRY: '申万二级行业',
}

/** 申万一级"电子、通信、计算机"下属的二级行业 */
export const TECH_L2 = new Set([
  '半导体', '元件', '光学光电子', '消费电子', '其他电子Ⅱ', '电子化学品Ⅱ',
  '通信设备', '通信服务', '计算机设备', '软件开发', 'IT服务Ⅱ',
])

export const MIN_CROSS_SECTION = 30
export const BLOCK_DAYS = 20

// ─────────────────────────── 统计工具 ───────────────────────────

export function ranks(xs: readonly number[]): number[] {
  const idx = xs.map((v, i) => [v, i] as const).sort((p, q) => p[0] - q[0])
  const r = new Array<number>(xs.length)
  for (let i = 0; i < idx.length;) {
    let j = i
    while (j + 1 < idx.length && idx[j + 1]![0] === idx[i]![0]) j++
    const avg = (i + j) / 2 + 1
    for (let k = i; k <= j; k++) r[idx[k]![1]] = avg
    i = j + 1
  }
  return r
}

export function pearson(x: readonly number[], y: readonly number[]): number | null {
  const n = x.length
  if (n < 3) return null
  let mx = 0; let my = 0
  for (let i = 0; i < n; i++) { mx += x[i]!; my += y[i]! }
  mx /= n; my /= n
  let sxy = 0; let sxx = 0; let syy = 0
  for (let i = 0; i < n; i++) {
    const dx = x[i]! - mx; const dy = y[i]! - my
    sxy += dx * dy; sxx += dx * dx; syy += dy * dy
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null
}

export function spearman(x: readonly number[], y: readonly number[]): number | null {
  return x.length < 3 ? null : pearson(ranks(x), ranks(y))
}

/** 连续块自助抽样的均值 95% 区间。确定性随机数，结果可复现 */
export function blockBootstrap(xs: readonly number[], block = BLOCK_DAYS, iters = 2000, seed = 20260924): [number, number] | null {
  const n = xs.length
  if (n < block * 2) return null
  let s = seed
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647 }
  const means: number[] = []
  const blocks = Math.ceil(n / block)
  for (let it = 0; it < iters; it++) {
    let sum = 0; let cnt = 0
    for (let b = 0; b < blocks; b++) {
      const start = Math.floor(rnd() * (n - block + 1))
      for (let k = 0; k < block && cnt < n; k++) { sum += xs[start + k]!; cnt++ }
    }
    means.push(sum / cnt)
  }
  means.sort((a, b) => a - b)
  return [means[Math.floor(iters * 0.025)]!, means[Math.floor(iters * 0.975)]!]
}

const mean = (xs: readonly number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)

// ─────────────────────────── 面板 ───────────────────────────

export interface Panel {
  universe: UniverseId
  ids: string[]
  close: Num[][]
  /** 当日是否有成交（停牌日买不进） */
  traded: boolean[][]
  signals: Record<SignalId, Num[][]>
}

function signalSeries(obj: MoneyObject, ds: DataSet, mkt: readonly Num[]): { close: Num[]; traded: boolean[]; sig: Record<SignalId, Num[]> } {
  const raw = rawSeries(obj, ds)
  const ms = computeMetrics(raw, mkt)
  const s5 = rollingMean(raw.share, 5)
  const s20 = rollingMean(raw.share, 20)
  const n = ds.dates.length
  const accel: Num[] = []
  const level: Num[] = []
  const margin: Num[] = []
  for (let t = 0; t < n; t++) {
    const a = s5[t] ?? null
    const b = s20[t] ?? null
    accel.push(a !== null && b !== null && a > 0 && b > 0 ? Math.log(a / b) : null)
    const med = ms[t]?.basis === 'FULL' ? ms[t]!.median : null
    level.push(b !== null && med !== null && b > 0 && med > 0 ? Math.log(b / med) : null)
    const m1 = raw.margin[t] ?? null
    const m0 = t >= 5 ? raw.margin[t - 5] ?? null : null
    margin.push(m1 !== null && m0 !== null && m0 >= 1e7 ? m1 / m0 - 1 : null)
  }
  return {
    close: raw.close,
    traded: raw.amount.map(v => v !== null && v > 0),
    sig: { A1_ACCEL: accel, A1_LEVEL: level, A2_MARGIN: margin },
  }
}

export function buildPanel(universe: UniverseId, objs: readonly MoneyObject[], ds: DataSet): Panel {
  const mkt = ds.market.map(d => d.totalAmount)
  const p: Panel = { universe, ids: [], close: [], traded: [], signals: { A1_ACCEL: [], A1_LEVEL: [], A2_MARGIN: [] } }
  for (const o of objs) {
    const s = signalSeries(o, ds, mkt)
    p.ids.push(o.id)
    p.close.push(s.close)
    p.traded.push(s.traded)
    for (const k of Object.keys(SIGNALS) as SignalId[]) p.signals[k].push(s.sig[k])
  }
  return p
}

/** 慢钱层用的三个分组（代码集合） */
export function slowGroups(ds: DataSet, names: Record<string, string>, boardOf: Record<string, string>): Record<'ALL' | 'STAR' | 'TECH', { text: string; codes: string[] }> {
  const all = Object.keys(ds.stocks).filter(c => !/ST/i.test(names[c] ?? ''))
  return {
    STAR: { text: UNIVERSES.STAR, codes: all.filter(c => c.startsWith('688')) },
    TECH: { text: UNIVERSES.TECH, codes: all.filter(c => TECH_L2.has(boardOf[c] ?? '')) },
    ALL: { text: UNIVERSES.ALL, codes: all },
  }
}

export function universeObjects(
  ds: DataSet, names: Record<string, string>, boardOf: Record<string, string>,
  industries: readonly MoneyObject[],
): Record<UniverseId, MoneyObject[]> {
  const stocks = Object.keys(ds.stocks)
    .filter(c => !/ST/i.test(names[c] ?? ''))
    .map(c => stockObject(c, names[c] ?? c, 3))
  return {
    ALL: stocks,
    STAR: stocks.filter(o => o.codes[0]!.startsWith('688')),
    CHINEXT: stocks.filter(o => /^30[01]/.test(o.codes[0]!)),
    TECH: stocks.filter(o => TECH_L2.has(boardOf[o.codes[0]!] ?? '')),
    INDUSTRY: [...industries],
  }
}

// ─────────────────────────── 横截面 IC ───────────────────────────

export interface IcStat {
  window: WindowId
  /** 参与的交易日数 */
  days: number
  /** 平均横截面宽度 */
  width: number
  ic: number | null
  ci: [number, number] | null
  /** 前一半 / 后一半交易日的平均 IC */
  halves: [number | null, number | null]
}

export interface SpreadStat {
  /** 信号最强 1/5 减最弱 1/5 的之后 20 日平均超额收益 */
  mean: number | null
  ci: [number, number] | null
  /** 最强 1/5、最弱 1/5 各自的之后 20 日平均超额收益 */
  top: number | null
  bottom: number | null
}

export type LeadVerdict = 'LEADS_SAME' | 'LEADS_REVERSE' | 'NO_LEAD' | 'UNSTABLE' | 'INSUFFICIENT'

export const LEAD_VERDICT_TEXT: Record<LeadVerdict, string> = {
  LEADS_SAME: '领先·同向（资金越热，之后越强）',
  LEADS_REVERSE: '领先·反向（资金越热，之后越弱）',
  NO_LEAD: '不领先（之后 20 日无显著关系）',
  UNSTABLE: '前后两半方向相反，不采信',
  INSUFFICIENT: '样本不足',
}

export type FollowVerdict = 'FOLLOWS' | 'FOLLOWS_REVERSE' | 'INDEPENDENT'

export const FOLLOW_VERDICT_TEXT: Record<FollowVerdict, string> = {
  FOLLOWS: '跟随价格（过去涨得多，资金信号就热）',
  FOLLOWS_REVERSE: '逆价格（过去跌得多，资金信号反而热）',
  INDEPENDENT: '与过去价格无显著关系',
}

export interface SignalResult {
  universe: UniverseId
  signal: SignalId
  windows: IcStat[]
  spread20: SpreadStat
  /** F0_20 − F1_20：按 T 日收盘对齐会多算的 IC */
  overnightBias: number | null
  /** 衰减曲线里 |IC| 最大的那一段 */
  peak: WindowId | null
  follow: FollowVerdict
  lead: LeadVerdict
}

function ciExcludesZero(ci: [number, number] | null): 1 | -1 | 0 {
  if (!ci) return 0
  return ci[0] > 0 ? 1 : ci[1] < 0 ? -1 : 0
}

export function studySignal(p: Panel, sig: SignalId, ds: DataSet): SignalResult {
  const bench = ds.market.map(d => d.close ?? null)
  const n = ds.dates.length
  const X = p.signals[sig]
  const windows: IcStat[] = []
  const spreadDaily: number[] = []
  const topDaily: number[] = []
  const botDaily: number[] = []

  for (const wid of Object.keys(WINDOWS) as WindowId[]) {
    const w = WINDOWS[wid]
    const ics: number[] = []
    let width = 0
    for (let t = 0; t < n; t++) {
      if (t + w.a < 0 || t + w.b >= n) continue
      const xs: number[] = []
      const ys: number[] = []
      for (let i = 0; i < p.ids.length; i++) {
        const x = X[i]![t] ?? null
        if (x === null) continue
        if (w.a > 0 && !p.traded[i]![t + w.a]) continue
        const y = excessReturn(p.close[i]!, bench, t + w.a, w.b - w.a)
        if (y === null) continue
        xs.push(x); ys.push(y)
      }
      if (xs.length < MIN_CROSS_SECTION) continue
      const ic = spearman(xs, ys)
      if (ic === null) continue
      ics.push(ic)
      width += xs.length
      if (wid === 'F1_20') {
        const order = xs.map((_, i) => i).sort((a, b) => xs[a]! - xs[b]!)
        const q = Math.floor(order.length / 5)
        const top = mean(order.slice(-q).map(i => ys[i]!))!
        const bot = mean(order.slice(0, q).map(i => ys[i]!))!
        spreadDaily.push(top - bot); topDaily.push(top); botDaily.push(bot)
      }
    }
    const half = Math.floor(ics.length / 2)
    windows.push({
      window: wid, days: ics.length, width: ics.length ? width / ics.length : 0,
      ic: mean(ics), ci: blockBootstrap(ics),
      halves: [mean(ics.slice(0, half)), mean(ics.slice(half))],
    })
  }

  const get = (id: WindowId) => windows.find(x => x.window === id)!
  const past = get('P20')
  const fwd = get('F1_20')
  const f0 = get('F0_20')
  const follow: FollowVerdict = ciExcludesZero(past.ci) === 1 ? 'FOLLOWS' : ciExcludesZero(past.ci) === -1 ? 'FOLLOWS_REVERSE' : 'INDEPENDENT'
  let lead: LeadVerdict
  if (fwd.days < BLOCK_DAYS * 2) lead = 'INSUFFICIENT'
  else {
    const s = ciExcludesZero(fwd.ci)
    const [h1, h2] = fwd.halves
    if (s !== 0 && h1 !== null && h2 !== null && Math.sign(h1) !== Math.sign(h2)) lead = 'UNSTABLE'
    else lead = s === 1 ? 'LEADS_SAME' : s === -1 ? 'LEADS_REVERSE' : 'NO_LEAD'
  }
  let peak: WindowId | null = null
  for (const id of DECAY) {
    const v = get(id).ic
    if (v !== null && (peak === null || Math.abs(v) > Math.abs(get(peak).ic ?? 0))) peak = id
  }
  return {
    universe: p.universe, signal: sig, windows,
    spread20: { mean: mean(spreadDaily), ci: blockBootstrap(spreadDaily), top: mean(topDaily), bottom: mean(botDaily) },
    overnightBias: f0.ic !== null && fwd.ic !== null ? f0.ic - fwd.ic : null,
    peak, follow, lead,
  }
}

// ─────────────────────────── 大盘时序（择时） ───────────────────────────

export interface TimingResult {
  signal: 'MKT_AMOUNT' | 'MKT_MARGIN'
  text: string
  knownAt: string
  /** 与过去 20 日基准收益的相关 */
  past: { r: number | null; ci: [number, number] | null }
  /** 与之后 20 日（T+1 收盘起）基准收益的相关 */
  fwd: { r: number | null; ci: [number, number] | null }
  /** 独立的 20 日区间个数 —— 大盘只有一条序列，这才是真实样本量 */
  independent: number
}

/** 时序相关的区间：按连续块对 (x, y) 成对抽样 */
function blockBootstrapCorr(x: readonly number[], y: readonly number[], block = BLOCK_DAYS, iters = 2000, seed = 20260924): [number, number] | null {
  const n = x.length
  if (n < block * 3) return null
  let s = seed
  const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647 }
  const rs: number[] = []
  for (let it = 0; it < iters; it++) {
    const bx: number[] = []
    const by: number[] = []
    while (bx.length < n) {
      const st = Math.floor(rnd() * (n - block + 1))
      for (let k = 0; k < block && bx.length < n; k++) { bx.push(x[st + k]!); by.push(y[st + k]!) }
    }
    const r = pearson(bx, by)
    if (r !== null) rs.push(r)
  }
  rs.sort((a, b) => a - b)
  return rs.length ? [rs[Math.floor(rs.length * 0.025)]!, rs[Math.floor(rs.length * 0.975)]!] : null
}

export function studyTiming(ds: DataSet): TimingResult[] {
  const bench = ds.market.map(d => d.close ?? null)
  const amt = ds.market.map(d => d.totalAmount)
  const a5 = rollingMean(amt, 5)
  const a60 = rollingMean(amt, 60)
  const mg = ds.market.map(d => d.marginTotal)
  const n = ds.dates.length
  const defs = [
    { signal: 'MKT_AMOUNT' as const, text: '两市成交额 5 日均 ÷ 60 日均', knownAt: 'T 日 16:30',
      x: (t: number) => { const a = a5[t] ?? null; const b = a60[t] ?? null; return a !== null && b !== null && b > 0 ? Math.log(a / b) : null } },
    { signal: 'MKT_MARGIN' as const, text: '全市场融资余额 5 日变化率', knownAt: 'T+1 日 08:30',
      x: (t: number) => { const a = mg[t] ?? null; const b = t >= 5 ? mg[t - 5] ?? null : null; return a !== null && b !== null && b > 0 ? a / b - 1 : null } },
  ]
  const ret = (a: number, b: number): number | null => {
    const p0 = bench[a] ?? null; const p1 = bench[b] ?? null
    return a >= 0 && b < n && p0 !== null && p1 !== null && p0 > 0 ? p1 / p0 - 1 : null
  }
  return defs.map(d => {
    const px: number[] = []; const py: number[] = []
    const fx: number[] = []; const fy: number[] = []
    for (let t = 0; t < n; t++) {
      const x = d.x(t)
      if (x === null) continue
      const yp = ret(t - 20, t)
      if (yp !== null) { px.push(x); py.push(yp) }
      const yf = ret(t + 1, t + 21)
      if (yf !== null) { fx.push(x); fy.push(yf) }
    }
    return {
      signal: d.signal, text: d.text, knownAt: d.knownAt,
      past: { r: pearson(px, py), ci: blockBootstrapCorr(px, py) },
      fwd: { r: pearson(fx, fy), ci: blockBootstrapCorr(fx, fy) },
      independent: Math.floor(fx.length / 20),
    }
  })
}

// ─────────────────────────── 报告 ───────────────────────────

export interface EventDelayRow {
  rule: string
  horizon: number
  n: number
  /** 按 T 日收盘起算（原校准口径） */
  meanT0: number | null
  /** 按 T+1 收盘起算（实际能成交的口径） */
  meanT1: number | null
  ciT1: [number, number] | null
  verdictT0: string
  verdictT1: string
}

export interface LeadLagReport {
  id: 'R-01-leadlag'
  registeredOn: string
  runOn: string
  dataThrough: string
  period: [string, string]
  signals: typeof SIGNALS
  universes: Record<UniverseId, { text: string; size: number }>
  results: SignalResult[]
  timing: TimingResult[]
  /** 冻结规则事件研究：T 日收盘起算 vs T+1 收盘起算 */
  eventDelay: EventDelayRow[]
  /** 慢钱：ETF 申赎、基金持仓、股东户数 */
  slow?: SlowEvidence
  conclusion: string[]
}

export function loadLatestLeadLag(): LeadLagReport | null {
  const p = join(LEADLAG_DIR, 'latest.json')
  if (!existsSync(p)) return null
  try { return JSON.parse(readFileSync(p, 'utf-8')) as LeadLagReport } catch { return null }
}

export function saveLeadLag(r: LeadLagReport): string {
  mkdirSync(LEADLAG_DIR, { recursive: true })
  const body = `${JSON.stringify(r, null, 2)}\n`
  const file = join(LEADLAG_DIR, `${r.runOn}.json`)
  writeFileSync(file, body, 'utf-8')
  writeFileSync(join(LEADLAG_DIR, 'latest.json'), body, 'utf-8')
  return file
}

const f3 = (v: number | null) => (v === null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(3)}`)
const pct = (v: number | null, d = 2) => (v === null ? '—' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(d)}%`)
const ci3 = (c: [number, number] | null) => (c ? `[${f3(c[0])}, ${f3(c[1])}]` : '—')

export function renderLeadLag(r: LeadLagReport): string {
  const L: string[] = ['', `资金驾驶舱 · 资金信号时效检验（${r.runOn}，数据 ${r.period[0]} ~ ${r.period[1]}）`, '─'.repeat(110)]
  L.push('  IC = 当日横截面秩相关（资金信号 vs 该段超额收益），逐日取平均；区间为 20 日块自助抽样 95%。未来收益从 T+1 收盘起算。')
  for (const u of Object.keys(r.universes) as UniverseId[]) {
    L.push('', `  ── ${r.universes[u].text}（${r.universes[u].size} 个）──`)
    for (const s of r.results.filter(x => x.universe === u)) {
      const w = (id: WindowId) => s.windows.find(x => x.window === id)!
      L.push(`  ${SIGNALS[s.signal].text}（${SIGNALS[s.signal].knownAt}可得）`)
      L.push(`    过去20日 ${f3(w('P20').ic)}　| 之后：1–5 ${f3(w('F1_5').ic)}　6–10 ${f3(w('F6_10').ic)}　11–20 ${f3(w('F11_20').ic)}　21–40 ${f3(w('F21_40').ic)}　41–60 ${f3(w('F41_60').ic)}`)
      L.push(`    之后20日 IC ${f3(w('F1_20').ic)} ${ci3(w('F1_20').ci)}　前后两半 ${f3(w('F1_20').halves[0])} / ${f3(w('F1_20').halves[1])}　之后60日 ${f3(w('F1_60').ic)}　隔夜偏差 ${f3(s.overnightBias)}`)
      L.push(`    最强1/5 ${pct(s.spread20.top)}　最弱1/5 ${pct(s.spread20.bottom)}　差 ${pct(s.spread20.mean)}（20 日）`)
      L.push(`    → ${FOLLOW_VERDICT_TEXT[s.follow]}；${LEAD_VERDICT_TEXT[s.lead]}`)
    }
  }
  L.push('', '  ── 大盘择时（时序，只有一条序列）──')
  for (const t of r.timing) {
    L.push(`  ${t.text}（${t.knownAt}可得）：与过去20日 r=${f3(t.past.r)} ${ci3(t.past.ci)}；与之后20日 r=${f3(t.fwd.r)} ${ci3(t.fwd.ci)}；独立样本约 ${t.independent} 段`)
  }
  L.push('', '  ── 冻结规则：T 日收盘起算 vs T+1 收盘起算（样本外）──')
  for (const e of r.eventDelay) {
    L.push(`  ${e.rule.padEnd(13)}${String(e.horizon).padStart(3)} 日 n=${String(e.n).padEnd(5)} T日 ${pct(e.meanT0).padEnd(9)} T+1 ${pct(e.meanT1).padEnd(9)} 区间 ${e.ciT1 ? `[${pct(e.ciT1[0])}, ${pct(e.ciT1[1])}]` : '—'}　${e.verdictT0 === e.verdictT1 ? e.verdictT1 : `${e.verdictT0} → ${e.verdictT1}`}`)
  }
  if (r.slow) {
    L.push('', '  ── 慢钱：科创系 ETF 申赎（时序，20 日净申赎占规模）──')
    for (const e of r.slow.etfTiming) {
      L.push(`  ${e.name.padEnd(6)} 与过去20日超额 r=${f3(e.past.r)} ${ci3(e.past.ci)}；与之后20日 r=${f3(e.fwd.r)} ${ci3(e.fwd.ci)}；独立样本约 ${e.independent} 段`)
    }
    L.push('', '  ── 慢钱：基金持仓变化、股东户数（横截面，可得日次一交易日起 60 日）──')
    for (const c of r.slow.cross) {
      L.push(`  ${c.text}（${c.universe}）：${c.rows.length} 期　之后60日 IC ${f3(c.meanFwdIc)}（为正 ${c.positive[0]}/${c.positive[1]}）　最强1/5−最弱1/5 ${pct(c.meanSpread)}　形成期间 IC ${f3(c.meanPastIc)}`)
      for (const x of c.rows) L.push(`      ${x.period}（${x.availableOn} 可得，n=${x.n}）过去 ${f3(x.pastIc)}　之后 ${f3(x.fwdIc)}　差 ${pct(x.spread)}`)
    }
    L.push('', '  ── 慢钱结论 ──', ...r.slow.conclusion.map(c => `  · ${c}`))
  }
  L.push('', '  ── 结论 ──', ...r.conclusion.map(c => `  · ${c}`))
  L.push('', `  战术一句话：${tacticalVerdict(r)}`)
  return L.join('\n')
}

/**
 * 战术层面的一句话：资金变化能不能拿来定"何时进、何时出"。
 * 由检验结果按规则生成，数字变了结论跟着变，不是手写的。
 */
export function tacticalVerdict(r: Pick<LeadLagReport, 'results' | 'timing' | 'eventDelay'>): string {
  const core = r.results.filter(x => x.universe !== 'INDUSTRY')
  const leadsSame = core.filter(x => x.lead === 'LEADS_SAME')
  const follows = core.filter(x => x.follow === 'FOLLOWS').length
  const timingOk = r.timing.some(t => t.fwd.ci && (t.fwd.ci[0] > 0 || t.fwd.ci[1] < 0))
  const trend60 = r.eventDelay.find(e => e.rule === 'TREND' && e.horizon === 60)
  const trendHolds = !!trend60?.ciT1 && trend60.ciT1[0] > 0
  if (leadsSame.length === 0 && !timingOk && follows * 2 > core.length) {
    return trendHolds
      ? '可行一半：资金变化能确认 60 日级别的趋势、提示拥挤，不能用来提前埋伏或择时买卖。'
      : '不可行：资金变化主要跟着价格走，既不能提前埋伏，也不能择时买卖。'
  }
  return leadsSame.length
    ? `部分可行：${leadsSame.map(x => `${UNIVERSES[x.universe]}·${SIGNALS[x.signal].text}`).join('、')} 对之后 20 日有同向领先，其余信号只能作确认。`
    : '可行一半：资金变化只能作确认，领先证据不足。'
}

export interface LeadLagSummary {
  runOn: string
  period: [string, string]
  verdict: string
  rows: {
    universe: UniverseId; universeText: string; signal: SignalId; signalText: string; knownAt: string
    pastIc: number | null; fwdIc: number | null; fwdCi: [number, number] | null
    top: number | null; bottom: number | null; follow: FollowVerdict; lead: LeadVerdict
  }[]
  timing: TimingResult[]
  eventDelay: EventDelayRow[]
  slow: string[]
  conclusion: string[]
}

export function summarizeLeadLag(r: LeadLagReport): LeadLagSummary {
  return {
    runOn: r.runOn,
    period: r.period,
    verdict: tacticalVerdict(r),
    rows: r.results.map(x => {
      const f = x.windows.find(w => w.window === 'F1_20')!
      return {
        universe: x.universe, universeText: UNIVERSES[x.universe], signal: x.signal, signalText: SIGNALS[x.signal].text,
        knownAt: SIGNALS[x.signal].knownAt,
        pastIc: x.windows.find(w => w.window === 'P20')!.ic, fwdIc: f.ic, fwdCi: f.ci,
        top: x.spread20.top, bottom: x.spread20.bottom, follow: x.follow, lead: x.lead,
      }
    }),
    timing: r.timing,
    eventDelay: r.eventDelay.filter(e => e.rule === 'TREND' || e.rule === 'EXHAUST'),
    slow: r.slow?.conclusion ?? [],
    conclusion: r.conclusion,
  }
}

/** 由数字生成结论。措辞只描述检验结果，不给动作 */
export function concludeLeadLag(results: readonly SignalResult[], timing: readonly TimingResult[], events: readonly EventDelayRow[]): string[] {
  const out: string[] = []
  const find = (u: UniverseId, s: SignalId) => results.find(x => x.universe === u && x.signal === s)
  const fwdIc = (x: SignalResult | undefined) => x?.windows.find(w => w.window === 'F1_20')?.ic ?? null
  const pastIc = (x: SignalResult | undefined) => x?.windows.find(w => w.window === 'P20')?.ic ?? null

  for (const sig of Object.keys(SIGNALS) as SignalId[]) {
    const all = find('ALL', sig)
    if (!all) continue
    const ratio = pastIc(all) !== null && fwdIc(all) !== null && Math.abs(fwdIc(all)!) > 0
      ? Math.abs(pastIc(all)!) / Math.abs(fwdIc(all)!) : null
    out.push(`${SIGNALS[sig].text}：全市场 ${FOLLOW_VERDICT_TEXT[all.follow]}（过去 20 日 IC ${f3(pastIc(all))}），`
      + `${LEAD_VERDICT_TEXT[all.lead]}（之后 20 日 IC ${f3(fwdIc(all))}）`
      + (ratio !== null && ratio > 2 ? `；解释过去的力度是预测未来的 ${ratio.toFixed(0)} 倍，主要是跟随` : ''))
  }
  const biases = results.map(r => r.overnightBias).filter((v): v is number => v !== null)
  if (biases.length) {
    const maxAbs = Math.max(...biases.map(Math.abs))
    out.push(`隔夜偏差：按 T 日收盘对齐比按 T+1 收盘对齐，IC 最多相差 ${maxAbs.toFixed(3)}`)
  }
  const flips = events.filter(e => e.verdictT0 !== e.verdictT1)
  out.push(flips.length
    ? `冻结规则改按 T+1 起算后，结论变化的有：${flips.map(e => `${e.rule} ${e.horizon} 日（${e.verdictT0} → ${e.verdictT1}）`).join('；')}`
    : '冻结规则改按 T+1 起算后，样本外结论全部不变')
  for (const t of timing) {
    const s = ciExcludesZero(t.fwd.ci)
    out.push(`大盘择时 · ${t.text}：${s === 0 ? '对之后 20 日无显著预测力' : s > 0 ? '对之后 20 日正相关' : '对之后 20 日负相关'}（r=${f3(t.fwd.r)}，独立样本仅约 ${t.independent} 段）`)
  }
  return out
}
