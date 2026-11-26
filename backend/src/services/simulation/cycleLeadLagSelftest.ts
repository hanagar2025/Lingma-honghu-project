/**
 * SIM-LEADLAG 自检：合成数据验证单季推算、拐点识别、价格信号、命中与误报、随机基准和边界。不联网。
 *
 *   npm -w backend run sim:leadlag:selftest
 */
import {
  LEADLAG, analyzeStock, earningsTurns, leadLagDeclaresRule, leadLagProducesAction, priceEpisodes,
  singleQuarters, summarizeNode, type DeductRow,
} from './cycleLeadLag'
import { renderLeadLag, type LeadLagReport } from './cycleLeadLagRun'
import type { Bar } from './ma60'

let pass = 0
let fail = 0
function ok(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`) } else { fail++; console.log(`  ✗ ${name}${detail ? `：${detail}` : ''}`) }
}
const section = (s: string) => console.log(`\n【${s}】`)
const STARS = '*'.repeat(2)

section('一、单季扣非与利润拐点')
const cum = (y: number, q: number[]): DeductRow[] => {
  const ends = ['03-31', '06-30', '09-30', '12-31']
  let acc = 0
  return q.map((v, i) => { acc += v; return { reportDate: `${y}-${ends[i]}`, noticeDate: `${y}-${['04-28', '08-28', '10-28'][i] ?? `${y + 1}-04-28`}`.slice(-10), cumDeduct: acc } })
}
const rows = [...cum(2020, [10, 10, 10, 10]), ...cum(2021, [12, 12, 8, 13]), ...cum(2022, [14, 15, 16, 17])]
for (const r of rows) if (r.reportDate.endsWith('12-31')) r.noticeDate = `${+r.reportDate.slice(0, 4) + 1}-04-28`
const qs = singleQuarters(rows)
ok('累计值相减得到单季值', qs.find(q => q.reportDate === '2021-09-30')?.value === 8 && qs.find(q => q.reportDate === '2021-12-31')?.value === 13)
const turns = earningsTurns(qs)
ok('单季扣非由不低于上年同季转为低于上年同季，记一次拐点', turns.length === 1 && turns[0]!.reportDate === '2021-09-30' && turns[0]!.sameQuarterLastYear === 10)
ok('拐点日期取公告日', turns[0]!.noticeDate === '2021-10-28')
ok('缺上一期累计值的季度不推算', singleQuarters([{ reportDate: '2021-06-30', noticeDate: '2021-08-28', cumDeduct: 5 }]).length === 0)
ok('连续低于上年同季只记首次', earningsTurns(singleQuarters([...cum(2020, [10, 10, 10, 10]), ...cum(2021, [11, 9, 9, 9])].map(r => r.reportDate.endsWith('12-31') ? { ...r, noticeDate: `${+r.reportDate.slice(0, 4) + 1}-04-28` } : r))).length === 1)

section('二、价格信号')
const day = (i: number) => new Date(Date.UTC(2019, 0, 1) + i * 86400_000).toISOString().slice(0, 10)
const mk = (closes: number[]): Bar[] => closes.map((c, i) => ({ date: day(i), open: c, close: c, high: c, low: c }))
const up = Array.from({ length: 200 }, (_, i) => 100 + i * 0.5)
const fall = Array.from({ length: 100 }, (_, i) => 200 - i * 1.5)
const recover = Array.from({ length: 400 }, (_, i) => 50 + i * 0.5)
const closes = [...up, ...fall, ...recover]
const bars = mk(closes)
const flatBench = new Map(bars.map(b => [b.date, 1000]))
const ep = priceEpisodes(bars, flatBench)
ok('趋势破位且跑输基准时出现一次信号', ep.starts.length === 1 && ep.starts[0]! > 200 && ep.starts[0]! < 230, ep.starts.join(','))
const strongBench = new Map(bars.map((b, i) => [b.date, 1000 * (1 + i * 0.0001)]))
const weakBench = new Map(bars.map((b, i) => [b.date, i < 200 ? 1000 : 1000 * (1 - (i - 200) * 0.01)]))
ok('股票跌但基准跌得更多（没有跑输）：不出信号', priceEpisodes(bars, weakBench).starts.every(s => s < 200 || s > 300))
ok('基准缺失的日子不可检验，不当成信号', priceEpisodes(bars, new Map()).starts.length === 0 && priceEpisodes(bars, new Map()).evaluable.every(x => !x))
ok('与信号无关的基准变化不影响一致性', priceEpisodes(bars, strongBench).starts.length >= 1)

section('三、命中、领先期、误报、随机基准')
const noticeIdx = 400
const turn = [{ reportDate: day(330), noticeDate: day(noticeIdx), value: 1, sameQuarterLastYear: 2 }]
const s1 = analyzeStock({ code: 'X', name: 'X', node: 'OPTICAL', benchmark: 'B' }, bars, flatBench, turn, day(0))
const t1 = s1.turns[0]
ok('公告日前窗口内有信号 → 命中，领先期 = 公告日与最近信号相隔交易日', !!t1?.hit && t1.leadToNotice === noticeIdx - ep.starts[0]!, JSON.stringify(t1))
ok('领先报告期末可为正（信号早于期末）', (t1?.leadToPeriodEnd ?? 0) > 0)
const s2 = analyzeStock({ code: 'X', name: 'X', node: 'OPTICAL', benchmark: 'B' }, bars, flatBench, [{ ...turn[0]!, noticeDate: day(150), reportDate: day(100) }], day(0))
ok('拐点前行情不足 250 日：不检验（计入未检验），不当成失败', s2.turns.length === 0 && s2.skippedTurns === 1)
const s3 = analyzeStock({ code: 'X', name: 'X', node: 'OPTICAL', benchmark: 'B' }, bars, flatBench, [], day(0))
ok('信号后 250 日内没有拐点 → 误报', s3.signals.length === 1 && s3.signals[0]!.outcome === 'FALSE_ALARM')
const s60 = analyzeStock({ code: 'X', name: 'X', node: 'OPTICAL', benchmark: 'B' }, bars, flatBench, turn, day(0), 60)
ok('窗口可调：60 日窗口内没有信号则不算命中', s60.turns.length === 1 && s60.turns[0]!.hit === (noticeIdx - ep.starts[0]! <= 60))
ok('随机基准在 0 与 1 之间', s3.coverage != null && s3.coverage >= 0 && s3.coverage <= 1)

section('四、逐节点汇总与结论措辞')
const few = summarizeNode('OPTICAL', [s1], '2024-01-01')
ok(`拐点少于 ${LEADLAG.minTurnsPerNode} 次 → 写「样本不足」，不比较`, few.verdict.startsWith('样本不足'))
const many = Array.from({ length: LEADLAG.minTurnsPerNode }, () => s1)
const big = summarizeNode('OPTICAL', many, '2024-01-01')
ok('样本足够时也不宣布领先规律', !/存在稳定领先|领先规律成立|可以据此/.test(big.verdict) && (big.verdict.includes('不宣布') || big.verdict.includes('没有表现出可区分的领先信息')))
ok('命中率比随机基准高不到 5 个百分点时写「没有表现出可区分的领先信息」', (() => {
  const s = { ...s1, coverage: 1 }
  return summarizeNode('OPTICAL', Array.from({ length: LEADLAG.minTurnsPerNode }, () => s), '2024-01-01').verdict.includes('没有表现出可区分的领先信息')
})())
ok('失败案例逐条列出', summarizeNode('PCB', [{ ...s1, turns: [{ ...t1!, hit: false, signalDate: null, leadToNotice: null, leadToPeriodEnd: null }] }], '2024-01-01').misses.length === 1)
ok('样本内与样本外分开计数', big.bySplit.length === 2)

section('五、边界')
ok('不宣布规律、不产生动作', leadLagDeclaresRule() === false && leadLagProducesAction() === false)
const report: LeadLagReport = {
  id: 'SIM-LEADLAG', generatedAt: 'x', range: { from: '2019-01-01', to: '2026-10-17', outOfSampleFrom: '2024-01-01' }, params: LEADLAG,
  nodes: [few], sensitivity: [], stocks: [{ ...s1, signals: undefined } as never], skipped: [], declaresRule: false, producesAction: false,
}
const md = renderLeadLag(report)
ok('报告写明待检验假设与不进入执行单', md.includes('待检验假设') && md.includes('不进入执行单'))
ok('报告不含 Markdown 星号', !md.includes(STARS))

console.log(`\n═══ 结果：${pass} 通过 / ${fail} 失败 ═══`)
if (fail) process.exit(1)
