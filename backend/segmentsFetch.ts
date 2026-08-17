/**
 * 抓取分产品收入表（主营构成）。
 *
 * 只在年报/中报披露，故本脚本无需日更 —— 每半年一次即可。
 * 覆盖范围刻意限定在**已在册且需要主线归因的标的**，
 * 不做全域抓取：验证链第 3 环是逐个标的做的，一次抓 51 家等于扩大研究面。
 */
import { writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fetchSegments, groupPeriod, reconcile } from './src/services/research/segmentFetch'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = join(HERE, 'src', 'services', 'research', 'data', 'segments.json')

// 当前只有兆易创新一只 —— 委员会 2026-08-16 明确不扩大研究面。
const TARGETS: [string, string][] = [['603986', '兆易创新']]

async function main(): Promise<void> {
  for (const [code, name] of TARGETS) {
    const f = await fetchSegments(code, name)
    process.stdout.write(`${name}（${code}）：${f.periods.length} 个报告期\n`)

    let bad = 0
    for (const p of f.periods.slice(0, 6)) {
      const r = reconcile(groupPeriod(p))
      if (!r.ok) { bad++; process.stdout.write(`  ⚠ ${p.reportDate} ${r.note}\n`) }
    }
    if (bad === 0) process.stdout.write('  近 6 期分组配平校验通过\n')

    writeFileSync(OUT, `${JSON.stringify(f, null, 1)}\n`, 'utf-8')
    process.stdout.write(`  已写入 ${OUT}\n`)
  }
}

void main()
