// 变化台账 —— 把系统的核心输出从「谁可以买」改成「谁正在发生变化」
//
// 委员会 2026-08-13 决议原文：
//   「预测能力没有被证明。但是变化检测能力是完全可以建立的。」
//   「30天以后,回头看系统每天发现的东西,有多少后来真的变得重要?」
//
// 这两句话决定了本文件的全部职责，也决定了它**不做什么**：
//   - 不产生动作（无 makeAction 调用）
//   - 不产生评分、排序权重、优先级分数
//   - 不引入任何阈值 —— 变化就是前后两次读数之差，没有"多少算显著"的判断
//   - 不改变任何决策规则，故不进规则指纹
//
// 为什么必须现在就建：Discovery KPI 目前**算不出来**。
// 系统每天都在算份额、相对强度、阶段闸门，但算完就丢了。
// 30 天后要回答"8月13日我们看到了什么，后来它怎么了"，唯一办法是今天开始存。
// 这属于冻结期明确允许的"增加审计"，不是新增模型。

import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Dashboard } from '../cockpit/dashboard'

const HERE = dirname(fileURLToPath(import.meta.url))
export const CHANGELOG_DIR = join(HERE, 'data', 'changelog')
export const DISCOVERY_FILE = join(HERE, 'data', 'discovery.json')

/**
 * 一条可比较的读数。
 *
 * 刻意做成扁平的 (scope, key, field) → value 三元组而不是嵌套对象：
 * 嵌套结构在字段增删时无法稳定 diff，而这份档案要连续读 30 天甚至更久。
 */
export interface Reading {
  scope: 'HOLDING' | 'MAINLINE' | 'NODE' | 'NEXT_LAYER' | 'STRUCTURE'
  key: string
  field: string
  /** 数值型读数，供计算差值 */
  value: number | null
  /** 展示值，供直接阅读（含"缺失""不可用"等非数值状态） */
  display: string
}

export interface DailySnapshot {
  date: string
  readings: Reading[]
}

/** 一处变化。from/to 均为展示值，delta 仅在两端都是数值时存在 */
export interface Change {
  scope: Reading['scope']
  key: string
  field: string
  from: string
  to: string
  delta: number | null
  /** 由缺失变为有值，或反之。这类变化的意义与数值变化不同，须区分 */
  kind: 'VALUE' | 'APPEARED' | 'DISAPPEARED' | 'STATE'
}

function pctStr(v: number | null, digits = 1): string {
  return v === null ? '缺失' : `${(v * 100).toFixed(digits)}%`
}

function ppStr(v: number | null): string {
  return v === null ? '缺失' : `${v > 0 ? '+' : ''}${v.toFixed(1)}pct`
}

/**
 * 从驾驶舱抽取当日全部可比较读数。
 *
 * 抽的字段就是委员会列出的那几问：
 *   谁的利润份额在变？谁的节点份额在变？谁的相对强度在变？
 *   谁的资金代理在变？谁的估值分位在变？谁的证据等级在变？谁从 S0→S1→S2？
 */
