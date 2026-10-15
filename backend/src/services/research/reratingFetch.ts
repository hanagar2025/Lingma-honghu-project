// R-02 核心股预选数据审计 —— 抓取同一时点的行情、财报、一致预期与业绩预告，生成研究表并存档快照
//
// 用法：npm -w backend run research:rerating
//   ASOF=2026-10-15  指定文件日期（默认北京时间今天）
//
// 不 import msr/valuationFetch.ts：那个文件在顶层执行 main()。

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { summarizeValuation, type FinancialReport } from '../msr/valuation'
import {
  PRESELECT_POOL, SCENARIO_ASSUMPTIONS, buildStockView, renderRerating,
  type Bar, type Forecast, type PoolMember, type Preview, type ReportRow, type StockRaw,
} from './rerating'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
const EM = { 'User-Agent': UA, Referer: 'https://data.eastmoney.com/' }

const sym = (code: string) => (code.startsWith('6') || code.startsWith('9') ? 'sh' : 'sz') + code
const day = (v: unknown) => (v ? String(v).slice(0, 10) : '')
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

async function emGet(report: string, columns: string, code: string, sort: string, pageSize = 20): Promise<any[]> {
  const url = 'https://datacenter-web.eastmoney.com/api/data/v1/get'
    + `?reportName=${report}&columns=${columns}`
    + `&filter=(SECURITY_CODE%3D%22${code}%22)&pageSize=${pageSize}&sortColumns=${sort}&sortTypes=-1`
  const res = await fetch(url, { headers: EM })
  if (!res.ok) throw new Error(`${report} HTTP ${res.status}`)
  const json = await res.json() as any
  if (json?.code === 9201) return []
  if (!json?.success) throw new Error(`${report}: ${json?.message ?? '未知错误'}`)
  return json?.result?.data ?? []
}

interface Quote { price: number; marketCapYi: number; floatCapYi: number; peTtm: number | null; time: string }

async function fetchQuotes(codes: readonly string[]): Promise<Map<string, Quote>> {
  const res = await fetch(`https://qt.gtimg.cn/q=${codes.map(sym).join(',')}`, { headers: { 'User-Agent': UA } })
  if (!res.ok) throw new Error(`腾讯行情 HTTP ${res.status}`)
  const text = new TextDecoder('gbk').decode(await res.arrayBuffer())
  const out = new Map<string, Quote>()
  for (const line of text.split(';')) {
    const m = line.match(/v_(?:sh|sz)(\d{6})="([^"]*)"/)
    if (!m) continue
    const f = m[2]!.split('~')
    const price = +f[3]!
    if (!(price > 0)) continue
    const pe = +f[39]!
    out.set(m[1]!, { price, marketCapYi: +f[45]!, floatCapYi: +f[44]!, peTtm: pe > 0 ? pe : null, time: f[30] ?? '' })
  }
  return out
}

