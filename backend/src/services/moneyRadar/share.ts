/**
 * 资金驾驶舱（R-01）· 用已有快照重新生成 Agent 分享
 *
 *   npm run money:share
 *
 * 不联网、不重算：读 frontend/public/data/money.json，写同目录的 money.agent.md。
 * 用于盘中不想拿不完整的当日数据重跑、但需要把上一次收盘结果交给其他 Agent 的时候。
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildMoneyAgentShare } from './agentShare'
import type { MoneyCockpitView } from './radar'

const HERE = dirname(fileURLToPath(import.meta.url))
const SNAP = process.env.MONEY_SNAPSHOT_FILE ?? join(HERE, '..', '..', '..', '..', 'frontend', 'public', 'data', 'money.json')

const view = JSON.parse(readFileSync(SNAP, 'utf-8')) as MoneyCockpitView
const intraday = view.dataNotes.some(n => n.startsWith('盘中快照'))
const out = join(dirname(SNAP), 'money.agent.md')
writeFileSync(out, buildMoneyAgentShare(view, { intraday }), 'utf-8')
process.stdout.write(`已写入 ${out}（数据截至 ${view.asOf}）\n`)
