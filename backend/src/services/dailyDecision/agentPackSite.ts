/**
 * 把最近一张执行单包成数据包，写出 <输出目录>/agent.md 与 index.html。
 * 执行单带股数和金额：读的是私有目录里的那一张，输出目录也必须是私有位置，不要放进仓库或公开站点。
 *   npm -w backend run decision:agentpack -- <输出目录>
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { buildAgentPack, renderSitePage, type CardMeta } from './agentPack'
import { privateDir } from './ledger'

const DECISION_DIR = process.env.DECISION_OUT ?? join(privateDir(), 'decision')

const out = resolve(process.cwd(), process.argv[2] ?? join(privateDir(), 'site'))
const card = readFileSync(join(DECISION_DIR, 'latest.md'), 'utf-8')
const metaFile = join(DECISION_DIR, 'latest.json')
const meta: CardMeta = existsSync(metaFile)
  ? (JSON.parse(readFileSync(metaFile, 'utf-8')) as CardMeta)
  : { title: /^#\s+(.*)$/m.exec(card)?.[1] ?? '纪律执行官', ok: !card.includes('不下单'), generatedAt: '' }
const siteUrl = process.env.DECISION_URL

mkdirSync(out, { recursive: true })
writeFileSync(join(out, 'agent.md'), buildAgentPack({ card, generatedAt: meta.generatedAt, siteUrl }), 'utf-8')
writeFileSync(join(out, 'index.html'), renderSitePage(card, meta, siteUrl), 'utf-8')
process.stdout.write(`数据包：${join(out, 'agent.md')}\n`)
