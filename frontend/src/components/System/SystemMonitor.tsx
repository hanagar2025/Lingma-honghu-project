import React, { useEffect, useState } from 'react'
import { Card, Spin, Alert, Row, Col, Statistic, Progress, Tag, List, Button, Tabs } from 'antd'
import { 
  DashboardOutlined, 
  WarningOutlined, 
  CheckCircleOutlined, 
  ExclamationCircleOutlined,
  ClockCircleOutlined,
  BarChartOutlined,
  SettingOutlined
} from '@ant-design/icons'
import { systemAPI } from '../../services/api'

const { TabPane } = Tabs

const SystemMonitor: React.FC = () => {
  const [loading, setLoading] = useState(true)
  const [metrics, setMetrics] = useState<any>(null)
  const [health, setHealth] = useState<any>(null)
  const [suggestions, setSuggestions] = useState<any[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchSystemData()
  }, [])

  const fetchSystemData = async () => {
    try {
      setLoading(true)
      const [metricsRes, healthRes, suggestionsRes] = await Promise.all([
        systemAPI.getMetrics(),
        systemAPI.getHealth(),
        systemAPI.getOptimization()
      ])
      
      setMetrics(metricsRes)
      setHealth(healthRes)
      setSuggestions(suggestionsRes)
    } catch (err) {
      setError('获取系统数据失败')
    } finally {
      setLoading(false)
    }
  }

  const executeOptimization = async (optimizationId: string) => {
    try {
      await systemAPI.executeOptimization(optimizationId)
      // 重新获取数据
      fetchSystemData()
    } catch (err) {
      console.error('执行优化失败:', err)
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

  const getHealthColor = (status: string) => {
    switch (status) {
      case 'healthy': return '#52c41a'
      case 'warning': return '#faad14'
      case 'critical': return '#ff4d4f'
      default: return '#666'
    }
  }

  const getHealthIcon = (status: string) => {
    switch (status) {
      case 'healthy': return <CheckCircleOutlined />
      case 'warning': return <ExclamationCircleOutlined />
      case 'critical': return <WarningOutlined />
      default: return <ClockCircleOutlined />
    }
  }

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'critical': return 'red'
      case 'high': return 'orange'
      case 'medium': return 'blue'
      case 'low': return 'green'
      default: return 'default'
    }
  }

  return (
    <div>
      <Card title="系统监控概览" style={{ marginBottom: 16 }}>
        <Row gutter={[16, 16]}>
          <Col xs={24} sm={6}>
            <Statistic
              title="系统状态"
              value={health?.status === 'healthy' ? '健康' : health?.status === 'warning' ? '警告' : '严重'}
              valueStyle={{ color: getHealthColor(health?.status || 'unknown') }}
              prefix={getHealthIcon(health?.status || 'unknown')}
            />
          </Col>
          <Col xs={24} sm={6}>
            <Statistic
              title="响应时间"
              value={metrics?.performance?.responseTime || 0}
              suffix="ms"
              valueStyle={{ 
                color: (metrics?.performance?.responseTime || 0) > 1000 ? '#ff4d4f' : 
                       (metrics?.performance?.responseTime || 0) > 500 ? '#faad14' : '#52c41a' 
              }}
            />
          </Col>
          <Col xs={24} sm={6}>
            <Statistic
              title="错误率"
              value={((metrics?.performance?.errorRate || 0) * 100).toFixed(2)}
              suffix="%"
              valueStyle={{ 
                color: (metrics?.performance?.errorRate || 0) > 0.05 ? '#ff4d4f' : 
                       (metrics?.performance?.errorRate || 0) > 0.01 ? '#faad14' : '#52c41a' 
              }}
            />
          </Col>
          <Col xs={24} sm={6}>
            <Statistic
              title="系统运行时间"
              value={((metrics?.performance?.uptime || 0) * 100).toFixed(1)}
              suffix="%"
              valueStyle={{ color: '#52c41a' }}
            />
          </Col>
        </Row>
      </Card>

      <Card title="系统监控详情">
        <Tabs defaultActiveKey="performance">
          <TabPane tab="性能监控" key="performance">
            <Row gutter={[16, 16]}>
              <Col xs={24} sm={12}>
                <Card title="响应时间" size="small">
                  <div style={{ marginBottom: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>当前响应时间</span>
                      <span style={{ 
                        color: (metrics?.performance?.responseTime || 0) > 1000 ? '#ff4d4f' : '#52c41a' 
                      }}>
                        {metrics?.performance?.responseTime || 0}ms
                      </span>
                    </div>
                    <Progress 
                      percent={Math.min((metrics?.performance?.responseTime || 0) / 10, 100)} 
                      strokeColor={(metrics?.performance?.responseTime || 0) > 1000 ? '#ff4d4f' : '#52c41a'}
                      showInfo={false}
                    />
                  </div>
                </Card>
              </Col>
              <Col xs={24} sm={12}>
                <Card title="吞吐量" size="small">
                  <div style={{ marginBottom: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>当前吞吐量</span>
                      <span>{metrics?.performance?.throughput || 0} req/s</span>
                    </div>
                    <Progress 
                      percent={Math.min((metrics?.performance?.throughput || 0) / 10, 100)} 
                      strokeColor="#52c41a"
                      showInfo={false}
                    />
                  </div>
                </Card>
              </Col>
            </Row>
          </TabPane>
          
          <TabPane tab="资源监控" key="resources">
            <Row gutter={[16, 16]}>
              <Col xs={24} sm={12}>
                <Card title="内存使用" size="small">
                  <div style={{ marginBottom: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>内存使用率</span>
                      <span style={{ 
                        color: (metrics?.memory?.usage || 0) > 0.8 ? '#ff4d4f' : 
                               (metrics?.memory?.usage || 0) > 0.6 ? '#faad14' : '#52c41a' 
                      }}>
                        {((metrics?.memory?.usage || 0) * 100).toFixed(1)}%
                      </span>
                    </div>
                    <Progress 
                      percent={(metrics?.memory?.usage || 0) * 100} 
                      strokeColor={(metrics?.memory?.usage || 0) > 0.8 ? '#ff4d4f' : 
                                  (metrics?.memory?.usage || 0) > 0.6 ? '#faad14' : '#52c41a'}
                    />
                  </div>
                  <div style={{ fontSize: '12px', color: '#666' }}>
                    已用: {metrics?.memory?.used || 0}MB / 总计: {metrics?.memory?.total || 0}MB
                  </div>
                </Card>
              </Col>
              <Col xs={24} sm={12}>
                <Card title="CPU使用" size="small">
                  <div style={{ marginBottom: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>CPU使用率</span>
                      <span style={{ 
                        color: (metrics?.cpu?.usage || 0) > 0.8 ? '#ff4d4f' : 
                               (metrics?.cpu?.usage || 0) > 0.6 ? '#faad14' : '#52c41a' 
                      }}>
                        {((metrics?.cpu?.usage || 0) * 100).toFixed(1)}%
                      </span>
                    </div>
                    <Progress 
                      percent={(metrics?.cpu?.usage || 0) * 100} 
                      strokeColor={(metrics?.cpu?.usage || 0) > 0.8 ? '#ff4d4f' : 
                                  (metrics?.cpu?.usage || 0) > 0.6 ? '#faad14' : '#52c41a'}
                    />
                  </div>
                  <div style={{ fontSize: '12px', color: '#666' }}>
                    负载平均值: {metrics?.cpu?.loadAverage?.toFixed(2) || 0}
                  </div>
                </Card>
              </Col>
            </Row>
          </TabPane>
          
          <TabPane tab="数据库监控" key="database">
            <Row gutter={[16, 16]}>
              <Col xs={24} sm={12}>
                <Card title="查询性能" size="small">
                  <div style={{ marginBottom: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>平均查询时间</span>
                      <span style={{ 
                        color: (metrics?.database?.queryTime || 0) > 500 ? '#ff4d4f' : 
                               (metrics?.database?.queryTime || 0) > 200 ? '#faad14' : '#52c41a' 
                      }}>
                        {metrics?.database?.queryTime || 0}ms
                      </span>
                    </div>
                    <Progress 
                      percent={Math.min((metrics?.database?.queryTime || 0) / 5, 100)} 
                      strokeColor={(metrics?.database?.queryTime || 0) > 500 ? '#ff4d4f' : '#52c41a'}
                      showInfo={false}
                    />
                  </div>
                </Card>
              </Col>
              <Col xs={24} sm={12}>
                <Card title="缓存性能" size="small">
                  <div style={{ marginBottom: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span>缓存命中率</span>
                      <span style={{ 
                        color: (metrics?.database?.cacheHitRate || 0) < 0.8 ? '#ff4d4f' : '#52c41a' 
                      }}>
                        {((metrics?.database?.cacheHitRate || 0) * 100).toFixed(1)}%
                      </span>
                    </div>
                    <Progress 
                      percent={(metrics?.database?.cacheHitRate || 0) * 100} 
                      strokeColor={(metrics?.database?.cacheHitRate || 0) < 0.8 ? '#ff4d4f' : '#52c41a'}
                    />
                  </div>
                </Card>
              </Col>
            </Row>
          </TabPane>
          
          <TabPane tab="优化建议" key="optimization">
            <List
              dataSource={suggestions}
              renderItem={(suggestion: any) => (
                <List.Item>
                  <Card size="small" style={{ width: '100%' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                          <strong>{suggestion.title}</strong>
                          <Tag color={getPriorityColor(suggestion.priority)}>
                            {suggestion.priority === 'critical' ? '严重' : 
                             suggestion.priority === 'high' ? '高' : 
                             suggestion.priority === 'medium' ? '中' : '低'}
                          </Tag>
                          <Tag color="blue">{suggestion.category}</Tag>
                        </div>
                        <div style={{ color: '#666', marginBottom: 8 }}>
                          {suggestion.description}
                        </div>
                        <div style={{ fontSize: '12px', color: '#999' }}>
                          <strong>影响:</strong> {suggestion.impact} | 
                          <strong> 工作量:</strong> {suggestion.effort === 'high' ? '高' : suggestion.effort === 'medium' ? '中' : '低'}
                        </div>
                      </div>
                      <Button 
                        type="primary" 
                        size="small"
                        onClick={() => executeOptimization(suggestion.category)}
                      >
                        执行优化
                      </Button>
                    </div>
                    <div style={{ 
                      background: '#f5f5f5', 
                      padding: '8px', 
                      borderRadius: '4px',
                      fontSize: '12px'
                    }}>
                      <strong>建议:</strong> {suggestion.recommendation}
                    </div>
                  </Card>
                </List.Item>
              )}
            />
          </TabPane>
        </Tabs>
      </Card>
    </div>
  )
}

export default SystemMonitor
