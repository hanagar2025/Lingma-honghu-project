/**
 * 鸿鹄服务器：一个页面、一个输入框。
 *
 * 委员会在页面上交持仓、成交、下单前的一行字；页面给回按真实账本现算的执行单。
 * 账本、成交、意向、截图只存在服务器的私有目录里，不进仓库。
 *
 * 环境变量：
 *   DATA_DIR         私有数据目录（必填，放在仓库之外）
 *   COMMITTEE_TOKEN  安装口令（必填，至少 16 位）。页面上另可设好记的口令和登录链接，见 services/auth
 *   AGENT_TOKEN      战略侧读取与交回识别结果用的口令（选填，至少 16 位）
 *   BOT_TOKEN        汇总机器人的口令（选填，至少 32 位）。只能读链上数据、占比和净值指数，只能写汇总；读不到账本。
 *                    在 Cursor 托管的机器人那边，它存成密钥 HONGHU_AGENT_TOKEN
 *   HONGHU_CHAIN     设为 off 时不拉链上数据（缺省开启）
 *   PORT             缺省 5000
 *   推送通道与截图识别服务的密钥由委员会在页面「设置」里填，存在 DATA_DIR/settings.json；
 *   也可以用环境变量 PUSHPLUS_TOKEN、BARK_URL、WECOM_WEBHOOK、SERVERCHAN_SENDKEY、VISION_API_KEY 等给缺省值。
 *   WEB_DIR          前端构建产物目录，缺省 ../frontend/dist
 */
import express, { type NextFunction, type Request, type Response } from 'express'
import helmet from 'helmet'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Auth, PASSWORD_MAX, PASSWORD_MIN, type Role } from './services/auth/auth'
import { runDaily, type Daily } from './services/daily'
import { pushAll, type PushResult } from './services/dailyDecision/notify'
import { markdownToHtml } from './services/dailyDecision/html'
import { beijingToday } from './services/dailyDecision/ledger'
import { produceCard, type ProducedCard } from './services/dailyDecision/produce'
import type { DayRange, Instructed } from './services/intake/reconcile'
import { attachParsed, autoRecognize, confirm, reject, submitImage, submitText, type IntakeContext } from './services/intake/service'
import { mountChain } from './services/chain/routes'
import { ChainService } from './services/chain/service'
import { beijingStamp, Store } from './services/intake/store'
import type { Submission } from './services/intake/types'
import { isTradingToday, SLOTS, startScheduler, type Slot } from './services/scheduler'
import { Settings } from './services/settings'

function requireEnv(name: string, minLength: number): string {
  const v = process.env[name]?.trim() ?? ''
  if (v.length < minLength) {
    process.stderr.write(`缺少环境变量 ${name}（至少 ${minLength} 位）。不带口令不启动。\n`)
    process.exit(1)
  }
  return v
}

const DATA_DIR = resolve(requireEnv('DATA_DIR', 1))
const store = new Store(DATA_DIR)
const settings = new Settings(store)
const authority = new Auth(join(DATA_DIR, 'auth.json'), {
  committee: requireEnv('COMMITTEE_TOKEN', 16),
  agent: process.env.AGENT_TOKEN?.trim() ? requireEnv('AGENT_TOKEN', 16) : undefined,
  bot: process.env.BOT_TOKEN?.trim() ? requireEnv('BOT_TOKEN', 32) : undefined,
})

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
    const raw = /^Bearer (.+)$/.exec(req.headers.authorization ?? '')?.[1] ?? ''
    let given = ''
    try { given = decodeURIComponent(raw) } catch { given = raw }
    const role = authority.roleFor(given)
    if (!role) {
      failures.set(who, { count: (f && Date.now() < f.until ? f.count : 0) + 1, until: Date.now() + LOCK_MS })
      authority.noteFailure()
      const paused = authority.passwordPaused && authority.hasPassword
      res.status(401).json({ error: paused ? '近一小时口令答错太多，好记的口令暂停一小时；登录链接照常可用' : '口令不对' })
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
  // 策略方登记或撤销了指令，执行单也要重算
  const ledgerStamp = `${JSON.stringify(ledger)}|${chain.book().updatedAt}`
  // 停单的执行单只缓存 20 秒：行情源恢复后要尽快重算
  const ttl = cached?.produced.card.ok ? 180_000 : 20_000
  if (cached && cached.ledgerStamp === ledgerStamp && Date.now() - cached.at < ttl) return cached.produced
  const produced = await produceCard(ledger, new Date(), chain.planSource())
  cached = { at: Date.now(), ledgerStamp, produced }
  return produced
}

