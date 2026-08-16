/**
 * 分产品收入(主营构成)取数。
 *
 * 数据源:东方财富 RPT_F10_FN_MAINOP。`MAINOP_TYPE` 三种口径:
 *   1 = 按行业   2 = 按产品   3 = 按地区
 * 本模块只取 **2 = 按产品**,因为验证链第 2 环问的是产品线收入。
 *
 * 披露频率:仅年报与中报(报告期全为 12-31 与 06-30)。
 * 这决定了第 2 环最快半年更新一次 —— **它不可能是一个"日更"环节。**
 *
 * ── 本模块只服务第 2 环 ──
 *
 * 第 2 环问「公司收入是否确实改善」。它**不回答**「是不是 AI 导致的」——
 * 那是第 3 环。分产品收入给出的是产品类别(存储芯片/微控制器/传感器),
 * 而不是下游应用(服务器/手机/工控)。
 * 「存储芯片」里同时装着 NOR Flash、NAND、DRAM,
 * 其中只有一部分与 AI 相关 —— 所以拿到这份数据也推不出 AI 归因。
 *
 * 本文件因此刻意不导出任何形如 aiRevenue / aiShare 的字段。
 *
 * ── 必须处理的一件事:分项名称会变 ──
 *
 * 兆易创新的实际披露:
 *   2023年报  微控制器 13.17亿                     （无独立模拟产品）
 *   2024年报  MCU及模拟产品 17.06亿                （合并披露）
 *   2025年报  微控制器 19.10亿 + 模拟产品 3.33亿    （拆开披露）
 *
 * 按名字直接匹配算同比,会把 MCU 与模拟产品整段丢掉。丢掉不会报错 ——
 * 只是那两项的增量从"匹配项之和"里消失,而总额仍按各期全部分项求和,
 * 于是**两个数字对不上却都看起来正常**。
 *
 * 故本模块做两件事:
 *   1. 用别名组把口径变化对齐(GROUPS)
 *   2. 强制配平校验:Σ(各组增量) 必须等于 总增量,否则报错
 */

export interface SegmentRow {
  reportDate: string
  reportName: string
  itemName: string
  /** 主营收入(元) */
  income: number
  /** 占主营收入比 */
  incomeRatio: number | null
  /** 该分项毛利率(小数) */
  grossMargin: number | null
}

export interface SegmentPeriod {
  reportDate: string
  reportName: string
  /** 是否年报。中报与年报不可直接相比 —— 一个是半年累计,一个是全年累计 */
  isAnnual: boolean
  rows: SegmentRow[]
  total: number
}

export interface SegmentFile {
  code: string
  name: string
  fetchedAt: string
  source: string
  periods: SegmentPeriod[]
}

const API = 'https://datacenter.eastmoney.com/securities/api/data/v1/get'

/** 沪市 6 开头,深市 0/3 开头。兆易创新 603986 是**沪市**,曾被误写成 SZ */
export function secuCode(code: string): string {
  return `${code}.${code.startsWith('6') ? 'SH' : 'SZ'}`
}

export async function fetchSegments(code: string, name: string): Promise<SegmentFile> {
  const rows: Record<string, unknown>[] = []
  for (let page = 1; page <= 6; page++) {
    const url = `${API}?reportName=RPT_F10_FN_MAINOP&columns=ALL`
      + `&filter=(SECUCODE%3D%22${secuCode(code)}%22)`
      + `&pageSize=50&pageNumber=${page}&sortColumns=REPORT_DATE&sortTypes=-1`
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://data.eastmoney.com/' },
    })
    const json = await res.json() as { result?: { data?: Record<string, unknown>[] } }
    const data = json?.result?.data
    if (!data?.length) break
    rows.push(...data)
  }

  const byProduct = rows.filter(r => String(r.MAINOP_TYPE) === '2')
  const dates = [...new Set(byProduct.map(r => String(r.REPORT_DATE).slice(0, 10)))]
    .sort().reverse()

  const periods: SegmentPeriod[] = dates.map(d => {
    const g = byProduct.filter(r => String(r.REPORT_DATE).slice(0, 10) === d)
    const mapped: SegmentRow[] = g.map(r => ({
      reportDate: d,
      reportName: String(r.REPORT_NAME ?? ''),
      itemName: String(r.ITEM_NAME ?? ''),
      income: Number(r.MAIN_BUSINESS_INCOME ?? 0),
      incomeRatio: r.MBI_RATIO == null ? null : Number(r.MBI_RATIO),
      grossMargin: r.GROSS_RPOFIT_RATIO == null ? null : Number(r.GROSS_RPOFIT_RATIO),
    }))
    return {
      reportDate: d,
      reportName: mapped[0]?.reportName ?? '',
      isAnnual: d.endsWith('-12-31'),
      rows: mapped,
      total: mapped.reduce((s, x) => s + x.income, 0),
    }
  })

  return {
    code, name, fetchedAt: new Date().toISOString(),
    source: '东方财富 RPT_F10_FN_MAINOP（MAINOP_TYPE=2 按产品）',
    periods,
  }
}