export function snapshotOf(d: Dashboard): DailySnapshot {
  const r: Reading[] = []
  const push = (
    scope: Reading['scope'], key: string, field: string, value: number | null, display: string
  ) => r.push({ scope, key, field, value, display })

  for (const h of d.holdings) {
    push('HOLDING', h.name, '仓位', h.posPct, pctStr(h.posPct))
    push('HOLDING', h.name, '20日相对主线', h.relMainline, pctStr(h.relMainline))
    push('HOLDING', h.name, 'MA20位置', h.aboveMa20 === null ? null : h.aboveMa20 ? 1 : 0,
      h.aboveMa20 === null ? '缺失' : h.aboveMa20 ? '上方' : '下方')
    push('HOLDING', h.name, 'MA60位置', h.aboveMa60 === null ? null : h.aboveMa60 ? 1 : 0,
      h.aboveMa60 === null ? '缺失' : h.aboveMa60 ? '上方' : '下方')
    push('HOLDING', h.name, 'PE历史分位', h.peUsable ? h.pePercentile : null,
      h.peUsable && h.pePercentile !== null ? pctStr(h.pePercentile, 0) : '不可用')
    push('HOLDING', h.name, '节点利润份额方向', null, h.nodeShareArrow)
    push('HOLDING', h.name, '节点内利润份额', h.shareWithinNode, pctStr(h.shareWithinNode, 0))
    push('HOLDING', h.name, '复核触发项数', h.reviewTriggers.length, `${h.reviewTriggers.length}项`)
    push('HOLDING', h.name, '法定减仓理由', h.legalReason ? 1 : 0, h.legalReason ?? '无')
    push('HOLDING', h.name, '状态', null, h.status)
  }

  for (const m of d.mainlines) {
    push('MAINLINE', m.name, '趋势', null, m.trend)
    push('MAINLINE', m.name, '相对强度', null, m.relStrength)
    push('MAINLINE', m.name, '成交/资金代理', null, m.volumeProxy)
    push('MAINLINE', m.name, '利润结构方向', null, m.profitStructure)
    push('MAINLINE', m.name, '数据完整度', m.completeness, pctStr(m.completeness, 0))
    push('MAINLINE', m.name, '可否用于机会判断', m.judgable ? 1 : 0, m.judgable ? '可判' : '不可判')
  }

  for (const rows of Object.values(d.nodeStructure)) {
    for (const n of rows) {
      const k = `${n.mainlineId}/${n.node}`
      push('NODE', k, '利润规模', n.npLevel, n.npLevel === null ? '缺失' : `${(n.npLevel / 1e8).toFixed(1)}亿`)
      push('NODE', k, '存量份额', n.levelShare, pctStr(n.levelShare))
      push('NODE', k, '四季份额变化', n.delta4Q, ppStr(n.delta4Q))
      push('NODE', k, '方向', null, n.direction)
    }
  }

  for (const n of d.nextLayer) {
    const k = `${n.mainlineId}/${n.node}`
    push('NEXT_LAYER', k, '阶段', null, n.stage)
    // 节点份额在 NODE scope 下也有一份。这里刻意重复记录：
    // 观察层的历史必须自洽 —— 30天后回看"源杰这条线"时，不应还要去另一个 scope 里拼份额。
    // 且两处若哪天不一致，重复记录能让它显形而不是被吞掉。
    push('NEXT_LAYER', k, '节点份额', n.nodeShare, pctStr(n.nodeShare))
    push('NEXT_LAYER', k, '产业趋势', null, n.industryTrend)
    push('NEXT_LAYER', k, '利润趋势', null, n.profitTrend)
    push('NEXT_LAYER', k, '相对强度', null, n.relStrength)
    push('NEXT_LAYER', k, '估值', null, n.valuation)
    push('NEXT_LAYER', k, '证据等级', null, n.evidenceTier)
    push('NEXT_LAYER', k, '战略层许可', n.strategyAllows ? 1 : 0, n.strategyAllows ? '允许' : '不允许')
    push('NEXT_LAYER', k, 'S闸门', gatesPassed(n.gates), gatesText(n.gates))
    push('NEXT_LAYER', k, '阻断项数', n.actionBlockedBy.length, `${n.actionBlockedBy.length}项`)
  }

  push('STRUCTURE', '市场结构', '深化/扩散', null, d.marketStructure.kind)
  push('STRUCTURE', '市场结构', '今日新增建仓', d.actionZone.newEntryCount, String(d.actionZone.newEntryCount))
  push('STRUCTURE', '市场结构', '必须执行项数', d.actionZone.mustExecute.length, `${d.actionZone.mustExecute.length}项`)

  return { date: d.date, readings: r }
}

type Gates = Dashboard['nextLayer'][number]['gates']