/** 简报要取十几处行情和融资数据，缓存 5 分钟；账本或执行单结论一变就重算。同时到来的请求共用一次计算 */
let dailyCache: { at: number; key: string; daily: Promise<Daily> } | null = null
async function currentDaily(): Promise<Daily> {
  const produced = await currentCard()
  const key = `${JSON.stringify(store.readLedger())}|${produced.card.title}`
  if (dailyCache && dailyCache.key === key && Date.now() - dailyCache.at < 300_000) return dailyCache.daily
  const daily = runDaily(store, produced)
  dailyCache = { at: Date.now(), key, daily }
  daily.catch(() => { if (dailyCache?.daily === daily) dailyCache = null })
  return daily
}

interface PushLog { at: string; what: string; results: PushResult[] }

/** 推送一次执行单与简报。没有配置通道时什么都不做 */
async function pushDecision(what: string, produced: ProducedCard, daily: Daily): Promise<void> {
  if (!settings.pushConfigured) return
  const site = store.readDoc<{ url: string }>('site')?.url
  const body = [produced.card.push, '', daily.brief.push, ...(site ? ['', `全文与确认入口：${site}`] : [])].join('\n')
  const results = await pushAll(produced.card.title, body, settings.pushEnv())
  store.writeDoc('pushlog', { at: beijingStamp(), what, results: results.map(r => ({ ...r, detail: r.detail.slice(0, 120) })) } satisfies PushLog)
  for (const r of results) process.stdout.write(`推送（${what}）${r.channel}：${r.ok ? '成功' : `失败 ${r.detail}`}\n`)
}

async function runSlot(slot: Slot, now: Date): Promise<boolean> {
  const trading = await isTradingToday(now)
  // 开盘前行情日期可能还没切到今天，窗口内再试；其余时段日期不是今天就是休市
  if (trading !== true) return slot.id !== 'pre' && trading === false
  const produced = await produceCard(store.readLedger(), now, chain.planSource())
  const daily = await runDaily(store, produced, { now })
  if (slot.always || (produced.card.ok && produced.card.lines.length > 0)) await pushDecision(slot.label, produced, daily)
  return true
}

