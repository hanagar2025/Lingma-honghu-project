import React, { useEffect, useState } from 'react'
import { Card, Spin, Alert, Row, Col, Statistic, Tag, Table, Tabs, List } from 'antd'
import { RiseOutlined, FallOutlined, FireOutlined } from '@ant-design/icons'
import { sectorAPI } from '../../services/api'

const { TabPane } = Tabs

interface SectorData {
  name: string
  code: string
  change: number
  changeRate: number
  volume: number
  turnover: number
  marketCap: number
  pe: number
  pb: number
  strength: number
  trend: 'up' | 'down' | 'sideways'
}

interface PolicyNews {
  title: string
  content: string
  impact: 'positive' | 'negative' | 'neutral'
  sectors: string[]
  publishTime: string
  relevance: number
}

const SectorAnalysis: React.FC = () => {
  const [loading, setLoading] = useState(true)
  const [sectors, setSectors] = useState<SectorData[]>([])
  const [hotSectors, setHotSectors] = useState<SectorData[]>([])
  const [news, setNews] = useState<PolicyNews[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchSectorData()
  }, [])

  const fetchSectorData = async () => {
    try {
      setLoading(true)
      const [sectorsRes, hotSectorsRes, newsRes] = await Promise.all([
        sectorAPI.getSectors(),
        sectorAPI.getHotSectors(),
        sectorAPI.getPolicyNews()
      ])
      
      setSectors(sectorsRes)
      setHotSectors(hotSectorsRes)
      setNews(newsRes)
    } catch (err) {
      setError('获取板块数据失败')
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

  const getTrendColor = (trend: string) => {
    switch (trend) {
      case 'up': return '#52c41a'
      case 'down': return '#ff4d4f'
      default: return '#1890ff'
    }
  }

  const getTrendIcon = (trend: string) => {
    switch (trend) {
      case 'up': return <RiseOutlined />
      case 'down': return <FallOutlined />
      default: return null
    }
  }

  const getImpactColor = (impact: string) => {
    switch (impact) {
      case 'positive': return 'green'
      case 'negative': return 'red'
      default: return 'blue'
    }
  }

  const getImpactText = (impact: string) => {
    switch (impact) {
      case 'positive': return '利好'
      case 'negative': return '利空'
      default: return '中性'
    }
  }

  const sectorColumns = [
    {
      title: '板块名称',
      dataIndex: 'name',
      key: 'name',
      width: 120,
    },
    {
      title: '涨跌幅',
      key: 'change',
      width: 120,
      render: (_: any, record: SectorData) => (
        <div>
          <div style={{ 
            color: record.change >= 0 ? '#52c41a' : '#ff4d4f',
            fontWeight: 'bold'
          }}>
            {record.change >= 0 ? '+' : ''}{record.change.toFixed(2)}
          </div>
          <div style={{ 
            color: record.changeRate >= 0 ? '#52c41a' : '#ff4d4f',
            fontSize: '12px'
          }}>
            {record.changeRate >= 0 ? '+' : ''}{record.changeRate.toFixed(2)}%
          </div>
        </div>
      ),
    },
    {
      title: '趋势',
      dataIndex: 'trend',
      key: 'trend',
      width: 100,
      render: (trend: string) => (
        <Tag color={getTrendColor(trend)} icon={getTrendIcon(trend)}>
          {trend === 'up' ? '上升' : trend === 'down' ? '下降' : '震荡'}
        </Tag>
      ),
    },
    {
      title: '强度',
      dataIndex: 'strength',
      key: 'strength',
      width: 100,
      render: (strength: number) => (
        <div>
          <div style={{ fontWeight: 'bold' }}>
            {strength.toFixed(1)}
          </div>
          <div style={{ 
            color: strength >= 80 ? '#52c41a' : strength >= 60 ? '#1890ff' : '#ff4d4f',
            fontSize: '12px'
          }}>
            {strength >= 80 ? '强势' : strength >= 60 ? '中等' : '弱势'}
          </div>
        </div>
      ),
    },
    {
      title: 'PE',
      dataIndex: 'pe',
      key: 'pe',
      width: 80,
      render: (pe: number) => pe.toFixed(1),
    },
    {
      title: 'PB',
      dataIndex: 'pb',
      key: 'pb',
      width: 80,
      render: (pb: number) => pb.toFixed(2),
    },
  ]

  return (
    <div>
      <Card title="板块分析概览" style={{ marginBottom: 16 }}>
        <Row gutter={[16, 16]}>
          <Col xs={24} sm={8}>
            <Statistic
              title="总板块数"
              value={sectors.length}
              suffix="个"
            />
          </Col>
          <Col xs={24} sm={8}>
            <Statistic
              title="热点板块"
              value={hotSectors.length}
              suffix="个"
              valueStyle={{ color: '#ff4d4f' }}
            />
          </Col>
          <Col xs={24} sm={8}>
            <Statistic
              title="政策新闻"
              value={news.length}
              suffix="条"
              valueStyle={{ color: '#1890ff' }}
            />
          </Col>
        </Row>
      </Card>

      <Card title="板块分析">
        <Tabs defaultActiveKey="all">
          <TabPane tab="全部板块" key="all">
            <Table
              columns={sectorColumns}
              dataSource={sectors}
              rowKey="code"
              pagination={{ pageSize: 10 }}
              scroll={{ x: 600 }}
            />
          </TabPane>
          
          <TabPane tab="热点板块" key="hot">
            <div style={{ marginBottom: 16 }}>
              <Tag color="red" icon={<FireOutlined />}>
                热点板块
              </Tag>
              <span style={{ marginLeft: 8, color: '#666' }}>
                涨幅超过3%或强度超过80的板块
              </span>
            </div>
            <Table
              columns={sectorColumns}
              dataSource={hotSectors}
              rowKey="code"
              pagination={false}
              scroll={{ x: 600 }}
            />
          </TabPane>
          
          <TabPane tab="政策新闻" key="news">
            <List
              dataSource={news}
              renderItem={(item) => (
                <List.Item>
                  <List.Item.Meta
                    title={
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span>{item.title}</span>
                        <Tag color={getImpactColor(item.impact)}>
                          {getImpactText(item.impact)}
                        </Tag>
                        <Tag color="blue">
                          相关度: {item.relevance.toFixed(1)}%
                        </Tag>
                      </div>
                    }
                    description={
                      <div>
                        <div style={{ marginBottom: 8 }}>{item.content}</div>
                        <div style={{ fontSize: '12px', color: '#666' }}>
                          发布时间: {new Date(item.publishTime).toLocaleString()}
                        </div>
                        <div style={{ marginTop: 4 }}>
                          <strong>相关板块: </strong>
                          {item.sectors.map((sector, index) => (
                            <Tag key={index} size="small" style={{ margin: '2px' }}>
                              {sector}
                            </Tag>
                          ))}
                        </div>
                      </div>
                    }
                  />
                </List.Item>
              )}
            />
          </TabPane>
        </Tabs>
      </Card>
    </div>
  )
}

export default SectorAnalysis
