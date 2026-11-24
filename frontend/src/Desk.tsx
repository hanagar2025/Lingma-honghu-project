/**
 * 页面上的三块：定时汇总、执行单上的指令、净值基准。
 *
 * 委员会看到否决按钮；策略方看到登记指令和写决定的入口。谁能做什么由服务器按口令判定，这里只决定显示什么。
 * 页面不下单：指令是下单计划，由委员会本人操作。
 */
import { useCallback, useEffect, useState } from 'react'
import {
  ApiError, annotateDigest, cancelOrder, fetchDigest, fetchDigests, fetchOrders, registerOrder, saveBase,
  type ChainStatus, type DigestDoc, type DigestHead, type DigestSlot, type Instruction, type NewOrder, type OrderBook, type Role,
} from './api'

type OnError = (e: unknown) => void

const md = (date: string | null | undefined): string => (date ? date.slice(5) : '还没有')
const upTo = (date: string | null): string => (date ? `到 ${date}` : '还没有')

/**
 * 操作出的错写在按钮旁边：这几块在页面中段，写到页面顶上在手机上看不见。
 * 口令失效照旧交给页面处理（回到登录）。
 */
function useProblem(onError: OnError): { problem: string; report: OnError; clear: () => void } {
  const [problem, setProblem] = useState('')
  const report = useCallback((e: unknown) => {
    if (e instanceof ApiError && e.status === 401) onError(e)
    else setProblem(e instanceof Error ? e.message : '出错了')
  }, [onError])
  const clear = useCallback(() => setProblem(''), [])
  return { problem, report, clear }
}

function TodaySlots({ slots, heads, status }: { slots: DigestSlot[]; heads: DigestHead[]; status: ChainStatus }) {
  if (status.trading === false) return <p className="muted">今天（{md(status.today)}）休市，没有汇总。</p>
  const due = slots.filter(s => s.weekday === undefined || s.weekday === status.weekday)
  return (
    <>
      <ul className="chips">
        {due.map(s => {
          const arrived = heads.some(h => h.date === status.today && h.slot === s.id)
          const text = arrived ? '已到' : status.time < s.at ? '未到时点' : '没有收到'
          return <li key={s.id} className={arrived ? 'on' : text === '没有收到' ? 'off' : ''}>{s.at} {s.label}：{text}</li>
        })}
      </ul>
      {status.trading === null && <p className="muted">判断不出今天是否开市（行情日期还没切到今天，或行情源不通）。</p>}
    </>
  )
}

const RUN_TEXT: Record<string, string> = { daily: '日线与主力净流入', margin: '融资余额', earnings: '业绩', intraday: '盘中快照' }

function DataStatus({ status }: { status: ChainStatus }) {
  const { stocks } = status
  return (
    <details>
      <summary>数据状态：日线到 {md(status.lastClosed)}，{status.gaps.length ? `缺口 ${status.gaps.length} 项` : '没有缺口'}</summary>
      <ul className="help">
        <li>
          日线：名单 {stocks.expected} 只，{stocks.have} 只有数，最新{upTo(status.lastClosed)}
          {stocks.minBars !== null && `；最少的一只有 ${stocks.minBars} 个交易日`}
        </li>
        <li>融资余额：{upTo(status.marginAsOf)}</li>
        <li>环节排序读数：{upTo(status.scripts.mainline)}；全市场扫描读数：{upTo(status.scripts.scan)}</li>
        {status.scriptError && <li>扫描脚本没有跑出来：{status.scriptError}</li>}
        <li>净值基准：{status.base ? `已填（基准时点 ${status.base.at}）` : '还没有填，净值指数和三条线算不出。在下面「设置」里填'}</li>
        {status.lastRuns.map(r => (
          <li key={r.task}>
            最近一次拉{RUN_TEXT[r.task] ?? r.task}：{r.at.slice(5, 16)}，成功 {r.ok} 只{r.failed ? `，缺 ${r.failed} 项` : ''}
          </li>
        ))}
        {status.gaps.slice(0, 12).map(g => <li key={g}>缺：{g}</li>)}
        {status.gaps.length > 12 && <li>另有 {status.gaps.length - 12} 项缺口没有列出</li>}
      </ul>
    </details>
  )
}