/** 已通过的闸门数。'?'（数据缺失）不计为通过 —— 缺失不是通过 */
function gatesPassed(g: Gates): number {
  return [g.s0Discovered, g.s1Industry, g.s2Earnings, g.s3Valuation, g.moneyRadar]
    .filter(v => v === true).length
}

function gatesText(g: Gates): string {
  const m = (v: boolean | null) => (v === null ? '?' : v ? '✓' : '✗')
  return `${m(g.s0Discovered)}/${m(g.s1Industry)}/${m(g.s2Earnings)}/${m(g.s3Valuation)}/${m(g.moneyRadar)}`
}

/**
 * 两日快照求差。
 *
 * 只报告变化，不报告"变化是好是坏" —— 后者需要预测能力，而预测能力未被证明。
 * 也不设"变化多少才算显著"的阈值：阈值会让小而持续的份额爬升（0→1→2→5）被过滤掉，
 * 而那恰恰是委员会要找的信号。
 */
export function diffSnapshots(prev: DailySnapshot, cur: DailySnapshot): Change[] {
  const idx = new Map(prev.readings.map(r => [`${r.scope}|${r.key}|${r.field}`, r]))
  const out: Change[] = []
  for (const c of cur.readings) {
    const p = idx.get(`${c.scope}|${c.key}|${c.field}`)
    if (!p) {
      out.push({
        scope: c.scope, key: c.key, field: c.field,
        from: '（首次出现）', to: c.display, delta: null, kind: 'APPEARED',
      })
      continue
    }
    if (p.display === c.display) continue
    const numeric = p.value !== null && c.value !== null
    const missingBefore = p.value === null && c.value !== null
    const missingAfter = p.value !== null && c.value === null
    out.push({
      scope: c.scope, key: c.key, field: c.field,
      from: p.display, to: c.display,
      delta: numeric ? c.value! - p.value! : null,
      kind: missingBefore ? 'APPEARED' : missingAfter ? 'DISAPPEARED' : numeric ? 'VALUE' : 'STATE',
    })
  }
  // 前一日有、今日没有的读数（标的退出、节点消失）
  const curIdx = new Set(cur.readings.map(r => `${r.scope}|${r.key}|${r.field}`))
  for (const p of prev.readings) {
    if (!curIdx.has(`${p.scope}|${p.key}|${p.field}`)) {
      out.push({
        scope: p.scope, key: p.key, field: p.field,
        from: p.display, to: '（已消失）', delta: null, kind: 'DISAPPEARED',
      })
    }
  }
  return out
}

// ── 发现台账 ──

/**
 * 一个节点的发现史。
 *
 * 委员会想看的不是"系统推荐了什么"，而是：
 *   「8月13日源杰被标为早期观察不可行动；8月28日份额继续上升、核验完成、
 *     估值合理，系统再把它升级」—— 这才是真正的提前发现。
 *   而不是"源杰今天涨60%，系统今天告诉你它很强"（后者没有投资价值）。
 *
 * 因此台账记录的是**每次读数变化的时点**，不是最终结论。
 */
export interface DiscoveryEntry {
  key: string
  mainlineId: string
  node: string
  firstSeen: string
  lastSeen: string
  /** 阶段/闸门/份额的变迁历史。只在发生变化时追加，不每天重复写 */
  history: {
    date: string
    stage: string
    gates: string
    gatesPassed: number
    nodeShare: number | null
    strategyAllows: boolean
    /** 当日为何不能行动 */
    blockedBy: string[]
  }[]
}

export interface DiscoveryLedger {
  updatedAt: string
  entries: DiscoveryEntry[]
}

