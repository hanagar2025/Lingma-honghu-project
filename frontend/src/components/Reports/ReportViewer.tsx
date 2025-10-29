import React, { useEffect, useState } from 'react'
import { Card, Spin, Alert, Tabs, Row, Col, Statistic, Tag, List, Progress, Timeline } from 'antd'
import { 
  ClockCircleOutlined, 
  RiseOutlined, 
  FallOutlined, 
  WarningOutlined,
  CheckCircleOutlined,
  ExclamationCircleOutlined
} from '@ant-design/icons'
import { reportsAPI } from '../../services/api'

const { TabPane } = Tabs

interface ReportViewerProps {
  reportType: 'pre_market' | 'intraday' | 'post_market' | 'daily_decision'
}

const ReportViewer: React.FC<ReportViewerProps> = ({ reportType }) => {
  const [loading, setLoading] = useState(true)
  const [report, setReport] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchReport()
  }, [reportType])

  const fetchReport = async () => {
    try {
      setLoading(true)
      const response = await reportsAPI.getDailyReports()
      const todayReport = response.find((r: any) => r.type === reportType)
      setReport(todayReport)
    } catch (err) {
      setError('获取报表失败')
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

  if (!report) {
    return (
      <Card>
        <Alert message="暂无报表数据" type="info" />
      </Card>
    )
  }

  const getReportTitle = () => {
    switch (reportType) {
      case 'pre_market': return '盘前准备报表'
      case 'intraday': return '盘中观察报表'
      case 'post_market': return '收盘复盘报表'
      case 'daily_decision': return '日终决策报表'
      default: return '智能报表'
    }
  }

  const getReportIcon = () => {
    switch (reportType) {
      case 'pre_market': return <ClockCircleOutlined />
      case 'intraday': return <RiseOutlined />
      case 'post_market': return <FallOutlined />
      case 'daily_decision': return <CheckCircleOutlined />
      default: return <ClockCircleOutlined />
    }
  }

  return (
    <div>
      <Card 
        title={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {getReportIcon()}
            {getReportTitle()}
            <Tag color="blue">{new Date(report.timestamp).toLocaleString()}</Tag>
          </div>
        }
        style={{ marginBottom: 16 }}
      >
        {renderReportContent()}
      </Card>
    </div>
  )

  function renderReportContent() {
    switch (reportType) {
      case 'pre_market':
        return renderPreMarketReport()
      case 'intraday':
        return renderIntradayReport()
      case 'post_market':
        return renderPostMarketReport()
      case 'daily_decision':
        return renderDailyDecisionReport()
      default:
        return <div>未知报表类型</div>
    }
  }

  function renderPreMarketReport() {
    const data = report.data
    return (
      <Tabs defaultActiveKey="overview">
        <TabPane tab="持仓概览" key="overview">
          <Row gutter={[16, 16]}>
            <Col xs={24} sm={8}>
              <Statistic
                title="持仓数量"
                value={data.portfolioOverview?.totalPositions || 0}
                suffix="只"
              />
            </Col>
            <Col xs={24} sm={8}>
              <Statistic
                title="持仓市值"
                value={data.portfolioOverview?.totalMarketValue || 0}
                prefix="¥"
                precision={2}
              />
            </Col>
            <Col xs={24} sm={8}>
              <Statistic
                title="总盈亏"
                value={data.portfolioOverview?.totalProfitLoss || 0}
                prefix="¥"
                precision={2}
                valueStyle={{ 
                  color: (data.portfolioOverview?.totalProfitLoss || 0) >= 0 ? '#52c41a' : '#ff4d4f' 
                }}
              />
            </Col>
          </Row>
        </TabPane>
        
        <TabPane tab="重要资讯" key="news">
          <List
            dataSource={data.importantNews || []}
            renderItem={(item: any) => (
              <List.Item>
                <List.Item.Meta
                  title={item.title}
                  description={
                    <div>
                      <div>{item.content}</div>
                      <div style={{ fontSize: '12px', color: '#666', marginTop: 4 }}>
                        {new Date(item.publishTime).toLocaleString()}
                      </div>
                    </div>
                  }
                />
              </List.Item>
            )}
          />
        </TabPane>
        
        <TabPane tab="今日关注" key="focus">
          <List
            dataSource={data.todayFocus || []}
            renderItem={(item: any) => (
              <List.Item>
                <Card size="small" style={{ width: '100%' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <strong>{item.stockName} ({item.stockCode})</strong>
                      <div style={{ marginTop: 4 }}>
                        <Tag color={item.trend === 'up' ? 'green' : item.trend === 'down' ? 'red' : 'blue'}>
                          {item.trend === 'up' ? '上升' : item.trend === 'down' ? '下降' : '震荡'}
                        </Tag>
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div>支撑: {item.support?.toFixed(2)}</div>
                      <div>压力: {item.resistance?.toFixed(2)}</div>
                    </div>
                  </div>
                </Card>
              </List.Item>
            )}
          />
        </TabPane>
        
        <TabPane tab="市场环境" key="market">
          <Row gutter={[16, 16]}>
            <Col xs={24} sm={12}>
              <Card title="大盘指数" size="small">
                {(data.marketEnvironment?.indices || []).map((index: any, i: number) => (
                  <div key={i} style={{ marginBottom: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>{index.name}</span>
                      <span style={{ 
                        color: index.change >= 0 ? '#52c41a' : '#ff4d4f' 
                      }}>
                        {index.change >= 0 ? '+' : ''}{index.change.toFixed(2)}
                      </span>
                    </div>
                  </div>
                ))}
              </Card>
            </Col>
            <Col xs={24} sm={12}>
              <Card title="市场情绪" size="small">
                <div>涨停: {data.marketEnvironment?.sentiment?.limitUp || 0}</div>
                <div>跌停: {data.marketEnvironment?.sentiment?.limitDown || 0}</div>
                <div>上涨: {data.marketEnvironment?.sentiment?.risingStocks || 0}</div>
                <div>下跌: {data.marketEnvironment?.sentiment?.fallingStocks || 0}</div>
              </Card>
            </Col>
          </Row>
        </TabPane>
      </Tabs>
    )
  }

  function renderIntradayReport() {
    const data = report.data
    return (
      <Tabs defaultActiveKey="realtime">
        <TabPane tab="实时盈亏" key="realtime">
          <Row gutter={[16, 16]}>
            <Col xs={24} sm={8}>
              <Statistic
                title="总盈亏"
                value={data.realtimePnl?.totalProfitLoss || 0}
                prefix="¥"
                precision={2}
                valueStyle={{ 
                  color: (data.realtimePnl?.totalProfitLoss || 0) >= 0 ? '#52c41a' : '#ff4d4f' 
                }}
              />
            </Col>
            <Col xs={24} sm={8}>
              <Statistic
                title="盈亏比例"
                value={data.realtimePnl?.totalProfitLossRate || 0}
                suffix="%"
                precision={2}
                valueStyle={{ 
                  color: (data.realtimePnl?.totalProfitLossRate || 0) >= 0 ? '#52c41a' : '#ff4d4f' 
                }}
              />
            </Col>
            <Col xs={24} sm={8}>
              <Statistic
                title="持仓数量"
                value={data.realtimePnl?.positions?.length || 0}
                suffix="只"
              />
            </Col>
          </Row>
        </TabPane>
        
        <TabPane tab="异动提醒" key="alerts">
          <List
            dataSource={data.alerts || []}
            renderItem={(item: any) => (
              <List.Item>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {item.level === 'warning' ? 
                    <ExclamationCircleOutlined style={{ color: '#faad14' }} /> : 
                    <CheckCircleOutlined style={{ color: '#52c41a' }} />
                  }
                  <div>
                    <strong>{item.stockName} ({item.stockCode})</strong>
                    <div>{item.message}</div>
                  </div>
                </div>
              </List.Item>
            )}
          />
        </TabPane>
        
        <TabPane tab="资金流向" key="moneyflow">
          <List
            dataSource={data.moneyFlow || []}
            renderItem={(item: any) => (
              <List.Item>
                <Card size="small" style={{ width: '100%' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <strong>{item.stockName} ({item.stockCode})</strong>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ 
                        color: item.netInflow >= 0 ? '#52c41a' : '#ff4d4f' 
                      }}>
                        净流入: {item.netInflow >= 0 ? '+' : ''}{item.netInflow.toLocaleString()}
                      </div>
                    </div>
                  </div>
                </Card>
              </List.Item>
            )}
          />
        </TabPane>
        
        <TabPane tab="操作建议" key="advice">
          <List
            dataSource={data.operationAdvice || []}
            renderItem={(item: any) => (
              <List.Item>
                <Card size="small" style={{ width: '100%' }}>
                  <div>
                    <strong>{item.stockName} ({item.stockCode})</strong>
                    <div style={{ marginTop: 8 }}>
                      {item.recommendations?.map((rec: any, index: number) => (
                        <Tag key={index} color="blue" style={{ margin: '2px' }}>
                          {rec.action}: {rec.reason}
                        </Tag>
                      ))}
                    </div>
                  </div>
                </Card>
              </List.Item>
            )}
          />
        </TabPane>
      </Tabs>
    )
  }

  function renderPostMarketReport() {
    const data = report.data
    return (
      <Tabs defaultActiveKey="performance">
        <TabPane tab="今日表现" key="performance">
          <Row gutter={[16, 16]}>
            <Col xs={24} sm={12}>
              <Card title="最佳表现" size="small">
                <div>
                  <strong>{data.dailyPerformance?.bestPerformer?.stock_name}</strong>
                  <div style={{ 
                    color: '#52c41a',
                    fontSize: '18px',
                    fontWeight: 'bold'
                  }}>
                    +{data.dailyPerformance?.bestPerformer?.profit_loss_rate?.toFixed(2)}%
                  </div>
                </div>
              </Card>
            </Col>
            <Col xs={24} sm={12}>
              <Card title="最差表现" size="small">
                <div>
                  <strong>{data.dailyPerformance?.worstPerformer?.stock_name}</strong>
                  <div style={{ 
                    color: '#ff4d4f',
                    fontSize: '18px',
                    fontWeight: 'bold'
                  }}>
                    {data.dailyPerformance?.worstPerformer?.profit_loss_rate?.toFixed(2)}%
                  </div>
                </div>
              </Card>
            </Col>
          </Row>
        </TabPane>
        
        <TabPane tab="技术复盘" key="technical">
          <List
            dataSource={data.technicalReview || []}
            renderItem={(item: any) => (
              <List.Item>
                <Card size="small" style={{ width: '100%' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <strong>{item.stockName} ({item.stockCode})</strong>
                      <div style={{ marginTop: 4 }}>
                        <Tag color={item.trend === 'up' ? 'green' : item.trend === 'down' ? 'red' : 'blue'}>
                          {item.trend === 'up' ? '上升' : item.trend === 'down' ? '下降' : '震荡'}
                        </Tag>
                        <Tag color="blue">强度: {item.strength?.toFixed(1)}</Tag>
                      </div>
                    </div>
                    <div>
                      {item.signals?.map((signal: any, index: number) => (
                        <Tag key={index} color="green" size="small">
                          {signal.description}
                        </Tag>
                      ))}
                    </div>
                  </div>
                </Card>
              </List.Item>
            )}
          />
        </TabPane>
        
        <TabPane tab="基本面变化" key="fundamental">
          <List
            dataSource={data.fundamentalChanges || []}
            renderItem={(item: any) => (
              <List.Item>
                <Card size="small" style={{ width: '100%' }}>
                  <div>
                    <strong>{item.stockName} ({item.stockCode})</strong>
                    <div style={{ marginTop: 8 }}>
                      <div>质量评分: {item.qualityScore?.toFixed(1)}/100</div>
                      <div>评级: <Tag color="blue">{item.rating}</Tag></div>
                      <div style={{ marginTop: 4 }}>
                        {item.strengths?.map((strength: string, index: number) => (
                          <Tag key={index} color="green" size="small">{strength}</Tag>
                        ))}
                        {item.weaknesses?.map((weakness: string, index: number) => (
                          <Tag key={index} color="red" size="small">{weakness}</Tag>
                        ))}
                      </div>
                    </div>
                  </div>
                </Card>
              </List.Item>
            )}
          />
        </TabPane>
        
        <TabPane tab="市场复盘" key="market">
          <Card title="市场总结" size="small">
            <div>市场趋势: {data.marketReview?.marketTrend}</div>
            <div>板块表现: {data.marketReview?.sectorPerformance}</div>
            <div>市场情绪: {data.marketReview?.marketSentiment}</div>
            <div style={{ marginTop: 8 }}>
              <strong>重要事件:</strong>
              <ul>
                {(data.marketReview?.keyEvents || []).map((event: string, index: number) => (
                  <li key={index}>{event}</li>
                ))}
              </ul>
            </div>
          </Card>
        </TabPane>
      </Tabs>
    )
  }

  function renderDailyDecisionReport() {
    const data = report.data
    return (
      <Tabs defaultActiveKey="diagnosis">
        <TabPane tab="持仓诊断" key="diagnosis">
          <Row gutter={[16, 16]}>
            <Col xs={24} sm={8}>
              <Statistic
                title="整体评分"
                value={data.portfolioDiagnosis?.overallScore || 0}
                suffix="/100"
                valueStyle={{ 
                  color: (data.portfolioDiagnosis?.overallScore || 0) >= 80 ? '#52c41a' : 
                         (data.portfolioDiagnosis?.overallScore || 0) >= 60 ? '#1890ff' : '#ff4d4f' 
                }}
              />
            </Col>
            <Col xs={24} sm={8}>
              <Statistic
                title="风险等级"
                value={data.portfolioDiagnosis?.riskLevel === 'low' ? '低风险' : 
                       data.portfolioDiagnosis?.riskLevel === 'medium' ? '中风险' : '高风险'}
                valueStyle={{ 
                  color: data.portfolioDiagnosis?.riskLevel === 'low' ? '#52c41a' : 
                         data.portfolioDiagnosis?.riskLevel === 'medium' ? '#faad14' : '#ff4d4f' 
                }}
              />
            </Col>
            <Col xs={24} sm={8}>
              <Statistic
                title="持仓数量"
                value={data.portfolioDiagnosis?.positions?.length || 0}
                suffix="只"
              />
            </Col>
          </Row>
        </TabPane>
        
        <TabPane tab="AI决策建议" key="recommendations">
          <List
            dataSource={data.aiRecommendations || []}
            renderItem={(item: any) => (
              <List.Item>
                <Card size="small" style={{ width: '100%' }}>
                  <div>
                    <strong>{item.stockName} ({item.stockCode})</strong>
                    <div style={{ marginTop: 8 }}>
                      <Tag color="blue">分类: {item.category}</Tag>
                      <Tag color="green">置信度: {(item.confidence * 100).toFixed(1)}%</Tag>
                    </div>
                    <div style={{ marginTop: 8 }}>
                      {item.recommendations?.map((rec: any, index: number) => (
                        <div key={index} style={{ marginBottom: 4 }}>
                          <Tag color={rec.action === 'buy' ? 'green' : rec.action === 'sell' ? 'red' : 'blue'}>
                            {rec.action === 'buy' ? '买入' : rec.action === 'sell' ? '卖出' : '持有'}
                          </Tag>
                          <span>{rec.reason}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </Card>
              </List.Item>
            )}
          />
        </TabPane>
        
        <TabPane tab="仓位调整" key="rebalancing">
          <Card title="仓位分布" size="small">
            <Row gutter={[16, 16]}>
              <Col xs={12} sm={6}>
                <Statistic title="左侧仓位" value={data.rebalancingPlan?.leftSideRatio || 0} suffix="%" />
              </Col>
              <Col xs={12} sm={6}>
                <Statistic title="右侧仓位" value={data.rebalancingPlan?.rightSideRatio || 0} suffix="%" />
              </Col>
              <Col xs={12} sm={6}>
                <Statistic title="防御仓位" value={data.rebalancingPlan?.defensiveRatio || 0} suffix="%" />
              </Col>
              <Col xs={12} sm={6}>
                <Statistic title="观察仓位" value={data.rebalancingPlan?.observationRatio || 0} suffix="%" />
              </Col>
            </Row>
          </Card>
          
          <Card title="调整建议" size="small" style={{ marginTop: 16 }}>
            <List
              dataSource={data.rebalancingPlan?.rebalancingActions || []}
              renderItem={(item: any) => (
                <List.Item>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Tag color={item.action === 'reduce' ? 'red' : 'green'}>
                      {item.action === 'reduce' ? '减仓' : '加仓'}
                    </Tag>
                    <span><strong>{item.stockCode}</strong> - {item.reason}</span>
                  </div>
                </List.Item>
              )}
            />
          </Card>
        </TabPane>
        
        <TabPane tab="明日计划" key="tomorrow">
          <Card title="关注清单" size="small">
            <List
              dataSource={data.tomorrowPlan?.watchList || []}
              renderItem={(item: string) => (
                <List.Item>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <ClockCircleOutlined />
                    <span>{item}</span>
                  </div>
                </List.Item>
              )}
            />
          </Card>
          
          <Card title="提醒设置" size="small" style={{ marginTop: 16 }}>
            <List
              dataSource={data.tomorrowPlan?.alerts || []}
              renderItem={(item: string) => (
                <List.Item>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <WarningOutlined />
                    <span>{item}</span>
                  </div>
                </List.Item>
              )}
            />
          </Card>
          
          <Card title="操作计划" size="small" style={{ marginTop: 16 }}>
            <List
              dataSource={data.tomorrowPlan?.operations || []}
              renderItem={(item: string) => (
                <List.Item>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <CheckCircleOutlined />
                    <span>{item}</span>
                  </div>
                </List.Item>
              )}
            />
          </Card>
        </TabPane>
      </Tabs>
    )
  }
}

export default ReportViewer
