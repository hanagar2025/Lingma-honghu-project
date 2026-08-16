// 观察期回顾 —— 30 个交易日后要回答的五个问题，今天就能跑
//
// 委员会 2026-08-13：
//   「30天以后,我们不问『模型赚了多少钱?』,而先问五件事:
//     E1 应执行的动作到底执行了多少 / E2 数据完整度是否提升 /
//     E3 规则有没有被偷偷改变 / E4 从发现→研究→动作用了多久 /
//     Discovery 系统每天到底发现了什么。」
//
// 本文件不计算任何新指标，只把已归档的快照、发现台账与规则指纹按这五问汇总。
// 它读盘，不写盘；没有它系统照样运行 —— 但没有它，30 天后就只能凭记忆复盘。
//
// 用法：npm run review              读全部已归档快照
//       npm run review 2026-08-13   指定观察期起始日

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { CHANGELOG_DIR, DISCOVERY_FILE, loadDiscovery, stageAdvances, type DailySnapshot, type Change } from './changeLog'
import { diffSnapshots } from './changeLog'
import { loadBaseline } from './freeze'
import { fingerprint, detectDrift } from './ruleRegistry'

const W = 100

function loadAllSnapshots(since?: string): DailySnapshot[] {
  if (!existsSync(CHANGELOG_DIR)) return []
  return readdirSync(CHANGELOG_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => f.replace(/\.json$/, ''))
    .filter(d => !since || d >= since)
    .sort()
    .map(d => JSON.parse(readFileSync(join(CHANGELOG_DIR, `${d}.json`), 'utf-8')) as DailySnapshot)
}

