import React, { useEffect, useState } from 'react'
import { Card, Spin, Alert, Row, Col, Statistic, Progress, Tag, Table, Button } from 'antd'
import { analysisAPI } from '../../services/api'

interface PositionAnalysisData {
  overallScore: number
  riskLevel: string
  diversification: number
  positions: Array<{
    code: string
    name: string
    category: string
    confidence: number
    score: number
    reasoning: string[]
    recommendations: Array<{
      action: string
      reason: string
      targetPrice?: number
      stopLoss?: number
    }>
  }>
  recommendations: Array<{
    type: string
    reason: string
    priority: string
  }>
}

const PositionAnalysis: React.FC = () => {
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<PositionAnalysisData | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchPositionAnalysis()
  }, [])

  const fetchPositionAnalysis = async () => {
    try {
      setLoading(true)
      const response = await analysisAPI.getPositionAnalysis()
      setData(response)
    } catch (err) {
      setError('获取持仓分析数据失败')
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

  if (!data) {
    return (
      <Card>
        <Alert message="暂无数据" type="info" />
      </Card>
    )
  }

  const getCategoryColor = (category: string) => {
    switch (category) {
      case 'right': return 'green'
      case 'left': return 'blue'
      case 'defensive': return 'orange'
      case 'observation': return 'purple'
      default: return 'default'
    }
  }

  const getCategoryName = (category: string) => {
    switch (category) {
      case 'right': return '右侧'
      case 'left': return '左侧'
      case 'defensive': return '防御'
      case 'observation': return '观察'
      default: return '未知'
    }
  }

  const getRiskColor = (riskLevel: string) => {
    switch (riskLevel) {
      case 'low': return '#52c41a'
      case 'medium': return '#faad14'
      case 'high': return '#ff4d4f'
      default: return '#666'
    }
  }

  const getActionColor = (action: string) => {
    switch (action) {
      case 'buy': return 'green'
      case 'sell': return 'red'
      case 'hold': return 'blue'
      case 'watch': return 'orange'
      default: return 'default'
    }
  }

  const getActionName = (action: string) => {
    switch (action) {
      case 'buy': return '买入'
      case 'sell': return '卖出'
      case 'hold': return '持有'
      case 'watch': return '观察'
      default: return action
    }
  }

  const positionColumns = [
    {
      title: '股票代码',
      dataIndex: 'code',
      key: 'code',
      width: 100,
    },
    {
      title: '股票名称',
      dataIndex: 'name',
      key: 'name',
      width: 120,
    },
    {
      title: '分类',
      dataIndex: 'category',
      key: 'category',
      width: 100,
      render: (category: string) => (
        <Tag color={getCategoryColor(category)}>
          {getCategoryName(category)}
        </Tag>
      ),
    },
    {
      title: '评分',
      dataIndex: 'score',
      key: 'score',
      width: 100,
      render: (score: number) => (
        <div>
          <div style={{ fontWeight: 'bold', color: score >= 80 ? '#52c41a' : score >= 60 ? '#1890ff' : '#ff4d4f' }}>
            {score.toFixed(1)}
          </div>
          <Progress 
            percent={score} 
            size="small" 
            strokeColor={score >= 80 ? '#52c41a' : score >= 60 ? '#1890ff' : '#ff4d4f'}
            showInfo={false}
          />
        </div>
      ),
    },
    {
      title: '置信度',
      dataIndex: 'confidence',
      key: 'confidence',
      width: 100,
      render: (confidence: number) => (
        <div>
          <div style={{ fontWeight: 'bold' }}>
            {(confidence * 100).toFixed(1)}%
          </div>
          <Progress 
            percent={confidence * 100} 
            size="small" 
            strokeColor="#1890ff"
            showInfo={false}
          />
        </div>
      ),
    },
    {
      title: '操作建议',
      key: 'recommendations',
      width: 200,
      render: (_: any, record: any) => (
        <div>
          {record.recommendations.slice(0, 2).map((rec: any, index: number) => (
            <div key={index} style={{ marginBottom: 4 }}>
              <Tag color={getActionColor(rec.action)} size="small">
                {getActionName(rec.action)}
              </Tag>
              <span style={{ fontSize: '12px', color: '#666' }}>
                {rec.reason}
              </span>
            </div>
          ))}
        </div>
      ),
    },
  ]

  return (
    <div>
      <Card title="投资组合分析概览" style={{ marginBottom: 16 }}>
        <Row gutter={[16, 16]}>
          <Col xs={24} sm={8}>
            <Statistic
              title="整体评分"
              value={data.overallScore.toFixed(1)}
              suffix="/100"
              valueStyle={{ 
                color: data.overallScore >= 80 ? '#52c41a' : 
                       data.overallScore >= 60 ? '#1890ff' : '#ff4d4f' 
              }}
            />
            <Progress 
              percent={data.overallScore} 
              strokeColor={data.overallScore >= 80 ? '#52c41a' : 
                          data.overallScore >= 60 ? '#1890ff' : '#ff4d4f'}
              style={{ marginTop: 8 }}
            />
          </Col>
          <Col xs={24} sm={8}>
            <Statistic
              title="风险等级"
              value={data.riskLevel === 'low' ? '低风险' : 
                     data.riskLevel === 'medium' ? '中风险' : '高风险'}
              valueStyle={{ color: getRiskColor(data.riskLevel) }}
            />
          </Col>
          <Col xs={24} sm={8}>
            <Statistic
              title="分散化程度"
              value={data.diversification.toFixed(1)}
              suffix="%"
              valueStyle={{ 
                color: data.diversification >= 70 ? '#52c41a' : 
                       data.diversification >= 50 ? '#1890ff' : '#ff4d4f' 
              }}
            />
            <Progress 
              percent={data.diversification} 
              strokeColor={data.diversification >= 70 ? '#52c41a' : 
                          data.diversification >= 50 ? '#1890ff' : '#ff4d4f'}
              style={{ marginTop: 8 }}
            />
          </Col>
        </Row>
      </Card>

      <Card title="持仓明细分析" style={{ marginBottom: 16 }}>
        <Table
          columns={positionColumns}
          dataSource={data.positions}
          rowKey="code"
          pagination={false}
          scroll={{ x: 800 }}
        />
      </Card>

      <Card title="投资建议">
        <div>
          {data.recommendations.map((rec, index) => (
            <div key={index} style={{ 
              marginBottom: 12, 
              padding: '12px', 
              background: '#f5f5f5', 
              borderRadius: '6px' 
            }}>
              <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
                <Tag color={rec.type === 'buy' ? 'green' : 'blue'}>
                  {rec.type === 'buy' ? '买入建议' : '调整建议'}
                </Tag>
                <Tag color={rec.priority === 'high' ? 'red' : 'orange'}>
                  {rec.priority === 'high' ? '高优先级' : '中优先级'}
                </Tag>
              </div>
              <div>{rec.reason}</div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}

export default PositionAnalysis
