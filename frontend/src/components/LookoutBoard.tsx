// 看台 —— 投资人第一屏只看这四条带。
//
// 今天有没有足以改变资本状态的新事实？
// 必须处理 / 正在变化 / 明确维持。
//
// 本组件不产生判断：动作、理由、变化全部由后端给出。
// 价格复核对账单单独收口，不得写成风险或机会。

import React from 'react'
import { Alert, Card, Space, Tag, Typography } from 'antd'

const { Title, Text } = Typography

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

const SCOPE_TEXT: Record<string, string> = {
  STRUCTURE: '市场结构',
  HOLDING: '持仓',
  MAINLINE: '主线',
  NODE: '产业节点',
  NEXT_LAYER: '下一观察层',
}

/** 价格/均线/相对强弱类字段。只标复核，不进「必须处理」。 */
const PRICE_REVIEW_FIELD = /相对|MA20|MA60|PE历史|复核触发|成交|资金代理|趋势/

export type LookoutSection = 'must' | 'changes' | 'holds' | 'unknown'

export interface LookoutBoardProps {
  date?: string
  dailyQuestion?: string
  lifeline?: any[]
  changes?: { items?: any[]; prevDate?: string | null }
  pendingSellCount?: number
  pendingSells?: any[] | null
  unjudgable?: any[]
  onOpen?: (section: LookoutSection) => void
}

function isMustAction(action: string): boolean {
  return action === 'REDUCE_EXPOSURE' || action === 'EXIT' || action === 'INCREASE_CAPITAL'
}

function isPriceReview(field: string): boolean {
  return PRICE_REVIEW_FIELD.test(field ?? '')
}

const Linkish: React.FC<{ onClick?: () => void; children: React.ReactNode }> = ({
  onClick, children,
}) => (
  <Text
    style={{ fontSize: 12, color: '#1677ff', cursor: onClick ? 'pointer' : 'default' }}
    onClick={onClick}
  >
    {children}
  </Text>
)

const LookoutBoard: React.FC<LookoutBoardProps> = ({
  date,
  dailyQuestion,
  lifeline = [],
  changes,
  pendingSellCount = 0,
  pendingSells,
  unjudgable = [],
  onOpen,
}) => {
  const must = lifeline.filter(r => isMustAction(r.action))
  const holds = lifeline.filter(r => r.action === 'HOLD_CAPITAL')
  const items = changes?.items ?? []
  const capitalChanges = items.filter(c => !isPriceReview(c.field))
  const reviewChanges = items.filter(c => isPriceReview(c.field))
  const debtCount = pendingSells === null
    ? pendingSellCount
    : (pendingSells?.length ?? pendingSellCount)
  const hasNewFact = must.length > 0 || capitalChanges.length > 0 || debtCount > 0
  const question = dailyQuestion ?? '今天有没有出现足以改变资本状态的新事实？'
  const blockingUnknown = unjudgable.slice(0, 1)

  return (
    <Card
      style={{ marginBottom: 16, borderColor: '#1677ff', borderWidth: 2 }}
      title={
        <Space direction="vertical" size={0}>
          <Title level={4} style={{ margin: 0 }}>看台</Title>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {date ?? ''}　先看今天在变的。长期数据在「详细数据」里。
          </Text>
        </Space>
      }
    >
      <Alert
        type={hasNewFact ? 'warning' : 'success'}
        showIcon
        style={{ marginBottom: 16 }}
        message={question}
        description={
          hasNewFact
            ? '有。下面只列出必须处理的、以及今天真的变了的。'
            : '没有。今日维持是经过验证的决策，不是系统没看见。'
        }
      />

      <Title level={5} style={{ fontSize: 15 }}>必须处理（{must.length + (debtCount > 0 ? 1 : 0)}）</Title>
      {must.length === 0 && debtCount === 0 && (
        <Text type="secondary">今日没有必须改资本的事项。</Text>
      )}
      <Space direction="vertical" size={10} style={{ width: '100%', marginBottom: 16 }}>
        {must.map(r => (
          <div key={r.code}>
            <Space wrap>
              <Text strong>{r.name}</Text>
              <Tag color={ACTION_COLOR[r.action]}>{ACTION_TEXT[r.action] ?? r.action}</Tag>
              {r.exposure === '超限' && <Tag color="red">暴露超限</Tag>}
            </Space>
            <div style={{ fontSize: 13, marginTop: 2, paddingLeft: 2 }}>{r.oneReason}</div>
            <Linkish onClick={() => onOpen?.('must')}>查看依据</Linkish>
          </div>
        ))}
        {debtCount > 0 && (
          <div>
            <Space wrap>
              <Text strong>执行债务</Text>
              <Tag color="red">{debtCount} 条未清偿</Tag>
            </Space>
            <div style={{ fontSize: 13, marginTop: 2 }}>
              未清完不得新增建仓。这是组合纪律，不是选股结论。
            </div>
            <Linkish onClick={() => onOpen?.('must')}>查看依据</Linkish>
          </div>
        )}
      </Space>

      <Title level={5} style={{ fontSize: 15 }}>
        正在变化（{capitalChanges.length}）
      </Title>
      {!changes?.prevDate && (
        <Text type="secondary">尚无昨日对照，变化带明天才有内容。</Text>
      )}
      {changes?.prevDate && capitalChanges.length === 0 && (
        <div>
          <Text type="secondary">今日无足以改变资本状态的新事实。</Text>
        </div>
      )}
      <Space direction="vertical" size={6} style={{ width: '100%', marginBottom: 8 }}>
        {capitalChanges.slice(0, 8).map((c, i) => (
          <div key={`${c.scope}-${c.key}-${c.field}-${i}`} style={{ fontSize: 13, lineHeight: 1.8 }}>
            <Text type="secondary">{SCOPE_TEXT[c.scope] ?? c.scope} · {c.key} · {c.field}</Text>
            {' '}
            <Text type="secondary" delete>{c.from}</Text>
            {' → '}
            <Text strong>{c.to}</Text>
          </div>
        ))}
      </Space>
      {capitalChanges.length > 8 && (
        <Text type="secondary" style={{ fontSize: 12 }}>
          其余 {capitalChanges.length - 8} 项在依据里。
        </Text>
      )}
      {reviewChanges.length > 0 && (
        <div style={{ marginTop: 6 }}>
          <Text type="secondary" style={{ fontSize: 13 }}>
            另有 {reviewChanges.length} 项价格复核，点开看（不构成动作）。
          </Text>
        </div>
      )}
      <div style={{ marginBottom: 16 }}>
        <Linkish onClick={() => onOpen?.('changes')}>查看变化依据</Linkish>
      </div>

      <Title level={5} style={{ fontSize: 15 }}>明确维持（{holds.length}）</Title>
      {holds.length === 0 ? (
        <Text type="secondary">今日没有记为维持的持仓。</Text>
      ) : (
        <div>
          <div style={{ fontSize: 14, lineHeight: 1.7 }}>
            {holds.map(r => r.name).join('、')}
            ：有能力加仓，证据未到迁移标准，维持。
          </div>
          <Linkish onClick={() => onOpen?.('holds')}>查看生命线</Linkish>
        </div>
      )}

      {blockingUnknown.length > 0 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginTop: 16 }}
          message={`不可判断 ${unjudgable.length} 项`}
          description={
            <div>
              <div>{blockingUnknown[0].topic}：{blockingUnknown[0].why}</div>
              <Linkish onClick={() => onOpen?.('unknown')}>查看全部不可判断</Linkish>
            </div>
          }
        />
      )}
    </Card>
  )
}

export default LookoutBoard
