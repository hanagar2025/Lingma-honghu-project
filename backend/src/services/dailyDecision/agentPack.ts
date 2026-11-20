/**
 * 给其他 Agent 的数据包：执行单网页上「一键复制给 Agent」复制的就是这一份，
 * 同一份也发布为 agent.md，Agent 能联网时直接读这个地址。
 *
 * 读者须知必须放在最前面：外部模型常只读前半段，且看不到运行时刻与本系统的边界。
 * 执行单含股数与总资产，须知里如实写明。
 */

import { renderCardPage } from './html'

/** share/decision/latest.json：站点任务据此重排首页，不必从 Markdown 里猜标题与红绿。 */
export interface CardMeta {
  title: string
  ok: boolean
  generatedAt: string
}

export function renderSitePage(card: string, meta: CardMeta, siteUrl?: string): string {
  const base = siteUrl?.replace(/\/?$/, '/')
  return renderCardPage(card, {
    ok: meta.ok, title: meta.title, generatedAt: meta.generatedAt,
    agentText: buildAgentPack({ card, generatedAt: meta.generatedAt, siteUrl }),
    agentHref: base ? `${base}agent.md` : undefined,
  })
}

export interface AgentPackInput {
  /** 执行单全文（含核对明细） */
  card: string
  generatedAt: string
  siteUrl?: string
}

/** 嵌进数据包的执行单自带一、二级标题，整体下沉两级，免得和数据包的标题同级。 */
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
    '1. 下面是委员会的下单计划，不是成交记录；是否成交只以券商成交回报和持仓截图为准。',
    '2. 执行单已按冻结规则算好。可以核对计算，不要改阈值、不要建议推迟或跳过执行；研究结论不能作为推迟执行的理由。',
    '3. 不预测涨跌。买入只通过分段重建计划，执行单不产生买入。',
    '4. 隐私：执行单含股数、现金与总资产，不要转发到公开场合。',
    '',
    '---',
    '',
    '## 执行单（含两源核对明细）',
    '',
    demoteHeadings(p.card.trim()),
    '',
  ]
  return L.join('\n')
}
