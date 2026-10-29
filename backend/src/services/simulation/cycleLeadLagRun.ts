/**
 * SIM-LEADLAG 运行脚本：拉 CY-01 各节点成员的前复权日 K、所属主线基准与扣非利润历史，逐节点检验价格信号是否领先扣非利润拐点。
 *
 *   npm -w backend run sim:leadlag
 *
 * 只写 share/simulation/ 与研究报告；不读写账本、不生成任何卖单，每日执行单不调用。
 * 环境变量：SIM_FROM（检验起点，默认 2019-01-01）、SIM_OOS（样本外起点，默认 2024-01-01）、SIM_CACHE、SIM_PROFIT_CACHE。
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MAINLINES, findMember } from '../msr/universe'
import { NODE_NAME, NODE_ORDER, nodeMembers } from '../cycle/nodes'
import type { Bar } from './ma60'
import {
  LEADLAG, analyzeStock, earningsTurns, singleQuarters, summarizeNode,
  type DeductRow, type NodeLeadLag, type StockLeadLag,
} from './cycleLeadLag'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const ROOT = join(HERE, '..', '..', '..', '..')
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
const FROM = process.env.SIM_FROM ?? '2019-01-01'
const OOS = process.env.SIM_OOS ?? '2024-01-01'
const WARMUP_FROM = '2018-01-01'
const CACHE = process.env.SIM_CACHE ?? '/tmp/honghu-sim-kline'
const PROFIT_CACHE = process.env.SIM_PROFIT_CACHE ?? '/tmp/honghu-sim-profit'
const DEFAULT_BENCH = 'sh000300'

const sym = (code: string) => code.startsWith('sh') || code.startsWith('sz') ? code : (/^[69]/.test(code) ? `sh${code}` : `sz${code}`)
const today = () => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10)

async function retry<T>(f: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try { return await f() } catch (e) {
      if (attempt === 3) throw e
      await new Promise(r => setTimeout(r, 1000 * (1 << attempt)))
    }
  }
}

async function fetchRange(s: string, start: string, end: string): Promise<Bar[]> {
  return retry(async () => {
    const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${s},day,${start},${end},640,qfq`
    const res = await fetch(url, { headers: { Referer: 'https://gu.qq.com/', 'User-Agent': UA } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const json = await res.json() as any
    const rows: string[][] = json?.data?.[s]?.qfqday ?? json?.data?.[s]?.day ?? []
    return rows.map(r => ({ date: r[0]!, open: +r[1]!, close: +r[2]!, high: +r[3]!, low: +r[4]! }))
  })
}

/** 先用 MA60 模拟留下的日 K 缓存（同一数据源、同一复权方式），不够新再拉 */
async function bars(code: string, end: string): Promise<Bar[]> {
  const s = sym(code)
  if (existsSync(CACHE)) {
    const cached = readdirSync(CACHE).filter(f => f.startsWith(`${s}-`) && f.endsWith('.json')).sort()
    const best = cached.filter(f => f.slice(s.length + 1, s.length + 11) <= WARMUP_FROM).at(-1) ?? cached.at(-1)
    if (best) {
      const b: Bar[] = JSON.parse(readFileSync(join(CACHE, best), 'utf8'))
      const last = b.at(-1)?.date ?? ''
      if (b[0] && b[0].date <= `${+FROM.slice(0, 4) - 1}-12-31` && Date.parse(end) - Date.parse(last) <= 7 * 86400_000) return b
    }
  }
  const out: Bar[] = []
  for (let y = +WARMUP_FROM.slice(0, 4); y <= +end.slice(0, 4); y++) {
    out.push(...await fetchRange(s, y === +WARMUP_FROM.slice(0, 4) ? WARMUP_FROM : `${y}-01-01`, y === +end.slice(0, 4) ? end : `${y}-12-31`))
  }
  const res = [...new Map(out.map(b => [b.date, b])).values()].filter(b => b.close > 0).sort((x, y) => x.date.localeCompare(y.date))
  mkdirSync(CACHE, { recursive: true })
  writeFileSync(join(CACHE, `${s}-${WARMUP_FROM}-${end}.json`), JSON.stringify(res))
  return res
}

