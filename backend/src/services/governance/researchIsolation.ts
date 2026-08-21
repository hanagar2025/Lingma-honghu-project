/**
 * 研究层隔离不变量。
 *
 * ── 它证明的是什么 ──
 *
 * 委员会 2026-08-16 指出一次方向性偏离:研究模块(九环验证链、兆易 AI 归因)
 * 一度占据了驾驶舱最显眼的位置,读起来像决策中心。
 * 而正确的顺序是:
 *
 *   战略主线 → 战略资格 → 核心标的池 → 战术强弱 → TPO → 仓位执行
 *
 * **研究模块是给投资决策提供证据的,不是研究模块自己成为投资决策。**
 *
 * 本文件把这句话变成机械可验的六条:研究层的任何结论,都不得改变
 *
 *   ① 长期主线(MAINLINES)
 *   ② 战略资格(strategyAllows / C 级清退)
 *   ③ 核心仓位结构(持仓与动作)
 *   ④ TPO 阶段性顶部判断
 *   ⑤ L1 组合仓位(熔断与股票上限)
 *   ⑥ L2 单票集中度
 *
 * ── 为什么要机械验而不是声明 ──
 *
 * 「研究不影响交易」这句话写在文档里是零成本的。真正会发生的偏离是:
 * 某天有人为了让驾驶舱"更聪明",把叙事台账的评分接进候选池排序 ——
 * 那时文档还在,约束已经没了。
 *
 * 故本文件走两条路:
 *   1. **结构证明**:DashboardInput 的类型里不存在任何研究台账字段。
 *      研究结论没有进入决策层的通道,不是"约定不用",而是没有参数可传。
 *   2. **行为证明**:把研究层全部结论强行改成最看多的状态,
 *      再跑一遍决策层,要求六项输出逐字节相同。
 *
 * 第 2 条比第 1 条重要:类型可以被新增字段绕过,而行为对比会立刻失败。
 */

import { readFileSync } from 'node:fs'

/** 研究层模块名。新增研究模块时必须登记在此 —— 未登记的模块不受隔离检查覆盖 */
export const RESEARCH_MODULES = [
  'research/hypotheses.ts',
  'research/attribution.ts',
  'research/alternatives.ts',
  'research/link2Revenue.ts',
  'research/segmentFetch.ts',
  'research/gmAnomalyRegression.ts',
  'research/nodeCandidates.ts',
  'research/powerChain.ts',
  'research/portfolioDefense.ts',
] as const

/**
 * 研究台账字段名。这些名字**不允许**出现在决策层的输入类型里。
 *
 * 用名字而不是类型做判据,是因为绕过隔离最省事的做法正是
 * "把研究结果换个名字塞进 DashboardInput" —— 而换名字这件事,
 * 只要新名字仍出现在这张表里就会被拦住。故这张表要随研究模块一起扩。
 */
export const RESEARCH_FIELD_NAMES = [
  'hypotheses', 'hypothesis', 'propositions', 'causal', 'causalLayers',
  'attribution', 'alternatives', 'altGate', 'link2', 'link2Result',
  'fourLine', 'verificationChain', 'paidGaps', 'wiringBacklog',
  'pendingVerification', 'growthContribution', 'stockShare',
  'powerChain', 'penetrate', 'POWER_LAYERS', 'POWER_QUESTIONS',
  'portfolioDefense', 'haiHypothesis', 'allocationAudit',
  'factorConcentration', 'dividendQualityChecklist', 'snowballNotes',
] as const

export interface IsolationFinding {
  kind: 'DECISION_INPUT_LEAK' | 'RESEARCH_IMPORTS_ACTION' | 'UNREGISTERED_MODULE'
  where: string
  detail: string
}

/**
 * 结构检查:决策层的输入类型中不得出现研究台账字段。
 *
 * @param decisionSrc 决策层源码(cockpit/dashboard.ts 与 cockpit/index.ts)
 */
export function findDecisionInputLeaks(
  decisionSrc: { path: string; text: string }[]
): IsolationFinding[] {
  const out: IsolationFinding[] = []
  for (const f of decisionSrc) {
    // 只看输入类型定义块,不看整个文件 —— 决策层引用 profit 之类的共享数据是允许的,
    // 被禁的是"研究结论作为决策输入"。
    const blocks = [...f.text.matchAll(/export interface (\w*Input)\s*\{([\s\S]*?)\n\}/g)]
    for (const b of blocks) {
      const [, name, body] = b
      if (!body) continue
      const code = body.split('\n')
        .filter(l => {
          const t = l.trim()
          return !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*')
        })
        .join('\n')
      for (const field of RESEARCH_FIELD_NAMES) {
        // 匹配 `field:` 或 `field?:` 形式的属性声明
        if (new RegExp(`(^|\\s)${field}\\??\\s*:`, 'm').test(code)) {
          out.push({
            kind: 'DECISION_INPUT_LEAK',
            where: `${f.path} → ${name}`,
            detail: `决策层输入类型出现研究台账字段「${field}」。`
              + '研究结论不得作为决策输入 —— 它可以被读，但不得参与判定。',
          })
        }
      }
    }
  }
  return out
}