function instructed(p: ProducedCard): Instructed | null {
  if (!p.card.ok) return null
  const side = (s: 'SELL' | 'BUY'): Record<string, number> =>
    Object.fromEntries(p.card.lines.filter(l => l.side === s && l.shares !== null && l.shares > 0).map(l => [l.code, l.shares as number]))
  return { sell: side('SELL'), buy: side('BUY') }
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

app.get('/api/state', auth('COMMITTEE', 'AGENT'), wrap(async (req, res) => {
  // 推送里要带上页面地址。记下委员会实际打开的那个域名
  const host = req.get('host')
  if (res.locals.role === 'COMMITTEE' && host && /^[\w.-]+$/.test(host) && store.readDoc<{ url: string }>('site')?.url !== `https://${host}`) {
    store.writeDoc('site', { url: `https://${host}` })
  }
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
    const result = submitImage({ store }, body.image, text)
    const vision = settings.vision()
    if (typeof result !== 'string' && vision) {
      result.summary = '图片已收到，正在自动识别，一般不超过一分钟。识别结果出来后需要您确认。'
      store.save(result)
      void autoRecognize(store, result.id, vision, dayRanges)
        .catch(e => { process.stderr.write(`自动识别出错：${e instanceof Error ? e.message : String(e)}\n`) })
    }
    send(res, result)
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

app.post('/api/intake/:id/confirm', auth('COMMITTEE'), (req, res) => {
  const result = confirm({ store }, req.params.id ?? '')
  send(res, result)
  // 账本一更新就按新账本重算并推送，不等下一个定时时段
  if (typeof result !== 'string' && result.parsed?.kind === 'HOLDINGS') {
    void (async () => {
      const produced = await currentCard()
      await pushDecision('账本更新', produced, await currentDaily())
    })().catch(e => { process.stderr.write(`账本更新后的推送出错：${e instanceof Error ? e.message : String(e)}\n`) })
  }
})
app.post('/api/intake/:id/reject', auth('COMMITTEE'), (req, res) => { send(res, reject({ store }, req.params.id ?? '')) })

app.get('/api/brief', auth('COMMITTEE', 'AGENT'), wrap(async (_req, res) => {
  const { brief } = await currentDaily()
  res.json({
    asOf: brief.asOf, generatedAt: brief.generatedAt, changes: brief.changes,
    sections: brief.sections.map(s => ({ id: s.id, title: s.title, html: markdownToHtml(s.markdown), markdown: s.markdown })),
  })
}))

function settingsView(): unknown {
  return {
    items: settings.view(),
    pushConfigured: settings.pushConfigured,
    visionConfigured: settings.vision() !== null,
    slots: SLOTS.map(s => ({ at: s.at, label: s.label, always: s.always })),
    lastPush: store.readDoc<PushLog>('pushlog'),
  }
}

app.get('/api/settings', auth('COMMITTEE'), (_req, res) => { res.json(settingsView()) })

app.post('/api/settings', auth('COMMITTEE'), (req, res) => {
  const body = req.body as { key?: unknown; value?: unknown }
  const problem = typeof body.key === 'string' && typeof body.value === 'string' ? settings.set(body.key, body.value) : '缺少设置项或内容'
  if (problem) res.status(400).json({ error: problem })
  else res.json(settingsView())
})

app.post('/api/settings/test-push', auth('COMMITTEE'), wrap(async (_req, res) => {
  if (!settings.pushConfigured) {
    res.status(400).json({ error: '还没有填任何推送通道' })
    return
  }
  const results = await pushAll('鸿鹄：推送测试', '这是一条测试消息。收到它，说明执行单能推送到这里。', settings.pushEnv())
  res.json({ results: results.map(r => ({ channel: r.channel, ok: r.ok })) })
}))

function loginLink(req: Request): string {
  return `https://${req.get('host') ?? 'localhost'}/#k=${authority.linkKey}`
}

app.get('/api/auth', auth('COMMITTEE'), (req, res) => {
  res.json({ hasPassword: authority.hasPassword, passwordSetAt: authority.passwordSetAt, link: loginLink(req) })
})

app.post('/api/auth/password', auth('COMMITTEE'), (req, res) => {
  const password = (req.body as { password?: unknown }).password
  if (typeof password !== 'string') {
    res.status(400).json({ error: `口令要 ${PASSWORD_MIN} 到 ${PASSWORD_MAX} 个字` })
    return
  }
  const problem = authority.setPassword(password)
  if (problem) res.status(400).json({ error: problem })
  else res.json({ ok: true, passwordSetAt: authority.passwordSetAt })
})

app.post('/api/auth/link', auth('COMMITTEE'), (req, res) => {
  authority.newLink()
  res.json({ link: loginLink(req) })
})

/** 战略侧做记分牌用：账本、成交、意向 */
app.get('/api/records', auth('AGENT', 'COMMITTEE'), (_req, res) => {
  res.json({ ledger: store.readLedger(), trades: store.readLog('trades'), intents: store.readLog('intents') })
})

/** 链上数据与定时汇总。推送沿用页面「设置」里填的通道 */
async function notify(title: string, body: string): Promise<void> {
  if (!settings.pushConfigured) return
  const site = store.readDoc<{ url: string }>('site')?.url
  const results = await pushAll(title, site ? `${body}\n\n全文：${site}` : body, settings.pushEnv())
  for (const r of results) process.stdout.write(`推送（${title}）${r.channel}：${r.ok ? '成功' : `失败 ${r.detail.slice(0, 120)}`}\n`)
}
const chain = new ChainService({
  dataDir: DATA_DIR,
  readLedger: () => store.readLedger(),
  notify,
  isTrading: now => isTradingToday(now),
  log: line => process.stderr.write(`${line}\n`),
})
chain.init()
mountChain(app, { auth, chain, isTrading: now => isTradingToday(now), notify })

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

startScheduler({
  loadDone: () => store.readDoc<Record<string, string>>('schedule') ?? {},
  saveDone: done => store.writeDoc('schedule', done),
  run: runSlot,
  log: line => process.stderr.write(`${line}\n`),
})

if (process.env.HONGHU_CHAIN !== 'off') chain.start()
