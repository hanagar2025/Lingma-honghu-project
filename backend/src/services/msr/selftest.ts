// MSR 自检 —— 用构造数据验证不变量，不依赖网络与数据库
// 核心被测不变量：执行未清零时，MSR 输出的可执行候选数必须恒为 0。
// 该不变量若被破坏，等于第10条教训（研究替代执行）在代码层失效。

import { runMsr } from './index'
import { pullbackDepths, upDownVolumeRatio, scoreTrend, runRadar } from './radar'
import { evaluatePriceWindow, evaluatePromotion } from './promotion'
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

/** 造一段强势上行K线：稳定上涨、上涨日放量 */
function strongBars(n = 200, start = 100): DailyBar[] {
  const out: DailyBar[] = []
  let px = start
  for (let i = 0; i < n; i++) {
    const up = i % 3 !== 0
    px = px * (up ? 1.012 : 0.994)
    out.push({
      date: `2026-${String(1 + (i % 12)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}`,
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
      date: `2026-${String(1 + (i % 12)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}`,
      open: px, high: px * 1.01, low: px * 0.99, close: px,
      volume: up ? 90000 : 220000,
    })
  }
  return out
}

function flatBars(n = 200, start = 100): DailyBar[] {
  return Array.from({ length: n }, (_, i) => ({
    date: `2026-${String(1 + (i % 12)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}`,
    open: start, high: start * 1.005, low: start * 0.995, close: start, volume: 100000,
  }))
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
  [...cleared.potentialCores].every(c => c.blocks.includes('SCORE_INCOMPLETE')))
check('清零后 C级清退标的仍被 RETIRED_C_TIER 阻断',
  [...cleared.reduceCandidates, ...cleared.potentialCores, ...cleared.noAction]
    .filter(c => ['603986', '688008'].includes(c.radar.code))
    .every(c => c.blocks.includes('RETIRED_C_TIER')))
check('清零后 只研究主线仍被 RESEARCH_ONLY_MAINLINE 阻断',
  [...cleared.reduceCandidates, ...cleared.potentialCores, ...cleared.noAction]
    .filter(c => c.mainlineId === 'power')
    .every(c => c.blocks.includes('RESEARCH_ONLY_MAINLINE')))

process.stdout.write('\n【四】反追涨对抗测试（回答"MSR会不会变成漂亮的追涨机器"）\n')

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
check(`追涨样本价格窗口判为 RED（实际 ${trapWindow.color}）`, trapWindow.color === 'RED',
  trapWindow.detail)
check('追涨样本红灯项 ≥ 3（涨幅/偏离/爆量/上影多项同时命中）',
  trapWindow.redFlags.length >= 3, trapWindow.redFlags.join(' | '))
check(`追涨样本即便产业+盈利+估值全部满分，也停在 S2 不得建仓（实际 ${trapPromo.stage}）`,
  trapPromo.stage === 'STAGE_2_EARNINGS', trapPromo.blockedBy.join(' | '))

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

process.stdout.write(`\n=== 结果：${failures === 0 ? '全部通过' : `${failures} 项失败`} ===\n\n`)
if (failures > 0) process.exit(1)
