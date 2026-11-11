/**
 * 鸿鹄服务器：一个页面、一个输入框。
 *
 * 委员会在页面上交持仓、成交、下单前的一行字；页面给回按真实账本现算的执行单。
 * 账本、成交、意向、截图只存在服务器的私有目录里，不进仓库。
 *
 * 环境变量：
 *   DATA_DIR         私有数据目录（必填，放在仓库之外）
 *   COMMITTEE_TOKEN  委员会口令（必填，至少 16 位）
 *   AGENT_TOKEN      战略侧读取与交回识别结果用的口令（选填，至少 16 位）
 *   PORT             缺省 5000
 *   WEB_DIR          前端构建产物目录，缺省 ../frontend/dist
 */
import express, { type NextFunction, type Request, type Response } from 'express'
import helmet from 'helmet'
import { createHash, timingSafeEqual } from 'node:crypto'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { markdownToHtml } from './services/dailyDecision/html'
import { beijingToday } from './services/dailyDecision/ledger'
import { produceCard, type ProducedCard } from './services/dailyDecision/produce'
import type { DayRange } from './services/intake/reconcile'
import { attachParsed, confirm, reject, submitImage, submitText, type IntakeContext } from './services/intake/service'
import { Store } from './services/intake/store'
import type { Submission } from './services/intake/types'

type Role = 'COMMITTEE' | 'AGENT'

function requireEnv(name: string, minLength: number): string {
  const v = process.env[name]?.trim() ?? ''
  if (v.length < minLength) {
    process.stderr.write(`缺少环境变量 ${name}（至少 ${minLength} 位）。不带口令不启动。\n`)
    process.exit(1)
  }
  return v
}

const DATA_DIR = resolve(requireEnv('DATA_DIR', 1))
const TOKENS: [Role, Buffer][] = [['COMMITTEE', digest(requireEnv('COMMITTEE_TOKEN', 16))]]
if (process.env.AGENT_TOKEN?.trim()) TOKENS.push(['AGENT', digest(requireEnv('AGENT_TOKEN', 16))])
const store = new Store(DATA_DIR)

function digest(s: string): Buffer {
  return createHash('sha256').update(s).digest()
}

/** 同一来源连续答错口令的次数。超过上限后锁 10 分钟 */
const failures = new Map<string, { count: number; until: number }>()
const MAX_FAILURES = 10
const LOCK_MS = 10 * 60_000

function auth(...allowed: Role[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const who = req.ip ?? 'unknown'
    const f = failures.get(who)
    if (f && f.count >= MAX_FAILURES && Date.now() < f.until) {
      res.status(429).json({ error: '口令连续答错，请 10 分钟后再试' })
      return
    }
    const given = digest(/^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1] ?? '')
    const role = TOKENS.find(([, t]) => timingSafeEqual(t, given))?.[0]
    if (!role) {
      failures.set(who, { count: (f && Date.now() < f.until ? f.count : 0) + 1, until: Date.now() + LOCK_MS })
      res.status(401).json({ error: '口令不对' })
      return
    }
    failures.delete(who)
    if (!allowed.includes(role)) {
      res.status(403).json({ error: '这个口令不能做这件事' })
      return
    }
    res.locals.role = role
    next()
  }
}

/** 执行单现算一次要取两处行情，正常时缓存 3 分钟；账本一变就作废 */
let cached: { at: number; ledgerStamp: string; produced: ProducedCard } | null = null
async function currentCard(): Promise<ProducedCard> {
  const ledger = store.readLedger()
  const ledgerStamp = JSON.stringify(ledger)
  // 停单的执行单只缓存 20 秒：行情源恢复后要尽快重算
  const ttl = cached?.produced.card.ok ? 180_000 : 20_000
  if (cached && cached.ledgerStamp === ledgerStamp && Date.now() - cached.at < ttl) return cached.produced
  const produced = await produceCard(ledger)
  cached = { at: Date.now(), ledgerStamp, produced }
  return produced
}

function instructed(p: ProducedCard): Record<string, number> | null {
  if (!p.card.ok) return null
  return Object.fromEntries(p.card.lines.filter(l => l.shares !== null && l.shares > 0).map(l => [l.code, l.shares as number]))
}

/** 腾讯实时行情里的当日最低价与最高价。取不到就不核对这一项 */
async function dayRanges(codes: string[]): Promise<Record<string, DayRange> | undefined> {
  if (!codes.length) return undefined
  try {
    const symbols = codes.map(c => (/^[69]/.test(c) ? `sh${c}` : `sz${c}`))
    const res = await fetch(`https://qt.gtimg.cn/q=${symbols.join(',')}`, { signal: AbortSignal.timeout(8000) })
    const text = new TextDecoder('gbk').decode(await res.arrayBuffer())
    const out: Record<string, DayRange> = {}
    for (const m of text.matchAll(/v_s[hz](\d{6})="([^"]*)"/g)) {
      const f = m[2]!.split('~')
      const high = Number(f[33])
      const low = Number(f[34])
      if (high > 0 && low > 0) out[m[1]!] = { low, high }
    }
    return out
  } catch {
    return undefined
  }
}

