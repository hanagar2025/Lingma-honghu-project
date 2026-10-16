/**
 * MA60 模拟对照运行脚本：拉 MSR 股票池 2019 年以来前复权日 K 与沪深 300，跑三种方案，写报告。
 *
 *   npm -w backend run sim:ma60
 *
 * 只写 share/simulation/ 与研究报告；不读写账本、不生成任何卖单，每日执行单不调用。
 * 环境变量：SIM_FROM（默认 2019-01-01）、SIM_OOS（样本外起点，默认 2024-01-01）、SIM_CACHE（日 K 缓存目录）。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MAINLINES } from '../msr/universe'
import {
  BUY_COST, COSTS, KEEP_FRACTION, VARIANTS, WHIPSAW_DAYS,
  findSignals, simulatePath, summarizePaths, summarizeSignals,
  type Bar, type PathResult, type PathStats, type SignalRecord, type SignalStats, type VariantId,
} from './ma60'

const HERE = fileURLToPath(new URL('.', import.meta.url))
const ROOT = join(HERE, '..', '..', '..', '..')
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
const FROM = process.env.SIM_FROM ?? '2019-01-01'
const OOS = process.env.SIM_OOS ?? '2024-01-01'
const WARMUP_FROM = `${+FROM.slice(0, 4) - 1}-09-01`
const CACHE = process.env.SIM_CACHE ?? '/tmp/honghu-sim-kline'
const BENCH = 'sh000300'

const sym = (code: string) => code.startsWith('sh') || code.startsWith('sz') ? code : (/^[69]/.test(code) ? `sh${code}` : `sz${code}`)
const today = () => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10)

async function fetchRange(s: string, start: string, end: string): Promise<Bar[]> {
  const url = `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${s},day,${start},${end},640,qfq`
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url, { headers: { Referer: 'https://gu.qq.com/', 'User-Agent': UA } })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json() as any
      const rows: string[][] = json?.data?.[s]?.qfqday ?? json?.data?.[s]?.day ?? []
      return rows.map(r => ({ date: r[0]!, open: +r[1]!, close: +r[2]!, high: +r[3]!, low: +r[4]! }))
    } catch (e) {
      if (attempt === 3) throw e
      await new Promise(r => setTimeout(r, 1000 * (1 << attempt)))
    }
  }
  return []
}

/** 腾讯单次最多约 640 根，按自然年分段拉取。 */
async function fetchBars(code: string, end: string): Promise<Bar[]> {
  const s = sym(code)
  const file = join(CACHE, `${s}-${WARMUP_FROM}-${end}.json`)
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'))
  const out: Bar[] = []
  for (let y = +WARMUP_FROM.slice(0, 4); y <= +end.slice(0, 4); y++) {
    const a = y === +WARMUP_FROM.slice(0, 4) ? WARMUP_FROM : `${y}-01-01`
    const b = y === +end.slice(0, 4) ? end : `${y}-12-31`
    out.push(...await fetchRange(s, a, b))
  }
  const bars = [...new Map(out.map(b => [b.date, b])).values()]
    .filter(b => b.open > 0 && b.close > 0 && b.high > 0 && b.low > 0)
    .sort((x, y) => x.date.localeCompare(y.date))
  mkdirSync(CACHE, { recursive: true })
  writeFileSync(file, JSON.stringify(bars))
  return bars
}

interface Stock { code: string; name: string; champion: boolean; mainline: string; bars: Bar[] }

type GroupId = 'ALL' | 'CHAMPION' | 'OTHER'
type PeriodId = 'FULL' | 'IN_SAMPLE' | 'OUT_OF_SAMPLE'
const GROUP_NAME: Record<GroupId, string> = { ALL: '股票池全部', CHAMPION: '冻结冠军', OTHER: '股票池其余' }
const PERIOD_NAME: Record<PeriodId, string> = { FULL: '全期', IN_SAMPLE: '样本内', OUT_OF_SAMPLE: '样本外' }

export interface Ma60Report {
  id: 'SIM-MA60'
  generatedAt: string
  range: { from: string; to: string; outOfSampleFrom: string; benchmark: string }
  costs: typeof COSTS & { buy: number }
  stocks: { code: string; name: string; champion: boolean; mainline: string; bars: number; firstDate: string }[]
  signals: Record<VariantId, Record<GroupId, Record<PeriodId, SignalStats>>>
  paths: Record<VariantId, Record<GroupId, Record<'FULL' | 'OUT_OF_SAMPLE', PathStats>>>
  perStock: { code: string; name: string; champion: boolean; signalsA: number; signalsB: number; path: Record<VariantId, PathResult | null> }[]
  records: SignalRecord[]
  producesAction: false
}

