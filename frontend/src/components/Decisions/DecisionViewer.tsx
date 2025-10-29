import React, { useEffect, useState } from 'react'
import { Card, Spin, Alert, Row, Col, Statistic, Tag, List, Button, Progress, Timeline, Tabs } from 'antd'
import { 
  CheckCircleOutlined, 
  CloseCircleOutlined, 
  ExclamationCircleOutlined,
  RiseOutlined,
  FallOutlined,
  WarningOutlined,
  ClockCircleOutlined
} from '@ant-design/icons'
import { decisionsAPI } from '../../services/api'

const { TabPane } = Tabs

interface DecisionViewerProps {
  timeHorizon: 'daily' | 'weekly' | 'monthly'
}

const DecisionViewer: React.FC<DecisionViewerProps> = ({ timeHorizon }) => {
  const [loading, setLoading] = useState(true)
  const [decision, setDecision] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    generateDecision()
  }, [timeHorizon])

  const generateDecision = async () => {
    try {
      setLoading(true)
      const response = await decisionsAPI.generateDecision(timeHorizon)
      setDecision(response)
    } catch (err) {
      setError('生成投资决策失败')
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <Card>
        <div style={{ textAlign: 'center', padding: '50px' }}>
          <Spin size="large" />
        </div>
      </Card>
    )
  }

  if (error) {
    return (
      <Card>
        <Alert message={error} type="error" />
      </Card>
    )
  }

  if (!decision) {
    return (
      <Card>
        <Alert message="暂无决策数据" type="info" />
      </Card>
    )
  }

  const getActionColor = (action: string) => {
    switch (action) {
      case 'buy':
      case 'increase':
        return 'green'
      case 'sell':
      case 'reduce':
        return 'red'
      case 'continue':
        return 'blue'
      default:
        return 'default'
    }
  }

  const getActionIcon = (action: string) => {
    switch (action) {
      case 'buy':
      case 'increase':
        return <RiseOutlined />
      case 'sell':
      case 'reduce':
        return <FallOutlined />
      case 'continue':
        return <CheckCircleOutlined />
      default:
        return <ClockCircleOutlined />
    }
  }

  const getActionText = (action: string) => {
    switch (action) {
      case 'buy': return '买入'
      case 'sell': return '卖出'
      case 'continue': return '继续持有'
      case 'reduce': return '减仓'
      case 'increase': return '加仓'
      default: return action
    }
  }

  const getRiskColor = (level: string) => {
    switch (level) {
      case 'low': return '#52c41a'
      case 'medium': return '#faad14'
      case 'high': return '#ff4d4f'
      default: return '#666'
    }
  }

  const getRiskText = (level: string) => {
    switch (level) {
      case 'low': return '低风险'
      case 'medium': return '中风险'
      case 'high': return '高风险'
      default: return '未知'
    }
  }

  return (
    <div>
      <Card 
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <ClockCircleOutlined />
            {timeHorizon === 'daily' ? '日度' : timeHorizon === 'weekly' ? '周度' : '月度'}投资决策
            <Tag color="blue">{new Date(decision.timestamp).toLocaleString()}</Tag>
          </div>
        }
        style={{ marginBottom: 16 }}
        extra={
          <Button type="primary" onClick={generateDecision}>
            重新生成
          </Button>
        }
      >
        <Tabs defaultActiveKey="overview">
          <TabPane tab="整体评估" key="overview">
            <Row gutter={[16, 16]}>
              <Col xs={24} sm={6}>
                <Statistic
                  title="组合健康度"
                  value={decision.overallAssessment?.portfolioHealth || 0}
                  suffix="/100"
                  valueStyle={{ 
                    color: (decision.overallAssessment?.portfolioHealth || 0) >= 80 ? '#52c41a' : 
                           (decision.overallAssessment?.portfolioHealth || 0) >= 60 ? '#1890ff' : '#ff4d4f' 
                  }}
                />
                <Progress 
                  percent={decision.overallAssessment?.portfolioHealth || 0} 
                  strokeColor={(decision.overallAssessment?.portfolioHealth || 0) >= 80 ? '#52c41a' : 
                              (decision.overallAssessment?.portfolioHealth || 0) >= 60 ? '#1890ff' : '#ff4d4f'}
                  style={{ marginTop: 8 }}
                />
              </Col>
              <Col xs={24} sm={6}>
                <Statistic
                  title="风险等级"
                  value={getRiskText(decision.overallAssessment?.riskLevel || 'medium')}
                  valueStyle={{ color: getRiskColor(decision.overallAssessment?.riskLevel || 'medium') }}
                />
              </Col>
              <Col xs={24} sm={6}>
                <Statistic
                  title="预期收益"
                  value={decision.overallAssessment?.expectedReturn || 0}
                  suffix="%"
                  valueStyle={{ 
                    color: (decision.overallAssessment?.expectedReturn || 0) >= 0 ? '#52c41a' : '#ff4d4f' 
                  }}
                />
              </Col>
              <Col xs={24} sm={6}>
                <Statistic
                  title="决策置信度"
                  value={decision.overallAssessment?.confidence || 0}
                  suffix="%"
                  valueStyle={{ 
                    color: (decision.overallAssessment?.confidence || 0) >= 80 ? '#52c41a' : 
                           (decision.overallAssessment?.confidence || 0) >= 60 ? '#1890ff' : '#ff4d4f' 
                  }}
                />
              </Col>
            </Row>
          </TabPane>
          
          <TabPane tab="持仓决策" key="positions">
            <List
              dataSource={decision.positionDecisions || []}
              renderItem={(item: any) => (
                <List.Item>
                  <Card size="small" style={{ width: '100%' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                          <strong>{item.stockName} ({item.stockCode})</strong>
                          <Tag color="blue">{item.currentCategory}</Tag>
                          <Tag color={getActionColor(item.recommendedAction)} icon={getActionIcon(item.recommendedAction)}>
                            {getActionText(item.recommendedAction)}
                          </Tag>
                          <Tag color="green">置信度: {(item.confidence * 100).toFixed(1)}%</Tag>
                        </div>
                        <div style={{ color: '#666', marginBottom: 8 }}>
                          {item.reasoning}
                        </div>
                        <div style={{ display: 'flex', gap: 16, fontSize: '12px', color: '#999' }}>
                          {item.targetPrice && (
                            <span>目标价: {item.targetPrice.toFixed(2)}</span>
                          )}
                          {item.stopLoss && (
                            <span>止损价: {item.stopLoss.toFixed(2)}</span>
                          )}
                          {item.positionSize && (
                            <span>建议仓位: {item.positionSize}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </Card>
                </List.Item>
              )}
            />
          </TabPane>
          
          <TabPane tab="组合调整" key="portfolio">
            <Row gutter={[16, 16]}>
              <Col xs={24} sm={12}>
                <Card title="当前仓位分布" size="small">
                  <Row gutter={[8, 8]}>
                    <Col xs={12}>
                      <Statistic title="左侧仓位" value={decision.portfolioAdjustment?.leftSideRatio || 0} suffix="%" />
                    </Col>
                    <Col xs={12}>
                      <Statistic title="右侧仓位" value={decision.portfolioAdjustment?.rightSideRatio || 0} suffix="%" />
                    </Col>
                    <Col xs={12}>
                      <Statistic title="防御仓位" value={decision.portfolioAdjustment?.defensiveRatio || 0} suffix="%" />
                    </Col>
                    <Col xs={12}>
                      <Statistic title="观察仓位" value={decision.portfolioAdjustment?.observationRatio || 0} suffix="%" />
                    </Col>
                  </Row>
                </Card>
              </Col>
              <Col xs={24} sm={12}>
                <Card title="再平衡建议" size="small">
                  <List
                    dataSource={decision.portfolioAdjustment?.rebalancingActions || []}
                    renderItem={(action: any) => (
                      <List.Item>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <Tag color={action.priority === 'high' ? 'red' : action.priority === 'medium' ? 'orange' : 'blue'}>
                            {action.priority === 'high' ? '高优先级' : action.priority === 'medium' ? '中优先级' : '低优先级'}
                          </Tag>
                          <span>{action.action}</span>
                        </div>
                        <div style={{ fontSize: '12px', color: '#666', marginTop: 4 }}>
                          {action.reason}
                        </div>
                      </List.Item>
                    )}
                  />
                </Card>
              </Col>
            </Row>
          </TabPane>
          
          <TabPane tab="执行计划" key="execution">
            <Row gutter={[16, 16]}>
              <Col xs={24} sm={12}>
                <Card title="即时行动" size="small">
                  <List
                    dataSource={decision.nextSteps?.immediateActions || []}
                    renderItem={(action: string) => (
                      <List.Item>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <ExclamationCircleOutlined style={{ color: '#faad14' }} />
                          <span>{action}</span>
                        </div>
                      </List.Item>
                    )}
                  />
                </Card>
              </Col>
              <Col xs={24} sm={12}>
                <Card title="关注清单" size="small">
                  <List
                    dataSource={decision.nextSteps?.watchList || []}
                    renderItem={(item: string) => (
                      <List.Item>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <ClockCircleOutlined style={{ color: '#1890ff' }} />
                          <span>{item}</span>
                        </div>
                      </List.Item>
                    )}
                  />
                </Card>
              </Col>
            </Row>
            
            <Card title="提醒设置" size="small" style={{ marginTop: 16 }}>
              <List
                dataSource={decision.nextSteps?.alerts || []}
                renderItem={(alert: string) => (
                  <List.Item>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <WarningOutlined style={{ color: '#ff4d4f' }} />
                      <span>{alert}</span>
                    </div>
                  </List.Item>
                )}
              />
            </Card>
            
            <Card title="时间线" size="small" style={{ marginTop: 16 }}>
              <div style={{ textAlign: 'center', padding: '20px' }}>
                <Timeline>
                  <Timeline.Item color="green">
                    <div>
                      <strong>即时执行</strong>
                      <div style={{ color: '#666', fontSize: '12px' }}>
                        高优先级操作建议立即执行
                      </div>
                    </div>
                  </Timeline.Item>
                  <Timeline.Item color="blue">
                    <div>
                      <strong>短期调整</strong>
                      <div style={{ color: '#666', fontSize: '12px' }}>
                        {decision.nextSteps?.timeline || '1-2周内完成调整'}
                      </div>
                    </div>
                  </Timeline.Item>
                  <Timeline.Item color="gray">
                    <div>
                      <strong>持续观察</strong>
                      <div style={{ color: '#666', fontSize: '12px' }}>
                        关注市场变化，适时调整策略
                      </div>
                    </div>
                  </Timeline.Item>
                </Timeline>
              </div>
            </Card>
          </TabPane>
        </Tabs>
      </Card>
    </div>
  )
}

export default DecisionViewer