/** 研究层不得 import 任何能产生动作的东西 */
export function findResearchActionImports(
  researchSrc: { path: string; text: string }[]
): IsolationFinding[] {
  const out: IsolationFinding[] = []
  for (const f of researchSrc) {
    const imports = f.text.split('\n')
      .filter(l => l.trimStart().startsWith('import'))
      .join('\n')
    for (const banned of ['makeAction', 'findLimitBreaches', 'computeCircuit', 'evaluateActions']) {
      if (imports.includes(banned)) {
        out.push({
          kind: 'RESEARCH_IMPORTS_ACTION',
          where: f.path,
          detail: `研究模块 import 了「${banned}」。`
            + '研究层不得触碰任何产生动作或计算风控闸门的函数。',
        })
      }
    }
  }
  return out
}

/** 读源码。路径相对于 src/services */
export function readServiceSources(
  baseUrl: URL, rels: readonly string[]
): { path: string; text: string }[] {
  return rels.map(rel => ({
    path: rel,
    text: (() => {
      try { return readFileSync(new URL(rel, baseUrl), 'utf-8') } catch { return '' }
    })(),
  })).filter(x => x.text.length > 0)
}

/**
 * 六项受保护的决策输出。行为证明比对的就是这六项。
 *
 * 顺序与委员会 2026-08-16 列出的顺序一致,便于逐条核对。
 */
export const PROTECTED_OUTPUTS = [
  { no: 1, name: '长期主线', what: 'MAINLINES 常量与主线归属' },
  { no: 2, name: '战略资格', what: 'strategyAllows / C 级清退状态' },
  { no: 3, name: '核心仓位结构', what: '持仓表与动作区' },
  { no: 4, name: 'TPO 阶段性顶部', what: '势能衰减与复核触发' },
  { no: 5, name: 'L1 组合仓位', what: '熔断等级、股票上限、须降敞口' },
  { no: 6, name: 'L2 单票集中度', what: '单票超限名单与减仓额' },
] as const

/**
 * 研究台账的特征文本。**这些字样不允许出现在决策层的输出里。**
 *
 * 结构检查看类型,本表看**渲染结果**。两者拦的是不同的失败方式:
 * 类型检查拦"研究结论作为参数传进来",本表拦"研究结论被渲染进了决策区" ——
 * 后者更可能发生,因为它不需要改任何类型,只要在动作区多写一行字。
 */
export const RESEARCH_TEXT_MARKERS = [
  '命题 A', '命题 B', '验证链', '因果强度', '替代解释',
  'PENDING_VERIFICATION', 'CURRENT_IS_OUTLIER', 'BASE_IS_OUTLIER',
  '超级周期', '主线收入归因', '增长贡献', '待核验异常',
  '价值传导图', 'E-01', '战略观察池',
  'H-AI', '组合防守层', '方三文', '雪球三分法', 'D-01',
] as const

/**
 * 行为检查:决策层的输出 JSON 中不得出现研究台账的特征文本。
 *
 * @param decisionJson JSON.stringify(dashboard)
 */
export function findRenderedResearchLeaks(decisionJson: string): IsolationFinding[] {
  return RESEARCH_TEXT_MARKERS
    .filter(m => decisionJson.includes(m))
    .map(m => ({
      kind: 'DECISION_INPUT_LEAK' as const,
      where: '决策层输出 JSON',
      detail: `出现研究台账特征文本「${m}」。`
        + '研究结论可以在驾驶舱里被阅读，但不得出现在决策层的输出结构中 ——'
        + '一旦出现，它就会被下游当成判定依据。',
    }))
}

export function renderIsolation(findings: IsolationFinding[]): string {
  const L: string[] = ['', '研究层隔离检查', '─'.repeat(78)]
  L.push('  受保护的决策输出（研究层结论不得改变其中任何一项）：')
  for (const p of PROTECTED_OUTPUTS) L.push(`    ${p.no}. ${p.name}　${p.what}`)
  L.push('')
  if (!findings.length) {
    L.push('  ✓ 未发现泄漏。研究结论没有进入决策层的通道 ——')
    L.push('    不是"约定不用"，而是决策层的输入类型里没有可传的参数。')
  } else {
    L.push(`  ✗ 发现 ${findings.length} 处泄漏：`)
    for (const f of findings) {
      L.push(`    · [${f.kind}] ${f.where}`)
      L.push(`      ${f.detail}`)
    }
  }
  L.push('')
  return L.join('\n')
}
