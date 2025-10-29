import React, { useState, useEffect } from 'react'
import {
  Card,
  Typography,
  Tabs,
  Row,
  Col,
  Tag,
  Table,
  Button,
  Space,
  Alert,
  Progress,
  Timeline,
  Radio,
  Select,
  Divider,
  Tooltip
} from 'antd'
import {
  ClusterOutlined,
  RocketOutlined,
  SafetyOutlined,
  ExperimentOutlined,
  BankOutlined,
  SwapOutlined,
  LeftCircleOutlined,
  RightCircleOutlined,
  LineChartOutlined,
  WarningOutlined
} from '@ant-design/icons'
import { portfolioStrategyAPI } from '../services/api'

const { Title, Text, Paragraph } = Typography
const { Option } = Select

const PortfolioStrategy: React.FC = () => {
  const [loading, setLoading] = useState(false)
  const [themes, setThemes] = useState<any[]>([])
  const [selectedThemes, setSelectedThemes] = useState<string[]>([])
  const [composition, setComposition] = useState<any>(null)
  const [riskTolerance, setRiskTolerance] = useState('medium')

  useEffect(() => {
    loadThemes()
  }, [])

  const loadThemes = async () => {
    try {
      const data = await portfolioStrategyAPI.getThemes()
      setThemes(data || [])
    } catch (error) {
      console.error('加载主题失败:', error)
    }
  }

  const generatePortfolio = async () => {
    setLoading(true)
    try {
      const data = await portfolioStrategyAPI.getRecommendedPortfolio({
        riskTolerance
      })
      setComposition(data)
    } catch (error) {
      console.error('生成组合失败:', error)
    } finally {
      setLoading(false)
    }
  }

  const getThemeIcon = (type: string) => {
    const icons = {
      offensive: <RocketOutlined style={{ color: '#ff4d4f' }} />,
      defensive: <SafetyOutlined style={{ color: '#52c41a' }} />,
      tech: <ExperimentOutlined style={{ color: '#1890ff' }} />,
      policy: <BankOutlined style={{ color: '#faad14' }} />,
      trend: <SwapOutlined style={{ color: '#722ed1' }} />
    }
    return icons[type as keyof typeof icons] || <ClusterOutlined />
  }

  const getRiskColor = (level: string) => {
    const colors = {
      low: 'green',
      medium: 'orange',
      high: 'red'
    }
    return colors[level as keyof typeof colors] || 'default'
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
      title: '仓位占比',
      dataIndex: 'proportion',
      key: 'proportion',
      width: 100,
      render: (proportion: number) => (
        <Progress percent={proportion} size="small" />
      )
    },
    {
      title: '推荐理由',
      dataIndex: 'reason',
      key: 'reason',
      ellipsis: true
    },
    {
      title: '入场时机',
      dataIndex: 'entryPoint',
      key: 'entryPoint',
      width: 120
    }
  ]

  return (
    <div>
      <Title level={2}>
        <ClusterOutlined /> 组合策略联动系统
      </Title>

      <Alert
        message="组合策略说明"
        description={
          <div>
            <p><strong>核心逻辑</strong>：通过数据、政策、趋势建立组合联动，将左仓、右仓、主线形成组合策略</p>
            <p>每个策略主题都有明确的投资逻辑（进攻、防守、科技发展、机器人主线、半导体替代等）</p>
            <p>通过多主题组合，实现风险分散和收益优化</p>
          </div>
        }
        type="info"
        showIcon
        style={{ marginBottom: 24 }}
      />

      <Card title="选择风险偏好" style={{ marginBottom: 24 }}>
        <Radio.Group value={riskTolerance} onChange={(e) => setRiskTolerance(e.target.value)}>
          <Radio.Button value="low">
            <Tag color="green">低风险</Tag>
            主要配置防御型主题
          </Radio.Button>
          <Radio.Button value="medium">
            <Tag color="orange">中等风险</Tag>
            均衡配置各类主题
          </Radio.Button>
          <Radio.Button value="high">
            <Tag color="red">高风险</Tag>
            主要配置科技和趋势型主题
          </Radio.Button>
        </Radio.Group>
        <Button 
          type="primary" 
          onClick={generatePortfolio}
          loading={loading}
          style={{ marginLeft: 24 }}
        >
          生成组合策略
        </Button>
      </Card>

      {composition && (
        <>
          <Card title="组合概览" style={{ marginBottom: 24 }}>
            <Row gutter={[16, 16]}>
              <Col xs={24} sm={6}>
                <Card size="small" title="风险等级">
                  <Tag color={getRiskColor(composition.overallRiskControl.totalRisk)}>
                    {composition.overallRiskControl.totalRisk === 'high' ? '高风险' :
                     composition.overallRiskControl.totalRisk === 'medium' ? '中等风险' : '低风险'}
                  </Tag>
                  <div style={{ marginTop: 8 }}>
                    <Text type="secondary">最大回撤: {composition.overallRiskControl.maxDrawdown}%</Text>
                  </div>
                </Card>
              </Col>
              <Col xs={24} sm={6}>
                <Card size="small" title="组合分布">
                  <Space direction="vertical" size="small">
                    <div><Text>科技主题: {composition.currentAllocation.tech}%</Text></div>
                    <div><Text>防御主题: {composition.currentAllocation.defensive}%</Text></div>
                    <div><Text>政策主题: {composition.currentAllocation.policy}%</Text></div>
                  </Space>
                </Card>
              </Col>
              <Col xs={24} sm={12}>
                <Card size="small" title="风险控制建议">
                  <ul>
                    {composition.overallRiskControl.recommendedAdjustments.map((rec: string, idx: number) => (
                      <li key={idx}><Text>{rec}</Text></li>
                    ))}
                  </ul>
                </Card>
              </Col>
            </Row>
          </Card>

          <Tabs defaultActiveKey="0">
            {composition.strategies.map((strategy: any, index: number) => (
              <Tabs.TabPane
                key={index}
                tab={
                  <span>
                    {getThemeIcon(strategy.theme.type)}
                    {strategy.strategyName}
                  </span>
                }
              >
                <Card title={strategy.strategyName}>
                  <Paragraph>{strategy.theme.description}</Paragraph>
                  
                  <Alert
                    message="数据支持"
                    description={
                      <div>
                        <strong>综合支持度: {strategy.dataSupport.score}分</strong>
                        <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
                          <Col xs={24} sm={8}>
                            <div><strong>政策支持:</strong></div>
                            <ul>
                              {strategy.dataSupport.policySupport.map((item: string, idx: number) => (
                                <li key={idx}>{item}</li>
                              ))}
                            </ul>
                          </Col>
                          <Col xs={24} sm={8}>
                            <div><strong>趋势支持:</strong></div>
                            <ul>
                              {strategy.dataSupport.trendSupport.map((item: string, idx: number) => (
                                <li key={idx}>{item}</li>
                              ))}
                            </ul>
                          </Col>
                          <Col xs={24} sm={8}>
                            <div><strong>数据支持:</strong></div>
                            <ul>
                              {strategy.dataSupport.dataSupport.map((item: string, idx: number) => (
                                <li key={idx}>{item}</li>
                              ))}
                            </ul>
                          </Col>
                        </Row>
                      </div>
                    }
                    type="info"
                    style={{ marginBottom: 24 }}
                  />

                  <Row gutter={[16, 16]}>
                    <Col xs={24} sm={8}>
                      <Card title="左仓（轻仓试错）" size="small">
                        <Progress 
                          percent={strategy.portfolioAllocation.leftTotal} 
                          size="small"
                          strokeColor="#ff9800"
                        />
                        <Table
                          columns={columns}
                          dataSource={strategy.positions.leftPositions}
                          rowKey="stockCode"
                          pagination={false}
                          size="small"
                          style={{ marginTop: 16 }}
                        />
                      </Card>
                    </Col>
                    <Col xs={24} sm={8}>
                      <Card title="右仓（趋势确认）" size="small">
                        <Progress 
                          percent={strategy.portfolioAllocation.rightTotal} 
                          size="small"
                          strokeColor="#4caf50"
                        />
                        <Table
                          columns={columns}
                          dataSource={strategy.positions.rightPositions}
                          rowKey="stockCode"
                          pagination={false}
                          size="small"
                          style={{ marginTop: 16 }}
                        />
                      </Card>
                    </Col>
                    <Col xs={24} sm={8}>
                      <Card title="主线（趋势延续）" size="small">
                        <Progress 
                          percent={strategy.portfolioAllocation.mainlineTotal} 
                          size="small"
                          strokeColor="#2196f3"
                        />
                        <Table
                          columns={columns}
                          dataSource={strategy.positions.mainlinePositions}
                          rowKey="stockCode"
                          pagination={false}
                          size="small"
                          style={{ marginTop: 16 }}
                        />
                      </Card>
                    </Col>
                  </Row>

                  <Card 
                    title="时效性分析" 
                    style={{ marginTop: 16 }}
                    extra={
                      <Tag color={
                        strategy.timeliness.currentPhase === 'early' ? 'green' :
                        strategy.timeliness.currentPhase === 'late' ? 'red' : 'orange'
                      }>
                        {strategy.timeliness.currentPhase === 'early' ? '早期阶段' :
                         strategy.timeliness.currentPhase === 'middle' ? '中期阶段' :
                         strategy.timeliness.currentPhase === 'late' ? '后期阶段' : '衰退期'}
                      </Tag>
                    }
                  >
                    <p><strong>预期持续时间:</strong> {strategy.timeliness.expectedDuration}</p>
                    <div style={{ marginTop: 16 }}>
                      <strong>关键时间节点:</strong>
                      <Timeline style={{ marginTop: 16 }}>
                        {strategy.timeliness.keyEvents.map((event: any, idx: number) => (
                          <Timeline.Item
                            key={idx}
                            color={event.impact === 'high' ? 'red' : event.impact === 'medium' ? 'orange' : 'green'}
                          >
                            <p><strong>{event.date}</strong> - {event.event}</p>
                          </Timeline.Item>
                        ))}
                      </Timeline>
                    </div>
                  </Card>

                  <Card title="风险控制" style={{ marginTop: 16 }}>
                    <Row gutter={[16, 16]}>
                      <Col xs={24} sm={6}>
                        <div>最大回撤: {strategy.riskManagement.maxLoss}%</div>
                      </Col>
                      <Col xs={24} sm={6}>
                        <div>分散度: {strategy.riskManagement.diversification}</div>
                      </Col>
                      <Col xs={24} sm={6}>
                        <div>相关性: {strategy.riskManagement.correlation}</div>
                      </Col>
                      <Col xs={24} sm={6}>
                        <Tag color="red">风险等级: {strategy.theme.riskLevel === 'high' ? '高' :
                                         strategy.theme.riskLevel === 'medium' ? '中' : '低'}</Tag>
                      </Col>
                      {strategy.riskManagement.hedging.length > 0 && (
                        <Col xs={24}>
                          <div><strong>对冲建议:</strong></div>
                          <ul>
                            {strategy.riskManagement.hedging.map((h: string, idx: number) => (
                              <li key={idx}>{h}</li>
                            ))}
                          </ul>
                        </Col>
                      )}
                    </Row>
                  </Card>
                </Card>
              </Tabs.TabPane>
            ))}
          </Tabs>
        </>
      )}
    </div>
  )
}

export default PortfolioStrategy

