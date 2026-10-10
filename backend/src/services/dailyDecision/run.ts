/**
 * 每日执行单：跑驾驶舱导出决策输入 → 两源核对 → 出执行单 → 落盘 share/decision → 推送。
 *
 * 运行：npm run decision:daily
 *   DECISION_SESSION=pre|post  盘前 / 收盘后；缺省按北京时间 12 点前为盘前
 *   DECISION_JSON=<路径>        用已有的决策输入，不重跑驾驶舱
 *   NO_PUSH=1                  只落盘不推送
 *   FORCE=1                    周末与休市日也出单（调试用）
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beijingToday } from '../cockpit/renderObsidian'
import { buildCard, buildFailureCard, type DecisionCard } from './card'
import { configuredChannels, pushAll } from './notify'
import type { DecisionInput, DecisionSession } from './types'
import { fetchSinaRaw, MARKET_INDEX, sinaSymbol, verifyInput, type SinaRaw } from './verify'

const HERE = dirname(fileURLToPath(import.meta.url))
const BACKEND_ROOT = join(HERE, '..', '..', '..')
export const DECISION_DIR = join(BACKEND_ROOT, '..', 'share', 'decision')

function resolveSession(): DecisionSession {
  const s = process.env.DECISION_SESSION
  if (s === 'pre') return 'PRE_OPEN'
  if (s === 'post') return 'POST_CLOSE'
  const hour = (new Date().getUTCHours() + 8) % 24
  return hour < 12 ? 'PRE_OPEN' : 'POST_CLOSE'
}

function cardUrl(): string | undefined {
  if (process.env.DECISION_URL) return process.env.DECISION_URL
  const repo = process.env.GITHUB_REPOSITORY
  const ref = process.env.DECISION_BRANCH ?? process.env.GITHUB_REF_NAME
  return repo && ref ? `https://github.com/${repo}/blob/${ref}/share/decision/latest.md` : undefined
}

/** 驾驶舱网页地址（GitHub Pages）。COCKPIT_URL 环境变量注入 */
function cockpitUrl(): string | undefined {
  return process.env.COCKPIT_URL || undefined
}

/** 驾驶舱在子进程里跑：它失败时仍要能推出一张「不下单」的执行单，而不是一声不响 */
function exportDecisionInput(): { input: DecisionInput | null; error: string | null } {
  const given = process.env.DECISION_JSON
  const file = given ?? join(mkdtempSync(join(tmpdir(), 'hh-decision-')), 'input.json')
  if (!given) {
    const r = spawnSync(process.execPath, [...process.execArgv, join(HERE, '..', 'cockpit', 'run.ts')], {
      cwd: BACKEND_ROOT,
      env: { ...process.env, DECISION_JSON: file, DECISION_ONLY: '1', ARCHIVE: '0' },
      stdio: ['ignore', 'inherit', 'inherit'],
      timeout: 15 * 60_000,
    })
    if (r.status !== 0) return { input: null, error: `驾驶舱运行失败（退出码 ${r.status ?? r.signal}）` }
  }
  if (!existsSync(file)) return { input: null, error: '驾驶舱未写出决策输入' }
  return { input: JSON.parse(readFileSync(file, 'utf-8')) as DecisionInput, error: null }
}

async function publish(card: DecisionCard, today: string, session: DecisionSession): Promise<void> {
  mkdirSync(DECISION_DIR, { recursive: true })
  const tag = session === 'PRE_OPEN' ? 'pre' : 'post'
  writeFileSync(join(DECISION_DIR, `${today}-${tag}.md`), card.markdown, 'utf-8')
  writeFileSync(join(DECISION_DIR, 'latest.md'), card.markdown, 'utf-8')
  process.stdout.write(`\n${card.push}\n\n已写出 share/decision/${today}-${tag}.md 与 latest.md\n`)

  if (process.env.NO_PUSH === '1') return
  if (!configuredChannels().length) {
    process.stdout.write('⚠ 未配置推送通道（PUSHPLUS_TOKEN / WECOM_WEBHOOK / SERVERCHAN_SENDKEY / BARK_URL），本次只落盘\n')
    return
  }
  const results = await pushAll(card.title, card.push)
  for (const r of results) process.stdout.write(`推送 ${r.channel}：${r.ok ? '成功' : `失败 ${r.detail}`}\n`)
  if (results.some(r => !r.ok)) process.exitCode = 1
}

async function main(): Promise<void> {
  const session = resolveSession()
  const today = beijingToday()
  const force = process.env.FORCE === '1'

  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay()
  if (!force && (weekday === 0 || weekday === 6)) {
    process.stdout.write(`${today} 周末，不出执行单\n`)
    return
  }

  const { input, error } = exportDecisionInput()
  if (!input) {
    await publish(buildFailureCard(today, error ?? '未知错误', cardUrl(), cockpitUrl()), today, session)
    process.exitCode = 1
    return
  }

  let sina: Record<string, SinaRaw> | null = null
  try {
    sina = await fetchSinaRaw([MARKET_INDEX, ...input.holdings.map(h => sinaSymbol(h.code))])
  } catch (e) {
    process.stdout.write(`⚠ ${e instanceof Error ? e.message : String(e)}\n`)
  }
  const v = verifyInput(input, sina, session)

  if (!force && session === 'POST_CLOSE' && v.marketDate && v.marketDate !== today) {
    process.stdout.write(`${today} 休市（上证指数行情停在 ${v.marketDate}），不出执行单\n`)
    return
  }

  await publish(buildCard(input, v, session, { url: cardUrl(), today, cockpitUrl: cockpitUrl() }), today, session)
}

main().catch(e => {
  process.stderr.write(`执行单生成失败：${e instanceof Error ? e.message : String(e)}\n`)
  process.exit(1)
})
