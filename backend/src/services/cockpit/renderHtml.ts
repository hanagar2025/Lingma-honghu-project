// 驾驶舱静态 HTML 导出
//
// 存在理由很实际：后端启动依赖 MySQL，前端还要登录。
// 盘后 15:10 真正想看一眼今天的分析时，最不该卡在"数据库没起来"。
// 本导出是自包含单文件（内联样式、无外部请求、无 JS 依赖），
// 双击即可在任何浏览器打开，也可以直接发到手机上看。
//
// 它是**同一份数据的另一个渲染器**：不新增判据、不改动作、不影响规则指纹。
// 渲染纪律与前端一致：缺失显示"缺失"、不显示综合评分、数据完整度放表头。

import type { Dashboard } from './dashboard'
import type { Verdict } from './verdict'
import type { DecisionCockpit } from '../decision/cockpitV2'
import { HUNTER_TEXT } from '../decision/hunter'
import { CAPITAL_ACTION_TEXT, EVIDENCE_TONE_TEXT, OWNERSHIP_TEXT } from '../decision/triaxis'
import { LAYER_STATUS_TEXT } from '../decision/evidence'
import {
  VERIFICATION_CHAIN, SOURCE_TIER_TEXT, CAUSAL_STATUS_TEXT,
  fourLineVerdict, causalLayers, pendingVerification, paidGaps, wiringBacklog,
  type Hypothesis,
} from '../research/hypotheses'
import type { Change } from '../governance/changeLog'
import { renderPowerChain } from '../research/powerChain'
import { renderPortfolioDefense } from '../research/portfolioDefense'
import { renderOwnershipPhilosophy } from '../research/ownershipPhilosophy'
import { renderLookout, type LookoutView } from './lookout'

function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ))
}

function pct(v: number | null | undefined, digits = 1, signed = false): string {
  if (v === null || v === undefined) return '<span class=miss>缺失</span>'
  const cls = signed ? (v > 0 ? 'up' : v < 0 ? 'down' : '') : ''
  return `<span class="${cls}">${signed && v > 0 ? '+' : ''}${(v * 100).toFixed(digits)}%</span>`
}

function pp(v: number | null | undefined): string {
  if (v === null || v === undefined) return '<span class=miss>缺失</span>'
  return `<b class="${v > 0 ? 'up' : v < 0 ? 'down' : ''}">${v > 0 ? '+' : ''}${v.toFixed(1)}pct</b>`
}

function yi(v: number | null | undefined): string {
  if (v === null || v === undefined) return '<span class=miss>缺失</span>'
  return `${(v / 1e8).toFixed(1)}亿`
}

function arrow(v: string | undefined): string {
  if (!v) return '<span class=miss>缺失</span>'
  const cls = v.startsWith('↑') ? 'up' : v.startsWith('↓') ? 'down' : v === '?' ? 'miss' : ''
  return `<span class="${cls}">${esc(v)}</span>`
}

function gate(v: boolean | null | undefined): string {
  if (v === null || v === undefined) return '<span class=miss>?</span>'
  return v ? '<span class=up>✓</span>' : '<span class=down>✗</span>'
}

const CSS = `
:root{--fg:#1c1c1e;--sec:#6e6e73;--line:#e5e5ea;--bg:#fff;--up:#ff3b30;--down:#0a84ff;--warn:#ff9500}
*{box-sizing:border-box}
body{margin:0;padding:24px;font:14px/1.7 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif;color:var(--fg);background:#f2f2f7}
.wrap{max-width:1280px;margin:0 auto}
/* 表格横向滚动容器。手机上宁可让人横滑，也不压缩列或换行 ——
   持仓表的每一列都是判断依据，挤成两行会读错行。 */
.tw{overflow-x:auto;-webkit-overflow-scrolling:touch}
.tw table{min-width:760px}
h1{font-size:20px;margin:0 0 4px}
h2{font-size:16px;margin:0 0 12px;padding-bottom:8px;border-bottom:2px solid var(--line)}
.card{background:var(--bg);border-radius:14px;padding:20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.06)}
.card.act{border:2px solid var(--up)}
.sec{color:var(--sec)}
.miss{color:#c7c7cc}
.up{color:var(--up)}
.down{color:var(--down)}
table{width:100%;border-collapse:collapse;font-size:13px}
th,td{padding:7px 9px;text-align:left;border-bottom:1px solid var(--line);white-space:nowrap}
th{background:#fafafa;font-weight:600;color:var(--sec);font-size:12px}
tr:hover td{background:#fafafd}
.tag{display:inline-block;padding:1px 8px;border-radius:10px;font-size:12px;border:1px solid var(--line)}
.tag.red{background:#ffebe9;border-color:#ffcdc9;color:#c9302c}
.tag.green{background:#eaf9ee;border-color:#c6ecd0;color:#217a3a}
.tag.orange{background:#fff4e5;border-color:#ffe0b2;color:#b26a00}
.tag.grey{background:#f2f2f7;color:var(--sec)}
.kv{display:flex;gap:12px;margin-bottom:2px}
.kv .k{min-width:108px;color:var(--sec);flex-shrink:0}
.banner{padding:12px 16px;border-radius:10px;margin-bottom:12px;font-size:13px}
.banner.ok{background:#eaf9ee;border-left:4px solid #34c759}
.banner.warn{background:#fff4e5;border-left:4px solid var(--warn)}
.banner.info{background:#eef4ff;border-left:4px solid var(--down)}
.banner.bad{background:#ffeef0;border-left:4px solid var(--up)}
/* EXCLUDED 用灰色而非黄色：裁定排除不是待办，不该在视觉上要求处理 */
.banner.grey{background:#f7f7fa;border-left:4px solid #c7c7cc;color:var(--sec)}
/* 仪表盘：六个数字并排，窄屏自动折行。这是唯一置顶的区块 */
.dash{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:10px}
.dashcell{flex:1 1 120px;background:#f7f7fa;border-radius:10px;padding:10px 12px}
.dashk{font-size:11px;color:var(--sec);margin-bottom:4px}
.dashv{font-size:17px;font-weight:600}
/* 验证链：当前步高亮。灰色部分是"还没走到"，不是"已否决" */
.chain{display:flex;flex-wrap:wrap;align-items:center;gap:4px;margin:8px 0;font-size:12px}
.step{padding:3px 8px;border-radius:6px;background:#f2f2f7;color:var(--sec)}
.step.now{background:#fff4e5;color:#b26a00;font-weight:600}
.arrow{color:#c7c7cc}
ul{margin:4px 0;padding-left:20px}
.chg{display:flex;gap:8px;flex-wrap:wrap;align-items:baseline}
.chg .who{min-width:230px;color:var(--sec)}
.foot{font-size:12px;color:var(--sec);margin-top:8px}
.note{font-size:12px;color:var(--sec);margin-top:10px}
pre.plain{white-space:pre-wrap;font-size:12.5px;line-height:1.7;background:#f7f7fa;padding:12px;border-radius:10px;overflow:auto}

/* 手机：这份报告的主要用途之一是隔夜在手机上翻，所以窄屏必须能读。
   只调间距与字号，不隐藏任何一列 —— 手机上看不到的那列，正好可能是法定减仓理由。 */
@media (max-width:820px){
  body{padding:10px;font-size:15px}
  .card{padding:14px;border-radius:12px}
  h1{font-size:18px}
  h2{font-size:15px}
  .kv{flex-direction:column;gap:0;margin-bottom:8px}
  .kv .k{min-width:0;font-size:12px}
  /* 变化行：标签独占一行，但 旧值→新值（增量）必须留在同一行。
     若整行纵向堆叠，"12.1% / → / 9.0% / (-3.1pct)" 会变成四行，读的人得自己拼回去。 */
  .chg{margin-bottom:10px}
  .chg .who{min-width:0;flex:0 0 100%;font-size:12px}
  .tw table{min-width:700px;font-size:12.5px}
  th,td{padding:6px 7px}
  .banner{padding:10px 12px}
}
`

