// 五层驾驶舱 —— 组合 × 主线 × 产业链 × 新势能 × 执行
//
// 页面不做任何判断：箭头、份额、可判/不可判、阻断项全部由后端给出。
// 前端若自行折算，规则就会分裂成两份，而分裂的规则等于没有规则。
//
// 三条渲染纪律（委员会 2026-08-13）：
//   ① 不显示任何综合评分/星级 —— 数据不完整时它制造虚假精确感；
//   ② 缺失一律渲染成"缺失"，绝不渲染成 0；
//   ③ 数据完整度放在每张表的表头，不放表尾。

import React from 'react'
import { Alert, Card, Collapse, Space, Table, Tag, Tooltip, Typography } from 'antd'
import { WarningOutlined } from '@ant-design/icons'

const { Text, Title } = Typography

const ARROW_COLOR: Record<string, string> = {
  '↑↑': '#ff3b30', '↑': '#ff6b52', '→': '#8e8e93',
  '↓': '#0a84ff', '↓↓': '#0040dd', '?': '#c7c7cc', '↑早期': '#ff9500',
}

/** 箭头。'?' 渲染成灰色问号并给出解释，绝不留空 —— 留空会被读成"没问题" */
const Arrow: React.FC<{ v?: string; hint?: string }> = ({ v, hint }) => {
  if (!v) return <Text type="secondary">缺失</Text>
  const node = (
    <span style={{ color: ARROW_COLOR[v] ?? '#8e8e93', fontWeight: 600, fontSize: v === '↑早期' ? 13 : 16 }}>
      {v === '?' ? '?' : v}
    </span>
  )
  return hint || v === '?' ? <Tooltip title={hint ?? '数据不可得'}>{node}</Tooltip> : node
}

/** 百分比。null → "缺失" */
const Pct: React.FC<{ v: number | null | undefined; digits?: number; signed?: boolean }> = ({
  v, digits = 1, signed = false,
}) => {
  if (v === null || v === undefined) return <Text type="secondary" style={{ fontSize: 12 }}>缺失</Text>
  const color = signed ? (v > 0 ? '#ff3b30' : v < 0 ? '#0a84ff' : undefined) : undefined
  return (
    <Text style={{ color, fontVariantNumeric: 'tabular-nums' }}>
      {signed && v > 0 ? '+' : ''}{(v * 100).toFixed(digits)}%
    </Text>
  )
}

/** pct 点差值。这一列是"变化"，用户强调变化比绝对值更重要 */
const Pp: React.FC<{ v: number | null | undefined }> = ({ v }) => {
  if (v === null || v === undefined) return <Text type="secondary" style={{ fontSize: 12 }}>缺失</Text>
  return (
    <Text strong style={{ color: v > 0 ? '#ff3b30' : v < 0 ? '#0a84ff' : '#8e8e93', fontVariantNumeric: 'tabular-nums' }}>
      {v > 0 ? '+' : ''}{v.toFixed(1)}pct
    </Text>
  )
}

const Yi: React.FC<{ v: number | null | undefined }> = ({ v }) => {
  if (v === null || v === undefined) return <Text type="secondary" style={{ fontSize: 12 }}>缺失</Text>
  return <Text style={{ fontVariantNumeric: 'tabular-nums' }}>{(v / 1e8).toFixed(1)}亿</Text>
}

/** 数据完整度徽标 —— 表头最显眼处。不足则直接给出禁止性结论 */
const Completeness: React.FC<{ v: number | null | undefined; judgable?: boolean; blockers?: string[] }> = ({
  v, judgable, blockers,
}) => {
  if (v === null || v === undefined) {
    return <Tag color="default">数据完整度 缺失</Tag>
  }
  const pctText = `${(v * 100).toFixed(0)}%`
  if (judgable === false) {
    return (
      <Tooltip title={(blockers ?? []).join('；')}>
        <Tag color="red" icon={<WarningOutlined />}>
          数据完整度 {pctText} · 当前结论不可用于机会判断
        </Tag>
      </Tooltip>
    )
  }
  return <Tag color={v >= 0.6 ? 'green' : v >= 0.3 ? 'orange' : 'default'}>数据完整度 {pctText}</Tag>
}

const SECTION: React.CSSProperties = { marginBottom: 16 }

const wan = (v: number) => `${(v / 10000).toFixed(1)}万`
const pct = (v: number | null) => (v === null ? '缺失' : `${(v * 100).toFixed(1)}%`)

const CIRCUIT_TEXT: Record<string, string> = {
  NORMAL: '未触发',
  LEVEL1: '一级成立',
  LEVEL2: '二级成立',
  INCOMPARABLE: '不可判定',
}

// EXCLUDED 走 info（灰调）而非 warning：裁定排除不是待办，
// 让它在视觉上要求处理，等于把「不纳入模型」变成一条永久提醒。
const RISK_ALERT: Record<string, 'success' | 'warning' | 'error' | 'info'> = {
  GREEN: 'success', YELLOW: 'warning', RED: 'error', UNKNOWN: 'warning', EXCLUDED: 'info',
}

const SCOPE_TEXT: Record<string, string> = {
  STRUCTURE: '市场结构', HOLDING: '持仓', MAINLINE: '主线',
  NODE: '产业节点', NEXT_LAYER: '下一观察层',
}

const CHANGE_KIND_TEXT: Record<string, { color: string; label: string }> = {
  VALUE: { color: 'blue', label: '数值变化' },
  STATE: { color: 'purple', label: '状态变化' },
  APPEARED: { color: 'green', label: '由缺失变为有值' },
  DISAPPEARED: { color: 'orange', label: '由有值变为缺失' },
}

/**
 * 今日变化 —— 委员会 2026-08-13：核心输出从「谁可以买」改成「谁正在发生变化」。
 *
 * 预测能力未被证明，变化检测能力可以建立。因此这一区放在四张表之前。
 * 组内不排序、不加权：任何"重要性排序"都需要一个重要性评分，而评分已被写死禁止。
 */
