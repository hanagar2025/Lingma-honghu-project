// 冻结期检查器
//
// 用法：
//   npm run freeze:check        与基线比对，打印漂移
//   npm run freeze:baseline     重新生成基线（**须经委员会授权，且会留下 git 记录**）
//
// 设计取舍：`freeze:check` 在漂移时**返回 0 而不是 1**。
// 理由：漂移本身不是罪，偷偷漂移才是。若让 CI 因规则改动而失败，
// 结果只会是有人顺手更新基线以让 CI 变绿 —— 那就把审计变成了盖章。
// 现在的做法是让漂移必须显式地出现在基线文件的 git diff 与每日审计里。

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

function writeBaseline(file = BASELINE_FILE): FreezeBaseline {
  const f = fingerprint()
  const b: FreezeBaseline = {
    frozenAt: process.env.FROZEN_AT ?? new Date().toISOString().slice(0, 10),
    tradingDays: Number(process.env.TRADING_DAYS ?? 30),
    hash: f.hash,
    entryCount: f.entryCount,
    byDomain: f.byDomain,
    tierCounts: f.tierCounts,
    note:
      '委员会 2026-08-13 决议：冻结 30 个交易日，期间不新增决策规则，只修 Bug、补数据、记录结果。' +
      '本文件即该承诺的可验证凭据。重新生成基线须在提交信息中写明授权来源。',
  }
  writeFileSync(file, `${JSON.stringify(b, null, 2)}\n`, 'utf-8')
  return b
}

function main(): void {
  const mode = process.argv[2] ?? 'check'
  const out = process.stdout

  if (mode === 'baseline') {
    const b = writeBaseline()
    out.write(`已写入冻结基线：${BASELINE_FILE}\n`)
    out.write(`  指纹 ${b.hash}｜${b.entryCount} 条规则｜冻结自 ${b.frozenAt} 起 ${b.tradingDays} 个交易日\n`)
    out.write(`  等级分布：${Object.entries(b.tierCounts).map(([t, n]) => `${t}=${n}`).join(' ')}\n`)
    out.write(`\n⚠ 重新生成基线等于宣布"规则已授权变更"。请在提交信息中写明授权来源。\n`)
    return
  }

  const reg = buildRuleRegistry()
  const cur = fingerprint(reg)
  out.write(`\n规则登记册：${cur.entryCount} 条，指纹 ${cur.hash}\n`)
  out.write(`等级分布：${Object.entries(cur.tierCounts).map(([t, n]) => `${t}=${n}`).join(' ')}\n`)
  out.write(`分域指纹：\n`)
  for (const [d, h] of Object.entries(cur.byDomain)) out.write(`  ${d.padEnd(16)} ${h}\n`)

  const baseline = loadBaseline()
  if (!baseline) {
    out.write(`\n未找到冻结基线。先跑 npm run freeze:baseline 建立基线。\n`)
    return
  }

  const drift = detectDrift(baseline, cur)
  out.write(`\n${'─'.repeat(90)}\n`)
  out.write(drift.drifted ? `⚠ 规则已漂移\n` : `✓ 规则未漂移\n`)
  out.write(`${drift.detail}\n`)
  if (drift.drifted) {
    out.write(`\n基线 ${drift.baselineHash} → 当前 ${drift.currentHash}\n`)
    out.write(`变动域：${drift.changedDomains.join('、')}\n`)
    if ((drift.tierDelta.OBSERVATION ?? 0) > 0) {
      out.write(
        `\n⚠⚠ OBSERVATION 等级规则增加 ${drift.tierDelta.OBSERVATION} 条。\n` +
        `   委员会 2026-08-13：「现在,我不会再给它增加任何『聪明』的东西。」\n` +
        `   新增观察指标不违规，但若它开始影响动作，则违反证据等级条款。\n`
      )
    }
    out.write(`\n若本次变更已获授权：跑 npm run freeze:baseline 并在提交信息中写明授权来源。\n`)
  }
  out.write(`${'─'.repeat(90)}\n`)
}

main()