function main(): void {
  const since = process.argv[2]
  const snaps = loadAllSnapshots(since)
  const out = process.stdout

  out.write(`\n${'═'.repeat(W)}\n  观察期回顾${since ? `（自 ${since}）` : ''}\n${'═'.repeat(W)}\n\n`)

  if (!snaps.length) {
    out.write('尚无归档快照。先跑一次 npm run cockpit（盘后）以建立第一份基准。\n')
    return
  }

  const tradingDays = snaps.length
  out.write(`已归档交易日：${tradingDays} 天（${snaps[0].date} → ${snaps[tradingDays - 1].date}）\n`)
  const baseline = loadBaseline()
  const target = baseline?.tradingDays ?? 30
  out.write(`观察期目标：${target} 个交易日${tradingDays >= target ? ' —— 「已达标，可以开始讨论下一阶段」' : `，还差 ${target - tradingDays} 天`}\n\n`)

  // ── E3 规则有没有被偷偷改变 ──
  out.write(`${'─'.repeat(W)}\nE3 规则有没有被偷偷改变\n${'─'.repeat(W)}\n`)
  if (!baseline) {
    out.write('  ⚠ 未找到冻结基线，无法判定。先跑 npm run freeze:baseline\n')
  } else {
    const drift = detectDrift(baseline, fingerprint())
    out.write(`  基线 ${baseline.hash}（${baseline.frozenAt} 冻结）→ 当前 ${fingerprint().hash}\n`)
    out.write(`  ${drift.drifted ? '⚠ 已漂移：' : '✓ '}${drift.detail}\n`)
    if (drift.drifted) {
      for (const d of drift.changedDomains) out.write(`      变更域：${d}\n`)
    }
  }

  // ── E2 数据完整度是否提升 ──
  out.write(`\n${'─'.repeat(W)}\nE2 数据完整度是否提升\n${'─'.repeat(W)}\n`)
  const completenessOf = (s: DailySnapshot) =>
    s.readings.filter(r => r.field === '数据完整度' && r.value !== null)
  const first = completenessOf(snaps[0])
  const last = completenessOf(snaps[tradingDays - 1])
  if (!first.length || !last.length) {
    out.write('  快照中无数据完整度读数（利润结构地图未生成时会缺）\n')
  } else {
    out.write(`  ${'主线'.padEnd(24)}${'首日'.padEnd(10)}${'最新'.padEnd(10)}变化\n`)
    for (const l of last) {
      const f = first.find(x => x.key === l.key)
      const delta = f?.value != null && l.value != null ? (l.value - f.value) * 100 : null
      out.write(
        `  ${l.key.padEnd(24)}${(f?.display ?? '—').padEnd(10)}${l.display.padEnd(10)}` +
        `${delta === null ? '—' : `${delta > 0 ? '+' : ''}${delta.toFixed(0)}pct`}\n`
      )
    }
    const judgFirst = snaps[0].readings.filter(r => r.field === '可否用于机会判断' && r.display === '可判').length
    const judgLast = snaps[tradingDays - 1].readings.filter(r => r.field === '可否用于机会判断' && r.display === '可判').length
    out.write(`  可用于机会判断的主线数：${judgFirst} → ${judgLast}\n`)
  }

  // ── Discovery 系统每天到底发现了什么 ──
  out.write(`\n${'─'.repeat(W)}\nDiscovery 系统每天到底发现了什么\n${'─'.repeat(W)}\n`)
  const ledger = loadDiscovery(DISCOVERY_FILE)
  out.write(`  在册观察节点 ${ledger.entries.length} 个\n`)
  const adv = stageAdvances(ledger, since)
  if (!adv.length) {
    out.write('  闸门跃迁 0 次。这本身是信息：观察期内没有任何节点在验证链上前进。\n')
    out.write('  若 30 天后仍为 0，须核查是产业确实没变化，还是 S1/S2 核验字段无人维护。\n')
  } else {
    out.write(`  闸门跃迁 ${adv.length} 次：\n`)
    for (const a of adv) out.write(`    ${a.date}  ${a.key}  ${a.from} → ${a.to}（${a.gates}）\n`)
  }

  // 份额爬升轨迹 —— 委员会最关心的 0→1→2→5→10
  out.write('\n  节点存量份额轨迹（只列出观察期内发生过变化的节点）：\n')
  const shareSeries = new Map<string, { date: string; display: string }[]>()
  for (const s of snaps) {
    for (const r of s.readings) {
      if (r.scope !== 'NODE' || r.field !== '存量份额') continue
      const arr = shareSeries.get(r.key) ?? []
      if (!arr.length || arr[arr.length - 1].display !== r.display) {
        arr.push({ date: s.date, display: r.display })
      }
      shareSeries.set(r.key, arr)
    }
  }
  const moved = [...shareSeries.entries()].filter(([, v]) => v.length > 1)
  if (!moved.length) {
    out.write('    观察期内无节点份额变化（利润数据按季更新，日内不变属正常）\n')
  } else {
    for (const [k, v] of moved) {
      out.write(`    ${k.padEnd(28)}${v.map(x => `${x.display}(${x.date.slice(5)})`).join(' → ')}\n`)
    }
  }

  // ── E1 / E4：执行 ──
  out.write(`\n${'─'.repeat(W)}\nE1 执行率 / E4 延迟\n${'─'.repeat(W)}\n`)
  const mustSeries = snaps.map(s => ({
    date: s.date,
    must: s.readings.find(r => r.field === '必须执行项数')?.display ?? '—',
    buys: s.readings.find(r => r.field === '今日新增建仓')?.display ?? '—',
  }))
  out.write(`  ${'日期'.padEnd(14)}${'必须执行'.padEnd(12)}新增建仓\n`)
  for (const m of mustSeries) out.write(`  ${m.date.padEnd(14)}${m.must.padEnd(12)}${m.buys}\n`)
  out.write(
    '\n  ⚠ E1/E4 的真实值须由执行台账（trade_executions.executed / executed_at）给出，\n' +
    '    本回顾只能显示"每天有多少项必须执行"。若该列长期不下降，即为执行率仍为 0 的直接证据。\n'
  )

  // ── 逐日变化量 ──
  out.write(`\n${'─'.repeat(W)}\n逐日变化量（谁正在发生变化）\n${'─'.repeat(W)}\n`)
  out.write(`  ${'日期'.padEnd(14)}${'变化项数'.padEnd(12)}分布\n`)
  for (let i = 1; i < snaps.length; i++) {
    const ch: Change[] = diffSnapshots(snaps[i - 1], snaps[i])
    const byScope = new Map<string, number>()
    for (const c of ch) byScope.set(c.scope, (byScope.get(c.scope) ?? 0) + 1)
    out.write(
      `  ${snaps[i].date.padEnd(14)}${String(ch.length).padEnd(12)}` +
      `${[...byScope.entries()].map(([k, v]) => `${k}:${v}`).join(' ')}\n`
    )
  }
  if (snaps.length === 1) out.write('  仅一份快照，无法求差。明日起本表开始有内容。\n')

  out.write(`\n${'═'.repeat(W)}\n`)
  out.write('本回顾不判断模型对错，也不计算盈亏。它只回答"规则有没有变、数据有没有变全、\n')
  out.write('系统每天发现了什么、该做的事做了没有"。盈亏归因不在本系统职责内。\n')
}

main()
