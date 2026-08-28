/**
 * Obsidian 库导出。
 *
 * 它是同一份数据的另一个渲染器：不新增判据、不改动作、不影响规则指纹。
 * 它不是新的页面架构。网页三层（看台 / 依据 / 研究）仍然冻结。
 *
 * 存在理由很实际：网页打不开、快照更新不了时，本地笔记仍然能读。
 * 研究笔记不依赖行情。看台和依据需要驾驶舱结果，或已有 today.json。
 *
 * 手写笔记不要放进 鸿鹄/ 文件夹。下次生成会覆盖这个文件夹里的同名文件。
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { DAILY_QUESTION, PHASE, FROZEN_RULE_FINGERPRINT } from '../decision/charter'
import { renderLookout, type LookoutView } from './lookout'
import { renderAiActTwoPool } from '../research/aiActTwoPool'
import { renderAiFourActs } from '../research/aiFourActs'
import { renderDalioPressureTest } from '../research/dalioPressureTest'
import { renderAiFinancingQuality } from '../research/aiFinancingQuality'
import { renderAiPhaseTwo } from '../research/aiPhaseTwo'
import { renderPowerChain } from '../research/powerChain'
import { renderPortfolioDefense } from '../research/portfolioDefense'
import { renderOwnershipPhilosophy } from '../research/ownershipPhilosophy'

const HERE = dirname(fileURLToPath(import.meta.url))

export type ObsidianNote = {
  path: string
  title: string
  body: string
}

export type ObsidianInput = {
  date?: string | null
  generatedAt?: string | null
  codeCommit?: string | null
  lookout?: LookoutView | null
  lookoutText?: string | null
  decisionText?: string | null
  verdictText?: string | null
  dashboardText?: string | null
  freeze?: {
    currentHash?: string | null
    drifted?: boolean
    detail?: string
  } | null
  dataGaps?: readonly string[] | null
  source?: 'live' | 'snapshot' | 'research-only'
}

export const DEFAULT_OBSIDIAN_DIR = join(HERE, 'data', 'obsidian')
export const VAULT_FOLDER = '鸿鹄'

const RESEARCH_NOTES = [
  { title: 'S-01 第二幕候选池', render: renderAiActTwoPool, focus: true },
  { title: 'A-01 四幕与利润中心', render: renderAiFourActs, focus: true },
  { title: 'T-01 达利欧反向压力测试', render: renderDalioPressureTest, focus: true },
  { title: 'F-01 融资质量', render: renderAiFinancingQuality, focus: true },
  { title: 'P2-01 第二阶段', render: renderAiPhaseTwo, focus: true },
  { title: 'E-01 电力传导', render: renderPowerChain, focus: false },
  { title: 'D-01 组合防守', render: renderPortfolioDefense, focus: false },
  { title: 'P-01 投资哲学', render: renderOwnershipPhilosophy, focus: false },
] as const

function fence(text: string): string {
  return '```\n' + text.replace(/\s+$/, '') + '\n```\n'
}

function yaml(fields: Record<string, string>): string {
  const L = ['---']
  for (const [k, v] of Object.entries(fields)) L.push(`${k}: ${v}`)
  L.push('---', '')
  return L.join('\n')
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

export function expandHome(p: string): string {
  if (p === '~') return homedir()
  if (p.startsWith('~/')) return join(homedir(), p.slice(2))
  return p
}

export function resolveObsidianRoot(explicit?: string | null): string {
  const raw = explicit ?? process.env.OBSIDIAN_VAULT ?? ''
  if (raw.trim()) return expandHome(raw.trim())
  return DEFAULT_OBSIDIAN_DIR
}

export function buildObsidianVault(input: ObsidianInput = {}): {
  notes: ObsidianNote[]
  date: string
  source: 'live' | 'snapshot' | 'research-only'
} {
  const date = input.date || input.lookout?.date || today()
  const source = input.source
    ?? (input.lookoutText || input.lookout ? 'snapshot' : 'research-only')
  const generatedAt = input.generatedAt || new Date().toISOString()
  const commit = input.codeCommit || 'unknown'
  const lookoutText = input.lookoutText
    ?? (input.lookout ? renderLookout(input.lookout) : '')

  const notes: ObsidianNote[] = []

  notes.push({
    path: `${VAULT_FOLDER}/首页.md`,
    title: '首页',
    body: [
      yaml({
        honghu: 'generated',
        layer: 'index',
        date,
        source,
        commit,
      }),
      '# 《鸿鹄理财》本地库',
      '',
      '> 同一份数据的另一个渲染器。不新增判据，不改动作，不影响规则指纹。',
      '> 这不是新的页面架构。网页三层仍然冻结。这里只是本地阅读口。',
      '',
      `日期：${date}`,
      `来源：${source === 'live' ? '当日驾驶舱' : source === 'snapshot' ? '网页快照 today.json' : '仅研究笔记，看台尚未生成'}`,
      `生成：${generatedAt}`,
      '',
      `## ${DAILY_QUESTION}`,
      '',
      input.lookout?.answer
        ? input.lookout.answer
        : '看台还没有写入。研究笔记仍然可以读。',
      '',
      '## 第一层 · 看台',
      '',
      '- [[看台]]',
      '',
      '## 第二层 · 依据',
      '',
      '- [[依据]]',
      '',
      '## 第三层 · 研究',
      '',
      '当前焦点：',
      '',
      ...RESEARCH_NOTES.filter(n => n.focus).map(n => `- [[${n.title}]]`),
      '',
      '上一轮观察：',
      '',
      ...RESEARCH_NOTES.filter(n => !n.focus).map(n => `- [[${n.title}]]`),
      '',
      '## 档案',
      '',
      '- [[档案]]',
      '',
      '## 这不是',
      '',
      '- 不是买入池。',
      '- 不是把鸿鹄搬进 Obsidian 当新决策中心。',
      '- 不是改 V4.x。不是加 V5。',
      '- 手写笔记不要放进 鸿鹄 文件夹。下次生成会覆盖同名文件。',
      '',
    ].join('\n'),
  })

  notes.push({
    path: `${VAULT_FOLDER}/看台.md`,
    title: '看台',
    body: [
      yaml({ honghu: 'generated', layer: 'lookout', date, source }),
      '# 看台',
      '',
      '> 投资人前台只看这一问。研究观察不是今天的资本事实，不是减仓或建仓令。',
      '',
      lookoutText
        ? fence(lookoutText)
        : [
          '看台还没有生成。',
          '',
          '原因通常是：还没有跑过驾驶舱，或者网页快照 today.json 不在。',
          '',
          '研究笔记不依赖行情，仍然可以读。先打开 [[S-01 第二幕候选池]]。',
          '',
          '有快照之后再跑一次导出，看台会写进来。',
          '',
        ].join('\n'),
      '',
      '回到 [[首页]]。下一层是 [[依据]]。',
      '',
    ].join('\n'),
  })

  const evidenceParts: string[] = [
    yaml({ honghu: 'generated', layer: 'evidence', date, source }),
    '# 依据',
    '',
    '> 点开才看。这里不产生新判断。',
    '',
  ]
  if (input.verdictText) {
    evidenceParts.push('## 今日结论', '', fence(input.verdictText), '')
  }
  if (input.decisionText) {
    evidenceParts.push('## 决策驾驶舱', '', fence(input.decisionText), '')
  }
  if (!input.verdictText && !input.decisionText) {
    evidenceParts.push(
      '依据还没有生成。需要先跑驾驶舱，或让 today.json 带上 decisionV2 / verdict。',
      '',
      '研究笔记仍然可以读。回到 [[首页]]。',
      '',
    )
  }
  evidenceParts.push('上一层是 [[看台]]。研究从 [[S-01 第二幕候选池]] 开始。', '')
  notes.push({
    path: `${VAULT_FOLDER}/依据.md`,
    title: '依据',
    body: evidenceParts.join('\n'),
  })

  for (const item of RESEARCH_NOTES) {
    notes.push({
      path: `${VAULT_FOLDER}/研究/${item.title}.md`,
      title: item.title,
      body: [
        yaml({
          honghu: 'generated',
          layer: 'research',
          note: item.title,
          date,
          source: 'research',
        }),
        `# ${item.title}`,
        '',
        '> 只渲染，不产生任何操作入口。证据等级恒为 OBSERVATION。',
        '',
        fence(item.render()),
        '',
        '回到 [[首页]]。看台在 [[看台]]。',
        '',
      ].join('\n'),
    })
  }

  const archive: string[] = [
    yaml({ honghu: 'generated', layer: 'archive', date, source }),
    '# 档案',
    '',
    `阶段：${PHASE}`,
    `规则指纹：${input.freeze?.currentHash || FROZEN_RULE_FINGERPRINT}`,
    `漂移：${input.freeze?.drifted ? '有漂移' : '未漂移'}`,
    input.freeze?.detail ? `说明：${input.freeze.detail}` : '',
    `提交：${commit}`,
    '',
    '## 数据缺口',
    '',
  ]
  const gaps = input.dataGaps ?? []
  if (gaps.length === 0) archive.push('这一次没有随快照带上缺口清单。', '')
  else for (const g of gaps) archive.push(`- ${g}`)
  archive.push('')
  if (input.dashboardText) {
    archive.push('## 结构表', '', fence(input.dashboardText), '')
  }
  archive.push(
    '## 使用',
    '',
    '- 打开这个库：Obsidian → 打开文件夹作为库。',
    '- 把本目录的 鸿鹄 文件夹放进你已经建好的「鸿鹄理财」库，也可以。',
    '- 指定现有库：OBSIDIAN_VAULT=你的库路径 npm run obsidian',
    '- 每天复跑驾驶舱时加 OBSIDIAN=1，看台会按当日结果重写。',
    '- 只想先读研究：直接 npm run obsidian。不需要网页，不需要登录。',
    '',
    '回到 [[首页]]。',
    '',
  )
  notes.push({
    path: `${VAULT_FOLDER}/档案.md`,
    title: '档案',
    body: archive.filter(x => x !== undefined).join('\n'),
  })

  notes.push({
    path: `${VAULT_FOLDER}/打开这里.md`,
    title: '打开这里',
    body: [
      yaml({ honghu: 'generated', layer: 'howto', date }),
      '# 打开这里',
      '',
      '这些笔记由《鸿鹄理财》生成。不要手改 鸿鹄 文件夹里的同名文件，下次会覆盖。',
      '',
      '手写笔记放在库根目录，例如原来的「欢迎」「创建链接」。',
      '',
      '这不是新的决策中心。网页打不开时，用这里读同一份数据。',
      '',
      '先打开 [[首页]]。',
      '',
    ].join('\n'),
  })

  return { notes, date, source }
}

export function writeObsidianVault(
  root: string,
  notes: readonly ObsidianNote[],
): { root: string; files: string[] } {
  const files: string[] = []
  for (const note of notes) {
    const file = join(root, note.path)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, note.body.endsWith('\n') ? note.body : `${note.body}\n`, 'utf-8')
    files.push(file)
  }
  return { root, files }
}
