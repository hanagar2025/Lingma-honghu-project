// Profit Radar 数据抓取
//
// 委员会 2026-08-13 第七节：
//   「否则所谓『新核心发现』，最终还是价格动量模型。这一点我们已经用回测证明过了，不能再走回头路。」
//
// 这是那句话的直接执行：先把利润数据落地，再谈发现器。
//
// 数据源：东方财富 RPT_LICO_FN_CPD（业绩报表）。字段核实结果见下方 FIELD_MAP。
// 冻结期允许"补数据"，本文件不含任何决策规则。
//
// 运行：npm run profit:fetch

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MAINLINES } from '../msr/universe'
import { NODE_CANDIDATES } from './nodeCandidates'

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36'

/**
 * 已核实可得的字段。**下面注明"不可得"的项必须靠人工建档，不得用近似值伪装。**
 *
 *   TOTAL_OPERATE_INCOME  营业总收入（累计）        ✓
 *   PARENT_NETPROFIT      归母净利润（累计）        ✓
 *   BASIC_EPS             基本每股收益（累计）      ✓
 *   DEDUCT_BASIC_EPS      扣非每股收益（累计）      ✓ 但**一季报/三季报为 null**，仅半年报与年报有
 *   XSMLL                 销售毛利率（累计）        ✓
 *   MGJYXJJE              每股经营现金流（累计）    ✓
 *   WEIGHTAVG_ROE         加权净资产收益率（累计）  ✓
 *   YSTZ / SJLTZ          营收/净利同比（累计）     ✓
 *   YSHZ / SJLHZ          营收/净利环比             ✓
 *
 * 委员会列出但**本数据源不可得**，须人工建档：
 *   CapEx、分部收入、主线收入占比、订单/合同、客户结构、产能利用率
 */
export const FIELD_MAP = {
  revenue: 'TOTAL_OPERATE_INCOME',
  netProfit: 'PARENT_NETPROFIT',
  basicEps: 'BASIC_EPS',
  deductEps: 'DEDUCT_BASIC_EPS',
  grossMargin: 'XSMLL',
  cfoPerShare: 'MGJYXJJE',
  roe: 'WEIGHTAVG_ROE',
} as const

export const UNAVAILABLE_FIELDS = [
  'CapEx（资本开支）', '分部收入', '主线收入占比', '订单/合同金额', '客户结构', '产能利用率',
] as const

/** 单期财报（累计口径） */
export interface RawPeriod {
  reportDate: string
  noticeDate: string
  year: number
  quarter: 1 | 2 | 3 | 4
  /** 累计营业总收入（元） */
  revenueCum: number | null
  /** 累计归母净利润（元） */
  netProfitCum: number | null
  basicEps: number | null
  /** 扣非每股收益。一季报/三季报通常为 null */
  deductEps: number | null
  /** 累计销售毛利率（%） */
  grossMarginCumPct: number | null
  /** 累计每股经营现金流（元） */
  cfoPerShareCum: number | null
  /** 累计加权ROE（%） */
  roeCum: number | null
}

export interface ProfitRecord {
  code: string
  name: string
  /** 该标的属于决策域还是研究域。研究域标的永不进入 MSR 扫描 */
  scope: 'DECISION' | 'RESEARCH'
  periods: RawPeriod[]
  error?: string
}

export interface ProfitFile {
  generatedAt: string
  source: string
  methodology: {
    cumulative: string
    singleQuarter: string
    deductRatio: string
    grossMargin: string
    cashMatch: string
    unavailable: readonly string[]
  }
  records: ProfitRecord[]
}

