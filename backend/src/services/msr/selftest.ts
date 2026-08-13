// MSR 自检 —— 用构造数据验证不变量，不依赖网络与数据库
// 核心被测不变量：执行未清零时，MSR 输出的可执行候选数必须恒为 0。
// 该不变量若被破坏，等于第10条教训（研究替代执行）在代码层失效。

import { runMsr } from './index'
import { pullbackDepths, upDownVolumeRatio, scoreTrend, runRadar } from './radar'
import { evaluatePriceWindow, evaluatePromotion } from './promotion'
import { buildPeTtmSeries, computeTtmEps, pePercentile, type FinancialReport } from './valuation'
import { MAINLINES, allBenchmarks } from './universe'
import type { DailyBar } from '../tios/types'

let failures = 0
function check(name: string, cond: boolean, extra = ''): void {
  if (cond) {
    process.stdout.write(`  ✓ ${name}\n`)
  } else {
    failures++
    process.stdout.write(`  ✗ ${name} ${extra}\n`)
  }
}

/**
 * 造数日期必须**严格递增且唯一**。
 * 曾用 `2026-${1+(i%12)}-${1+(i%28)}` 生成，200个bar里日期循环重复，
 * 导致 health.ts 按日期取值时取到早期低价bar，四条主线全被误判为 BROAD_RETREAT，
 * 进而 potentialCores 恒为空、多条 .every() 断言空集通过。造数错误会让断言静默失效。
 */
function seqDate(i: number): string {
  const d = new Date(Date.UTC(2025, 0, 1) + i * 86400000)
  return d.toISOString().slice(0, 10)
}

/** 造一段强势上行K线：稳定上涨、上涨日放量 */
function strongBars(n = 200, start = 100): DailyBar[] {
  const out: DailyBar[] = []
  let px = start
  for (let i = 0; i < n; i++) {
    const up = i % 3 !== 0
    px = px * (up ? 1.012 : 0.994)
    out.push({
      date: seqDate(i),
      open: px, high: px * 1.01, low: px * 0.99, close: px,
      volume: up ? 200000 : 90000,
    })
  }
  return out
}

/** 造一段弱势下行K线：稳定下跌、下跌日放量 */
function weakBars(n = 200, start = 200): DailyBar[] {
  const out: DailyBar[] = []
  let px = start
  for (let i = 0; i < n; i++) {
    const up = i % 3 === 0
    px = px * (up ? 1.006 : 0.99)
    out.push({
      date: seqDate(i),
      open: px, high: px * 1.01, low: px * 0.99, close: px,
      volume: up ? 90000 : 220000,
    })
  }
  return out
}

function flatBars(n = 200, start = 100): DailyBar[] {
  return Array.from({ length: n }, (_, i) => ({
    date: seqDate(i),
    open: start, high: start * 1.005, low: start * 0.995, close: start, volume: 100000,
  }))
}

/**
 * 非空断言 —— 对集合做 .every() 前必须先过这一关。
 * 空数组的 .every() 恒为 true，会让断言看起来通过却什么都没测。
 */
function nonEmpty<T>(name: string, arr: T[]): T[] {
  check(`${name}（非空前提，${arr.length}项）`, arr.length > 0)
  return arr
}

process.stdout.write('\n=== MSR 自检 ===\n\n【一】指标函数\n')

check('上涨放量样本 涨跌量比 > 1', (upDownVolumeRatio(strongBars()) ?? 0) > 1)
check('下跌放量样本 涨跌量比 < 1', (upDownVolumeRatio(weakBars()) ?? 9) < 1)
check('横盘样本 涨跌量比为 null（无涨跌日）', upDownVolumeRatio(flatBars()) === null)
check('强势样本 趋势分 ≥ 3', scoreTrend(strongBars()).score >= 3)
check('弱势样本 趋势分 ≤ 1', scoreTrend(weakBars()).score <= 1)
check('回调深度序列全为负值或空', pullbackDepths(strongBars()).every(d => d < 0))

process.stdout.write('\n【二】执行债务闸门不变量（最高优先级条款）\n')

// 构造：全部标的都是最强形态 —— 若闸门失效，必然出现可执行候选
const barsByCode: Record<string, DailyBar[]> = {}
for (const ml of MAINLINES) for (const m of ml.members) barsByCode[m.code] = strongBars()
const indexBarsByCode: Record<string, DailyBar[]> = {}
for (const b of allBenchmarks()) indexBarsByCode[b] = flatBars()

