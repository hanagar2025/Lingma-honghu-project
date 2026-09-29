/**
 * 资金驾驶舱（R-01）· 一次性校准与样本外检验
 *
 *   npm run money:calibrate
 *
 * 只允许跑一次并留档。阈值状态为 FROZEN 之后再跑，只打印复核结果，不写档、不改阈值。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { THRESHOLDS } from './config'
import {
  HYGIENE_CRITERIA, RULE_HYPOTHESIS, VERDICT_TEXT,
  collectEvents, eventStudy, hygiene, replayObjects, splitWindow, thresholdsHash,
  type HygieneCheck, type RuleResult,
} from './backtest'
import { DEFAULT_LIVE, industryObjects, loadLiveDataSet } from './live'
import { entryObjects } from './radar'

const HERE = dirname(fileURLToPath(import.meta.url))
export const CALIBRATION_DIR = join(HERE, 'data', 'calibration')

export interface CalibrationReport {
  id: 'R-01-calibration'
  runOn: string
  dataThrough: string
  thresholdsHash: string
  thresholdsRegisteredOn: string
  criteria: typeof HYGIENE_CRITERIA
  hypotheses: typeof RULE_HYPOTHESIS
  split: { inSample: [string, string]; outOfSample: [string, string] }
  objects: { total: number; industries: number; baskets: number; stocks: number }
  hygiene: HygieneCheck[]
  hygienePassed: boolean
  decision: 'CONFIRMED_NO_CHANGE' | 'NEEDS_ONE_ADJUSTMENT'
  outOfSample: RuleResult[]
  note: string
}

export function loadLatestCalibration(): CalibrationReport | null {
  const p = join(CALIBRATION_DIR, 'latest.json')
  if (!existsSync(p)) return null
  try { return JSON.parse(readFileSync(p, 'utf-8')) as CalibrationReport } catch { return null }
}

const pct = (v: number | null, d = 2) => (v === null ? '—' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(d)}%`)

export function renderCalibration(r: CalibrationReport): string {
  const L: string[] = ['', `资金驾驶舱 · 校准与样本外检验（${r.runOn}，数据截至 ${r.dataThrough}）`, '─'.repeat(100)]
  L.push(`  阈值指纹 ${r.thresholdsHash}（预登记于 ${r.thresholdsRegisteredOn}）　对象 ${r.objects.total} 个：行业 ${r.objects.industries}、篮子 ${r.objects.baskets}、个股 ${r.objects.stocks}`)
  L.push(`  样本内 ${r.split.inSample[0]} ~ ${r.split.inSample[1]}　样本外 ${r.split.outOfSample[0]} ~ ${r.split.outOfSample[1]}`)
  L.push('')
  L.push('  ── 样本内：信号卫生（标准先于数据登记）──')
  for (const h of r.hygiene) {
    const v = h.value === null ? '—' : h.id === 'H1' ? `${h.value.toFixed(1)} 日` : h.id === 'H2' ? h.value.toFixed(2) : pct(h.value, 1)
    L.push(`  ${h.pass ? '✓' : '✗'} ${h.id} ${h.text}　实测 ${v}`)
  }
  L.push(`  结论：${r.decision === 'CONFIRMED_NO_CHANGE' ? '预登记初值全部通过，原样确认' : '有未通过项，需调整一次'}`)
  L.push('')
  L.push('  ── 样本外：事件研究（相对两市基准的超额收益，按交易日分组抽样的 95% 置信区间）──')
  for (const x of r.outOfSample) {
    L.push(`  ${x.rule.padEnd(13)}${String(x.horizon).padStart(3)} 日　n=${String(x.n).padEnd(5)}交易日 ${String(x.days).padEnd(4)}`
      + `均值 ${pct(x.mean).padEnd(9)}命中 ${x.hitRate === null ? '—' : `${(x.hitRate * 100).toFixed(0)}%`}`.padEnd(8)
      + `　区间 ${x.ci ? `[${pct(x.ci[0])}, ${pct(x.ci[1])}]` : '—'}　${VERDICT_TEXT[x.verdict]}`)
  }
  L.push('')
  L.push(`  ${r.note}`)
  return L.join('\n')
}

async function main(): Promise<void> {
  const log = (s: string) => process.stderr.write(`${s}\n`)
  const frozen = THRESHOLDS.status === 'FROZEN'
  const live = await loadLiveDataSet({ ...DEFAULT_LIVE, log })
  const ds = live.ds
  const objs = entryObjects(industryObjects(live.industries))
  const all = [...objs[1], ...objs[2], ...objs[3]]
  log(`· 回放 ${all.length} 个对象`)
  const replayed = replayObjects(ds, all)
  const split = splitWindow(ds.dates.length)
  const hy = hygiene(replayed, split.inSample[0], split.inSample[1])
  const events = collectEvents(replayed, ds, split.outOfSample[0], split.outOfSample[1])
  const oos = eventStudy(events, replayed, ds)
  const passed = hy.every(h => h.pass)
  const report: CalibrationReport = {
    id: 'R-01-calibration',
    runOn: new Date().toISOString().slice(0, 10),
    dataThrough: ds.dates.at(-1)!,
    thresholdsHash: thresholdsHash(),
    thresholdsRegisteredOn: THRESHOLDS.registeredOn,
    criteria: HYGIENE_CRITERIA,
    hypotheses: RULE_HYPOTHESIS,
    split: {
      inSample: [ds.dates[split.inSample[0]]!, ds.dates[split.inSample[1] - 1]!],
      outOfSample: [ds.dates[split.outOfSample[0]]!, ds.dates[split.outOfSample[1] - 1]!],
    },
    objects: {
      total: all.length,
      industries: all.filter(o => o.kind === 'INDUSTRY').length,
      baskets: all.filter(o => o.kind === 'BASKET').length,
      stocks: all.filter(o => o.kind === 'STOCK').length,
    },
    hygiene: hy,
    hygienePassed: passed,
    decision: passed ? 'CONFIRMED_NO_CHANGE' : 'NEEDS_ONE_ADJUSTMENT',
    outOfSample: oos,
    note: '样本外结果只作为证据登记。任何规则要进入法定理由，须由委员会裁定并有意变更规则指纹。',
  }
  process.stdout.write(renderCalibration(report))
  if (frozen) {
    log('\n阈值已冻结：本次只是复核，不写档、不改阈值。')
    return
  }
  mkdirSync(CALIBRATION_DIR, { recursive: true })
  const body = `${JSON.stringify(report, null, 2)}\n`
  writeFileSync(join(CALIBRATION_DIR, `${report.runOn}.json`), body, 'utf-8')
  writeFileSync(join(CALIBRATION_DIR, 'latest.json'), body, 'utf-8')
  log(`\n已写入校准报告：${join(CALIBRATION_DIR, `${report.runOn}.json`)}`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch(e => {
    process.stderr.write(`校准失败：${e instanceof Error ? e.stack : String(e)}\n`)
    process.exit(1)
  })
}