/**
 * 判断"最新一根K线"是否其实是**盘中未定价**。
 *
 * 为什么必须有这个闸门：行情源在盘中会给出当日一根"进行中"的K线，
 * 日期就是今天。系统据此算出的仓位、相对强度、成交比值全都是临时值，
 * 但归档逻辑只看日期 —— 于是 11:16 跑一次，盘中读数就被写成"8月14日收盘"，
 * 而这份档案要连续读 30 个交易日。序列里混进盘中值，
 * 30 天后回看"哪一天变了"时得到的答案是错的，且**无法事后分辨**。
 *
 * 判据只用交易日历里最硬的一条事实：A股 15:00 收盘。
 * 不做任何预测，也不引入可调阈值，故不构成新增决策规则。
 *
 * @param barDate 最新一根K线的日期（YYYY-MM-DD）
 * @param now 用于测试注入
 */
export function isIntraday(barDate: string, now = new Date()): boolean {
  // 北京时间 = UTC+8，直接用偏移算，避免依赖运行机器的时区设置
  const bj = new Date(now.getTime() + 8 * 3600 * 1000)
  const today = bj.toISOString().slice(0, 10)
  if (barDate !== today) return false
  const hhmm = bj.getUTCHours() * 60 + bj.getUTCMinutes()
  return hhmm < 15 * 60
}

export function loadDiscovery(file = DISCOVERY_FILE): DiscoveryLedger {
  if (!existsSync(file)) return { updatedAt: '', entries: [] }
  try {
    return JSON.parse(readFileSync(file, 'utf-8')) as DiscoveryLedger
  } catch {
    return { updatedAt: '', entries: [] }
  }
}

/**
 * 把当日观察层写入台账。同日重复运行会覆盖当日记录，不产生重复行。
 *
 * 只追加"与上次不同"的记录：每天都写一遍会让 30 天后的台账里 90% 是噪声，
 * 而真正要找的是"哪一天变了"。
 */
export function updateDiscovery(
  ledger: DiscoveryLedger, d: Dashboard
): DiscoveryLedger {
  const byKey = new Map(ledger.entries.map(e => [e.key, e]))
  for (const n of d.nextLayer) {
    const key = `${n.mainlineId}/${n.node}`
    const rec = {
      date: d.date,
      stage: n.stage,
      gates: gatesText(n.gates),
      gatesPassed: gatesPassed(n.gates),
      nodeShare: n.nodeShare,
      strategyAllows: n.strategyAllows,
      blockedBy: n.actionBlockedBy,
    }
    const e = byKey.get(key)
    if (!e) {
      byKey.set(key, {
        key, mainlineId: n.mainlineId, node: n.node,
        firstSeen: d.date, lastSeen: d.date, history: [rec],
      })
      continue
    }
    e.lastSeen = d.date
    const sameDay = e.history.findIndex(h => h.date === d.date)
    if (sameDay >= 0) {
      e.history[sameDay] = rec
      continue
    }
    const last = e.history[e.history.length - 1]
    const changed = !last
      || last.stage !== rec.stage
      || last.gates !== rec.gates
      || last.strategyAllows !== rec.strategyAllows
      || last.nodeShare !== rec.nodeShare
      || last.blockedBy.length !== rec.blockedBy.length
    if (changed) e.history.push(rec)
  }
  return { updatedAt: d.date, entries: [...byKey.values()] }
}

/**
 * 阶段跃迁：某节点通过的闸门数比上一次增加。
 *
 * 这是 Discovery KPI 的核心可观测量 —— 「谁从 S0 → S1 → S2？」
 * 刻意用"通过闸门数变化"而非"阶段词变化"：阶段词只有观察/研究两级，
 * 分辨率不足以看出 S1 核验完成这类进展。
 */
export function stageAdvances(ledger: DiscoveryLedger, sinceDate?: string): {
  key: string; date: string; from: number; to: number; gates: string
}[] {
  const out: { key: string; date: string; from: number; to: number; gates: string }[] = []
  for (const e of ledger.entries) {
    for (let i = 1; i < e.history.length; i++) {
      const a = e.history[i - 1]
      const b = e.history[i]
      if (b.gatesPassed > a.gatesPassed && (!sinceDate || b.date >= sinceDate)) {
        out.push({ key: e.key, date: b.date, from: a.gatesPassed, to: b.gatesPassed, gates: b.gates })
      }
    }
  }
  return out
}