export interface HtmlInput {
  dashboard: Dashboard
  changes: Change[]
  prevDate: string | null
  discovery: { nodeCount: number; advances: { key: string; date: string; from: number; to: number; gates: string }[] }
  freeze: { baselineHash: string | null; currentHash: string; drifted: boolean; detail: string }
  /** 外部叙事台账。OBSERVATION 级，只供研究，不得产生动作 */
  hypotheses?: Hypothesis[]
  /** 最新K线尚未定价（盘中运行）。为真时全表读数为临时值且未归档 */
  intraday?: boolean
  /** 今日结论。放在四张表之前 —— 结论先于依据 */
  verdict?: Verdict | null
  /** V2 决策驾驶舱。放在法定动作摘要之前 */
  decisionV2?: DecisionCockpit | null
  /** 电力价值传导图。只研究，不产生动作 */
  powerChain?: unknown
  /** 组合防守层。只审计暴露，不产生动作 */
  portfolioDefense?: unknown
  /** 投资哲学参考。不产生动作 */
  ownershipPhilosophy?: unknown
  /** 极简看台。放在最前面 */
  lookout?: LookoutView | null
}

export function renderDashboardHtml(input: HtmlInput): string {
  const {
    dashboard: d, changes, prevDate, discovery, freeze, intraday, verdict, decisionV2, hypotheses,
    powerChain, portfolioDefense, ownershipPhilosophy, lookout,
  } = input
  const h = d.headline
  const ms = d.marketStructure
  const az = d.actionZone
  const P: string[] = []
  const w = (s: string) => P.push(s)

  w(`<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">`)
  w(`<meta name="viewport" content="width=device-width,initial-scale=1">`)
  w(`<title>《鸿鹄理财》${esc(d.date)}</title><style>${CSS}</style></head><body><div class=wrap>`)

  // ── 头 ──
  w(`<div class=card><h1>《鸿鹄理财》资本生命线 · ${esc(d.date)}</h1>`)
  w(`<div class=sec>本页回答决策。下面的表是依据。　|　${esc(d.session === 'PRE_OPEN' ? '盘前' : '盘后')}</div>`)
  if (intraday) {
    w(`<div class="banner warn" style="margin-top:12px"><b>⚠ 盘中快照（未定价）</b>`)
    w(`　最新K线 ${esc(d.date)} 尚未收盘，全表读数为临时值：仓位百分比、相对强度、成交比值都会随收盘变化。`)
    w(`<div class=foot>本次<b>未写入 30 天档案</b>，以免盘中值污染日间序列。盘后 15:10 之后重跑一次才算当日正式读数。</div></div>`)
  }
  w(`<div class="banner ${freeze.drifted ? 'warn' : 'ok'}" style="margin-top:12px">`)
  w(`规则指纹 <b>${esc(freeze.currentHash)}</b>`)
  w(freeze.baselineHash ? `　基线 ${esc(freeze.baselineHash)}　${freeze.drifted ? '⚠ 已漂移' : '✓ 未漂移'}` : '　⚠ 无冻结基线')
  w(`<div class=foot>${esc(freeze.detail)}</div></div>`)

  if (lookout) {
    w(`</div><div class="card act"><h2>看台 —— 投资人前台只看这一问</h2>`)
    w(`<pre class=plain>${esc(renderLookout(lookout))}</pre>`)
  }

  // ── 资产层（第一层）──
  {
    const a = d.assets
    const wan = (v: number) => `${(v / 10000).toFixed(1)}万`
    const pp = (v: number | null) => (v === null ? '<span class=miss>缺失</span>' : `${(v * 100).toFixed(1)}%`)
    const CIRCUIT_TEXT: Record<string, string> = {
      NORMAL: '未触发', LEVEL1: '一级成立', LEVEL2: '二级成立',
      INCOMPARABLE: '不可判定（峰值口径不可比）',
    }
    w(`</div><div class=card><h2>仪表盘</h2>`)
    // 委员会指定永久置顶的六个数字。其余全部在它下面。
    w(`<div class=dash>`)
    for (const [k, v] of [
      ['组合总资产', wan(a.portfolioTotal)],
      ['股票市值', wan(a.positionsValue)],
      ['投资现金', wan(a.brokerCash + a.externalCash)],
      ['股票仓位', pp(a.equityPct)],
      ['历史峰值', a.peak === null ? '<span class=miss>未按组合口径认定</span>' : wan(a.peak)],
      ['当前回撤', a.drawdown === null ? '<span class=miss>不可比</span>' : pp(a.drawdown)],
      ['熔断等级', CIRCUIT_TEXT[a.circuitState] ?? a.circuitState],
    ] as [string, string][]) {
      w(`<div class=dashcell><div class=dashk>${k}</div><div class=dashv>${v}</div></div>`)
    }
    w(`</div>`)
    w(`<div class=foot>分项：账内现金 ${wan(a.brokerCash)} + 账户外 ${wan(a.externalCash)}`)
    w(`　│　券商账户合计 ${wan(a.brokerTotal)}（账户内仓位 ${pp(a.brokerPositionPct)}，`)
    w(`可直接下单 ${wan(a.tradableCash)}）—— 只回答"还有多少钱能下单"，不参与上限判定</div>`)
    if (a.circuitState === 'INCOMPARABLE') {
      w(`<div class="banner warn">${esc(a.circuitReason)}</div>`)
    }
  }

  // ── 风控四层：先看这个，再看涨跌 ──
  {
    const LIGHT_CLASS: Record<string, string> = {
      GREEN: 'ok', YELLOW: 'warn', RED: 'bad', UNKNOWN: 'warn', EXCLUDED: 'grey',
    }
    w(`</div><div class=card><h2>风控优先级</h2>`)
    w(`<div class=foot style="margin-bottom:10px">每天先看这一层，再看涨跌。`)
    w(`顺序本身是规则：L1/L2 产生动作，L3 已裁定排除，L4 永远只是复核信息。</div>`)
    for (const r of d.riskLayers) {
      w(`<div class="banner ${LIGHT_CLASS[r.light] ?? 'info'}">`)
      w(`<b>${esc(r.id)}｜${esc(r.name)}</b>　${esc(r.state)}`)
      w(`<div class=foot>${r.canGenerateActions ? '可产生动作' : '不可产生动作'}`)
      if (r.note) w(`　${esc(r.note)}`)
      w(`</div></div>`)
    }
  }

  // ── V4 资本配置操作系统：第一层决策，下面才是依据 ──
  if (decisionV2) {
    const v2 = decisionV2
    w(`</div><div class="card act"><h2>《${esc(v2.productName)}》${esc(v2.productModel)}</h2>`)
    w(`<div class=sec>${esc(v2.dailyQuestion ?? '今天有没有出现足以改变资本状态的新事实？')} 没有 → 维持。有 → 进入证据审查。第一层看决策。第二层看理由。第三层看证据。第四层机器看原始数据。</div>`)
    w(`<div class=foot>${esc(v2.maxim)}</div>`)

    w(`<h3 style="font-size:15px;margin:14px 0 8px">战略</h3>`)
    w(`<div class=tw><table><thead><tr><th>主线</th><th>状态</th><th>原因</th></tr></thead><tbody>`)
    for (const s of v2.strategy) {
      w(`<tr><td>${esc(s.name)}${s.combat ? '' : '（只研究）'}</td>`)
      w(`<td>${esc(s.board)}</td>`)
      w(`<td>${esc(s.why.slice(0, 2).join('；'))}</td></tr>`)
    }
    w(`</tbody></table></div>`)

    w(`<h3 style="font-size:15px;margin:14px 0 8px">资本生命线</h3>`)
    w(`<div class=tw><table><thead><tr><th>公司</th><th>Ownership</th><th>Evidence</th><th>Exposure</th><th>Action</th><th>生命线</th></tr></thead><tbody>`)
    for (const r of v2.lifeline ?? []) {
      w(`<tr><td>${esc(r.name)}${r.posPct === null ? '' : ` ${(r.posPct * 100).toFixed(1)}%`}</td>`)
      w(`<td>${r.ownYes ? '✓' : '✗'} ${esc(OWNERSHIP_TEXT[r.ownership] ?? r.ownership)}</td>`)
      w(`<td>${esc(EVIDENCE_TONE_TEXT[r.evidenceTone] ?? r.evidenceTone)}</td>`)
      w(`<td>${esc(r.exposure)}</td>`)
      w(`<td>${esc(CAPITAL_ACTION_TEXT[r.action] ?? r.action)}</td>`)
      w(`<td>${esc(HUNTER_TEXT[r.hunter] ?? r.hunter)}</td></tr>`)
    }
    w(`</tbody></table></div>`)

    if (v2.riskBoard) {
      w(`<h3 style="font-size:15px;margin:14px 0 8px">风险</h3>`)
      w(`<div>战略风险　${esc(v2.riskBoard.strategy)}　│　公司风险　${esc(v2.riskBoard.company)}　│　预期风险　${esc(v2.riskBoard.expectation)}　│　组合风险　${esc(v2.riskBoard.portfolio)}</div>`)
      for (const g of v2.riskBoard.dataGaps) w(`<div class=foot>· ${esc(g)}</div>`)
    }

    w(`<h3 style="font-size:15px;margin:14px 0 8px">今天真正需要投资人做的事</h3>`)
    const tasks = v2.todayTasks ?? []
    if (!tasks.length) w(`<div class=sec>今日没有必须由投资人执行的事。</div>`)
    tasks.forEach((t, i) => w(`<div style="margin-bottom:6px"><b>${i + 1}.</b> ${esc(t)}</div>`))

    w(`<h3 style="font-size:15px;margin:14px 0 8px">当前无法判断</h3>`)
    for (const u of v2.unjudgable ?? []) {
      w(`<div style="margin-bottom:8px"><b>⚠ ${esc(u.topic)}</b>`)
      w(`<div class=foot>${esc(u.why)}</div>`)
      w(`<div class=foot>→ ${esc(u.forbidden)}</div></div>`)
    }

    w(`<h3 style="font-size:15px;margin:14px 0 8px">鸿鹄五问</h3>`)
    for (const q of v2.sentences) {
      const mark = ['①', '②', '③', '④', '⑤'][q.no - 1]
      w(`<div style="margin-bottom:10px"><b>${mark} ${esc(q.question)}</b>`)
      w(`<div>${esc(q.answer)}</div></div>`)
    }

    w(`<details style="margin-top:12px"><summary style="cursor:pointer;color:var(--sec)">理由与证据（折叠）</summary>`)
    for (const h of v2.holdings) {
      w(`<div style="margin:10px 0;padding:10px 12px;background:#f2f2f7;border-radius:10px">`)
      w(`<b>${esc(h.name)}</b>　${esc(HUNTER_TEXT[h.judged.hunter] ?? '')}`)
      w(`<div class=foot>理由　${esc(h.judged.oneReason)}</div>`)
      w(`<div class=foot>迁移　${esc(h.judged.migration.why)}</div>`)
      for (const layer of h.judged.evidence.layers) {
        w(`<div class=foot>${esc(layer.name)}　${esc(LAYER_STATUS_TEXT[layer.status])}　${esc(layer.fact)}</div>`)
      }
      w(`</div>`)
    }
    w(`</details>`)
    w(`<div class=foot>${esc(v2.noCompositeScoreNote)}</div>`)
  }

  // ── 今日结论 ──
  // 法定动作摘要。决策在上面，依据在下面。
  if (verdict) {
    w(`</div><div class="card act"><h2>今日结论</h2>`)
    w(`<div class="banner info"><b>${esc(verdict.oneLine)}</b></div>`)

    w(`<h3 style="font-size:15px;margin:14px 0 8px">焦点：今天真正需要你看的就这 ${verdict.focus.length} 个</h3>`)
    if (!verdict.focus.length) w(`<div class=sec>无。今天没有任何标的触发规则。</div>`)
    verdict.focus.forEach((f, i) => {
      w(`<div style="margin-bottom:10px"><b>${i + 1}. ${esc(f.name)}</b>`)
      w(`<span class="tag ${f.held ? 'green' : 'grey'}">${f.held ? '持仓' : '未持仓'}</span>`)
      w(`<div class=foot style="padding-left:14px">为什么在这里：${esc(f.because)}</div>`)
      w(`<div class=foot style="padding-left:14px">今天做什么：${esc(f.todo)}</div></div>`)
    })
    w(`<div class="banner warn"><b>研究覆盖</b>　${esc(verdict.coverageVerdict)}</div>`)

    const tier = (title: string, note: string, rows: typeof verdict.mustDo, strong: boolean) => {
      w(`<h3 style="font-size:15px;margin:14px 0 6px" class="${strong ? 'up' : ''}">${esc(title)}</h3>`)
      if (note) w(`<div class=foot>${esc(note)}</div>`)
      if (!rows.length) { w(`<div class=sec>无</div>`); return }
      for (const h of rows) {
        w(`<div style="margin:8px 0"><b>${esc(h.name)}</b>（${esc(h.code)}）`)
        w(`　仓位 ${h.posPct === null ? '<span class=miss>缺失</span>' : `${(h.posPct * 100).toFixed(1)}%`}`)
        w(`　→ <b>${esc(h.action)}</b>`)
        w(`<div class=foot style="padding-left:14px">法定减仓理由：`)
        w(h.legalReason ? `<span class=up>${esc(h.legalReason)}</span>` : '<span class=sec>无</span>')
        w(`</div><div class=foot style="padding-left:14px">${esc(h.saysWhat.join('；'))}</div>`)
        if (h.notReason.length) {
          w(`<div class=foot style="padding-left:14px">明确不是理由：${esc(h.notReason.join('；'))}</div>`)
        }
        w(`</div>`)
      }
    }
    tier(`一、必须执行（有法定理由）—— ${verdict.mustDo.length} 项`, '', verdict.mustDo, true)
    tier(
      `二、触发复核但无法定理由 —— ${verdict.reviewNoAction.length} 项（系统不动作）`,
      '这一档最容易被自己推翻：读到"多项恶化"很容易顺手卖出，但技术指标只被允许触发复核。',
      verdict.reviewNoAction, false
    )
    if (verdict.quiet.length) {
      w(`<h3 style="font-size:15px;margin:14px 0 6px">三、无复核项也无法定理由 —— ${verdict.quiet.length} 项</h3>`)
      w(`<div class=sec>${verdict.quiet.map(q =>
        `${esc(q.name)} ${q.posPct === null ? '缺失' : `${(q.posPct * 100).toFixed(1)}%`}`).join('　')}</div>`)
    }

    w(`<h3 style="font-size:15px;margin:14px 0 6px">四、允许研究（不是允许买入）—— ${verdict.research.length} 个节点</h3>`)
    w(`<div class=foot>「允许研究」不等于「再等等」：下面每条缺口都是一件今天可以开始做的核验任务。</div>`)
    w(`<div class=tw><table><tr><th>节点</th><th>标的</th><th>数据在说什么</th><th>缺口</th></tr>`)
    for (const r of verdict.research) {
      w(`<tr><td>${esc(r.node)}${r.blockedByStrategy ? ' <span class="tag red">战略层不允许</span>' : ''}</td>`)
      w(`<td>${esc(r.members.join('、')) || '<span class=miss>无</span>'}</td>`)
      w(`<td style="white-space:normal">${esc(r.saysWhat.join('；'))}</td>`)
      w(`<td style="white-space:normal">${r.missingGates.map(g => esc(g)).join('<br>')}</td></tr>`)
    }
    w(`</table></div>`)

    w(`<h3 style="font-size:15px;margin:14px 0 6px">五、今日不许新增建仓的逐条原因</h3><ul>`)
    for (const r of verdict.noEntryReasons) w(`<li>${esc(r)}</li>`)
    if (!verdict.noEntryReasons.length) w(`<li>无禁止项</li>`)
    w(`</ul>`)

    w(`<h3 style="font-size:15px;margin:14px 0 6px">六、跨多日累计变化 —— 单日看不出的东西</h3>`)
    w(`<div class="banner ${verdict.drift.length ? 'info' : 'warn'}">${esc(verdict.driftNote)}`)
    if (verdict.driftWindow) {
      w(`<div class=foot>区间 ${esc(verdict.driftWindow.from)} → ${esc(verdict.driftWindow.to)}（${verdict.driftWindow.days} 个交易日）</div>`)
    }
    w(`</div>`)
    for (const g of verdict.drift) {
      w(`<div style="margin-bottom:10px"><b>${esc(g.label)}</b>`)
      for (const it of g.items) {
        const dt = it.delta === null || it.delta === 0 ? ''
          : `<span class="${it.delta > 0 ? 'up' : 'down'}">（${it.delta > 0 ? '+' : ''}${
            it.from.endsWith('%') ? `${(it.delta * 100).toFixed(1)}pct` : it.delta.toFixed(2)
          }）</span>`
        w(`<div class=chg><span class=who>${esc(it.key)} · ${esc(it.field)}</span>`)
        w(`<span class=miss>${esc(it.from)}</span><span>→</span><b>${esc(it.to)}</b>${dt}`)
        w(`${it.monotonic ? '<span class="tag green">单向</span>' : ''}<span class=foot>${it.days}天</span></div>`)
      }
      w(`</div>`)
    }

    w(`<h3 style="font-size:15px;margin:14px 0 6px">七、这套系统答不了的问题（附实测依据）</h3>`)
    w(`<div class=foot>把答不了的问题明确列出来，本身是结论的一部分 —— 否则读者会默认"没说不能，就是能"。</div>`)
    for (const c of verdict.cannotAnswer) {
      w(`<div style="margin:8px 0"><b>问：${esc(c.question)}</b>`)
      w(`<div class=foot style="padding-left:14px">答：${esc(c.why)}</div></div>`)
    }
  }

  // ── 今日市场状态 ──
  w(`</div><div class=card><h2>今日市场状态</h2>`)
  for (const [k, v] of [
    ['主线', h.mainline], ['结构', h.structure], ['核心', h.core], ['深化', h.deepening],
    ['切换', h.switching], ['行动', h.action], ['数据完整度', h.dataCompleteness],
    ['今日最值得研究', h.mostWorthResearching],
  ] as [string, string][]) {
    w(`<div class=kv><span class=k>${esc(k)}</span><span>${esc(v)}</span></div>`)
  }
  w(`</div>`)

  // 「外围现金 —— 口径待战略层裁定」区块已于 2026-08-15 删除。
  // 那 200 万现在是组合总资产的组成部分、也是一切上限的分母，
  // 已显示在置顶仪表盘里。留着一个说"当前未纳入分母"的区块，
  // 会与仪表盘直接矛盾 —— 而两个互相矛盾的说法同屏，比只有错的那个更糟。

  // ── 今日变化 ──
  w(`<div class=card><h2>今日变化 —— 谁正在发生变化？</h2>`)
  if (!prevDate) {
    w(`<div class="banner info">首次建立快照，无可比较基准。明日起本区显示逐项变化。</div>`)
  } else if (!changes.length) {
    w(`<div class="banner ok">对比 ${esc(prevDate)}：无变化。这不是故障 —— 多数交易日大部分读数确实不变。</div>`)
  } else {
    w(`<div class=sec style="margin-bottom:8px">对比 ${esc(prevDate)}，共 ${changes.length} 项变化</div>`)
    const SCOPE: Record<string, string> = {
      STRUCTURE: '市场结构', HOLDING: '持仓', MAINLINE: '主线', NODE: '产业节点', NEXT_LAYER: '下一观察层',
    }
    for (const scope of ['STRUCTURE', 'HOLDING', 'MAINLINE', 'NODE', 'NEXT_LAYER']) {
      const g = changes.filter(c => c.scope === scope)
      if (!g.length) continue
      w(`<div style="margin-bottom:10px"><b>${esc(SCOPE[scope])}</b>`)
      for (const c of g) {
        // delta===0 表示变的是文案而非数值，印出来会误导，故与 CLI 渲染器一致地省略
        const isPct = c.from.endsWith('%') && c.to.endsWith('%')
        const dt = c.delta === null || c.delta === 0 ? ''
          : `<span class="${c.delta > 0 ? 'up' : 'down'}">（${c.delta > 0 ? '+' : ''}${
            isPct ? `${(c.delta * 100).toFixed(1)}pct` : Math.abs(c.delta) >= 1 ? c.delta.toFixed(2) : c.delta.toFixed(3)
          }）</span>`
        w(`<div class=chg><span class=who>${esc(c.key)} · ${esc(c.field)}</span>`)
        w(`<span class=miss>${esc(c.from)}</span><span>→</span><b>${esc(c.to)}</b>${dt}</div>`)
      }
      w(`</div>`)
    }
  }
  w(`<div class=note>闸门跃迁 ${discovery.advances.length} 次；在册观察节点 ${discovery.nodeCount} 个。`)
  if (!discovery.advances.length) w(`尚无跃迁 —— 这本身是信息：没有任何节点在验证链上前进。`)
  w(`</div></div>`)

  // ── 市场结构 ──
  w(`<div class=card><h2>市场结构 —— 切主线，还是打深一层？</h2>`)
  w(`<div class="banner ${ms.kind === 'DEEPENING' ? 'ok' : ms.kind === 'UNKNOWN' ? 'warn' : 'info'}"><b>${esc(ms.headline)}</b></div>`)
  w(`<ul>${ms.evidence.map(e => `<li>${esc(e)}</li>`).join('')}</ul>`)
  w(`<div class=note>主线切换：${esc(ms.switchEvidence)}</div>`)
  w(`<div class=note>⚠ 本判断描述已披露的历史利润分配，不预测价格，且不得产生任何动作。</div></div>`)

  // ── 动作区 ──
  w(`<div class="card act"><h2>动作区（与下面四张研究表严格隔离）</h2>`)
  const block = (title: string, items: { label: string; detail: string }[], cls = '') => {
    w(`<div style="margin-bottom:12px"><b class="${cls}">${esc(title)}</b>`)
    if (!items.length) w(`<div class=sec>无</div>`)
    for (const i of items) {
      w(`<div>▸ ${esc(i.label)}<div class=foot style="padding-left:14px">${esc(i.detail)}</div></div>`)
    }
    w(`</div>`)
  }
  block('必须执行', az.mustExecute, 'up')
  block('允许研究（不是允许买入）', az.allowedResearch)
  block('禁止动作', az.forbidden, 'sec')
  w(`<div><b>今日新增建仓：${az.newEntryCount}</b></div></div>`)

  // ── ① 持仓表 ──
  w(`<div class=card><h2>① 持仓表 —— 我手里的东西发生了什么？</h2><div class=tw><table>`)
  w(`<tr><th>持仓</th><th>仓位</th><th>今日</th><th>5日</th><th>20日</th><th>相对主线</th>`)
  w(`<th>MA20/60</th><th>PE分位</th><th>节点利润份额</th><th>节点内份额</th><th>产业位置</th><th>状态</th><th>法定减仓理由</th></tr>`)
  for (const r of d.holdings) {
    const st = r.status === '超限' ? 'red' : r.status === '观察' ? 'orange' : r.status === '数据不足' ? 'grey' : 'green'
    w(`<tr><td><b>${esc(r.name)}</b></td><td>${pct(r.posPct)}</td><td>${pct(r.ret1, 1, true)}</td>`)
    w(`<td>${pct(r.ret5, 1, true)}</td><td>${pct(r.ret20, 1, true)}</td><td>${pct(r.relMainline, 1, true)}</td>`)
    w(`<td>${r.aboveMa20 === null ? '?' : r.aboveMa20 ? '上' : '下'}/${r.aboveMa60 === null ? '?' : r.aboveMa60 ? '上' : '下'}</td>`)
    w(`<td>${r.peUsable && r.pePercentile !== null
      ? `<span class="${r.pePercentile > 0.8 ? 'up' : ''}">${(r.pePercentile * 100).toFixed(0)}%</span>`
      : '<span class=miss>不可用</span>'}</td>`)
    w(`<td>${arrow(r.nodeShareArrow)}</td><td>${pct(r.shareWithinNode, 0)}</td><td>${esc(r.industryPosition)}</td>`)
    w(`<td><span class="tag ${st}">${esc(r.status)}</span></td>`)
    w(`<td>${r.legalReason ? `<span class=up>${esc(r.legalReason)}</span>` : '<span class=sec>无</span>'}</td></tr>`)
  }
  w(`</table></div>`)
  w(`<div class=note>触发复核项（观察指标，<b>不构成减仓理由</b>）：</div><ul>`)
  for (const r of d.holdings.filter(x => x.reviewTriggers.length)) {
    w(`<li><b>${esc(r.name)}</b>（${r.reviewTriggers.length}项）：${esc(r.reviewTriggers.join('；'))}`)
    w(`<div class=foot>系统动作：${esc(r.systemAction)}</div></li>`)
  }
  w(`</ul></div>`)

  // ── ② 主线表 ──
  w(`<div class=card><h2>② 主线表 —— 市场现在在哪？有没有切换？</h2><div class=tw><table>`)
  w(`<tr><th>主线</th><th>趋势</th><th>相对强度</th><th>成交/资金代理</th><th>利润结构</th>`)
  w(`<th>龙头状态</th><th>数据完整度</th><th>当前判断</th></tr>`)
  for (const m of d.mainlines) {
    const c = m.completeness
    const tag = c === null ? '<span class="tag grey">缺失</span>'
      : m.judgable
        ? `<span class="tag ${c >= 0.6 ? 'green' : 'orange'}">${(c * 100).toFixed(0)}%</span>`
        : `<span class="tag red">${(c * 100).toFixed(0)}% · 不可用于机会判断</span>`
    w(`<tr><td><b>${esc(m.name)}</b></td><td>${arrow(m.trend)}</td><td>${arrow(m.relStrength)}</td>`)
    w(`<td>${arrow(m.volumeProxy)}</td><td>${arrow(m.profitStructure)}</td><td>${esc(m.leaderStatus)}</td>`)
    w(`<td>${tag}</td><td class="${m.judgable ? '' : 'up'}" style="white-space:normal">${m.judgable ? '' : '⚠ '}${esc(m.verdict)}</td></tr>`)
  }
  w(`</table></div>`)
  w(`<div class=note>「成交/资金代理」是成交额比值，<b>不是真实资金流</b>。「不可判断」是合法输出：数据完整度不足的主线，即使价格在涨也不得输出主线强弱结论。本表不输出主线综合评分。</div></div>`)

  // ── ③ 产业结构表 ──
  w(`<div class=card><h2>③ 产业结构表 —— 主线内部的钱在哪里？</h2>`)
  for (const [mlId, rows] of Object.entries(d.nodeStructure)) {
    const ml = d.mainlines.find(m => m.mainlineId === mlId)
    w(`<div style="margin-bottom:14px"><b>${esc(ml?.name ?? mlId)}</b>`)
    w(ml?.completeness == null ? ' <span class="tag grey">完整度缺失</span>'
      : ml.judgable ? ` <span class="tag green">完整度 ${(ml.completeness * 100).toFixed(0)}%</span>`
        : ` <span class="tag red">完整度 ${(ml.completeness * 100).toFixed(0)}% · 不可用于机会判断</span>`)
    w(`<div class=tw><table style="margin-top:6px"><tr><th>节点</th><th>A 利润规模</th><th>B 存量份额</th><th>C 四季变化</th>`)
    w(`<th>节点内领先公司</th><th>方向</th><th>数据滞后</th><th>覆盖</th></tr>`)
    for (const r of rows) {
      const leaders = r.leaders.length
        ? r.leaders.map(l => `${esc(l.name)}${l.shareWithinNode === null ? '' : ` ${(l.shareWithinNode * 100).toFixed(0)}%`}`).join('、')
        : '<span class=miss>无在册标的</span>'
      w(`<tr><td>${esc(r.node)}</td><td>${yi(r.npLevel)}</td><td>${pct(r.levelShare)}</td><td>${pp(r.delta4Q)}</td>`)
      w(`<td>${leaders}</td><td>${arrow(r.direction)}</td>`)
      w(`<td>${r.maxReportAgeDays === null ? '<span class=miss>缺失</span>'
        : `<span class="${r.maxReportAgeDays > 120 ? 'down' : ''}">${r.maxReportAgeDays}天</span>`}</td>`)
      w(`<td><span class="tag ${r.researchOnly ? 'grey' : ''}">${r.researchOnly ? '仅研究域' : '决策域'}</span></td></tr>`)
    }
    w(`</table></div></div>`)
  }
  w(`<div class=note>三个变量必须同时看：A 规模答"创造了多少钱"，B 份额答"钱现在在哪里"，C 变化答"份额往哪走"。单看任何一个都会误导 —— 同比 +1153% 的节点，份额可能只有 1.4%。</div></div>`)

  // ── ④ 下一观察层 ──
  w(`<div class=card><h2>④ 下一观察层 —— 接下来应该盯谁？<span class="tag orange">发现 ≠ 候选 ≠ 买入</span></h2><div class=tw><table>`)
  w(`<tr><th>节点</th><th>产业</th><th>利润</th><th>节点份额</th><th>资金</th><th>相对强度</th>`)
  w(`<th>估值</th><th>证据</th><th>S0/S1/S2/S3/资金</th><th>阶段</th><th>动作</th></tr>`)
  for (const r of d.nextLayer) {
    const g = r.gates
    w(`<tr><td>${esc(r.node)}</td><td>${arrow(r.industryTrend)}</td><td>${arrow(r.profitTrend)}</td>`)
    w(`<td>${pct(r.nodeShare)}</td><td>${arrow(r.money)}</td><td>${arrow(r.relStrength)}</td>`)
    w(`<td>${esc(r.valuation)}</td><td>${esc(r.evidenceTier)}</td>`)
    w(`<td>${gate(g.s0Discovered)} ${gate(g.s1Industry)} ${gate(g.s2Earnings)} ${gate(g.s3Valuation)} ${gate(g.moneyRadar)}</td>`)
    w(`<td><span class="tag ${r.stage === '观察' ? 'orange' : 'grey'}">${esc(r.stage)}</span>`)
    w(r.members.length === 0 ? ' <span class="tag grey">无在册标的</span>'
      : r.strategyAllows ? '' : ' <span class="tag red">战略层不允许</span>')
    w(`</td><td class=up>❌</td></tr>`)
  }
  w(`</table></div><div class=note>阶段词只有「观察」「研究」两级 —— 「候选」以上须 S0–S3 全通过，当前无一满足。「资金」列恒为 ? （真实资金流免费源不可得，不用价格代理冒充资金验证）。</div>`)
  w(`<div class=note>逐节点阻断项：</div><ul>`)
  for (const r of d.nextLayer.filter(x => x.stage === '观察')) {
    w(`<li><b>${esc(r.node)}</b>${r.members.length ? `（${esc(r.members.map(m => m.name).join('、'))}）` : ''}：${esc(r.actionBlockedBy.join('；'))}</li>`)
  }
  w(`</ul></div>`)

  // ── 外部叙事台账 ──
  // 与四张研究表并列，不进动作区。它回答的是"这条证据到底证明了什么"，
  // 而不是"该不该买"。
  if (hypotheses && hypotheses.length) {
    w(`</div><div class=card><h2>外部叙事台账 —— 这条证据到底证明了什么？</h2>`)
    w(`<div class=foot style="margin-bottom:10px">本区不打分、不排序、不产生候选、不产生动作。`)
    w(`证据等级恒为 OBSERVATION。取数原则：能公开验证的绝不列为付费缺口；`)
    w(`只有公开披露无法完成归因时，才进入付费/人工缺口。</div>`)
    for (const hy of hypotheses) {
      w(`<div class="banner info"><b>${esc(hy.id)}｜${esc(hy.node)}</b>`)
      w(`<span class="tag grey">${esc(hy.mainline)}</span>`)
      w(`<div class=foot>原始主张：${esc(hy.claim)}</div>`)
      w(`<div class=foot>来源：${esc(hy.source)}　登记于 ${esc(hy.loggedOn)}</div></div>`)

      // 四句话结论置顶：委员会明确不想再从指标表里自己提炼
      const fv = fourLineVerdict(hy)
      w(`<div class="banner warn"><b>机器结论（四句话）</b><ol style="margin:6px 0;padding-left:20px">`)
      for (const line of [fv.currentFact, fv.aiAsDriver, fv.superCycle, fv.candidacy]) {
        w(`<li style="font-size:12.5px;line-height:1.8">${esc(line)}</li>`)
      }
      w(`</ol></div>`)

      // 因果强度六层：防止把"行业事实→公司事实→因果→持续性→投资资格"压缩成一句看多
      w(`<div class=sec style="margin:12px 0 6px">因果强度六层`)
      w(`<span class=foot>（上一层成立不推出下一层）</span></div>`)
      w(`<div class=tw><table><thead><tr><th>层级</th><th>能证明什么</th>`)
      w(`<th>状态</th><th>依据</th></tr></thead><tbody>`)
      for (const c of causalLayers(hy, hy.peer)) {
        const bad = c.status === 'VETOED' || c.status === 'NOT_PROVEN'
        w(`<tr><td>${c.level}. ${esc(c.name)}</td><td>${esc(c.proves)}</td>`)
        w(`<td class="${c.status === 'CONFIRMED' ? 'up' : bad ? 'down' : 'miss'}">`)
        w(`${esc(CAUSAL_STATUS_TEXT[c.status])}</td>`)
        w(`<td class=foot>${esc(c.basis)}</td></tr>`)
      }
      w(`</tbody></table></div>`)

      // 待核验异常单列：它们是事实，但在解释完成前不构成因果证据
      const pv = pendingVerification(hy)
      if (pv.length) {
        w(`<div class="banner warn" style="margin-top:12px">`)
        w(`<b>待核验异常（${pv.length} 项）</b>`)
        w(`<div class=foot>这些读数是事实，但在解释完成之前不构成因果证据，`)
        w(`故不计入任何命题的兑现数。</div></div>`)
        for (const ind of pv) {
          w(`<div style="margin-bottom:10px"><b>? ${esc(ind.text)}</b>`)
          w(`<div class=foot>${esc(ind.evidence)}</div><ul>`)
          for (const c of ind.verifyChecklist ?? []) w(`<li class=foot>□ ${esc(c)}</li>`)
          w(`</ul></div>`)
        }
      }

      // 验证链：停在最早一个未完成的步骤
      w(`<div class=sec style="margin:10px 0 6px">验证链`)
      w(`<span class=foot>（停在最早一个未完成的步骤，不是最晚一个已完成的）</span></div>`)
      w(`<div class=chain>`)
      for (const st of VERIFICATION_CHAIN) {
        const cur = st.no === hy.stage
        w(`<span class="step${cur ? ' now' : ''}">${st.no}. ${esc(st.name)}</span>`)
        if (st.no < VERIFICATION_CHAIN.length) w(`<span class=arrow>→</span>`)
      }
      w(`</div>`)
      for (const st of VERIFICATION_CHAIN) {
        const cur = st.no === hy.stage
        w(`<div class=foot>${cur ? '▶ ' : '　'}${st.no}. ${esc(st.name)}`)
        w(`　<span class=miss>${esc(SOURCE_TIER_TEXT[st.source])}</span>`)
        if (cur) w(`<div style="padding-left:16px">问的是：${esc(st.asks)}</div>`)
        w(`</div>`)
      }

      for (const pr of hy.propositions) {
        const isFact = pr.horizon === 'CURRENT_FACT'
        w(`<div class="banner ${isFact ? 'ok' : 'grey'}" style="margin-top:12px">`)
        w(`<b>命题 ${esc(pr.id)}：${esc(pr.claim)}</b>`)
        w(`<div class=foot>性质：${isFact
          ? '当前事实 · 可被单期数据证实或证伪'
          : '未来假设 · 任何单期数据都不能证明，须逐季累积'}`)
        w(`　判定：<b>${esc(pr.verdictText)}</b>`)
        w(`（${pr.indicators.filter(i => i.status === 'MET').length}/${pr.indicators.length} 兑现）`)
        w(`</div></div><ul>`)
        for (const ind of pr.indicators) {
          const mk = ind.status === 'MET' ? '✓' : ind.status === 'REFUTED' ? '✗' : '·'
          const cls = ind.status === 'MET' ? 'up' : ind.status === 'REFUTED' ? 'down' : 'miss'
          w(`<li><span class=${cls}>${mk}</span> ${esc(pr.id)}-${ind.no}. ${esc(ind.text)}`)
          w(`<div class=foot>取数：${esc(SOURCE_TIER_TEXT[ind.sourceTier])}</div>`)
          w(`<div class=foot>${esc(ind.evidence)}</div></li>`)
        }
        w(`</ul>`)
      }

      // 付费缺口与"尚未接入"必须分区 —— 混在一起就会用"要买数据"掩盖"还没做"
      const pg = paidGaps(hy)
      const wb = wiringBacklog(hy)
      w(`<div class=sec style="margin:10px 0 6px">付费数据缺口（${pg.length} 项）`)
      w(`<span class=foot>只有走完公开优先各层仍无法回答的才列入</span></div><ul>`)
      for (const ind of pg) w(`<li>${esc(ind.text)}</li>`)
      if (!pg.length) w(`<li class=miss>无</li>`)
      w(`</ul>`)
      w(`<div class=sec style="margin:10px 0 6px">公开可得但尚未接入（${wb.length} 项）`)
      w(`<span class=foot>这些是工作量，不是缺口 —— 不得用"要买数据"掩盖"还没做"</span></div><ul>`)
      for (const ind of wb) w(`<li>${esc(ind.text)}</li>`)
      if (!wb.length) w(`<li class=miss>无</li>`)
      w(`</ul>`)

      w(`<div class=sec style="margin:10px 0 6px">本条成立也不意味着</div><ul>`)
      for (const dn of hy.doesNotImply) w(`<li>${esc(dn)}</li>`)
      w(`</ul>`)
      w(`<div class=sec style="margin:10px 0 6px">阻塞项</div><ul>`)
      for (const bl of hy.blockers) w(`<li>${esc(bl)}</li>`)
      w(`</ul>`)
    }
  }

  if (powerChain) {
    w(`</div><div class=card><h2>电力主线价值传导图 —— 研究资本开支周期，不是买电力股</h2>`)
    w(`<pre class=plain>${esc(renderPowerChain())}</pre>`)
  }

  if (portfolioDefense) {
    w(`</div><div class=card><h2>组合防守层 —— 资产配置审计，不是新的选股系统</h2>`)
    w(`<pre class=plain>${esc(renderPortfolioDefense())}</pre>`)
  }

  if (ownershipPhilosophy) {
    w(`</div><div class=card><h2>投资哲学参考 —— 长期验证 Ownership，不增加规则</h2>`)
    w(`<pre class=plain>${esc(renderOwnershipPhilosophy())}</pre>`)
  }

  // ── 数据缺口 ──
  w(`<div class=card><h2>数据缺口 —— 不知道，本身就是信息</h2><ul>`)
  for (const g of d.dataGaps) w(`<li>${esc(g)}</li>`)
  w(`</ul><div class=note>${esc(d.noCompositeScoreNote)}</div></div>`)

  w(`<div class=foot style="text-align:center;padding:8px 0 24px">`)
  w(`本系统不预测涨跌。未经样本外检验的模型只作观察指标，不得产生动作。`)
  w(`</div></div></body></html>`)
  return P.join('\n')
}
