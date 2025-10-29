import React, { useEffect, useState } from 'react'
import { Card, Spin, Alert, Tabs, Row, Col, Statistic, Tag } from 'antd'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'
import { analysisAPI } from '../../services/api'

const { TabPane } = Tabs

interface TechnicalChartProps {
  stockCode: string
}

interface TechnicalData {
  trend: string
  strength: number
  support: number
  resistance: number
  indicators: {
    ma5: number
    ma10: number
    ma20: number
    ma60: number
    ma120: number
    ma250: number
    macd: {
      value: number
      signal: number
      histogram: number
    }
    rsi: number
    kdj: {
      k: number
      d: number
      j: number
    }
    boll: {
      upper: number
      middle: number
      lower: number
    }
  }
  signals: Array<{
    type: string
    strength: string
    description: string
  }>
}

const TechnicalChart: React.FC<TechnicalChartProps> = ({ stockCode }) => {
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<TechnicalData | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchTechnicalData()
  }, [stockCode])

  const fetchTechnicalData = async () => {
    try {
      setLoading(true)
      const response = await analysisAPI.getTechnicalAnalysis(stockCode)
      setData(response)
    } catch (err) {
      setError('获取技术分析数据失败')
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

  const getTrendColor = (trend: string) => {
    switch (trend) {
      case 'up': return '#52c41a'
      case 'down': return '#ff4d4f'
      default: return '#1890ff'
    }
  }

  const getTrendText = (trend: string) => {
    switch (trend) {
      case 'up': return '上升趋势'
      case 'down': return '下降趋势'
      default: return '震荡趋势'
    }
  }

  const getSignalColor = (type: string) => {
    switch (type) {
      case 'buy': return 'green'
      case 'sell': return 'red'
      default: return 'blue'
    }
  }

  return (
    <div>
      <Card title="技术分析" style={{ marginBottom: 16 }}>
        <Row gutter={[16, 16]}>
          <Col xs={24} sm={8}>
            <Statistic
              title="趋势方向"
              value={getTrendText(data.trend)}
              valueStyle={{ color: getTrendColor(data.trend) }}
            />
          </Col>
          <Col xs={24} sm={8}>
            <Statistic
              title="趋势强度"
              value={data.strength.toFixed(1)}
              suffix="%"
              valueStyle={{ color: data.strength > 70 ? '#52c41a' : data.strength > 40 ? '#faad14' : '#ff4d4f' }}
            />
          </Col>
          <Col xs={24} sm={8}>
            <Statistic
              title="支撑位"
              value={data.support.toFixed(2)}
              prefix="¥"
            />
          </Col>
        </Row>
      </Card>

      <Card title="技术指标" style={{ marginBottom: 16 }}>
        <Tabs defaultActiveKey="ma">
          <TabPane tab="均线系统" key="ma">
            <Row gutter={[16, 16]}>
              <Col xs={12} sm={6}>
                <Statistic title="MA5" value={data.indicators.ma5.toFixed(2)} prefix="¥" />
              </Col>
              <Col xs={12} sm={6}>
                <Statistic title="MA10" value={data.indicators.ma10.toFixed(2)} prefix="¥" />
              </Col>
              <Col xs={12} sm={6}>
                <Statistic title="MA20" value={data.indicators.ma20.toFixed(2)} prefix="¥" />
              </Col>
              <Col xs={12} sm={6}>
                <Statistic title="MA60" value={data.indicators.ma60.toFixed(2)} prefix="¥" />
              </Col>
            </Row>
          </TabPane>
          
          <TabPane tab="MACD" key="macd">
            <Row gutter={[16, 16]}>
              <Col xs={8}>
                <Statistic title="MACD" value={data.indicators.macd.value.toFixed(4)} />
              </Col>
              <Col xs={8}>
                <Statistic title="信号线" value={data.indicators.macd.signal.toFixed(4)} />
              </Col>
              <Col xs={8}>
                <Statistic 
                  title="柱状图" 
                  value={data.indicators.macd.histogram.toFixed(4)}
                  valueStyle={{ 
                    color: data.indicators.macd.histogram > 0 ? '#52c41a' : '#ff4d4f' 
                  }}
                />
              </Col>
            </Row>
          </TabPane>
          
          <TabPane tab="RSI" key="rsi">
            <Row gutter={[16, 16]}>
              <Col xs={24}>
                <Statistic 
                  title="RSI" 
                  value={data.indicators.rsi.toFixed(2)}
                  suffix="%"
                  valueStyle={{ 
                    color: data.indicators.rsi > 70 ? '#ff4d4f' : 
                           data.indicators.rsi < 30 ? '#52c41a' : '#1890ff' 
                  }}
                />
                <div style={{ marginTop: 8 }}>
                  {data.indicators.rsi > 70 && <Tag color="red">超买</Tag>}
                  {data.indicators.rsi < 30 && <Tag color="green">超卖</Tag>}
                  {data.indicators.rsi >= 30 && data.indicators.rsi <= 70 && <Tag color="blue">正常</Tag>}
                </div>
              </Col>
            </Row>
          </TabPane>
          
          <TabPane tab="KDJ" key="kdj">
            <Row gutter={[16, 16]}>
              <Col xs={8}>
                <Statistic title="K值" value={data.indicators.kdj.k.toFixed(2)} />
              </Col>
              <Col xs={8}>
                <Statistic title="D值" value={data.indicators.kdj.d.toFixed(2)} />
              </Col>
              <Col xs={8}>
                <Statistic title="J值" value={data.indicators.kdj.j.toFixed(2)} />
              </Col>
            </Row>
          </TabPane>
          
          <TabPane tab="布林带" key="boll">
            <Row gutter={[16, 16]}>
              <Col xs={8}>
                <Statistic title="上轨" value={data.indicators.boll.upper.toFixed(2)} prefix="¥" />
              </Col>
              <Col xs={8}>
                <Statistic title="中轨" value={data.indicators.boll.middle.toFixed(2)} prefix="¥" />
              </Col>
              <Col xs={8}>
                <Statistic title="下轨" value={data.indicators.boll.lower.toFixed(2)} prefix="¥" />
              </Col>
            </Row>
          </TabPane>
        </Tabs>
      </Card>

      <Card title="交易信号">
        <div>
          {data.signals.map((signal, index) => (
            <div key={index} style={{ marginBottom: 8 }}>
              <Tag color={getSignalColor(signal.type)}>
                {signal.type === 'buy' ? '买入' : signal.type === 'sell' ? '卖出' : '持有'}
              </Tag>
              <Tag color={signal.strength === 'strong' ? 'red' : signal.strength === 'medium' ? 'orange' : 'blue'}>
                {signal.strength === 'strong' ? '强烈' : signal.strength === 'medium' ? '中等' : '较弱'}
              </Tag>
              <span style={{ marginLeft: 8 }}>{signal.description}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}

export default TechnicalChart
