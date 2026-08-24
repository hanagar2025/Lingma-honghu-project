// 看台 —— 投资人第一屏。
//
// 数据后台越来越完整。投资人前台只看这一问：
// 今天有没有出现足以改变资本状态的新事实？
//
// 必须完整呈现四轴：Ownership / Evidence / Exposure / Action。
// 只显示动作，会把「核心 + 超限 + 降暴露」读成「这家公司没价值」。
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

export type LookoutSection = 'must' | 'changes' | 'holds' | 'unknown'

export interface LookoutBoardProps {
  date?: string
  dailyQuestion?: string
  lifeline?: any[]
  changes?: { items?: any[]; prevDate?: string | null }
  pendingSellCount?: number
  pendingSells?: any[] | null
  unjudgable?: any[]
  lookout?: any
  onOpen?: (section: LookoutSection) => void
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

const Axis: React.FC<{ r: any }> = ({ r }) => (
  <Space wrap size={[4, 4]} style={{ marginTop: 4 }}>
    <Tag color={ACTION_COLOR[r.action] ?? 'default'}>{r.actionText ?? r.action}</Tag>
    <Tag>{r.ownYes ? '✓' : '✗'} {r.ownership}</Tag>
    <Tag>Evidence {r.evidence}</Tag>
    <Tag color={r.exposure === '超限' ? 'red' : 'default'}>Exposure {r.exposure}</Tag>
    <Tag>{r.hunter}</Tag>
  </Space>
)

const NameBlock: React.FC<{ r: any; onOpen?: () => void; link: string }> = ({
  r, onOpen, link,
}) => (
  <div>
    <Text strong>{r.name}</Text>
    <Axis r={r} />
    <div style={{ fontSize: 13, marginTop: 4, paddingLeft: 2, lineHeight: 1.7 }}>
      {r.oneReason}
    </div>
    <Linkish onClick={onOpen}>{link}</Linkish>
  </div>
)

const LookoutBoard: React.FC<LookoutBoardProps> = ({
  date,
  lookout,
  onOpen,
}) => {
  if (!lookout) {
    return (
      <Card style={{ marginBottom: 16, borderColor: '#1677ff', borderWidth: 2 }}>
        <Alert type="warning" showIcon message="看台尚未生成" description="后端未返回 lookout 字段。详细数据仍可点开。" />
      </Card>
    )
  }

  const must = lookout.must ?? []
  const holds = lookout.holds ?? []
  const observes = lookout.observes ?? []
  const capitalChanges = lookout.capitalChanges ?? []
  const reviewChanges = lookout.reviewChanges ?? []
  const unjudgable = lookout.unjudgable ?? []
  const debtCount = lookout.debtCount ?? 0
  const blockingUnknown = unjudgable.slice(0, 1)

  return (
    <Card
      style={{ marginBottom: 16, borderColor: '#1677ff', borderWidth: 2 }}
      title={
        <Space direction="vertical" size={0}>
          <Title level={4} style={{ margin: 0 }}>看台</Title>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {lookout.date ?? date ?? ''}　数据后台越来越完整。投资人前台只看这一问。
          </Text>
        </Space>
      }
    >
      <Alert
        type={lookout.hasNewFact ? 'warning' : 'success'}
        showIcon
        style={{ marginBottom: 12 }}
        message={lookout.dailyQuestion}
        description={lookout.answer}
      />

      <div style={{ fontSize: 13, lineHeight: 1.8, marginBottom: 12 }}>
        <div>{lookout.principle}</div>
        <div style={{ color: '#8e8e93' }}>{lookout.object}</div>
        <div style={{ color: '#8e8e93' }}>{lookout.priceIsNotLoss}</div>
      </div>

      <div style={{ fontSize: 12, lineHeight: 1.8, marginBottom: 16, color: '#8e8e93' }}>
        <div>{(lookout.spine ?? []).map((s: any) => s.name).join(' → ')}</div>
        <div>{lookout.spineNote}</div>
      </div>

      <Title level={5} style={{ fontSize: 15 }}>必须处理（{must.length + (debtCount > 0 ? 1 : 0)}）</Title>
      {must.length === 0 && debtCount === 0 && (
        <Text type="secondary">今日没有必须改资本的事项。</Text>
      )}
      <Space direction="vertical" size={12} style={{ width: '100%', marginBottom: 16 }}>
        {must.map((r: any) => (
          <NameBlock key={r.code} r={r} onOpen={() => onOpen?.('must')} link="查看依据" />
        ))}
        {debtCount > 0 && (
          <div>
            <Space wrap>
              <Text strong>执行债务</Text>
              <Tag color="red">{debtCount} 条未清偿</Tag>
            </Space>
            <div style={{ fontSize: 13, marginTop: 2 }}>{lookout.debtNote}</div>
            <Linkish onClick={() => onOpen?.('must')}>查看依据</Linkish>
          </div>
        )}
      </Space>

      <Title level={5} style={{ fontSize: 15 }}>
        正在变化（{capitalChanges.length}）
      </Title>
      {!lookout.prevDate && (
        <Text type="secondary">尚无昨日对照，变化带明天才有内容。</Text>
      )}
      {lookout.prevDate && capitalChanges.length === 0 && (
        <Text type="secondary">今日无足以改变资本状态的新事实。</Text>
      )}
      <Space direction="vertical" size={6} style={{ width: '100%', marginBottom: 8 }}>
        {capitalChanges.slice(0, 8).map((c: any, i: number) => (
          <div key={`${c.scope}-${c.key}-${c.field}-${i}`} style={{ fontSize: 13, lineHeight: 1.8 }}>
            <Text type="secondary">{c.scope} · {c.key} · {c.field}</Text>
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

      {observes.length > 0 && (
        <>
          <Title level={5} style={{ fontSize: 15 }}>仍在观察（{observes.length}）</Title>
          <div style={{ fontSize: 12, color: '#8e8e93', marginBottom: 8 }}>
            观察不是卖出，也不是维持资本。
          </div>
          <Space direction="vertical" size={12} style={{ width: '100%', marginBottom: 16 }}>
            {observes.map((r: any) => (
              <NameBlock key={r.code} r={r} onOpen={() => onOpen?.('holds')} link="查看生命线" />
            ))}
          </Space>
        </>
      )}

      <Title level={5} style={{ fontSize: 15 }}>明确维持（{holds.length}）</Title>
      {holds.length === 0 ? (
        <Text type="secondary">今日没有记为维持的持仓。</Text>
      ) : (
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          {holds.map((r: any) => (
            <NameBlock key={r.code} r={r} onOpen={() => onOpen?.('holds')} link="查看生命线" />
          ))}
          <Text type="secondary" style={{ fontSize: 12 }}>{lookout.holdIsDecision}</Text>
        </Space>
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
