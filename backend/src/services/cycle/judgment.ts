/**
 * CY-01 · 研判记录与事后验证记录
 *
 * 每次研判固定输出八项：
 *   一 当前判断　二 支持与反对证据　三 各节点 C0–C3 状态与理由　四 置信度
 *   五 情景推演与最早反证　六 复核条件与日期　七 权限范围内的决策建议　八 事后验证
 *
 * 纪律：
 *   - 研判必须在看到后续结果之前落档：记录时刻不早于所引证据包的生成时刻，复核日期晚于记录日。
 *   - 研判引用证据包的文件名与 SHA-256 指纹；证据编号必须在该包里存在。
 *   - 缺数据的证据不能被引为支持或反证，只能列入「已考虑的缺口」。
 *   - 六个节点逐一给出状态，不合成总分；不能判断时写「无法判断」。
 *   - 决策建议分两类：只供研究；进入现有授权流程（只限 C 级清退、单票归位、熔断）。不写股数，不写买入。
 *   - 第八项在研判记录里只是待验证占位；事后验证另起一条记录回指原研判，原记录不改。
 */

import { NODE_ORDER } from './nodes'
import type { CycleState, EvidencePackage, NodeId } from './types'
import { allEvidence } from './package'

export type NodeStateCall = CycleState | 'UNDETERMINABLE'
export type Confidence = 'HIGH' | 'MEDIUM' | 'LOW' | 'UNDETERMINABLE'
export type DecisionScope = 'RESEARCH_ONLY' | 'EXISTING_AUTHORIZED_PROCESS'
export type ExistingRule = 'C级清退' | '单票归位' | '熔断'
export const EXISTING_RULES: ExistingRule[] = ['C级清退', '单票归位', '熔断']

export const CONFIDENCE_TEXT: Record<Confidence, string> = { HIGH: '高', MEDIUM: '中', LOW: '低', UNDETERMINABLE: '无法判断' }
export const SCOPE_TEXT: Record<DecisionScope, string> = { RESEARCH_ONLY: '只供研究', EXISTING_AUTHORIZED_PROCESS: '进入现有授权流程' }

export interface EvidenceCite { evidenceId: string; reading: string }

export interface JudgmentRecord {
  id: string
  kind: 'JUDGMENT'
  version: 'V1.0'
  recordedAt: string
  recordedBy: string
  package: { file: string; sha256: string; asOf: string }
  /** 一 当前判断 */
  currentJudgment: string
  /** 二 支持与反对证据；缺数据条目只能进 missingConsidered */
  evidence: { supporting: EvidenceCite[]; opposing: EvidenceCite[]; missingConsidered: string[]; noise: EvidenceCite[] }
  /** 三 逐节点状态 */
  nodes: { node: NodeId; state: NodeStateCall; reason: string; evidenceIds: string[] }[]
  /** 四 置信度 */
  confidence: { level: Confidence; reason: string }
  /** 五 情景推演 */
  scenarios: { name: string; ifHolds: string; earliestFalsifier: string }[]
  /** 六 复核条件与日期 */
  review: { conditions: string[]; date: string }
  /** 七 决策建议 */
  decisions: { scope: DecisionScope; rule: ExistingRule | null; text: string }[]
  /** 八 事后验证：研判时只能是待验证 */
  verification: { status: 'PENDING'; due: string }
  producesAction: false
}

export type Outcome = 'SUPPORTED' | 'PARTLY_SUPPORTED' | 'FALSIFIED' | 'UNDETERMINABLE'
export type ErrorSource = 'DATA' | 'LOGIC' | 'EXECUTION'
export const OUTCOME_TEXT: Record<Outcome, string> = { SUPPORTED: '支持原判断', PARTLY_SUPPORTED: '部分支持', FALSIFIED: '原判断被证伪', UNDETERMINABLE: '仍无法判断' }
export const ERROR_TEXT: Record<ErrorSource, string> = { DATA: '数据', LOGIC: '逻辑', EXECUTION: '执行' }

export interface VerificationRecord {
  id: string
  kind: 'VERIFICATION'
  version: 'V1.0'
  recordedAt: string
  recordedBy: string
  judgment: { id: string; file: string; sha256: string }
  /** 验证时依据的新证据包（可多份） */
  packages: { file: string; sha256: string }[]
  outcome: Outcome
  nodes: { node: NodeId; outcome: Outcome; observed: string }[]
  observed: string
  /** 非「支持原判断」时必填 */
  errorSources: ErrorSource[]
  errorNote: string
  lessons: string
  producesAction: false
}

