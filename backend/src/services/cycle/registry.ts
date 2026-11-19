/**
 * CY-01 · 指标登记表（V1.0，2026-10-17 登记）
 *
 * 每项指标写明：引用的现有模块字段、数据源现状、更新频率、正常区间、恶化条件、复核动作、缺口类型。
 * 正常区间与恶化条件除「现行规则」外一律待裁定，不生效：总表不据此归类支持或反证，也不给出 C0–C3。
 * 候选口径来自委员会 2026-10-17 的五层建议与已有模块，只是登记，不是裁定。
 *
 * 复核动作只有复核，没有交易。组合层引用的现行规则（单票 12%、熔断）由执行单执行，本表不重复执行。
 */

import type { GapType, Indicator, Param, SourceRef } from './types'

export const REGISTER_ID = 'CY-01'
export const REGISTERED_ON = '2026-10-17'

const pending = (text: string, ref: string | null = '委员会 2026-10-17 五层建议（候选）'): Param => ({ status: 'PENDING', text, ref })
const none = (): Param => ({ status: 'PENDING', text: '未提出候选口径', ref: null })
const rule = (text: string, ref: string): Param => ({ status: 'EXISTING_RULE', text, ref })

const R02 = (field: string): SourceRef => ({ module: 'R-02', path: 'backend/src/services/research/data/rerating/{asOf}.json、{asOf}-next.json', field })
const PARAMS: GapType[] = ['NORMAL_RANGE', 'DETERIORATION']

