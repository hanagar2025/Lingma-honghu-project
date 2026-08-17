// 每日驾驶舱 —— 类型层
//
// 本文件的存在理由只有一条（委员会 2026-08-13 锁死的原则）：
//   「任何模型只要没有经过样本外检验，就只能叫『观察指标』，不能偷偷升级成决策规则。」
//
// 这条原则如果只写在文档里，迟早会在某个盘感强烈的日子被绕过。所以它在这里被写成类型：
//   - 动作（买/持/减/不动作）只能由 LegalReason 产生；
//   - LegalReason 枚举里**没有任何预测性成员**，"技术结构恶化" 不在其中；
//   - 观察指标（Observation）在类型上无法出现在动作的 reason 字段里。
//
// 换句话说：想让一个技术指标产生减仓单，必须先改这个文件。改动会被 CI 自检拦住。

/**
 * 证据等级 —— 决定一个信号有没有资格产生动作。
 *
 * ACCOUNTING：账务事实。总资产、现金、仓位占比、回撤。与预测无关，直接可产生动作。
 * VALIDATED：经样本外检验且置信区间不含 0。当前**仅一项**够格（10日涨幅>50%，见 promotion.ts）。
 * OBSERVATION：未检验、或检验未通过、或检验证伪。**只能触发复核，不得产生动作。**
 */
export type EvidenceTier = 'ACCOUNTING' | 'VALIDATED' | 'OBSERVATION'

export const EVIDENCE_TIER_TEXT: Record<EvidenceTier, string> = {
  ACCOUNTING: '账务事实·可直接产生动作',
  VALIDATED: '已样本外检验·可产生动作',
  OBSERVATION: '观察指标·只触发复核，不得产生动作',
}

/**
 * 法定理由 —— 动作的唯一合法依据。
 *
 * 刻意做成只含**与预测无关**的项。每一条都能回答"为什么现在必须动"，
 * 而不需要回答"接下来会涨还是会跌"。
 *
 * 2026-08-13 回测背景：TPO 退出信号后继续持有的 20 日超额代价仅约 1pct、60日为 +0.56pct。
 * 即"技术结构恶化"预测不出后续跑输。故它被排除在本枚举之外，只能进 Observation。
 */
export type LegalReason =
  // ── 减仓/清仓侧 ──
  | 'POSITION_LIMIT'      // 单票仓位超过 12% 上限
  | 'SECTOR_LIMIT'        // 板块超过 30%
  | 'THEME_LIMIT'         // 主题超过 45%
  | 'CIRCUIT_BREAKER'     // 组合净值回撤触发熔断的风险预算
  | 'FAMILY_SAFETY_NET'   // 家庭刚性支出安全垫不足
  | 'HARD_STOP'           // 个股自成本回撤触发硬止损的风险预算
  | 'STRATEGY_FALSIFIED'  // 战略层四种证伪情形之一成立（须引用具体条款）
  // ── 买入侧 ──
  | 'S3_PASSED_ALL_GATES' // 四阶段晋级至 S3 且四道闸门全部放行
  // ── 不动作侧 ──
  | 'NO_LEGAL_TRIGGER'    // 无任何法定理由成立 → 什么都不做
  | 'EXECUTION_DEBT'      // 存在未执行卖出指令 → 优先清偿，禁止新增建仓
  | 'DATA_INCOMPLETE'     // 决策所需数据不完整 → 不得据此行动

export const LEGAL_REASON_TEXT: Record<LegalReason, string> = {
  POSITION_LIMIT: '单票仓位超过12%上限',
  SECTOR_LIMIT: '板块仓位超过30%上限',
  THEME_LIMIT: '主题仓位超过45%上限',
  CIRCUIT_BREAKER: '组合回撤触发熔断风险预算',
  FAMILY_SAFETY_NET: '家庭刚性支出安全垫不足（2026-08-15 起不再产生动作，仅供解析历史档）',
  HARD_STOP: '个股自成本回撤触发硬止损风险预算',
  STRATEGY_FALSIFIED: '战略层证伪情形成立',
  S3_PASSED_ALL_GATES: '晋级S3且四道闸门全部放行',
  NO_LEGAL_TRIGGER: '无任何法定理由成立',
  EXECUTION_DEBT: '存在未执行卖出指令，优先清偿',
  DATA_INCOMPLETE: '决策所需数据不完整',
}

