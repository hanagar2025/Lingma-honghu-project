/**
 * 名单治理（L-01）· 运行入口
 *
 *   npm -w backend run ladder
 *
 * 读六份名单与账本 → 计算名单主表 → 追加留痕台账 → 写 share/ladder/。
 * 环境变量：LADDER_LEDGER_WRITE=0 不写台账；LADDER_PRICES=0 不取价（持仓风险提示改为指向驾驶舱）。
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { appendLadderEvents, loadDecisions, loadLadderLedger, saveLadderLedger } from './ledger'
import { buyPermissionOf, buildLadder } from './registry'
import { renderLadder, type RiskBlock } from './render'
import { loadPortfolio, type PortfolioLite } from './sources'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..', '..', '..')
export const LADDER_SHARE_DIR = join(ROOT, 'share', 'ladder')

/** 委员会尚未批准生产买入；交易所日历尚未接入。两项改动都须正式裁定 */
const PRODUCTION_BUY_APPROVED = false
const EXCHANGE_CALENDAR = false

/** 与 cockpit/safety.ts 的 LIMITS 同值；这里只用于显示，不参与任何判定 */
const SECTOR_LIMIT = 0.30
const THEME_LIMIT = 0.45

async function fetchPrices(codes: string[]): Promise<{ at: string; px: Record<string, number> } | null> {
  try {
    const syms = codes.map(c => `${/^[69]/.test(c) ? 'sh' : 'sz'}${c}`)
    const res = await fetch(`https://qt.gtimg.cn/q=${syms.join(',')}`, { headers: { Referer: 'https://gu.qq.com/' } })
    const text = new TextDecoder('gbk').decode(await res.arrayBuffer())
    const px: Record<string, number> = {}
    let at = ''
    for (const line of text.split(';')) {
      const f = line.split('~')
      if (f.length > 30 && f[2] && Number(f[3]) > 0) {
        px[f[2]] = Number(f[3])
        at = f[30] ?? at
      }
    }
    return Object.keys(px).length === codes.length ? { at, px } : null
  } catch {
    return null
  }
}

function riskOf(p: PortfolioLite, prices: { at: string; px: Record<string, number> } | null): RiskBlock {
  if (!prices) return { pricedAt: null, sectors: [], themes: [], note: '取价失败，占比见驾驶舱。' }
  const mv = (c: string, q: number) => (prices.px[c] ?? 0) * q
  const total = p.cash + p.externalCash + p.positions.reduce((s, x) => s + mv(x.code, x.quantity), 0)
  const sum = (key: 'sector' | 'theme') => {
    const m = new Map<string, number>()
    for (const x of p.positions) m.set(x[key], (m.get(x[key]) ?? 0) + mv(x.code, x.quantity))
    return [...m].map(([label, v]) => ({ label, pct: v / total, limit: key === 'sector' ? SECTOR_LIMIT : THEME_LIMIT }))
      .sort((a, b) => b.pct - a.pct)
  }
  const at = prices.at.length >= 12 ? `${prices.at.slice(0, 4)}-${prices.at.slice(4, 6)}-${prices.at.slice(6, 8)} ${prices.at.slice(8, 10)}:${prices.at.slice(10, 12)}` : prices.at
  return {
    pricedAt: at,
    sectors: sum('sector'),
    themes: sum('theme'),
    note: `按账本 ${p.asOf} 股数 × 最新价计算，分母为总资产（现金 + 持仓市值）。板块 30%、主题 45% 上限目前只显示，不自动生成卖单；熔断与单票归位以执行单为准。`,
  }
}

async function main(): Promise<void> {
  const portfolio = loadPortfolio()
  const decisions = loadDecisions()
  const bj = new Date(Date.now() + 8 * 3600e3).toISOString()
  const asOf = process.env.ASOF ?? bj.slice(0, 10)
  const view = buildLadder({
    asOf, generatedAt: new Date().toISOString(), portfolio, decisions,
    buyPermission: buyPermissionOf(portfolio, { productionBuyApproved: PRODUCTION_BUY_APPROVED, exchangeCalendar: EXCHANGE_CALENDAR }),
  })
  const prices = process.env.LADDER_PRICES === '0' ? null : await fetchPrices(portfolio.positions.map(p => p.code))
  const risk = process.env.LADDER_PRICES === '0' ? null : riskOf(portfolio, prices)

  if (process.env.LADDER_LEDGER_WRITE !== '0') {
    const { ledger, added } = appendLadderEvents(loadLadderLedger(), view, decisions)
    saveLadderLedger(ledger)
    process.stderr.write(`留痕台账：本次新增 ${added.length} 条，累计 ${ledger.events.length} 条\n`)
  }

  const md = renderLadder(view, risk)
  mkdirSync(LADDER_SHARE_DIR, { recursive: true })
  writeFileSync(join(LADDER_SHARE_DIR, 'latest.md'), md, 'utf-8')
  writeFileSync(join(LADDER_SHARE_DIR, 'latest.json'), `${JSON.stringify({ ...view, risk }, null, 1)}\n`, 'utf-8')
  process.stdout.write(md)
  process.stderr.write(`\n已写 share/ladder/latest.md 与 latest.json（${view.entries.length} 只）\n`)
}

main().catch(e => {
  process.stderr.write(`名单主表运行失败：${e instanceof Error ? e.stack : String(e)}\n`)
  process.exit(1)
})