for (const pending of [1, 3, 7, 99]) {
  const rep = runMsr({ date: '2026-08-13', barsByCode, indexBarsByCode, pendingSellCount: pending })
  const actionable = [...rep.reduceCandidates, ...rep.potentialCores, ...rep.noAction].filter(c => c.actionable)
  check(
    `未执行卖单=${pending} 时，可执行候选恒为0（实际${actionable.length}）`,
    actionable.length === 0,
    actionable.map(c => c.radar.name).join(',')
  )
  check(
    `未执行卖单=${pending} 时，闸门标记为locked`,
    rep.executionGate.locked
  )
  check(
    `未执行卖单=${pending} 时，每个标的都带 EXECUTION_DEBT 阻断`,
    [...rep.reduceCandidates, ...rep.potentialCores, ...rep.noAction]
      .every(c => c.blocks.includes('EXECUTION_DEBT'))
  )
}

process.stdout.write('\n【三】清零后仍受其余闸门约束（不得因解锁而放行）\n')
const cleared = runMsr({ date: '2026-08-13', barsByCode, indexBarsByCode, pendingSellCount: 0, marketAllows: true })
check('清零后闸门解锁', !cleared.executionGate.locked)
check('清零后仍无标的带 EXECUTION_DEBT',
  [...cleared.reduceCandidates, ...cleared.potentialCores, ...cleared.noAction]
    .every(c => !c.blocks.includes('EXECUTION_DEBT')))
check('清零后 PE历史分位缺失仍导致评分不完整阻断',
  nonEmpty('潜在新核心', cleared.potentialCores).every(c => c.blocks.includes('SCORE_INCOMPLETE')))
check('清零后 C级清退标的仍被 RETIRED_C_TIER 阻断',
  nonEmpty('C级清退标的', [...cleared.reduceCandidates, ...cleared.potentialCores, ...cleared.noAction]
    .filter(c => ['603986', '688008'].includes(c.radar.code)))
    .every(c => c.blocks.includes('RETIRED_C_TIER')))
check('清零后 只研究主线仍被 RESEARCH_ONLY_MAINLINE 阻断',
  nonEmpty('只研究主线标的', [...cleared.reduceCandidates, ...cleared.potentialCores, ...cleared.noAction]
    .filter(c => c.mainlineId === 'power'))
    .every(c => c.blocks.includes('RESEARCH_ONLY_MAINLINE')))

process.stdout.write('\n【四】价格窗口：深红硬否决 vs 普通红灯只降规模\n')
process.stdout.write('     （2026-08-13 回测证伪"等绿灯提高收益"后的新语义，见 promotion.ts 注释）\n')

/**
 * 造一个典型追涨陷阱：长期横盘后10日暴涨70%，爆量，当日长上影。
 * 这是资金/相对强度/趋势三维都会打高分的形态 —— 若 MSR 会追涨，这里必然放行。
 */
function chaseTrapBars(n = 200): DailyBar[] {
  const out: DailyBar[] = []
  let px = 100
  for (let i = 0; i < n - 10; i++) {
    px = px * (1 + (i % 2 === 0 ? 0.001 : -0.001))
    out.push({ date: `2026-01-${String(1 + (i % 28)).padStart(2, '0')}`, open: px, high: px * 1.005, low: px * 0.995, close: px, volume: 100000 })
  }
  for (let i = 0; i < 10; i++) {
    px = px * 1.055
    const isLast = i === 9
    out.push({
      date: `2026-08-${String(1 + i).padStart(2, '0')}`,
      open: px * 0.98, high: isLast ? px * 1.09 : px * 1.02, low: px * 0.97, close: px,
      volume: isLast ? 900000 : 500000,
    })
  }
  return out
}

const trap = chaseTrapBars()
const trapMember = {
  code: '300308', name: '追涨陷阱样本', tier: 2 as const, node: '测试',
  evidence: 'S' as const, industryVerified: true, earningsVerified: true,
  mainlineAttributionVerified: true, peHistoryPercentile: 0.1,
}
const trapRadar = runRadar(trapMember, trap, flatBars())
const trapWindow = evaluatePriceWindow(trap, trapRadar)
const trapPromo = evaluatePromotion(trapMember, trapRadar, trap, { marketAllows: true, executionCleared: true })

check(`追涨样本资金/趋势确实打高分（资${trapRadar.capital.score} 趋${trapRadar.trend.score}）—— 说明样本有效`,
  trapRadar.capital.score >= 2 || trapRadar.relativeStrength.score >= 3)
check(`追涨样本（10日+70%）判为 RED_EXTREME（实际 ${trapWindow.color}）`,
  trapWindow.color === 'RED_EXTREME', trapWindow.detail)
