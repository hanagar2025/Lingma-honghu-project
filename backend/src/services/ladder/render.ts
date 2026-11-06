/**
 * 名单治理（L-01）· 渲染
 */

import { SCOPE_TEXT, LEVEL_NAME, LEVEL_PERMISSION, PURPOSE_TEXT, TODO_RANK, TODO_TEXT, type LadderEntry, type LadderLevel, type LadderView, type ReviewTodo } from './types'
import { REVIEW_ACTION_TEXT, REVIEW_FINDING_TEXT } from './registry'
import { SOURCES } from './sources'

export interface ExposureRow {
  label: string
  pct: number
  limit: number
  /** 涉及的持仓及各自占总资产 */
  holdings: { code: string; name: string; pct: number }[]
}

export interface RiskBlock {
  /** 价格取数时点 */
  pricedAt: string | null
  sectors: ExposureRow[]
  themes: ExposureRow[]
  note: string
}

const cell = (s: string | null | undefined) => (s ?? '—').replace(/\|/g, '/').replace(/\n/g, ' ')
const pct = (x: number) => `${(x * 100).toFixed(1)}%`

const urgency = (t: ReviewTodo) => (TODO_RANK[t] >= TODO_RANK.DUE_TODAY ? TODO_RANK[t] : 0)

function sourceText(e: LadderEntry): string {
  return e.sources.map(t => `${SOURCES[t.source].label}${t.group ? `·${t.group}` : ''}`).join('；')
}

function table(entries: LadderEntry[], level: LadderLevel): string[] {
  const L: string[] = []
  if (!entries.length) {
    L.push('（无）', '')
    return L
  }
  if (level === 6) {
    L.push('| 代码 | 名称 | 主线 · 节点 | 证据 | 冠军池 | 来源 | 退出条件 | 提示 |', '|---|---|---|---|---|---|---|---|')
    for (const e of entries) {
      L.push(`| ${e.code} | ${e.name} | ${cell(e.mainline)} · ${cell(e.node)} | ${cell(e.evidence)} | ${e.champion ? '是' : '否'} | ${cell(sourceText(e))} | ${cell(e.exitCondition)} | ${cell([...e.flags, ...e.locks].join('；') || '—')} |`)
    }
  } else if (level === 3 || level === 4) {
    L.push('| 代码 | 名称 | 战略归属 | 证据 | 观察计划 | 复核期限 | 产业证据 / 盈利核验 / 主线归因 | 停在本级的原因 | 权限锁 | 来源 |', '|---|---|---|---|---|---|---|---|---|---|')
    for (const e of entries) {
      const plans = e.plans.map(p => `${PURPOSE_TEXT[p.purpose]}（${p.reviewBy}）`).join('；')
      const g = ['INDUSTRY', 'EARNINGS', 'ATTRIBUTION'].map(id => {
        const x = e.gates.find(gg => gg.id === id)
        return x ? (x.pass ? '✓' : '✗') : '—'
      }).join(' / ')
      const due = e.reviewBy ? `${e.reviewBy}（${e.reviewTodo ? TODO_TEXT[e.reviewTodo] : '—'}）` : '—'
      L.push(`| ${e.code} | ${e.name} | ${SCOPE_TEXT[e.scope]} | ${cell(e.evidence)} | ${cell(plans)} | ${due} | ${g} | ${cell(e.ceiling)} | ${cell(e.locks.join('；') || '—')} | ${cell(sourceText(e))} |`)
    }
  } else {
    L.push('| 代码 | 名称 | 战略归属 | 节点 / 分组 | 证据 | 研究问题 | 停在本级的原因 | 权限锁 | 来源 |', '|---|---|---|---|---|---|---|---|---|')
    for (const e of entries) {
      L.push(`| ${e.code} | ${e.name} | ${SCOPE_TEXT[e.scope]} | ${cell(e.node)} | ${cell(e.evidence)} | ${cell(e.researchQuestion)} | ${cell(e.ceiling)} | ${cell(e.locks.join('；') || '—')} | ${cell(sourceText(e))} |`)
    }
  }
  L.push('')
  return L
}

