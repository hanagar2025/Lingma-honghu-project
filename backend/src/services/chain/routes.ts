/**
 * 链上数据与定时汇总的接口。
 *
 * 三种口令各管各的：
 *   BOT        汇总机器人。只读链上数据、占比和指数，只写汇总。读不到账本、成交、截图
 *   AGENT      策略方。另可登记盯线和供给冲击、对汇总写决定；机器人缺席时可以手动补推汇总
 *   COMMITTEE  委员会。另可否决、填净值基准
 *
 * 没有任何向券商下单的接口。/api/orders 登记的是执行单上的指令：写给她本人看的下单计划，由她自己下单。
 */
import type { Express, NextFunction, Request, RequestHandler, Response } from 'express'
import type { Role } from '../auth/auth'
import { publicBook } from '../dailyDecision/book'
import { markdownToHtml } from '../dailyDecision/html'
import { beijingStamp } from '../intake/store'
import { beijing } from '../scheduler'
import { acceptDigest, DIGEST_SLOTS, listDigests, setDecision, setVeto, type DigestDoc } from './digest'
import type { ScriptKind } from './scripts'
import type { ChainService } from './service'
import type { ShockFlag } from './types'
import { seriesView, statusView } from './view'
import { parseLines } from './watch'

export interface RouteDeps {
  auth: (...roles: Role[]) => RequestHandler
  chain: ChainService
  isTrading: (now: Date) => Promise<boolean | null>
  notify: (title: string, body: string) => Promise<void>
}

const DATE = /^\d{4}-\d{2}-\d{2}$/
const wrap = (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction): void => { fn(req, res).catch(next) }

function parseFlags(input: unknown): ShockFlag[] | string {
  if (!Array.isArray(input) || input.length > 100) return '应当是一组登记（最多 100 条）'
  const out: ShockFlag[] = []
  for (const [i, raw] of input.entries()) {
    const r = raw as Record<string, unknown>
    const code = String(r.code ?? '')
    const reason = String(r.reason ?? '').trim()
    const source = String(r.source ?? '').trim()
    const since = String(r.since ?? '')
    if (!/^\d{6}$/.test(code)) return `第 ${i + 1} 条：代码不对`
    if (!reason || reason.length > 200 || !source || source.length > 200) return `第 ${i + 1} 条：要写事由和出处（各 200 字以内）`
    if (!DATE.test(since) || (r.until != null && !DATE.test(String(r.until)))) return `第 ${i + 1} 条：日期写成 2026-11-24 这样`
    out.push({ code, name: String(r.name ?? '').slice(0, 20), reason, source, since, until: r.until == null ? null : String(r.until) })
  }
  return out
}