/**
 * 明令禁止出现在动作理由中的措辞。用于运行期兜底与自检。
 *
 * 为什么类型已经限制了还要再加一层字符串检查：
 *   动作附带的自由文本（detail/note）仍可能夹带预测口吻，读的人只看那句话。
 *   理由栏干净但备注里写"预计明天补跌"，等于换个地方违规。
 */
export const FORBIDDEN_REASON_PHRASES = [
  '要跌', '会跌', '将跌', '预计下跌', '即将回调', '见顶', '顶部已现',
  '要涨', '会涨', '将涨', '预计上涨', '即将启动', '起飞', '底部已现',
  '技术结构恶化', '技术形态破位', '趋势走坏',
] as const

/** 带出处的指标 —— 驾驶舱里每个数字都必须能点开看它是怎么来的 */
export interface Metric {
  label: string
  /** 展示值（已格式化）。null 表示数据缺失，前端须显式显示"缺失"而非 0 */
  display: string
  /** 原始值，供比较与排序 */
  value: number | null
  /** 数据来源，如"腾讯日K(未复权)"、"account_state.cash"、"东方财富RPT_LICO_FN_CPD" */
  source: string
  /** 计算过程，须能让人手工复算 */
  formula: string
  /** 数据截至时点 */
  asOf: string
  /** 该指标的证据等级 */
  tier: EvidenceTier
  /** 数据缺失原因（value 为 null 时必填） */
  missingReason?: string
}

/**
 * 三色灯 + 两种非评价状态。
 *
 * `UNKNOWN` 与 `EXCLUDED` 必须分开 —— 委员会 2026-08-15 明确：
 * 「没有数据」意味着系统不完整；「这个变量被裁定不使用」意味着系统完整，只是不用这一维。
 * 前者应当持续提示补数据，后者不应再出现在待办里。
 */
export type Light = 'GREEN' | 'YELLOW' | 'RED' | 'UNKNOWN' | 'EXCLUDED'

export const LIGHT_TEXT: Record<Light, string> = {
  GREEN: '正常',
  YELLOW: '风险升高',
  RED: '必须处理',
  UNKNOWN: '数据缺失·按必须处理对待',
  EXCLUDED: '战略层裁定不纳入模型',
}

export type ActionKind = 'BUY' | 'HOLD' | 'REDUCE' | 'NONE'

export const ACTION_TEXT: Record<ActionKind, string> = {
  BUY: '买入', HOLD: '持有', REDUCE: '减仓', NONE: '不动作',
}

/**
 * 今日动作。构造入口是 `makeAction()`，它会强制校验：
 *   ① reason 必须是 LegalReason；
 *   ② detail 不得包含 FORBIDDEN_REASON_PHRASES；
 *   ③ observations 只能进入 `reviewTriggers`，不得进入 reason。
 */
export interface Action {
  code: string
  name: string
  kind: ActionKind
  /** 法定理由 —— 唯一合法依据 */
  reason: LegalReason
  /** 法定理由的具体数值说明，如"仓位16.2% > 上限12%，超出4.2pct" */
  reasonDetail: string
  /** 明确写出"不是理由"的东西，防止读者自行补上预测性解释 */
  notReason: string[]
  /** 触发复核的观察项。**不构成动作理由**，仅提示人工关注 */
  reviewTriggers: string[]
  /** 具体执行量（股数/金额），数据不足时为 null 并说明 */
  size: { display: string; value: number | null; note: string }
  /** 支撑该动作的指标，供追溯 */
  metrics: Metric[]
}

export class IllegalActionError extends Error {}

/**
 * 动作的唯一构造入口。任何绕过它直接拼 Action 字面量的代码，都会被自检抓到
 * （自检会遍历报告里全部动作，重跑这里的校验）。
 */