function inPeriod(date: string, p: PeriodId): boolean {
  if (p === 'IN_SAMPLE') return date >= FROM && date < OOS
  if (p === 'OUT_OF_SAMPLE') return date >= OOS
  return date >= FROM
}

function stockYears(stocks: Stock[], p: PeriodId): number {
  let n = 0
  for (const s of stocks) n += s.bars.slice(59).filter(b => inPeriod(b.date, p)).length
  return n / 244
}

export function buildReport(stocks: Stock[], bench: Bar[]): Ma60Report {
  const benchClose = new Map(bench.map(b => [b.date, b.close]))
  const groupOf = (g: GroupId) => stocks.filter(s => g === 'ALL' || (g === 'CHAMPION') === s.champion)
  const records: SignalRecord[] = []
  for (const v of VARIANTS) for (const s of stocks) records.push(...findSignals(s.code, s.bars, v, benchClose, FROM))
  const signals = {} as Ma60Report['signals']
  const paths = {} as Ma60Report['paths']
  const pathRows: Record<string, PathResult | null> = {}
  for (const v of VARIANTS) {
    signals[v.id] = {} as Record<GroupId, Record<PeriodId, SignalStats>>
    paths[v.id] = {} as Record<GroupId, Record<'FULL' | 'OUT_OF_SAMPLE', PathStats>>
    for (const s of stocks) {
      pathRows[`${v.id}|${s.code}|FULL`] = simulatePath(s.code, s.bars, v, FROM)
      pathRows[`${v.id}|${s.code}|OUT_OF_SAMPLE`] = simulatePath(s.code, s.bars, v, OOS)
    }
    for (const g of ['ALL', 'CHAMPION', 'OTHER'] as GroupId[]) {
      const members = groupOf(g)
      const codes = new Set(members.map(s => s.code))
      signals[v.id][g] = {} as Record<PeriodId, SignalStats>
      for (const p of ['FULL', 'IN_SAMPLE', 'OUT_OF_SAMPLE'] as PeriodId[]) {
        const rows = records.filter(r => r.variant === v.id && codes.has(r.code) && inPeriod(r.signalDate, p))
        signals[v.id][g][p] = summarizeSignals(rows, stockYears(members, p))
      }
      paths[v.id][g] = {
        FULL: summarizePaths(members.map(s => pathRows[`${v.id}|${s.code}|FULL`]).filter((x): x is PathResult => !!x)),
        OUT_OF_SAMPLE: summarizePaths(members.map(s => pathRows[`${v.id}|${s.code}|OUT_OF_SAMPLE`]).filter((x): x is PathResult => !!x)),
      }
    }
  }
  const lastDate = stocks.flatMap(s => s.bars.slice(-1).map(b => b.date)).sort().pop() ?? FROM
  return {
    id: 'SIM-MA60',
    generatedAt: new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 16).replace('T', ' '),
    range: { from: FROM, to: lastDate, outOfSampleFrom: OOS, benchmark: '沪深300（sh000300）' },
    costs: { ...COSTS, buy: BUY_COST },
    stocks: stocks.map(s => ({ code: s.code, name: s.name, champion: s.champion, mainline: s.mainline, bars: s.bars.length, firstDate: s.bars[0]?.date ?? '' })),
    signals, paths,
    perStock: stocks.map(s => ({
      code: s.code, name: s.name, champion: s.champion,
      signalsA: records.filter(r => r.variant === 'A_SINGLE' && r.code === s.code).length,
      signalsB: records.filter(r => r.variant === 'B_TWO_DAY' && r.code === s.code).length,
      path: Object.fromEntries(VARIANTS.map(v => [v.id, pathRows[`${v.id}|${s.code}|FULL`] ?? null])) as Record<VariantId, PathResult | null>,
    })),
    records,
    producesAction: false,
  }
}

const pct = (x: number | null | undefined, d = 1) => x == null ? '—' : `${(x * 100).toFixed(d)}%`
const num = (x: number | null | undefined, d = 2) => x == null ? '—' : x.toFixed(d)

