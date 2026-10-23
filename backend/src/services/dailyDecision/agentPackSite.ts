/**
 * 站点任务用：把执行单与驾驶舱外发摘要合成数据包，写出 <站点目录>/agent.md 与 index.html。
 *   HTML=1 SHARE=1 npm -w backend run cockpit      # 先生成 cockpit/data/share/{日期}-摘要.md
 *   npm -w backend run decision:agentpack -- ../site
 * 摘要缺失时照样出包（只含执行单），不让首页因为驾驶舱失败而丢掉复制按钮。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildAgentPack, renderSitePage, type CardMeta } from './agentPack'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..', '..', '..', '..')
const DECISION_DIR = join(REPO, 'share', 'decision')
const SHARE_DIR = join(HERE, '..', 'cockpit', 'data', 'share')

function latestBrief(): string | null {
  if (!existsSync(SHARE_DIR)) return null
  const files = readdirSync(SHARE_DIR).filter(f => /-摘要\.md$/.test(f)).map(f => join(SHARE_DIR, f))
  if (!files.length) return null
  files.sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
  return readFileSync(files[0]!, 'utf-8')
}

const out = resolve(process.cwd(), process.argv[2] ?? join(REPO, 'site'))
const card = readFileSync(join(DECISION_DIR, 'latest.md'), 'utf-8')
const metaFile = join(DECISION_DIR, 'latest.json')
const meta: CardMeta = existsSync(metaFile)
  ? (JSON.parse(readFileSync(metaFile, 'utf-8')) as CardMeta)
  : { title: /^#\s+(.*)$/m.exec(card)?.[1] ?? '纪律执行官', ok: !card.includes('不下单'), generatedAt: '' }
const brief = latestBrief()
const siteUrl = process.env.DECISION_URL

mkdirSync(out, { recursive: true })
writeFileSync(join(out, 'agent.md'), buildAgentPack({ card, brief, generatedAt: meta.generatedAt, siteUrl }), 'utf-8')
writeFileSync(join(out, 'index.html'), renderSitePage(card, meta, brief, siteUrl), 'utf-8')
process.stdout.write(`数据包：${join(out, 'agent.md')}（${brief ? '执行单 + 驾驶舱摘要' : '仅执行单，驾驶舱摘要缺失'}）\n`)
