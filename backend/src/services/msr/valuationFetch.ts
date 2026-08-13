// 估值数据抓取与生成 —— 产出 data/valuation.json，供 MSR 离线读取
//
// 用法：npm run msr:valuation
//
// 数据源与口径：
//   财报  东方财富 datacenter RPT_LICO_FN_CPD（逐季，含 NOTICE_DATE 公告日）
//   价格  腾讯 ifzq 日K，**未复权**（末位参数留空）
// 两者都是免费公开接口，无 token。失败时逐只跳过并在输出中标注，不中断整体生成。

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { DailyBar } from '../tios/types'
import { MAINLINES } from './universe'
import { summarizeValuation, type FinancialReport, type ValuationResult } from './valuation'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'

/** 6位代码 → 腾讯前缀。沪市 6/9 开头，深市其余 */
export function tencentSymbol(code: string): string {
  return (code.startsWith('6') || code.startsWith('9') ? 'sh' : 'sz') + code
}

export async function fetchUnadjustedBars(code: string, days = 1200): Promise<DailyBar[]> {
  const sym = tencentSymbol(code)
  // 末位留空 = 未复权。前复权(qfq)会因分红送股回调而系统性压低历史PE。
  const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${sym},day,,,${days},`
  const res = await fetch(url, { headers: { Referer: 'https://gu.qq.com/' } })
  if (!res.ok) throw new Error(`行情HTTP ${res.status}`)
  const json = await res.json() as any
  const rows: string[][] = json?.data?.[sym]?.day ?? []
  return rows.map(r => ({
    date: r[0], open: +r[1], close: +r[2], high: +r[3], low: +r[4], volume: +r[5],
  }))
}

export async function fetchReports(code: string): Promise<FinancialReport[]> {
  const cols = 'SECURITY_CODE,REPORTDATE,NOTICE_DATE,BASIC_EPS,DEDUCT_BASIC_EPS,TOTAL_OPERATE_INCOME,PARENT_NETPROFIT'
  const url =
    'https://datacenter-web.eastmoney.com/api/data/v1/get' +
    `?reportName=RPT_LICO_FN_CPD&columns=${cols}` +
    `&filter=(SECURITY_CODE%3D%22${code}%22)&pageSize=100&sortColumns=REPORTDATE&sortTypes=-1`
  const res = await fetch(url, { headers: { 'User-Agent': UA, Referer: 'https://data.eastmoney.com/' } })
  if (!res.ok) throw new Error(`财报HTTP ${res.status}`)
  const json = await res.json() as any
  if (!json?.success) throw new Error(`财报接口: ${json?.message ?? '未知错误'}`)
  const rows: any[] = json?.result?.data ?? []
  return rows.map(r => {
    const reportDate: string = String(r.REPORTDATE).slice(0, 10)
    const mm = reportDate.slice(5, 7)
    const quarter = mm === '03' ? 1 : mm === '06' ? 2 : mm === '09' ? 3 : 4
    return {
      reportDate,
      noticeDate: r.NOTICE_DATE ? String(r.NOTICE_DATE).slice(0, 10) : '',
      basicEps: r.BASIC_EPS ?? null,
      deductEps: r.DEDUCT_BASIC_EPS ?? null,
      revenue: r.TOTAL_OPERATE_INCOME ?? null,
      netProfit: r.PARENT_NETPROFIT ?? null,
      quarter: quarter as 1 | 2 | 3 | 4,
      year: +reportDate.slice(0, 4),
    }
  })
}

export interface ValuationFile {
  generatedAt: string
  /** 口径声明 —— 随数据一起保存，防止日后忘记是怎么算的 */
  methodology: {
    priceAdjustment: string
    alignment: string
    ttmFormula: string
    percentileWindow: string
    knownIssues: string[]
  }
  items: Record<string, ValuationResult>
  failures: Record<string, string>
}

export async function buildValuationFile(): Promise<ValuationFile> {
  const items: Record<string, ValuationResult> = {}
  const failures: Record<string, string> = {}
  const members = MAINLINES.flatMap(ml => ml.members)

  for (const m of members) {
    try {
      const [bars, reports] = await Promise.all([fetchUnadjustedBars(m.code), fetchReports(m.code)])
      if (!bars.length) throw new Error('未复权日K为空')
      if (!reports.length) throw new Error('无财报记录')
      items[m.code] = summarizeValuation(m.code, m.name, bars, reports)
    } catch (e) {
      failures[m.code] = `${m.name}: ${(e as Error).message}`
    }
    await new Promise(r => setTimeout(r, 150))
  }

  return {
    generatedAt: new Date().toISOString(),
    methodology: {
      priceAdjustment: '未复权收盘价（腾讯ifzq末位参数留空）。前复权会因分红送股回调而系统性压低历史PE',
      alignment: '按财报 NOTICE_DATE（公告日）对齐，非 REPORTDATE。避免用尚未公布的利润计算历史PE',
      ttmFormula: 'Q4：本年年报累计EPS。Q1/Q2/Q3：上年年报 + 本年累计 - 上年同期累计。缺项则回退至上一可算期',
      percentileWindow: '近750个交易日（约3年）；不足3年则用全历史，并在 note 中标注',
      knownIssues: [
        'BASIC_EPS 为基本每股收益，受股本变动影响；理论上用总市值/TTM净利润更严谨，但缺历史股本数据',
        'DEDUCT_BASIC_EPS（扣非）仅年报/半年报披露，且实测存在异常（如中际旭创2023年报扣非2.74 > 基本2.00），使用前须逐条核验，暂不用于估值计算',
        'TTM亏损期PE无意义，已剔除，不计入分位分母',
      ],
    },
    items,
    failures,
  }
}

async function main(): Promise<void> {
  process.stdout.write('抓取财报与未复权价格...\n')
  const file = await buildValuationFile()
  const out = join(dirname(fileURLToPath(import.meta.url)), 'data', 'valuation.json')
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, JSON.stringify(file, null, 2), 'utf8')

  const rows = Object.values(file.items)
  process.stdout.write(`\n成功 ${rows.length} 只，失败 ${Object.keys(file.failures).length} 只\n\n`)
  process.stdout.write(
    `${'标的'.padEnd(6)}${'PE-TTM'.padStart(10)}${'3年分位'.padStart(10)}${'全历史分位'.padStart(12)}` +
    `${'样本'.padStart(7)}${'闸门'.padStart(7)}  说明\n`
  )
  for (const r of rows.sort((a, b) => (a.percentile3y ?? 9) - (b.percentile3y ?? 9))) {
    const pe = r.peTtm === null ? '亏损/缺' : r.peTtm.toFixed(1)
    const p3 = r.percentile3y === null ? '—' : `${(r.percentile3y * 100).toFixed(0)}%`
    const pa = r.percentileAll === null ? '—' : `${(r.percentileAll * 100).toFixed(0)}%`
    process.stdout.write(
      `${r.name.padEnd(6)}${pe.padStart(10)}${p3.padStart(10)}${pa.padStart(12)}` +
      `${String(r.validSamples).padStart(7)}${(r.usable ? '可用' : '不可用').padStart(7)}  ${r.note}\n`
    )
  }
  const unusable = rows.filter(r => !r.usable)
  process.stdout.write(`\n可用于闸门判定 ${rows.length - unusable.length}/${rows.length} 只`)
  process.stdout.write(unusable.length ? `，不可用：${unusable.map(r => r.name).join('、')}\n` : '\n')
  for (const [code, msg] of Object.entries(file.failures)) {
    process.stdout.write(`  失败 ${code} ${msg}\n`)
  }
  process.stdout.write(`\n已写入 ${out}\n`)
}

main().catch(e => { process.stderr.write(`${(e as Error).stack}\n`); process.exit(1) })
