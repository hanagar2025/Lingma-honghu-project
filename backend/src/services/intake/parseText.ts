/**
 * 文字输入的固定句式。认不出的一律当留言，不猜。
 *
 * 股票可以写名称、6 位代码，或「名称 代码」（名单和账本里都没有的股票要带代码）。
 *
 *   意向   计划卖出 中际旭创 600股 单票归位
 *   成交   卖出 中际旭创 600股 509.89        （可多行）
 *   持仓   持仓
 *          中际旭创 1100
 *          北方华创 300
 *          现金 87.24万
 */
import type { Intent, Parsed, SnapshotPosition, TradeRecord } from './types'

export type NameBook = Record<string, string>

export interface TextResult {
  parsed: Parsed
  /** 句式对了但内容读不出时的原因。有原因的不生效 */
  errors: string[]
}

function normalize(text: string): string {
  return text
    .replace(/[\uff01-\uff5e]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/\u3000/g, ' ')
    .replace(/[，、；]/g, ' ')
    .trim()
}

/** 「87.24万」「872401.30」「872,401.30元」→ 元 */
export function parseAmount(s: string): number | null {
  const m = /^([\d,]+(?:\.\d+)?)(万|亿)?元?$/.exec(s.trim())
  if (!m) return null
  const n = Number(m[1]!.replace(/,/g, ''))
  if (!Number.isFinite(n)) return null
  return m[2] === '万' ? n * 1e4 : m[2] === '亿' ? n * 1e8 : n
}

/**
 * 认出一只股票。三种写法：名称（名单或账本里有的）、6 位代码、「名称 代码」。
 * 名称和代码都写了但对不上时不猜，返回原因。
 */
function resolve(token: string, code: string | undefined, book: NameBook): { code: string; name: string } | string {
  if (/^\d{6}$/.test(token) && !code) {
    const name = Object.entries(book).find(([, c]) => c === token)?.[0]
    return { code: token, name: name ?? token }
  }
  const known = book[token]
  if (code) return known && known !== code ? `「${token}」与代码 ${code} 对不上` : { code, name: token }
  return known ? { code: known, name: token } : `不认识「${token}」，请写成「${token} 6位代码」`
}

const SIDE: Record<string, 'BUY' | 'SELL'> = {
  买入: 'BUY', 买: 'BUY', 加仓: 'BUY', 建仓: 'BUY', 已购: 'BUY', 已买: 'BUY',
  卖出: 'SELL', 卖: 'SELL', 减仓: 'SELL', 清仓: 'SELL', 已卖: 'SELL',
}
const SIDE_WORDS = Object.keys(SIDE).sort((a, b) => b.length - a.length).join('|')
const INTENT_RE = new RegExp(`^(?:计划|打算|准备|拟|想|意向)[:：\\s]*(${SIDE_WORDS})\\s*(\\S+?)(?:\\s+(\\d{6}))?(?:\\s+(\\d+)\\s*股?)?(?:\\s+(.*))?$`)
const TRADE_RE = new RegExp(`^(?:成交[:：\\s]*)?(${SIDE_WORDS})了?\\s*(\\S+?)(?:\\s+(\\d{6}))?\\s+(\\d+)\\s*股?(?:\\s*@?\\s*(?:成交价|均价|价格)?\\s*([\\d.]+)元?)?$`)

export function parseText(raw: string, book: NameBook, today: string): TextResult {
  const text = normalize(raw)
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  const errors: string[] = []
  if (!lines.length) return { parsed: { kind: 'NOTE' }, errors: ['内容是空的'] }

  const intent = INTENT_RE.exec(lines[0]!)
  if (intent && lines.length === 1) {
    const stock = resolve(intent[2]!, intent[3], book)
    if (typeof stock === 'string') return { parsed: { kind: 'NOTE' }, errors: [stock] }
    const parsed: Intent = {
      side: SIDE[intent[1]!]!, ...stock,
      quantity: intent[4] ? Number(intent[4]) : null,
      reason: (intent[5] ?? '').trim(),
    }
    return { parsed: { kind: 'INTENT', intent: parsed }, errors }
  }

  if (/^持仓/.test(lines[0]!) || lines.some(l => /^(现金|可用|资金余额)/.test(l))) {
    const date = /(\d{4}-\d{2}-\d{2})/.exec(lines[0]!)?.[1] ?? today
    const positions: SnapshotPosition[] = []
    let cash: number | null = null
    let totalAssets: number | undefined
    for (const line of lines) {
      if (/^持仓/.test(line)) continue
      const money = /^(现金|可用|资金余额|总资产)[:：\s]*(\S+)$/.exec(line)
      if (money) {
        const amount = parseAmount(money[2]!)
        if (amount === null) errors.push(`「${line}」里的金额读不出`)
        else if (money[1] === '总资产') totalAssets = amount
        else cash = amount
        continue
      }
      const row = /^(\S+?)(?:\s+(\d{6}))?\s+(\d+)\s*股?(?:\s+成本\s*([\d.]+))?$/.exec(line)
      if (!row) { errors.push(`「${line}」读不出，每行写成：名称 股数`); continue }
      const stock = resolve(row[1]!, row[2], book)
      if (typeof stock === 'string') { errors.push(stock); continue }
      positions.push({ ...stock, quantity: Number(row[3]), ...(row[4] ? { cost: Number(row[4]) } : {}) })
    }
    if (cash === null) errors.push('缺少「现金」一行')
    return {
      parsed: { kind: 'HOLDINGS', holdings: { asOf: date, cash: cash ?? 0, positions, ...(totalAssets !== undefined ? { totalAssets } : {}) } },
      errors,
    }
  }

  const trades: TradeRecord[] = []
  for (const line of lines) {
    const m = TRADE_RE.exec(line)
    if (!m) return { parsed: { kind: 'NOTE' }, errors: [] }
    const stock = resolve(m[2]!, m[3], book)
    if (typeof stock === 'string') return { parsed: { kind: 'NOTE' }, errors: [stock] }
    trades.push({ date: today, side: SIDE[m[1]!]!, ...stock, quantity: Number(m[4]), price: m[5] ? Number(m[5]) : null })
  }
  return { parsed: { kind: 'TRADE', trades }, errors }
}
