// 今日结论的文本渲染
//
// 排版原则只有一条：**先给结论，再给依据。**
// 委员会的原话是"我不需要再去分析我们已经分析好的那些数据"，
// 所以这一页必须能单独读完就够，四张表退化为"想深究时才翻"的附录。
//
// 与四张表的渲染纪律一致：缺失写"缺失"、不出现综合评分、
// 观察项与法定理由永远并列出现且措辞上不可互换。

import type { Verdict } from './verdict'

function pad(s: string, width: number): string {
  let w = 0
  for (const ch of s) w += /[\u4e00-\u9fa5\u3000-\u303f（）：、。「」]/.test(ch) ? 2 : 1
  return s + ' '.repeat(Math.max(0, width - w))
}

function pct(v: number | null): string {
  return v === null ? '缺失' : `${(v * 100).toFixed(1)}%`
}

export function renderVerdict(v: Verdict): string {
  const W = 122
  const L: string[] = []
  const w = (s = '') => L.push(s)
  const rule = (ch = '═') => w(ch.repeat(W))

  rule()
  w(`今日结论  ${v.date}`)
  rule()
  w()
  w(`  ${v.oneLine}`)
  w()

  // ── 焦点名单 ──
  // 放在最前面，因为委员会要的就是"最后总结为哪几个个股"。
  w(`${'─'.repeat(W)}`)
  w(`焦点：今天真正需要你看的就这 ${v.focus.length} 个`)
  w(`${'─'.repeat(W)}`)
  if (!v.focus.length) {
    w(`  无。今天没有任何标的触发规则。`)
  }
  v.focus.forEach((f, i) => {
    w()
    w(`  ${i + 1}. ${f.name}${f.held ? '　[持仓]' : '　[未持仓]'}`)
    w(`     为什么在这里：${f.because}`)
    w(`     今天做什么：${f.todo}`)
  })
  w()
  w(`  研究覆盖：${v.coverageVerdict}`)
  w()

  // ── 一、必须执行 ──
  w(`${'─'.repeat(W)}`)
  w(`一、必须执行（有法定理由）—— ${v.mustDo.length} 项`)
  w(`${'─'.repeat(W)}`)
  if (!v.mustDo.length) {
    w(`  无。没有任何持仓触发法定减仓理由。`)
  }
  for (const h of v.mustDo) {
    w()
    w(`  ▸ ${h.name}（${h.code}）　仓位 ${pct(h.posPct)}　→ ${h.action}`)
    w(`    法定理由：${h.legalReason}`)
    w(`    数据在说什么：`)
    for (const s of h.saysWhat) w(`      · ${s}`)
    if (h.notReason.length) {
      w(`    明确不是理由：${h.notReason.join('；')}`)
    }
  }
  w()

  // ── 二、有复核但不动作 ──
  w(`${'─'.repeat(W)}`)
  w(`二、触发复核但「无法定理由」—— ${v.reviewNoAction.length} 项（系统不动作）`)
  w(`${'─'.repeat(W)}`)
  w(`  这一档是整套系统最容易被自己推翻的地方：读到"6 项恶化"很容易顺手卖出，`)
  w(`  但技术指标只被允许触发复核。没有法定理由就没有动作 —— 这条由类型系统强制。`)
  for (const h of v.reviewNoAction) {
    w()
    w(`  ▸ ${h.name}（${h.code}）　仓位 ${pct(h.posPct)}　→ ${h.action}`)
    w(`    法定减仓理由：无`)
    for (const s of h.saysWhat) w(`      · ${s}`)
  }
  w()

  // ── 三、安静持仓 ──
  if (v.quiet.length) {
    w(`${'─'.repeat(W)}`)
    w(`三、无复核项也无法定理由 —— ${v.quiet.length} 项`)
    w(`${'─'.repeat(W)}`)
    w(`  ${v.quiet.map(q => `${q.name} ${pct(q.posPct)}`).join('　')}`)
    w()
  }

  // ── 四、允许研究 ──
  w(`${'─'.repeat(W)}`)
  w(`四、允许研究（不是允许买入）—— ${v.research.length} 个节点`)
  w(`${'─'.repeat(W)}`)
  w(`  「允许研究」不等于「再等等」。下面每条缺口都是一件今天可以开始做的核验任务。`)
  for (const r of v.research) {
    w()
    w(`  ▸ ${r.node}${r.members.length ? `（${r.members.join('、')}）` : ''}` +
      `${r.blockedByStrategy ? '　⚠ 战略层不允许' : `　还差 ${r.missingGates.length} 道闸门`}`)
    w(`    数据在说什么：${r.saysWhat.join('；')}`)
    for (const g of r.missingGates) w(`    缺口：${g}`)
  }
  w()

  // ── 五、为何不许新增建仓 ──
  w(`${'─'.repeat(W)}`)
  w(`五、今日不许新增建仓的逐条原因`)
  w(`${'─'.repeat(W)}`)
  if (!v.noEntryReasons.length) w(`  无禁止项。`)
  v.noEntryReasons.forEach((r, i) => w(`  ${i + 1}. ${r}`))
  w()

  // ── 六、跨多日累计 ──
  w(`${'─'.repeat(W)}`)
  w(`六、跨多日累计变化 —— 单日看不出的东西`)
  w(`${'─'.repeat(W)}`)
  w(`  ${v.driftNote}`)
  if (v.driftWindow) {
    w(`  区间：${v.driftWindow.from} → ${v.driftWindow.to}（${v.driftWindow.days} 个交易日）`)
  }
  for (const g of v.drift) {
    w()
    w(`  【${g.label}】`)
    for (const d of g.items) {
      const dt = d.delta === null || d.delta === 0
        ? ''
        : `（${d.delta > 0 ? '+' : ''}${
          d.from.endsWith('%') ? `${(d.delta * 100).toFixed(1)}pct` : d.delta.toFixed(2)
        }）`
      w(`    ${pad(`${d.key} · ${d.field}`, 46)}${pad(d.from, 12)}→ ${pad(d.to, 12)}${dt}` +
        `${d.monotonic ? '  单向' : ''}  ${d.days}天`)
    }
  }
  w()

  // ── 七、系统答不了的 ──
  w(`${'─'.repeat(W)}`)
  w(`七、这套系统答不了的问题（附实测依据）`)
  w(`${'─'.repeat(W)}`)
  w(`  把答不了的问题明确列出来，本身是结论的一部分 ——`)
  w(`  否则读者会默认"没说不能，就是能"。`)
  for (const c of v.cannotAnswer) {
    w()
    w(`  问：${c.question}`)
    w(`  答：${c.why}`)
  }
  w()
  rule()
  w(`本页不预测涨跌。四种动作各自挂法定理由；观察指标只触发复核，不产生动作。`)
  rule()

  return L.join('\n')
}