// ── 落盘 ──

/**
 * 每条记录占一行的紧凑 JSON。
 *
 * 不用 `JSON.stringify(x, null, 2)`：那样一天的快照是 3800 余行，
 * 30 个交易日就有 11 万行生成文件进版本库，git diff 会彻底不可读 ——
 * 而这份档案的全部价值在于**三十天后还能看清哪一天变了什么**。
 * 每条一行既保持合法 JSON，又让变化在 diff 里逐行显形。
 */
function compactArray(key: string, items: unknown[], head: Record<string, unknown>): string {
  const headText = Object.entries(head).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`).join('\n')
  const body = items.map(x => `    ${JSON.stringify(x)}`).join(',\n')
  return `{\n${headText}\n  ${JSON.stringify(key)}: [\n${body}\n  ]\n}\n`
}

/**
 * 归档当日快照。
 *
 * **拒绝覆盖过去日期的档案，除非显式声明重述。**
 *
 * 这条闸门来自一次真实的静默改历史：8/15 用更正后的数据跑 CLI，而最新K线仍是 8/14，
 * 于是 8/14 的档案被重写成新口径的数字。档案的用途是回答"那天我们看到了什么"——
 * 8/14 我们看到的是海光 18.6%（旧口径、旧股数），把它改成 13.1% 之后，
 * "当时看到的是错的"这个事实就消失了，而那恰恰是 30 天复盘最该保留的东西。
 *
 * 覆盖同一天的档案是允许的（当天多次运行、盘后重跑），只有跨日覆盖才拦。
 * 确实要重述历史时用 RESTATE=1，且会打印出被覆盖的内容摘要 ——
 * 重述本身不是错误，静默重述才是。
 */
export function saveSnapshot(
  snap: DailySnapshot, dir = CHANGELOG_DIR, todayBeijing?: string
): string {
  mkdirSync(dir, { recursive: true })
  const f = join(dir, `${snap.date}.json`)
  const today = todayBeijing
    ?? new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10)

  if (existsSync(f) && snap.date < today && process.env.RESTATE !== '1') {
    let oldCount = '未知'
    try {
      oldCount = String((JSON.parse(readFileSync(f, 'utf-8')) as DailySnapshot).readings.length)
    } catch { /* 读不出就不报数量，不影响拦截 */ }
    throw new Error(
      `拒绝覆盖 ${snap.date} 的档案（今天是 ${today}）。\n`
      + `  该档案已有 ${oldCount} 项读数，记录的是"那天我们看到了什么"。\n`
      + `  用今天更正后的数据改写它，会让"当时看到的是错的"这个事实消失 ——\n`
      + `  而那恰恰是 30 天复盘最该保留的东西。\n`
      + `  确实要重述：RESTATE=1 重跑，并在提交信息中写明理由。`
    )
  }
  writeFileSync(f, compactArray('readings', snap.readings, { date: snap.date }), 'utf-8')
  return f
}

export function saveDiscovery(ledger: DiscoveryLedger, file = DISCOVERY_FILE): void {
  mkdirSync(dirname(file), { recursive: true })
  // 台账的每个节点占一行：新增一次闸门跃迁只产生一行 diff，而不是重排整个文件
  writeFileSync(file, compactArray('entries', ledger.entries, { updatedAt: ledger.updatedAt }), 'utf-8')
}

/**
 * 读取全部归档快照，按日期升序。
 *
 * 存在理由是委员会 2026-08-14 的观察：
 *   「好多数据不一定是今天看明天看，它的数据变化可能很小，
 *     但在一段时间长度当中，你就能看出来。」
 * 单日求差会把持续爬升淹没在噪声里 —— 份额 +0.3pct 单看毫无意义，
 * 连续二十天各 +0.3pct 就是 +6pct。要看出后者，必须跨多日累计。
 */
/** 只认 YYYY-MM-DD.json 为正式档。重述档形如 2026-08-14.restated-2026-08-15.json，
 *  必须排除 —— 否则同一天会被读成两条，复盘里凭空多出一天的变化。 */
const DAILY_FILE = /^\d{4}-\d{2}-\d{2}\.json$/

export function loadAllSnapshots(dir = CHANGELOG_DIR): DailySnapshot[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir)
    .filter(f => DAILY_FILE.test(f))
    .sort()
    .map(f => {
      try {
        return JSON.parse(readFileSync(join(dir, f), 'utf-8')) as DailySnapshot
      } catch {
        return null
      }
    })
    .filter((s): s is DailySnapshot => !!s && Array.isArray(s.readings))
}

/** 一项读数在一段区间上的累计变化 */
export interface Drift {
  scope: Reading['scope']
  key: string
  field: string
  fromDate: string
  toDate: string
  /** 区间内出现过的天数。少于全区间说明中途缺档，须显式告知而非静默平滑 */
  days: number
  from: string
  to: string
  delta: number | null
  /** 单调性：区间内每一步同向为 true。持续爬升与来回震荡是两件事 */
  monotonic: boolean
}

/**
 * 跨区间累计变化。
 *
 * 刻意不做的三件事：
 *   ① 不插值补缺档 —— 缺的那天就是没数据，补出来的点会被当成观察到的事实；
 *   ② 不设显著性阈值 —— 阈值会滤掉 0→1→2→5 的小幅持续爬升，那正是要找的；
 *   ③ 不跨字段排序 —— 把「份额 +2pct」和「相对强度 ↑」放在一起排需要重要性
 *      评分，而综合评分已被写死禁止。调用方按字段分组自行呈现。
 */
export function driftOver(snaps: DailySnapshot[], lastNDays?: number): Drift[] {
  const use = lastNDays && lastNDays > 0 ? snaps.slice(-lastNDays) : snaps
  if (use.length < 2) return []

  // key -> 按时间排列的观测点。只收该读数真实出现过的日子
  const series = new Map<string, { date: string; r: Reading }[]>()
  for (const s of use) {
    for (const r of s.readings) {
      const k = `${r.scope}|${r.key}|${r.field}`
      const arr = series.get(k) ?? []
      arr.push({ date: s.date, r })
      series.set(k, arr)
    }
  }

  const out: Drift[] = []
  for (const [, pts] of series) {
    if (pts.length < 2) continue
    const a = pts[0]
    const b = pts[pts.length - 1]
    if (a.r.display === b.r.display) continue

    const numeric = typeof a.r.value === 'number' && typeof b.r.value === 'number'
    const delta = numeric ? b.r.value! - a.r.value! : null

    let monotonic = false
    if (numeric) {
      const dir = Math.sign(delta ?? 0)
      monotonic = dir !== 0 && pts.every((p, i) => {
        if (i === 0) return true
        const prev = pts[i - 1].r.value
        if (typeof prev !== 'number' || typeof p.r.value !== 'number') return false
        const step = Math.sign(p.r.value - prev)
        return step === dir || step === 0
      })
    }

    out.push({
      scope: a.r.scope, key: a.r.key, field: a.r.field,
      fromDate: a.date, toDate: b.date, days: pts.length,
      from: a.r.display, to: b.r.display, delta, monotonic,
    })
  }
  return out
}

/** 读取指定日期之前最近的一份快照，用于求差 */
export function loadPrevSnapshot(date: string, dir = CHANGELOG_DIR): DailySnapshot | null {
  if (!existsSync(dir)) return null
  const dates = readdirSync(dir)
    .filter(f => f.endsWith('.json'))
    .map(f => f.replace(/\.json$/, ''))
    .filter(d => d < date)
    .sort()
  if (!dates.length) return null
  try {
    return JSON.parse(readFileSync(join(dir, `${dates[dates.length - 1]}.json`), 'utf-8')) as DailySnapshot
  } catch {
    return null
  }
}

/**
 * 差值文本。
 *
 * 份额类读数存的是 0–1 的分数，直接打印会得到 "+8.0e-3" 这种没法读的东西。
 * 单位没有存在 Reading 里（存了就得为每个字段维护单位表，字段一多必然漂移），
 * 所以从展示值是否以 % 结尾来推断 —— 这只影响显示，不影响任何计算。
 */
function deltaText(c: Change): string {
  if (c.delta === null) return ''
  // 增量为 0 却仍被记为变化 → 说明变的是文案而非数值（例："超出2.4pct"→"超出2.8pct"，
  // 两条都以 Reading.value=0 落档）。此时印一个"（0.000）"只会让人以为数值没动。
  if (c.delta === 0) return ''
  const isPct = c.from.endsWith('%') && c.to.endsWith('%')
  if (isPct) return `（${c.delta > 0 ? '+' : ''}${(c.delta * 100).toFixed(1)}pct）`
  const abs = Math.abs(c.delta)
  const s = abs >= 100 ? c.delta.toFixed(0) : abs >= 1 ? c.delta.toFixed(2) : c.delta.toFixed(3)
  return `（${c.delta > 0 ? '+' : ''}${s}）`
}

const SCOPE_TEXT: Record<Reading['scope'], string> = {
  HOLDING: '持仓', MAINLINE: '主线', NODE: '产业节点',
  NEXT_LAYER: '下一观察层', STRUCTURE: '市场结构',
}

/**
 * 渲染「今日变化」。
 *
 * 按 scope 分组，组内保持快照顺序 —— 刻意不排序、不加权：
 * 任何"重要性排序"都需要一个重要性评分，而委员会已写死禁止综合评分。
 */
export function renderChanges(changes: Change[], prevDate: string | null, curDate: string): string {
  const L: string[] = []
  L.push(`【今日变化】${prevDate ?? '（无前一日快照）'} → ${curDate}`)
  if (!prevDate) {
    L.push('  首次建立快照，无可比较基准。明日起本区将显示逐项变化。')
    return L.join('\n')
  }
  if (!changes.length) {
    L.push('  无变化。（不是故障：多数交易日大部分读数确实不变）')
    return L.join('\n')
  }
  for (const scope of ['STRUCTURE', 'HOLDING', 'MAINLINE', 'NODE', 'NEXT_LAYER'] as const) {
    const group = changes.filter(c => c.scope === scope)
    if (!group.length) continue
    L.push(`  ── ${SCOPE_TEXT[scope]} ──`)
    for (const c of group) {
      L.push(`    ${c.key} · ${c.field}：${c.from} → ${c.to}${deltaText(c)}`)
    }
  }
  return L.join('\n')
}

export function renderDiscovery(ledger: DiscoveryLedger, today: string): string {
  const L: string[] = []
  L.push('【发现台账】30天后回答"当时我们看到了什么，后来发生了什么"')
  if (!ledger.entries.length) {
    L.push('  台账为空。今日为首次记录。')
    return L.join('\n')
  }
  const adv = stageAdvances(ledger)
  L.push(`  在册节点 ${ledger.entries.length} 个；累计闸门跃迁 ${adv.length} 次`)
  if (adv.length) {
    L.push('  闸门跃迁记录（谁从 S0→S1→S2）：')
    for (const a of adv.slice(-12)) {
      L.push(`    ${a.date}  ${a.key}  通过闸门 ${a.from} → ${a.to}（${a.gates}）`)
    }
  } else {
    L.push('  尚无闸门跃迁。这本身是信息：说明没有任何节点在验证链上前进。')
  }
  const firstToday = ledger.entries.filter(e => e.firstSeen === today)
  if (firstToday.length) {
    L.push(`  今日首次进入台账：${firstToday.map(e => e.key).join('、')}`)
  }
  return L.join('\n')
}
