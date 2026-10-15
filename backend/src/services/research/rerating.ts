/**
 * 研究层 · R-02 核心股预选：估值重定价数据审计
 *
 * 这一层不生产动作。不改规则。不进入证据链。不进入 Capital Permission。
 * 不进 DashboardInput。不 import makeAction。证据等级恒为 OBSERVATION。
 *
 * 2026-10-15 委员会立项：「市场重新确认主线之前，先把核心股排好队」。
 * 本模块只回答可以由公开数据机械算出的问题：
 *   ① 利润兑现：最近报告期的增速、扣非占比、经营现金流 / 净利润；
 *   ② 当前市值计入了多少：一致预期下的前瞻 PE，以及「要赚到目标年化，2028 年需要多少利润」；
 *   ③ 市场是否重新认可：相对沪深 300 的 20/60 日强弱、距 250 日高点回撤、上涨日与下跌日的量比。
 * 不输出综合评分、总分或排名；分层（核心 / 次核心 / 观察 / 暂不参与）由委员会按裁定的门槛做，不由本模块做。
 * 情景格只有两个维度（利润 × 退出估值），都由一致预期机械推出，假设写在表头，不替公司编故事。
 */

export const RERATING_ID = 'R-02'
export const RERATING_TITLE = '核心股预选 · 估值重定价数据审计'
const EVIDENCE_LEVEL = 'OBSERVATION' as const

export interface PoolMember {
  code: string
  name: string
  group: string
  /** 在 msr/universe 作战名单里，且主线归因已核实 */
  attributionVerified: boolean | null
  note?: string
}

/** 委员会 10/15 第一版预选池（中科曙光为已有核心名单成员，作对照补入） */
export const PRESELECT_POOL: readonly PoolMember[] = [
  { code: '300308', name: '中际旭创', group: 'AI 算力', attributionVerified: true },
  { code: '300502', name: '新易盛', group: 'AI 算力', attributionVerified: true },
  { code: '300394', name: '天孚通信', group: 'AI 算力', attributionVerified: null },
  { code: '002463', name: '沪电股份', group: 'AI 算力', attributionVerified: true },
  { code: '002916', name: '深南电路', group: 'AI 算力', attributionVerified: true },
  { code: '688041', name: '海光信息', group: 'AI 算力', attributionVerified: true },
  { code: '603019', name: '中科曙光', group: 'AI 算力', attributionVerified: true, note: '已有核心名单成员，委员会预选池未列，作对照补入' },
  { code: '002371', name: '北方华创', group: '半导体设备', attributionVerified: true },
  { code: '688012', name: '中微公司', group: '半导体设备', attributionVerified: true },
  { code: '688072', name: '拓荆科技', group: '半导体设备', attributionVerified: null },
  { code: '300124', name: '汇川技术', group: '工业自动化', attributionVerified: null, note: '不在现有作战名单，主线归因未核验' },
]

/** 情景格的假设。这些不是规则，改动不触发冻结指纹；数值由委员会定，这里给出初始值。 */
export const SCENARIO_ASSUMPTIONS = {
  horizonEnd: '2028-12-31',
  targetAnnualReturn: 0.15,
  exitPe: [20, 30] as const,
}

export interface ReportRow {
  reportDate: string
  revenue: number | null
  revenueYoy: number | null
  netProfit: number | null
  netProfitYoy: number | null
  deductNetProfit: number | null
  grossMargin: number | null
  operatingCashFlow: number | null
}

export interface Forecast {
  orgNum: number | null
  /** 年份 → 每股收益；含实际值（A）与预测值（E） */
  eps: { year: number; eps: number; actual: boolean }[]
}

export interface Preview {
  reportDate: string
  noticeDate: string
  type: string
  netProfitLower: number | null
  netProfitUpper: number | null
  yoyLower: number | null
  yoyUpper: number | null
}

export interface Bar {
  date: string
  close: number
  high: number
  volume: number
}