export function mountChain(app: Express, deps: RouteDeps): void {
  const { auth, chain } = deps
  const read = auth('BOT', 'AGENT', 'COMMITTEE')
  const store = chain.store

  // 页面每次刷新都问一遍今天开不开市；判断得出的结果留一分钟，不每次都去问行情源
  let tradingSeen: { at: number; date: string; value: boolean } | null = null
  const tradingToday = async (now: Date): Promise<boolean | null> => {
    const bj = beijing(now)
    if (bj.weekday === 0 || bj.weekday === 6) return false
    if (tradingSeen && tradingSeen.date === bj.date && now.getTime() - tradingSeen.at < 60_000) return tradingSeen.value
    const value = await deps.isTrading(now)
    if (value !== null) tradingSeen = { at: now.getTime(), date: bj.date, value }
    return value
  }

  /** 今天是不是交易日、数据到了哪一天、各时点 */
  app.get('/api/chain/calendar', read, wrap(async (_req, res) => {
    const now = new Date()
    const bj = beijing(now)
    const market = store.market().margin
    res.json({
      now: beijingStamp(now), today: bj.date, weekday: bj.weekday,
      // null = 判断不出（行情日期还没切到今天，或行情源不通）
      trading: bj.weekday === 0 || bj.weekday === 6 ? false : await deps.isTrading(now),
      lastClosed: chain.lastClosed(),
      marginAsOf: market[market.length - 1]?.date ?? null,
      slots: DIGEST_SLOTS,
    })
  }))

  /** 数据到了哪一步。只有日期和只数，发布后核对和页面「数据状态」用 */
  app.get('/api/chain/status', read, wrap(async (_req, res) => {
    const now = new Date()
    const bj = beijing(now)
    const status = statusView(store, chain.segments(), now)
    const jobError = (kind: ScriptKind): string | null => (status.lastClosed ? chain.runner.job(kind, status.lastClosed)?.error ?? null : null)
    res.json({
      ...status,
      today: bj.date, weekday: bj.weekday, time: bj.time,
      // null = 判断不出
      trading: await tradingToday(now),
      // 最新收盘日的脚本没跑出来时的原因（例如服务器上没有 Python）
      scriptError: jobError('mainline') ?? jobError('scan'),
    })
  }))

  app.get('/api/chain/series', read, (req, res) => {
    res.json(seriesView(store, chain.segments(), Number(req.query.days) || 70))
  })

  app.get('/api/chain/intraday', read, (req, res) => {
    const date = typeof req.query.date === 'string' ? req.query.date : beijing(new Date()).date
    const snaps = store.intraday(date)
    res.json({ date, count: snaps.length, latest: snaps[snaps.length - 1] ?? null })
  })

  /** 脚本输出，原样。不带日期给最新一份；带 ensure=1 时没有就现在开始跑 */
  const script = (kind: ScriptKind) => (req: Request, res: Response): void => {
    const dates = store.scriptDates(kind)
    const date = typeof req.query.date === 'string' ? req.query.date : dates[dates.length - 1] ?? ''
    if (!DATE.test(date)) {
      res.json({ state: 'missing', date: null, dates, data: null, text: null, error: null })
      return
    }
    const asked = req.query.ensure === '1' ? chain.ensureScript(kind, date) : null
    const running = chain.runner.job(kind, date)
    const data = store.scriptOutput(kind, date)
    res.json({
      state: data !== null ? 'ready' : asked?.state ?? (running?.state === 'running' ? 'running' : running?.state === 'failed' ? 'failed' : 'missing'),
      date, dates: dates.slice(-30), data,
      text: req.query.text === '0' ? null : store.scriptText(kind, date), error: asked?.error ?? running?.error ?? null,
    })
  }
  app.get('/api/chain/mainline', read, script('mainline'))
  app.get('/api/chain/scan', read, script('scan'))

  /** 只有占比和净值指数 */
  app.get('/api/chain/portfolio', read, wrap(async (_req, res) => { res.json(await chain.portfolio()) }))

  app.get('/api/chain/watch', read, wrap(async (req, res) => { res.json(await chain.lines(req.query.live === '1')) }))

  app.put('/api/chain/watch', auth('AGENT', 'COMMITTEE'), (req, res) => {
    const lines = parseLines((req.body as { lines?: unknown }).lines)
    if (typeof lines === 'string') { res.status(400).json({ error: lines }); return }
    store.saveDoc('watch', lines)
    res.json({ lines })
  })

  app.get('/api/chain/flags', read, (_req, res) => { res.json({ flags: store.flags() }) })

  app.put('/api/chain/flags', auth('AGENT', 'COMMITTEE'), (req, res) => {
    const flags = parseFlags((req.body as { flags?: unknown }).flags)
    if (typeof flags === 'string') { res.status(400).json({ error: flags }); return }
    store.saveDoc('flags', flags)
    res.json({ flags })
  })

  /** 净值基准。金额只落在服务器，这里不回显 */
  app.put('/api/chain/base', auth('COMMITTEE'), (req, res) => {
    const body = req.body as { totalAssets?: unknown; at?: unknown }
    const problem = chain.setBase(body.totalAssets, body.at)
    if (problem) { res.status(400).json({ error: problem }); return }
    res.json({ ok: true, at: body.at, index: 100 })
  })

  // ── 执行单上的指令 ──
  // 规则卖出和盯线卖出由执行单自己生成；这里是策略方登记的买入、卖出，以及备用目标的切换。
  // 机器人读不到：指令簿里有持仓信息。

  const orderRoles = auth('AGENT', 'COMMITTEE')

  app.get('/api/orders', orderRoles, (_req, res) => { res.json(publicBook(chain.book())) })

  app.post('/api/orders', auth('AGENT'), wrap(async (req, res) => {
    const result = await chain.registerOrder(req.body)
    if (typeof result === 'string') { res.status(400).json({ error: result }); return }
    const { keep: _keep, ...instruction } = result
    res.json({ instruction })
  }))

  /** 策略方撤销，或委员会否决 */
  app.delete('/api/orders/:id', orderRoles, (req, res) => {
    const problem = chain.cancelOrder(req.params.id ?? '', res.locals.role === 'COMMITTEE' ? '委员会' : '策略方')
    if (problem) { res.status(400).json({ error: problem }); return }
    res.json(publicBook(chain.book()))
  })

  app.put('/api/orders/backup', orderRoles, (req, res) => {
    const body = (req.body ?? {}) as { on?: unknown; why?: unknown }
    const problem = chain.setBackup(body.on, body.why)
    if (problem) { res.status(400).json({ error: problem }); return }
    res.json(publicBook(chain.book()))
  })

  /** 现在就拉一次。日常由服务器自己到点拉；这个口子给补数和排障用 */
  app.post('/api/chain/jobs/:name', read, wrap(async (req, res) => {
    const name = req.params.name ?? ''
    const now = new Date()
    const body = (req.body ?? {}) as { date?: unknown; backfill?: unknown }
    const backfill = body.backfill === true
    if (name === 'daily') res.json({ runs: [await chain.pullDaily(now, backfill)] })
    else if (name === 'margin') res.json({ runs: await chain.pullMargin(now, backfill) })
    else if (name === 'intraday') res.json({ runs: [await chain.pullIntraday(now)] })
    else if (name === 'mainline' || name === 'scan') {
      const date = typeof body.date === 'string' && DATE.test(body.date) ? body.date : chain.lastClosed()
      if (!date) { res.status(400).json({ error: '还没有日线，先拉 daily' }); return }
      res.json({ date, ...chain.ensureScript(name, date, now) })
    } else res.status(404).json({ error: '没有这个任务' })
  }))

  app.get('/api/chain/runs', read, (_req, res) => { res.json({ runs: store.runs(60).reverse() }) })

  // ── 汇总 ──

  // 汇总由机器人推；机器人没上线或出故障时，策略方可以用同一套程序手动补一份
  app.post('/api/digest', auth('BOT', 'AGENT'), wrap(async (req, res) => {
    const doc = acceptDigest(store, req.body, new Date(), res.locals.role === 'AGENT' ? 'AGENT' : 'BOT')
    if (typeof doc === 'string') { res.status(400).json({ error: doc }); return }
    res.json({ ok: true, date: doc.date, slot: doc.slot, revision: doc.revision })
    // 汇总带了短讯就推到手机。重推不重复打扰
    const push = (req.body as { push?: unknown }).push
    if (doc.revision === 1 && typeof push === 'string' && push.trim()) {
      await deps.notify(doc.title, `${push.trim().slice(0, 3000)}\n\n只有读数，没有指令。决定由策略方写，委员会可否决。`).catch(() => undefined)
    }
  }))

  app.get('/api/digest', read, (req, res) => {
    res.json({ slots: DIGEST_SLOTS, digests: listDigests(store, Math.min(Number(req.query.days) || 10, 60)) })
  })

  app.get('/api/digest/:date/:slot', read, (req, res) => {
    const { date = '', slot = '' } = req.params
    const doc = DATE.test(date) && /^[a-z]+$/.test(slot) ? store.digest<DigestDoc>(date, slot) : null
    if (!doc) { res.status(404).json({ error: '没有这份汇总' }); return }
    // 页面要现成的 HTML：正文在服务器上转义后再转
    res.json(req.query.html === '1' ? { ...doc, html: markdownToHtml(doc.markdown) } : doc)
  })

  const annotate = (fn: typeof setDecision, key: 'text' | 'note') => (req: Request, res: Response): void => {
    const doc = fn(store, req.params.date ?? '', req.params.slot ?? '', (req.body as Record<string, unknown>)[key])
    if (typeof doc === 'string') res.status(400).json({ error: doc })
    else res.json(doc)
  }
  app.post('/api/digest/:date/:slot/decision', auth('AGENT'), annotate(setDecision, 'text'))
  app.post('/api/digest/:date/:slot/veto', auth('COMMITTEE'), annotate(setVeto, 'note'))
}