/**
 * 口径别名组。
 *
 * 每组是"同一块业务在不同报告期的所有叫法"。分组而非改名,是因为
 * 2025 年把 MCU 与模拟产品拆成两项、2024 年合并成一项 ——
 * 只有把两者放进同一组,同比才成立。
 *
 * **新增标的时必须先核对分项名称,不能默认这套别名通用。**
 */
export const SEGMENT_GROUPS: readonly { group: string; aliases: readonly string[] }[] = [
  { group: '存储芯片', aliases: ['存储芯片', '存储器', '存储'] },
  { group: 'MCU与模拟', aliases: ['微控制器', '模拟产品', 'MCU及模拟产品', 'MCU'] },
  { group: '传感器', aliases: ['传感器'] },
  { group: '其他与技术服务', aliases: ['技术服务及其他收入', '技术服务收入及其他收入', '其他(补充)', '其他'] },
]

export function groupOf(itemName: string): string | null {
  for (const g of SEGMENT_GROUPS) {
    if (g.aliases.some(a => itemName === a)) return g.group
  }
  return null
}

export interface GroupedPeriod {
  reportDate: string
  reportName: string
  isAnnual: boolean
  total: number
  /** 组名 → 收入合计 */
  byGroup: Record<string, number>
  /** 未能归组的分项名。**非空即表示别名表需要补** */
  ungrouped: string[]
}

export function groupPeriod(p: SegmentPeriod): GroupedPeriod {
  const byGroup: Record<string, number> = {}
  const ungrouped: string[] = []
  for (const r of p.rows) {
    const g = groupOf(r.itemName)
    if (g === null) { ungrouped.push(r.itemName); continue }
    byGroup[g] = (byGroup[g] ?? 0) + r.income
  }
  return {
    reportDate: p.reportDate, reportName: p.reportName, isAnnual: p.isAnnual,
    total: p.total, byGroup, ungrouped,
  }
}

/**
 * 配平校验:Σ(各组收入) 必须等于该期总额。
 *
 * 不加这道校验的后果不是报错,而是**两个数字对不上却都看起来正常**:
 * 未归组的分项从"各组之和"里消失,而总额仍按全部分项求和。
 * 于是"存储占总增量 74%"这类结论可能建立在一个缺了一块的分母上。
 */
export function reconcile(gp: GroupedPeriod): { ok: boolean; diff: number; note: string } {
  const sum = Object.values(gp.byGroup).reduce((s, v) => s + v, 0)
  const diff = gp.total - sum
  const ok = Math.abs(diff) < 1 && gp.ungrouped.length === 0
  return {
    ok, diff,
    note: ok
      ? '各组之和与总额一致'
      : `各组之和 ${(sum / 1e8).toFixed(4)}亿 与总额 ${(gp.total / 1e8).toFixed(4)}亿`
        + `相差 ${(diff / 1e8).toFixed(4)}亿`
        + (gp.ungrouped.length
          ? `；未归组分项：${gp.ungrouped.join('、')} → 须补 SEGMENT_GROUPS 别名`
          : ''),
  }
}
