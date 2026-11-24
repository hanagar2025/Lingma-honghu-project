export interface Check {
  name: string
  ok: boolean | null
  detail: string
}

export type Status = 'RECORDED' | 'PENDING_PARSE' | 'PENDING_CONFIRM' | 'NEEDS_FIX' | 'CONFIRMED' | 'REJECTED'

export interface Submission {
  id: string
  receivedAt: string
  source: 'TEXT' | 'IMAGE'
  text?: string
  imageFile?: string
  status: Status
  parsed?: { kind: 'HOLDINGS' | 'TRADE' | 'INTENT' | 'NOTE' }
  checks?: Check[]
  summary?: string
  verdict?: string
}

export interface State {
  card: { ok: boolean; title: string; generatedAt: string; html: string }
  ledgerAsOf: string | null
  submissions: Submission[]
}

export class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
  }
}

const TOKEN_KEY = 'honghu.token'
export const getToken = (): string => localStorage.getItem(TOKEN_KEY) ?? ''
export const setToken = (t: string): void => localStorage.setItem(TOKEN_KEY, t)
export const clearToken = (): void => localStorage.removeItem(TOKEN_KEY)

/** 扫码打开的登录链接形如 https://域名/#k=长码：收下长码，再把它从地址栏抹掉 */
export function takeLinkKey(): boolean {
  const m = /^#k=([\w-]{16,})$/.exec(location.hash)
  if (!m) return false
  setToken(m[1])
  history.replaceState(null, '', location.pathname + location.search)
  return true
}

// 请求头只能放 ASCII，汉字口令要先编码，服务器再解开
const bearer = (): string => `Bearer ${encodeURIComponent(getToken())}`

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { Authorization: bearer(), ...(init?.body ? { 'Content-Type': 'application/json' } : {}) },
  })
  const body = (await res.json().catch(() => ({}))) as { error?: string }
  if (!res.ok) throw new ApiError(res.status, body.error ?? `请求失败（${res.status}）`)
  return body as T
}

export const fetchState = (): Promise<State> => call<State>('/api/state')

export const submit = (text: string, image?: string): Promise<{ submission: Submission }> =>
  call('/api/intake', { method: 'POST', body: JSON.stringify(image ? { text, image } : { text }) })

export const settle = (id: string, action: 'confirm' | 'reject'): Promise<{ submission: Submission }> =>
  call(`/api/intake/${id}/${action}`, { method: 'POST' })

export interface AuthInfo {
  hasPassword: boolean
  passwordSetAt: string | null
  link: string
}

export const fetchAuth = (): Promise<AuthInfo> => call<AuthInfo>('/api/auth')

export const changePassword = (password: string): Promise<{ passwordSetAt: string }> =>
  call('/api/auth/password', { method: 'POST', body: JSON.stringify({ password }) })

export const renewLink = (): Promise<{ link: string }> => call('/api/auth/link', { method: 'POST' })

export async function fetchImage(id: string): Promise<string> {
  const res = await fetch(`/api/intake/${id}/image`, { headers: { Authorization: bearer() } })
  if (!res.ok) throw new ApiError(res.status, '图片读不出')
  return URL.createObjectURL(await res.blob())
}

export function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('图片读不出'))
    reader.readAsDataURL(file)
  })
}

/** 浏览器自己认得的图片（例如 Safari 里的 HEIC）转成 JPEG 再上传；认不得就说明怎么办 */
export async function toUploadable(file: File): Promise<string> {
  if (/^image\/(png|jpeg|webp)$/.test(file.type)) return readAsDataUrl(file)
  try {
    const bitmap = await createImageBitmap(file)
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0)
    return canvas.toDataURL('image/jpeg', 0.92)
  } catch {
    throw new Error('这种图片这个浏览器打不开（多半是 HEIC）。请在手机上截屏后直接用手机打开本页上传，或在 Mac 的「预览」里导出为 JPEG')
  }
}

export interface BriefSection { id: string; title: string; html: string }

export interface Brief {
  asOf: string | null
  generatedAt: string
  changes: string[]
  sections: BriefSection[]
}