export function makeAction(a: Action): Action {
  if (!(a.reason in LEGAL_REASON_TEXT)) {
    throw new IllegalActionError(`非法理由：${a.reason} 不在法定理由枚举内`)
  }
  const texts = [a.reasonDetail, ...a.notReason, a.size.note]
  for (const t of texts) {
    for (const bad of FORBIDDEN_REASON_PHRASES) {
      if (t.includes(bad)) {
        throw new IllegalActionError(
          `动作理由含预测性措辞"${bad}"：${t}。预测性表述只能出现在 reviewTriggers（观察项）中`
        )
      }
    }
  }
  // 买入必须有闸门全放行的法定理由；减仓必须有与预测无关的风险预算理由
  if (a.kind === 'BUY' && a.reason !== 'S3_PASSED_ALL_GATES') {
    throw new IllegalActionError(`买入动作的法定理由只能是 S3_PASSED_ALL_GATES，实为 ${a.reason}`)
  }
  // FAMILY_SAFETY_NET 已于 2026-08-15 退出白名单。
  //
  // 这是「安全垫不纳入 TIOS 风控模型」的直接推论：一个不纳入模型的维度
  // 不能再产生减仓的法定理由。枚举值本身保留 —— 8/15 之前的审计档里有引用它的记录，
  // 删掉枚举会让那些历史记录无法解析。
  const reduceLegal: LegalReason[] = [
    'POSITION_LIMIT', 'SECTOR_LIMIT', 'THEME_LIMIT',
    'CIRCUIT_BREAKER', 'HARD_STOP', 'STRATEGY_FALSIFIED',
  ]
  if (a.kind === 'REDUCE' && !reduceLegal.includes(a.reason)) {
    throw new IllegalActionError(
      `减仓动作的法定理由必须是风险预算类（${reduceLegal.join('/')}），实为 ${a.reason}。` +
      `技术结构类判据只能进 reviewTriggers`
    )
  }
  return a
}

/** 六问中的每一问 */
export interface Answer {
  /** 第几问 */
  no: 1 | 2 | 3 | 4 | 5 | 6
  question: string
  light: Light
  /** 一句话回答 —— 首页只显示这句 */
  headline: string
  metrics: Metric[]
  /** 详情行，供展开查看 */
  rows: AnswerRow[]
}

export interface AnswerRow {
  label: string
  status: string
  light: Light
  /** 该行的决策含义。可以是"继续跟踪"这种非动作表述 */
  decision: string
  metrics?: Metric[]
  /** 观察项：只触发复核 */
  reviewTriggers?: string[]
}

/** 首页那张唯一的表 */
export interface CockpitRow {
  item: string
  todayStatus: string
  light: Light
  decision: string
}

export interface CockpitReport {
  date: string
  /** 首页单表 */
  table: CockpitRow[]
  /** 最下面那一句 */
  coreDecision: string
  /** 六问 */
  answers: Answer[]
  /** 今日全部动作。可以为空数组 —— 空即"今日什么都不要做" */
  actions: Action[]
  /** 今日无新增建仓的显式结论与逐条原因 */
  noNewEntry: { verdict: boolean; reasons: string[] }
  /** 模型能力披露 —— 强制随报告输出 */
  disclosure: {
    headline: string
    items: { model: string; tier: EvidenceTier; measured: string }[]
  }
  /** 数据缺口清单 —— 缺什么就明说缺什么，不用默认值糊过去 */
  dataGaps: string[]
  /**
   * 中间结果，供五层驾驶舱装配层（dashboard.ts）复用。
   *
   * 存在的理由是**防漂移**：驾驶舱四张表与六问必须来自同一次计算。
   * 若装配层自己再算一遍相对强度或健康度，两处口径迟早不一致，
   * 而读表的人无法察觉。类型为 unknown 是为避免 types.ts 反向依赖引擎模块。
   */
  internals?: { momentumRows: unknown[]; msr: unknown; nodes: unknown[] }
}
