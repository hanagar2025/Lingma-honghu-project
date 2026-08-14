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
import type { Change } from '../governance/changeLog'

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
ul{margin:4px 0;padding-left:20px}
.chg{display:flex;gap:8px;flex-wrap:wrap;align-items:baseline}
.chg .who{min-width:230px;color:var(--sec)}
.foot{font-size:12px;color:var(--sec);margin-top:8px}
.note{font-size:12px;color:var(--sec);margin-top:10px}
`

export interface HtmlInput {
  dashboard: Dashboard
  changes: Change[]
  prevDate: string | null
  discovery: { nodeCount: number; advances: { key: string; date: string; from: number; to: number; gates: string }[] }
  freeze: { baselineHash: string | null; currentHash: string; drifted: boolean; detail: string }
  /** 口径待裁定的外围现金。仅展示，不参与任何上限计算 */
  externalCash?: { amount: number; note: string } | null
  /** 最新K线尚未定价（盘中运行）。为真时全表读数为临时值且未归档 */
  intraday?: boolean
}

export function renderDashboardHtml(input: HtmlInput): string {
  const { dashboard: d, changes, prevDate, discovery, freeze, externalCash, intraday } = input
  const h = d.headline
  const ms = d.marketStructure
  const az = d.actionZone
  const P: string[] = []
  const w = (s: string) => P.push(s)

  w(`<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">`)
  w(`<meta name="viewport" content="width=device-width,initial-scale=1">`)
  w(`<title>五层驾驶舱 ${esc(d.date)}</title><style>${CSS}</style></head><body><div class=wrap>`)

  // ── 头 ──
  w(`<div class=card><h1>五层驾驶舱 · ${esc(d.date)}</h1>`)
  w(`<div class=sec>组合 × 主线 × 产业链 × 新势能 × 执行　|　${esc(d.session === 'PRE_OPEN' ? '盘前' : '盘后')}</div>`)
  if (intraday) {
    w(`<div class="banner warn" style="margin-top:12px"><b>⚠ 盘中快照（未定价）</b>`)
    w(`　最新K线 ${esc(d.date)} 尚未收盘，全表读数为临时值：仓位百分比、相对强度、成交比值都会随收盘变化。`)
    w(`<div class=foot>本次<b>未写入 30 天档案</b>，以免盘中值污染日间序列。盘后 15:10 之后重跑一次才算当日正式读数。</div></div>`)
  }
  w(`<div class="banner ${freeze.drifted ? 'warn' : 'ok'}" style="margin-top:12px">`)
  w(`规则指纹 <b>${esc(freeze.currentHash)}</b>`)
  w(freeze.baselineHash ? `　基线 ${esc(freeze.baselineHash)}　${freeze.drifted ? '⚠ 已漂移' : '✓ 未漂移'}` : '　⚠ 无冻结基线')
  w(`<div class=foot>${esc(freeze.detail)}</div></div>`)

  // ── 今日市场状态 ──
  w(`<h2 style="margin-top:16px">今日市场状态</h2>`)
  for (const [k, v] of [
    ['主线', h.mainline], ['结构', h.structure], ['核心', h.core], ['深化', h.deepening],
    ['切换', h.switching], ['行动', h.action], ['数据完整度', h.dataCompleteness],
    ['今日最值得研究', h.mostWorthResearching],
  ] as [string, string][]) {
    w(`<div class=kv><span class=k>${esc(k)}</span><span>${esc(v)}</span></div>`)
  }
  w(`</div>`)

  // ── 外围现金：口径待裁定 ──
  if (externalCash) {
    w(`<div class=card><h2>外围现金 —— 口径待战略层裁定</h2>`)
    w(`<div class="banner warn"><b>${(externalCash.amount / 10000).toFixed(0)} 万</b>　`)
    w(`<b>当前未纳入仓位上限的分母</b>，故本报告所有仓位百分比仍以证券账户总资产为基数。`)
    w(`<div class=foot>${esc(externalCash.note)}</div></div></div>`)
  }

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
  w(`<div class=card><h2>① 持仓表 —— 我手里的东西发生了什么？</h2><table>`)
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
  w(`</table>`)
  w(`<div class=note>触发复核项（观察指标，<b>不构成减仓理由</b>）：</div><ul>`)
  for (const r of d.holdings.filter(x => x.reviewTriggers.length)) {
    w(`<li><b>${esc(r.name)}</b>（${r.reviewTriggers.length}项）：${esc(r.reviewTriggers.join('；'))}`)
    w(`<div class=foot>系统动作：${esc(r.systemAction)}</div></li>`)
  }
  w(`</ul></div>`)

  // ── ② 主线表 ──
  w(`<div class=card><h2>② 主线表 —— 市场现在在哪？有没有切换？</h2><table>`)
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
  w(`</table>`)
  w(`<div class=note>「成交/资金代理」是成交额比值，<b>不是真实资金流</b>。「不可判断」是合法输出：数据完整度不足的主线，即使价格在涨也不得输出主线强弱结论。本表不输出主线综合评分。</div></div>`)

  // ── ③ 产业结构表 ──
  w(`<div class=card><h2>③ 产业结构表 —— 主线内部的钱在哪里？</h2>`)
  for (const [mlId, rows] of Object.entries(d.nodeStructure)) {
    const ml = d.mainlines.find(m => m.mainlineId === mlId)
    w(`<div style="margin-bottom:14px"><b>${esc(ml?.name ?? mlId)}</b>`)
    w(ml?.completeness == null ? ' <span class="tag grey">完整度缺失</span>'
      : ml.judgable ? ` <span class="tag green">完整度 ${(ml.completeness * 100).toFixed(0)}%</span>`
        : ` <span class="tag red">完整度 ${(ml.completeness * 100).toFixed(0)}% · 不可用于机会判断</span>`)
    w(`<table style="margin-top:6px"><tr><th>节点</th><th>A 利润规模</th><th>B 存量份额</th><th>C 四季变化</th>`)
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
    w(`</table></div>`)
  }
  w(`<div class=note>三个变量必须同时看：A 规模答"创造了多少钱"，B 份额答"钱现在在哪里"，C 变化答"份额往哪走"。单看任何一个都会误导 —— 同比 +1153% 的节点，份额可能只有 1.4%。</div></div>`)

  // ── ④ 下一观察层 ──
  w(`<div class=card><h2>④ 下一观察层 —— 接下来应该盯谁？<span class="tag orange">发现 ≠ 候选 ≠ 买入</span></h2><table>`)
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
  w(`</table><div class=note>阶段词只有「观察」「研究」两级 —— 「候选」以上须 S0–S3 全通过，当前无一满足。「资金」列恒为 ? （真实资金流免费源不可得，不用价格代理冒充资金验证）。</div>`)
  w(`<div class=note>逐节点阻断项：</div><ul>`)
  for (const r of d.nextLayer.filter(x => x.stage === '观察')) {
    w(`<li><b>${esc(r.node)}</b>${r.members.length ? `（${esc(r.members.map(m => m.name).join('、'))}）` : ''}：${esc(r.actionBlockedBy.join('；'))}</li>`)
  }
  w(`</ul></div>`)

  // ── 数据缺口 ──
  w(`<div class=card><h2>数据缺口 —— 不知道，本身就是信息</h2><ul>`)
  for (const g of d.dataGaps) w(`<li>${esc(g)}</li>`)
  w(`</ul><div class=note>${esc(d.noCompositeScoreNote)}</div></div>`)

  w(`<div class=foot style="text-align:center;padding:8px 0 24px">`)
  w(`本系统不预测涨跌。未经样本外检验的模型只作观察指标，不得产生动作。`)
  w(`</div></div></body></html>`)
  return P.join('\n')
}