export const fetchBrief = (): Promise<Brief> => call<Brief>('/api/brief')

export interface SettingsView {
  items: { key: string; set: boolean; value?: string }[]
  pushConfigured: boolean
  visionConfigured: boolean
  slots: { at: string; label: string; always: boolean }[]
  lastPush: { at: string; what: string; results: { channel: string; ok: boolean }[] } | null
}

export const fetchSettings = (): Promise<SettingsView> => call<SettingsView>('/api/settings')

export const saveSetting = (key: string, value: string): Promise<SettingsView> =>
  call('/api/settings', { method: 'POST', body: JSON.stringify({ key, value }) })

export const testPush = (): Promise<{ results: { channel: string; ok: boolean }[] }> =>
  call('/api/settings/test-push', { method: 'POST' })

export type Role = 'COMMITTEE' | 'AGENT'

export const fetchMe = (): Promise<{ role: Role }> => call('/api/me')

export interface DigestSlot { id: string; at: string; label: string; weekday?: number }

export interface DigestHead {
  date: string
  slot: string
  title: string
  generatedAt: string
  asOf: string | null
  decided: boolean
  vetoed: boolean
}

export interface DigestDoc {
  date: string
  slot: string
  title: string
  generatedAt: string
  asOf: string | null
  by: 'BOT' | 'AGENT'
  revision: number
  decision: { at: string; text: string } | null
  veto: { at: string; note: string } | null
  html: string
}

export const fetchDigests = (days = 5): Promise<{ slots: DigestSlot[]; digests: DigestHead[] }> => call(`/api/digest?days=${days}`)

export const fetchDigest = (date: string, slot: string): Promise<DigestDoc> => call(`/api/digest/${date}/${slot}?html=1`)

/** 策略方写决定，或委员会否决 */
export const annotateDigest = (date: string, slot: string, kind: 'decision' | 'veto', text: string): Promise<unknown> =>
  call(`/api/digest/${date}/${slot}/${kind}`, { method: 'POST', body: JSON.stringify(kind === 'decision' ? { text } : { note: text }) })

export interface Instruction {
  id: string
  code: string
  name: string
  side: 'SELL' | 'BUY'
  origin: 'RULE_ZERO' | 'RULE_TREND' | 'RULE_HALVE' | 'WATCH' | 'STRATEGY'
  reason: string
  source: string
  triggerDate: string
  portion?: string
  targetWeight?: number
  status: 'OPEN' | 'DONE' | 'EXPIRED' | 'CANCELLED'
  closedAt?: string
  closedWhy?: string
}

export interface OrderBook {
  instructions: Instruction[]
  backup: { since: string; why: string } | null
  updatedAt: string
}

export const fetchOrders = (): Promise<OrderBook> => call('/api/orders')

export const cancelOrder = (id: string): Promise<OrderBook> => call(`/api/orders/${encodeURIComponent(id)}`, { method: 'DELETE' })

export interface NewOrder {
  code: string
  name?: string
  side: 'SELL' | 'BUY'
  sell?: 'ALL' | 'HALF' | 'THIRD'
  targetWeight?: number
  reason: string
  source: string
}

export const registerOrder = (order: NewOrder): Promise<{ instruction: Instruction }> =>
  call('/api/orders', { method: 'POST', body: JSON.stringify(order) })

export interface ChainStatus {
  generatedAt: string
  lastClosed: string | null
  marginAsOf: string | null
  stocks: { expected: number; have: number; minBars: number | null }
  scripts: { mainline: string | null; scan: string | null }
  base: { at: string; setAt: string } | null
  gaps: string[]
  lastRuns: { task: string; at: string; asOf: string | null; ok: number; failed: number }[]
  today: string
  weekday: number
  time: string
  trading: boolean | null
  scriptError: string | null
}

export const fetchChainStatus = (): Promise<ChainStatus> => call('/api/chain/status')

/** 金额只发给服务器，服务器不回显 */
export const saveBase = (totalAssets: number, at: string): Promise<{ ok: boolean }> =>
  call('/api/chain/base', { method: 'PUT', body: JSON.stringify({ totalAssets, at }) })
