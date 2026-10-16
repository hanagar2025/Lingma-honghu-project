/**
 * MA60 模拟对照自检：合成价格验证三种方案的触发、成交、成本、回补假设与隔离边界。
 *
 *   npm -w backend run sim:selftest
 */
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  KEEP_FRACTION, VARIANTS, findSignals, limitDownOpen, median, movingAverage, priceLimit, sellCost,
  simulatePath, simulationProducesAction, summarizeSignals, triggers, type Bar,
} from './ma60'
import { buildReport, renderReport } from './ma60Run'

let pass = 0
let fail = 0
function ok(name: string, cond: boolean) {
  if (cond) { pass++; console.log(`  ✓ ${name}`) } else { fail++; console.log(`  ✗ ${name}`) }
}
const section = (s: string) => console.log(`\n【${s}】`)

const A = VARIANTS.find(v => v.id === 'A_SINGLE')!
const B = VARIANTS.find(v => v.id === 'B_TWO_DAY')!
const C = VARIANTS.find(v => v.id === 'C_REVIEW')!

function day(i: number): string {
  const d = new Date(Date.UTC(2024, 0, 1) + i * 86400_000)
  return d.toISOString().slice(0, 10)
}
function series(closes: number[]): Bar[] {
  return closes.map((c, i) => ({ date: day(i), open: i ? closes[i - 1]! : c, close: c, high: Math.max(c, i ? closes[i - 1]! : c), low: Math.min(c, i ? closes[i - 1]! : c) }))
}

const flat = Array.from({ length: 70 }, () => 100)
const oneDayDip = series([...flat, 95, 101, ...Array.from({ length: 80 }, () => 101)])
const twoDayDip = series([...flat, 95, 94, ...Array.from({ length: 80 }, () => 90)])
const bench = new Map(twoDayDip.map(b => [b.date, 1000]))

section('一、口径')
ok('三种方案齐全：单日确认、两日确认、仅复核', VARIANTS.map(v => v.id).join(',') === 'A_SINGLE,B_TWO_DAY,C_REVIEW')
ok('A 单日确认、B/C 两日确认', A.confirmDays === 1 && B.confirmDays === 2 && C.confirmDays === 2)
ok('只有 A、B 交易，C 不交易', A.trades && B.trades && !C.trades)
ok('「40%」= 该股自身持仓保留 40%（卖出 60%）', KEEP_FRACTION === 0.4)
ok('A 标注为 V1.0 对照组、执行单不调用', A.note.includes('对照组') && A.note.includes('执行单不调用'))

section('二、均线与触发')
const ma = movingAverage(series(Array.from({ length: 61 }, (_, i) => i + 1)))
ok('MA60 前 59 日为空', ma[58] === null && ma[59] !== null)
ok('MA60 = 最近 60 日收盘均值', Math.abs(ma[59]! - 30.5) < 1e-9 && Math.abs(ma[60]! - 31.5) < 1e-9)
ok('单日跌破：A 触发', triggers([false, true], 1, 1))
ok('单日跌破：B 不触发', !triggers([false, true, false], 1, 2) && !triggers([false, true, false], 2, 2))
ok('两日跌破：B 在第二日触发', triggers([false, true, true], 2, 2))
ok('持续在下方不重复触发', !triggers([false, true, true, true], 3, 2) && !triggers([false, true, true], 2, 1))
ok('单日回踩：A 1 次、B 0 次', findSignals('600000', oneDayDip, A, bench).length === 1 && findSignals('600000', oneDayDip, B, bench).length === 0)
ok('两日跌破：A、B 各 1 次', findSignals('600000', twoDayDip, A, bench).length === 1 && findSignals('600000', twoDayDip, B, bench).length === 1)
const sigA = findSignals('600000', oneDayDip, A, bench)[0]!
ok('单日回踩记为来回打脸', sigA.whipsaw)
ok('成交在信号次日开盘', sigA.execDate === oneDayDip[71]!.date && sigA.execPrice === oneDayDip[71]!.open)
ok('起始日之前的信号不计', findSignals('600000', oneDayDip, A, bench, day(100)).length === 0)

section('三、跌停与成本')
ok('科创板 20%、创业板 2020-08-24 前 10% 之后 20%、主板 10%',
  priceLimit('688012', '2019-06-01') === 0.2 && priceLimit('300308', '2020-08-21') === 0.1 && priceLimit('300308', '2020-08-24') === 0.2 && priceLimit('600000', '2024-01-01') === 0.1)
