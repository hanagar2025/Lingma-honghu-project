import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ApiError, clearToken, fetchImage, fetchState, getToken, readAsDataUrl, setToken, settle, submit,
  type State, type Status, type Submission,
} from './api'

const STATUS_TEXT: Record<Status, string> = {
  RECORDED: '已记录',
  PENDING_PARSE: '等待识别',
  PENDING_CONFIRM: '等您确认',
  NEEDS_FIX: '没有生效',
  CONFIRMED: '已确认',
  REJECTED: '已撤销',
}

const KIND_TEXT = { HOLDINGS: '持仓', TRADE: '成交', INTENT: '下单前登记', NOTE: '留言' } as const

const MAX_IMAGE_BYTES = 8 * 1024 * 1024

function Login({ onDone }: { onDone: () => void }) {
  const [value, setValue] = useState('')
  return (
    <main className="login">
      <h1>鸿鹄</h1>
      <form onSubmit={e => { e.preventDefault(); if (value.trim()) { setToken(value.trim()); onDone() } }}>
        <label htmlFor="token">口令</label>
        <input id="token" type="password" autoComplete="current-password" value={value} onChange={e => setValue(e.target.value)} />
        <button type="submit" disabled={!value.trim()}>进入</button>
      </form>
    </main>
  )
}

function Shot({ id }: { id: string }) {
  const [url, setUrl] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!open || url) return
    let alive = true
    fetchImage(id).then(u => { if (alive) setUrl(u) }).catch(() => undefined)
    return () => { alive = false }
  }, [id, open, url])
  if (!open) return <button type="button" className="link" onClick={() => setOpen(true)}>查看原图</button>
  return url ? <img className="shot" src={url} alt="提交的截图" /> : <p className="muted">读取中</p>
}

function Item({ s, busy, onSettle }: { s: Submission; busy: boolean; onSettle: (id: string, a: 'confirm' | 'reject') => void }) {
  const kind = s.parsed ? KIND_TEXT[s.parsed.kind] : s.source === 'IMAGE' ? '截图' : '文字'
  const effective = s.status === 'RECORDED' || s.status === 'CONFIRMED'
  const undoable = effective && (s.parsed?.kind === 'TRADE' || s.parsed?.kind === 'INTENT')
  return (
    <li className={`item ${s.status.toLowerCase()}`}>
      <div className="item-head">
        <span className="tag">{STATUS_TEXT[s.status]}</span>
        <span>{kind}</span>
        <time>{s.receivedAt.slice(5, 16)}</time>
      </div>
      {s.text && <p className="quote">{s.text}</p>}
      {s.summary && <p>{s.summary}</p>}
      {s.verdict && <p className="verdict">{s.verdict}</p>}
      {s.checks && s.status !== 'RECORDED' && (
        <ul className="checks">
          {s.checks.map(c => (
            <li key={c.name}>{c.ok === true ? '✓' : c.ok === false ? '✗' : '—'} {c.name}：{c.detail}</li>
          ))}
        </ul>
      )}
      {s.source === 'IMAGE' && <Shot id={s.id} />}
      {s.status === 'PENDING_CONFIRM' && (
        <div className="actions">
          <button type="button" disabled={busy} onClick={() => onSettle(s.id, 'confirm')}>内容无误，确认</button>
          <button type="button" className="ghost" disabled={busy} onClick={() => onSettle(s.id, 'reject')}>不对，作废</button>
        </div>
      )}
      {undoable && (
        <button type="button" className="link" disabled={busy} onClick={() => onSettle(s.id, 'reject')}>撤销这条</button>
      )}
    </li>
  )
}

