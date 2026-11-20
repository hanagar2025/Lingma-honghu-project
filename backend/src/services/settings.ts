/**
 * 委员会在页面上填的两类设置：推送通道、截图识别服务。
 * 存在私有目录的 settings.json 里，页面只能看到"填了没有"，读不回密钥。
 * 环境变量里同名的值作为缺省。
 */
import type { Store } from './intake/store'

export const PUSH_KEYS = ['PUSHPLUS_TOKEN', 'WECOM_WEBHOOK', 'SERVERCHAN_SENDKEY', 'BARK_URL'] as const
export type PushKey = typeof PUSH_KEYS[number]
export const VISION_KEYS = ['VISION_API_URL', 'VISION_MODEL', 'VISION_API_KEY'] as const
export type SettingKey = PushKey | typeof VISION_KEYS[number]

/** 阿里云百炼的通用接口。服务器在阿里云内地机房，连得上 */
export const VISION_DEFAULT_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1'
export const VISION_DEFAULT_MODEL = 'qwen-vl-max'

type Saved = Partial<Record<SettingKey, string>>
const SECRET: readonly SettingKey[] = ['PUSHPLUS_TOKEN', 'WECOM_WEBHOOK', 'SERVERCHAN_SENDKEY', 'BARK_URL', 'VISION_API_KEY']
const URL_KEYS: readonly SettingKey[] = ['WECOM_WEBHOOK', 'BARK_URL', 'VISION_API_URL']

/** 只允许公网 https 地址：这些地址由服务器去请求，不能指向本机或内网 */
export function publicHttps(value: string): boolean {
  let u: URL
  try { u = new URL(value) } catch { return false }
  if (u.protocol !== 'https:' || u.username || u.password) return false
  const h = u.hostname.toLowerCase()
  if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') || !h.includes('.')) return false
  return !/^(\d+\.){3}\d+$/.test(h) && !h.includes(':')
}

export class Settings {
  constructor(private readonly store: Store, private readonly env: Record<string, string | undefined> = process.env) {}

  private saved(): Saved {
    return this.store.readDoc<Saved>('settings') ?? {}
  }

  get(key: SettingKey): string {
    return this.saved()[key]?.trim() || this.env[key]?.trim() || ''
  }

  /** 空值 = 清除。返回错误原因，成功为 null */
  set(key: string, value: string): string | null {
    if (!([...PUSH_KEYS, ...VISION_KEYS] as string[]).includes(key)) return '没有这一项设置'
    const k = key as SettingKey
    const v = value.trim()
    if (v.length > 500 || /[\r\n]/.test(v)) return '内容太长或含有换行'
    if (v && URL_KEYS.includes(k) && !publicHttps(v)) return '地址必须以 https:// 开头，并且是公网域名'
    const next = { ...this.saved() }
    if (v) next[k] = v
    else delete next[k]
    this.store.writeDoc('settings', next)
    return null
  }

  /** 给 notify.pushAll 用的环境 */
  pushEnv(): Record<string, string | undefined> {
    return Object.fromEntries(PUSH_KEYS.map(k => [k, this.get(k) || undefined]))
  }

  get pushConfigured(): boolean {
    return PUSH_KEYS.some(k => this.get(k))
  }

  vision(): { url: string; model: string; key: string } | null {
    const key = this.get('VISION_API_KEY')
    if (!key) return null
    return { url: (this.get('VISION_API_URL') || VISION_DEFAULT_URL).replace(/\/+$/, ''), model: this.get('VISION_MODEL') || VISION_DEFAULT_MODEL, key }
  }

  /** 页面可见的部分：密钥只说填了没有 */
  view(): { key: SettingKey; set: boolean; value?: string }[] {
    return ([...PUSH_KEYS, ...VISION_KEYS] as SettingKey[]).map(k => {
      const v = this.get(k)
      if (SECRET.includes(k)) return { key: k, set: Boolean(v) }
      return { key: k, set: Boolean(v), value: v || (k === 'VISION_API_URL' ? VISION_DEFAULT_URL : VISION_DEFAULT_MODEL) }
    })
  }
}