export interface StockRaw {
  member: PoolMember
  price: number | null
  marketCapYi: number | null
  floatCapYi: number | null
  peTtm: number | null
  /** 年初至今累计口径，按报告期倒序 */
  reports: ReportRow[]
  forecast: Forecast | null
  preview: Preview | null
  bars: Bar[]
  pePercentile3y: number | null
  peNote: string | null
  errors: string[]
}

export interface StockView {
  code: string
  name: string
  group: string
  attributionVerified: boolean | null
  note?: string
  price: number | null
  marketCapYi: number | null
  floatCapYi: number | null
  peTtm: number | null
  pePercentile3y: number | null
  peNote: string | null
  latest: ReportRow | null
  /** 最近四个单季，倒序 */
  quarters: QuarterRow[]
  deductShare: number | null
  cashConversion: number | null
  preview: Preview | null
  orgNum: number | null
  forwardPe: { year: number; pe: number | null }[]
  consensusCagr: number | null
  /** 2028 年需要多少归母净利润（亿元），才能在退出估值下赚到目标年化 */
  requiredProfit2028: { exitPe: number; yi: number }[] | null
  consensusProfit2026Yi: number | null
  consensusProfit2028Yi: number | null
  /** 三季报预告减去半年报累计，得到的第三季度单季净利区间（亿元） */
  previewQ3Yi: [number, number] | null
  /** 前三季预告中值占一致预期 2026E 全年净利的比例 */
  previewCompletion: number | null
  /** 会让本表读数失真的情形，渲染时逐条写出 */
  caveats: string[]
  /** 利润 × 退出估值 → 到 horizonEnd 的年化收益 */
  scenarios: { profit: '一致预期' | '增速减半'; exitPe: number; annualReturn: number | null }[]
  ret20: number | null
  ret60: number | null
  rs20: number | null
  rs60: number | null
  drawdown250: number | null
  upDownVolume20: number | null
  dataGaps: string[]
}

export interface QuarterRow {
  reportDate: string
  revenue: number | null
  netProfit: number | null
  netProfitYoy: number | null
}

const YI = 1e8
/** 扣非占比低于此值时提示 PE 失真。这是读数提示，不是门槛 */
export const DEDUCT_SHARE_FLOOR = 0.8

/** 累计口径拆成单季：Q1 即累计，其余季 = 本期累计 − 同年上一期累计 */
export function singleQuarters(reports: readonly ReportRow[]): QuarterRow[] {
  const byDate = new Map(reports.map(r => [r.reportDate, r]))
  const prevDate = (d: string): string | null => {
    const y = d.slice(0, 4)
    const md = d.slice(5)
    return md === '06-30' ? `${y}-03-31` : md === '09-30' ? `${y}-06-30` : md === '12-31' ? `${y}-09-30` : null
  }
  const single = (d: string, key: 'revenue' | 'netProfit'): number | null => {
    const r = byDate.get(d)
    if (!r || r[key] === null) return null
    const pd = prevDate(d)
    if (pd === null) return r[key]
    const p = byDate.get(pd)
    return p && p[key] !== null ? r[key]! - p[key]! : null
  }
  const lastYear = (d: string) => `${+d.slice(0, 4) - 1}${d.slice(4)}`
  return [...reports]
    .sort((a, b) => b.reportDate.localeCompare(a.reportDate))
    .slice(0, 4)
    .map(r => {
      const np = single(r.reportDate, 'netProfit')
      const npLy = single(lastYear(r.reportDate), 'netProfit')
      return {
        reportDate: r.reportDate,
        revenue: single(r.reportDate, 'revenue'),
        netProfit: np,
        netProfitYoy: np !== null && npLy !== null && npLy > 0 ? np / npLy - 1 : null,
      }
    })
}

function ret(bars: readonly Bar[], n: number): number | null {
  if (bars.length <= n) return null
  const a = bars[bars.length - 1 - n]!.close
  const b = bars[bars.length - 1]!.close
  return a > 0 ? b / a - 1 : null
}

