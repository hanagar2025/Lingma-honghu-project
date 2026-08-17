// 《鸿鹄理财》V2 决策驾驶舱
//
// 首页只回答 6 个问题。四张研究表退到后面当依据。
// 本组件不做任何判断：状态、出口、理由全部由后端给出。

import React from 'react'
import { Alert, Card, Space, Tag, Typography } from 'antd'

const { Title, Text } = Typography

const SECTION: React.CSSProperties = { marginBottom: 16 }

const DOT: Record<string, string> = {
  STRENGTHENED: '🟢', HOLDS: '🟢', WATCH: '🟡', WEAKENED: '🔴', FALSIFIED: '⛔',
}

const LANE_COLOR: Record<string, string> = {
  ENHANCE: 'green', OBSERVE: 'orange', FORBID: 'red',
}

const LANE_TEXT: Record<string, string> = {
  ENHANCE: '增强', OBSERVE: '观察', FORBID: '禁止',
}

const pct = (v: number | null | undefined) =>
  v === null || v === undefined ? '' : `　${(v * 100).toFixed(1)}%`

export interface DecisionCockpitProps {
  cockpit: any
}

const DecisionCockpit: React.FC<DecisionCockpitProps> = ({ cockpit: d }) => {
  if (!d) return null

  const capital = [
    { key: 'enhance', lane: 'ENHANCE', rows: d.capital?.enhance ?? [] },
    { key: 'observe', lane: 'OBSERVE', rows: d.capital?.observe ?? [] },
    { key: 'forbid', lane: 'FORBID', rows: d.capital?.forbid ?? [] },
  ]

  return (
    <div>
      <Card
        style={SECTION}
        title={
          <Space direction="vertical" size={0}>
            <Title level={4} style={{ margin: 0 }}>《{d.productName}》{d.productModel}</Title>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {d.date}　本页回答决策。下面的表是依据。
            </Text>
          </Space>
        }
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="战略是状态，战术是阶段，仓位是预算。三者不能加权成分数。"
          description={d.noCompositeScoreNote}
        />

        <Title level={5}>第一块　战略</Title>
        <Space direction="vertical" size={8} style={{ width: '100%', marginBottom: 16 }}>
          {(d.strategy ?? []).map((s: any) => (
            <div key={s.mainlineId} style={{ lineHeight: 1.7 }}>
              <Text strong>{DOT[s.strategic] ?? '⚪'} {s.name}</Text>
              <Text>　{s.headline}</Text>
              {!s.combat && <Tag style={{ marginLeft: 8 }}>只研究不进组合</Tag>}
              <div style={{ fontSize: 12, color: '#666', paddingLeft: 22 }}>
                {(s.why ?? []).slice(0, 3).join('；')}
              </div>
            </div>
          ))}
        </Space>

        <Title level={5}>第二块　资本应该往哪里去？（不是排名）</Title>
        <Space direction="vertical" size={12} style={{ width: '100%', marginBottom: 16 }}>
          {capital.map(block => (
            <div key={block.key}>
              <Tag color={LANE_COLOR[block.lane]}>{LANE_TEXT[block.lane]}</Tag>
              {block.rows.length === 0 && (
                <Text type="secondary" style={{ marginLeft: 8 }}>（无）</Text>
              )}
              {block.rows.map((r: any) => (
                <div key={r.code} style={{ marginTop: 6, paddingLeft: 8, lineHeight: 1.7 }}>
                  <Text strong>{r.name}</Text>
                  <Text type="secondary">　{r.node}　{r.mainline}</Text>
                  <div style={{ fontSize: 12, color: '#666' }}>
                    {(r.facts ?? []).slice(0, 3).join('；')}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </Space>

        <Title level={5}>第三块　每一只持仓一句投资状态</Title>
        <Space direction="vertical" size={14} style={{ width: '100%' }}>
          {(d.holdings ?? []).map((h: any) => (
            <div
              key={h.code}
              style={{
                padding: '12px 14px', borderRadius: 12, background: '#f2f2f7',
                lineHeight: 1.75,
              }}
            >
              <Text strong style={{ fontSize: 15 }}>{h.name}</Text>
              <Text type="secondary">{pct(h.posPct)}</Text>
              <div style={{ fontSize: 13, marginTop: 4 }}>{h.ownLogic}</div>
              <div style={{ fontSize: 13 }}>{h.riskLine}</div>
              <div style={{ fontSize: 13 }}>{h.portfolioLine}</div>
              <div style={{ fontSize: 14, fontWeight: 600, marginTop: 4 }}>{h.decision}</div>
              <div style={{ fontSize: 12, color: '#666' }}>{h.why}</div>
            </div>
          ))}
        </Space>
      </Card>

      <Card
        style={SECTION}
        title={<Title level={5} style={{ margin: 0 }}>每天只回答这 6 个问题</Title>}
      >
        <Space direction="vertical" size={14} style={{ width: '100%' }}>
          {(d.questions ?? []).map((q: any) => (
            <div key={q.no}>
              <Text strong>
                {['①', '②', '③', '④', '⑤', '⑥'][q.no - 1]} {q.question}
              </Text>
              <div style={{ fontSize: 14, marginTop: 4, lineHeight: 1.7 }}>{q.headline}</div>
              <div style={{ fontSize: 12, color: '#666', marginTop: 4, lineHeight: 1.8 }}>
                {(q.lines ?? []).slice(0, 6).map((line: string, i: number) => (
                  <div key={i}>· {line}</div>
                ))}
              </div>
            </div>
          ))}
        </Space>
      </Card>

      {(d.missingForDecision ?? []).length > 0 && (
        <Alert
          type="warning"
          showIcon
          style={SECTION}
          message="还缺什么才能做完整决策（按优先级，不是再加技术指标）"
          description={
            <ul style={{ margin: '6px 0 0', paddingLeft: 20, lineHeight: 1.8 }}>
              {d.missingForDecision.map((m: string, i: number) => <li key={i}>{m}</li>)}
            </ul>
          }
        />
      )}
    </div>
  )
}

export default DecisionCockpit
