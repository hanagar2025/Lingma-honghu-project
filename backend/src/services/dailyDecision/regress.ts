/**
 * 执行单回归：用生产分支上已经发出的执行单验收现在的代码。
 *
 * 每张历史执行单自带当时的价格（核对明细表）和账本日期。取那次提交里的账本，
 * 喂入同样的价格，现在的代码必须逐字重现当时的执行单。
 *
 * 运行：npm run decision:regress -- [生产分支引用]
 *   缺省引用 origin/cursor/account-snapshot-1009-c819；需要本地已 fetch 该分支。
 * 账本从 git 历史里读，不落盘、不打印金额。
 */
import { execFileSync } from 'node:child_process'
import { buildCard } from './card'
import { buildDecisionInput, type LastBar } from './input'
import type { LedgerFile } from './ledger'
import type { DecisionSession } from './types'
import { MARKET_INDEX, sinaSymbol, verifyInput, type SinaRaw } from './verify'

const REF = process.argv[2] ?? 'origin/cursor/account-snapshot-1009-c819'
/** 账本在仓库里待过的位置，新的在前 */
const LEDGER_PATHS = ['backend/src/services/dailyDecision/data/portfolio.json', 'backend/src/services/cockpit/data/portfolio.json']
const ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf-8' }).trim()

function git(...args: string[]): string {
  return execFileSync('git', args, { encoding: 'utf-8', cwd: ROOT, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] })
}

function ledgerAt(commit: string): LedgerFile | null {
  for (const path of LEDGER_PATHS) {
    try { return JSON.parse(git('show', `${commit}:${path}`)) as LedgerFile } catch { /* 这次提交里账本不在这个位置 */ }
  }
  return null
}

interface Parsed {
  session: DecisionSession
  today: string
  time?: string
  marketDate: string
  /** 每只持仓当时的两源价格：腾讯（主）、新浪（副） */
  prices: Record<string, { primary: number; secondary: number }>
}

/** 从执行单正文里取回它当时用的日期、时点和价格。取不全则返回原因 */
function parseCard(file: string, text: string): Parsed | string {
  const m = /(\d{4}-\d{2}-\d{2})-(pre|intra|post)\.md$/.exec(file)
  if (!m) return '文件名不是执行单'
  if (text.includes('收盘核对）')) return '10/12 之前的旧版式，措辞不同'
  const session: DecisionSession = m[2] === 'pre' ? 'PRE_OPEN' : m[2] === 'intra' ? 'INTRADAY' : 'POST_CLOSE'
  const market = /市场日期（新浪上证指数）：(\d{4}-\d{2}-\d{2})/.exec(text)
  if (!market) return '没有市场日期（旧格式，或当时第二数据源取不到）'
  const prices: Parsed['prices'] = {}
  for (const row of text.matchAll(/^\| .+ (\d{6}) \| ([\d.]+|—) \| ([\d.]+|—) \| (.+) \|$/gm)) {
    if (row[2] === '—' || row[3] === '—') return '当时有持仓价格取不到'
    prices[row[1]!] = { primary: Number(row[2]), secondary: Number(row[3]) }
  }
  if (!Object.keys(prices).length) return '没有核对明细'
  return { session, today: m[1]!, time: /按 (\d{2}:\d{2}) 实时价/.exec(text)?.[1], marketDate: market[1]!, prices }
}

const files = git('ls-tree', '--name-only', REF, 'share/decision/').split('\n').filter(f => /\d{4}-\d{2}-\d{2}-(pre|intra|post)\.md$/.test(f))
let same = 0
const skipped: string[] = []
const different: string[] = []
const kinds = new Map<string, number>()

for (const file of files) {
  const commit = git('log', '-1', '--format=%H', REF, '--', file).trim()
  const archived = git('show', `${commit}:${file}`)
  const parsed = parseCard(file, archived)
  if (typeof parsed === 'string') { skipped.push(`${file.slice(15)}：${parsed}`); continue }

  const pf = ledgerAt(commit)
  if (!pf) { skipped.push(`${file.slice(15)}：那次提交里没有账本`); continue }
  if (pf.positions.some(p => p.quantity > 0 && parsed.prices[p.code] === undefined)) {
    skipped.push(`${file.slice(15)}：账本里有持仓不在核对明细中`)
    continue
  }
  const bars: Record<string, LastBar> = {}
  const sina: Record<string, SinaRaw> = { [MARKET_INDEX]: { date: parsed.marketDate, price: 1, prevClose: 1 } }
  for (const [code, px] of Object.entries(parsed.prices)) {
    bars[code] = { date: parsed.marketDate, close: px.primary }
    sina[sinaSymbol(code)] = { date: parsed.marketDate, price: px.secondary, prevClose: px.secondary }
  }
  const input = buildDecisionInput(pf, bars, [], parsed.today)
  // 主线外提示是这次新增的，历史执行单里没有；比对时关掉
  input.outsideMainline = []
  const card = buildCard(input, verifyInput(input, sina, parsed.session), parsed.session, { today: parsed.today, time: parsed.time })
  const kind = card.title.replace(/^.*：/, '').replace(/\d+ 笔/, 'N 笔')
  if (card.markdown === archived) {
    same++
    kinds.set(kind, (kinds.get(kind) ?? 0) + 1)
  } else {
    const a = archived.split('\n')
    const b = card.markdown.split('\n')
    const i = a.findIndex((line, k) => line !== b[k])
    different.push(`${file.slice(15)}：第 ${i + 1} 行不同\n    当时：${(a[i] ?? '（无）').replace(/[\d.]+万/g, '…万')}\n    现在：${(b[i] ?? '（无）').replace(/[\d.]+万/g, '…万')}`)
  }
}

process.stdout.write(`历史执行单 ${files.length} 张（${REF}）\n`)
process.stdout.write(`  逐字重现 ${same} 张：${[...kinds].map(([k, n]) => `${k} ${n}`).join('；')}\n`)
process.stdout.write(`  不一致 ${different.length} 张\n`)
different.forEach(d => process.stdout.write(`  ✗ ${d}\n`))
process.stdout.write(`  无法比对 ${skipped.length} 张\n`)
const reasons = new Map<string, string[]>()
for (const s of skipped) {
  const [name, why] = s.split('：') as [string, string]
  reasons.set(why, [...(reasons.get(why) ?? []), name.replace('.md', '')])
}
for (const [why, names] of reasons) process.stdout.write(`  - ${why}：${names.join('、')}\n`)
if (different.length) process.exitCode = 1
