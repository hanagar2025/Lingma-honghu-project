/**
 * 给其他 Agent 的数据包：执行单网页上「一键复制给 Agent」复制的就是这一份，
 * 同一份也发布为 agent.md，Agent 能联网时直接读这个地址。
 *
 * 读者须知必须放在最前面：外部模型常只读前半段，且看不到运行时刻与本系统的边界。
 * 驾驶舱摘要沿用 cockpit/share.ts 的脱敏版；执行单本身含股数与总资产，须知里如实写明，
 * 不能让「摘要已脱敏」被误读成整包已脱敏。
 */

import { renderCardPage } from './html'

/** share/decision/latest.json：站点任务据此重排首页，不必从 Markdown 里猜标题与红绿。 */
export interface CardMeta {
  title: string
  ok: boolean
  generatedAt: string
}

/** 执行单首页。brief 为 null 时数据包只含执行单（决策任务先出这一版，站点任务补上摘要后覆盖）。 */
export function renderSitePage(card: string, meta: CardMeta, brief: string | null, siteUrl?: string): string {
  const base = siteUrl?.replace(/\/?$/, '/')
  return renderCardPage(card, {
    ok: meta.ok, title: meta.title, generatedAt: meta.generatedAt, cockpitHref: 'cockpit.html',
    agentText: buildAgentPack({ card, brief, generatedAt: meta.generatedAt, siteUrl }),
    agentHref: base ? `${base}agent.md` : undefined,
  })
}

export interface AgentPackInput {
  /** 执行单全文（含核对明细） */
  card: string
  /** 驾驶舱外发摘要（buildBrief 的产物）；生成失败时为 null */
  brief: string | null
  generatedAt: string
  siteUrl?: string
}

/** 嵌进数据包的两份文档自带一、二级标题，整体下沉两级，免得和数据包的分部标题同级。 */
export function demoteHeadings(md: string, by = 2): string {
  let fence = false
  return md.split('\n').map(line => {
    if (/^\s*```/.test(line)) fence = !fence
    if (fence) return line
    const m = /^(#{1,6})(\s.*)$/.exec(line)
    return m ? `${'#'.repeat(Math.min(6, m[1]!.length + by))}${m[2]}` : line
  }).join('\n')
}

export function buildAgentPack(p: AgentPackInput): string {
  const base = p.siteUrl?.replace(/\/?$/, '/')
  const L = [
    '# 纪律执行官 · 给 Agent 的数据包',
    '',
    `生成于 ${p.generatedAt}（北京时间）${base ? `；网页 ${base}；纯文本 ${base}agent.md` : ''}`,
    '',
    '## 读者须知（先读）',
    '',
    '1. 第一部分是委员会的下单计划，不是成交记录；是否成交只以券商成交回报和持仓截图为准。',
    '2. 执行单已按冻结规则算好。可以核对计算，不要改阈值、不要建议推迟或跳过执行；研究结论不能作为推迟执行的理由。',
    '3. 不预测涨跌。观察类指标只供参考，不产生买卖动作；「不可判断」是合法结论。',
    '4. 隐私：第一部分含股数、现金与总资产；第二部分驾驶舱摘要已脱敏（无金额、无股数）。',
    '',
    '---',
    '',
    '## 第一部分：执行单（含两源核对明细）',
    '',
    demoteHeadings(p.card.trim()),
    '',
    '---',
    '',
    '## 第二部分：驾驶舱摘要',
    '',
    p.brief ? demoteHeadings(p.brief.trim()) : '本次驾驶舱摘要没有生成，只有第一部分可用。',
    '',
  ]
  return L.join('\n')
}
