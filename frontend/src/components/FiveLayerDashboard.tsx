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

export interface FiveLayerDashboardProps {
  dashboard: any
  changes?: any
  discovery?: any
  /** 后端下发的盘中标记。未定价读数必须显式标注，否则会被当成收盘读数用 */
  provisional?: any
}

const FiveLayerDashboard: React.FC<FiveLayerDashboardProps> = ({
  dashboard: d, changes, discovery, provisional,
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

  return (
    <div>
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

      {/* ══ 资产层：委员会 2026-08-15 指定为第一层 ══ */}
      {d.assets && (
        <Card
          style={SECTION}
          title={<Title level={5} style={{ margin: 0 }}>资产层</Title>}
        >
          <Alert
            type="info"
            showIcon
            message={
              <Text strong style={{ fontSize: 15 }}>
                组合总资产 {(d.assets.portfolioTotal / 10000).toFixed(1)} 万　
                <Text type="secondary" style={{ fontSize: 13 }}>—— 一切上限的分母</Text>
              </Text>
            }
            description={
              <div style={{ fontSize: 13, lineHeight: 1.9 }}>
                股票 {(d.assets.positionsValue / 10000).toFixed(1)} 万
                （{d.assets.equityPct === null ? '缺失' : `${(d.assets.equityPct * 100).toFixed(1)}%`}）　
                现金 {((d.assets.brokerCash + d.assets.externalCash) / 10000).toFixed(1)} 万
                （{d.assets.cashPct === null ? '缺失' : `${(d.assets.cashPct * 100).toFixed(1)}%`}）
                <div style={{ marginTop: 2, color: '#666' }}>
                  ＝ 账内 {(d.assets.brokerCash / 10000).toFixed(1)} 万
                  ＋ 账户外股票现金 {(d.assets.externalCash / 10000).toFixed(1)} 万
                </div>
              </div>
            }
          />
          <div style={{ marginTop: 12, fontSize: 13, lineHeight: 1.9 }}>
            <Text type="secondary">券商账户合计 </Text>
            {(d.assets.brokerTotal / 10000).toFixed(1)} 万　
            <Text type="secondary">账户内仓位 </Text>
            {d.assets.brokerPositionPct === null ? '缺失' : `${(d.assets.brokerPositionPct * 100).toFixed(1)}%`}　
            <Text type="secondary">可直接下单 </Text>
            {(d.assets.tradableCash / 10000).toFixed(1)} 万
            <div style={{ fontSize: 12, color: '#8e8e93' }}>
              只回答「还有多少钱可直接下单」，<Text strong>不参与任何上限判定</Text>
            </div>
          </div>
          <Alert
            type={d.assets.circuitState === 'NORMAL' ? 'success' : 'warning'}
            showIcon
            style={{ marginTop: 12 }}
            message={<span style={{ fontSize: 13 }}>熔断状态 {d.assets.circuitState}</span>}
            description={
              d.assets.circuitState === 'INCOMPARABLE'
                ? <span style={{ fontSize: 12 }}>{d.assets.circuitReason}</span>
                : undefined
            }
          />
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

      {/* ══ 今日变化：核心输出，放在四张表之前 ══ */}
      <TodayChanges changes={changes} discovery={discovery} />

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

      {/* ══ 数据缺口 ══ */}
      <Card style={SECTION} size="small" title="数据缺口 —— 不知道，本身就是信息">
        <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13, lineHeight: 1.9 }}>
          {(d.dataGaps ?? []).map((g: string, i: number) => <li key={i}>{g}</li>)}
        </ul>
        <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 10 }}>
          {d.noCompositeScoreNote}
        </Text>
      </Card>
    </div>
  )
}

export default FiveLayerDashboard