export default function App() {
  const [authed, setAuthed] = useState(Boolean(getToken()))
  const [state, setState] = useState<State | null>(null)
  const [error, setError] = useState('')
  const [text, setText] = useState('')
  const [image, setImage] = useState<{ name: string; dataUrl: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [reply, setReply] = useState<Submission | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const fail = useCallback((e: unknown) => {
    if (e instanceof ApiError && e.status === 401) {
      clearToken()
      setAuthed(false)
      setError('口令不对，请重新输入')
      return
    }
    setError(e instanceof Error ? e.message : '出错了')
  }, [])

  const load = useCallback(() => {
    fetchState().then(s => { setState(s); setError('') }).catch(fail)
  }, [fail])

  useEffect(() => {
    if (!authed) return
    load()
    const timer = window.setInterval(load, 60_000)
    return () => window.clearInterval(timer)
  }, [authed, load])

  if (!authed) {
    return (
      <>
        {error && <p className="error" role="alert">{error}</p>}
        <Login onDone={() => { setError(''); setAuthed(true) }} />
      </>
    )
  }

  async function pick(file: File | undefined) {
    if (!file) return
    if (file.size > MAX_IMAGE_BYTES) {
      setError('图片太大，请控制在 8MB 以内')
      return
    }
    setImage({ name: file.name, dataUrl: await readAsDataUrl(file) })
    setError('')
  }

  async function send() {
    if (busy || (!text.trim() && !image)) return
    setBusy(true)
    try {
      const { submission } = await submit(text.trim(), image?.dataUrl)
      setReply(submission)
      setText('')
      setImage(null)
      if (fileRef.current) fileRef.current.value = ''
      setError('')
      load()
    } catch (e) {
      fail(e)
    } finally {
      setBusy(false)
    }
  }

  async function onSettle(id: string, action: 'confirm' | 'reject') {
    setBusy(true)
    try {
      await settle(id, action)
      setReply(null)
      load()
    } catch (e) {
      fail(e)
    } finally {
      setBusy(false)
    }
  }

  const pending = state?.submissions.filter(s => s.status === 'PENDING_CONFIRM') ?? []
  const rest = state?.submissions.filter(s => s.status !== 'PENDING_CONFIRM') ?? []

  return (
    <main>
      <header>
        <h1>鸿鹄</h1>
        <p className="muted">账本日期：{state ? state.ledgerAsOf ?? '还没有账本' : '读取中'}</p>
      </header>

      {error && <p className="error" role="alert">{error}</p>}

      <section className="panel">
        <h2>交给战略侧</h2>
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          rows={4}
          placeholder={'计划卖出 中际旭创 600股 单票归位\n卖出 中际旭创 600股 509.89\n或者直接发持仓截图、成交截图'}
        />
        {image && (
          <p className="attached">
            已选图片：{image.name}
            <button type="button" className="link" onClick={() => { setImage(null); if (fileRef.current) fileRef.current.value = '' }}>移除</button>
          </p>
        )}
        <div className="actions">
          <label className="ghost file">
            选择图片
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" onChange={e => { void pick(e.target.files?.[0]) }} />
          </label>
          <button type="button" disabled={busy || (!text.trim() && !image)} onClick={() => { void send() }}>
            {busy ? '发送中' : '发送'}
          </button>
        </div>
        {reply && (
          <div className={`reply ${reply.status.toLowerCase()}`} role="status">
            <strong>{STATUS_TEXT[reply.status]}</strong>
            {reply.summary && <p>{reply.summary}</p>}
            {reply.verdict && <p className="verdict">{reply.verdict}</p>}
          </div>
        )}
        <details>
          <summary>怎么写</summary>
          <ul className="help">
            <li>下单前：以「计划」开头，例如「计划卖出 中际旭创 600股」。按服务器收到的时刻登记。</li>
            <li>成交后：例如「卖出 中际旭创 600股 509.89」，一行一笔。或者发成交截图。</li>
            <li>每天收盘后：发一张持仓截图。识别结果出来后回到这里确认，确认后账本才更新。</li>
            <li>名单和账本里都没有的股票，名称后面带上 6 位代码，例如「计划买入 某某股份 600000 100股」。</li>
            <li>其他的话直接写，会原样转给战略侧。</li>
          </ul>
        </details>
      </section>

      {pending.length > 0 && (
        <section className="panel">
          <h2>等您确认（{pending.length}）</h2>
          <ul className="items">{pending.map(s => <Item key={s.id} s={s} busy={busy} onSettle={onSettle} />)}</ul>
        </section>
      )}

      <section className={`panel card ${state ? (state.card.ok ? 'good' : 'stop') : ''}`}>
        <h2>账户与纪律</h2>
        {state
          ? (
            <>
              {/* 执行单由服务器把 Markdown 转成 HTML，正文已转义 */}
              <div className="md" dangerouslySetInnerHTML={{ __html: state.card.html }} />
              <p className="muted">生成于 {state.card.generatedAt}（北京时间）</p>
            </>
          )
          : <p className="muted">读取中</p>}
      </section>

      <section className="panel">
        <h2>机会闸门</h2>
        <p className="muted">尚未上线。上线前，六项前提的状态由战略侧每天收盘后在对话里报告。</p>
      </section>

      <section className="panel">
        <h2>记分牌</h2>
        <p className="muted">尚未上线。需要连续的持仓与成交记录，从您开始每天提交起算。</p>
      </section>

      <section className="panel">
        <h2>最近提交</h2>
        {rest.length
          ? <ul className="items">{rest.map(s => <Item key={s.id} s={s} busy={busy} onSettle={onSettle} />)}</ul>
          : <p className="muted">还没有提交。</p>}
      </section>

      <footer>
        <button type="button" className="link" onClick={() => { clearToken(); setState(null); setAuthed(false) }}>退出</button>
      </footer>
    </main>
  )
}