export function renderLadder(v: LadderView, risk: RiskBlock | null): string {
  const L: string[] = []
  L.push(`# 名单主表 L-01（${v.asOf}）`, '')
  L.push('> 只观察，不产生动作。研究资格、买入资格、持仓资格是三种不同的权限：观察信号再强，也不能越级变成买入信号。')
  L.push('> 每只股票只有一个当前层级；层级由条件逐级计算，名单来源不授予层级。', '')

  L.push('## 一、买入权限', '')
  L.push(v.buyPermission.open ? '买入权限：开放（第 5 级只能申请，不代表批准）' : '买入权限：关闭。第 5 级为空，第四级闸门不评估。')
  for (const r of v.buyPermission.reasons) L.push(`- ${r}`)
  L.push('')

  L.push('## 二、持仓风险提示（独立保留，不因名单治理上线而变化）', '')
  if (risk) {
    L.push(`价格时点：${risk.pricedAt ?? '取价失败'}。${risk.note}`, '')
    L.push('| 口径 | 名称 | 占总资产 | 上限 | 状态 |', '|---|---|---|---|---|')
    for (const r of risk.sectors) L.push(`| 板块 | ${r.label} | ${pct(r.pct)} | ${pct(r.limit)} | ${r.pct > r.limit ? '超限（只显示，不自动出卖单）' : '未超'} |`)
    for (const r of risk.themes) L.push(`| 主题 | ${r.label} | ${pct(r.pct)} | ${pct(r.limit)} | ${r.pct > r.limit ? '超限（只显示，不自动出卖单）' : r.limit - r.pct < 0.05 ? `余量 ${pct(r.limit - r.pct)}` : '未超'} |`)
    L.push('')
    const over = [...risk.sectors.map(r => ({ kind: '板块', r })), ...risk.themes.map(r => ({ kind: '主题', r }))].filter(x => x.r.pct > x.r.limit)
    for (const { kind, r } of over) {
      const pp = (r.pct - r.limit) * 100
      L.push(`${kind}「${r.label}」超限：占总资产 ${pct(r.pct)}，上限 ${pct(r.limit)}，超出 ${pp.toFixed(1)} 个百分点（相当于上限的 ${((r.pct / r.limit - 1) * 100).toFixed(1)}%）。`, '')
      L.push(`涉及持仓：${r.holdings.map(h => `${h.code} ${h.name} ${pct(h.pct)}`).join('；')}。`, '')
      L.push(`风险提示：只显示，不自动出卖单；这不是对 ${pct(r.limit)} 上限的豁免。单票归位只处理单只股票的占比，不等于${kind}风险已解决，两个层级分别看、分别报告。`, '')
    }
  } else {
    L.push('本次未取价，占比见驾驶舱。板块 30%、主题 45% 上限目前只显示，不自动生成卖单。', '')
  }

  L.push('## 三、各级数量', '')
  L.push('| 层级 | 权限 | 数量 |', '|---|---|---|')
  for (const l of [6, 5, 4, 3, 2] as LadderLevel[]) L.push(`| ${l}. ${LEVEL_NAME[l]} | ${LEVEL_PERMISSION[l]} | ${v.counts[l]} |`)
  L.push(`| 1. ${LEVEL_NAME[1]} | ${LEVEL_PERMISSION[1]} | 由资金哨兵入口③ 覆盖，不逐只列出${v.counts[1] ? `（另有 ${v.counts[1]} 只来源已移出）` : ''} |`, '')

  const watched = v.entries.filter(e => e.plans.length && (e.level === 3 || e.level === 4))
  const rows = watched.flatMap(e => e.plans.map(p => ({ e, p })))
    .sort((a, b) => urgency(b.p.todo) - urgency(a.p.todo) || a.p.reviewBy.localeCompare(b.p.reviewBy) || a.e.code.localeCompare(b.e.code))
  const overdue = watched.filter(e => e.reviewOverdue)
  L.push('## 四、观察期复核待办', '')
  L.push(`逾期未复核 ${overdue.length} 只；今日到期 ${watched.filter(e => e.reviewTodo === 'DUE_TODAY').length} 只。`, '')
  L.push('到期必须产生一条明确的复核结论，不自动续期，不因到期自动升级；逾期未复核的不得静默续留。结论写入 `backend/src/services/ladder/data/decisions.json`，四种之一：', '')
  L.push(`- 证据增强且满足本级条件 → ${REVIEW_ACTION_TEXT.APPLY_UP}；须写新期限`)
  L.push(`- 证据不足但仍有研究价值 → ${REVIEW_ACTION_TEXT.KEEP}；须写理由与新期限`)
  L.push(`- 证据已失效或研究价值消失 → ${REVIEW_ACTION_TEXT.DOWN}，或${REVIEW_ACTION_TEXT.REMOVE}`)
  L.push('- 盈利验证在法定披露截止日前为「等待披露」，不视为证据失效；证据失效只能由复核结论写明', '')
  if (rows.length) {
    L.push('| 到期日 | 代码 | 名称 | 层级 | 观察目的 | 责任人 | 待办状态 | 最近复核 |', '|---|---|---|---|---|---|---|---|')
    for (const { e, p } of rows) {
      const lr = e.lastReview && (!e.lastReview.purpose || e.lastReview.purpose === p.purpose)
        ? `${e.lastReview.date} ${REVIEW_FINDING_TEXT[e.lastReview.finding]} → ${REVIEW_ACTION_TEXT[e.lastReview.action]}（${e.lastReview.approver}）`
        : '—'
      L.push(`| ${p.reviewBy} | ${e.code} | ${e.name} | ${e.level}. ${LEVEL_NAME[e.level]} | ${PURPOSE_TEXT[p.purpose]} | ${cell(p.owner)} | ${TODO_TEXT[p.todo]} | ${cell(lr)} |`)
    }
  } else {
    L.push('（无）')
  }
  L.push('')
  if (v.invalidDecisions.length) {
    L.push('不合规的复核记录（不计入，相关观察计划按未复核处理）：', '')
    for (const d of v.invalidDecisions) L.push(`- ${d.date} ${d.code} ${d.action}：${d.reason}`)
    L.push('')
  }
  const concluded = v.entries.filter(e => e.lastReview && !(e.level === 3 || e.level === 4))
  if (concluded.length) {
    L.push('已复核离开观察池：', '')
    for (const e of concluded) {
      const r = e.lastReview!
      L.push(`- ${e.code} ${e.name}：${r.date} ${r.purpose ? PURPOSE_TEXT[r.purpose] : '全部观察计划'} ${REVIEW_FINDING_TEXT[r.finding]} → ${REVIEW_ACTION_TEXT[r.action]}（${r.approver}：${r.note}），现为 ${e.level}. ${LEVEL_NAME[e.level]}`)
    }
    L.push('')
  }

  const flagged = v.entries.filter(e => e.flags.length)
  if (flagged.length) {
    L.push('## 五、不一致提示（只提示，不出动作）', '')
    for (const e of flagged) for (const f of e.flags) L.push(`- ${e.code} ${e.name}：${f}`)
    L.push('')
  }

  let n = flagged.length ? 6 : 5
  const ch = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十', '十一']
  for (const l of [6, 5, 4, 3, 2] as LadderLevel[]) {
    L.push(`## ${ch[n++]}、${l}. ${LEVEL_NAME[l]}（${LEVEL_PERMISSION[l]}）`, '')
    L.push(...table(v.entries.filter(e => e.level === l), l))
  }

  L.push('## 说明', '')
  for (const x of v.notes) L.push(`- ${x}`)
  L.push('')
  return L.join('\n')
}