async function fetchPeriods(code: string): Promise<RawPeriod[]> {
  const cols = [
    'SECURITY_CODE', 'REPORTDATE', 'NOTICE_DATE',
    'BASIC_EPS', 'DEDUCT_BASIC_EPS', 'TOTAL_OPERATE_INCOME', 'PARENT_NETPROFIT',
    'XSMLL', 'MGJYXJJE', 'WEIGHTAVG_ROE',
  ].join(',')
  const url =
    'https://datacenter-web.eastmoney.com/api/data/v1/get' +
    `?reportName=RPT_LICO_FN_CPD&columns=${cols}` +
    `&filter=(SECURITY_CODE%3D%22${code}%22)&pageSize=40&sortColumns=REPORTDATE&sortTypes=-1`
  const res = await fetch(url, { headers: { 'User-Agent': UA, Referer: 'https://data.eastmoney.com/' } })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const json = await res.json() as any
  if (!json?.success) throw new Error(json?.message ?? '接口失败')
  const rows: any[] = json?.result?.data ?? []
  return rows.map(r => {
    const reportDate = String(r.REPORTDATE).slice(0, 10)
    const mm = reportDate.slice(5, 7)
    return {
      reportDate,
      noticeDate: r.NOTICE_DATE ? String(r.NOTICE_DATE).slice(0, 10) : '',
      year: +reportDate.slice(0, 4),
      quarter: (mm === '03' ? 1 : mm === '06' ? 2 : mm === '09' ? 3 : 4) as 1 | 2 | 3 | 4,
      revenueCum: r.TOTAL_OPERATE_INCOME ?? null,
      netProfitCum: r.PARENT_NETPROFIT ?? null,
      basicEps: r.BASIC_EPS ?? null,
      deductEps: r.DEDUCT_BASIC_EPS ?? null,
      grossMarginCumPct: r.XSMLL ?? null,
      cfoPerShareCum: r.MGJYXJJE ?? null,
      roeCum: r.WEIGHTAVG_ROE ?? null,
    }
  }).sort((a, b) => a.reportDate.localeCompare(b.reportDate))
}

export const PROFIT_FILE = join(dirname(fileURLToPath(import.meta.url)), 'data', 'profit.json')

async function main(): Promise<void> {
  const decision = MAINLINES.flatMap(m => m.members.map(x => ({ code: x.code, name: x.name, scope: 'DECISION' as const })))
  const research = [...new Map(NODE_CANDIDATES.map(c => [c.code, { code: c.code, name: c.name, scope: 'RESEARCH' as const }])).values()]
    // 研究名单里可能出现已在决策域的标的（如新易盛作对照），去重时决策域优先
    .filter(r => !decision.some(d => d.code === r.code))
  const targets = [...decision, ...research]

  process.stdout.write(`\n抓取利润数据：决策域 ${decision.length} 只 + 研究域 ${research.length} 只 = ${targets.length} 只\n\n`)

  const records: ProfitRecord[] = []
  for (const t of targets) {
    try {
      const periods = await fetchPeriods(t.code)
      records.push({ ...t, periods })
      const latest = periods[periods.length - 1]
      const deductCoverage = periods.filter(p => p.deductEps !== null).length
      process.stdout.write(
        `  ✓ ${t.code} ${t.name.padEnd(6)} ${periods.length}期 最新${latest?.reportDate ?? '—'} ` +
        `扣非可得${deductCoverage}期 ${t.scope === 'RESEARCH' ? '[研究域]' : ''}\n`
      )
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      records.push({ ...t, periods: [], error: msg })
      process.stdout.write(`  ✗ ${t.code} ${t.name} ${msg}\n`)
    }
    await new Promise(r => setTimeout(r, 220))
  }

  const file: ProfitFile = {
    generatedAt: new Date().toISOString(),
    source: '东方财富 RPT_LICO_FN_CPD（业绩报表）',
    methodology: {
      cumulative: '接口返回均为年初至今累计口径',
      singleQuarter: '单季 = 本期累计 − 上期累计（同年内）；Q1 单季即累计',
      deductRatio: '扣非占比 = 扣非每股收益 ÷ 基本每股收益。一季报/三季报该字段为 null，故仅半年报与年报可算',
      grossMargin: '毛利率为累计口径，接口不提供成本，无法还原单季毛利率。只可比较累计毛利率的同比变化',
      cashMatch: '现金含量 = 每股经营现金流 ÷ 基本每股收益（累计口径）',
      unavailable: UNAVAILABLE_FIELDS,
    },
    records,
  }
  mkdirSync(dirname(PROFIT_FILE), { recursive: true })
  writeFileSync(PROFIT_FILE, `${JSON.stringify(file, null, 2)}\n`, 'utf-8')

  const okCount = records.filter(r => !r.error).length
  const withDeduct = records.filter(r => r.periods.some(p => p.deductEps !== null)).length
  process.stdout.write(`\n已写入 ${PROFIT_FILE}\n`)
  process.stdout.write(`  成功 ${okCount}/${targets.length}；其中 ${withDeduct} 只至少有一期扣非数据\n`)
  process.stdout.write(`  本数据源不可得（须人工建档）：${UNAVAILABLE_FIELDS.join('、')}\n`)
}

if (process.argv[1] && process.argv[1].includes('profitFetch')) {
  main().catch(e => { console.error(e); process.exit(1) })
}