check('深红样本规模系数为 0（唯一硬否决）', trapWindow.sizeMultiplier === 0)
check('否决项恰为1条（删四留一后，价格窗口只剩10日涨幅>50%一个判据）',
  trapWindow.redFlags.length === 1, trapWindow.redFlags.join(' | '))
check(`追涨样本即便产业+盈利+估值全部满分，也停在 S2 不得建仓（实际 ${trapPromo.stage}）`,
  trapPromo.stage === 'STAGE_2_EARNINGS', trapPromo.blockedBy.join(' | '))

/** 已伸展但未达极端区：10日涨34%，无长上影、无爆量 —— 应放行且规模不打折 */
function moderateRedBars(n = 200): DailyBar[] {
  const out: DailyBar[] = []
  let px = 100
  for (let i = 0; i < n - 10; i++) {
    px = px * (1 + (i % 2 === 0 ? 0.001 : -0.001))
    out.push({ date: `2026-01-${String(1 + (i % 28)).padStart(2, '0')}`, open: px, high: px * 1.005, low: px * 0.995, close: px, volume: 100000 })
  }
  for (let i = 0; i < 10; i++) {
    px = px * 1.03
    out.push({
      date: `2026-08-${String(1 + i).padStart(2, '0')}`,
      open: px * 0.995, high: px * 1.002, low: px * 0.99, close: px, volume: 150000,
    })
  }
  return out
}

const modRed = moderateRedBars()
const modRadar = runRadar(trapMember, modRed, flatBars())
const modWindow = evaluatePriceWindow(modRed, modRadar)
const modPromo = evaluatePromotion(trapMember, modRadar, modRed, { marketAllows: true, executionCleared: true })
check(`已伸展样本（10日+34%）判为 EXTENDED（实际 ${modWindow.color}）`,
  modWindow.color === 'EXTENDED', modWindow.detail)
check('已伸展样本规模系数为 1（纯描述，不打折）', modWindow.sizeMultiplier === 1)
check(`已伸展样本不阻断 S3（实际 ${modPromo.stage}）—— 五个子条件删四留一后的语义`,
  modPromo.stage === 'STAGE_3_PRICE_WINDOW', modPromo.blockedBy.join(' | '))
check('已伸展样本的阻断清单里不含价格窗口理由', !modPromo.blockedBy.some(b => b.includes('价格窗口')))

// 回归测试：被删除的四个子条件不得以任何形式恢复否决权。
// 逐条构造只命中该条件的样本，断言全部放行 —— 防止未来"手感不对"时被悄悄加回。
const deletedFlagCases: Array<[string, () => DailyBar[]]> = [
  ['长上影（实测反向且显著，绝不可恢复）', () => {
    const b = strongBars(200, 100)
    const px = b[b.length - 1].close
    b.push({ date: '2026-08-20', open: px, high: px * 1.12, low: px * 0.99, close: px * 1.0, volume: 120000 })
    return b
  }],
  ['当日爆量>2.5倍', () => {
    const b = strongBars(200, 100)
    const px = b[b.length - 1].close
    b.push({ date: '2026-08-20', open: px, high: px * 1.01, low: px * 0.99, close: px, volume: 900000 })
    return b
  }],
]
for (const [label, make] of deletedFlagCases) {
  const bs = make()
  const w = evaluatePriceWindow(bs, runRadar(trapMember, bs, flatBars()))
  check(`已删除子条件不得恢复否决权：${label}（实际 ${w.color}）`,
    w.color !== 'RED_EXTREME' && w.sizeMultiplier === 1, w.detail)
}

// 对照：同样全部字段满分，但价格贴近均线 —— 必须能晋级 S3，否则闸门是恒假的死锁
const healthyEntry = (() => {
  const b = strongBars(200, 100)
  // 尾部做一次回踩，使价格回到 MA20 附近
  const px = b[b.length - 1].close
  for (let i = 0; i < 8; i++) {
    b.push({ date: `2026-08-${String(20 + i).padStart(2, '0')}`, open: px * 0.99, high: px * 0.995, low: px * 0.96, close: px * (0.985 - i * 0.004), volume: 95000 })
  }
  return b
})()
const heRadar = runRadar(trapMember, healthyEntry, flatBars())
const hePromo = evaluatePromotion(trapMember, heRadar, healthyEntry, { marketAllows: true, executionCleared: true })
check(`健康回踩样本可晋级 S3（实际 ${hePromo.stage}，窗口${hePromo.priceWindow.color}）—— 证明S3不是恒假死锁`,
  hePromo.stage === 'STAGE_3_PRICE_WINDOW', hePromo.blockedBy.join(' | '))

