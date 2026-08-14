// 今日结论 —— 四张表之上的一页总结
//
// 委员会 2026-08-14：「我不需要再去分析我们已经分析好的那些数据，
// 你给我简单、坦诚、阳光地说明一二三。然后我再后退去看后边的数据。」
//
// 所以这一屏必须能单独读完就够，四张表退化为附录。排版只服务一件事：
// 先给结论，再给依据。
//
// 本组件不做任何判断：所有分档、法定理由、缺口都由后端给出。
// 前端若自行判断，规则就会分裂成两份，而分裂的规则等于没有规则。

import React from 'react'
import { Alert, Card, Collapse, Space, Table, Tag, Typography } from 'antd'

const { Title, Text, Paragraph } = Typography

const pct = (v: number | null | undefined) =>
  v === null || v === undefined ? '缺失' : `${(v * 100).toFixed(1)}%`

const SECTION: React.CSSProperties = { marginBottom: 16 }

const HoldingTier: React.FC<{
  rows: any[]
  emptyText: string
  showLegal: boolean
}> = ({ rows, emptyText, showLegal }) => {
  if (!rows.length) return <Text type="secondary">{emptyText}</Text>
  return (
    <div>
      {rows.map((h: any) => (
        <div key={h.code} style={{ marginBottom: 14 }}>
          <Space wrap>
            <Text strong style={{ fontSize: 15 }}>{h.name}</Text>
            <Text type="secondary" style={{ fontSize: 12 }}>{h.code}</Text>
            <Tag>仓位 {pct(h.posPct)}</Tag>
            <Tag color={showLegal ? 'red' : 'default'}>{h.action}</Tag>
          </Space>
          <div style={{ fontSize: 13, marginTop: 4 }}>
            <Text type="secondary">法定减仓理由：</Text>
            {h.legalReason
              ? <Text style={{ color: '#ff3b30' }}>{h.legalReason}</Text>
              : <Text type="secondary">无</Text>}
          </div>
          <div style={{ fontSize: 12, color: '#666', marginTop: 4, lineHeight: 1.8 }}>
            {(h.saysWhat ?? []).join('；')}
          </div>
          {(h.notReason ?? []).length > 0 && (
            <div style={{ fontSize: 12, color: '#8e8e93', marginTop: 2 }}>
              明确不是理由：{h.notReason.join('；')}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

export interface TodayVerdictProps {
  verdict: any
}

const TodayVerdict: React.FC<TodayVerdictProps> = ({ verdict: v }) => {
  if (!v) return null

  return (
    <div>
      {/* ══ 一句话 + 焦点 ══ */}
      <Card
        style={{ ...SECTION, borderColor: '#ff3b30', borderWidth: 2 }}
        title={
          <Space>
            <Title level={5} style={{ margin: 0 }}>今日结论</Title>
            <Text type="secondary">{v.date}</Text>
          </Space>
        }
      >
        <Alert type="info" showIcon message={<Text strong>{v.oneLine}</Text>} style={{ marginBottom: 16 }} />

        <Title level={5} style={{ fontSize: 15 }}>
          焦点：今天真正需要你看的就这 {(v.focus ?? []).length} 个
        </Title>
        {(v.focus ?? []).length === 0 && <Text type="secondary">无。今天没有任何标的触发规则。</Text>}
        {(v.focus ?? []).map((f: any, i: number) => (
          <div key={i} style={{ marginBottom: 12 }}>
            <Space wrap>
              <Text strong style={{ fontSize: 15 }}>{i + 1}. {f.name}</Text>
              <Tag color={f.held ? 'green' : 'default'}>{f.held ? '持仓' : '未持仓'}</Tag>
            </Space>
            <div style={{ fontSize: 13, marginTop: 2, paddingLeft: 14 }}>
              <Text type="secondary">为什么在这里：</Text>{f.because}
            </div>
            <div style={{ fontSize: 13, marginTop: 2, paddingLeft: 14 }}>
              <Text type="secondary">今天做什么：</Text>{f.todo}
            </div>
          </div>
        ))}

        <Alert
          type="warning"
          showIcon
          style={{ marginTop: 12 }}
          message="研究覆盖"
          description={<span style={{ fontSize: 13 }}>{v.coverageVerdict}</span>}
        />
      </Card>

      {/* ══ 三档持仓 ══ */}
      <Card style={SECTION} title="持仓分档：法定理由 vs 仅触发复核">
        <Title level={5} style={{ fontSize: 14, color: '#ff3b30' }}>
          一、必须执行（有法定理由）—— {(v.mustDo ?? []).length} 项
        </Title>
        <HoldingTier rows={v.mustDo ?? []} emptyText="无。没有任何持仓触发法定减仓理由。" showLegal />

        <Title level={5} style={{ fontSize: 14, marginTop: 20 }}>
          二、触发复核但无法定理由 —— {(v.reviewNoAction ?? []).length} 项（系统不动作）
        </Title>
        <Paragraph type="secondary" style={{ fontSize: 12, marginBottom: 12 }}>
          这一档是整套系统最容易被自己推翻的地方：读到"多项恶化"很容易顺手卖出，
          但技术指标只被允许触发复核。没有法定理由就没有动作 —— 这条由类型系统强制。
        </Paragraph>
        <HoldingTier rows={v.reviewNoAction ?? []} emptyText="无" showLegal={false} />

        {(v.quiet ?? []).length > 0 && (
          <>
            <Title level={5} style={{ fontSize: 14, marginTop: 20 }}>
              三、无复核项也无法定理由 —— {v.quiet.length} 项
            </Title>
            <Space wrap>
              {v.quiet.map((q: any) => (
                <Tag key={q.name}>{q.name} {pct(q.posPct)}</Tag>
              ))}
            </Space>
          </>
        )}
      </Card>

      {/* ══ 允许研究 ══ */}
      <Card
        style={SECTION}
        title={`允许研究（不是允许买入）—— ${(v.research ?? []).length} 个节点`}
      >
        <Paragraph type="secondary" style={{ fontSize: 12 }}>
          「允许研究」不等于「再等等」。下面每条缺口都是一件今天可以开始做的核验任务。
        </Paragraph>
        <Table
          dataSource={(v.research ?? []).map((r: any, i: number) => ({ ...r, key: i }))}
          pagination={false}
          size="small"
          scroll={{ x: 'max-content' }}
          columns={[
            {
              title: '节点', dataIndex: 'node', width: 180,
              render: (n: string, r: any) => (
                <Space direction="vertical" size={0}>
                  <Text>{n}</Text>
                  {r.blockedByStrategy && <Tag color="red">战略层不允许</Tag>}
                </Space>
              ),
            },
            {
              title: '标的', width: 150,
              render: (_: any, r: any) => r.members?.length
                ? r.members.join('、')
                : <Text type="secondary">无在册标的</Text>,
            },
            {
              title: '数据在说什么',
              render: (_: any, r: any) => (
                <span style={{ fontSize: 12, color: '#666' }}>{(r.saysWhat ?? []).join('；')}</span>
              ),
            },
            {
              title: '缺口', width: 380,
              render: (_: any, r: any) => (
                <div style={{ fontSize: 12 }}>
                  {(r.missingGates ?? []).map((g: string, i: number) => <div key={i}>· {g}</div>)}
                </div>
              ),
            },
          ]}
        />
      </Card>

      {/* ══ 不许建仓 + 累计变化 + 答不了 ══ */}
      <Card style={SECTION}>
        <Collapse
          defaultActiveKey={['why', 'cannot']}
          items={[
            {
              key: 'why',
              label: <Text strong>今日不许新增建仓的逐条原因</Text>,
              children: (
                <ol style={{ margin: 0, paddingLeft: 20, lineHeight: 2 }}>
                  {(v.noEntryReasons ?? []).map((r: string, i: number) => <li key={i}>{r}</li>)}
                  {(v.noEntryReasons ?? []).length === 0 && <li>无禁止项</li>}
                </ol>
              ),
            },
            {
              key: 'drift',
              label: <Text strong>跨多日累计变化 —— 单日看不出的东西</Text>,
              children: (
                <div>
                  <Alert
                    type={(v.drift ?? []).length ? 'info' : 'warning'}
                    showIcon
                    style={{ marginBottom: 12 }}
                    message={<span style={{ fontSize: 13 }}>{v.driftNote}</span>}
                    description={v.driftWindow && (
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        区间 {v.driftWindow.from} → {v.driftWindow.to}（{v.driftWindow.days} 个交易日）
                      </Text>
                    )}
                  />
                  {(v.drift ?? []).map((g: any, gi: number) => (
                    <div key={gi} style={{ marginBottom: 14 }}>
                      <Text strong style={{ fontSize: 13 }}>{g.label}</Text>
                      {(g.items ?? []).map((it: any, i: number) => (
                        <div key={i} style={{ fontSize: 12, lineHeight: 2 }}>
                          <Text type="secondary">{it.key} · {it.field}　</Text>
                          <Text type="secondary">{it.from}</Text>
                          <Text> → </Text>
                          <Text strong>{it.to}</Text>
                          {it.monotonic && <Tag color="green" style={{ marginLeft: 6 }}>单向</Tag>}
                          <Text type="secondary" style={{ marginLeft: 6 }}>{it.days}天</Text>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              ),
            },
            {
              key: 'cannot',
              label: <Text strong>这套系统答不了的问题（附实测依据）</Text>,
              children: (
                <div>
                  <Paragraph type="secondary" style={{ fontSize: 12 }}>
                    把答不了的问题明确列出来，本身是结论的一部分 ——
                    否则读者会默认"没说不能，就是能"。
                  </Paragraph>
                  {(v.cannotAnswer ?? []).map((c: any, i: number) => (
                    <div key={i} style={{ marginBottom: 12 }}>
                      <Text strong style={{ fontSize: 13 }}>问：{c.question}</Text>
                      <div style={{ fontSize: 12, color: '#666', marginTop: 2, lineHeight: 1.9 }}>
                        答：{c.why}
                      </div>
                    </div>
                  ))}
                </div>
              ),
            },
          ]}
        />
      </Card>
    </div>
  )
}

export default TodayVerdict
