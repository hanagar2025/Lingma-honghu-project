import { useCallback, useEffect, useRef, useState } from 'react'
import qrcode from 'qrcode-generator'
import {
  ApiError, changePassword, clearToken, fetchAuth, fetchBrief, fetchImage, fetchSettings, fetchState, getToken, renewLink,
  saveSetting, setToken, settle, submit, takeLinkKey, testPush, toUploadable,
  type AuthInfo, type Brief, type SettingsView, type State, type Status, type Submission,
} from './api'

takeLinkKey()

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
const PASSWORD_MIN = 6
const charCount = (s: string): number => Array.from(s).length

function Login({ onDone }: { onDone: () => void }) {
  const [value, setValue] = useState('')
  return (
    <main className="login">
      <h1>鸿鹄</h1>
      <form onSubmit={e => { e.preventDefault(); if (value.trim()) { setToken(value.trim()); onDone() } }}>
        <label htmlFor="token">口令（好记的口令或安装口令）</label>
        <input id="token" type="password" autoComplete="current-password" value={value} onChange={e => setValue(e.target.value)} />
        <button type="submit" disabled={!value.trim()}>进入</button>
      </form>
      <p className="muted">手机上也可以扫电脑页面里「登录设置」的二维码，扫一次就登录。</p>
    </main>
  )
}

function Qr({ text }: { text: string }) {
  const qr = qrcode(0, 'M')
  qr.addData(text)
  qr.make()
  return <img className="qr" src={qr.createDataURL(6, 2)} alt="登录二维码" />
}

const SETTING_TEXT: Record<string, { label: string; hint: string }> = {
  PUSHPLUS_TOKEN: { label: 'PushPlus（微信）', hint: '在 pushplus.plus 用微信扫码登录后，复制「一对一推送」里的 token' },
  BARK_URL: { label: 'Bark（iPhone）', hint: '在 iPhone 上装 Bark，复制它给的地址，形如 https://api.day.app/一串字符' },
  WECOM_WEBHOOK: { label: '企业微信群机器人', hint: '群设置里添加机器人后给出的 Webhook 地址' },
  SERVERCHAN_SENDKEY: { label: 'Server 酱（微信）', hint: 'sct.ftqq.com 登录后的 SendKey' },
  VISION_API_KEY: { label: '识别服务密钥', hint: '阿里云百炼控制台里创建的 API Key。填了之后截图上传即自动识别' },
  VISION_API_URL: { label: '识别服务地址', hint: '一般不用改' },
  VISION_MODEL: { label: '识别模型', hint: '一般不用改' },
}

function SettingRow({ item, onSaved, onError }: {
  item: SettingsView['items'][number]; onSaved: (v: SettingsView) => void; onError: (e: unknown) => void
}) {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const text = SETTING_TEXT[item.key] ?? { label: item.key, hint: '' }
  const secret = item.value === undefined
  async function save(v: string) {
    setBusy(true)
    try {
      onSaved(await saveSetting(item.key, v))
      setValue('')
    } catch (e) { onError(e) } finally { setBusy(false) }
  }
  return (
    <form className="setting" onSubmit={e => { e.preventDefault(); if (value.trim()) void save(value) }}>
      <label htmlFor={`set-${item.key}`}>
        {text.label}：{secret ? (item.set ? '已填' : '未填') : item.value}
      </label>
      <input
        id={`set-${item.key}`} type={secret ? 'password' : 'text'} autoComplete="off" value={value}
        placeholder={text.hint} onChange={e => setValue(e.target.value)}
      />
      <div className="actions">
        {item.set && secret && <button type="button" className="ghost" disabled={busy} onClick={() => { void save('') }}>清除</button>}
        <button type="submit" disabled={busy || !value.trim()}>保存</button>
      </div>
    </form>
  )
}