export const INDICATORS: Indicator[] = [
  // ── L1 宏观与资金成本 ──
  {
    id: 'L1-01', layer: 'L1', line: 'CONTEXT', nodes: null, name: '美国 10 年期国债收益率及变化速度',
    question: '折现率是否持续上行', source: { module: 'M-01', path: 'backend/src/services/research/macroRiskLights.ts', field: 'READINGS[item 含 10Y]' },
    dataSource: 'M-01 只有委员会 9/22 转录值，状态 EXTERNAL_READ_NOT_WIRED；候选公开源 FRED DGS10，未接入', freq: 'DAILY',
    normal: pending('M-01 委员会 9/22 原样登记：10Y < 4.8% 为绿；该口径有规格缺陷（5.0% 黄红相接、无滞后带）', 'M-01 specDefects'),
    deterioration: pending('收益率持续上行、信用利差扩大，且成长股同步走弱；单日波动不够'),
    reviewAction: '复核高估值持仓的估值地基（L4-04）与资金成本敏感度', gaps: ['SOURCE', 'UPDATE', ...PARAMS],
  },
  {
    id: 'L1-02', layer: 'L1', line: 'CONTEXT', nodes: null, name: '美元指数', question: '美元是否持续走强、收紧全球流动性',
    source: null, dataSource: '现有模块没有；候选公开源 FRED DTWEXBGS，未接入', freq: 'DAILY',
    normal: none(), deterioration: none(), reviewAction: '与 L1-01 一并复核', gaps: ['SOURCE', ...PARAMS],
  },
  {
    id: 'L1-03', layer: 'L1', line: 'CONTEXT', nodes: null, name: '通胀与美联储政策预期', question: '降息预期是否落空、政策是否转紧',
    source: null,
    dataSource: 'M-01 READINGS 没有通胀与政策预期读数；现有模块没有', freq: 'EVENT',
    normal: none(), deterioration: none(), reviewAction: '与 L1-01 一并复核', gaps: ['SOURCE', ...PARAMS],
  },
  {
    id: 'L1-04', layer: 'L1', line: 'CONTEXT', nodes: null, name: '信用利差', question: '风险资产融资条件是否收紧',
    source: { module: 'F-01', path: 'backend/src/services/research/aiFinancingQuality.ts', field: 'buildAiFinancingQualityView().firstJudgment.bondIssuance.committeeNotes（委员会转述利差约 89bp）' },
    dataSource: '只有 F-01 委员会转录；候选公开源 FRED BAMLH0A0HYM2（高收益利差），未接入', freq: 'DAILY',
    normal: none(), deterioration: pending('信用利差扩大，与 L1-01 上行、成长股走弱同时出现'),
    reviewAction: '复核 L1-05 AI 融资压力与 L2-03 回报匹配', gaps: ['SOURCE', 'UPDATE', ...PARAMS],
  },
  {
    id: 'L1-05', layer: 'L1', line: 'CONTEXT', nodes: null, name: 'AI 企业融资成本与债务压力', question: 'AI 资本开支是否越来越依赖债务融资',
    source: { module: 'F-01', path: 'backend/src/services/research/aiFinancingQuality.ts', field: 'buildAiFinancingQualityView().observationTable[item=AI相关债务融资 / 融资成本]（UNVERIFIED）' },
    dataSource: 'F-01 定性观察表，全部 UNVERIFIED；没有数据源', freq: 'MANUAL',
    normal: none(), deterioration: pending('融资依赖加深，同时 L2-03 回报跟不上投入'), reviewAction: '复核算力与光连接节点的客户集中与融资风险',
    gaps: ['SOURCE', 'UPDATE', ...PARAMS],
  },
  // ── L2 AI 总需求与资本开支 ──
  {
    id: 'L2-01', layer: 'L2', line: 'CONTEXT', nodes: null, name: '主要云厂商资本开支指引与实际支出', question: '云厂商还在加码吗',
    source: { module: 'F-01', path: 'backend/src/services/research/aiFinancingQuality.ts', field: 'observationTable[item=Hyperscaler CapEx]；firstJudgment.bondIssuance.committeeNotes（Google 资本开支指引）' },
    dataSource: '只有转录；季报与业绩会口径需人工录入，未建数据表', freq: 'QUARTERLY',
    normal: none(), deterioration: pending('资本开支指引下调；或仍增长但回报跟不上投入（见 L2-03）'),
    reviewAction: '复核全部节点的需求假设；资本开支仍增长不代表风险消失', gaps: ['SOURCE', 'UPDATE', ...PARAMS],
  },
  {
    id: 'L2-02', layer: 'L2', line: 'CONTEXT', nodes: null, name: 'AI 云服务收入、订单、积压订单与利用率', question: '花出去的钱有没有收入',
    source: { module: 'C-01', path: 'backend/src/services/research/capexLadder.ts', field: 'DEMAND_EVIDENCE[]（PUBLIC_NOT_YET_WIRED / UNVERIFIED）' },
    dataSource: 'C-01 只有转录的算力合同金额；没有系统数据', freq: 'QUARTERLY',
    normal: none(), deterioration: none(), reviewAction: '与 L2-01 一并复核', gaps: ['SOURCE', 'UPDATE', ...PARAMS],
  },
  {
    id: 'L2-03', layer: 'L2', line: 'CONTEXT', nodes: null, name: '资本开支增长与收入、经营现金流增长是否匹配', question: '投入与回报是否背离',
    source: { module: 'F-01', path: 'backend/src/services/research/aiFinancingQuality.ts', field: 'buildAiFinancingQualityView().observationTable[item=FCF / AI CapEx ROI / AI收入兑现]' },
    dataSource: 'F-01 定性（FCF 分化、ROI UNKNOWN）；没有数据', freq: 'QUARTERLY',
    normal: none(), deterioration: pending('回报跟不上投入、融资依赖加深'), reviewAction: '复核估值重估风险（L4-04）', gaps: ['SOURCE', ...PARAMS],
  },
  {
    id: 'L2-04', layer: 'L2', line: 'CONTEXT', nodes: null, name: 'NVDA、AVGO 等 AI 总线公司业绩与指引', question: '总线公司的收入与毛利指引是否放缓',
    source: { module: 'A-01', path: 'backend/src/services/research/aiFourActs.ts', field: 'buildAiFourActsView().facts.nvidiaEarnings.committeeNotes（PUBLIC_NOT_YET_WIRED）' },
    dataSource: '只有转录（8 月季报）；未接入', freq: 'QUARTERLY',
    normal: none(), deterioration: none(), reviewAction: '复核光连接、算力节点需求假设', gaps: ['SOURCE', 'UPDATE', ...PARAMS],
  },
  // ── L3 产业链供需与利润（逐节点） ──
  {
    id: 'L3-01', layer: 'L3', line: 'OPERATING', nodes: ['OPTICAL', 'PCB', 'COMPUTE', 'SEMI_EQUIP', 'POWER'], name: '累计营收同比',
    question: '收入增长是否放缓', source: R02('views[].latest.revenueYoy'), dataSource: 'R-02 快照（东方财富 RPT_LICO_FN_CPD）', freq: 'QUARTERLY',
    normal: none(), deterioration: pending('订单放缓、价格或毛利率恶化、盈利预期下修相互印证（C2 证据之一）'),
    reviewAction: '复核该节点订单与产品价格', gaps: PARAMS,
  },
  {
    id: 'L3-02', layer: 'L3', line: 'OPERATING', nodes: ['OPTICAL', 'PCB', 'COMPUTE', 'SEMI_EQUIP', 'POWER'], name: '单季归母净利同比',
    question: '单季利润增速是否见顶', source: R02('views[].quarters[0].netProfitYoy'), dataSource: 'R-02 快照', freq: 'QUARTERLY',
    normal: none(), deterioration: none(), reviewAction: '复核利润来源（扣非、毛利率、费用）', gaps: PARAMS,
  },
  {
    id: 'L3-03', layer: 'L3', line: 'OPERATING', nodes: ['OPTICAL', 'PCB', 'COMPUTE', 'SEMI_EQUIP', 'POWER'], name: '累计扣非净利同比',
    question: '主营利润是否仍在增长', source: R02('views[].latest.deductNetProfitYoy'), dataSource: 'R-02 快照（RPT_DMSK_FN_INCOME）', freq: 'QUARTERLY',
    normal: none(), deterioration: none(), reviewAction: '复核扣非与归母背离（R-02 读数提示）', gaps: PARAMS,
  },
  {
    id: 'L3-04', layer: 'L3', line: 'OPERATING', nodes: ['OPTICAL', 'PCB', 'COMPUTE', 'SEMI_EQUIP', 'POWER'], name: '单季毛利率及环比',
    question: '供给增加是否已传导到毛利率', source: R02('views[].quarters[0..1].grossMargin'), dataSource: 'R-02 快照', freq: 'QUARTERLY',
    normal: none(), deterioration: pending('产能扩张只是先行信号；只有传导到价格、毛利率、订单或盈利预期才算周期压力兑现'),
    reviewAction: '复核产品价格与产能（L3-10、L3-11）', gaps: PARAMS,
  },
  {
    id: 'L3-05', layer: 'L3', line: 'OPERATING', nodes: ['OPTICAL', 'PCB', 'COMPUTE', 'SEMI_EQUIP', 'POWER'], name: '经营现金流 / 归母净利',
    question: '利润是否有现金支撑', source: R02('views[].cashConversion'), dataSource: 'R-02 快照（累计口径）', freq: 'QUARTERLY',
    normal: none(), deterioration: none(), reviewAction: '复核应收与存货（L3-07、L3-08）', gaps: PARAMS,
  },
  {
    id: 'L3-06', layer: 'L3', line: 'OPERATING', nodes: ['OPTICAL', 'PCB', 'COMPUTE', 'SEMI_EQUIP', 'POWER'], name: '合同负债同比（订单先行旁证）',
    question: '在手订单是否减速', source: R02('views[].balanceYoy.contractLiab'), dataSource: 'R-02 快照（东方财富 F10 资产负债表）', freq: 'QUARTERLY',
    normal: none(), deterioration: none(), reviewAction: '设备节点同时复核验收与收入确认（L3-12）', gaps: PARAMS,
  },
  {
    id: 'L3-07', layer: 'L3', line: 'OPERATING', nodes: ['OPTICAL', 'PCB', 'COMPUTE', 'SEMI_EQUIP', 'POWER'], name: '存货同比',
    question: '是否在累积库存', source: R02('views[].balanceYoy.inventory'), dataSource: 'R-02 快照', freq: 'QUARTERLY',
    normal: none(), deterioration: pending('R-02 读数提示：存货增速明显快于营收（提示，不是门槛）', 'R-02 caveats'),
    reviewAction: '复核库存性质（备货还是滞销）', gaps: PARAMS,
  },
  {
    id: 'L3-08', layer: 'L3', line: 'OPERATING', nodes: ['OPTICAL', 'PCB', 'COMPUTE', 'SEMI_EQUIP', 'POWER'], name: '应收同比',
    question: '收款质量是否变差', source: R02('views[].balanceYoy.receivables'), dataSource: 'R-02 快照', freq: 'QUARTERLY',
    normal: none(), deterioration: pending('R-02 读数提示：应收增速明显快于营收（提示，不是门槛）', 'R-02 caveats'),
    reviewAction: '复核客户集中与回款', gaps: PARAMS,
  },
  {
    id: 'L3-09', layer: 'L3', line: 'OPERATING', nodes: ['OPTICAL', 'PCB', 'COMPUTE', 'SEMI_EQUIP', 'POWER'], name: '一致预期节奏',
    question: '一致预期要求的利润加速是否现实', source: R02('views[].consensusPace.ratio'), dataSource: 'R-02 快照（东方财富一致预期）；历史只从 10/15 起存档', freq: 'QUARTERLY',
    normal: none(), deterioration: pending('R-02 读数提示：比值 < 0.6 或 > 1.5（提示，不是门槛）', 'R-02 caveats'),
    reviewAction: '复核盈利预期是否开始下修（下修历史需快照积累）', gaps: ['UPDATE', ...PARAMS],
    note: '一致预期历史没有存档，「盈利预期下修」现在只能从 10/15 起按快照比较',
  },
  {
    id: 'L3-10', layer: 'L3', line: 'OPERATING', nodes: ['OPTICAL', 'STORAGE', 'PCB'], name: '产品价格（存储合同价、800G/1.6T、高端 PCB）',
    question: '供需是否从紧缺走向平衡', source: null, dataSource: '没有免费可靠数据源（存储合同价、光模块价格均为付费或非公开）', freq: 'MANUAL',
    normal: none(), deterioration: pending('价格下行并传导至毛利率（L3-04）'), reviewAction: '复核该节点供需', gaps: ['SOURCE', ...PARAMS],
  },
  {
    id: 'L3-11', layer: 'L3', line: 'OPERATING', nodes: ['OPTICAL', 'PCB', 'COMPUTE', 'SEMI_EQUIP', 'POWER'], name: '在建工程同比（产能扩张先行信号）',
    question: '是否在大幅扩产', source: R02('views[].balanceYoy.constructionInProgress'), dataSource: 'R-02 快照', freq: 'QUARTERLY',
    normal: none(), deterioration: pending('产能扩张只是先行信号，本身不构成恶化'), reviewAction: '跟踪 L3-04 与 L3-10 是否随后恶化', gaps: PARAMS,
  },
  {
    id: 'L3-12', layer: 'L3', line: 'OPERATING', nodes: ['SEMI_EQUIP'], name: '设备订单、验收与收入确认',
    question: '订单是否转为收入与现金', source: null, dataSource: '没有结构化数据；合同负债（L3-06）与应收（L3-08）只是旁证', freq: 'QUARTERLY',
    normal: none(), deterioration: none(), reviewAction: '季报披露后人工核对', gaps: ['SOURCE', ...PARAMS],
  },
  {
    id: 'L3-13', layer: 'L3', line: 'OPERATING', nodes: ['STORAGE'], name: '存储供需：库存、扩产、产品代际与国产进展',
    question: '存储周期与竞争格局是否转变', source: null, dataSource: '没有数据源；只能录入委员会核实的事实（facts.json）', freq: 'EVENT',
    normal: none(), deterioration: none(), reviewAction: '与 L3-10 一并复核；不外推到其他节点', gaps: ['SOURCE', ...PARAMS],
  },
  // ── L4 股价与市场结构 ──
  {
    id: 'L4-01', layer: 'L4', line: 'PRICE', nodes: ['OPTICAL', 'PCB', 'COMPUTE', 'SEMI_EQUIP', 'POWER'], name: '20 日 / 60 日收益',
    question: '价格是否转弱', source: R02('views[].ret20 / ret60'), dataSource: 'R-02 快照（腾讯日线，取数日见 asOf）；驾驶舱每日计算但未落盘', freq: 'DAILY',
    normal: none(), deterioration: none(), reviewAction: '与 L3 对照：价格先弱、经营仍强 → 优先查估值与拥挤度', gaps: ['UPDATE', ...PARAMS],
  },
  {
    id: 'L4-02', layer: 'L4', line: 'PRICE', nodes: ['OPTICAL', 'PCB', 'COMPUTE', 'SEMI_EQUIP', 'POWER'], name: '20 日 / 60 日相对沪深 300 超额',
    question: '是否持续跑输', source: R02('views[].rs20 / rs60'), dataSource: 'R-02 快照；相对行业超额在驾驶舱，未落盘', freq: 'DAILY',
    normal: none(), deterioration: pending('先看高位核心股是否持续跑输行业，再看下跌是否从高估值弹性股扩散到盈利稳健的中军'),
    reviewAction: '提高该节点 TPO 复核优先级（TPO 仍是诊断工具）', gaps: ['UPDATE', ...PARAMS],
  },
  {
    id: 'L4-03', layer: 'L4', line: 'PRICE', nodes: ['OPTICAL', 'PCB', 'COMPUTE', 'SEMI_EQUIP', 'POWER'], name: '距 250 日高点回撤',
    question: '回撤处于什么位置', source: R02('views[].drawdown250'), dataSource: 'R-02 快照', freq: 'DAILY',
    normal: none(), deterioration: none(), reviewAction: '与 L4-02 一并看', gaps: ['UPDATE', ...PARAMS],
  },
  {
    id: 'L4-04', layer: 'L4', line: 'PRICE', nodes: ['OPTICAL', 'PCB', 'COMPUTE', 'SEMI_EQUIP', 'POWER'], name: 'PE（TTM）3 年分位',
    question: '估值是否过热', source: R02('views[].pePercentile3y'), dataSource: 'R-02 快照（复用 msr/valuation.ts）', freq: 'DAILY',
    normal: none(), deterioration: pending('估值和成交集中度升高、股价明显领先盈利（C1 证据之一）'),
    reviewAction: '提高 TPO 复核优先级', gaps: ['UPDATE', ...PARAMS],
  },
  {
    id: 'L4-05', layer: 'L4', line: 'PRICE', nodes: ['OPTICAL', 'PCB', 'COMPUTE', 'SEMI_EQUIP', 'POWER'], name: '成交额份额与资金状态（R-01 七状态）',
    question: '资金是否先于业绩撤退', source: { module: 'R-01', path: 'share/money/latest.json', field: 'entries[].objects[].state / divergence' },
    dataSource: 'R-01 资金哨兵已发布文件（每日定时任务待 PR #36 合并）', freq: 'DAILY',
    normal: none(), deterioration: none(), reviewAction: '资金信号只改变研究优先级', gaps: ['UPDATE', ...PARAMS],
  },
  {
    id: 'L4-06', layer: 'L4', line: 'CONTEXT', nodes: null, name: 'NVDA、AVGO 等 AI 总线股价与相对强弱', question: '海外 AI 总线是否转弱',
    source: null, dataSource: '现有模块没有；未接入', freq: 'DAILY', normal: none(), deterioration: none(),
    reviewAction: '与国内节点对照，不直接外推', gaps: ['SOURCE', ...PARAMS],
  },
  {
    id: 'L4-07', layer: 'L4', line: 'CONTEXT', nodes: null, name: '创新高数量与市场广度', question: '上涨是否在收窄',
    source: { module: 'B-01', path: 'backend/src/services/research/marketStructureWatch.ts', field: 'SESSION_CHECKS[item=Breadth Quality]（QUOTE_NOT_ARCHIVED）；M-01 READINGS[item 含 新高新低]（美股）' },
    dataSource: 'B-01 只有委员会 9/22 转录；行情未存档', freq: 'DAILY', normal: none(), deterioration: none(),
    reviewAction: '与 L4-02 一并看', gaps: ['SOURCE', 'UPDATE', ...PARAMS],
  },
  // ── L5 组合风险与 TPO ──
  {
    id: 'L5-01', layer: 'L5', line: 'PORTFOLIO', nodes: null, name: '组合自峰值回撤', question: '组合处于哪一级熔断',
    source: { module: '执行单', path: 'share/decision/latest.md', field: '「熔断：」行' }, dataSource: '每日执行单', freq: 'DAILY',
    normal: rule('一级熔断 15%、二级 25%（cockpit/safety.ts LIMITS）', 'cockpit/safety.ts'),
    deterioration: rule('达熔断线：只卖不买；峰值 430 万待核验，组合层补足今日不执行、不撤销', '委员会 10/10 裁定'),
    reviewAction: '已由执行单处理；本表不另出动作', gaps: [],
  },
  {
    id: 'L5-02', layer: 'L5', line: 'PORTFOLIO', nodes: null, name: '现金比例', question: '现金是否低于底线',
    source: { module: '执行单', path: 'share/decision/latest.md', field: '「账户：」行' }, dataSource: '每日执行单', freq: 'DAILY',
    normal: rule('现金不低于 10%（LIMITS.cashFloor）', 'cockpit/safety.ts'), deterioration: rule('低于 10%', 'cockpit/safety.ts'),
    reviewAction: '驾驶舱提示；本表不另出动作', gaps: [],
  },
  {
    id: 'L5-03', layer: 'L5', line: 'PORTFOLIO', nodes: null, name: '单票占总资产', question: '单票是否超限',
    source: { module: 'L-01', path: 'share/ladder/latest.json', field: 'risk.sectors[].holdings[].pct' }, dataSource: '名单主表风险块（取价时点见 pricedAt）', freq: 'DAILY',
    normal: rule('单票不超过 12%（LIMITS.singleStock）', 'cockpit/safety.ts'), deterioration: rule('超过 12% → 执行单单票归位', 'cockpit/safety.ts'),
    reviewAction: '已由执行单单票归位处理；本表不另出动作', gaps: [],
  },
  {
    id: 'L5-04', layer: 'L5', line: 'PORTFOLIO', nodes: null, name: '板块与主题集中度', question: '集中度是否超限',
    source: { module: 'L-01', path: 'share/ladder/latest.json', field: 'risk.sectors[] / risk.themes[]' }, dataSource: '名单主表风险块', freq: 'DAILY',
    normal: rule('板块 30%、主题 45%（只显示，不自动出卖单）', '委员会 10/16 意见'), deterioration: rule('超限只显示；不是豁免，单票归位不等于板块风险解决', '委员会 10/16 意见'),
    reviewAction: '委员会复核集中度', gaps: [],
  },
  {
    id: 'L5-05', layer: 'L5', line: 'PORTFOLIO', nodes: null, name: '执行债务与峰值核验', question: '已有卖单是否执行完毕，峰值是否核验',
    source: { module: '账本', path: 'backend/data/portfolio.json', field: 'pendingSells / peakVerified' }, dataSource: '持仓账本', freq: 'EVENT',
    normal: rule('执行债务为 0、峰值已核验', '委员会 10/10 裁定'), deterioration: rule('执行债务未清 → 锁死全部建仓；峰值待核验 → 熔断补足不执行', '委员会 10/10 裁定'),
    reviewAction: '先核实真实持仓与成交；研究结论不绕过只卖不买', gaps: [],
  },
  {
    id: 'L5-06', layer: 'L5', line: 'PRICE', nodes: ['OPTICAL', 'PCB', 'COMPUTE', 'SEMI_EQUIP'], name: '持仓 TPO 诊断（相对自身趋势与行业）',
    question: '持仓是否在失去势能', source: { module: '驾驶舱 momentum', path: 'backend/src/services/cockpit/momentum.ts', field: 'evaluateMomentum().rows[].metrics[name=距MA60 / 60日相对行业超额]' },
    dataSource: '驾驶舱每日计算，只在 cockpit.html 与 SHARE=1 的 CSV 中出现，未落盘到仓库', freq: 'DAILY',
    normal: none(), deterioration: rule('TPO 只触发复核，不能产生动作（8/13 回测：信号后 60 日超额 +0.56pct，没有预测价值）', 'cockpit/momentum.ts'),
    reviewAction: '复核，不出卖单', gaps: ['UPDATE', 'NORMAL_RANGE'],
  },
]

/** 委员会 10/17 建议的 C0–C3 判定口径：全部待裁定 */
export const CYCLE_RULES = {
  status: 'PENDING' as const,
  note: '周期状态的判定条件待裁定：总表不自动给出 C0–C3，由研判记录逐节点给出并写明证据编号；C3 须多层证据共同确认',
}

export function indicatorById(id: string): Indicator | undefined {
  return INDICATORS.find(i => i.id === id)
}

export function pendingCount(): number {
  return INDICATORS.filter(i => i.normal.status === 'PENDING' || i.deterioration.status === 'PENDING').length
}