process.stdout.write('\n【五】晋级制不可跳级\n')
const noIndustry = { ...trapMember, industryVerified: false }
const noEarnings = { ...trapMember, earningsVerified: false }
const noAttr = { ...trapMember, mainlineAttributionVerified: false }
const noPe = { ...trapMember, peHistoryPercentile: undefined }
check('产业未验证 → 停在 S0',
  evaluatePromotion(noIndustry, heRadar, healthyEntry, { marketAllows: true, executionCleared: true }).stage === 'STAGE_0_RADAR')
check('盈利未验证 → 停在 S1',
  evaluatePromotion(noEarnings, heRadar, healthyEntry, { marketAllows: true, executionCleared: true }).stage === 'STAGE_1_INDUSTRY')
check('主线归因未核验 → 停在 S1',
  evaluatePromotion(noAttr, heRadar, healthyEntry, { marketAllows: true, executionCleared: true }).stage === 'STAGE_1_INDUSTRY')
check('PE历史分位缺失 → 停在 S2',
  evaluatePromotion(noPe, heRadar, healthyEntry, { marketAllows: true, executionCleared: true }).stage === 'STAGE_2_EARNINGS')
check('市场阶段不允许 → 停在 S2',
  evaluatePromotion(trapMember, heRadar, healthyEntry, { marketAllows: false, executionCleared: true }).stage === 'STAGE_2_EARNINGS')
check('执行未清零 → 停在 S2',
  evaluatePromotion(trapMember, heRadar, healthyEntry, { marketAllows: true, executionCleared: false }).stage === 'STAGE_2_EARNINGS')

process.stdout.write('\n【六】输出只有三类，且互斥、完备\n')
const total = cleared.reduceCandidates.length + cleared.potentialCores.length + cleared.noAction.length
const codes = [...cleared.reduceCandidates, ...cleared.potentialCores, ...cleared.noAction].map(c => c.radar.code)
check('三类输出无重复标的', new Set(codes).size === codes.length)
check('三类输出覆盖全部有效样本', total === codes.length && total > 0)

process.stdout.write('\n【七】PE历史分位：TTM推算、公告日对齐（无未来函数）、坏数据不得放行\n')

const rpt = (
  year: number, quarter: 1 | 2 | 3 | 4, noticeDate: string, basicEps: number | null
): FinancialReport => ({
  reportDate: `${year}-${['03-31', '06-30', '09-30', '12-31'][quarter - 1]}`,
  noticeDate, basicEps, deductEps: null, revenue: null, netProfit: null, quarter, year,
})

// 用中际旭创真实数据校验 TTM 公式：
// 2026Q1 TTM = 2025年报9.80 + 2026Q1累计5.18 - 2025Q1累计1.44 = 13.54
const zjReports: FinancialReport[] = [
  rpt(2026, 1, '2026-04-17', 5.18),
  rpt(2025, 4, '2026-03-31', 9.80),
  rpt(2025, 1, '2025-04-21', 1.44),
  rpt(2024, 4, '2025-04-21', 4.72),
]
const ttmQ1 = computeTtmEps(zjReports, 0)
check(`TTM推算正确：2026Q1 = 9.80+5.18-1.44 = 13.54（实际 ${ttmQ1?.toFixed(2)}）`,
  ttmQ1 !== null && Math.abs(ttmQ1 - 13.54) < 0.005)
check('年报期TTM直接取累计值（2025Q4 = 9.80）', computeTtmEps(zjReports, 1) === 9.8)
check('缺上年同期数据时TTM返回null（宁缺勿估）',
  computeTtmEps([rpt(2026, 2, '2026-08-01', 8.0)], 0) === null)

// 无未来函数：报告期2025-12-31、公告日2026-03-31。
// 2026-02-01 的PE绝不允许使用该期利润 —— 那是三个月后才公布的数字。
const priceBars: DailyBar[] = [
  { date: '2026-02-01', open: 100, high: 100, low: 100, close: 100, volume: 1 },
  { date: '2026-03-30', open: 100, high: 100, low: 100, close: 100, volume: 1 },
  { date: '2026-04-01', open: 100, high: 100, low: 100, close: 100, volume: 1 },
]
const series = buildPeTtmSeries(priceBars, [rpt(2025, 4, '2026-03-31', 5.0), rpt(2024, 4, '2025-03-28', 4.0)])
const before = series.find(p => p.date === '2026-02-01')
const after = series.find(p => p.date === '2026-04-01')
check('公告日前一日不得使用该期财报（2026-02-01 应取上一期年报4.00）',
  before !== undefined && Math.abs(before.ttmEps - 4.0) < 1e-9, `实际 ${before?.ttmEps}`)