export function renderReport(r: Ma60Report): string {
  const L: string[] = []
  const vName = (id: VariantId) => VARIANTS.find(v => v.id === id)!.name
  L.push(`# MA60 模拟对照报告 SIM-MA60（${r.range.to}）`)
  L.push('')
  L.push('> 只做模拟统计，不产生动作。每日执行单不调用本报告与 MA60 规则；实盘卖出纪律仍为 C 级清退 → 单票归位 → 熔断（熔断在峰值核验前不执行、不撤销）。')
  L.push('> 统计价值 ≠ 卖出权限：任何结论要改执行单，必须另行提交委员会裁定。')
  L.push('')
  L.push('## 摘要（股票池全部，全期）')
  L.push('')
  const baseC = r.paths.C_REVIEW.ALL.FULL
  for (const v of VARIANTS.filter(v => v.trades)) {
    const s = r.signals[v.id].ALL.FULL
    const p = r.paths[v.id].ALL.FULL
    const imp = p.meanMdd != null && baseC.meanMdd != null ? (p.meanMdd - baseC.meanMdd) * 100 : null
    L.push(`- ${vName(v.id)}：每股每年 ${num(s.perStockYear, 1)} 次信号；20 日卖错率 ${pct(s.falseSell[20])}、60 日 ${pct(s.falseSell[60])}；来回打脸 ${pct(s.whipsawRate)}；平均最大回撤 ${pct(p.meanMdd)}（一直持有 ${pct(baseC.meanMdd)}，改善 ${imp == null ? '—' : imp.toFixed(1)} 个百分点）；中位总收益 ${pct(p.medianReturn, 0)}（一直持有 ${pct(baseC.medianReturn, 0)}）。`)
  }
  L.push(`- 方案 C：同方案 B 的信号只进入复核，不交易；回撤与收益即一直持有。`)
  const sa = r.signals.A_SINGLE.ALL.FULL, sb = r.signals.B_TWO_DAY.ALL.FULL
  const pa = r.paths.A_SINGLE.ALL.FULL, pb = r.paths.B_TWO_DAY.ALL.FULL
  const reading = [
    (pa.meanMdd ?? -1) > (baseC.meanMdd ?? 0) && (pb.meanMdd ?? -1) > (baseC.meanMdd ?? 0) ? '两种减仓方案都让平均回撤变浅' : '减仓方案没有一致地让回撤变浅',
    (sa.falseSell[20] ?? 0) > 0.5 && (sb.falseSell[20] ?? 0) > 0.5 ? '但一半以上的卖出事后看是卖错' : '',
    (pa.medianReturn ?? 0) < (baseC.medianReturn ?? 0) && (pb.medianReturn ?? 0) < (baseC.medianReturn ?? 0) ? '长期收益低于一直持有' : '',
    sb.signals < sa.signals ? `两日确认比单日确认少 ${pct(1 - sb.signals / Math.max(1, sa.signals), 0)} 信号` : '',
    (sb.whipsawRate ?? 1) < (sa.whipsawRate ?? 0) ? '来回打脸更少' : '',
    (pb.meanMdd ?? 0) < (pa.meanMdd ?? 0) ? '回撤改善也更小' : '',
  ].filter(Boolean)
  L.push(`- 读法（由数据自动判断）：${reading.join('；')}。`)
  L.push('')
  L.push('## 一、口径')
  L.push('')
  L.push(`- 「减到 40%」指「该股票自身持仓」的 40%（卖出 ${pct(1 - KEEP_FRACTION, 0)}），不是组合总资产的 40%。`)
  L.push('- V1.0 文档原有两处写法：第 49 行「减持至原仓位的 40% 以下（即累计至少减 60%）」，第 65 行个股示例写「减 40%」。委员会 2026-10-16 裁定以第 49 行为 V1.0 历史规则口径，即「减持至该股原持仓的 40% 以下」；第 65 行已在文档中标注为作废的旧示例。代码 `tios/executionEngine.ts` 与本模拟都按第 49 行计算。')
  L.push('- 这项裁定只统一历史规则的解释，不批准 MA60 实盘自动卖出。三种方案都留在模拟层，不能仅凭本报告的回测结果进入每日执行单。')
  L.push('- 三种方案：')
  for (const v of VARIANTS) L.push(`  - ${v.name}：${v.confirmDays === 1 ? '收盘跌破当日触发' : '连续两日收盘低于 MA60 触发'}；${v.trades ? `次日开盘减到该股持仓的 ${pct(KEEP_FRACTION, 0)}` : '只记录、不交易'}。${v.note}`)
  L.push('- 方案 A、B 是规则候选的统计检验；方案 C 是现行口径（8/13 裁定）。')
  L.push('')
  L.push('## 二、测试范围')
  L.push('')
  const champs = r.stocks.filter(s => s.champion).length
  L.push(`- 样本：MSR 股票池 ${r.stocks.length} 只（冻结冠军 ${champs} 只、其余 ${r.stocks.length - champs} 只），前复权日 K（腾讯）。上市晚于起点的股票从上市满 60 日起算。`)
  L.push(`- 区间：${r.range.from} 至 ${r.range.to}；样本内 ${r.range.from} 至 ${r.range.outOfSampleFrom} 前，样本外 ${r.range.outOfSampleFrom} 起。基准 ${r.range.benchmark}。`)
  L.push(`- 交易成本：卖出 = 佣金 ${pct(r.costs.commission, 3)} + 滑点 ${pct(r.costs.slippage, 2)} + 印花税（2023-08-28 前 ${pct(r.costs.stampBefore20230828, 2)}，之后 ${pct(r.costs.stampFrom20230828, 2)}）；买回 = 佣金 + 滑点 ${pct(r.costs.buy, 3)}。`)
  L.push('- 跌停开盘无法卖出：顺延到第一个非跌停开盘日成交（科创板 20%；创业板 2020-08-24 起 20%；其余 10%；未处理 ST）。')
  L.push(`- 「卖错率」：成交后 H 个交易日个股收益仍高于卖出成本的信号占比（卖掉的部分本可以赚回来）。「来回打脸」：信号后 ${WHIPSAW_DAYS} 个交易日内收盘重新站上 MA60。`)
  L.push('- 路径回撤需要回补假设才能比较：减仓后收盘连续两日站上 MA60，次日开盘买回满仓。「回补只是计算假设，不是规则建议」；V1.0 与委员会都没有裁定回补条款。')
  L.push('')
  L.push('## 三、信号统计（逐次信号，事件研究）')
  L.push('')
  for (const g of ['ALL', 'CHAMPION', 'OTHER'] as GroupId[]) {
    L.push(`### ${GROUP_NAME[g]}`)
    L.push('')
    L.push('| 方案 | 区间 | 信号数 | 每股每年 | 20 日卖错率 | 60 日卖错率 | 20 日均收益 | 60 日均收益 | 60 日超额（对沪深300） | 每次省下（20 日） | 每次省下（60 日） | 60 日最大不利 | 来回打脸 | 跌停顺延 |')
    L.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|')
    for (const v of VARIANTS.filter(v => v.trades)) {
      for (const p of ['FULL', 'IN_SAMPLE', 'OUT_OF_SAMPLE'] as PeriodId[]) {
        const s = r.signals[v.id][g][p]
        L.push(`| ${vName(v.id)} | ${PERIOD_NAME[p]} | ${s.signals} | ${num(s.perStockYear)} | ${pct(s.falseSell[20])} | ${pct(s.falseSell[60])} | ${pct(s.meanFwd[20])} | ${pct(s.meanFwd[60])} | ${pct(s.meanExcess[60])} | ${pct(s.savedPerSignal[20], 2)} | ${pct(s.savedPerSignal[60], 2)} | ${pct(s.meanMae60)} | ${pct(s.whipsawRate)} | ${s.deferred} |`)
      }
    }
    L.push('')
  }
  L.push('「每次省下」= 卖出份额 60% ×（−成交后收益 − 卖出成本），单位为该股持仓；正数表示减仓有利，负数表示减仓吃亏。方案 C 的信号与方案 B 相同、不交易，省下恒为 0。')
  L.push('')
  L.push('## 四、不同退出时点（相对信号日收盘的价格变化，全部样本、全期）')
  L.push('')
  L.push('| 方案 | T+1 开盘 | T+3 收盘 | T+5 收盘 | 20 日后 | 60 日后 |')
  L.push('|---|---|---|---|---|---|')
  for (const v of VARIANTS.filter(v => v.trades)) {
    const s = r.signals[v.id].ALL.FULL
    L.push(`| ${vName(v.id)} | ${pct(s.exitTiming.t1Open, 2)} | ${pct(s.exitTiming.t3Close, 2)} | ${pct(s.exitTiming.t5Close, 2)} | ${pct(s.meanFwd[20], 2)} | ${pct(s.meanFwd[60], 2)} |`)
  }
  L.push('')
  L.push('正数表示比信号日收盘价卖得更高（晚卖更好），负数表示越晚越吃亏；20 日、60 日两列从成交价起算。')
  L.push('')
  L.push('## 五、净值路径与回撤（单票平均，含回补假设）')
  L.push('')
  L.push('| 分组 | 区间 | 方案 | 平均总收益 | 中位总收益 | 平均最大回撤 | 中位最大回撤 | 回撤改善（对方案 C，平均） | 平均卖出次数 | 累计成本（占初始投入） |')
  L.push('|---|---|---|---|---|---|---|---|---|---|')
  for (const g of ['ALL', 'CHAMPION', 'OTHER'] as GroupId[]) {
    for (const p of ['FULL', 'OUT_OF_SAMPLE'] as const) {
      const base = r.paths.C_REVIEW[g][p]
      for (const v of VARIANTS) {
        const s = r.paths[v.id][g][p]
        const imp = s.meanMdd != null && base.meanMdd != null ? s.meanMdd - base.meanMdd : null
        L.push(`| ${GROUP_NAME[g]} | ${PERIOD_NAME[p]} | ${vName(v.id)} | ${pct(s.meanReturn)} | ${pct(s.medianReturn)} | ${pct(s.meanMdd)} | ${pct(s.medianMdd)} | ${v.id === 'C_REVIEW' ? '基准' : (imp == null ? '—' : `${imp >= 0 ? '+' : ''}${(imp * 100).toFixed(1)} 个百分点`)} | ${num(s.meanSells, 1)} | ${pct(s.meanCost, 2)} |`)
      }
    }
  }
  L.push('')
  L.push('回撤改善为正表示该方案的平均最大回撤比一直持有更浅。累计成本按每笔成交金额计，随净值增长而放大，单位是初始投入。')
  L.push('')
  L.push('## 六、逐只明细（全期）')
  L.push('')
  L.push('| 代码 | 名称 | 冠军 | A 信号 | B 信号 | C 总收益 | A 总收益 | B 总收益 | C 最大回撤 | A 最大回撤 | B 最大回撤 |')
  L.push('|---|---|---|---|---|---|---|---|---|---|---|')
  for (const s of r.perStock) {
    const p = s.path
    L.push(`| ${s.code} | ${s.name} | ${s.champion ? '是' : ''} | ${s.signalsA} | ${s.signalsB} | ${pct(p.C_REVIEW?.totalReturn, 0)} | ${pct(p.A_SINGLE?.totalReturn, 0)} | ${pct(p.B_TWO_DAY?.totalReturn, 0)} | ${pct(p.C_REVIEW?.maxDrawdown)} | ${pct(p.A_SINGLE?.maxDrawdown)} | ${pct(p.B_TWO_DAY?.maxDrawdown)} |`)
  }
  L.push('')
  L.push('## 七、边界')
  L.push('')
  L.push('- 本报告不改变执行单：每日执行单不 import `simulation/`，审计脚本 `npm -w backend run ladder:audit` 逐条核对。')
  L.push('- 样本是今天的股票池（含幸存者偏差：池内股票多是事后表现好的 AI/半导体标的），结论偏向「一直持有」。')
  L.push('- 未模拟：盘中触发、停牌（日 K 缺失日视为无交易）、仓位在组合层的再分配、熔断与单票归位的叠加。')
  L.push('- 是否采用任何一个方案，由委员会依据本报告另行裁定；采用前还须接入交易所日历。')
  return L.join('\n') + '\n'
}