async function emRows(report: string, columns: string, code: string, sort: string): Promise<any[]> {
  return retry(async () => {
    const url = `https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=${report}&columns=${columns}`
      + `&filter=(SECURITY_CODE%3D%22${code}%22)&pageSize=100&sortColumns=${sort}&sortTypes=-1`
    const res = await fetch(url, { headers: { 'User-Agent': UA } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const json = await res.json() as any
    return (json?.result?.data ?? []) as any[]
  })
}

/**
 * 扣非累计值取利润表（RPT_DMSK_FN_INCOME），但它的 NOTICE_DATE 是之后重述披露的日期；
 * 首次公告日取业绩报表（RPT_LICO_FN_CPD）的 NOTICE_DATE。对不上首次公告日的报告期不推算。
 */
async function deductHistory(code: string, end: string): Promise<DeductRow[]> {
  const file = join(PROFIT_CACHE, `${code}-${end}-first-notice.json`)
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'))
  const [inc, cpd] = [
    await emRows('RPT_DMSK_FN_INCOME', 'SECURITY_CODE,REPORT_DATE,DEDUCT_PARENT_NETPROFIT', code, 'REPORT_DATE'),
    await emRows('RPT_LICO_FN_CPD', 'SECURITY_CODE,REPORTDATE,NOTICE_DATE', code, 'REPORTDATE'),
  ]
  const first = new Map(cpd.filter(r => r.NOTICE_DATE).map(r => [String(r.REPORTDATE).slice(0, 10), String(r.NOTICE_DATE).slice(0, 10)]))
  const out: DeductRow[] = inc.map(r => ({
    reportDate: String(r.REPORT_DATE).slice(0, 10),
    noticeDate: first.get(String(r.REPORT_DATE).slice(0, 10)) ?? null,
    cumDeduct: r.DEDUCT_PARENT_NETPROFIT ?? null,
  }))
  mkdirSync(PROFIT_CACHE, { recursive: true })
  writeFileSync(file, JSON.stringify(out))
  return out
}

export interface LeadLagReport {
  id: 'SIM-LEADLAG'
  generatedAt: string
  range: { from: string; to: string; outOfSampleFrom: string }
  params: typeof LEADLAG
  nodes: NodeLeadLag[]
  sensitivity: { windowDays: number; nodes: Pick<NodeLeadLag, 'node' | 'turns' | 'hits' | 'hitRate' | 'baseline' | 'medianLeadToNotice'>[] }[]
  stocks: Omit<StockLeadLag, 'signals'>[]
  skipped: { code: string; name: string; reason: string }[]
  declaresRule: false
  producesAction: false
}

const pct = (x: number | null) => x == null ? '—' : `${(x * 100).toFixed(0)}%`
const days = (x: number | null) => x == null ? '—' : `${x} 日（约 ${(x / 21).toFixed(1)} 个月）`

export function renderLeadLag(r: LeadLagReport): string {
  const L: string[] = []
  L.push(`# SIM-LEADLAG 价格信号与扣非利润拐点领先期检验（模拟层）${r.range.to}`)
  L.push('')
  L.push(`生成时间：${r.generatedAt}　检验区间：${r.range.from} 至 ${r.range.to}　样本外起点：${r.range.outOfSampleFrom}`)
  L.push('')
  L.push('## 边界')
  L.push('- 「资本市场领先基本面约 8 个月」是待检验假设。本报告逐节点记录领先期、样本数和失败案例，不宣布存在稳定领先规律。')
  L.push('- 模拟层结果不进入执行单，不改变 C0–C3 判定，不产生任何动作；采用任何口径须委员会另行裁定。')
  L.push('- 各节点独立统计，不合并成全局结论。')
  L.push('')
  L.push('## 口径（模拟层预登记，不是裁定）')
  L.push(`- 价格信号：收盘价低于 ${r.params.maDays} 日均线，且 ${r.params.rsDays} 日收益跑输所属主线基准（研究对照用沪深 300）；连续 ${r.params.resetDays} 个交易日不满足后再次满足才算新一次信号。`)
  L.push('- 利润拐点：单季扣非净利低于上年同季，且上一季不低于上年同季；日期取公告日（市场最早能看到的日子）。')
  L.push(`- 命中：拐点公告日前 ${r.params.windowDays} 个交易日内出现过价格信号。领先期：公告日（及报告期末）与此前最近一次信号相隔的交易日数。`)
  L.push(`- 误报：信号之后 ${r.params.windowDays} 个交易日内没有利润拐点；不足 ${r.params.windowDays} 日的信号记未到期，不计入。`)
  L.push(`- 随机基准：样本期内任意交易日，其前 ${r.params.windowDays} 个交易日内出现过信号的比例。命中率不高于随机基准，说明信号没有领先信息。`)
  L.push(`- 每个节点至少 ${r.params.minTurnsPerNode} 次拐点才给出比较；不足即写「样本不足」。`)
  L.push('')
  L.push('## 逐节点结果')
  L.push('| 节点 | 股票数 | 拐点数 | 命中 | 命中率 | 随机基准 | 领先公告日（中位） | 领先报告期末（中位） | 信号数 | 误报 | 误报率 | 未到期 | 结论 |')
  L.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|')
  for (const n of r.nodes) {
    L.push(`| ${NODE_NAME[n.node as keyof typeof NODE_NAME] ?? n.node} | ${n.stocks} | ${n.turns} | ${n.hits} | ${pct(n.hitRate)} | ${pct(n.baseline)} | ${days(n.medianLeadToNotice)} | ${days(n.medianLeadToPeriodEnd)} | ${n.signals} | ${n.falseAlarms} | ${pct(n.falseAlarmRate)} | ${n.pendingSignals} | ${n.verdict} |`)
  }
  L.push('')
  L.push('## 窗口敏感性（命中率 / 随机基准）')
  L.push(`| 节点 | ${r.sensitivity.map(x => `${x.windowDays} 日窗口`).join(' | ')} |`)
  L.push(`|---|${r.sensitivity.map(() => '---').join('|')}|`)
  for (const n of r.nodes) {
    L.push(`| ${NODE_NAME[n.node as keyof typeof NODE_NAME] ?? n.node} | ${r.sensitivity.map(x => { const s = x.nodes.find(y => y.node === n.node); return s ? `${s.hits}/${s.turns}，${pct(s.hitRate)} / ${pct(s.baseline)}，领先中位 ${s.medianLeadToNotice ?? '—'} 日` : '—' }).join(' | ')} |`)
  }
  L.push('')
  L.push('## 样本内与样本外')
  L.push('| 节点 | 区间 | 拐点数 | 命中 |')
  L.push('|---|---|---|---|')
  for (const n of r.nodes) for (const s of n.bySplit) L.push(`| ${NODE_NAME[n.node as keyof typeof NODE_NAME] ?? n.node} | ${s.label} | ${s.turns} | ${s.hits} |`)
  L.push('')
  L.push('## 失败案例（拐点前没有价格信号）')
  for (const n of r.nodes) {
    if (!n.misses.length) continue
    L.push(`- ${NODE_NAME[n.node as keyof typeof NODE_NAME] ?? n.node}：${n.misses.map(m => `${m.name} ${m.reportDate}（公告 ${m.noticeDate}）`).join('；')}`)
  }
  L.push('')
  L.push('## 逐股拐点')
  L.push('| 股票 | 节点 | 基准 | 拐点（报告期 / 公告日 / 最近信号 / 领先公告日） | 未检验拐点 |')
  L.push('|---|---|---|---|---|')
  for (const s of r.stocks) {
    const t = s.turns.map(x => `${x.reportDate} / ${x.noticeDate} / ${x.signalDate ?? '无信号'} / ${x.leadToNotice ?? '—'}`).join('；') || '无'
    L.push(`| ${s.name}（${s.code}） | ${NODE_NAME[s.node as keyof typeof NODE_NAME] ?? s.node} | ${s.benchmark} | ${t} | ${s.skippedTurns} |`)
  }
  if (r.skipped.length) {
    L.push('')
    L.push('## 未纳入')
    for (const s of r.skipped) L.push(`- ${s.name}（${s.code}）：${s.reason}`)
  }
  L.push('')
  L.push('## 局限')
  L.push('- 样本是今天的股票池与研究对照（幸存者偏差）；节点成员少，拐点次数有限，统计功效低。')
  L.push('- 价格信号是常见的弱势条件，随机基准往往很高；命中率必须与随机基准一起读。')
  L.push('- 扣非单季值由累计值相减得到；累计值是东方财富利润表的最新版本，可能含之后的重述（存在前视误差）。公告日取业绩报表的首次公告日，对不上的报告期不推算。')
  L.push('- 本报告只回答「价格是否先于扣非拐点转弱」，不回答「据此操作是否有利」；后者须计入卖错与踏空代价，另行检验。')
  return L.join('\n') + '\n'
}

async function main() {
  const end = today()
  const members = nodeMembers()
  const benchOf = (code: string) => {
    const m = findMember(code)
    return m ? MAINLINES.find(ml => ml.members.some(x => x.code === code))!.benchmark : DEFAULT_BENCH
  }
  const benchCache = new Map<string, Map<string, number>>()
  const stocks: StockLeadLag[] = []
  const inputs: { m: (typeof members)[number]; b: string; k: Bar[]; turns: ReturnType<typeof earningsTurns> }[] = []
  const skipped: LeadLagReport['skipped'] = []
  for (const m of members) {
    const b = benchOf(m.code)
    if (!benchCache.has(b)) benchCache.set(b, new Map((await bars(b, end)).map(x => [x.date, x.close])))
    const [k, d] = [await bars(m.code, end), await deductHistory(m.code, end)]
    if (k.length < 300) { skipped.push({ code: m.code, name: m.name, reason: `日 K 只有 ${k.length} 根` }); continue }
    const turns = earningsTurns(singleQuarters(d))
    inputs.push({ m, b, k, turns })
    stocks.push(analyzeStock({ code: m.code, name: m.name, node: m.node, benchmark: b }, k, benchCache.get(b)!, turns, FROM))
  }
  const sensitivity = LEADLAG.sensitivityWindows.map(w => {
    const rows = inputs.map(x => analyzeStock({ code: x.m.code, name: x.m.name, node: x.m.node, benchmark: x.b }, x.k, benchCache.get(x.b)!, x.turns, FROM, w))
    return {
      windowDays: w,
      nodes: NODE_ORDER.map(n => {
        const s = summarizeNode(n, rows.filter(r => r.node === n), OOS)
        return { node: s.node, turns: s.turns, hits: s.hits, hitRate: s.hitRate, baseline: s.baseline, medianLeadToNotice: s.medianLeadToNotice }
      }),
    }
  })
  const report: LeadLagReport = {
    id: 'SIM-LEADLAG', generatedAt: new Date().toISOString(), range: { from: FROM, to: end, outOfSampleFrom: OOS }, params: LEADLAG,
    nodes: NODE_ORDER.map(n => summarizeNode(n, stocks.filter(s => s.node === n), OOS)),
    sensitivity,
    stocks: stocks.map(({ signals, ...s }) => s), skipped, declaresRule: false, producesAction: false,
  }
  const md = renderLeadLag(report)
  const outDir = join(ROOT, 'share', 'simulation')
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, 'cycle-leadlag-latest.md'), md)
  writeFileSync(join(outDir, 'cycle-leadlag-latest.json'), JSON.stringify(report, null, 2) + '\n')
  writeFileSync(join(ROOT, '战略组合2026-2030', `AI基建周期领先期检验-模拟-${end}.md`), md)
  console.log(`已写 share/simulation/cycle-leadlag-latest.md、.json 与 战略组合2026-2030/AI基建周期领先期检验-模拟-${end}.md（${stocks.length} 只）`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(e => { console.error(e); process.exit(1) })
}