export function DigestPanel({ role, status, onError }: { role: Role | null; status: ChainStatus | null; onError: OnError }) {
  const [list, setList] = useState<{ slots: DigestSlot[]; digests: DigestHead[] } | null>(null)
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [doc, setDoc] = useState<DigestDoc | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const { problem, report, clear } = useProblem(onError)

  const load = useCallback(() => fetchDigests().then(setList), [])
  useEffect(() => {
    load().catch(onError)
    const timer = window.setInterval(() => { load().catch(() => undefined) }, 300_000)
    return () => window.clearInterval(timer)
  }, [load, onError])

  function toggle(h: DigestHead) {
    const key = `${h.date}/${h.slot}`
    if (openKey === key) { setOpenKey(null); return }
    setOpenKey(key)
    setDoc(null)
    setNote('')
    clear()
    fetchDigest(h.date, h.slot).then(setDoc).catch(report)
  }

  async function annotate(kind: 'decision' | 'veto') {
    if (!doc || !note.trim()) return
    if (kind === 'veto' && !window.confirm('否决会记在这份汇总上，策略方读汇总时会看到。确定否决？')) return
    setBusy(true)
    try {
      await annotateDigest(doc.date, doc.slot, kind, note.trim())
      setDoc(await fetchDigest(doc.date, doc.slot))
      setNote('')
      clear()
      await load()
    } catch (e) { report(e) } finally { setBusy(false) }
  }

  const label = (slot: string): string => list?.slots.find(s => s.id === slot)?.label ?? slot
  const shown = doc && `${doc.date}/${doc.slot}` === openKey ? doc : null

  return (
    <section className="panel">
      <h2>定时汇总</h2>
      <p className="muted">
        汇总只有读数，没有指令。
        {role === 'AGENT' ? '决定由策略方写，委员会可以否决；下单由委员会本人操作。' : '决定由策略方写，您可以否决；下单由您本人操作。'}
      </p>
      {list && status && <TodaySlots slots={list.slots} heads={list.digests} status={status} />}
      {!list && <p className="muted">读取中</p>}
      {list && list.digests.length === 0 && <p className="muted">还没有收到过汇总。</p>}
      {list && list.digests.length > 0 && (
        <ul className="items">
          {list.digests.map(h => {
            const key = `${h.date}/${h.slot}`
            const open = openKey === key
            return (
              <li key={key} className="item">
                <button type="button" className="row" aria-expanded={open} onClick={() => toggle(h)}>
                  <span>{md(h.date)} {label(h.slot)}</span>
                  <span className={h.vetoed ? 'tag bad' : h.decided ? 'tag' : 'tag wait'}>
                    {h.vetoed ? '已否决' : h.decided ? '策略方已写决定' : '还没有决定'}
                  </span>
                  <span className="more">{open ? '收起' : '展开'}</span>
                </button>
                {open && !shown && (problem ? <p className="error" role="alert">{problem}</p> : <p className="muted">读取中</p>)}
                {open && shown && (
                  <div className="digest">
                    <p className="muted">
                      读数截至 {shown.asOf ?? '未知'}；生成于 {shown.generatedAt}（北京时间）；
                      {shown.by === 'AGENT' ? '策略方手动补推' : '机器人推送'}{shown.revision > 1 ? `，第 ${shown.revision} 次推送` : ''}
                    </p>
                    <div className={`reply ${shown.decision ? '' : 'pending_parse'}`}>
                      <strong>策略方的决定{shown.decision ? `（${shown.decision.at.slice(5, 16)}）` : ''}</strong>
                      <p className="pre">{shown.decision ? shown.decision.text : '还没有写。'}</p>
                    </div>
                    {shown.veto && (
                      <div className="reply needs_fix">
                        <strong>委员会的否决（{shown.veto.at.slice(5, 16)}）</strong>
                        <p className="pre">{shown.veto.note}</p>
                      </div>
                    )}
                    {role && (
                      <form className="annotate" onSubmit={e => { e.preventDefault(); void annotate(role === 'COMMITTEE' ? 'veto' : 'decision') }}>
                        <textarea
                          rows={2} value={note} onChange={e => setNote(e.target.value)} maxLength={4000}
                          placeholder={role === 'COMMITTEE' ? '否决的理由（必填）' : '决定：做什么、依据哪一条读数和规则'}
                        />
                        {problem && <p className="error" role="alert">{problem}</p>}
                        <div className="actions">
                          <button type="submit" className={role === 'COMMITTEE' ? 'danger' : ''} disabled={busy || !note.trim()}>
                            {busy ? '提交中' : role === 'COMMITTEE' ? (shown.veto ? '改写否决' : '否决') : (shown.decision ? '改写决定' : '写下决定')}
                          </button>
                        </div>
                      </form>
                    )}
                    {/* 汇总由服务器把 Markdown 转成 HTML，正文已转义 */}
                    <div className="md" dangerouslySetInnerHTML={{ __html: shown.html }} />
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {status && <DataStatus status={status} />}
    </section>
  )
}

const ORIGIN_TEXT: Record<Instruction['origin'], string> = {
  RULE_ZERO: '规则卖出：资金 0 分',
  RULE_TREND: '规则卖出：跌破 60 日线且融资在降',
  RULE_HALVE: '规则卖出：资金分连续 2 天偏低',
  WATCH: '盯线卖出',
  STRATEGY: '策略方登记',
}
const CLOSED_TEXT: Record<Instruction['status'], string> = { OPEN: '未结束', DONE: '已完成', EXPIRED: '已作废', CANCELLED: '已撤下' }

const what = (i: Instruction): string => (i.side === 'SELL'
  ? `卖出 ${i.name}（${i.code}）${i.portion ?? ''}`
  : `买入 ${i.name}（${i.code}），买到占总资产 ${((i.targetWeight ?? 0) * 100).toFixed(1)}% 为止`)

const EMPTY_ORDER = { side: 'SELL' as 'SELL' | 'BUY', code: '', name: '', sell: 'HALF' as 'ALL' | 'HALF' | 'THIRD', weight: '', reason: '', source: '' }

function RegisterForm({ onAttempt, onDone, onError }: { onAttempt: () => void; onDone: (i: Instruction) => void; onError: OnError }) {
  const [f, setF] = useState(EMPTY_ORDER)
  const [busy, setBusy] = useState(false)
  const { problem, report, clear } = useProblem(onError)
  const set = (patch: Partial<typeof EMPTY_ORDER>) => { clear(); setF(v => ({ ...v, ...patch })) }
  const weight = Number(f.weight)
  const ready = /^\d{6}$/.test(f.code.trim()) && f.reason.trim() && f.source.trim() && (f.side === 'SELL' || (weight > 0 && weight <= 100))

  async function send() {
    const order: NewOrder = {
      code: f.code.trim(), side: f.side, reason: f.reason.trim(), source: f.source.trim(),
      ...(f.name.trim() ? { name: f.name.trim() } : {}),
      ...(f.side === 'SELL' ? { sell: f.sell } : { targetWeight: Math.round(weight * 100) / 10000 }),
    }
    setBusy(true)
    onAttempt()
    try {
      const { instruction } = await registerOrder(order)
      setF(EMPTY_ORDER)
      clear()
      onDone(instruction)
    } catch (e) { report(e) } finally { setBusy(false) }
  }

  return (
    <details>
      <summary>登记一条指令</summary>
      <form className="order-form" onSubmit={e => { e.preventDefault(); if (ready) void send() }}>
        <label>方向
          <select value={f.side} onChange={e => set({ side: e.target.value === 'BUY' ? 'BUY' : 'SELL' })}>
            <option value="SELL">卖出</option>
            <option value="BUY">买入</option>
          </select>
        </label>
        <label>代码
          <input type="text" inputMode="numeric" maxLength={6} value={f.code} placeholder="6 位代码" onChange={e => set({ code: e.target.value })} />
        </label>
        <label>名称
          <input type="text" maxLength={20} value={f.name} placeholder="已持有的可以不填" onChange={e => set({ name: e.target.value })} />
        </label>
        {f.side === 'SELL'
          ? (
            <label>卖多少
              <select value={f.sell} onChange={e => set({ sell: e.target.value as 'ALL' | 'HALF' | 'THIRD' })}>
                <option value="ALL">全部</option>
                <option value="HALF">一半</option>
                <option value="THIRD">三分之一</option>
              </select>
            </label>
          )
          : (
            <label>目标占比（%）
              <input type="text" inputMode="decimal" value={f.weight} placeholder="例如 10" onChange={e => set({ weight: e.target.value })} />
            </label>
          )}
        <label className="wide">理由：成立的条件和读数。只写比例和读数，不写股数和金额
          <textarea rows={2} maxLength={300} value={f.reason} onChange={e => set({ reason: e.target.value })} />
        </label>
        <label className="wide">出处：规则章节或文档
          <input type="text" maxLength={200} value={f.source} onChange={e => set({ source: e.target.value })} />
        </label>
        {problem && <p className="error wide" role="alert">{problem}</p>}
        <div className="actions wide">
          <button type="submit" disabled={busy || !ready}>{busy ? '登记中' : '登记'}</button>
        </div>
      </form>
      <p className="muted">买入写目标占比：买到占总资产百分之多少为止。登记后执行单逐条过规则再列出。同一只股票同一方向只留一条未结束的指令。</p>
    </details>
  )
}

/** stamp：执行单每重算一次就变，指令簿跟着重读 */
export function OrdersPanel({ role, stamp, onChanged, onError }: { role: Role | null; stamp: string; onChanged: () => void; onError: OnError }) {
  const [book, setBook] = useState<OrderBook | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const { problem, report, clear } = useProblem(onError)

  useEffect(() => { fetchOrders().then(setBook).catch(report) }, [stamp, report])

  async function cancel(i: Instruction) {
    const verb = role === 'COMMITTEE' ? '否决' : '撤销'
    if (!window.confirm(`${verb}后这条指令从执行单上撤下。确定${verb}「${what(i)}」？`)) return
    setBusy(true)
    try {
      setBook(await cancelOrder(i.id))
      setNote(`已${verb}：${what(i)}`)
      clear()
      onChanged()
    } catch (e) { setNote(''); report(e) } finally { setBusy(false) }
  }

  const open = book?.instructions.filter(i => i.status === 'OPEN') ?? []
  const closed = book?.instructions.filter(i => i.status !== 'OPEN').slice(0, 20) ?? []

  return (
    <section className="panel">
      <h2>执行单上的指令</h2>
      <p className="muted">
        卖出由规则和盯线生成，买入只来自策略方登记。指令是下单计划，系统不下单。
        {book?.backup ? `已切换备用目标（${book.backup.since} 起）：${book.backup.why}` : ''}
      </p>
      {problem && <p className="error" role="alert">{problem}</p>}
      {!book && !problem && <p className="muted">读取中</p>}
      {book && open.length === 0 && <p className="muted">现在没有未结束的指令。</p>}
      {open.length > 0 && (
        <ul className="items">
          {open.map(i => (
            <li key={i.id} className="item">
              <div className="item-head">
                <span className="tag wait">未结束</span>
                <span>{ORIGIN_TEXT[i.origin]}</span>
                <time>{md(i.triggerDate)} 触发</time>
              </div>
              <p className="verdict">{what(i)}</p>
              <p>{i.reason}</p>
              <p className="muted">出处：{i.source}</p>
              {role && (
                <div className="actions">
                  <button type="button" className={role === 'COMMITTEE' ? 'danger' : 'ghost'} disabled={busy} onClick={() => { void cancel(i) }}>
                    {role === 'COMMITTEE' ? '否决这条' : '撤销这条'}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {note && <p role="status">{note}</p>}
      {closed.length > 0 && (
        <details>
          <summary>已结束的（最近 {closed.length} 条）</summary>
          <ul className="help">
            {closed.map(i => (
              <li key={i.id}>{what(i)}：{CLOSED_TEXT[i.status]}{i.closedWhy ? `，${i.closedWhy}` : ''}{i.closedAt ? `（${i.closedAt.slice(5, 16)}）` : ''}</li>
            ))}
          </ul>
        </details>
      )}
      {role === 'AGENT' && (
        <RegisterForm
          onError={onError}
          onAttempt={() => setNote('')}
          onDone={i => {
            setNote(`已登记：${what(i)}`)
            fetchOrders().then(setBook).catch(report)
            onChanged()
          }}
        />
      )}
    </section>
  )
}

const BASE_AT = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/
/** 写法对，而且是一个真实的、不晚于现在的时刻（北京时间） */
function validBaseAt(at: string): boolean {
  const m = BASE_AT.exec(at)
  if (!m) return false
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]) - 8, Number(m[5]))
  // 2 月 30 日、25 点这类写法换算回来对不上
  return new Date(t + 8 * 3600_000).toISOString().slice(0, 16).replace('T', ' ') === at && t <= Date.now()
}

export function NavBase({ status, onSaved, onError }: { status: ChainStatus | null; onSaved: () => void; onError: OnError }) {
  const [amount, setAmount] = useState('')
  const [at, setAt] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  /** 刚保存的基准时点。服务器那边的状态要过一两秒才读回来，先按这个显示 */
  const [saved, setSaved] = useState<string | null>(null)
  const { problem, report, clear } = useProblem(onError)
  const value = Number(amount.replace(/[,，\s]/g, ''))
  const ready = amount.trim() !== '' && Number.isFinite(value) && value > 0 && validBaseAt(at.trim())
  const baseAt = saved ?? status?.base?.at ?? null

  async function save() {
    if (value < 10_000 && !window.confirm('单位是元，不是万元。填的数不到一万元，确定没有填错？')) return
    if (baseAt && !window.confirm('重新设置后，净值指数从 100 重新起算，之前记下的最高值清零。确定重新设置？')) return
    setBusy(true)
    try {
      await saveBase(value, at.trim())
      setAmount('')
      setSaved(at.trim())
      setNote(`已保存。基准时点 ${at.trim()} 记为 100。`)
      setAt('')
      clear()
      onSaved()
    } catch (e) { setNote(''); report(e) } finally { setBusy(false) }
  }

  return (
    <>
      <h3>净值基准</h3>
      <p className="muted">
        {baseAt ? `已设置：基准时点 ${baseAt}。` : '还没有设置。没有基准，净值指数和三条线算不出。'}
        填基准时点那一刻的总资产，这一刻记为 100。金额只存在服务器上，页面和汇总里都不显示，只显示指数。
      </p>
      <form className="setting" onSubmit={e => { e.preventDefault(); if (ready) void save() }}>
        <label htmlFor="base-amount">基准时点的总资产（元，含现金）</label>
        <input id="base-amount" type="text" inputMode="decimal" autoComplete="off" value={amount} placeholder="只填数字，单位是元" onChange={e => setAmount(e.target.value)} />
        <label htmlFor="base-at">基准时点</label>
        <input id="base-at" type="text" autoComplete="off" value={at} placeholder="写成 2026-11-24 09:37 这样" onChange={e => setAt(e.target.value)} />
        <div className="actions">
          <button type="submit" disabled={busy || !ready}>{busy ? '保存中' : baseAt ? '重新设置' : '保存'}</button>
        </div>
      </form>
      {problem && <p className="error" role="alert">{problem}</p>}
      {note && <p role="status">{note}</p>}
    </>
  )
}
