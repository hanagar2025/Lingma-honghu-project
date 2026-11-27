/**
 * 截图自动识别。把图片交给一个看图的模型，只让它抄数字，抄回来的结构与战略侧人工识别交回的完全相同，
 * 之后走同一条路：勾稽核对 → 委员会本人确认 → 才生效。模型读错一位，勾稽核对要拦得住。
 *
 * 接口是通用的 chat/completions 格式（阿里云百炼、以及同类服务都支持）。
 */
import type { NameBook } from './parseText'

export interface VisionConfig { url: string; model: string; key: string }

const PROMPT = `这是一张证券账户的手机截图。你只做抄录：把图上的数字原样抄下来，不计算、不推测、不补全。
只输出一个 JSON 对象，不要输出任何别的文字。

如果是持仓页面，输出：
{"kind":"HOLDINGS","totalAssets":总资产,"totalMarketValue":总市值,"available":可用资金,
 "positions":[{"name":"股票名称","code":"6位代码，图上没有就填 null","quantity":持仓股数,"price":现价,"marketValue":市值,"cost":成本价}]}

如果是成交记录或成交回报页面，输出：
{"kind":"TRADE","trades":[{"date":"YYYY-MM-DD，图上没有就填 null","side":"BUY 或 SELL","name":"股票名称","code":"6位代码，没有就填 null","quantity":成交股数,"price":成交均价}]}

其他图片输出：{"kind":"OTHER"}

要求：
- 金额和价格用数字，去掉逗号；"万"要换算成元。
- 持仓股数抄"持仓"或"股票余额"那一列，不是"可用"。
- 每一只持仓都要抄，不要漏行。
- 任何一个数字看不清，就把那个字段填 null，不要猜。`

type Fetch = typeof fetch
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

function extractJson(text: string): Record<string, unknown> {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('识别服务没有返回结构化结果')
  try {
    return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>
  } catch {
    throw new Error('识别服务返回的内容不是合法的 JSON')
  }
}

/** 说明文字里的「名称 代码」可以补充代码表，例如「某某股份 600000」 */
export function noteCodes(note: string | undefined): NameBook {
  const out: NameBook = {}
  for (const m of (note ?? '').matchAll(/([\u4e00-\u9fa5A-Za-z*]{2,10})\s*[（(]?(\d{6})[）)]?/g)) out[m[1]!] = m[2]!
  return out
}

function codeOf(raw: Record<string, unknown>, book: NameBook): string | null {
  if (typeof raw.code === 'string' && /^\d{6}$/.test(raw.code)) return raw.code
  const name = typeof raw.name === 'string' ? raw.name.replace(/\s/g, '') : ''
  return book[name] ?? null
}

/**
 * 模型抄回来的内容 → attachParsed 接收的结构。读不全就报错，不凑数。
 * 现金取「总资产 − 总市值」：卖出当天尚未到账的钱也是账户里的现金。
 */
export function toPayload(raw: Record<string, unknown>, today: string, book: NameBook): { payload: unknown; remark: string } {
  if (raw.kind === 'OTHER') return { payload: { kind: 'NOTE' }, remark: '' }
  if (raw.kind === 'HOLDINGS') {
    if (!num(raw.totalAssets) || !num(raw.totalMarketValue)) throw new Error('总资产或总市值没有读出来')
    if (!Array.isArray(raw.positions)) throw new Error('持仓列表没有读出来')
    const positions = (raw.positions as Record<string, unknown>[]).map(p => {
      const name = typeof p.name === 'string' ? p.name.replace(/\s/g, '') : ''
      const code = codeOf(p, book)
      if (!name) throw new Error('有一行持仓的名称没有读出来')
      if (!code) throw new Error(`「${name}」的代码图上没有，名单里也查不到。请重发并在说明里写上「${name} 6位代码」`)
      if (!num(p.quantity) || !num(p.price) || !num(p.marketValue)) throw new Error(`「${name}」的股数、现价或市值没有读出来`)
      return { code, name, quantity: p.quantity, price: p.price, marketValue: p.marketValue, ...(num(p.cost) ? { cost: p.cost } : {}) }
    })
    const cash = Math.round((raw.totalAssets - raw.totalMarketValue) * 100) / 100
    const remark = num(raw.available) && Math.abs(raw.available - cash) > 1
      ? '图上的可用资金与「总资产 − 总市值」不相等（可能有未到账的卖出款），现金按「总资产 − 总市值」记。' : ''
    return {
      payload: { kind: 'HOLDINGS', holdings: { asOf: today, cash, totalAssets: raw.totalAssets, totalMarketValue: raw.totalMarketValue, positions } },
      remark,
    }
  }
  if (raw.kind === 'TRADE') {
    if (!Array.isArray(raw.trades) || !raw.trades.length) throw new Error('成交记录没有读出来')
    const trades = (raw.trades as Record<string, unknown>[]).map(t => {
      const name = typeof t.name === 'string' ? t.name.replace(/\s/g, '') : ''
      const code = codeOf(t, book)
      if (!name || !code) throw new Error(`成交记录里「${name || '某一行'}」的代码查不到。请在说明里写上「名称 6位代码」`)
      if ((t.side !== 'BUY' && t.side !== 'SELL') || !num(t.quantity)) throw new Error(`「${name}」的买卖方向或股数没有读出来`)
      const date = typeof t.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(t.date) ? t.date : today
      return { date, side: t.side, code, name, quantity: t.quantity, price: num(t.price) ? t.price : null }
    })
    return { payload: { kind: 'TRADE', trades }, remark: '' }
  }
  throw new Error('识别服务返回了不认识的类型')
}

export async function recognize(
  image: Buffer, ext: string, cfg: VisionConfig, today: string, book: NameBook, doFetch: Fetch = fetch,
): Promise<{ payload: unknown; remark: string }> {
  const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`
  const res = await doFetch(`${cfg.url}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.key}` },
    body: JSON.stringify({
      model: cfg.model,
      temperature: 0,
      messages: [{
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: `data:${mime};base64,${image.toString('base64')}` } },
          { type: 'text', text: PROMPT },
        ],
      }],
    }),
    signal: AbortSignal.timeout(90_000),
  })
  if (res.status === 401 || res.status === 403) throw new Error('识别服务拒绝了密钥，请在「设置」里检查')
  if (!res.ok) throw new Error(`识别服务返回 HTTP ${res.status}`)
  const json = (await res.json()) as { choices?: { message?: { content?: unknown } }[] }
  const content = json.choices?.[0]?.message?.content
  const text = typeof content === 'string' ? content
    : Array.isArray(content) ? content.map(c => (c as { text?: string }).text ?? '').join('') : ''
  return toPayload(extractJson(text), today, book)
}
