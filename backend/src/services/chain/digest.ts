/**
 * 定时汇总的收件与留存。
 *
 * 汇总由 bot 在固定时点算好推来：读数、排序、触发条件是否成立、规则原文写的动作。
 * 这里不改它的内容，只做三件事：收下并留存；策略方写决定；委员会否决。
 * 全系统没有下单接口，汇总和决定都只是文字。
 */
import { beijingStamp } from '../intake/store'
import type { ChainStore } from './store'

export interface DigestSlot { id: string; at: string; label: string; weekday?: number }

/** bot 的五个时点（北京时间，交易日）。weekday：只在星期几出（5 = 周五） */
export const DIGEST_SLOTS: readonly DigestSlot[] = [
  { id: 'pre', at: '08:40', label: '盘前' },
  { id: 'midday', at: '11:40', label: '午间' },
  { id: 'close', at: '16:20', label: '收盘' },
  { id: 'scan', at: '16:40', label: '全市场扫描' },
  { id: 'weekly', at: '16:50', label: '周度', weekday: 5 },
]

export interface DigestDoc {
  date: string
  slot: string
  title: string
  /** bot 算完的时刻，北京时间 */
  generatedAt: string
  /** 读数截至的交易日 */
  asOf: string | null
  markdown: string
  /** 结构化读数，页面和策略方按需取用 */
  data: unknown
  source: string
  /** 谁推来的：机器人，还是策略方手动补的 */
  by: 'BOT' | 'AGENT'
  receivedAt: string
  /** 同一天同一时点第几次推送（重推只留最新一份） */
  revision: number
  /** 策略方的决定 */
  decision: { at: string; text: string } | null
  /** 委员会的否决 */
  veto: { at: string; note: string } | null
}

const DATE = /^\d{4}-\d{2}-\d{2}$/
const STAMP = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/
/** 汇总里不该出现的字段：股数、现金、市值、总资产 */
const PRIVATE_KEY = /^(quantity|shares|cash|externalCash|marketValue|positionsValue|totalAssets|peakAssets|brokerTotal|portfolioTotal|cost)$/i

function privateKey(value: unknown, depth = 0): string | null {
  if (depth > 12 || value === null || typeof value !== 'object') return null
  if (Array.isArray(value)) {
    for (const v of value) { const k = privateKey(v, depth + 1); if (k) return k }
    return null
  }
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (PRIVATE_KEY.test(k)) return k
    const inner = privateKey(v, depth + 1)
    if (inner) return inner
  }
  return null
}

/** 收下一份汇总。返回留存的文档，或拒收原因 */
export function acceptDigest(store: ChainStore, body: unknown, now = new Date(), by: 'BOT' | 'AGENT' = 'BOT'): DigestDoc | string {
  const b = (body ?? {}) as Record<string, unknown>
  const date = String(b.date ?? '')
  const slot = String(b.slot ?? '')
  const title = String(b.title ?? '').trim()
  const markdown = typeof b.markdown === 'string' ? b.markdown : ''
  const generatedAt = String(b.generatedAt ?? '')
  if (!DATE.test(date)) return '日期不对'
  if (!DIGEST_SLOTS.some(s => s.id === slot)) return '没有这个时点'
  if (!title || title.length > 120) return '缺标题，或标题太长'
  if (!markdown.trim() || markdown.length > 300_000) return '缺正文，或正文太长'
  if (!STAMP.test(generatedAt)) return '缺生成时刻'
  if (b.asOf != null && !DATE.test(String(b.asOf))) return '读数截止日不对'
  const leaked = privateKey(b.data)
  if (leaked) return `汇总里不能有股数和金额（字段 ${leaked}）`
  const have = store.digest<DigestDoc>(date, slot)
  const doc: DigestDoc = {
    date, slot, title, generatedAt, asOf: b.asOf == null ? null : String(b.asOf), markdown, data: b.data ?? null,
    source: String(b.source ?? 'bot').slice(0, 40), by, receivedAt: beijingStamp(now), revision: (have?.revision ?? 0) + 1,
    // 重推不抹掉已经写下的决定和否决
    decision: have?.decision ?? null, veto: have?.veto ?? null,
  }
  store.saveDigest(date, slot, doc)
  return doc
}

function annotate(store: ChainStore, date: string, slot: string, text: unknown, apply: (doc: DigestDoc, text: string) => void): DigestDoc | string {
  if (!DATE.test(date) || !DIGEST_SLOTS.some(s => s.id === slot)) return '没有这份汇总'
  const doc = store.digest<DigestDoc>(date, slot)
  if (!doc) return '没有这份汇总'
  const t = typeof text === 'string' ? text.trim() : ''
  if (!t || t.length > 4000) return '内容是空的，或超过 4000 字'
  apply(doc, t)
  store.saveDigest(date, slot, doc)
  return doc
}

export function setDecision(store: ChainStore, date: string, slot: string, text: unknown, now = new Date()): DigestDoc | string {
  return annotate(store, date, slot, text, (doc, t) => { doc.decision = { at: beijingStamp(now), text: t } })
}

export function setVeto(store: ChainStore, date: string, slot: string, note: unknown, now = new Date()): DigestDoc | string {
  return annotate(store, date, slot, note, (doc, t) => { doc.veto = { at: beijingStamp(now), note: t } })
}

export interface DigestHead {
  date: string; slot: string; title: string; generatedAt: string; receivedAt: string; asOf: string | null
  decided: boolean; vetoed: boolean
}

/** 最近的汇总，只有标题和状态。新的在前 */
export function listDigests(store: ChainStore, days = 10): DigestHead[] {
  const order = DIGEST_SLOTS.map(s => s.id)
  const out: DigestHead[] = []
  for (const date of store.digestDates(days)) {
    for (const slot of store.digestSlots(date).sort((a, b) => order.indexOf(b) - order.indexOf(a))) {
      const d = store.digest<DigestDoc>(date, slot)
      if (d) out.push({ date, slot, title: d.title, generatedAt: d.generatedAt, receivedAt: d.receivedAt, asOf: d.asOf, decided: d.decision !== null, vetoed: d.veto !== null })
    }
  }
  return out
}