function upDownVolume(bars: readonly Bar[], n: number): number | null {
  if (bars.length <= n) return null
  let up = 0
  let down = 0
  for (let i = bars.length - n; i < bars.length; i++) {
    const d = bars[i]!.close - bars[i - 1]!.close
    if (d > 0) up += bars[i]!.volume
    else if (d < 0) down += bars[i]!.volume
  }
  return down > 0 ? up / down : null
}

function yearsBetween(from: string, to: string): number {
  return (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / (365.25 * 86400_000)
}

export function buildStockView(raw: StockRaw, benchmark: readonly Bar[], asOf: string): StockView {
  const gaps = [...raw.errors]
  const latest = [...raw.reports].sort((a, b) => b.reportDate.localeCompare(a.reportDate))[0] ?? null
  const deductShare = latest?.netProfit && latest.deductNetProfit !== null && latest.netProfit > 0
    ? latest.deductNetProfit / latest.netProfit : null
  const cashConversion = latest?.netProfit && latest.operatingCashFlow !== null && latest.netProfit > 0
    ? latest.operatingCashFlow / latest.netProfit : null
  if (latest && latest.operatingCashFlow === null) gaps.push('经营现金流缺失')

  const shares = raw.price && raw.marketCapYi ? (raw.marketCapYi * YI) / raw.price : null
  const est = (raw.forecast?.eps ?? []).filter(e => !e.actual)
  const forwardPe = est.map(e => ({ year: e.year, pe: raw.price && e.eps > 0 ? raw.price / e.eps : null }))
  const e26 = raw.forecast?.eps.find(e => e.year === 2026)?.eps ?? null
  const e28 = raw.forecast?.eps.find(e => e.year === 2028)?.eps ?? null
  const consensusCagr = e26 && e28 && e26 > 0 && e28 > 0 ? Math.sqrt(e28 / e26) - 1 : null
  if (!raw.forecast) gaps.push('无机构一致预期')
  else if (e28 === null) gaps.push('一致预期没有 2028 年')

  const { horizonEnd, targetAnnualReturn, exitPe } = SCENARIO_ASSUMPTIONS
  const years = yearsBetween(asOf, horizonEnd)
  const cap = raw.marketCapYi
  const requiredProfit2028 = cap
    ? exitPe.map(pe => ({ exitPe: pe, yi: (cap * Math.pow(1 + targetAnnualReturn, years)) / pe }))
    : null
  const p28 = shares && e28 ? (e28 * shares) / YI : null
  const p26 = shares && e26 ? (e26 * shares) / YI : null
  const caveats: string[] = []
  if (deductShare !== null && deductShare < DEDUCT_SHARE_FLOOR) {
    caveats.push(`扣非只占归母净利的 ${Math.round(deductShare * 100)}%，PE（TTM）与历史分位被非经常性收益压低，应以扣非口径复核`)
  }
  const pv = raw.preview
  const h1 = raw.reports.find(r => r.reportDate === pv?.reportDate.replace('09-30', '06-30'))
  const previewQ3Yi: [number, number] | null = pv && h1?.netProfit != null && pv.netProfitLower !== null && pv.netProfitUpper !== null
    ? [(pv.netProfitLower - h1.netProfit) / YI, (pv.netProfitUpper - h1.netProfit) / YI] : null
  const previewCompletion = pv && p26 && pv.netProfitLower !== null && pv.netProfitUpper !== null
    ? (pv.netProfitLower + pv.netProfitUpper) / 2 / YI / p26 : null
  if (previewQ3Yi && previewCompletion !== null && p26) {
    const impliedQ4 = p26 * (1 - previewCompletion)
    const q3Mid = (previewQ3Yi[0] + previewQ3Yi[1]) / 2
    if (impliedQ4 < q3Mid * 0.6) {
      caveats.push(`一致预期 2026E 全年 ${p26.toFixed(0)} 亿，扣掉前三季预告后第四季只剩约 ${impliedQ4.toFixed(0)} 亿，低于第三季单季约 ${q3Mid.toFixed(0)} 亿的六成 —— 一致预期大概率还没计入这份预告，本表的前瞻 PE 与情景格偏保守`)
    }
  }
  const p28Half = shares && e26 && consensusCagr !== null ? (e26 * Math.pow(1 + consensusCagr / 2, 2) * shares) / YI : null
  const annual = (profitYi: number | null, pe: number): number | null =>
    profitYi && cap && profitYi > 0 ? Math.pow((profitYi * pe) / cap, 1 / years) - 1 : null
  const scenarios = exitPe.flatMap(pe => [
    { profit: '一致预期' as const, exitPe: pe, annualReturn: annual(p28, pe) },
    { profit: '增速减半' as const, exitPe: pe, annualReturn: annual(p28Half, pe) },
  ])

  const ret20 = ret(raw.bars, 20)
  const ret60 = ret(raw.bars, 60)
  const b20 = ret(benchmark, 20)
  const b60 = ret(benchmark, 60)
  const tail = raw.bars.slice(-250)
  const high = tail.length ? Math.max(...tail.map(b => b.high)) : null
  const last = raw.bars.at(-1)?.close ?? null
  if (raw.bars.length < 61) gaps.push('日线不足 60 日')
  if (raw.pePercentile3y === null) gaps.push(`PE 历史分位不可用${raw.peNote ? `（${raw.peNote}）` : ''}`)

  return {
    code: raw.member.code, name: raw.member.name, group: raw.member.group,
    attributionVerified: raw.member.attributionVerified, note: raw.member.note,
    price: raw.price, marketCapYi: raw.marketCapYi, floatCapYi: raw.floatCapYi, peTtm: raw.peTtm,
    pePercentile3y: raw.pePercentile3y, peNote: raw.peNote,
    latest, quarters: singleQuarters(raw.reports), deductShare, cashConversion, preview: raw.preview,
    orgNum: raw.forecast?.orgNum ?? null, forwardPe, consensusCagr,
    requiredProfit2028, consensusProfit2026Yi: p26, consensusProfit2028Yi: p28,
    previewQ3Yi, previewCompletion, caveats, scenarios,
    ret20, ret60,
    rs20: ret20 !== null && b20 !== null ? ret20 - b20 : null,
    rs60: ret60 !== null && b60 !== null ? ret60 - b60 : null,
    drawdown250: high && last ? last / high - 1 : null,
    upDownVolume20: upDownVolume(raw.bars, 20),
    dataGaps: gaps,
  }
}

const pct = (v: number | null | undefined, d = 0): string =>
  v === null || v === undefined || !Number.isFinite(v) ? '—' : `${v > 0 ? '+' : ''}${(v * 100).toFixed(d)}%`
const pctPlain = (v: number | null | undefined, d = 0): string =>
  v === null || v === undefined || !Number.isFinite(v) ? '—' : `${(v * 100).toFixed(d)}%`
const num = (v: number | null | undefined, d = 1): string =>
  v === null || v === undefined || !Number.isFinite(v) ? '—' : v.toFixed(d)
const yi = (v: number | null | undefined): string =>
  v === null || v === undefined ? '—' : (v / YI).toFixed(1)

export function renderRerating(views: readonly StockView[], asOf: string, generatedAt: string): string {
  const { horizonEnd, targetAnnualReturn, exitPe } = SCENARIO_ASSUMPTIONS
  const L: string[] = []
  const w = (s = '') => L.push(s)
  w(`# ${RERATING_TITLE}（${asOf}）`)
  w()
  w(`> 证据等级 ${EVIDENCE_LEVEL}：只是数据，不产生买卖动作，不是买入名单。不输出综合评分或排名。`)
  w(`> 生成于 ${generatedAt}（北京时间）。价格与市值取腾讯行情，财报、一致预期与业绩预告取东方财富数据中心；盘中生成时价格为实时价。`)
  w('> 一致预期是券商分析师预测的平均，不是事实，也会滞后于股价；本表只拿它回答「当前市值计入了多少」。')
  w()
  w('## 一、利润兑现（最近报告期，年初至今累计）')
  w()
  w('| 公司 | 报告期 | 营收（亿） | 营收同比 | 归母净利（亿） | 净利同比 | 扣非占比 | 毛利率 | 经营现金流 / 净利 | 三季报预告 |')
  w('|---|---|---|---|---|---|---|---|---|---|')
  for (const v of views) {
    const r = v.latest
    const pv = v.preview
    const preview = pv
      ? `${pv.type} ${num(pv.netProfitLower !== null ? pv.netProfitLower / YI : null)}–${num(pv.netProfitUpper !== null ? pv.netProfitUpper / YI : null)} 亿（${pct(pv.yoyLower !== null ? pv.yoyLower / 100 : null)}~${pct(pv.yoyUpper !== null ? pv.yoyUpper / 100 : null)}），${pv.noticeDate} 发布${v.previewQ3Yi ? `；第三季单季约 ${num(v.previewQ3Yi[0])}–${num(v.previewQ3Yi[1])} 亿` : ''}${v.previewCompletion !== null ? `；已完成一致预期 2026E 的 ${pctPlain(v.previewCompletion)}` : ''}`
      : '未发布'
    w(`| ${v.name} | ${r?.reportDate ?? '—'} | ${yi(r?.revenue)} | ${pct(r?.revenueYoy !== null && r?.revenueYoy !== undefined ? r.revenueYoy / 100 : null)} | ${yi(r?.netProfit)} | ${pct(r?.netProfitYoy !== null && r?.netProfitYoy !== undefined ? r.netProfitYoy / 100 : null)} | ${pctPlain(v.deductShare)} | ${num(r?.grossMargin)}% | ${num(v.cashConversion, 2)} | ${preview} |`)
  }
  w()
  w('### 最近四个单季（由累计值相减得到）')
  w()
  w('| 公司 | 单季归母净利（亿），由近到远 | 单季同比，由近到远 |')
  w('|---|---|---|')
  for (const v of views) {
    const q = v.quarters
    w(`| ${v.name} | ${q.map(x => `${x.reportDate.slice(2, 7)} ${num(x.netProfit !== null ? x.netProfit / YI : null)}`).join(' / ') || '—'} | ${q.map(x => pct(x.netProfitYoy)).join(' / ') || '—'} |`)
  }
  w()
  w('经营现金流 / 净利：1 左右表示利润基本收到了现金；明显低于 1 表示利润还压在应收或存货里，高速扩产期常见，但要追问。')
  w()
  w('## 二、当前市值计入了多少')
  w()
  const years = yearsBetween(asOf, horizonEnd)
  w(`假设（不是规则，数值请委员会定）：持有到 ${horizonEnd}（约 ${years.toFixed(1)} 年），目标年化 ${pctPlain(targetAnnualReturn)}，退出时市盈率 ${exitPe.join(' 或 ')} 倍。`)
  w()
  w(`| 公司 | 现价 | 总市值 / 流通市值（亿） | PE（TTM） | 3 年 PE 分位 | 机构数 | 前瞻 PE 2026E / 2027E / 2028E | 一致预期 2026→2028 年化 | 一致预期 2028 净利（亿） | 2028 需要净利（亿，退出 ${exitPe[0]} / ${exitPe[1]} 倍） |`)
  w('|---|---|---|---|---|---|---|---|---|---|')
  for (const v of views) {
    const fpe = [2026, 2027, 2028].map(y => num(v.forwardPe.find(f => f.year === y)?.pe ?? null)).join(' / ')
    const req = v.requiredProfit2028 ? v.requiredProfit2028.map(r => num(r.yi, 0)).join(' / ') : '—'
    w(`| ${v.name} | ${num(v.price, 2)} | ${num(v.marketCapYi, 0)} / ${num(v.floatCapYi, 0)} | ${num(v.peTtm)} | ${pctPlain(v.pePercentile3y)} | ${v.orgNum ?? '—'} | ${fpe} | ${pct(v.consensusCagr)} | ${num(v.consensusProfit2028Yi, 0)} | ${req} |`)
  }
  w()
  w('读法：一致预期 2028 净利 ≥ 需要净利，说明按一致预期兑现、估值回落到退出倍数时仍能赚到目标年化；低于它，说明当前市值已经计入了比一致预期更多的东西，或者目标年化不可得。')
  w()
  w(`### 情景格：到 ${horizonEnd} 的年化收益（不含分红）`)
  w()
  w(`| 公司 | 一致预期 × ${exitPe[0]} 倍 | 一致预期 × ${exitPe[1]} 倍 | 增速减半 × ${exitPe[0]} 倍 | 增速减半 × ${exitPe[1]} 倍 |`)
  w('|---|---|---|---|---|')
  for (const v of views) {
    const cell = (p: '一致预期' | '增速减半', pe: number) => pct(v.scenarios.find(s => s.profit === p && s.exitPe === pe)?.annualReturn ?? null)
    w(`| ${v.name} | ${cell('一致预期', exitPe[0])} | ${cell('一致预期', exitPe[1])} | ${cell('增速减半', exitPe[0])} | ${cell('增速减半', exitPe[1])} |`)
  }
  w()
  w('「增速减半」= 2026E 利润照一致预期，2027、2028 两年的年增速只有一致预期的一半。这是机械压力测试，不是对公司的悲观判断。')
  w()
  w('## 三、市场是否重新认可（前复权日线，相对沪深 300）')
  w()
  w('| 公司 | 20 日涨跌 | 60 日涨跌 | 20 日相对强弱 | 60 日相对强弱 | 距 250 日高点 | 20 日上涨日 / 下跌日成交量 |')
  w('|---|---|---|---|---|---|---|')
  for (const v of views) {
    w(`| ${v.name} | ${pct(v.ret20, 1)} | ${pct(v.ret60, 1)} | ${pct(v.rs20, 1)} | ${pct(v.rs60, 1)} | ${pct(v.drawdown250, 1)} | ${num(v.upDownVolume20, 2)} |`)
  }
  w()
  w('这一节是观察项。8/13 回测里，价格类判据只有「10 日涨幅超过 50%」被证实有警示力，其余都没有被证明有效，不能单独据此买卖。')
  w()
  w('## 四、主线归因与数据缺口')
  w()
  for (const v of views) {
    const attr = v.attributionVerified === true ? '已核实（作战名单）' : v.attributionVerified === false ? '未通过' : '未核验'
    const gaps = v.dataGaps.length ? v.dataGaps.join('；') : '无'
    w(`- ${v.name}（${v.code}，${v.group}）：主线归因 ${attr}；数据缺口：${gaps}${v.note ? `；${v.note}` : ''}`)
    for (const c of v.caveats) w(`  - 读数提示：${c}`)
  }
  w()
  w('## 五、本表答不了的问题')
  w()
  w('- 订单、客户资本开支、产品迭代、竞争格局：要读财报附注与公告，本表不替代。')
  w('- 成交额占全市场的比重：本表没有接全市场成交额，20 日量比只看个股自身的上涨日与下跌日。')
  w('- 一致预期上修还是下修：本表每次生成都存档，从第二份起才能比较；单份快照看不出方向。')
  w('- 研究区、试仓区、核心配置区的价格：要等委员会定下情景假设与分层门槛后再算，本表不填。')
  return L.join('\n')
}

/** 本模块永不产生动作 */
export function reratingProducesAction(): false {
  return false
}
