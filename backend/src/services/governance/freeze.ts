// 规则基线检查
//
// 用法：
//   npm run freeze:check        与基线比对，打印变动
//   npm run freeze:baseline     重新生成基线（须经委员会授权，且会留下 git 记录）
//
// freeze:check 在规则变动时返回 0 而不是 1：变动本身不是错，没有记录的变动才是。
// 若让 CI 因规则改动而失败，结果只会是有人顺手更新基线让 CI 变绿。
// 现在的做法是让变动必须出现在基线文件的 git diff 里。

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildRuleRegistry, detectDrift, fingerprint, type FreezeBaseline } from './ruleRegistry'

const HERE = dirname(fileURLToPath(import.meta.url))
export const BASELINE_FILE = join(HERE, 'data', 'freeze-baseline.json')

export function loadBaseline(file = BASELINE_FILE): FreezeBaseline | null {
  try {
    return JSON.parse(readFileSync(file, 'utf-8')) as FreezeBaseline
  } catch {
    return null
  }
}

/** 重新生成基线。授权说明必须经 BASELINE_NOTE 给出 */
function writeBaseline(file = BASELINE_FILE): FreezeBaseline {
  const note = process.env.BASELINE_NOTE?.trim()
  if (!note) throw new Error('重新生成基线须以 BASELINE_NOTE 写明授权来源与变更内容')
  const prev = loadBaseline(file)
  const f = fingerprint()
  const b: FreezeBaseline = {
    frozenAt: process.env.FROZEN_AT ?? new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10),
    hash: f.hash,
    entryCount: f.entryCount,
    byDomain: f.byDomain,
    note,
    ...(prev && prev.hash !== f.hash ? { supersedes: { hash: prev.hash, note: prev.note } } : {}),
  }
  writeFileSync(file, `${JSON.stringify(b, null, 2)}\n`, 'utf-8')
  return b
}

function main(): void {
  const out = process.stdout
  if ((process.argv[2] ?? 'check') === 'baseline') {
    const b = writeBaseline()
    out.write(`已写入规则基线：指纹 ${b.hash}，${b.entryCount} 条，自 ${b.frozenAt} 起\n`)
    return
  }

  const reg = buildRuleRegistry()
  const cur = fingerprint(reg)
  out.write(`\n规则登记册：${cur.entryCount} 条，指纹 ${cur.hash}\n`)
  for (const e of reg) out.write(`  ${e.domain.padEnd(15)} ${e.key.padEnd(34)} ${JSON.stringify(e.value)}\n`)

  const baseline = loadBaseline()
  if (!baseline) {
    out.write('\n未找到基线。先跑 npm run freeze:baseline 建立基线。\n')
    return
  }
  const drift = detectDrift(baseline, cur)
  out.write(`\n${drift.drifted ? '⚠ 规则已变动' : '✓ 规则未变动'}\n${drift.detail}\n`)
  if (drift.drifted) {
    out.write(`基线 ${drift.baselineHash} → 当前 ${drift.currentHash}；变动域：${drift.changedDomains.join('、')}\n`)
    out.write('若本次变更已获授权：跑 npm run freeze:baseline，并在 BASELINE_NOTE 里写明授权来源。\n')
  }
}

main()