const TodayChanges: React.FC<{ changes: any; discovery: any }> = ({ changes, discovery }) => {
  const items: any[] = changes?.items ?? []
  const prevDate: string | null = changes?.prevDate ?? null
  const advances: any[] = discovery?.advances ?? []

  return (
    <Card
      style={SECTION}
      title={<Title level={5} style={{ margin: 0 }}>今日变化 —— 谁正在发生变化？</Title>}
      extra={
        <Space>
          <Tag>{prevDate ? `对比 ${prevDate}` : '首次快照'}</Tag>
          <Tag color={items.length ? 'blue' : 'default'}>{items.length} 项变化</Tag>
          <Tag color={advances.length ? 'green' : 'default'}>闸门跃迁 {advances.length} 次</Tag>
        </Space>
      }
    >
      {!prevDate ? (
        <Alert
          type="info"
          showIcon
          message="首次建立快照，无可比较基准"
          description="明日起本区显示逐项变化。变化台账是 Discovery KPI 的唯一数据来源：30 天后要回答「当时我们看到了什么，后来发生了什么」，只能靠每天存下来。"
        />
      ) : items.length === 0 ? (
        <Alert
          type="success"
          showIcon
          message="今日无变化"
          description="这不是故障。多数交易日大部分读数确实不变；系统没有义务每天制造新发现。"
        />
      ) : (
        <Space direction="vertical" size={10} style={{ width: '100%' }}>
          {['STRUCTURE', 'HOLDING', 'MAINLINE', 'NODE', 'NEXT_LAYER'].map(scope => {
            const group = items.filter(c => c.scope === scope)
            if (!group.length) return null
            return (
              <div key={scope}>
                <Text strong style={{ fontSize: 13 }}>{SCOPE_TEXT[scope]}</Text>
                <div style={{ marginTop: 4 }}>
                  {group.map((c, i) => (
                    <div key={i} style={{ fontSize: 13, lineHeight: 1.9, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <Text type="secondary" style={{ minWidth: 200 }}>{c.key} · {c.field}</Text>
                      <Text delete type="secondary">{c.from}</Text>
                      <Text>→</Text>
                      <Text strong>{c.to}</Text>
                      {c.delta !== null && c.delta !== undefined && (
                        <Text style={{ color: c.delta > 0 ? '#ff3b30' : '#0a84ff' }}>
                          （{c.delta > 0 ? '+' : ''}
                          {c.from?.endsWith?.('%') && c.to?.endsWith?.('%')
                            ? `${(c.delta * 100).toFixed(1)}pct`
                            : Math.abs(c.delta) >= 1 ? c.delta.toFixed(2) : c.delta.toFixed(3)}）
                        </Text>
                      )}
                      <Tooltip title={CHANGE_KIND_TEXT[c.kind]?.label}>
                        <Tag color={CHANGE_KIND_TEXT[c.kind]?.color} style={{ marginInlineEnd: 0 }}>
                          {CHANGE_KIND_TEXT[c.kind]?.label ?? c.kind}
                        </Tag>
                      </Tooltip>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </Space>
      )}

      {advances.length > 0 && (
        <Alert
          type="success"
          showIcon
          style={{ marginTop: 12 }}
          message="闸门跃迁 —— 谁从 S0 → S1 → S2"
          description={
            <div style={{ fontSize: 13, lineHeight: 1.9 }}>
              {advances.slice(-8).map((a: any, i: number) => (
                <div key={i}>{a.date} · {a.key}：通过闸门 {a.from} → {a.to}（{a.gates}）</div>
              ))}
              <Text type="secondary" style={{ fontSize: 12 }}>
                跃迁只表示验证链上前进了一步，不表示获得行动资格。
              </Text>
            </div>
          }
        />
      )}
      {prevDate && advances.length === 0 && (
        <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 10 }}>
          尚无闸门跃迁。这本身是信息：说明没有任何节点在验证链上前进。
        </Text>
      )}
    </Card>
  )
}

/** 外部叙事台账。OBSERVATION 级 —— 只渲染，不提供任何操作入口 */
interface IndicatorView {
  no: number
  text: string
  status: 'MET' | 'UNVERIFIED' | 'REFUTED'
  horizon: 'CURRENT_FACT' | 'FUTURE_HYPOTHESIS'
  sourceTier: string
  evidence: string
}
interface PropositionView {
  id: 'A' | 'B'
  claim: string
  horizon: 'CURRENT_FACT' | 'FUTURE_HYPOTHESIS'
  indicators: IndicatorView[]
  verdictText: string
}
interface HypothesisView {
  id: string
  claim: string
  source: string
  loggedOn: string
  node: string
  mainline: string
  stage: number
  propositions: PropositionView[]
  doesNotImply: string[]
  blockers: string[]
  tier: string
  /** 后端已算好的四句话结论。前端不重算 —— 重算就会有两套口径 */
  fourLine?: { currentFact: string; aiAsDriver: string; superCycle: string; candidacy: string }
  /** 因果强度五层。防止把"行业事实→公司事实→因果→持续性→投资资格"压缩成一句看多 */
  causal?: { level: number; name: string; proves: string; status: string; basis: string }[]
  /** 待核验异常：是事实，但在解释完成前不构成因果证据 */
  pending?: { text: string; evidence: string; checklist: string[] }[]
  paidGaps?: string[]
  wiringBacklog?: string[]
}

// 七步链的步名。source 层级由后端下发，前端只显示不判断。
const CHAIN = [
  '产业事实', '公司收入', '主线收入归因', '扣非利润', '主线利润归因', '节点内利润份额', '战略许可',
] as const

const CAUSAL_STATUS_TEXT: Record<string, string> = {
  CONFIRMED: '✅ 可确认',
  PARTIAL: '部分',
  UNKNOWN: '❓ 未知',
  NOT_PROVEN: '❌ 当前数据不能证明',
  VETOED: '❌ 战略否决',
}

const SOURCE_TIER_TEXT: Record<string, string> = {
  PUBLIC_IN_PIPELINE: '公开财报·已在管道内',
  PUBLIC_NOT_YET_WIRED: '公开财报·尚未接入（工作量问题，非数据可得性问题）',
  PUBLIC_PARTIAL: '公开披露·仅可部分拆分，余下须人工核验',
  SYSTEM_COMPUTED: '系统自算',
  STRATEGY_RULING: '战略层裁定·非数据问题',
  NEEDS_PAID: '公开披露无法回答·须付费数据源',
}

/** 风控四层。后端 dashboard.ts 的 RiskLayer，此处只声明渲染用到的字段 */
interface RiskLayerView {
  id: string
  name: string
  state: string
  light: string
  canGenerateActions: boolean
  note: string
}

export interface FiveLayerDashboardProps {
  dashboard: any
  changes?: any
  discovery?: any
  /** 外部叙事台账。只渲染，不产生任何操作入口 */
  hypotheses?: HypothesisView[]
  /** 后端下发的盘中标记。未定价读数必须显式标注，否则会被当成收盘读数用 */
  provisional?: any
  /** 看台已展示变化时，这里不再重复铺一整区 */
  hideChanges?: boolean
  /** 电力价值传导图。只渲染，不产生任何操作入口 */
  powerChain?: any
  /** 组合防守层。只渲染，不产生任何操作入口 */
  portfolioDefense?: any
  /** 投资哲学参考。只渲染，不产生任何操作入口 */
  ownershipPhilosophy?: any
  /** AI 四幕与利润中心迁移。只渲染，不产生任何操作入口 */
  aiFourActs?: any
  /** 达利欧反向压力测试。只渲染，不产生任何操作入口 */
  dalioPressureTest?: any
  /** AI 融资质量观察。只渲染，不产生任何操作入口 */
  aiFinancingQuality?: any
  /** AI 第二阶段观察。只渲染，不产生任何操作入口 */
  aiPhaseTwo?: any
  /** 三层页把研究拆成当前焦点 / 上一轮观察 / 结构表 */
  researchPane?: 'all' | 'focus' | 'older' | 'tables'
}

const FiveLayerDashboard: React.FC<FiveLayerDashboardProps> = ({
  dashboard: d, changes, discovery, hypotheses, provisional, hideChanges = false, powerChain,
  portfolioDefense, ownershipPhilosophy, aiFourActs, dalioPressureTest, aiFinancingQuality, aiPhaseTwo, researchPane = 'all',
}) => {
  if (!d) {
    return (
      <Alert
        type="warning"
        showIcon
        style={SECTION}
        message="五层驾驶舱未生成"
        description="后端未返回 dashboard 字段。可能是行情数据不足，或利润结构地图未生成（先跑 npm run profit:fetch）。"
      />
    )
  }

  const h = d.headline ?? {}
  const ms = d.marketStructure ?? {}
  const az = d.actionZone ?? {}
  const isPre = d.session === 'PRE_OPEN'
  const showFocus = researchPane === 'all' || researchPane === 'focus'
  const showOlder = researchPane === 'all' || researchPane === 'older'
  const showTables = researchPane === 'all' || researchPane === 'tables'

  return (
    <div>
      {showTables && (
      <>
      {/* 盘中未定价：放在最顶部。这一条不提醒，整页数字都会被误当作收盘值 */}
      {provisional?.intraday && (
        <Alert
          type="warning"
          showIcon
          style={SECTION}
          message="盘中快照（未定价）"
          description={
            <div style={{ fontSize: 13 }}>
              {provisional.note}
              <div style={{ marginTop: 4 }}>
                盘后 15:10 之后重新打开本页，才是当日正式读数。
              </div>
            </div>
          }
        />
      )}

      {/* ══ 仪表盘：委员会 2026-08-15 指定永久置顶的六个数字 ══ */}
      {/* 只有这六个是仪表盘。海光、中际、主线、利润池、观察层全部在它下面。 */}
      {d.assets && (
        <Card
          style={SECTION}
          title={<Title level={5} style={{ margin: 0 }}>仪表盘</Title>}
        >
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            {([
              ['组合总资产', wan(d.assets.portfolioTotal)],
              ['股票市值', wan(d.assets.positionsValue)],
              ['投资现金', wan(d.assets.brokerCash + d.assets.externalCash)],
              ['股票仓位', pct(d.assets.equityPct)],
              ['历史峰值', d.assets.peak === null ? '未按组合口径认定' : wan(d.assets.peak)],
              ['当前回撤', d.assets.drawdown === null ? '不可比' : pct(d.assets.drawdown)],
              ['熔断等级', CIRCUIT_TEXT[d.assets.circuitState] ?? d.assets.circuitState],
            ] as [string, string][]).map(([k, v]) => (
              <div
                key={k}
                style={{
                  flex: '1 1 120px', background: '#f7f7fa',
                  borderRadius: 10, padding: '10px 12px',
                }}
              >
                <div style={{ fontSize: 11, color: '#8e8e93', marginBottom: 4 }}>{k}</div>
                <div style={{ fontSize: 17, fontWeight: 600 }}>{v}</div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 10, fontSize: 12, color: '#8e8e93', lineHeight: 1.9 }}>
            分项：账内现金 {wan(d.assets.brokerCash)} ＋ 账户外 {wan(d.assets.externalCash)}
            　│　券商账户合计 {wan(d.assets.brokerTotal)}
            （账户内仓位 {pct(d.assets.brokerPositionPct)}，可直接下单 {wan(d.assets.tradableCash)}）
            <div>
              券商口径只回答「还有多少钱能下单」，<Text strong>不参与任何上限判定</Text>
            </div>
          </div>
          {d.assets.circuitState === 'INCOMPARABLE' && (
            <Alert
              type="warning"
              showIcon
              style={{ marginTop: 12 }}
              message={<span style={{ fontSize: 12 }}>{d.assets.circuitReason}</span>}
            />
          )}
        </Card>
      )}

      {/* ══ 风控四层：先看这个，再看涨跌 ══ */}
      {d.riskLayers && d.riskLayers.length > 0 && (
        <Card
          style={SECTION}
          title={<Title level={5} style={{ margin: 0 }}>风控优先级</Title>}
        >
          <div style={{ fontSize: 12, color: '#8e8e93', marginBottom: 10, lineHeight: 1.8 }}>
            每天先看这一层，再看涨跌。顺序本身是规则：
            L1／L2 产生动作，L3 已裁定排除，L4 永远只是复核信息。
          </div>
          {(d.riskLayers as RiskLayerView[]).map(r => (
            <Alert
              key={r.id}
              type={RISK_ALERT[r.light] ?? 'info'}
              showIcon={r.light !== 'EXCLUDED'}
              style={{ marginBottom: 8 }}
              message={
                <span style={{ fontSize: 13 }}>
                  <Text strong>{r.id}｜{r.name}</Text>　{r.state}
                </span>
              }
              description={
                <span style={{ fontSize: 12 }}>
                  {r.canGenerateActions ? '可产生动作' : '不可产生动作'}
                  {r.note ? `　${r.note}` : ''}
                </span>
              }
            />
          ))}
        </Card>
      )}

      {/* ══ 首页一句话 ══ */}
      <Card
        style={SECTION}
        title={
          <Space>
            <Title level={5} style={{ margin: 0 }}>今日市场状态</Title>
            <Text type="secondary">{d.date}</Text>
            <Tag color={isPre ? 'blue' : 'purple'}>{isPre ? '盘前' : '盘后'}</Tag>
          </Space>
        }
      >
        <div style={{ fontSize: 14, lineHeight: 2.1 }}>
          {[
            ['主线', h.mainline], ['结构', h.structure], ['核心', h.core],
            ['深化', h.deepening], ['切换', h.switching], ['行动', h.action],
            ['数据完整度', h.dataCompleteness], ['今日最值得研究', h.mostWorthResearching],
          ].map(([k, v]) => (
            <div key={k as string} style={{ display: 'flex', gap: 12 }}>
              <Text type="secondary" style={{ minWidth: 104, flexShrink: 0 }}>{k}</Text>
              <Text>{(v as string) ?? '缺失'}</Text>
            </div>
          ))}
        </div>
        <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 12 }}>
          {d.sessionNote}
        </Text>
      </Card>

      {/* ══ 今日变化：看台已前置时不再重复 ══ */}
      {!hideChanges && <TodayChanges changes={changes} discovery={discovery} />}

      {/* ══ 市场结构：切主线 还是 打深一层 ══ */}
      <Alert
        type={ms.kind === 'DEEPENING' ? 'success' : ms.kind === 'UNKNOWN' ? 'warning' : 'info'}
        showIcon
        style={SECTION}
        message={<Text strong style={{ fontSize: 15 }}>{ms.headline ?? '市场结构未判定'}</Text>}
        description={
          <div style={{ fontSize: 13, lineHeight: 1.9 }}>
            {(ms.evidence ?? []).map((e: string, i: number) => <div key={i}>· {e}</div>)}
            <div style={{ marginTop: 8 }}>
              <Text type="secondary">主线切换：{ms.switchEvidence}</Text>
            </div>
            <div style={{ marginTop: 6 }}>
              <Tag color="blue">账务事实</Tag>
              <Text type="secondary" style={{ fontSize: 12 }}>
                本判断描述的是已披露的历史利润分配，不预测价格，且不得产生任何动作。
              </Text>
            </div>
          </div>
        }
      />

      {/* ══ ⑤ 动作区：置顶，与研究表隔离 ══ */}
      <Card
        style={{ ...SECTION, borderColor: '#ff3b30', borderWidth: 2 }}
        title={<Title level={5} style={{ margin: 0 }}>动作区（与下面四张研究表严格隔离）</Title>}
        extra={<Tag color={az.newEntryCount > 0 ? 'green' : 'default'}>今日新增建仓 {az.newEntryCount ?? 0}</Tag>}
      >
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <div>
            <Text strong style={{ color: '#ff3b30' }}>必须执行</Text>
            {(az.mustExecute ?? []).length === 0
              ? <div><Text type="secondary">无</Text></div>
              : (az.mustExecute ?? []).map((m: any, i: number) => (
                <div key={i} style={{ marginTop: 4 }}>
                  <Text>▸ {m.label}</Text>
                  <div style={{ paddingLeft: 16 }}><Text type="secondary" style={{ fontSize: 12 }}>{m.detail}</Text></div>
                </div>
              ))}
          </div>
          <div>
            <Text strong>允许研究<Text type="secondary" style={{ fontWeight: 400 }}>（不是允许买入）</Text></Text>
            {(az.allowedResearch ?? []).length === 0
              ? <div><Text type="secondary">无</Text></div>
              : (az.allowedResearch ?? []).map((m: any, i: number) => (
                <div key={i} style={{ marginTop: 4 }}>
                  <Text>▸ {m.label}</Text>
                  <div style={{ paddingLeft: 16 }}><Text type="secondary" style={{ fontSize: 12 }}>{m.detail}</Text></div>
                </div>
              ))}
          </div>
          <div>
            <Text strong style={{ color: '#8e8e93' }}>禁止动作</Text>
            {(az.forbidden ?? []).length === 0
              ? <div><Text type="secondary">无</Text></div>
              : (az.forbidden ?? []).map((m: any, i: number) => (
                <div key={i} style={{ marginTop: 4 }}>
                  <Text>▸ {m.label}</Text>
                  <div style={{ paddingLeft: 16 }}><Text type="secondary" style={{ fontSize: 12 }}>{m.detail}</Text></div>
                </div>
              ))}
          </div>
        </Space>
      </Card>

      {isPre && (
        <Alert
          type="info"
          showIcon
          style={SECTION}
          message="盘前不输出趋势 / 相对强度 / 利润结构"
          description="这些指标须盘后收盘价才能算准；盘中给全套指标会诱发开盘冲动交易。盘后 15:10 再看完整报告。"
        />
      )}

      {/* ══ ① 持仓表 ══ */}
      <Card style={SECTION} title={<Title level={5} style={{ margin: 0 }}>① 持仓表 —— 我手里的东西发生了什么？</Title>}>
        <Table
          dataSource={(d.holdings ?? []).map((r: any) => ({ ...r, key: r.code }))}
          pagination={false}
          size="small"
          scroll={{ x: 1180 }}
          expandable={{
            expandedRowRender: (r: any) => (
              <div style={{ fontSize: 13, lineHeight: 1.9, paddingLeft: 8 }}>
                <div>
                  <Text strong>法定减仓理由：</Text>
                  {r.legalReason
                    ? <Text style={{ color: '#ff3b30' }}>{r.legalReason}</Text>
                    : <Text type="secondary">无</Text>}
                </div>
                <div><Text strong>系统动作：</Text>{r.systemAction}</div>
                {r.reviewTriggers?.length > 0 && (
                  <div style={{ marginTop: 6 }}>
                    <Text strong>触发复核 {r.reviewTriggers.length} 项</Text>
                    <Text type="secondary">（观察指标，不构成减仓理由）</Text>
                    <ul style={{ margin: '4px 0 0', paddingLeft: 20 }}>
                      {r.reviewTriggers.map((t: string, i: number) => <li key={i}>{t}</li>)}
                    </ul>
                  </div>
                )}
              </div>
            ),
          }}
          columns={[
            { title: '持仓', dataIndex: 'name', width: 100, fixed: 'left' },
            { title: '仓位', dataIndex: 'posPct', width: 80, render: (v: number | null) => <Pct v={v} /> },
            { title: '今日', dataIndex: 'ret1', width: 80, render: (v: number | null) => <Pct v={v} signed /> },
            { title: '5日', dataIndex: 'ret5', width: 80, render: (v: number | null) => <Pct v={v} signed /> },
            { title: '20日', dataIndex: 'ret20', width: 80, render: (v: number | null) => <Pct v={v} signed /> },
            {
              title: '相对主线', dataIndex: 'relMainline', width: 96,
              render: (v: number | null) => <Pct v={v} signed />,
            },
            {
              title: 'MA20/60', width: 88,
              render: (_: any, r: any) => (
                <Text style={{ fontSize: 12 }}>
                  {r.aboveMa20 === null ? '?' : r.aboveMa20 ? '上' : '下'}
                  {' / '}
                  {r.aboveMa60 === null ? '?' : r.aboveMa60 ? '上' : '下'}
                </Text>
              ),
            },
            {
              title: 'PE分位', width: 84,
              render: (_: any, r: any) => (r.peUsable && r.pePercentile !== null
                ? <Text style={{ color: r.pePercentile > 0.8 ? '#ff3b30' : undefined }}>
                  {(r.pePercentile * 100).toFixed(0)}%
                </Text>
                : <Tooltip title="TTM亏损或PE极端，分位不可用"><Text type="secondary" style={{ fontSize: 12 }}>不可用</Text></Tooltip>),
            },
            {
              title: <Tooltip title="所属节点占主线利润的份额，四季变化方向。来自季度财报，非价格">节点利润份额</Tooltip>,
              dataIndex: 'nodeShareArrow', width: 100,
              render: (v: string) => <Arrow v={v} hint="利润结构地图未覆盖该节点" />,
            },
            {
              title: <Tooltip title="公司在所属节点内的利润份额">节点内份额</Tooltip>,
              dataIndex: 'shareWithinNode', width: 96,
              render: (v: number | null) => <Pct v={v} digits={0} />,
            },
            { title: '产业位置', dataIndex: 'industryPosition', width: 150 },
            {
              title: '状态', dataIndex: 'status', width: 88, fixed: 'right',
              render: (v: string) => (
                <Tag color={v === '超限' ? 'red' : v === '观察' ? 'orange' : v === '数据不足' ? 'default' : 'green'}>{v}</Tag>
              ),
            },
          ]}
        />
        <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 10 }}>
          展开任意一行可见「法定减仓理由」与「触发复核项」并列。技术指标只触发复核，不产生减仓动作。
        </Text>
      </Card>

      {/* ══ ② 主线表 ══ */}
      <Card style={SECTION} title={<Title level={5} style={{ margin: 0 }}>② 主线表 —— 市场现在在哪？有没有切换？</Title>}>
        <Table
          dataSource={(d.mainlines ?? []).map((r: any) => ({ ...r, key: r.mainlineId }))}
          pagination={false}
          size="small"
          scroll={{ x: 1080 }}
          columns={[
            { title: '主线', dataIndex: 'name', width: 150, fixed: 'left' },
            { title: '趋势', dataIndex: 'trend', width: 70, render: (v: string) => <Arrow v={v} /> },
            { title: '相对强度', dataIndex: 'relStrength', width: 90, render: (v: string) => <Arrow v={v} /> },
            {
              title: <Tooltip title="成交额20/60比值。「代理变量，不是真实资金流」—— 北向/融资/龙虎榜/机构持仓免费源不可得">成交/资金代理</Tooltip>,
              dataIndex: 'volumeProxy', width: 118, render: (v: string) => <Arrow v={v} />,
            },
            {
              title: <Tooltip title="首位节点的存量利润份额方向">利润结构</Tooltip>,
              dataIndex: 'profitStructure', width: 90,
              render: (v: string) => <Arrow v={v} hint="数据完整度不足，不给方向" />,
            },
            { title: '龙头状态', dataIndex: 'leaderStatus', width: 170 },
            {
              title: '数据完整度', dataIndex: 'completeness', width: 260,
              render: (v: number | null, r: any) => <Completeness v={v} judgable={r.judgable} blockers={r.blockers} />,
            },
            {
              title: '当前判断', dataIndex: 'verdict',
              render: (v: string, r: any) => (
                <Text style={{ color: r.judgable ? undefined : '#ff3b30' }}>
                  {r.judgable ? '' : '⚠ '}{v}
                </Text>
              ),
            },
          ]}
        />
        <Alert
          type="info"
          style={{ marginTop: 12 }}
          message={
            <Text style={{ fontSize: 12 }}>
              本表不输出主线综合评分。「不可判断」是合法输出：数据完整度不足的主线，
              即使价格在涨，也只能显示"不具备机会判断资格"，不得显示"正在成为下一主线"。
            </Text>
          }
        />
      </Card>

      {/* ══ ③ 产业结构表 ══ */}
      <Card
        style={SECTION}
        title={<Title level={5} style={{ margin: 0 }}>③ 产业结构表 —— 主线内部的钱在哪里？</Title>}
      >
        {Object.keys(d.nodeStructure ?? {}).length === 0
          ? <Alert type="warning" showIcon message="利润结构地图未生成" description="先跑 npm run profit:fetch，再跑 npm run profit:map。" />
          : (
            <Collapse
              defaultActiveKey={Object.keys(d.nodeStructure)[0]}
              items={Object.entries(d.nodeStructure).map(([mlId, rows]: [string, any]) => {
                const ml = (d.mainlines ?? []).find((m: any) => m.mainlineId === mlId)
                return {
                  key: mlId,
                  label: (
                    <Space wrap>
                      <Text strong>{ml?.name ?? mlId}</Text>
                      <Completeness v={ml?.completeness} judgable={ml?.judgable} blockers={ml?.blockers} />
                    </Space>
                  ),
                  children: (
                    <Table
                      dataSource={rows.map((r: any) => ({ ...r, key: r.node }))}
                      pagination={false}
                      size="small"
                      scroll={{ x: 900 }}
                      columns={[
                        { title: '节点', dataIndex: 'node', width: 160, fixed: 'left' },
                        {
                          title: <Tooltip title="A 利润规模：这个节点创造了多少钱（绝对水平）">A 利润规模</Tooltip>,
                          dataIndex: 'npLevel', width: 110, render: (v: number | null) => <Yi v={v} />,
                        },
                        {
                          title: <Tooltip title="B 存量份额：它占整条主线利润的多少（钱现在在哪里）">B 存量份额</Tooltip>,
                          dataIndex: 'levelShare', width: 110, render: (v: number | null) => <Pct v={v} />,
                        },
                        {
                          title: <Tooltip title="C 份额变化：与四季前相比，份额在扩大/稳定/缩小。变化比绝对值更重要">C 四季变化</Tooltip>,
                          dataIndex: 'delta4Q', width: 110, render: (v: number | null) => <Pp v={v} />,
                        },
                        {
                          title: '节点内领先公司', width: 220,
                          render: (_: any, r: any) => (r.leaders?.length
                            ? <Text style={{ fontSize: 12 }}>
                              {r.leaders.map((l: any) => `${l.name}${l.shareWithinNode === null ? '' : ` ${(l.shareWithinNode * 100).toFixed(0)}%`}`).join('、')}
                            </Text>
                            : <Text type="secondary" style={{ fontSize: 12 }}>无在册标的</Text>),
                        },
                        {
                          title: '方向', dataIndex: 'direction', width: 84,
                          render: (v: string) => <Arrow v={v} hint={v === '↑早期' ? '份额在扩大，但绝对水平仍在5%以下' : undefined} />,
                        },
                        {
                          title: '数据滞后', dataIndex: 'maxReportAgeDays', width: 90,
                          render: (v: number | null) => (v === null
                            ? <Text type="secondary" style={{ fontSize: 12 }}>缺失</Text>
                            : <Text style={{ color: v > 120 ? '#ff9500' : undefined, fontSize: 12 }}>{v}天</Text>),
                        },
                        {
                          title: '覆盖', dataIndex: 'researchOnly', width: 96, fixed: 'right',
                          render: (v: boolean) => <Tag color={v ? 'default' : 'blue'}>{v ? '仅研究域' : '决策域'}</Tag>,
                        },
                      ]}
                    />
                  ),
                }
              })}
            />
          )}
        <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 10 }}>
          三个变量必须同时看：A 规模回答"创造了多少钱"，B 份额回答"钱现在在哪里"，C 变化回答"份额在往哪走"。
          单看任何一个都会误导 —— 同比 +1153% 的节点，份额可能只有 1.4%。
        </Text>
      </Card>

      {/* ══ ④ 下一观察层 ══ */}
      <Card
        style={SECTION}
        title={<Title level={5} style={{ margin: 0 }}>④ 下一观察层 —— 接下来应该盯谁？</Title>}
        extra={<Tag color="orange">发现 ≠ 候选 ≠ 买入</Tag>}
      >
        <Table
          dataSource={(d.nextLayer ?? []).map((r: any, i: number) => ({ ...r, key: `${r.mainlineId}-${r.node}-${i}` }))}
          pagination={false}
          size="small"
          scroll={{ x: 1140 }}
          expandable={{
            expandedRowRender: (r: any) => (
              <div style={{ fontSize: 13, lineHeight: 1.9, paddingLeft: 8 }}>
                <div>
                  <Text strong>在册标的：</Text>
                  {r.members?.length
                    ? r.members.map((m: any) => `${m.name}(${m.code})`).join('、')
                    : <Text type="secondary">无（仅研究域覆盖）</Text>}
                </div>
                {r.retiredMembers?.length > 0 && (
                  <div>
                    <Text strong style={{ color: '#ff3b30' }}>C级清退标的：</Text>
                    {r.retiredMembers.join('、')}
                    <Text type="secondary">（战略层已关闭仓位资格）</Text>
                  </div>
                )}
                <div style={{ marginTop: 6 }}>
                  <Text strong>动作许可：</Text><Text style={{ color: '#ff3b30' }}>❌ 不允许</Text>
                  <ul style={{ margin: '4px 0 0', paddingLeft: 20 }}>
                    {(r.actionBlockedBy ?? []).map((b: string, i: number) => <li key={i}>{b}</li>)}
                  </ul>
                </div>
              </div>
            ),
          }}
          columns={[
            { title: '节点', dataIndex: 'node', width: 160, fixed: 'left' },
            { title: '产业', dataIndex: 'industryTrend', width: 70, render: (v: string) => <Arrow v={v} /> },
            { title: '利润', dataIndex: 'profitTrend', width: 70, render: (v: string) => <Arrow v={v} /> },
            {
              title: '节点份额', dataIndex: 'nodeShare', width: 92,
              render: (v: number | null) => <Pct v={v} />,
            },
            {
              title: <Tooltip title="真实资金流数据免费源不可得，恒为不可判。不用价格代理冒充资金验证">资金</Tooltip>,
              dataIndex: 'money', width: 70,
              render: (v: string) => <Arrow v={v} hint="真实资金流数据不可得" />,
            },
            { title: '相对强度', dataIndex: 'relStrength', width: 90, render: (v: string) => <Arrow v={v} /> },
            { title: '估值', dataIndex: 'valuation', width: 130, render: (v: string) => <Text style={{ fontSize: 12 }}>{v}</Text> },
            { title: '证据', dataIndex: 'evidenceTier', width: 90, render: (v: string) => <Tag>{v}</Tag> },
            {
              title: <Tooltip title="S0发现 / S1产业验证 / S2盈利验证 / S3估值 / 资金雷达。? = 数据缺失，不得当作通过">S0–S3 / 资金</Tooltip>,
              width: 150,
              render: (_: any, r: any) => {
                const g = r.gates ?? {}
                const mark = (v: boolean | null | undefined) => (v === null || v === undefined ? '?' : v ? '✓' : '✗')
                const color = (v: boolean | null | undefined) => (v === null || v === undefined ? '#c7c7cc' : v ? '#34c759' : '#ff3b30')
                const cells = [g.s0Discovered, g.s1Industry, g.s2Earnings, g.s3Valuation, g.moneyRadar]
                return (
                  <Space size={4}>
                    {cells.map((c, i) => (
                      <span key={i} style={{ color: color(c), fontWeight: 600 }}>{mark(c)}</span>
                    ))}
                  </Space>
                )
              },
            },
            {
              title: '阶段', dataIndex: 'stage', width: 84, fixed: 'right',
              render: (v: string, r: any) => (
                // 「无在册标的」是覆盖缺口，「战略层不允许」是战略层已关闭仓位资格。
                // 共用一个标记会让"该补标的"与"该走冠军替换"两件事看起来一样。
                <Space direction="vertical" size={0}>
                  <Tag color={v === '观察' ? 'orange' : 'default'}>{v}</Tag>
                  {r.members?.length === 0
                    ? <Tag color="default" style={{ marginTop: 2 }}>无在册标的</Tag>
                    : r.strategyAllows === false
                      ? <Tag color="red" style={{ marginTop: 2 }}>战略层不允许</Tag>
                      : null}
                </Space>
              ),
            },
          ]}
        />
        <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 10 }}>
          阶段词只有「观察」与「研究」两级 —— 「候选」以上须 S0–S3 全部通过，当前无一满足。
          展开任意一行可见逐条阻断项。
        </Text>
      </Card>
      </>
      )}

      {showOlder && (
      <>
      {powerChain && (
        <Card
          style={SECTION}
          title={<Title level={5} style={{ margin: 0 }}>电力主线价值传导图</Title>}
        >
          <div style={{ fontSize: 12, color: '#8e8e93', marginBottom: 12, lineHeight: 1.8 }}>
            本区不打分、不排序、不产生候选、不产生动作。研究的不是电力行业，是 AI 时代中国电力资本开支周期。
          </div>
          <Alert
            type="info"
            message={<Text strong>{powerChain.id}｜{powerChain.pool}</Text>}
            description={
              <div style={{ fontSize: 12, lineHeight: 1.8 }}>
                <div>主张：{powerChain.claim}</div>
                <div style={{ color: '#8e8e93' }}>来源：{powerChain.source}　登记于 {powerChain.loggedOn}</div>
              </div>
            }
          />
          {powerChain.verdict && (
            <Alert
              type="warning"
              style={{ marginTop: 12 }}
              message={<Text strong style={{ fontSize: 13 }}>机器结论</Text>}
              description={
                <ol style={{ margin: '6px 0', paddingLeft: 20, fontSize: 12, lineHeight: 1.9 }}>
                  <li>{powerChain.verdict.object}</li>
                  <li>{powerChain.verdict.demand}</li>
                  <li>{powerChain.verdict.shortage}</li>
                  <li>{powerChain.verdict.candidacy}</li>
                </ol>
              }
            />
          )}
          <div style={{ fontSize: 13, fontWeight: 600, margin: '14px 0 6px' }}>
            六层传导
            <Text type="secondary" style={{ fontSize: 11, fontWeight: 400 }}>
              　上一层成立不推出下一层。断在哪一层就停在哪一层。
            </Text>
          </div>
          <Table
            size="small"
            pagination={false}
            rowKey="id"
            dataSource={powerChain.layers ?? []}
            columns={[
              {
                title: '层', width: 140,
                render: (_: unknown, r: any) => `${r.no}. ${r.name}${r.focus ? '（重点）' : ''}`,
              },
              { title: '问什么', dataIndex: 'asks' },
              { title: '能证明', dataIndex: 'proves' },
              { title: '推不出', dataIndex: 'doesNotProve' },
            ]}
          />
          <div style={{ fontSize: 13, fontWeight: 600, margin: '14px 0 6px' }}>
            观察穿透顺序
            <Text type="secondary" style={{ fontSize: 11, fontWeight: 400 }}>
              　先看 / 接着看 / 后看 / 暂不看。不是买卖名单。
            </Text>
          </div>
          <Table
            size="small"
            pagination={false}
            rowKey="order"
            dataSource={powerChain.penetrate ?? []}
            columns={[
              { title: '顺序', dataIndex: 'order', width: 56 },
              { title: '观察带', dataIndex: 'band', width: 80 },
              { title: '看什么', dataIndex: 'name' },
              { title: '为什么是这个顺序', dataIndex: 'why' },
            ]}
          />
          <div style={{ fontSize: 13, fontWeight: 600, margin: '14px 0 6px' }}>
            八问（停在第 {powerChain.stage} 问）
          </div>
          <Space direction="vertical" size={8} style={{ width: '100%', marginBottom: 12 }}>
            {(powerChain.questions ?? []).map((q: any) => (
              <div key={q.no} style={{ fontSize: 12, lineHeight: 1.8 }}>
                <Text strong>{q.no === powerChain.stage ? '▶' : ''} {q.no}. {q.asks}</Text>
                <div style={{ color: '#8e8e93' }}>{q.status}　{q.sourceNote}</div>
              </div>
            ))}
          </Space>
          <div style={{ fontSize: 13, fontWeight: 600, margin: '8px 0 6px' }}>本条成立也不意味着</div>
          <ul style={{ margin: 0, paddingLeft: 20, fontSize: 12, lineHeight: 1.8 }}>
            {(powerChain.doesNotImply ?? []).map((x: string, i: number) => <li key={i}>{x}</li>)}
          </ul>
          <div style={{ fontSize: 13, fontWeight: 600, margin: '12px 0 6px' }}>阻塞项</div>
          <ul style={{ margin: 0, paddingLeft: 20, fontSize: 12, lineHeight: 1.8 }}>
            {(powerChain.blockers ?? []).map((x: string, i: number) => <li key={i}>{x}</li>)}
          </ul>
        </Card>
      )}

      {portfolioDefense && (
        <Card
          style={SECTION}
          title={<Title level={5} style={{ margin: 0 }}>组合防守层 —— 资产配置审计</Title>}
        >
          <div style={{ fontSize: 12, color: '#8e8e93', marginBottom: 12, lineHeight: 1.8 }}>
            本区不打分、不排序、不产生候选、不产生动作。方三文的方法补的是第三层，不是新的选股系统。不得把鸿鹄退化成红利低波加定投。
          </div>
          <Alert
            type="info"
            message={<Text strong>{portfolioDefense.id}｜{portfolioDefense.pool}</Text>}
            description={
              <div style={{ fontSize: 12, lineHeight: 1.8 }}>
                <div>主张：{portfolioDefense.claim}</div>
                <div style={{ color: '#8e8e93' }}>来源：{portfolioDefense.source}　登记于 {portfolioDefense.loggedOn}</div>
              </div>
            }
          />
          {portfolioDefense.verdict && (
            <Alert
              type="warning"
              style={{ marginTop: 12 }}
              message={<Text strong style={{ fontSize: 13 }}>机器结论</Text>}
              description={
                <ol style={{ margin: '6px 0', paddingLeft: 20, fontSize: 12, lineHeight: 1.9 }}>
                  <li>{portfolioDefense.verdict.object}</li>
                  <li>{portfolioDefense.verdict.layers}</li>
                  <li>{portfolioDefense.verdict.factor}</li>
                  <li>{portfolioDefense.verdict.hai}</li>
                  <li>{portfolioDefense.verdict.stance}</li>
                </ol>
              }
            />
          )}
          <div style={{ fontSize: 13, fontWeight: 600, margin: '14px 0 6px' }}>
            三层体系
            <Text type="secondary" style={{ fontSize: 11, fontWeight: 400 }}>
              　方三文补的是第三层。不是买卖顺序。
            </Text>
          </div>
          <Table
            size="small"
            pagination={false}
            rowKey="id"
            dataSource={portfolioDefense.layers ?? []}
            columns={[
              { title: '层', width: 140, render: (_: unknown, r: any) => `${r.no}. ${r.name}` },
              { title: '问什么', dataIndex: 'asks' },
              { title: '回答', dataIndex: 'answers' },
              { title: '不回答', dataIndex: 'doesNotAnswer' },
            ]}
          />
          <div style={{ fontSize: 13, fontWeight: 600, margin: '14px 0 6px' }}>
            若研究红利：鸿鹄语言
            <Text type="secondary" style={{ fontSize: 11, fontWeight: 400 }}>
              　不是股息率筛子，不是买卖名单。
            </Text>
          </div>
          <Table
            size="small"
            pagination={false}
            rowKey="no"
            dataSource={portfolioDefense.checklist ?? []}
            columns={[
              { title: '项', width: 140, render: (_: unknown, r: any) => `${r.no}. ${r.name}` },
              { title: '问什么', dataIndex: 'asks' },
              { title: '状态', dataIndex: 'status', width: 110 },
              { title: '说明', dataIndex: 'sourceNote' },
            ]}
          />
          <div style={{ fontSize: 13, fontWeight: 600, margin: '14px 0 6px' }}>
            雪球三分法
            <Text type="secondary" style={{ fontSize: 11, fontWeight: 400 }}>
              　组合笔记，不是交易规则。
            </Text>
          </div>
          <Table
            size="small"
            pagination={false}
            rowKey="no"
            dataSource={portfolioDefense.snowball ?? []}
            columns={[
              { title: '轴', width: 100, dataIndex: 'axis' },
              { title: '例子', dataIndex: 'examples' },
              { title: '目的', dataIndex: 'purpose' },
            ]}
          />
          <div style={{ fontSize: 13, fontWeight: 600, margin: '14px 0 6px' }}>
            因子集中审计
            <Text type="secondary" style={{ fontSize: 11, fontWeight: 400 }}>
              　{portfolioDefense.sharedFactor?.name ?? '同一宏观因子'}。截图留痕，不是今日实时仓位。
            </Text>
          </div>
          {portfolioDefense.sharedFactor?.note && (
            <div style={{ fontSize: 12, color: '#8e8e93', marginBottom: 8, lineHeight: 1.8 }}>
              {portfolioDefense.sharedFactor.note}
            </div>
          )}
          <Table
            size="small"
            pagination={false}
            rowKey="name"
            dataSource={portfolioDefense.factorTraces ?? []}
            columns={[
              {
                title: '种类', width: 70,
                render: (_: unknown, r: any) => (r.kind === 'SECTOR' ? '板块' : '个股'),
              },
              { title: '名称', dataIndex: 'name', width: 100 },
              { title: '截图留痕', dataIndex: 'committeeTrace', width: 100 },
              { title: '状态', dataIndex: 'status', width: 110 },
              { title: '说明', dataIndex: 'sourceNote' },
            ]}
          />
          <div style={{ fontSize: 13, fontWeight: 600, margin: '14px 0 6px' }}>
            宏观转述（尚未接入管道）
          </div>
          <Space direction="vertical" size={6} style={{ width: '100%', marginBottom: 12 }}>
            {[...(portfolioDefense.rateTraces ?? []), ...(portfolioDefense.indexTraces ?? [])].map((r: any) => (
              <div key={r.id} style={{ fontSize: 12, lineHeight: 1.8 }}>
                <Text>{r.statement}</Text>
                <div style={{ color: '#8e8e93' }}>{r.status}　{r.sourceNote}</div>
              </div>
            ))}
          </Space>
          {portfolioDefense.hai && (
            <Alert
              type="info"
              style={{ marginBottom: 12 }}
              message={<Text strong style={{ fontSize: 13 }}>{portfolioDefense.hai.title}　只观察，不进证据链</Text>}
              description={
                <div style={{ fontSize: 12, lineHeight: 1.8 }}>
                  <div>{portfolioDefense.hai.claim}</div>
                  <div style={{ color: '#8e8e93', marginTop: 4 }}>{portfolioDefense.hai.whyNot}</div>
                </div>
              }
            />
          )}
          <div style={{ fontSize: 13, fontWeight: 600, margin: '14px 0 6px' }}>
            六问（停在第 {portfolioDefense.stage} 问）
          </div>
          <Space direction="vertical" size={8} style={{ width: '100%', marginBottom: 12 }}>
            {(portfolioDefense.questions ?? []).map((q: any) => (
              <div key={q.no} style={{ fontSize: 12, lineHeight: 1.8 }}>
                <Text strong>{q.no === portfolioDefense.stage ? '▶' : ''} {q.no}. {q.asks}</Text>
                <div style={{ color: '#8e8e93' }}>{q.status}　{q.sourceNote}</div>
              </div>
            ))}
          </Space>
          <div style={{ fontSize: 13, fontWeight: 600, margin: '8px 0 6px' }}>本条成立也不意味着</div>
          <ul style={{ margin: 0, paddingLeft: 20, fontSize: 12, lineHeight: 1.8 }}>
            {(portfolioDefense.doesNotImply ?? []).map((x: string, i: number) => <li key={i}>{x}</li>)}
          </ul>
          <div style={{ fontSize: 13, fontWeight: 600, margin: '12px 0 6px' }}>阻塞项</div>
          <ul style={{ margin: 0, paddingLeft: 20, fontSize: 12, lineHeight: 1.8 }}>
            {(portfolioDefense.blockers ?? []).map((x: string, i: number) => <li key={i}>{x}</li>)}
          </ul>
        </Card>
      )}

      {ownershipPhilosophy && (
        <Card
          style={SECTION}
          title={<Title level={5} style={{ margin: 0 }}>投资哲学参考 —— 长期验证 Ownership</Title>}
        >
          <div style={{ fontSize: 12, color: '#8e8e93', marginBottom: 12, lineHeight: 1.8 }}>
            本区不打分、不排序、不产生候选、不产生动作。不能增加任何新规则。不得削弱战术减仓和价值退出。
          </div>
          <Alert
            type="info"
            message={<Text strong>{ownershipPhilosophy.id}｜{ownershipPhilosophy.pool}</Text>}
            description={
              <div style={{ fontSize: 12, lineHeight: 1.8 }}>
                <div>{ownershipPhilosophy.object}</div>
                <div>{ownershipPhilosophy.claim}</div>
                <div style={{ color: '#8e8e93' }}>来源：{ownershipPhilosophy.source}　登记于 {ownershipPhilosophy.loggedOn}</div>
              </div>
            }
          />
          {ownershipPhilosophy.verdict && (
            <Alert
              type="warning"
              style={{ marginTop: 12 }}
              message={<Text strong style={{ fontSize: 13 }}>机器结论</Text>}
              description={
                <ol style={{ margin: '6px 0', paddingLeft: 20, fontSize: 12, lineHeight: 1.9 }}>
                  <li>{ownershipPhilosophy.verdict.object}</li>
                  <li>{ownershipPhilosophy.verdict.translation}</li>
                  <li>{ownershipPhilosophy.verdict.risk}</li>
                  <li>{ownershipPhilosophy.verdict.lookout}</li>
                  <li>{ownershipPhilosophy.verdict.stance}</li>
                </ol>
              }
            />
          )}
          <div style={{ fontSize: 13, fontWeight: 600, margin: '14px 0 6px' }}>
            翻译
            <Text type="secondary" style={{ fontSize: 11, fontWeight: 400 }}>
              　原材料变成鸿鹄语言。不是新规则。
            </Text>
          </div>
          <Table
            size="small"
            pagination={false}
            rowKey="no"
            dataSource={ownershipPhilosophy.translations ?? []}
            columns={[
              { title: '原料', dataIndex: 'raw' },
              { title: '鸿鹄', dataIndex: 'honghu' },
              { title: '不是', dataIndex: 'not' },
            ]}
          />
          <div style={{ fontSize: 13, fontWeight: 600, margin: '14px 0 6px' }}>
            已冻结生命线的读法
            <Text type="secondary" style={{ fontSize: 11, fontWeight: 400 }}>
              　不是新生命线。战术减仓与价值退出仍然有效。
            </Text>
          </div>
          <Table
            size="small"
            pagination={false}
            rowKey="stage"
            dataSource={ownershipPhilosophy.lifelineReading ?? []}
            columns={[
              { title: '段', dataIndex: 'name', width: 140 },
              { title: '读法', dataIndex: 'means' },
            ]}
          />
          <div style={{ fontSize: 13, fontWeight: 600, margin: '14px 0 6px' }}>海光读法（已有规范案例）</div>
          <Table
            size="small"
            pagination={false}
            rowKey="when"
            dataSource={ownershipPhilosophy.haiguang ?? []}
            columns={[
              { title: '当', dataIndex: 'when', width: 180 },
              { title: '则', dataIndex: 'then' },
            ]}
          />
          <div style={{ fontSize: 13, fontWeight: 600, margin: '14px 0 6px' }}>
            价格大跌时要问的七问
            <Text type="secondary" style={{ fontSize: 11, fontWeight: 400 }}>
              　不是新闸门。便宜仍不是 Capital Permission。
            </Text>
          </div>
          <Space direction="vertical" size={6} style={{ width: '100%', marginBottom: 12 }}>
            {(ownershipPhilosophy.priceDropAsks ?? []).map((q: any) => (
              <div key={q.no} style={{ fontSize: 12, lineHeight: 1.8 }}>
                <Text>{q.no}. {q.asks}</Text>
              </div>
            ))}
            {(ownershipPhilosophy.priceDropStill ?? []).map((x: string, i: number) => (
              <div key={i} style={{ fontSize: 12, color: '#8e8e93' }}>· {x}</div>
            ))}
          </Space>
          <div style={{ fontSize: 13, fontWeight: 600, margin: '8px 0 6px' }}>本条成立也不意味着</div>
          <ul style={{ margin: 0, paddingLeft: 20, fontSize: 12, lineHeight: 1.8 }}>
            {(ownershipPhilosophy.doesNotImply ?? []).map((x: string, i: number) => <li key={i}>{x}</li>)}
          </ul>
          <div style={{ fontSize: 13, fontWeight: 600, margin: '12px 0 6px' }}>阻塞项</div>
          <ul style={{ margin: 0, paddingLeft: 20, fontSize: 12, lineHeight: 1.8 }}>
            {(ownershipPhilosophy.blockers ?? []).map((x: string, i: number) => <li key={i}>{x}</li>)}
          </ul>
        </Card>
      )}
      </>
      )}

      {showFocus && aiFourActs && (
        <Card
          style={SECTION}
          title={<Title level={5} style={{ margin: 0 }}>AI 四幕与利润中心迁移 —— 从卖算力转向卖智能</Title>}
        >
          <div style={{ fontSize: 12, color: '#8e8e93', marginBottom: 12, lineHeight: 1.8 }}>
            本区不打分、不排序、不产生候选、不产生动作。不改 V4.x。不加 V5。不追逐叙事迁移，只等待证据迁移。
          </div>
          <Alert
            type="warning"
            message={<Text strong>{aiFourActs.id}｜{aiFourActs.hpcHypothesis?.id}　{aiFourActs.hpcHypothesis?.claim}</Text>}
            description={
              <div style={{ fontSize: 12, lineHeight: 1.8 }}>
                <div>{aiFourActs.oneQuestion}</div>
                <div>{aiFourActs.keepHalf}</div>
                <div>{aiFourActs.correctHalf}</div>
                <div style={{ color: '#8e8e93' }}>{aiFourActs.hpcHypothesis?.place}</div>
              </div>
            }
          />
          <Alert
            type="info"
            style={{ marginTop: 12 }}
            message={<Text strong>{aiFourActs.decisionNow?.heading}</Text>}
            description={
              <div style={{ fontSize: 12, lineHeight: 1.8 }}>
                {(aiFourActs.decisionNow?.doNot ?? []).map((x: string, i: number) => (
                  <div key={i}>{x}</div>
                ))}
                <div>{aiFourActs.decisionNow?.should}</div>
                <div>{aiFourActs.decisionNow?.switchTo}</div>
                <div>{aiFourActs.decisionNow?.frozenState}</div>
              </div>
            }
          />

          <div style={{ fontSize: 13, fontWeight: 600, margin: '14px 0 6px' }}>
            {aiFourActs.facts?.heading}
          </div>
          <div style={{ fontSize: 12, lineHeight: 1.8 }}>
            <Text strong>{aiFourActs.facts?.nvidiaEarnings?.claim}</Text>
            <div>{aiFourActs.facts?.nvidiaEarnings?.verdict}</div>
            {(aiFourActs.facts?.nvidiaEarnings?.committeeNotes ?? []).map((n: string, i: number) => (
              <div key={i} style={{ color: '#8e8e93' }}>{n}</div>
            ))}
            <div style={{ color: '#8e8e93', marginBottom: 8 }}>来源状态：{aiFourActs.facts?.nvidiaEarnings?.sourceStatus}</div>
            <Text strong>{aiFourActs.facts?.financingPlatform?.claim}</Text>
            <div>{aiFourActs.facts?.financingPlatform?.verdict}</div>
            {(aiFourActs.facts?.financingPlatform?.committeeNotes ?? []).map((n: string, i: number) => (
              <div key={i} style={{ color: '#8e8e93' }}>{n}</div>
            ))}
            <div>{aiFourActs.facts?.financingPlatform?.meaning}</div>
            <div style={{ color: '#8e8e93', marginBottom: 12 }}>来源状态：{aiFourActs.facts?.financingPlatform?.sourceStatus}</div>
          </div>

          <div style={{ fontSize: 13, fontWeight: 600, margin: '14px 0 6px' }}>
            {aiFourActs.fourActs?.heading}
            <Text type="secondary" style={{ fontSize: 11, fontWeight: 400 }}>
              　研究顺序，不是买卖名单。
            </Text>
          </div>
          <div style={{ fontSize: 12, color: '#8e8e93', marginBottom: 8 }}>
            {aiFourActs.fourActs?.directionRight}
          </div>
          <Table
            size="small"
            pagination={false}
            rowKey="id"
            dataSource={aiFourActs.fourActs?.acts ?? []}
            columns={[
              { title: '幕', width: 90, render: (_: unknown, r: any) => `${r.id}　${r.name}` },
              { title: '核心问题', dataIndex: 'asks' },
              { title: '谁赚钱', dataIndex: 'whoEarns' },
            ]}
          />
          <div style={{ fontSize: 12, lineHeight: 1.8, margin: '8px 0 12px' }}>
            <div>{aiFourActs.fourActs?.oldTrade}</div>
            <div>{aiFourActs.fourActs?.newTrade}</div>
          </div>

          <div style={{ fontSize: 13, fontWeight: 600, margin: '14px 0 6px' }}>
            {aiFourActs.financingIsNotPoverty?.heading}
          </div>
          <div style={{ fontSize: 12, lineHeight: 1.8, marginBottom: 12 }}>
            <div>{aiFourActs.financingIsNotPoverty?.wrongRead}</div>
            <div>{aiFourActs.financingIsNotPoverty?.accurate}</div>
            <div>{aiFourActs.financingIsNotPoverty?.newRisk}</div>
            <div>{aiFourActs.financingIsNotPoverty?.mustWatch}</div>
            <div>{aiFourActs.financingIsNotPoverty?.connectsTo}</div>
          </div>

          <div style={{ fontSize: 13, fontWeight: 600, margin: '14px 0 6px' }}>
            {aiFourActs.profitCenter?.heading}
          </div>
          <div style={{ fontSize: 12, lineHeight: 1.8, marginBottom: 12 }}>
            <div>{aiFourActs.profitCenter?.realAsk}</div>
            <div>{aiFourActs.profitCenter?.dangerousThought}</div>
            <div>{aiFourActs.profitCenter?.whyWrong}</div>
          </div>

          <div style={{ fontSize: 13, fontWeight: 600, margin: '14px 0 6px' }}>
            对现有持仓重新分层
            <Text type="secondary" style={{ fontSize: 11, fontWeight: 400 }}>
              　软件涨不是卖中际。浪潮、软件不进 MAINLINES。
            </Text>
          </div>
          <Table
            size="small"
            pagination={false}
            rowKey="name"
            dataSource={aiFourActs.holdingRechecks ?? []}
            columns={[
              { title: '公司', dataIndex: 'name', width: 180 },
              { title: '核验带', dataIndex: 'band', width: 140 },
              {
                title: '该问什么',
                render: (_: unknown, r: any) => (r.shouldAsk ?? []).join(' → '),
              },
            ]}
          />
          <Space direction="vertical" size={6} style={{ width: '100%', margin: '8px 0 12px' }}>
            {(aiFourActs.holdingRechecks ?? []).map((h: any) => (
              <div key={h.name} style={{ fontSize: 12, lineHeight: 1.8 }}>
                <Text strong>{h.name}</Text>
                <div>{h.ifStrengthens}</div>
                <div>{h.ifStretched}</div>
                <div style={{ color: '#8e8e93' }}>{h.r4Note}</div>
              </div>
            ))}
          </Space>

          <div style={{ fontSize: 13, fontWeight: 600, margin: '14px 0 6px' }}>
            {aiFourActs.softwareBrake?.heading}
          </div>
          <div style={{ fontSize: 12, lineHeight: 1.8, marginBottom: 12 }}>
            <div>{aiFourActs.softwareBrake?.notEqual}</div>
            <div>必须问：{(aiFourActs.softwareBrake?.mustAsk ?? []).join(' → ')}</div>
            <div>{aiFourActs.softwareBrake?.forbidden}</div>
          </div>

          <div style={{ fontSize: 13, fontWeight: 600, margin: '14px 0 6px' }}>
            {aiFourActs.fifthLayer?.heading}
          </div>
          <div style={{ fontSize: 12, lineHeight: 1.8, marginBottom: 12 }}>
            <div>{aiFourActs.fifthLayer?.rewrite}</div>
            <div>{(aiFourActs.fifthLayer?.chain ?? []).join(' → ')}</div>
            <div>{aiFourActs.fifthLayer?.lastLayer}</div>
          </div>

          <div style={{ fontSize: 13, fontWeight: 600, margin: '14px 0 6px' }}>
            四个待验证假设
            <Text type="secondary" style={{ fontSize: 11, fontWeight: 400 }}>
              　没有一个自动买卖。
            </Text>
          </div>
          <Table
            size="small"
            pagination={false}
            rowKey="id"
            dataSource={aiFourActs.openHypotheses ?? []}
            columns={[
              { title: '假设', width: 70, dataIndex: 'id' },
              { title: '主张', dataIndex: 'claim' },
              { title: '状态', dataIndex: 'status', width: 80 },
              {
                title: '观察',
                render: (_: unknown, r: any) => (r.watch ?? []).join('；'),
              },
            ]}
          />

          <div style={{ fontSize: 13, fontWeight: 600, margin: '14px 0 6px' }}>
            对照
          </div>
          <Space direction="vertical" size={4} style={{ width: '100%', marginBottom: 12 }}>
            {(aiFourActs.decisionNow?.contrast ?? []).map((c: any) => (
              <div key={c.name} style={{ fontSize: 12, lineHeight: 1.8 }}>
                <Text strong>{c.name}</Text>
                <span>　{c.meaning}</span>
              </div>
            ))}
          </Space>

          <div style={{ fontSize: 13, fontWeight: 600, margin: '12px 0 6px' }}>现在禁止写成</div>
          <ul style={{ margin: 0, paddingLeft: 20, fontSize: 12, lineHeight: 1.8 }}>
            {(aiFourActs.forbiddenNow ?? []).map((x: string, i: number) => <li key={i}>{x}</li>)}
          </ul>
          <div style={{ fontSize: 13, fontWeight: 600, margin: '12px 0 6px' }}>下一步只观察</div>
          <ul style={{ margin: 0, paddingLeft: 20, fontSize: 12, lineHeight: 1.8 }}>
            {(aiFourActs.nextWatch ?? []).map((x: string, i: number) => <li key={i}>{x}</li>)}
          </ul>
        </Card>
      )}

      {showFocus && dalioPressureTest && (
        <Card
          style={SECTION}
          title={<Title level={5} style={{ margin: 0 }}>达利欧反向压力测试 —— 宏观判断不能直接指挥资本</Title>}
        >
          <div style={{ fontSize: 12, color: '#8e8e93', marginBottom: 12, lineHeight: 1.8 }}>
            本区不打分、不排序、不产生候选、不产生动作。不设计 V5。不加分散投资模块。不改 V4.x。
          </div>
          <Alert
            type="warning"
            message={<Text strong>{dalioPressureTest.id}｜{dalioPressureTest.hdlHypothesis?.id}　{dalioPressureTest.hdlHypothesis?.claim}</Text>}
            description={
              <div style={{ fontSize: 12, lineHeight: 1.8 }}>
                <div>{dalioPressureTest.oneQuestion}</div>
                <div>{dalioPressureTest.trueLesson}</div>
                <div style={{ color: '#8e8e93' }}>{dalioPressureTest.hdlHypothesis?.place}</div>
              </div>
            }
          />
          <Alert
            type="info"
            style={{ marginTop: 12 }}
            message={<Text strong>这场压力测试</Text>}
            description={
              <div style={{ fontSize: 12, lineHeight: 1.8 }}>
                <div>{dalioPressureTest.aiPeakTest?.judgment}</div>
                <div>鸿鹄必须拦住：仅凭这个宏观判断把优质核心资产直接卖掉。</div>
                <div>{dalioPressureTest.aiPeakTest?.ifSomeoneWritesSell}</div>
                <div>{dalioPressureTest.aiPeakTest?.meaning}</div>
              </div>
            }
          />

          <div style={{ fontSize: 13, fontWeight: 600, margin: '14px 0 6px' }}>
            {dalioPressureTest.isolation?.heading}
          </div>
          <div style={{ fontSize: 12, lineHeight: 1.8, marginBottom: 8 }}>
            {(dalioPressureTest.isolation?.dalioChain ?? []).join(' → ')}
          </div>
          <div style={{ fontSize: 12, lineHeight: 1.8 }}>
            至少跳了：{(dalioPressureTest.isolation?.jumped ?? []).join(' → ')}
          </div>
          <div style={{ fontSize: 12, lineHeight: 1.8 }}>{dalioPressureTest.isolation?.danger}</div>
          <div style={{ fontSize: 12, lineHeight: 1.8, marginBottom: 12 }}>{dalioPressureTest.isolation?.honghuMap}</div>

          <div style={{ fontSize: 13, fontWeight: 600, margin: '14px 0 6px' }}>
            {dalioPressureTest.pressureQuestion?.heading}
          </div>
          <div style={{ fontSize: 12, lineHeight: 1.8 }}>
            <div>{dalioPressureTest.pressureQuestion?.asks}</div>
            <div>{dalioPressureTest.pressureQuestion?.answer}</div>
            <div>{dalioPressureTest.pressureQuestion?.example?.trueMaybe}</div>
            <div>{dalioPressureTest.pressureQuestion?.example?.notEqual}</div>
            <div>中间还有：{(dalioPressureTest.pressureQuestion?.example?.middle ?? []).join(' → ')}</div>
            <div>{dalioPressureTest.pressureQuestion?.example?.ifFrontHolds}</div>
            <div style={{ marginBottom: 12 }}>{dalioPressureTest.pressureQuestion?.boundary}</div>
          </div>

          <div style={{ fontSize: 13, fontWeight: 600, margin: '14px 0 6px' }}>
            {dalioPressureTest.fourAxes?.heading}
            <Text type="secondary" style={{ fontSize: 11, fontWeight: 400 }}>
              　宏观判断不能直接跳到 Action。
            </Text>
          </div>
          <Table
            size="small"
            pagination={false}
            rowKey="axis"
            dataSource={dalioPressureTest.fourAxes?.axes ?? []}
            columns={[
              { title: '轴', dataIndex: 'axis', width: 120 },
              { title: '回答', dataIndex: 'answers' },
            ]}
          />

          <div style={{ fontSize: 13, fontWeight: 600, margin: '14px 0 6px' }}>
            {dalioPressureTest.independence?.heading}
          </div>
          <div style={{ fontSize: 12, lineHeight: 1.8 }}>
            <div>{dalioPressureTest.independence?.notStockCount}</div>
            <div>{(dalioPressureTest.independence?.exampleNames ?? []).join(' / ')}</div>
            <div>{dalioPressureTest.independence?.oneFactor}</div>
            <div>{dalioPressureTest.independence?.shouldAsk}</div>
            <div style={{ marginBottom: 12 }}>{dalioPressureTest.independence?.sameThought}</div>
          </div>

          <div style={{ fontSize: 13, fontWeight: 600, margin: '14px 0 6px' }}>
            {dalioPressureTest.threeBooks?.heading}
          </div>
          <div style={{ fontSize: 12, lineHeight: 1.8, marginBottom: 8 }}>
            已有三本账：{(dalioPressureTest.threeBooks?.alreadyExist ?? []).join(' / ')}
          </div>
          <div style={{ fontSize: 12, lineHeight: 1.8 }}>{dalioPressureTest.threeBooks?.institutionalized}</div>
          <div style={{ fontSize: 12, lineHeight: 1.8 }}>{dalioPressureTest.threeBooks?.illusion}</div>
          <Space direction="vertical" size={4} style={{ width: '100%', margin: '8px 0 12px' }}>
            {(dalioPressureTest.threeBooks?.cases ?? []).map((c: any, i: number) => (
              <div key={i} style={{ fontSize: 12, lineHeight: 1.8 }}>
                <Text>{c.when}</Text>
                <span style={{ color: '#8e8e93' }}>　{c.meaning}</span>
              </div>
            ))}
          </Space>
          <div style={{ fontSize: 12, lineHeight: 1.8 }}>
            允许记录：Decision Quality {dalioPressureTest.threeBooks?.allowedRecord?.decisionQuality}；
            Evidence Outcome {dalioPressureTest.threeBooks?.allowedRecord?.evidenceOutcome}；
            Capital Outcome {dalioPressureTest.threeBooks?.allowedRecord?.capitalOutcome}
          </div>
          <div style={{ fontSize: 12, lineHeight: 1.8, marginBottom: 12 }}>
            {dalioPressureTest.threeBooks?.allowedRecord?.not}
            {' '}{dalioPressureTest.threeBooks?.reverseRecord?.not}
            {' '}{dalioPressureTest.threeBooks?.mustAccumulate}
          </div>

          <div style={{ fontSize: 13, fontWeight: 600, margin: '14px 0 6px' }}>
            宏观判断是假设，不是交易信号
          </div>
          <Table
            size="small"
            pagination={false}
            rowKey="id"
            dataSource={dalioPressureTest.macroHypotheses ?? []}
            columns={[
              { title: '编号', dataIndex: 'id', width: 80 },
              { title: '假设', dataIndex: 'claim' },
              { title: '状态', dataIndex: 'status', width: 80 },
              { title: '位置', dataIndex: 'place' },
              { title: '不是', dataIndex: 'not' },
            ]}
          />

          <div style={{ fontSize: 13, fontWeight: 600, margin: '14px 0 6px' }}>
            {dalioPressureTest.axisFirewall?.heading}
            <Text type="secondary" style={{ fontSize: 11, fontWeight: 400 }}>
              　不是新规则。这五条是防火墙。
            </Text>
          </div>
          <div style={{ fontSize: 12, color: '#8e8e93', marginBottom: 8 }}>
            {dalioPressureTest.axisFirewall?.onlyAsk}
          </div>
          <Table
            size="small"
            pagination={false}
            rowKey="id"
            dataSource={dalioPressureTest.axisFirewall?.items ?? []}
            columns={[
              { title: '', dataIndex: 'id', width: 40 },
              { title: '如果发生', dataIndex: 'trigger', width: 140 },
              { title: '首先改变', dataIndex: 'firstAxis' },
              { title: '不能改变', dataIndex: 'cannotChange' },
            ]}
          />

          <div style={{ fontSize: 13, fontWeight: 600, margin: '14px 0 6px' }}>
            压缩成一句
          </div>
          <div style={{ fontSize: 13, lineHeight: 1.8, marginBottom: 8 }}>
            {dalioPressureTest.compressed}
          </div>
          <div style={{ fontSize: 12, lineHeight: 1.8, marginBottom: 12 }}>
            {(dalioPressureTest.chain ?? []).join(' → ')}
            {'　'}{dalioPressureTest.comeBackInAYear}
          </div>

          <div style={{ fontSize: 13, fontWeight: 600, margin: '12px 0 6px' }}>现在禁止写成</div>
          <ul style={{ margin: 0, paddingLeft: 20, fontSize: 12, lineHeight: 1.8 }}>
            {(dalioPressureTest.forbiddenNow ?? []).map((x: string, i: number) => <li key={i}>{x}</li>)}
          </ul>
          <div style={{ fontSize: 13, fontWeight: 600, margin: '12px 0 6px' }}>下一步只观察</div>
          <ul style={{ margin: 0, paddingLeft: 20, fontSize: 12, lineHeight: 1.8 }}>
            {(dalioPressureTest.nextWatch ?? []).map((x: string, i: number) => <li key={i}>{x}</li>)}
          </ul>
        </Card>
      )}

      {showFocus && aiFinancingQuality && (
        <Card
          style={SECTION}
          title={<Title level={5} style={{ margin: 0 }}>AI 融资质量观察 —— 信用周期待验证，发债不是泡沫</Title>}
        >
          <div style={{ fontSize: 12, color: '#8e8e93', marginBottom: 12, lineHeight: 1.8 }}>
            本区不打分、不排序、不产生候选、不产生动作。冻结期不能偷偷加功能。不增加 V5 AI 债务指标。
          </div>
          <Alert
            type="warning"
            message={<Text strong>{aiFinancingQuality.id}｜{aiFinancingQuality.hfqHypothesis?.id}　{aiFinancingQuality.hfqHypothesis?.claim}</Text>}
            description={
              <div style={{ fontSize: 12, lineHeight: 1.8 }}>
                <div>{aiFinancingQuality.oneQuestion}</div>
                <div>{aiFinancingQuality.trueAlert}</div>
                <div style={{ color: '#8e8e93' }}>{aiFinancingQuality.hfqHypothesis?.place}</div>
              </div>
            }
          />
          <Alert
            type="info"
            style={{ marginTop: 12 }}
            message={<Text strong>现在能下的判断，和不能下的判断</Text>}
            description={
              <div style={{ fontSize: 12, lineHeight: 1.8 }}>
                <div>{aiFinancingQuality.hfqHypothesis?.cannotConclude}</div>
                <div>{aiFinancingQuality.hfqHypothesis?.canConclude}</div>
                <div>{aiFinancingQuality.hfqHypothesis?.oldAsk}</div>
                <div>{aiFinancingQuality.hfqHypothesis?.nowAsk}</div>
              </div>
            }
          />

          <div style={{ fontSize: 13, fontWeight: 600, margin: '14px 0 6px' }}>
            {aiFinancingQuality.firstJudgment?.heading}
          </div>
          <Space direction="vertical" size={8} style={{ width: '100%', marginBottom: 12 }}>
            <div style={{ fontSize: 12, lineHeight: 1.8 }}>
              <Text strong>① {aiFinancingQuality.firstJudgment?.bondIssuance?.claim}</Text>
              <div>{aiFinancingQuality.firstJudgment?.bondIssuance?.verdict}</div>
              {(aiFinancingQuality.firstJudgment?.bondIssuance?.committeeNotes ?? []).map((n: string, i: number) => (
                <div key={i} style={{ color: '#8e8e93' }}>{n}</div>
              ))}
              <div style={{ color: '#8e8e93' }}>来源状态：{aiFinancingQuality.firstJudgment?.bondIssuance?.sourceStatus}</div>
              <div>{aiFinancingQuality.firstJudgment?.bondIssuance?.conclusion}</div>
            </div>
            <div style={{ fontSize: 12, lineHeight: 1.8 }}>
              <Text strong>② {aiFinancingQuality.firstJudgment?.debtIsNotDanger?.claim}</Text>
              <div>{aiFinancingQuality.firstJudgment?.debtIsNotDanger?.verdict}</div>
              {(aiFinancingQuality.firstJudgment?.debtIsNotDanger?.whyWrong ?? []).map((n: string, i: number) => (
                <div key={i}>{n}</div>
              ))}
              <div>{aiFinancingQuality.firstJudgment?.debtIsNotDanger?.realQuestion}</div>
            </div>
            <div style={{ fontSize: 12, lineHeight: 1.8 }}>
              <Text strong>③ {aiFinancingQuality.firstJudgment?.depreciationLag?.claim}</Text>
              <div>{aiFinancingQuality.firstJudgment?.depreciationLag?.verdict}</div>
              <div>{aiFinancingQuality.firstJudgment?.depreciationLag?.chanosPoint}</div>
              <div>{aiFinancingQuality.firstJudgment?.depreciationLag?.qualifier}</div>
              {(aiFinancingQuality.firstJudgment?.depreciationLag?.realDangers ?? []).map((n: string, i: number) => (
                <div key={i}>{n}</div>
              ))}
            </div>
          </Space>

          <div style={{ fontSize: 13, fontWeight: 600, margin: '14px 0 6px' }}>
            {aiFinancingQuality.auditChain?.heading}
            <Text type="secondary" style={{ fontSize: 11, fontWeight: 400 }}>
              　不是新指标。
            </Text>
          </div>
          <div style={{ fontSize: 12, lineHeight: 1.8, marginBottom: 8 }}>
            {(aiFinancingQuality.auditChain?.steps ?? []).join(' → ')}
          </div>
          <div style={{ fontSize: 12, lineHeight: 1.8 }}>{aiFinancingQuality.auditChain?.ifRunsThrough}</div>
          <div style={{ fontSize: 12, lineHeight: 1.8, marginBottom: 12 }}>{aiFinancingQuality.auditChain?.ifBreaks}</div>

          <div style={{ fontSize: 13, fontWeight: 600, margin: '14px 0 6px' }}>
            {aiFinancingQuality.assetLife?.heading}
          </div>
          <div style={{ fontSize: 12, lineHeight: 1.8 }}>
            <div>{aiFinancingQuality.assetLife?.deeperThanLag}</div>
            <div>{aiFinancingQuality.assetLife?.accountingPath}</div>
            <div>{aiFinancingQuality.assetLife?.economicPath}</div>
            <div>{aiFinancingQuality.assetLife?.danger}</div>
            <div style={{ marginBottom: 12 }}>{aiFinancingQuality.assetLife?.whyHardware}</div>
          </div>

          <div style={{ fontSize: 13, fontWeight: 600, margin: '14px 0 6px' }}>
            {aiFinancingQuality.depreciationClock?.heading}
            <Text type="secondary" style={{ fontSize: 11, fontWeight: 400 }}>
              　不是新指标，是现有财务数据的组合观察。
            </Text>
          </div>
          <Table
            size="small"
            pagination={false}
            rowKey="id"
            dataSource={aiFinancingQuality.depreciationClock?.times ?? []}
            columns={[
              { title: '时间', dataIndex: 'id', width: 60 },
              { title: '观察什么', dataIndex: 'label' },
            ]}
          />
          <Space direction="vertical" size={4} style={{ width: '100%', margin: '8px 0 12px' }}>
            {(aiFinancingQuality.depreciationClock?.readings ?? []).map((r: any, i: number) => (
              <div key={i} style={{ fontSize: 12, lineHeight: 1.8 }}>
                <Text>{r.when}</Text>
                <span style={{ color: '#8e8e93' }}>　{r.meaning}</span>
              </div>
            ))}
          </Space>

          <div style={{ fontSize: 13, fontWeight: 600, margin: '14px 0 6px' }}>
            {aiFinancingQuality.fiveLayers?.heading}
            <Text type="secondary" style={{ fontSize: 11, fontWeight: 400 }}>
              　研究顺序，不是买卖名单。
            </Text>
          </div>
          <div style={{ fontSize: 12, color: '#8e8e93', marginBottom: 8 }}>
            {aiFinancingQuality.fiveLayers?.stopSimple}
          </div>
          <Table
            size="small"
            pagination={false}
            rowKey="id"
            dataSource={aiFinancingQuality.fiveLayers?.layers ?? []}
            columns={[
              { title: '层', width: 90, render: (_: unknown, r: any) => `${r.id}　${r.title}` },
              { title: '问什么', dataIndex: 'question' },
            ]}
          />

          <div style={{ fontSize: 13, fontWeight: 600, margin: '14px 0 6px' }}>
            对现有持仓影响完全不同
            <Text type="secondary" style={{ fontSize: 11, fontWeight: 400 }}>
              　AI泡沫不是统一风险。中芯、寒武纪只作观察对照，不进 MAINLINES。
            </Text>
          </div>
          <Table
            size="small"
            pagination={false}
            rowKey="name"
            dataSource={aiFinancingQuality.holdingRechecks ?? []}
            columns={[
              { title: '公司', dataIndex: 'name', width: 140 },
              {
                title: '位置',
                width: 90,
                render: (_: unknown, r: any) => r.inMainlines ? '主线持仓' : '观察对照',
              },
              { title: '核心风险不是', dataIndex: 'coreRiskIsNot' },
              {
                title: '该问什么',
                render: (_: unknown, r: any) => (r.shouldAsk ?? []).join('；'),
              },
            ]}
          />
          <Space direction="vertical" size={6} style={{ width: '100%', margin: '8px 0 12px' }}>
            {(aiFinancingQuality.holdingRechecks ?? []).map((h: any) => (
              <div key={h.name} style={{ fontSize: 12, lineHeight: 1.8 }}>
                <Text strong>{h.name}</Text>
                <div>{h.ifStrengthens}</div>
                <div>{h.ifWeakens}</div>
                <div style={{ color: '#8e8e93' }}>{h.r4Note}</div>
              </div>
            ))}
          </Space>

          <div style={{ fontSize: 13, fontWeight: 600, margin: '14px 0 6px' }}>
            只用已有数据回答
          </div>
          <Table
            size="small"
            pagination={false}
            rowKey="item"
            dataSource={aiFinancingQuality.observationTable ?? []}
            columns={[
              { title: '观察', dataIndex: 'item', width: 160 },
              { title: '状态', dataIndex: 'state' },
              { title: '来源', dataIndex: 'sourceStatus', width: 120 },
            ]}
          />

          <div style={{ fontSize: 13, fontWeight: 600, margin: '14px 0 6px' }}>
            为什么拒绝 PE + RSI + 均线
          </div>
          <ul style={{ margin: 0, paddingLeft: 20, fontSize: 12, lineHeight: 1.8 }}>
            {(aiFinancingQuality.whyNotPeRsiMa ?? []).map((x: string, i: number) => <li key={i}>{x}</li>)}
          </ul>

          <div style={{ fontSize: 13, fontWeight: 600, margin: '14px 0 6px' }}>
            {aiFinancingQuality.futureChains?.heading}
          </div>
          <Space direction="vertical" size={8} style={{ width: '100%', marginBottom: 12 }}>
            <div style={{ fontSize: 12, lineHeight: 1.8 }}>
              <Text strong>{aiFinancingQuality.futureChains?.riskChain?.title}</Text>
              <div>{(aiFinancingQuality.futureChains?.riskChain?.steps ?? []).join(' → ')}</div>
              <div>{aiFinancingQuality.futureChains?.riskChain?.meaning}</div>
            </div>
            <div style={{ fontSize: 12, lineHeight: 1.8 }}>
              <Text strong>{aiFinancingQuality.futureChains?.productiveChain?.title}</Text>
              <div>{(aiFinancingQuality.futureChains?.productiveChain?.steps ?? []).join(' → ')}</div>
              <div>{aiFinancingQuality.futureChains?.productiveChain?.meaning}</div>
            </div>
          </Space>

          <div style={{ fontSize: 13, fontWeight: 600, margin: '12px 0 6px' }}>现在禁止写成</div>
          <ul style={{ margin: 0, paddingLeft: 20, fontSize: 12, lineHeight: 1.8 }}>
            {(aiFinancingQuality.forbiddenNow ?? []).map((x: string, i: number) => <li key={i}>{x}</li>)}
          </ul>
          <div style={{ fontSize: 13, fontWeight: 600, margin: '12px 0 6px' }}>下一步只观察</div>
          <ul style={{ margin: 0, paddingLeft: 20, fontSize: 12, lineHeight: 1.8 }}>
            {(aiFinancingQuality.nextWatch ?? []).map((x: string, i: number) => <li key={i}>{x}</li>)}
          </ul>
        </Card>
      )}

      {showFocus && aiPhaseTwo && (
        <Card
          style={SECTION}
          title={<Title level={5} style={{ margin: 0 }}>AI 第二阶段观察 —— 去弱留强，等证据</Title>}
        >
          <div style={{ fontSize: 12, color: '#8e8e93', marginBottom: 12, lineHeight: 1.8 }}>
            本区不打分、不排序、不产生候选、不产生动作。不是 AI 结束，是硬件第一阶段估值被强制重估。
          </div>
          <Alert
            type="info"
            message={<Text strong>{aiPhaseTwo.id}｜{aiPhaseTwo.pool}　{aiPhaseTwo.stance}</Text>}
            description={
              <div style={{ fontSize: 12, lineHeight: 1.8 }}>
                <div>{aiPhaseTwo.object}</div>
                <div>{aiPhaseTwo.claim}</div>
                <div style={{ color: '#8e8e93' }}>来源：{aiPhaseTwo.source}　登记于 {aiPhaseTwo.loggedOn}</div>
              </div>
            }
          />
          {aiPhaseTwo.verdict && (
            <Alert
              type="warning"
              style={{ marginTop: 12 }}
              message={<Text strong style={{ fontSize: 13 }}>机器结论</Text>}
              description={
                <ol style={{ margin: '6px 0', paddingLeft: 20, fontSize: 12, lineHeight: 1.9 }}>
                  <li>{aiPhaseTwo.verdict.object}</li>
                  <li>{aiPhaseTwo.verdict.stance}</li>
                  <li>{aiPhaseTwo.verdict.cash}</li>
                  <li>{aiPhaseTwo.verdict.split}</li>
                  <li>{aiPhaseTwo.verdict.after}</li>
                </ol>
              }
            />
          )}
          <div style={{ fontSize: 13, fontWeight: 600, margin: '14px 0 6px' }}>
            五层拆解
            <Text type="secondary" style={{ fontSize: 11, fontWeight: 400 }}>
              　不是买卖名单。身体层对接电力观察。
            </Text>
          </div>
          <Table
            size="small"
            pagination={false}
            rowKey="id"
            dataSource={aiPhaseTwo.layers ?? []}
            columns={[
              {
                title: '层', width: 160,
                render: (_: unknown, r: any) => `${r.no}. ${r.name}${r.focus ? '（重点）' : ''}`,
              },
              { title: '问什么', dataIndex: 'asks' },
              { title: '能证明', dataIndex: 'proves' },
              { title: '推不出', dataIndex: 'doesNotProve' },
            ]}
          />
          <div style={{ fontSize: 13, fontWeight: 600, margin: '14px 0 6px' }}>
            具身智能重拆
            <Text type="secondary" style={{ fontSize: 11, fontWeight: 400 }}>
              　不是下一只中际旭创。
            </Text>
          </div>
          <Table
            size="small"
            pagination={false}
            rowKey="no"
            dataSource={aiPhaseTwo.robotParts ?? []}
            columns={[
              { title: '部分', width: 80, dataIndex: 'name' },
              { title: '覆盖', dataIndex: 'covers' },
            ]}
          />
          <div style={{ fontSize: 13, fontWeight: 600, margin: '14px 0 6px' }}>
            现有持仓核验带
            <Text type="secondary" style={{ fontSize: 11, fontWeight: 400 }}>
              　不是评分。砍真正坏掉的，不是砍跌得最多的。
            </Text>
          </div>
          <Table
            size="small"
            pagination={false}
            rowKey="name"
            dataSource={aiPhaseTwo.rechecks ?? []}
            columns={[
              { title: '公司', dataIndex: 'name', width: 100 },
              { title: '核验带', dataIndex: 'band', width: 140 },
              { title: '问什么', dataIndex: 'asks' },
              { title: '说明', dataIndex: 'sourceNote' },
            ]}
          />
          <div style={{ fontSize: 13, fontWeight: 600, margin: '14px 0 6px' }}>
            三问核验（取代所谓九维评分）
          </div>
          <Space direction="vertical" size={6} style={{ width: '100%', marginBottom: 12 }}>
            {(aiPhaseTwo.threeChecks ?? []).map((c: any) => (
              <div key={c.no} style={{ fontSize: 12, lineHeight: 1.8 }}>
                <Text>{c.no}. {c.name}　{c.asks}</Text>
              </div>
            ))}
          </Space>
          <div style={{ fontSize: 13, fontWeight: 600, margin: '14px 0 6px' }}>
            截图留痕与事件（尚未接入管道）
          </div>
          <Space direction="vertical" size={6} style={{ width: '100%', marginBottom: 12 }}>
            {[...(aiPhaseTwo.portfolioTraces ?? []), ...(aiPhaseTwo.eventTraces ?? [])].map((r: any) => (
              <div key={r.id} style={{ fontSize: 12, lineHeight: 1.8 }}>
                <Text>{r.statement}</Text>
                <div style={{ color: '#8e8e93' }}>{r.status}　{r.sourceNote}</div>
              </div>
            ))}
          </Space>
          <div style={{ fontSize: 13, fontWeight: 600, margin: '14px 0 6px' }}>
            财报之后的三个情景
            <Text type="secondary" style={{ fontSize: 11, fontWeight: 400 }}>
              　没有一个会自动买卖。
            </Text>
          </div>
          <Table
            size="small"
            pagination={false}
            rowKey="id"
            dataSource={aiPhaseTwo.scenarios ?? []}
            columns={[
              { title: '情景', dataIndex: 'name', width: 180 },
              { title: '意味着', dataIndex: 'means' },
              { title: '不是', dataIndex: 'not' },
            ]}
          />
          {aiPhaseTwo.hai && (
            <Alert
              type="info"
              style={{ margin: '12px 0' }}
              message={<Text strong style={{ fontSize: 13 }}>{aiPhaseTwo.hai.title}　只观察，不进证据链</Text>}
              description={
                <div style={{ fontSize: 12, lineHeight: 1.8 }}>
                  <div>{aiPhaseTwo.hai.claim}</div>
                  <div style={{ color: '#8e8e93', marginTop: 4 }}>{aiPhaseTwo.hai.whyNot}</div>
                </div>
              }
            />
          )}
          <div style={{ fontSize: 13, fontWeight: 600, margin: '14px 0 6px' }}>
            六问（停在第 {aiPhaseTwo.stage} 问）
          </div>
          <Space direction="vertical" size={8} style={{ width: '100%', marginBottom: 12 }}>
            {(aiPhaseTwo.questions ?? []).map((q: any) => (
              <div key={q.no} style={{ fontSize: 12, lineHeight: 1.8 }}>
                <Text strong>{q.no === aiPhaseTwo.stage ? '▶' : ''} {q.no}. {q.asks}</Text>
                <div style={{ color: '#8e8e93' }}>{q.status}　{q.sourceNote}</div>
              </div>
            ))}
          </Space>
          <div style={{ fontSize: 13, fontWeight: 600, margin: '8px 0 6px' }}>下一步只观察，不发令</div>
          <ol style={{ margin: 0, paddingLeft: 20, fontSize: 12, lineHeight: 1.8 }}>
            {(aiPhaseTwo.nextWatch ?? []).map((x: any) => <li key={x.no}>{x.text}</li>)}
          </ol>
          <div style={{ fontSize: 13, fontWeight: 600, margin: '12px 0 6px' }}>本条成立也不意味着</div>
          <ul style={{ margin: 0, paddingLeft: 20, fontSize: 12, lineHeight: 1.8 }}>
            {(aiPhaseTwo.doesNotImply ?? []).map((x: string, i: number) => <li key={i}>{x}</li>)}
          </ul>
          <div style={{ fontSize: 13, fontWeight: 600, margin: '12px 0 6px' }}>阻塞项</div>
          <ul style={{ margin: 0, paddingLeft: 20, fontSize: 12, lineHeight: 1.8 }}>
            {(aiPhaseTwo.blockers ?? []).map((x: string, i: number) => <li key={i}>{x}</li>)}
          </ul>
        </Card>
      )}

      {showTables && (
      <>
      {/* ══ 外部叙事台账：与四张研究表并列，不进动作区 ══ */}
      {hypotheses && hypotheses.length > 0 && (
        <Card
          style={SECTION}
          title={
            <Title level={5} style={{ margin: 0 }}>
              外部叙事台账 —— 拆回它实际所处的验证阶段
            </Title>
          }
        >
          <div style={{ fontSize: 12, color: '#8e8e93', marginBottom: 12, lineHeight: 1.8 }}>
            本区不打分、不排序、不产生候选、不产生动作。证据等级恒为 OBSERVATION。
          </div>
          {hypotheses.map(hy => (
            <div key={hy.id} style={{ marginBottom: 20 }}>
              <Alert
                type="info"
                message={
                  <span style={{ fontSize: 13 }}>
                    <Text strong>{hy.id}｜{hy.node}</Text>
                    <Tag style={{ marginLeft: 8 }}>{hy.mainline}</Tag>
                  </span>
                }
                description={
                  <div style={{ fontSize: 12, lineHeight: 1.8 }}>
                    <div>主张：{hy.claim}</div>
                    <div style={{ color: '#8e8e93' }}>
                      来源：{hy.source}　登记于 {hy.loggedOn}
                    </div>
                  </div>
                }
              />

              {/* 验证链：当前步高亮。灰色是「还没走到」,不是「已否决」 */}
              <div
                style={{
                  display: 'flex', flexWrap: 'wrap', alignItems: 'center',
                  gap: 4, margin: '10px 0', fontSize: 12,
                }}
              >
                {CHAIN.map((stg, i) => (
                  <React.Fragment key={stg}>
                    <span
                      style={{
                        padding: '3px 8px', borderRadius: 6,
                        background: i + 1 === hy.stage ? '#fff4e5' : '#f2f2f7',
                        color: i + 1 === hy.stage ? '#b26a00' : '#8e8e93',
                        fontWeight: i + 1 === hy.stage ? 600 : 400,
                      }}
                    >
                      {stg}
                    </span>
                    {i < CHAIN.length - 1 && <span style={{ color: '#c7c7cc' }}>→</span>}
                  </React.Fragment>
                ))}
              </div>
              <div style={{ fontSize: 12, color: '#8e8e93', lineHeight: 1.8 }}>
                停在第 {hy.stage}／{CHAIN.length} 步。
                每一步是上一步的兑现,不是上一步的推论,故不可跳步。
              </div>

              {/* 四句话结论置顶：后端已算好，前端不重算 —— 重算就会有两套口径 */}
              {hy.fourLine && (
                <Alert
                  type="warning"
                  style={{ marginTop: 12 }}
                  message={<Text strong style={{ fontSize: 13 }}>机器结论（四句话）</Text>}
                  description={
                    <ol style={{ margin: '6px 0', paddingLeft: 20, fontSize: 12, lineHeight: 1.9 }}>
                      <li>{hy.fourLine.currentFact}</li>
                      <li>{hy.fourLine.aiAsDriver}</li>
                      <li>{hy.fourLine.superCycle}</li>
                      <li>{hy.fourLine.candidacy}</li>
                    </ol>
                  }
                />
              )}

              {/* 因果强度五层：上一层成立不推出下一层 */}
              {hy.causal && hy.causal.length > 0 && (
                <>
                  <div style={{ fontSize: 13, fontWeight: 600, margin: '14px 0 6px' }}>
                    因果强度五层
                    <Text type="secondary" style={{ fontSize: 11, fontWeight: 400 }}>
                      　上一层成立不推出下一层
                    </Text>
                  </div>
                  <Table
                    size="small"
                    pagination={false}
                    rowKey="level"
                    dataSource={hy.causal}
                    columns={[
                      {
                        title: '层级', dataIndex: 'name', width: 92,
                        render: (v: string, r) => `${r.level}. ${v}`,
                      },
                      { title: '能证明什么', dataIndex: 'proves' },
                      {
                        title: '状态', dataIndex: 'status', width: 148,
                        render: (v: string) => (
                          <Text
                            strong
                            type={v === 'CONFIRMED' ? 'danger'
                              : v === 'VETOED' || v === 'NOT_PROVEN' ? 'secondary' : undefined}
                          >
                            {CAUSAL_STATUS_TEXT[v] ?? v}
                          </Text>
                        ),
                      },
                      {
                        title: '依据', dataIndex: 'basis',
                        render: (v: string) => (
                          <span style={{ fontSize: 11, color: '#8e8e93' }}>{v}</span>
                        ),
                      },
                    ]}
                  />
                </>
              )}

              {/* 待核验异常：是事实，但不是因果证据 */}
              {hy.pending && hy.pending.length > 0 && (
                <>
                  <Alert
                    type="warning"
                    style={{ marginTop: 12 }}
                    message={
                      <Text strong style={{ fontSize: 13 }}>
                        待核验异常（{hy.pending.length} 项）
                      </Text>
                    }
                    description={
                      <span style={{ fontSize: 12 }}>
                        这些读数是事实，但在解释完成之前不构成因果证据，
                        故不计入任何命题的兑现数。
                      </span>
                    }
                  />
                  {hy.pending.map(pv => (
                    <div key={pv.text} style={{ margin: '10px 0', fontSize: 12, lineHeight: 1.8 }}>
                      <Text strong>? {pv.text}</Text>
                      <div style={{ paddingLeft: 16, color: '#8e8e93' }}>{pv.evidence}</div>
                      <ul style={{ margin: '4px 0', paddingLeft: 32, color: '#8e8e93' }}>
                        {pv.checklist.map(c => <li key={c}>□ {c}</li>)}
                      </ul>
                    </div>
                  ))}
                </>
              )}

              {/* 两个命题分开渲染。合在一起会让 A 的证据被读成 B 的背书 */}
              {hy.propositions?.map(pr => {
                const isFact = pr.horizon === 'CURRENT_FACT'
                return (
                  <div key={pr.id} style={{ marginTop: 14 }}>
                    <Alert
                      type={isFact ? 'success' : 'info'}
                      message={
                        <span style={{ fontSize: 13 }}>
                          <Text strong>命题 {pr.id}：{pr.claim}</Text>
                        </span>
                      }
                      description={
                        <div style={{ fontSize: 12, lineHeight: 1.8 }}>
                          性质：{isFact
                            ? '当前事实 · 可被单期数据证实或证伪'
                            : '未来假设 · 任何单期数据都不能证明，须逐季累积'}
                          　判定：<Text strong>{pr.verdictText}</Text>
                          （{pr.indicators.filter(i => i.status === 'MET').length}／
                          {pr.indicators.length} 兑现）
                        </div>
                      }
                    />
                    {pr.indicators.map(ind => (
                      <div
                        key={ind.no}
                        style={{ margin: '8px 0', fontSize: 12, lineHeight: 1.8 }}
                      >
                        <span
                          style={{
                            color: ind.status === 'MET' ? '#d4380d'
                              : ind.status === 'REFUTED' ? '#1677ff' : '#c7c7cc',
                            marginRight: 6,
                          }}
                        >
                          {ind.status === 'MET' ? '✓' : ind.status === 'REFUTED' ? '✗' : '·'}
                        </span>
                        <Text strong>{pr.id}-{ind.no}. {ind.text}</Text>
                        <div style={{ paddingLeft: 18, color: '#8e8e93' }}>
                          取数：{SOURCE_TIER_TEXT[ind.sourceTier] ?? ind.sourceTier}
                        </div>
                        <div style={{ paddingLeft: 18, color: '#8e8e93' }}>{ind.evidence}</div>
                      </div>
                    ))}
                  </div>
                )
              })}

              {/* 付费缺口与「尚未接入」必须分区：混在一起就会用「要买数据」掩盖「还没做」 */}
              <div style={{ fontSize: 13, fontWeight: 600, margin: '14px 0 6px' }}>
                付费数据缺口（{hy.paidGaps?.length ?? 0} 项）
                <Text type="secondary" style={{ fontSize: 11, fontWeight: 400 }}>
                  　只有走完公开优先各层仍无法回答的才列入
                </Text>
              </div>
              <ul style={{ margin: 0, paddingLeft: 20, fontSize: 12, lineHeight: 1.9 }}>
                {(hy.paidGaps ?? []).map(g => <li key={g}>{g}</li>)}
                {!hy.paidGaps?.length && <li style={{ color: '#c7c7cc' }}>无</li>}
              </ul>
              <div style={{ fontSize: 13, fontWeight: 600, margin: '12px 0 6px' }}>
                公开可得但尚未接入（{hy.wiringBacklog?.length ?? 0} 项）
                <Text type="secondary" style={{ fontSize: 11, fontWeight: 400 }}>
                  　这些是工作量，不是缺口
                </Text>
              </div>
              <ul style={{ margin: 0, paddingLeft: 20, fontSize: 12, lineHeight: 1.9 }}>
                {(hy.wiringBacklog ?? []).map(g => <li key={g}>{g}</li>)}
                {!hy.wiringBacklog?.length && <li style={{ color: '#c7c7cc' }}>无</li>}
              </ul>

              <div style={{ fontSize: 13, fontWeight: 600, margin: '12px 0 6px' }}>
                本条成立也不意味着
              </div>
              <ul style={{ margin: 0, paddingLeft: 20, fontSize: 12, lineHeight: 1.9 }}>
                {hy.doesNotImply.map(dn => <li key={dn}>{dn}</li>)}
              </ul>

              <div style={{ fontSize: 13, fontWeight: 600, margin: '12px 0 6px' }}>阻塞项</div>
              <ul style={{ margin: 0, paddingLeft: 20, fontSize: 12, lineHeight: 1.9 }}>
                {hy.blockers.map(bl => <li key={bl}>{bl}</li>)}
              </ul>
            </div>
          ))}
        </Card>
      )}

      {/* ══ 数据缺口 ══ */}
      <Card style={SECTION} size="small" title="数据缺口 —— 不知道，本身就是信息">
        <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13, lineHeight: 1.9 }}>
          {(d.dataGaps ?? []).map((g: string, i: number) => <li key={i}>{g}</li>)}
        </ul>
        <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 10 }}>
          {d.noCompositeScoreNote}
        </Text>
      </Card>
      </>
      )}
    </div>
  )
}

export { TodayChanges }
export default FiveLayerDashboard
