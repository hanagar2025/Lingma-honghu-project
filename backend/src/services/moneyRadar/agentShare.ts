/**
 * 资金驾驶舱（R-01）· 给其他 Agent 读的同一份结果
 *
 * 人看网页驾驶舱；模型读 data/money.agent.md 这个稳定链接。
 * 内容和网页是同一份已经算好的数据，没有给人看的装饰。
 * 开头的约束不要删：它们是这套数据已经排除掉的错误推论。
 */

import { ENTRY_TEXT } from './types'
import type { MoneyCockpitView, ObjectView } from './radar'

const pct = (v: number | null | undefined, d = 1) =>
  v === null || v === undefined ? 'NA' : `${v > 0 ? '+' : ''}${(v * 100).toFixed(d)}%`
const yi = (v: number | null | undefined, d = 1) =>
  v === null || v === undefined ? 'NA' : `${v > 0 ? '+' : ''}${v.toFixed(d)}`
const num = (v: number | null | undefined, d = 1) => (v === null || v === undefined ? 'NA' : v.toFixed(d))

function row(o: ObjectView): string {
  const a2 = o.a2
  return `| ${o.name} | ${o.id} | ${o.state ?? 'NA'} ${o.stateText} | ${o.stateSince ?? 'NA'} | ${o.stateDays ?? 'NA'} | ${o.stateLongestDays ?? 'NA'} `
    + `| ${num(o.level20Yi, 2)} | ${num(o.base20Yi, 2)} | ${yi(o.excessDailyYi, 2)} `
    + `| ${o.persist ?? 'NA'} | ${o.maxPersistBefore ?? 'NA'} | ${pct(o.dev5)} | ${pct(o.ret20)} `
    + `| ${yi(a2.marginDelta10Yi, 2)} | ${yi(a2.instNet10Yi, 2)} | ${o.divergence ?? 'NA'} | ${o.standing ?? '-'} |`
}

/** 已知偏差：不改变算法，但限定结论的解释力度 */
export const KNOWN_BIASES: readonly string[] = [
  '当前成分回看历史（current-constituent backtest）：行业用今天的申万二级成分回看过去，新股上市前按 0 计，没有按历史成分逐日调整；样本外结论不等于"当时可交易的行业篮子"的回测，带幸存者 / 成分变更偏差',
  'A2 方向性数据只有融资余额（行业、个股）与少数 ETF 份额（篮子、国家队）；融资偏杠杆资金，不代表全部主动资金；"确认"只说明两端融资方向一致',
  '样本外与时效检验只覆盖 2023-06 以来，基本是同一种市场环境，未经历完整牛熊',
  '前复权价在除权后会整体重排历史；收益计算用前复权、规模与交叉核对用不复权',
  '深市个股历史成交额只有腾讯一个来源（当日值已与新浪逐只核对）；深市 ETF 份额历史从 2026-09-23 起积累',
]

const HEAD = '| 名称 | id | 状态 | 状态起始 | 状态天数 | 该状态此前最长(日) | 20日均成交额(亿/日) | 水位(亿/日) | 日均超额(亿/日) | 高于水位连续(日) | 高于水位此前最长(日) | 5日偏离 | 20日涨幅 | 融资10日变化(亿) | 机构10日净买(亿) | 背离 | 在册 |'
const SEP = '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|'