function Delivery({ onError }: { onError: (e: unknown) => void }) {
  const [view, setView] = useState<SettingsView | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { fetchSettings().then(setView).catch(onError) }, [onError])
  if (!view) return <p className="muted">读取中</p>

  async function test() {
    setBusy(true)
    try {
      const { results } = await testPush()
      setNote(results.map(r => `${r.channel}：${r.ok ? '已发出，请看手机' : '失败，请检查填的内容'}`).join('；'))
    } catch (e) { onError(e) } finally { setBusy(false) }
  }

  const push = view.items.filter(i => !i.key.startsWith('VISION_'))
  const vision = view.items.filter(i => i.key.startsWith('VISION_'))
  return (
    <>
      <h3>定时推送</h3>
      <p className="muted">
        每个交易日 {view.slots.map(s => `${s.at} ${s.label}${s.always ? '' : '（有卖出指令才发）'}`).join('、')}；确认新持仓后立即再发一次。
        填任意一个通道即可。{view.pushConfigured ? '' : '现在一个都没填，所以不会推送，只能打开页面看。'}
      </p>
      {push.map(i => <SettingRow key={i.key} item={i} onSaved={setView} onError={onError} />)}
      <div className="actions">
        <button type="button" className="ghost" disabled={busy || !view.pushConfigured} onClick={() => { void test() }}>发一条测试</button>
      </div>
      {note && <p role="status">{note}</p>}
      {view.lastPush && (
        <p className="muted">
          上一次推送：{view.lastPush.at.slice(5, 16)}（{view.lastPush.what}）
          {view.lastPush.results.map(r => `${r.channel}${r.ok ? '成功' : '失败'}`).join('、')}
        </p>
      )}

      <h3>截图自动识别</h3>
      <p className="muted">
        {view.visionConfigured
          ? '已开启。上传截图后自动识别，一般不超过一分钟，结果出来后仍要您确认才生效。'
          : '未开启。现在上传的截图要等战略侧人工识别。填了密钥后，截图会发给识别服务读取数字。'}
      </p>
      {vision.map(i => <SettingRow key={i.key} item={i} onSaved={setView} onError={onError} />)}
    </>
  )
}

const SECTION_ORDER = ['todo', 'risk', 'gate', 'goal', 'score', 'forecast']
const SECTION_OPEN = new Set(['todo', 'risk', 'goal'])

function BriefPanels({ brief }: { brief: Brief | null }) {
  if (!brief) return <section className="panel"><h2>风险与机会</h2><p className="muted">正在取行情和融资数据，约十几秒</p></section>
  const sections = [...brief.sections].sort((a, b) => SECTION_ORDER.indexOf(a.id) - SECTION_ORDER.indexOf(b.id))
  return (
    <>
      {sections.map(s => (
        <section key={s.id} className={`panel ${s.id === 'gate' ? (brief.gateOpen ? 'card good' : 'card stop') : ''}`}>
          <details open={SECTION_OPEN.has(s.id)} className="fold">
            <summary><h2>{s.title}{s.id === 'gate' ? (brief.gateOpen ? '：可以登记' : '：关闭，不买') : ''}</h2></summary>
            {s.id === 'risk' && brief.changes.length > 0 && (
              <ul className="changes">{brief.changes.map(c => <li key={c}>{c}</li>)}</ul>
            )}
            {/* 简报由服务器把 Markdown 转成 HTML，正文已转义 */}
            <div className="md" dangerouslySetInnerHTML={{ __html: s.html }} />
          </details>
        </section>
      ))}
      <p className="muted">行情截至 {brief.asOf ?? '取不到'} 收盘；取数于 {brief.generatedAt}（北京时间）。盘中只用已收盘的交易日判定。</p>
    </>
  )
}

