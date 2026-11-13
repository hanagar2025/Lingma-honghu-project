/**
 * 站点任务用：把执行单包成数据包，写出 <站点目录>/agent.md 与 index.html。
 *   npm -w backend run decision:agentpack -- ../site
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildAgentPack, renderSitePage, type CardMeta } from './agentPack'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..', '..', '..', '..')
const DECISION_DIR = join(REPO, 'share', 'decision')

const out = resolve(process.cwd(), process.argv[2] ?? join(REPO, 'site'))
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