export function buildMoneyAgentShare(v: MoneyCockpitView, opts: { intraday?: boolean; commit?: string } = {}): string {
  const L: string[] = []
  const w = (s = '') => L.push(s)
  const cal = v.calibration as any
  const sh = v.shadow as any

  w('---')
  w('product: 鸿鹄理财')
  w('kind: money-agent-share')
  w('audience: machine')
  w(`module: ${v.id} ${v.title}`)
  w(`date: ${v.asOf ?? 'NA'}`)
  w(`intraday: ${opts.intraday ? 'true' : 'false'}`)
  w(`data_mode: ${v.dataMode}`)
  w(`thresholds: ${v.thresholds.status} registered=${v.thresholds.registeredOn}${cal ? ` hash=${cal.thresholdsHash}` : ''}`)
  w(`commit: ${opts.commit ?? 'unknown'}`)
  w('full_json: data/money.json')
  w('---')
  w('')
  w('# 约束（不要删）')
  w('- 这是观察层（OBSERVATION）。不要给出买卖时点建议；本数据最高只决定"先复核谁"。')
  w('- 成交额是流量且没有方向：每一笔成交同时有买方和卖方。不要把"份额上升"说成"净流入"。有方向的只有融资余额与 ETF 份额（T+1 发布）。')
  w('- 数据里没有"主力净流入 / 大单"这类软件估算值，也不要从别处补进来。')
  w('- "资金池 / 资金量"指 20 日日均成交额（亿元/日）对比其 250 日水位，不是存量。')
  w('- EXHAUST（中文"高成交·价格停滞"，旧称"衰竭"）只表示成交额仍高、价格推进不足。样本外之后 60 日平均跑赢基准，与"见顶"预期相反。不要把它当卖出信号，也不要写成"资金衰竭 / 资金撤退"。')
  w('- 证据等级锁定：只有 TREND 有样本外支持（可提高人工复核优先级）；START / BURST / RETREAT / FAILED_START 无显著效果，DIVERGENCE 样本不足，EXHAUST 与预期相反。不要把它们说成启动信号、拥挤预警或下跌预警。')
  w('- "20日均成交额"不是资金流入；"成交额份额迁移"说的是成交额结构变化，不是净资金从 A 流向 B。迁移的证据等级看两端 A2 净方向（CONFIRMED / CONFLICT / INFERRED）。')
  if ((v.crossCheck as any)?.status === 'FAIL') {
    w('- 今日第二数据源交叉核对不通过：主数据与新浪行情不一致超过阈值。先看"第二数据源交叉核对"一节，不要在核对不通过的数据上下结论。')
  }
  const ll = v.leadlag as any
  if (ll) {
    w(`- 时效检验（${ll.runOn}）：${ll.verdict}资金信号主要跟着价格走；横截面上资金越热之后 20 日反而略弱；大盘成交额与融资余额没有择时能力。不要把"放量 / 融资增加 / ETF 申购 / 基金加仓"解读为"之后会涨"。`)
  }
  w('- 不要输出综合评分、总分或排名。"不可判断"是合法结论，数据不足时不要补一个答案。')
  w('- 你的任务：找矛盾、验算术、指出证据不足、提出需要补的数据，并说明你的推论依赖哪几行数据。')
  w('')

  const al = v.alerts as any
  if (al) {
    w('# 今日提醒（累计变化，一对象一条；只决定先复核谁）')
    for (const a of al.anomalies ?? []) w(`- [数据异常] ${a.text}`)
    const cards = (al.cards ?? []) as any[]
    const line = (c: any) => {
      const ev = ({ NEW: '新增', UP: '升级', DOWN: '降级', CONTINUE: '持续', RESOLVED: '解除' } as Record<string, string>)[c.event]
      const cat = ({ RISK: '风险', OPP: '机会', NOTE: '注意', DATA: '数据' } as Record<string, string>)[c.category]
      const lv = ({ 1: '关注', 2: '警示', 3: '重大' } as Record<number, string>)[c.level]
      const tags = c.tags?.length ? `｜另：${c.tags.map((x: any) => x.text).join('、')}` : ''
      return `- [${cat}·${lv}] ${c.name}（${c.objectId}，入口${c.entry ?? '-'}）：${c.title}。${c.detail}。第 ${c.days} 天（${ev}，自 ${c.firstDate}）｜证据：${c.evidence}${tags}`
    }
    w('## 持仓（入口①）')
    const left = cards.filter(c => c.column === 'LEFT')
    if (!left.length) w('无')
    for (const c of left) w(line(c))
    w('## 观察仓与市场（入口② ③）')
    const right = cards.filter(c => c.column === 'RIGHT')
    if (!right.length) w('无')
    for (const c of right) w(line(c))
    if (al.resolvedToday?.length) {
      w('## 今日解除')
      for (const r of al.resolvedToday) w(`- ${r.name}：${r.text}`)
    }
    if (al.tempPool?.length) {
      w('## 临时观察池（市场新方向自动加入，20 日无提醒自动移出）')
      for (const p of al.tempPool) w(`- ${p.name}：${p.joined} 起，最近一次提醒 ${p.lastAlert}；核心股 ${p.leaders.join('、')}`)
    }
    const d = al.digest
    if (d) {
      w(`## 近 5 日：新增 ${d.days5.newCount}、升级 ${d.days5.upCount}、解除 ${d.days5.resolvedCount}；近 20 日：新增 ${d.days20.newCount}、升级 ${d.days20.upCount}、解除 ${d.days20.resolvedCount}`)
    }
    w('')
  }

  const cc = v.crossCheck as any
  if (cc) {
    w(`# 第二数据源交叉核对（${cc.asOf}）：${cc.status} ${cc.statusText}`)
    for (const s of cc.sources) w(`- ${s}`)
    const t = cc.today
    if (t) {
      w(`- 当日全量：${t.checked} 只双方都有当日数据；收盘价不一致 ${t.closeMismatch}，成交额不一致 ${t.amountMismatch}；新浪当日无数据 ${t.secondMissing}（多为停牌）`)
      w(`- 两市总成交额：腾讯 ${num(t.market.primary === null ? null : t.market.primary / 1e8, 2)} 亿，新浪 ${num(t.market.second === null ? null : t.market.second / 1e8, 2)} 亿，相差 ${t.market.diffPct === null ? 'NA' : `${(t.market.diffPct * 100).toFixed(4)}%`}`)
      for (const m of t.worst ?? []) w(`  - 不一致：${m.name}（${m.code}）${m.field === 'close' ? '收盘价' : '成交额'} 腾讯 ${m.primary} / 新浪 ${m.second}`)
    } else if (cc.todayNote) {
      w(`- 当日：${cc.todayNote}`)
    }
    w('')
    w('| 对象 | 核对来源 | 天数 | 收盘价不一致 | 成交额不一致 | 成交额最大偏差 |')
    w('|---|---|---|---|---|---|')
    for (const h of cc.history) {
      w(`| ${h.name}（${h.code}） | ${h.source} | ${h.days} | ${h.closeMismatch} | ${h.amountMismatch ?? '无成交额'} | ${h.amountMaxRel === null ? 'NA' : `${(h.amountMaxRel * 100).toFixed(4)}%`} |`)
    }
    for (const n of cc.notes) w(`- ${n}`)
    w('')
  }

  w('# 数据口径')
  w('- 两市成交额 = 上证指数 + 深证综指（北交所不计入）。基准收益 = 两者日收益平均。')
  w('- 行业 = 申万 2021 二级，成分来自东方财富行业估值表；按当前成分回看历史。')
  w('- 水位 = 该对象成交额占两市比例的 250 日中位数；水位带 = 25%–75% 分位。')
  w('- 状态：潜伏 / 启动 / 趋势 / 爆发 / 高成交·价格停滞（EXHAUST）/ 撤离；进出阈值不同、最短保持 5 日、连续确认。')
  w('- 字段："状态天数"从状态起始日算；"高于水位连续"是 5 日份额连续高于 250 日中位数的天数，与状态无关，两者口径不同。高于水位连续 > 此前最长 = 创纪录。')
  w('- 精度：20日均成交额、水位、日均超额都按原始精度计算（日均超额 = 20日均成交额 − 水位），表中各自四舍五入到 0.01，所以显示值相减可能差 0.01；状态判定只用原始精度。')
  for (const p of v.provenance) w(`- 来源 ${p.kind}: ${p.source}（截至 ${p.asOf}，${p.status}）`)
  for (const n of v.dataNotes) w(`- 说明：${n}`)
  w('')

  if (v.market) {
    w('# 市场背景')
    w(`- 两市成交额 ${num(v.market.latestYi, 0)} 亿；5 日均值偏离 250 日水位 ${pct(v.market.deviation)}；连续高于水位 ${v.market.daysAbove} 日`)
    w(`- 全市场融资余额 20 日变化 ${yi(v.market.marginDelta20Yi, 0)} 亿`)
    w(`- 国家队宽基 ETF（有份额历史 ${v.nationalTeam.withHistory}/${v.nationalTeam.etfs.length} 只）近 10 日净申赎 ${yi(v.nationalTeam.net10Yi)} 亿；最近一日 ${v.nationalTeam.lastDay ?? 'NA'}。背景层，不是主线信号`)
    w('')
  }

  w('# 复核顺序（按类别，不打分）')
  if (!v.reviewQueue.length) w('无')
  v.reviewQueue.forEach((r, i) => w(`${i + 1}. [${ENTRY_TEXT[r.entry]}] ${r.name}（${r.id}）：${r.text}`))
  w('')

  for (const e of v.entries) {
    const objs = e.entry === 3 ? e.objects.slice(0, 30) : e.objects
    w(`# ${e.title}（${e.objects.length}${e.entry === 3 ? '，列出日均超额前 30' : ''}）`)
    w(e.note)
    w('')
    w(HEAD)
    w(SEP)
    for (const o of objs) w(row(o))
    if (e.entry === 3) {
      const extra = e.objects.slice(30).filter(o => o.reviewClass === 'RETREAT' || o.reviewClass === 'DIVERGENCE')
      for (const o of extra) w(row(o))
    }
    w('')
    const withLeaders = objs.filter(o => o.leaders.length)
    if (withLeaders.length) {
      w(`## ${e.title} · 内部份额（20 日成交额占比，括号为较 20 日前变化）`)
      for (const o of withLeaders.slice(0, e.entry === 3 ? 15 : 10)) {
        const lead = o.leaders.map(l => `${l.name}${(l.share20 * 100).toFixed(1)}%(${l.change20 === null ? 'NA' : `${l.change20 > 0 ? '+' : ''}${(l.change20 * 100).toFixed(1)}pt`},${l.standing})`).join('；')
        const rise = o.risers.map(l => `${l.name}+${((l.change20 ?? 0) * 100).toFixed(1)}pt`).join('；')
        w(`- ${o.name}：前三 ${lead}${rise ? `｜上升最快 ${rise}` : ''}`)
      }
      w('')
    }
  }

  w('# 成交额份额迁移（一出一进持续 ≥10 日；不是净资金流向）')
  w('证据等级：CONFIRMED = 出端 A2 净流出且进端 A2 净流入；CONFLICT = 任一端 A2 方向与迁移相反；INFERRED = 任一端无 A2 数据，仅份额推断。A2 = 融资 10 日变化 + ETF 10 日净申赎（行业只有融资）。')
  if (!v.migrations.length) w('无')
  for (const m of v.migrations) w(`- ${m.from} -> ${m.to}：${m.verdict} ${m.confirmation}（出端 A2 ${yi(m.fromA2Yi)} 亿，进端 A2 ${yi(m.toA2Yi)} 亿）${m.days} 日`)
  w('')

  if (cal) {
    w(`# 样本外检验（${cal.split.outOfSample[0]} ~ ${cal.split.outOfSample[1]}；相对两市基准超额收益；95% 区间按交易日分组抽样）`)
    w(`样本内 ${cal.split.inSample[0]} ~ ${cal.split.inSample[1]} 只检查信号卫生：${cal.hygiene.map((h: any) => `${h.id}${h.pass ? '✓' : '✗'}`).join(' ')}；决定 ${cal.decision}`)
    w('')
    w('| 规则 | 预期 | 期限(日) | 次数 | 均值 | 区间 | 结论 |')
    w('|---|---|---|---|---|---|---|')
    for (const r of cal.outOfSample) {
      w(`| ${r.rule} | ${r.hypothesis} | ${r.horizon} | ${r.n} | ${pct(r.mean, 2)} | ${r.ci ? `[${pct(r.ci[0], 2)}, ${pct(r.ci[1], 2)}]` : 'NA'} | ${r.verdict} |`)
    }
    w('')
  }

  if (ll) {
    w(`# 资金信号时效检验（${ll.period[0]} ~ ${ll.period[1]}；IC = 每日横截面秩相关的均值；未来收益从 T+1 收盘起算）`)
    w(`战术一句话：${ll.verdict}`)
    w('')
    w('| 股票池 | 信号 | 可得时点 | 过去20日IC | 之后20日IC | 区间 | 最强1/5 之后20日 | 最弱1/5 之后20日 | 跟随 | 领先 |')
    w('|---|---|---|---|---|---|---|---|---|---|')
    for (const r of ll.rows as any[]) {
      w(`| ${r.universeText} | ${r.signalText} | ${r.knownAt} | ${num(r.pastIc, 3)} | ${num(r.fwdIc, 3)} | ${r.fwdCi ? `[${num(r.fwdCi[0], 3)}, ${num(r.fwdCi[1], 3)}]` : 'NA'} | ${pct(r.top, 2)} | ${pct(r.bottom, 2)} | ${r.follow} | ${r.lead} |`)
    }
    for (const t of ll.timing as any[]) w(`- 大盘择时 ${t.text}（${t.knownAt}）：与过去 20 日 r=${num(t.past.r, 3)}；与之后 20 日 r=${num(t.fwd.r, 3)}，区间 ${t.fwd.ci ? `[${num(t.fwd.ci[0], 3)}, ${num(t.fwd.ci[1], 3)}]` : 'NA'}；独立样本约 ${t.independent} 段`)
    for (const e of ll.eventDelay as any[]) w(`- 冻结规则 ${e.rule} ${e.horizon} 日：T 日收盘起算 ${pct(e.meanT0, 2)} → T+1 收盘起算 ${pct(e.meanT1, 2)}（${e.verdictT1}）`)
    for (const s of ll.slow as string[]) w(`- 慢钱：${s}`)
    w('')
  }

  const sl = v.slow as any
  if (sl) {
    w(`# 慢钱（钱是谁的；截至 ${sl.asOf}）`)
    for (const n of sl.notes ?? []) w(`- 口径：${n}`)
    w('')
    w('| 指数 | 跟踪ETF数 | 份额截至 | 5日净申赎(亿) | 20日净申赎(亿) | 60日净申赎(亿) | ETF规模(亿) | 20日净申赎/规模 | 指数20日涨幅 | ETF规模/成分总市值 |')
    w('|---|---|---|---|---|---|---|---|---|---|')
    for (const x of sl.indexes as any[]) {
      w(`| ${x.name} | ${x.etfCount} | ${x.asOf ?? 'NA'} | ${yi(x.flow5)} | ${yi(x.flow20)} | ${yi(x.flow60)} | ${num(x.aum, 0)} | ${pct(x.flow20Pct, 2)} | ${pct(x.ret20)} | ${pct(x.aumOfCap)} |`)
    }
    w('')
    w(`| 分组 | 个数 | 基金持股/流通(${sl.holdReport ?? 'NA'}) | 基金持股/流通(${sl.holdReportPrev ?? 'NA'}) | 机构合计/流通 | 股东户数较上期变化中位数 |`)
    w('|---|---|---|---|---|---|')
    for (const g of sl.groups as any[]) {
      w(`| ${g.text} | ${g.size} | ${num(g.fundRatio, 2)}% | ${num(g.fundRatioPrev, 2)}% | ${num(g.instRatio, 2)}% | ${g.holdersChangeMedian === null ? 'NA' : `${num(g.holdersChangeMedian, 2)}%`} |`)
    }
    w('')
    w('| 股票 | 科创系指数权重 | 被动资金20日摊到该股(亿) | 占20日日均成交额 | 基金持股/流通 | 上期 | 机构合计/流通 | 股东户数 | 较上期 | 截止/上期截止/公告 | 户数口径 |')
    w('|---|---|---|---|---|---|---|---|---|---|---|')
    for (const s of sl.stocks as any[]) {
      const iw = s.indexWeights.length ? s.indexWeights.map((x: any) => `${x.name} ${x.weight.toFixed(2)}%`).join('、') : '-'
      w(`| ${s.name}（${s.code}） | ${iw} | ${yi(s.passive20, 2)} | ${pct(s.passiveOfTurnover)} | ${num(s.fundRatio, 2)}% | ${num(s.fundRatioPrev, 2)}% | ${num(s.instRatio, 2)}% | ${s.holders ?? 'NA'} | ${s.holdersChange === null ? 'NA' : `${num(s.holdersChange, 1)}%`} | ${s.holdersEndDate ?? 'NA'}/${s.holdersPrevEndDate ?? 'NA'}/${s.holdersNotice ?? 'NA'} | ${s.holdersBasis === 'LATEST' ? '最近一次披露' : s.holdersBasis === 'QUARTER' ? '季末定期报告' : 'NA'} |`)
    }
    w('')
  }

  if (sh) {
    w(`# 影子运行台账（自 ${sh.startedOn}，累计 ${sh.total} 条；只增不改）`)
    w('| 规则 | 触发 | 已到期20日 | 20日均值 | 距30次 |')
    w('|---|---|---|---|---|')
    for (const r of sh.rows) w(`| ${r.rule} | ${r.count} | ${r.filled20} | ${pct(r.mean20, 2)} | ${r.toVerdict} |`)
    w('')
    for (const e of sh.latest ?? []) w(`- ${e.date} ${e.name}（${e.objectId}）${e.rule}：${e.state}`)
    w('')
  }

  w('# 已知偏差（Known Bias，解读结论时要考虑）')
  for (const b of KNOWN_BIASES) w(`- ${b}`)
  w('')

  w('# 不意味着')
  for (const x of v.doesNotImply) w(`- ${x}`)
  return `${L.join('\n')}\n`
}