const DATE = /^\d{4}-\d{2}-\d{2}$/
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/
const BUY = /(?<!不|不得|不能|禁止|暂停)(买入|加仓|建仓|开仓|补仓)(?!权限|关闭|封锁|锁)/
const SHARES = /\d+\s*股/

export const toMs = (iso: string) => Date.parse(iso)

export interface PackageLookup { file: string; sha256: string; pkg: EvidencePackage }

/** 校验研判记录。返回问题列表，空表示通过 */
export function validateJudgment(j: JudgmentRecord, lookup: (file: string) => PackageLookup | null): string[] {
  const err: string[] = []
  const need = (ok: unknown, msg: string) => { if (!ok) err.push(msg) }
  need(j.kind === 'JUDGMENT' && j.version === 'V1.0', 'kind 必须是 JUDGMENT，version 必须是 V1.0')
  need(/^J-\d{4}-\d{2}-\d{2}-\d{2}$/.test(j.id ?? ''), '编号格式为 J-YYYY-MM-DD-NN')
  need(ISO.test(j.recordedAt ?? ''), '记录时刻须为带时区的 ISO 时间')
  need(!!j.recordedBy?.trim(), '须写明记录人')
  need(j.producesAction === false, 'producesAction 必须为 false')

  const ref = j.package ? lookup(j.package.file) : null
  need(!!ref, `引用的证据包不在档案里：${j.package?.file}`)
  if (ref) {
    need(ref.sha256 === j.package.sha256, '证据包指纹与档案不符')
    need(ref.pkg.asOf === j.package.asOf, '证据包日期与引用不符')
    need(toMs(j.recordedAt) >= toMs(ref.pkg.generatedAt), '研判记录时刻早于证据包生成时刻')
  }
  const ev = ref ? new Map(allEvidence(ref.pkg).map(e => [e.id, e])) : new Map()
  const facts = new Set(ref?.pkg.facts.map(f => f.id) ?? [])
  const exists = (id: string) => ev.has(id) || facts.has(id)

  need(!!j.currentJudgment?.trim(), '一、当前判断不能为空')

  const cites = [...(j.evidence?.supporting ?? []), ...(j.evidence?.opposing ?? []), ...(j.evidence?.noise ?? [])]
  need((j.evidence?.supporting?.length ?? 0) + (j.evidence?.opposing?.length ?? 0) > 0, '二、支持与反对证据至少列一条')
  for (const c of cites) {
    need(exists(c.evidenceId), `二、证据编号不在证据包里：${c.evidenceId}`)
    need(!!c.reading?.trim(), `二、${c.evidenceId} 须写明读法`)
    const e = ev.get(c.evidenceId)
    need(!e || e.availability !== 'MISSING', `二、缺数据的条目不能作为支持、反证或噪声：${c.evidenceId}（应列入已考虑的缺口）`)
  }
  for (const id of j.evidence?.missingConsidered ?? []) {
    need(exists(id), `二、缺口编号不在证据包里：${id}`)
    const e = ev.get(id)
    need(!e || e.availability === 'MISSING', `二、${id} 不是缺数据条目，不应列入缺口`)
  }

  const seen = new Set<NodeId>()
  for (const n of j.nodes ?? []) {
    need(NODE_ORDER.includes(n.node), `三、未知节点 ${n.node}`)
    need(!seen.has(n.node), `三、节点重复：${n.node}`)
    seen.add(n.node)
    need(['C0', 'C1', 'C2', 'C3', 'UNDETERMINABLE'].includes(n.state), `三、${n.node} 状态须为 C0–C3 或无法判断`)
    need(!!n.reason?.trim(), `三、${n.node} 须写理由`)
    if (n.state !== 'UNDETERMINABLE') {
      need((n.evidenceIds?.length ?? 0) > 0, `三、${n.node} 给出 ${n.state} 须引用证据编号`)
      for (const id of n.evidenceIds ?? []) {
        need(exists(id), `三、${n.node} 引用的证据不在证据包里：${id}`)
        need(ev.get(id)?.availability !== 'MISSING', `三、${n.node} 不能用缺数据条目支撑状态：${id}`)
      }
    }
    if (n.state === 'C3') {
      const layers = new Set((n.evidenceIds ?? []).map(id => ev.get(id)?.layer).filter(Boolean))
      need(layers.size >= 2, `三、${n.node} 判 C3 须有多层证据共同确认（现有 ${layers.size} 层）`)
    }
  }
  need(NODE_ORDER.every(n => seen.has(n)), `三、六个节点须逐一给出状态（缺 ${NODE_ORDER.filter(n => !seen.has(n)).join('、')}）`)

  need(['HIGH', 'MEDIUM', 'LOW', 'UNDETERMINABLE'].includes(j.confidence?.level), '四、置信度须为高、中、低或无法判断')
  need(!!j.confidence?.reason?.trim(), '四、须解释置信度')

  need((j.scenarios?.length ?? 0) >= 2, '五、情景推演至少两个（判断成立与判断错误）')
  for (const s of j.scenarios ?? []) need(!!s.ifHolds?.trim() && !!s.earliestFalsifier?.trim(), `五、情景「${s.name}」须写接下来观察什么与最早反证`)

  need((j.review?.conditions?.length ?? 0) > 0, '六、须写复核条件')
  need(DATE.test(j.review?.date ?? ''), '六、复核日期格式为 YYYY-MM-DD')
  need((j.review?.date ?? '') > (j.recordedAt ?? '').slice(0, 10), '六、复核日期必须晚于记录日（先落档，后看结果）')

  need((j.decisions?.length ?? 0) > 0, '七、须写决策建议（可以是「维持观察」）')
  for (const d of j.decisions ?? []) {
    need(['RESEARCH_ONLY', 'EXISTING_AUTHORIZED_PROCESS'].includes(d.scope), '七、建议范围须为只供研究或进入现有授权流程')
    if (d.scope === 'EXISTING_AUTHORIZED_PROCESS') need(!!d.rule && EXISTING_RULES.includes(d.rule), '七、进入现有授权流程只限 C 级清退、单票归位、熔断')
    else need(d.rule == null, '七、只供研究的建议不挂现行规则')
    need(!BUY.test(d.text ?? ''), `七、建议不能含买入类指令：${d.text}`)
    need(!SHARES.test(d.text ?? ''), `七、建议不写股数（股数只由执行单给出）：${d.text}`)
  }

  need(j.verification?.status === 'PENDING', '八、研判时事后验证只能是待验证；验证另起记录')
  need(DATE.test(j.verification?.due ?? '') && (j.verification?.due ?? '') >= (j.review?.date ?? ''), '八、验证到期日不早于复核日期')
  return err
}