async function main() {
  const end = today()
  const members = MAINLINES.flatMap(m => m.members.map(x => ({ ...x, mainline: m.name })))
  const stocks: Stock[] = []
  for (const m of members) {
    const bars = await fetchBars(m.code, end)
    if (bars.length < 80) { console.warn(`${m.code} ${m.name} 日 K 不足，跳过`); continue }
    stocks.push({ code: m.code, name: m.name, champion: !!m.champion, mainline: m.mainline, bars })
  }
  const bench = await fetchBars(BENCH, end)
  const report = buildReport(stocks, bench)
  const md = renderReport(report)
  const outDir = join(ROOT, 'share', 'simulation')
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, 'ma60-latest.md'), md)
  const { records, ...summary } = report
  writeFileSync(join(outDir, 'ma60-latest.json'), JSON.stringify({ ...summary, signalCount: records.length }, null, 2) + '\n')
  writeFileSync(join(ROOT, '战略组合2026-2030', `MA60模拟对照报告-${report.range.to}.md`), md)
  console.log(`已写 share/simulation/ma60-latest.md、ma60-latest.json 与 战略组合2026-2030/MA60模拟对照报告-${report.range.to}.md（${stocks.length} 只，信号 ${records.length} 条）`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(e => { console.error(e); process.exit(1) })
}