check('公告日后使用新财报（2026-04-01 应取5.00 → PE=20）',
  after !== undefined && Math.abs((after.pe ?? 0) - 20) < 1e-9, `实际 PE=${after?.pe}`)
check('公告日当日边界：<=当日即可见（2026-03-30 仍取旧期）',
  series.find(p => p.date === '2026-03-30')?.ttmEps === 4.0)

// 坏数据不得产出分位：TTM亏损时必须返回 null，不得退用窗口内最后一个有效PE
const lossBars: DailyBar[] = Array.from({ length: 200 }, (_, i) => ({
  date: `2026-${String(1 + (i % 12)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}`,
  open: 100, high: 100, low: 100, close: 100, volume: 1,
}))
const lossSeries = buildPeTtmSeries(lossBars, [rpt(2020, 4, '2021-01-01', 5.0)])
const lossSeriesTail = [...lossSeries]
lossSeriesTail[lossSeriesTail.length - 1] = {
  ...lossSeriesTail[lossSeriesTail.length - 1], ttmEps: -0.02, pe: null,
}
check('最新PE为空（TTM亏损）时分位必须为null，不得退用陈旧PE',
  pePercentile(lossSeriesTail, 750) === null)
check('有效样本不足60个时分位为null', pePercentile(lossSeries.slice(0, 30), 750) === null)

// 坏数据注入 MSR 时，必须继续阻断 S3（坏数据与无数据同等对待）
const badVal = { peTtm: 16810, percentile3y: 0.96, usable: false, note: 'PE极端' }
const withBad = runMsr({
  date: '2026-08-13', barsByCode, indexBarsByCode, pendingSellCount: 0, marketAllows: true,
  valuationByCode: Object.fromEntries(MAINLINES.flatMap(ml => ml.members).map(m => [m.code, badVal])),
})
check('usable=false 的估值数据不得注入，S3 仍被阻断',
  nonEmpty('全部候选', [...withBad.reduceCandidates, ...withBad.potentialCores, ...withBad.noAction])
    .every(c => c.promotion.stage !== 'STAGE_3_PRICE_WINDOW'))

// 正常数据注入后，S3 必须可达（否则闸门是恒假死锁）
const goodVal = { peTtm: 30, percentile3y: 0.15, usable: true, note: 'ok' }
const withGood = runMsr({
  date: '2026-08-13', barsByCode, indexBarsByCode, pendingSellCount: 0, marketAllows: true,
  valuationByCode: Object.fromEntries(MAINLINES.flatMap(ml => ml.members).map(m => [m.code, goodVal])),
})
check('注入低分位估值后估值维度不再为0分（应得满分5）',
  nonEmpty('全部候选', [...withGood.reduceCandidates, ...withGood.potentialCores, ...withGood.noAction])
    .every(c => c.radar.valuation.score === 5))
check('高分位（>80%）估值必须触发 VALUATION_PERCENTILE_HIGH 阻断', (() => {
  const high = { peTtm: 200, percentile3y: 0.96, usable: true, note: 'ok' }
  const rep = runMsr({
    date: '2026-08-13', barsByCode, indexBarsByCode, pendingSellCount: 0, marketAllows: true,
    valuationByCode: Object.fromEntries(MAINLINES.flatMap(ml => ml.members).map(m => [m.code, high])),
  })
  return nonEmpty('全部候选', [...rep.reduceCandidates, ...rep.potentialCores, ...rep.noAction])
    .every(c => c.blocks.includes('VALUATION_PERCENTILE_HIGH'))
})())

process.stdout.write('\n【八】实测能力披露必须随报告输出（防止"发现"被读成"已验证"）\n')
check('报告带 backtest 字段', cleared.backtest !== undefined)
check('披露中入场优势标记为不显著', cleared.backtest.entryEdge20d.significant === false)
check('披露中置信区间确实跨0',
  cleared.backtest.entryEdge20d.ci95[0] < 0 && cleared.backtest.entryEdge20d.ci95[1] > 0)
check('结论文本包含实测披露字样', cleared.conclusion.includes('实测披露'))
check('每个候选都带 sizeMultiplier',
  [...cleared.reduceCandidates, ...cleared.potentialCores, ...cleared.noAction]
    .every(c => typeof c.sizeMultiplier === 'number'))

process.stdout.write(`\n=== 结果：${failures === 0 ? '全部通过' : `${failures} 项失败`} ===\n\n`)
if (failures > 0) process.exit(1)