/** 校验事后验证记录 */
export function validateVerification(
  v: VerificationRecord,
  judgmentOf: (file: string) => { sha256: string; record: JudgmentRecord } | null,
  packageOf: (file: string) => PackageLookup | null,
): string[] {
  const err: string[] = []
  const need = (ok: unknown, msg: string) => { if (!ok) err.push(msg) }
  need(v.kind === 'VERIFICATION' && v.version === 'V1.0', 'kind 必须是 VERIFICATION，version 必须是 V1.0')
  need(/^V-\d{4}-\d{2}-\d{2}-\d{2}$/.test(v.id ?? ''), '编号格式为 V-YYYY-MM-DD-NN')
  need(ISO.test(v.recordedAt ?? ''), '记录时刻须为带时区的 ISO 时间')
  need(!!v.recordedBy?.trim(), '须写明记录人')
  need(v.producesAction === false, 'producesAction 必须为 false')
  const j = v.judgment ? judgmentOf(v.judgment.file) : null
  need(!!j, `回指的研判记录不在档案里：${v.judgment?.file}`)
  if (j) {
    need(j.sha256 === v.judgment.sha256, '回指研判的指纹与档案不符')
    need(j.record.id === v.judgment.id, '回指研判的编号与档案不符')
    need(toMs(v.recordedAt) > toMs(j.record.recordedAt), '验证记录必须晚于原研判')
  }
  for (const p of v.packages ?? []) {
    const ref = packageOf(p.file)
    need(!!ref && ref.sha256 === p.sha256, `验证依据的证据包不在档案里或指纹不符：${p.file}`)
    if (ref && j) need(toMs(ref.pkg.generatedAt) > toMs(j.record.recordedAt), `验证依据的证据包须晚于原研判：${p.file}`)
  }
  need(['SUPPORTED', 'PARTLY_SUPPORTED', 'FALSIFIED', 'UNDETERMINABLE'].includes(v.outcome), '结论须为支持、部分支持、证伪或仍无法判断')
  need(!!v.observed?.trim(), '须写后续实际观察到什么')
  if (v.outcome !== 'SUPPORTED') {
    need((v.errorSources?.length ?? 0) > 0, '非「支持原判断」时须写错误来源（数据、逻辑或执行）')
    need((v.errorSources ?? []).every(e => ['DATA', 'LOGIC', 'EXECUTION'].includes(e)), '错误来源只能是数据、逻辑、执行')
    need(!!v.errorNote?.trim(), '须说明错误来源')
  }
  for (const n of v.nodes ?? []) need(NODE_ORDER.includes(n.node), `未知节点 ${n.node}`)
  return err
}
