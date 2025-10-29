import React, { useState, useEffect } from 'react'
import { 
  Card, 
  Typography, 
  Tabs, 
  Table, 
  Tag, 
  Space, 
  Button, 
  Row, 
  Col, 
  Alert, 
  Spin,
  Timeline,
  Progress,
  Tooltip,
  Divider
} from 'antd'
import { 
  BulbOutlined, 
  LeftCircleOutlined, 
  RightCircleOutlined,
  LineChartOutlined,
  StopOutlined,
  RiseOutlined,
  FallOutlined,
  CalendarOutlined,
  ExclamationCircleOutlined
} from '@ant-design/icons'
import { smartRecommendationAPI } from '../services/api'

const { Title, Text, Paragraph } = Typography

interface PositionRecommendation {
  stockCode: string
  stockName: string
  recommendedPosition: 'left' | 'right' | 'mainline' | 'defensive' | 'exit'
  currentStatus: {
    isHeld: boolean
    quantity?: number
    averagePrice?: number
    currentPrice: number
  }
  recommendation: {
    action: 'build' | 'add' | 'hold' | 'reduce' | 'exit' | 'upgrade'
    confidence: number
    reasoning: string[]
    urgency: 'high' | 'medium' | 'low'
  }
  timeNodes: {
    buildLeft: Array<{
      date: string
      price: number
      condition: string
      confidence: number
      action: string
      priority: 'high' | 'medium' | 'low'
    }>
    upgradeToRight: Array<any>
    upgradeToMainline: Array<any>
    addPosition: Array<any>
    reducePosition: Array<any>
    exit: Array<any>
  }
  positionSize: {
    recommendedLeftPosition: number
    recommendedRightPosition: number
    recommendedMainlinePosition: number
    maxPosition: number
  }
  riskControl: {
    stopLoss: number
    targetPrice: number
    positionLadder: Array<{
      price: number
      positionRatio: number
      description: string
    }>
  }
  prediction: {
    entrySignal: string
    exitSignal: string
    keyNodes: Array<{
      date: string
      event: string
      impact: 'high' | 'medium' | 'low'
      action: string
    }>
    trendForecast: {
      direction: 'up' | 'down' | 'sideways'
      probability: number
      timeframe: string
    }
  }
}

