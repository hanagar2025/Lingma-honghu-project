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

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: { Authorization: `Bearer ${getToken()}`, ...(init?.body ? { 'Content-Type': 'application/json' } : {}) },
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

export async function fetchImage(id: string): Promise<string> {
  const res = await fetch(`/api/intake/${id}/image`, { headers: { Authorization: `Bearer ${getToken()}` } })
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