function Settings({ onError }: { onError: (e: unknown) => void }) {
  const [info, setInfo] = useState<AuthInfo | null>(null)
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [showQr, setShowQr] = useState(false)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => { fetchAuth().then(setInfo).catch(onError) }, [onError])

  const n = charCount(pw)
  const problem = pw !== pw.trim() ? '首尾不能是空格'
    : n < PASSWORD_MIN ? `至少 ${PASSWORD_MIN} 个字，现在 ${n} 个`
    : /^(\d)\1+$|^(123456|1234567|12345678|654321|abcdef|qwerty)$/i.test(pw) ? '太容易猜，换一句'
    : pw2 && pw2 !== pw ? '两次不一样' : ''

  async function savePw() {
    setBusy(true)
    try {
      const r = await changePassword(pw)
      setInfo(i => i && { ...i, hasPassword: true, passwordSetAt: r.passwordSetAt })
      setPw('')
      setPw2('')
      setNote('口令已改好。以后在任何设备上都可以用它登录，旧口令立即失效。')
    } catch (e) { onError(e) } finally { setBusy(false) }
  }

  async function renew() {
    if (!info || !window.confirm('作废后，之前扫过码的手机都要重新扫一次。确定作废？')) return
    setBusy(true)
    try {
      const { link } = await renewLink()
      if (getToken() === info.link.split('#k=')[1]) setToken(link.split('#k=')[1])
      setInfo({ ...info, link })
      setShowQr(true)
      setNote('旧链接已作废，下面是新的二维码。')
    } catch (e) { onError(e) } finally { setBusy(false) }
  }

  if (!info) return <p className="muted">读取中</p>
  return (
    <>
      <h3>好记的口令</h3>
      <p className="muted">{info.hasPassword ? `已设置（${info.passwordSetAt}）。可以随时改。` : '还没有设置。设好后就不用再输那串长口令了。'}</p>
      <form className="pw" onSubmit={e => { e.preventDefault(); if (!problem && pw2 === pw) void savePw() }}>
        <input type="password" autoComplete="new-password" placeholder="新口令：至少 6 个字，汉字也可以" value={pw} onChange={e => setPw(e.target.value)} />
        <input type="password" autoComplete="new-password" placeholder="再输一次" value={pw2} onChange={e => setPw2(e.target.value)} />
        {pw && problem && <p className="muted">{problem}</p>}
        <button type="submit" disabled={busy || !pw || Boolean(problem) || pw2 !== pw}>保存口令</button>
      </form>

      <h3>手机扫码登录</h3>
      <p className="muted">用手机相机扫一下就登录，之后手机上一直保持登录，直到点「退出」。</p>
      {showQr
        ? (
          <>
            <Qr text={info.link} />
            <p className="warn">这个二维码等同于钥匙：不要截图转发，用完点「收起」。手机丢了就点「作废旧链接」。</p>
            <div className="actions">
              <button type="button" className="ghost" onClick={() => setShowQr(false)}>收起</button>
              <button type="button" className="ghost" disabled={busy} onClick={() => { void renew() }}>作废旧链接</button>
            </div>
          </>
        )
        : <button type="button" onClick={() => setShowQr(true)}>显示二维码</button>}
      {note && <p role="status">{note}</p>}
    </>
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
  const [brief, setBrief] = useState<Brief | null>(null)
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

  // 页面已经开着时扫码，浏览器只改 # 后面、不重新加载，要在这里收下
  useEffect(() => {
    const onHash = () => {
      if (!takeLinkKey()) return
      setError('')
      setAuthed(true)
      load()
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [load])

  useEffect(() => {
    if (!authed) return
    load()
    const timer = window.setInterval(load, 60_000)
    return () => window.clearInterval(timer)
  }, [authed, load])

  // 简报跟着账本走：账本日期一变就重取，另外每 5 分钟取一次
  const ledgerAsOf = state?.ledgerAsOf
  const cardTitle = state?.card.title
  useEffect(() => {
    if (!authed || !cardTitle) return
    const get = () => { fetchBrief().then(setBrief).catch(() => undefined) }
    get()
    const timer = window.setInterval(get, 300_000)
    return () => window.clearInterval(timer)
  }, [authed, ledgerAsOf, cardTitle])

  // 有图片正在识别时，每 5 秒看一次结果
  const parsing = state?.submissions.some(s => s.status === 'PENDING_PARSE' && Date.now() - Date.parse(`${s.receivedAt.replace(' ', 'T')}+08:00`) < 180_000)
  useEffect(() => {
    if (!authed || !parsing) return
    const timer = window.setInterval(load, 5000)
    return () => window.clearInterval(timer)
  }, [authed, parsing, load])

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
    try {
      const dataUrl = await toUploadable(file)
      if (dataUrl.length > MAX_IMAGE_BYTES * 1.37) {
        setError('图片太大，请控制在 8MB 以内')
        return
      }
      setImage({ name: file.name || '粘贴的图片', dataUrl })
      setError('')
    } catch (e) {
      setError(e instanceof Error ? e.message : '图片读不出')
    }
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
          onPaste={e => {
            const file = [...e.clipboardData.files].find(f => f.type.startsWith('image/'))
            if (file) { e.preventDefault(); void pick(file) }
          }}
          onDragOver={e => e.preventDefault()}
          onDrop={e => {
            const file = e.dataTransfer.files[0]
            if (file) { e.preventDefault(); void pick(file) }
          }}
          rows={4}
          placeholder={'计划卖出 中际旭创 600股 单票归位\n卖出 中际旭创 600股 509.89\n持仓截图、成交截图：点「选择图片」，或直接粘贴、拖进来'}
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
            <input ref={fileRef} type="file" accept="image/*" onChange={e => { void pick(e.target.files?.[0]) }} />
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
        <h2>今天要做的</h2>
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

      <BriefPanels brief={brief} />

      <section className="panel">
        <h2>最近提交</h2>
        {rest.length
          ? <ul className="items">{rest.map(s => <Item key={s.id} s={s} busy={busy} onSettle={onSettle} />)}</ul>
          : <p className="muted">还没有提交。</p>}
      </section>

      <section className="panel">
        <details>
          <summary>设置：推送、截图识别、登录</summary>
          <Delivery onError={fail} />
          <Settings onError={fail} />
        </details>
      </section>

      <footer>
        <button type="button" className="link" onClick={() => { clearToken(); setState(null); setAuthed(false) }}>退出</button>
      </footer>
    </main>
  )
}