const SmartRecommendation: React.FC = () => {
  const [loading, setLoading] = useState(false)
  const [recommendations, setRecommendations] = useState<PositionRecommendation[]>([])
  const [selectedStock, setSelectedStock] = useState<PositionRecommendation | null>(null)

  useEffect(() => {
    loadRecommendations()
  }, [])

  const loadRecommendations = async () => {
    setLoading(true)
    try {
      const data = await smartRecommendationAPI.getOverview()
      setRecommendations(data.topRecommendations || [])
    } catch (error) {
      console.error('加载推荐失败:', error)
    } finally {
      setLoading(false)
    }
  }

  const getPositionTag = (position: string) => {
    const tags = {
      left: { color: 'orange', icon: <LeftCircleOutlined />, text: '左仓' },
      right: { color: 'green', icon: <RightCircleOutlined />, text: '右仓' },
      mainline: { color: 'blue', icon: <LineChartOutlined />, text: '主线' },
      defensive: { color: 'purple', icon: <StopOutlined />, text: '防御' },
      exit: { color: 'red', icon: <StopOutlined />, text: '退出' }
    }
    const tag = tags[position as keyof typeof tags]
    return <Tag color={tag.color} icon={tag.icon}>{tag.text}</Tag>
  }

  const getActionColor = (action: string) => {
    const colors = {
      build: 'green',
      add: 'blue',
      hold: 'default',
      reduce: 'orange',
      exit: 'red',
      upgrade: 'cyan'
    }
    return colors[action as keyof typeof colors] || 'default'
  }

  const columns = [
    {
      title: '股票代码',
      dataIndex: 'stockCode',
      key: 'stockCode',
      width: 100,
    },
    {
      title: '股票名称',
      dataIndex: 'stockName',
      key: 'stockName',
      width: 120,
    },
    {
      title: '推荐仓位',
      dataIndex: 'recommendedPosition',
      key: 'recommendedPosition',
      width: 100,
      render: (position: string) => getPositionTag(position)
    },
    {
      title: '操作建议',
      dataIndex: ['recommendation', 'action'],
      key: 'action',
      width: 100,
      render: (action: string) => (
        <Tag color={getActionColor(action)}>
          {action === 'build' ? '建仓' :
           action === 'add' ? '加仓' :
           action === 'hold' ? '持有' :
           action === 'reduce' ? '减仓' :
           action === 'exit' ? '退出' : '升级'}
        </Tag>
      )
    },
    {
      title: '置信度',
      dataIndex: ['recommendation', 'confidence'],
      key: 'confidence',
      width: 120,
      render: (confidence: number) => (
        <Progress percent={confidence} size="small" />
      )
    },
    {
      title: '紧迫度',
      dataIndex: ['recommendation', 'urgency'],
      key: 'urgency',
      width: 100,
      render: (urgency: string) => {
        const colors = { high: 'red', medium: 'orange', low: 'green' }
        return <Tag color={colors[urgency as keyof typeof colors]}>{urgency}</Tag>
      }
    },
    {
      title: '操作',
      key: 'action',
      width: 100,
      render: (_: any, record: PositionRecommendation) => (
        <Button type="link" onClick={() => setSelectedStock(record)}>
          查看详情
        </Button>
      )
    }
  ]

  return (
    <div>
      <Title level={2} style={{ marginBottom: 24 }}>
        <BulbOutlined /> 智能仓位推荐
      </Title>

      <Alert
        message="智能仓位推荐说明"
        description={
          <div>
            <p><strong>左仓</strong>：在行情未明确反转前提前建仓，用轻仓博弈趋势转向（建议10-30%）</p>
            <p><strong>右仓</strong>：在趋势明确确认后建仓，用重仓把握确定性收益（建议30-50%）</p>
            <p><strong>主线</strong>：趋势持续向上，可逐步加仓到主线仓位（建议50-70%）</p>
            <p>AI通过综合分析技术面、基本面、市场情绪等多维数据，为您推荐最优仓位配置</p>
          </div>
        }
        type="info"
        showIcon
        style={{ marginBottom: 24 }}
      />

      <Card loading={loading}>
        <Table
          columns={columns}
          dataSource={recommendations}
          rowKey="stockCode"
          pagination={false}
        />
      </Card>

      {selectedStock && (
        <Card 
          title={`${selectedStock.stockName} (${selectedStock.stockCode}) - 详细推荐`}
          style={{ marginTop: 24 }}
          extra={<Button onClick={() => setSelectedStock(null)}>关闭</Button>}
        >
          <Row gutter={[16, 16]}>
            <Col xs={24} sm={12}>
              <Card size="small" title="当前状态">
                {selectedStock.currentStatus.isHeld ? (
                  <div>
                    <p>已持有：{selectedStock.currentStatus.quantity} 股</p>
                    <p>成本价：¥{selectedStock.currentStatus.averagePrice?.toFixed(2)}</p>
                    <p>当前价：¥{selectedStock.currentStatus.currentPrice?.toFixed(2)}</p>
                  </div>
                ) : (
                  <p>当前未持有</p>
                )}
              </Card>
            </Col>
            <Col xs={24} sm={12}>
              <Card size="small" title="推荐仓位大小">
                <p>左仓：{selectedStock.positionSize.recommendedLeftPosition}%</p>
                <p>右仓：{selectedStock.positionSize.recommendedRightPosition}%</p>
                <p>主线：{selectedStock.positionSize.recommendedMainlinePosition}%</p>
                <p><strong>最大仓位：{selectedStock.positionSize.maxPosition}%</strong></p>
              </Card>
            </Col>
            <Col xs={24}>
              <Card size="small" title="推荐理由">
                <ul>
                  {selectedStock.recommendation.reasoning.map((reason, idx) => (
                    <li key={idx}>{reason}</li>
                  ))}
                </ul>
              </Card>
            </Col>
            <Col xs={24} sm={12}>
              <Card size="small" title="风险控制">
                <p>止损价：¥{selectedStock.riskControl.stopLoss?.toFixed(2)}</p>
                <p>目标价：¥{selectedStock.riskControl.targetPrice?.toFixed(2)}</p>
                <Divider />
                <h4>仓位阶梯：</h4>
                {selectedStock.riskControl.positionLadder.map((ladder, idx) => (
                  <p key={idx}>{ladder.description}</p>
                ))}
              </Card>
            </Col>
            <Col xs={24} sm={12}>
              <Card size="small" title="趋势预测">
                <p>
                  <strong>方向：</strong>
                  {selectedStock.prediction.trendForecast.direction === 'up' && (
                    <Tag color="green" icon={<RiseOutlined />}>向上</Tag>
                  )}
                  {selectedStock.prediction.trendForecast.direction === 'down' && (
                    <Tag color="red" icon={<FallOutlined />}>向下</Tag>
                  )}
                  {selectedStock.prediction.trendForecast.direction === 'sideways' && (
                    <Tag>震荡</Tag>
                  )}
                </p>
                <p><strong>概率：</strong>{selectedStock.prediction.trendForecast.probability}%</p>
                <p><strong>时间框架：</strong>{selectedStock.prediction.trendForecast.timeframe}</p>
              </Card>
            </Col>
            <Col xs={24}>
              <Card size="small" title="时间节点">
                <Tabs size="small">
                  {selectedStock.timeNodes.buildLeft.length > 0 && (
                    <Tabs.TabPane tab="建左仓" key="buildLeft">
                      <Timeline>
                        {selectedStock.timeNodes.buildLeft.map((node, idx) => (
                          <Timeline.Item 
                            key={idx}
                            color={node.priority === 'high' ? 'red' : node.priority === 'medium' ? 'orange' : 'green'}
                          >
                            <p><strong>{node.date}</strong> - {node.action}</p>
                            <p>{node.condition}</p>
                          </Timeline.Item>
                        ))}
                      </Timeline>
                    </Tabs.TabPane>
                  )}
                  {selectedStock.timeNodes.upgradeToRight.length > 0 && (
                    <Tabs.TabPane tab="升级右仓" key="upgradeToRight">
                      <Timeline>
                        {selectedStock.timeNodes.upgradeToRight.map((node, idx) => (
                          <Timeline.Item 
                            key={idx}
                            color={node.priority === 'high' ? 'red' : node.priority === 'medium' ? 'orange' : 'green'}
                          >
                            <p><strong>{node.date}</strong> - {node.action}</p>
                            <p>{node.condition}</p>
                          </Timeline.Item>
                        ))}
                      </Timeline>
                    </Tabs.TabPane>
                  )}
                  {selectedStock.timeNodes.exit.length > 0 && (
                    <Tabs.TabPane tab="退出" key="exit">
                      <Timeline>
                        {selectedStock.timeNodes.exit.map((node, idx) => (
                          <Timeline.Item key={idx} color="red">
                            <p><strong>{node.date}</strong> - {node.action}</p>
                            <p>{node.condition}</p>
                          </Timeline.Item>
                        ))}
                      </Timeline>
                    </Tabs.TabPane>
                  )}
                </Tabs>
              </Card>
            </Col>
            <Col xs={24}>
              <Card size="small" title="交易信号">
                <Alert
                  message="入场信号"
                  description={selectedStock.prediction.entrySignal}
                  type="success"
                  style={{ marginBottom: 16 }}
                />
                <Alert
                  message="出场信号"
                  description={selectedStock.prediction.exitSignal}
                  type="error"
                />
              </Card>
            </Col>
            <Col xs={24}>
              <Card size="small" title="关键节点">
                <Timeline>
                  {selectedStock.prediction.keyNodes.map((node, idx) => (
                    <Timeline.Item 
                      key={idx}
                      dot={<CalendarOutlined />}
                      color={node.impact === 'high' ? 'red' : node.impact === 'medium' ? 'orange' : 'green'}
                    >
                      <p><strong>{node.date}</strong> - {node.event}</p>
                      <p>{node.action}</p>
                    </Timeline.Item>
                  ))}
                </Timeline>
              </Card>
            </Col>
          </Row>
        </Card>
      )}
    </div>
  )
}

export default SmartRecommendation

