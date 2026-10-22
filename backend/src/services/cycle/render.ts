/**
 * CY-01 · 映射表与指标登记表文档（由登记表生成，不手改）
 */

import { NODE_NAME, NODE_ORDER, NODE_SCOPE, nodeMembers } from './nodes'
import { CYCLE_RULES, INDICATORS, REGISTERED_ON, pendingCount } from './registry'
import { CONSTRAINTS, PERMISSIONS } from './package'
import { CYCLE_STATE, FREQ_TEXT, GAP_TEXT, LAYERS, LINE_TEXT, RULING_TEXT, type LayerId } from './types'

const cell = (s: string | null | undefined) => (s ?? '').replace(/\|/g, '／').replace(/\n/g, ' ')

function header(title: string): string[] {
  return [
    `# ${title}`,
    '',
    `登记日：${REGISTERED_ON}　编号：CY-01　性质：研究层映射与证据汇总（不产生动作）`,
    '本文件由 backend/src/services/cycle/render.ts 按登记表生成，不手改；改登记表后运行 npm -w backend run cycle:docs。',
    '',
    '## 硬约束（委员会 2026-10-17）',
    ...[...PERMISSIONS, ...CONSTRAINTS].map(s => `- ${s}`),
    '',
    '## 三个阶段',
    '1. 10 月 19 日生产验收。结果分通过、失败、未发布／未验收三类；「任务运行成功」不等于「生产验收通过」。本工作在验收通过前不合入生产分支。',
    '2. 映射表 → 指标登记表 → 汇总程序。按产业节点生成带日期的证据包，展示证据、数据缺口和更新时点；不重复计算现有模块，不改变任何交易权限。',
    '3. 委员会根据证据包做正式研判，固定输出八项，写成带日期的研判记录。',
    '',
    '## 研判固定输出八项',
    '1. 当前判断：市场或具体产业节点正在发生什么变化。',
    '2. 证据清单：哪些数据支持判断，哪些数据反驳判断；缺数据的条目只能列为已考虑的缺口。',
    '3. 状态判定：逐节点给出 C0–C3 状态及理由，不合成总分；不能判断写「无法判断」。',
    '4. 置信程度：高、中、低，并解释原因；数据不足时明确说无法判断。',
    '5. 情景推演：判断成立时接下来观察什么；判断错误时最早会出现什么反证。',
    '6. 复核条件：哪些新数据会改变结论，何时再次检查。',
    '7. 决策建议：分「只供研究」与「进入现有授权流程」（只限 C 级清退、单票归位、熔断）；不写股数，不写买入。',
    '8. 事后验证：另起一条验证记录回指原研判，写明后续结果是否支持原判断，错误来自数据、逻辑还是执行。',
    '',
    '每次判断必须在看到后续结果之前留下记录：研判记录在落档时刻盖时间，复核日期必须晚于落档日；证据包、研判、验证三类文件只增不改，各带 SHA-256 指纹，由 npm -w backend run cycle:check 校验。',
    '',
    '## 要验证的三种能力',
    '- 能否比单看股价更早识别产业变化。（模拟层领先期检验，逐节点记录领先期、样本数和失败案例；样本充分前不宣布规律）',
    '- 能否区分真实的周期转折与短期噪声。（研判记录里的「噪声」栏与事后验证结论）',
    '- 能否改善风险控制和决策质量，而不是增加交易频率。（决策建议只有两类范围，进入授权流程的只限三类现行规则）',
    '',
  ]
}

export function renderMappingDoc(): string {
  const L = header('AI 基建周期拐点监控 · 映射表 V1.0')
  L.push('## 周期状态定义（研究标签，判定条件待裁定）')
  L.push('| 状态 | 名称 | 需要看到的证据 | 研究结论 |')
  L.push('|---|---|---|---|')
  for (const [k, v] of Object.entries(CYCLE_STATE)) L.push(`| ${k} | ${v.name} | ${v.evidence} | ${v.conclusion} |`)
  L.push('')
  L.push(`说明：${CYCLE_RULES.note}。`)
  L.push('')
  L.push('## 产业节点')
  L.push('| 节点 | 范围 | 成员 |')
  L.push('|---|---|---|')
  const members = nodeMembers()
  for (const n of NODE_ORDER) {
    const ms = members.filter(m => m.node === n)
    L.push(`| ${NODE_NAME[n]} | ${NODE_SCOPE[n]} | ${ms.map(m => `${m.name}（${m.code}${m.champion ? '，冠军' : ''}；${m.scope}）`).join('、') || '无'} |`)
  }
  L.push('')
  for (const layer of Object.keys(LAYERS) as LayerId[]) {
    L.push(`## ${layer} ${LAYERS[layer].name}：${LAYERS[layer].question}`)
    L.push('| 编号 | 指标 | 线 | 适用节点 | 引用的现有模块与字段 | 数据源现状 | 缺口 |')
    L.push('|---|---|---|---|---|---|---|')
    for (const i of INDICATORS.filter(x => x.layer === layer)) {
      const src = i.source ? `${i.source.module}：${i.source.path} → ${i.source.field}` : '现有模块没有'
      L.push(`| ${i.id} | ${i.name} | ${LINE_TEXT[i.line]} | ${i.nodes ? i.nodes.map(n => NODE_NAME[n]).join('、') : '各节点共用背景'} | ${cell(src)} | ${cell(i.dataSource)} | ${i.gaps.map(g => GAP_TEXT[g]).join('、') || '无'} |`)
    }
    L.push('')
  }
  const bySource = INDICATORS.filter(i => i.gaps.includes('SOURCE')).length
  const byUpdate = INDICATORS.filter(i => i.gaps.includes('UPDATE')).length
  L.push('## 缺口汇总')
  L.push(`- 指标共 ${INDICATORS.length} 项；缺数据源 ${bySource} 项，缺更新 ${byUpdate} 项，参数待裁定 ${pendingCount()} 项。`)
  L.push('- 缺口只说明系统不完整，不说明风险上升或解除。')
  L.push('')
  return L.join('\n')
}

export function renderRegisterDoc(): string {
  const L = header('AI 基建周期拐点监控 · 指标登记表 V1.0')
  L.push('## 登记规则')
  L.push('- 正常区间与恶化条件除「现行规则」外一律「待裁定（不生效）」；候选口径只是登记，不是裁定。')
  L.push('- 现行规则由执行单或驾驶舱执行，本表只引用，不重复执行。')
  L.push('- 复核动作只有复核，没有交易。')
  L.push('')
  for (const layer of Object.keys(LAYERS) as LayerId[]) {
    L.push(`## ${layer} ${LAYERS[layer].name}`)
    L.push('| 编号 | 指标 | 回答的问题 | 更新频率 | 正常区间 | 恶化条件 | 复核动作 |')
    L.push('|---|---|---|---|---|---|---|')
    for (const i of INDICATORS.filter(x => x.layer === layer)) {
      const p = (x: typeof i.normal) => `${RULING_TEXT[x.status]}：${x.text}${x.ref ? `（出处：${x.ref}）` : ''}`
      L.push(`| ${i.id} | ${i.name} | ${i.question} | ${FREQ_TEXT[i.freq]} | ${cell(p(i.normal))} | ${cell(p(i.deterioration))} | ${cell(i.reviewAction)}${i.note ? `；注：${cell(i.note)}` : ''} |`)
    }
    L.push('')
  }
  return L.join('\n')
}