const ld: Bar[] = [...twoDayDip.slice(0, 72)]
ld.push({ date: day(72), open: ld[71]!.close * 0.9, close: ld[71]!.close * 0.9, high: ld[71]!.close * 0.9, low: ld[71]!.close * 0.9 })
ld.push({ date: day(73), open: ld[72]!.close, close: ld[72]!.close, high: ld[72]!.close, low: ld[72]!.close })
for (let i = 74; i < 160; i++) ld.push({ date: day(i), open: 80, close: 80, high: 80, low: 80 })
ok('跌停开盘识别', limitDownOpen('600000', ld, 72) && !limitDownOpen('600000', ld, 73))
const sigLd = findSignals('600000', ld, B, new Map())[0]!
ok('跌停开盘顺延一日成交', sigLd.deferredDays === 1 && sigLd.execDate === day(73))
ok('印花税 2023-08-28 前 0.1%、之后 0.05%', Math.abs(sellCost('2023-08-25') - 0.00225) < 1e-12 && Math.abs(sellCost('2023-08-28') - 0.00175) < 1e-12)

section('四、净值路径')
const pA = simulatePath('600000', twoDayDip, A)!
const pB = simulatePath('600000', twoDayDip, B)!
const pC = simulatePath('600000', twoDayDip, C)!
ok('C 一直持有，无交易无成本', pC.sells === 0 && pC.buys === 0 && pC.costPaid === 0)
ok('A、B 各卖一次且计成本', pA.sells === 1 && pB.sells === 1 && pA.costPaid > 0 && pB.costPaid > 0)
ok('持续下跌中减仓使回撤浅于一直持有', pA.maxDrawdown > pC.maxDrawdown && pB.maxDrawdown > pC.maxDrawdown)
ok('A 比 B 早一天成交（卖得更高）', pA.totalReturn > pB.totalReturn)
const rebound = series([...flat, 95, 94, 93, ...Array.from({ length: 30 }, (_, i) => 94 + i), ...Array.from({ length: 40 }, () => 130)])
const pR = simulatePath('600000', rebound, B)!
ok('回补假设：站回 MA60 两日后买回', pR.sells === 1 && pR.buys === 1)
ok('反弹行情中减仓收益低于一直持有（卖错）', pR.totalReturn < simulatePath('600000', rebound, C)!.totalReturn)

section('五、统计')
const st = summarizeSignals(findSignals('600000', rebound, B, new Map(rebound.map(b => [b.date, 1]))), 1)
ok('反弹后 20 日卖错率 100%', st.falseSell[20] === 1)
ok('卖错时「每次省下」为负', (st.savedPerSignal[20] ?? 0) < 0)
ok('中位数', median([3, 1, 2]) === 2 && median([1, 2, 3, 4]) === 2.5 && median([]) === null)

section('六、报告')
const stocks = [
  { code: '300308', name: '甲', champion: true, mainline: '测试', bars: rebound },
  { code: '600000', name: '乙', champion: false, mainline: '测试', bars: twoDayDip },
]
const rep = buildReport(stocks, rebound)
const md = renderReport(rep)
ok('报告不产生动作', rep.producesAction === false && simulationProducesAction() === false)
ok('报告写明 40% 指该股自身持仓', md.includes('该股票自身持仓') && md.includes('不是组合总资产'))
ok('报告写明文档两处口径不一致', md.includes('第 49 行') && md.includes('第 65 行'))
ok('报告写明统计价值 ≠ 卖出权限', md.includes('统计价值 ≠ 卖出权限'))
ok('报告写明回补只是计算假设', md.includes('回补只是计算假设'))
ok('报告含测试范围、交易成本、信号频率、卖错率、回撤改善', ['测试范围', '交易成本', '每股每年', '卖错率', '回撤改善'].every(k => md.includes(k)))
ok('冠军与其余分开统计', md.includes('冻结冠军') && md.includes('股票池其余'))

section('七、隔离')
const SERVICES = join(fileURLToPath(new URL('.', import.meta.url)), '..')
function tsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? tsFiles(join(dir, e.name)) : e.name.endsWith('.ts') ? [join(dir, e.name)] : [])
}
const actionDirs = ['dailyDecision', 'cockpit', 'tios'].map(d => join(SERVICES, d))
const importers = actionDirs.flatMap(tsFiles).filter(f => /from ['"][./]+(?:\.\.\/)?simulation\//.test(readFileSync(f, 'utf8')))
ok('每日执行单、驾驶舱、交易操作系统都不 import simulation/', importers.length === 0)
const simSrc = tsFiles(join(SERVICES, 'simulation')).filter(f => !f.endsWith('selftest.ts')).map(f => readFileSync(f, 'utf8')).join('\n')
ok('模拟层不 import 动作构造器与风控闸门', !/\b(makeAction|findLimitBreaches|computeCircuit|evaluateActions)\b/.test(simSrc.replace(/\/\*[\s\S]*?\*\//g, '')))
ok('模拟层不读写账本', !/portfolio\.json|ledger/i.test(simSrc.replace(/\/\*[\s\S]*?\*\//g, '')))

console.log(`\n═══ 结果：${pass} 通过 / ${fail} 失败 ═══`)
if (fail) process.exit(1)