function send(res: Response, result: Submission | string): void {
  if (typeof result === 'string') res.status(400).json({ error: result })
  else res.json({ submission: result })
}

const wrap = (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction): void => { fn(req, res).catch(next) }

const app = express()
app.set('trust proxy', 'loopback')
app.use(helmet({ contentSecurityPolicy: { directives: { 'img-src': ["'self'", 'data:', 'blob:'] } } }))
app.use(express.json({ limit: '12mb' }))

/** 版本号在打包时写入；发布脚本靠它确认线上跑的是刚发的那一版 */
const VERSION = process.env.HONGHU_VERSION ?? 'dev'
app.get('/health', (_req, res) => { res.json({ status: 'ok', version: VERSION }) })

app.get('/api/state', auth('COMMITTEE', 'AGENT'), wrap(async (_req, res) => {
  const produced = await currentCard()
  res.json({
    card: {
      ok: produced.card.ok, title: produced.card.title, generatedAt: produced.generatedAt,
      html: markdownToHtml(produced.card.markdown), markdown: produced.card.markdown,
    },
    ledgerAsOf: store.readLedger()?.asOf ?? null,
    submissions: store.list(30),
  })
}))

app.post('/api/intake', auth('COMMITTEE'), wrap(async (req, res) => {
  const body = req.body as { text?: unknown; image?: unknown }
  const text = typeof body.text === 'string' ? body.text.trim() : ''
  if (typeof body.image === 'string') {
    send(res, submitImage({ store }, body.image, text))
    return
  }
  if (!text) {
    res.status(400).json({ error: '内容是空的' })
    return
  }
  if (text.length > 4000) {
    res.status(400).json({ error: '文字太长，请控制在 4000 字以内' })
    return
  }
  const ctx: IntakeContext = { store }
  if (/^(计划|打算|准备|拟|想|意向)/.test(text)) ctx.instructed = instructed(await currentCard())
  send(res, submitText(ctx, text))
}))

app.get('/api/intake', auth('COMMITTEE', 'AGENT'), (req, res) => {
  const status = typeof req.query.status === 'string' ? req.query.status : null
  const all = store.list(500)
  res.json({ submissions: status ? all.filter(s => s.status === status) : all })
})

app.get('/api/intake/:id/image', auth('COMMITTEE', 'AGENT'), (req, res) => {
  const s = store.get(req.params.id ?? '')
  const file = s ? store.imagePath(s) : null
  if (!file || !existsSync(file)) {
    res.status(404).json({ error: '没有这张图片' })
    return
  }
  res.sendFile(file)
})

app.post('/api/intake/:id/parsed', auth('AGENT', 'COMMITTEE'), wrap(async (req, res) => {
  const payload = req.body as { kind?: string; holdings?: { asOf?: string; positions?: { code?: string }[] } }
  let ranges: Record<string, DayRange> | undefined
  if (payload.kind === 'HOLDINGS' && payload.holdings?.asOf === beijingToday() && Array.isArray(payload.holdings.positions)) {
    ranges = await dayRanges(payload.holdings.positions.map(p => String(p.code)).filter(c => /^\d{6}$/.test(c)))
  }
  send(res, attachParsed({ store, ranges }, req.params.id ?? '', payload))
}))

app.post('/api/intake/:id/confirm', auth('COMMITTEE'), (req, res) => { send(res, confirm({ store }, req.params.id ?? '')) })
app.post('/api/intake/:id/reject', auth('COMMITTEE'), (req, res) => { send(res, reject({ store }, req.params.id ?? '')) })

/** 战略侧做记分牌用：账本、成交、意向 */
app.get('/api/records', auth('AGENT', 'COMMITTEE'), (_req, res) => {
  res.json({ ledger: store.readLedger(), trades: store.readLog('trades'), intents: store.readLog('intents') })
})

const WEB_DIR = resolve(process.env.WEB_DIR ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'frontend', 'dist'))
if (existsSync(join(WEB_DIR, 'index.html'))) {
  app.use(express.static(WEB_DIR, {
    index: 'index.html',
    maxAge: '1h',
    // 首页不缓存：发布新版后，旧首页引用的脚本文件已经不在了
    setHeaders: (res, file) => { if (file.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache') },
  }))
}

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const tooLarge = (err as { type?: string } | null)?.type === 'entity.too.large'
  process.stderr.write(`请求出错：${err instanceof Error ? err.message : String(err)}\n`)
  res.status(tooLarge ? 413 : 500).json({ error: tooLarge ? '图片太大，请控制在 8MB 以内' : '服务器出错' })
})

const PORT = Number(process.env.PORT ?? 5000)
app.listen(PORT, '127.0.0.1', () => {
  process.stdout.write(`鸿鹄服务器已启动：127.0.0.1:${PORT}，数据目录 ${DATA_DIR}\n`)
})