async function fetchBars(code: string, days: number, adjust: 'qfq' | ''): Promise<(Bar & { open: number; low: number })[]> {
  const s = sym(code)
  const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${s},day,,,${days},${adjust}`
  const res = await fetch(url, { headers: { Referer: 'https://gu.qq.com/', 'User-Agent': UA } })
  if (!res.ok) throw new Error(`日线 HTTP ${res.status}`)
  const json = await res.json() as any
  const rows: string[][] = (adjust ? json?.data?.[s]?.qfqday : null) ?? json?.data?.[s]?.day ?? []
  return rows.map(r => ({ date: r[0]!, open: +r[1]!, close: +r[2]!, high: +r[3]!, low: +r[4]!, volume: +r[5]! }))
}

async function fetchReportRows(code: string): Promise<{ rows: ReportRow[]; fin: FinancialReport[] }> {
  const [cpd, cash, inc] = await Promise.all([
    emGet('RPT_LICO_FN_CPD', 'SECURITY_CODE,REPORTDATE,NOTICE_DATE,BASIC_EPS,DEDUCT_BASIC_EPS,TOTAL_OPERATE_INCOME,YSTZ,PARENT_NETPROFIT,SJLTZ,XSMLL', code, 'REPORTDATE', 100),
    emGet('RPT_DMSK_FN_CASHFLOW', 'SECURITY_CODE,REPORT_DATE,NETCASH_OPERATE', code, 'REPORT_DATE', 12),
    emGet('RPT_DMSK_FN_INCOME', 'SECURITY_CODE,REPORT_DATE,DEDUCT_PARENT_NETPROFIT', code, 'REPORT_DATE', 12),
  ])
  const cashBy = new Map(cash.map(r => [day(r.REPORT_DATE), r.NETCASH_OPERATE ?? null]))
  const dedBy = new Map(inc.map(r => [day(r.REPORT_DATE), r.DEDUCT_PARENT_NETPROFIT ?? null]))
  const rows: ReportRow[] = cpd.slice(0, 9).map(r => {
    const d = day(r.REPORTDATE)
    return {
      reportDate: d,
      revenue: r.TOTAL_OPERATE_INCOME ?? null,
      revenueYoy: r.YSTZ ?? null,
      netProfit: r.PARENT_NETPROFIT ?? null,
      netProfitYoy: r.SJLTZ ?? null,
      deductNetProfit: dedBy.get(d) ?? null,
      grossMargin: r.XSMLL ?? null,
      operatingCashFlow: cashBy.get(d) ?? null,
    }
  })
  const fin: FinancialReport[] = cpd.map(r => {
    const d = day(r.REPORTDATE)
    const mm = d.slice(5, 7)
    return {
      reportDate: d,
      noticeDate: day(r.NOTICE_DATE),
      basicEps: r.BASIC_EPS ?? null,
      deductEps: r.DEDUCT_BASIC_EPS ?? null,
      revenue: r.TOTAL_OPERATE_INCOME ?? null,
      netProfit: r.PARENT_NETPROFIT ?? null,
      quarter: (mm === '03' ? 1 : mm === '06' ? 2 : mm === '09' ? 3 : 4) as 1 | 2 | 3 | 4,
      year: +d.slice(0, 4),
    }
  })
  return { rows, fin }
}

async function fetchForecast(code: string): Promise<Forecast | null> {
  const rows = await emGet('RPT_WEB_RESPREDICT', 'ALL', code, 'RATING_ORG_NUM', 1)
  const r = rows[0]
  if (!r) return null
  const eps: Forecast['eps'] = []
  for (const i of [1, 2, 3, 4]) {
    const y = r[`YEAR${i}`]
    const e = r[`EPS${i}`]
    if (y && typeof e === 'number') eps.push({ year: +y, eps: e, actual: r[`YEAR_MARK${i}`] === 'A' })
  }
  return { orgNum: r.RATING_ORG_NUM ?? null, eps }
}

/** 最近一份三季报预告；同一份预告有多行时取「归母净利润」那一行 */
async function fetchPreview(code: string, reportDate: string): Promise<Preview | null> {
  const rows = (await emGet('RPT_PUBLIC_OP_NEWPREDICT', 'SECURITY_CODE,REPORT_DATE,NOTICE_DATE,PREDICT_FINANCE,PREDICT_TYPE,PREDICT_AMT_LOWER,PREDICT_AMT_UPPER,ADD_AMP_LOWER,ADD_AMP_UPPER', code, 'NOTICE_DATE', 20))
    .filter(r => day(r.REPORT_DATE) === reportDate)
  const r = rows.find(x => String(x.PREDICT_FINANCE).includes('归属于上市公司股东的净利润')) ?? rows.find(x => String(x.PREDICT_FINANCE).includes('净利润'))
  if (!r) return null
  return {
    reportDate,
    noticeDate: day(r.NOTICE_DATE),
    type: String(r.PREDICT_TYPE ?? ''),
    netProfitLower: r.PREDICT_AMT_LOWER ?? null,
    netProfitUpper: r.PREDICT_AMT_UPPER ?? null,
    yoyLower: r.ADD_AMP_LOWER ?? null,
    yoyUpper: r.ADD_AMP_UPPER ?? null,
  }
}

async function attempt<T>(label: string, errors: string[], f: () => Promise<T>, fallback: T): Promise<T> {
  for (let i = 0; i < 3; i++) {
    try { return await f() } catch (e) {
      if (i === 2) errors.push(`${label}失败：${(e as Error).message}`)
      else await sleep(800 * (i + 1))
    }
  }
  return fallback
}

async function collect(member: PoolMember, quote: Quote | undefined): Promise<StockRaw> {
  const errors: string[] = []
  if (!quote) errors.push('腾讯实时行情缺失')
  const { rows, fin } = await attempt('财报', errors, () => fetchReportRows(member.code), { rows: [], fin: [] })
  const forecast = await attempt('一致预期', errors, () => fetchForecast(member.code), null)
  const preview = await attempt('业绩预告', errors, () => fetchPreview(member.code, '2026-09-30'), null)
  const bars = await attempt('前复权日线', errors, () => fetchBars(member.code, 320, 'qfq'), [])
  const raw = await attempt('未复权日线', errors, () => fetchBars(member.code, 1200, ''), [])
  let pePercentile3y: number | null = null
  let peNote: string | null = null
  if (raw.length && fin.length) {
    const v = summarizeValuation(member.code, member.name, raw, fin)
    pePercentile3y = v.usable ? v.percentile3y : null
    peNote = v.note || null
  }
  return {
    member,
    price: quote?.price ?? null,
    marketCapYi: quote?.marketCapYi ?? null,
    floatCapYi: quote?.floatCapYi ?? null,
    peTtm: quote?.peTtm ?? null,
    reports: rows, forecast, preview, bars, pePercentile3y, peNote, errors,
  }
}

function beijingNow(): { date: string; stamp: string } {
  const t = new Date(Date.now() + 8 * 3600_000).toISOString()
  return { date: t.slice(0, 10), stamp: `${t.slice(0, 10)} ${t.slice(11, 16)}` }
}

async function main(): Promise<void> {
  const now = beijingNow()
  const asOf = process.env.ASOF ?? now.date
  const quotes = await fetchQuotes(PRESELECT_POOL.map(m => m.code))
  const benchmark = await fetchBenchmark()

  const raws: StockRaw[] = []
  for (const m of PRESELECT_POOL) {
    process.stdout.write(`  ${m.name}…\n`)
    raws.push(await collect(m, quotes.get(m.code)))
    await sleep(200)
  }
  const views = raws.map(r => buildStockView(r, benchmark, asOf))
  const md = renderRerating(views, asOf, now.stamp)

  const here = dirname(fileURLToPath(import.meta.url))
  const repoRoot = join(here, '..', '..', '..', '..')
  const docPath = join(repoRoot, '战略组合2026-2030', `核心股预选-数据审计-${asOf}.md`)
  const snapPath = join(here, 'data', 'rerating', `${asOf}.json`)
  mkdirSync(dirname(snapPath), { recursive: true })
  writeFileSync(docPath, `${md}\n`, 'utf8')
  writeFileSync(snapPath, `${JSON.stringify({
    generatedAt: now.stamp,
    asOf,
    assumptions: SCENARIO_ASSUMPTIONS,
    quoteTime: Object.fromEntries([...quotes].map(([c, q]) => [c, q.time])),
    benchmarkLast: benchmark.at(-1)?.date ?? null,
    stocks: raws.map(r => ({ ...r, bars: undefined, barsLast: r.bars.at(-1) ?? null })),
    views,
  }, null, 2)}\n`, 'utf8')
  const gaps = views.filter(v => v.dataGaps.length)
  process.stdout.write(`\n${views.length} 只，带缺口 ${gaps.length} 只\n已写入 ${docPath}\n快照 ${snapPath}\n`)
}

/** 沪深 300 是 sh000300；sym() 按个股规则会把 000300 当成深市 */
async function fetchBenchmark(): Promise<Bar[]> {
  const res = await fetch('https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=sh000300,day,,,320,qfq', { headers: { Referer: 'https://gu.qq.com/', 'User-Agent': UA } })
  if (!res.ok) throw new Error(`沪深 300 日线 HTTP ${res.status}`)
  const json = await res.json() as any
  const rows: string[][] = json?.data?.sh000300?.qfqday ?? json?.data?.sh000300?.day ?? []
  return rows.map(r => ({ date: r[0]!, close: +r[2]!, high: +r[3]!, volume: +r[5]! }))
}

main().catch(e => { process.stderr.write(`${(e as Error).stack}\n`); process.exit(1) })
