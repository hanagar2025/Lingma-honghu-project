// 《鸿鹄理财》V3 资本生命线
//
// 首页五块 + 六句话。四张研究表退到后面当依据。
// 本组件不做任何判断：状态、出口、理由全部由后端给出。

import React from 'react'
import { Alert, Card, Space, Table, Tag, Typography } from 'antd'

const { Title, Text } = Typography

const SECTION: React.CSSProperties = { marginBottom: 16 }

const ACTION_COLOR: Record<string, string> = {
  INCREASE_CAPITAL: 'green',
  HOLD_CAPITAL: 'default',
  OBSERVE: 'orange',
  REDUCE_EXPOSURE: 'gold',
  EXIT: 'red',
}

const ACTION_TEXT: Record<string, string> = {
  INCREASE_CAPITAL: '增加资本',
  HOLD_CAPITAL: '维持资本',
  OBSERVE: '观察',
  REDUCE_EXPOSURE: '减少暴露',
  EXIT: '退出',
}

const HUNTER_TEXT: Record<string, string> = {
  DISCOVER: '发现', OBSERVE: '观察', ENTRY: '建仓', ADD: '加仓',
  TOP_UP: '追加', CORE: '核心持有', TACTICAL_REDUCE: '战术减仓',
  VALUE_EXIT: '价值退出', REOBSERVE: '退出后重新观察',
}

const OWNERSHIP_TEXT: Record<string, string> = {
  STRATEGIC_CORE: '战略核心', STRATEGIC_ALLOWED: '战略允许',
  STRATEGIC_WATCH: '战略观察', STRATEGIC_VETO: '战略否决', RETIRED: '清退',
}

const pct = (v: number | null | undefined) =>
  v === null || v === undefined ? '' : `${(v * 100).toFixed(1)}%`

export interface DecisionCockpitProps {
  cockpit: any
}

const DecisionCockpit: React.FC<DecisionCockpitProps> = ({ cockpit: d }) => {
  if (!d) return null

  const sentences = d.sentences ?? d.questions ?? []
  const tasks: string[] = d.todayTasks ?? []
  const lifeline = d.lifeline ?? []
  const moves = d.capitalMoves ?? []
  const board = d.riskBoard

  return (
    <div>
      <Card
        style={SECTION}
        title={
          <Space direction="vertical" size={0}>
            <Title level={4} style={{ margin: 0 }}>《{d.productName}》{d.productModel}</Title>
            <Text type="secondary" style={{ fontSize: 12 }}>
              {d.date}　第一层看决策。第二层看理由。第三层看证据。
            </Text>
          </Space>
        }
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message="战略决定拥有什么；证据决定是否继续值得拥有；生命线决定下一步资本往哪走。"
          description={d.noCompositeScoreNote}
        />

        <Title level={5}>① 战略</Title>
        <Space direction="vertical" size={8} style={{ width: '100%', marginBottom: 16 }}>
          {(d.strategy ?? []).map((s: any) => (
            <div key={s.mainlineId} style={{ lineHeight: 1.7 }}>
              <Text strong>{s.name}</Text>
              <Text>　{s.board ?? s.headline}</Text>
              {!s.combat && <Tag style={{ marginLeft: 8 }}>只研究不进组合</Tag>}
              <div style={{ fontSize: 12, color: '#666', paddingLeft: 4 }}>
                {(s.why ?? []).slice(0, 2).join('；')}
              </div>
            </div>
          ))}
        </Space>

        <Title level={5}>② 资本应该往哪里走</Title>
        <Space direction="vertical" size={8} style={{ width: '100%', marginBottom: 16 }}>
          {moves.length === 0 && <Text type="secondary">（无持仓）</Text>}
          {moves.map((m: any) => (
            <div key={m.code} style={{ lineHeight: 1.7 }}>
              <Text strong>{m.name}</Text>
              <Tag color={ACTION_COLOR[m.action]} style={{ marginLeft: 8 }}>
                {ACTION_TEXT[m.action] ?? m.action}
              </Tag>
              <Text type="secondary">　{m.oneReason}</Text>
            </div>
          ))}
        </Space>

        <Title level={5}>③ 当前持仓生命线</Title>
        <Table
          size="small"
          pagination={false}
          style={{ marginBottom: 16 }}
          rowKey="code"
          dataSource={lifeline}
          columns={[
            {
              title: '标的', dataIndex: 'name',
              render: (name: string, r: any) => `${name}${pct(r.posPct) ? ` ${pct(r.posPct)}` : ''}`,
            },
            {
              title: '战略',
              render: (_: unknown, r: any) => `${r.ownYes ? '✓' : '✗'} ${OWNERSHIP_TEXT[r.ownership] ?? r.ownership}`,
            },
            {
              title: '生命线', dataIndex: 'hunter',
              render: (h: string) => HUNTER_TEXT[h] ?? h,
            },
            {
              title: '当前动作', dataIndex: 'action',
              render: (a: string) => <Tag color={ACTION_COLOR[a]}>{ACTION_TEXT[a] ?? a}</Tag>,
            },
            { title: '核心原因', dataIndex: 'oneReason' },
          ]}
        />

        <Title level={5}>④ 风险</Title>
        {board ? (
          <div style={{ marginBottom: 16, lineHeight: 1.8 }}>
            <div>战略风险　{board.strategy}　│　公司风险　{board.company}　│　预期风险　{board.expectation}　│　组合风险　{board.portfolio}</div>
            {(board.dataGaps ?? []).map((g: string, i: number) => (
              <div key={i} style={{ fontSize: 12, color: '#666' }}>· {g}</div>
            ))}
          </div>
        ) : (
          <Text type="secondary">风险板尚未生成</Text>
        )}

        <Title level={5}>⑤ 今天真正需要投资人做的事</Title>
        {tasks.length === 0 && <Text type="secondary">今日没有必须由投资人执行的事。</Text>}
        <Space direction="vertical" size={6} style={{ width: '100%' }}>
          {tasks.map((t, i) => (
            <div key={i}><Text strong>{i + 1}.</Text> {t}</div>
          ))}
        </Space>
      </Card>

      <Card
        style={SECTION}
        title={<Title level={5} style={{ margin: 0 }}>六句话</Title>}
      >
        <Space direction="vertical" size={14} style={{ width: '100%' }}>
          {sentences.map((q: any) => (
            <div key={q.no}>
              <Text strong>
                {['①', '②', '③', '④', '⑤', '⑥'][q.no - 1]} {q.question}
              </Text>
              <div style={{ fontSize: 14, marginTop: 4, lineHeight: 1.7 }}>
                {q.answer ?? q.headline}
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
