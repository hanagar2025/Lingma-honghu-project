import React, { useEffect, useState } from 'react'
import { Card, Spin, Alert, Row, Col, Statistic, Progress, Tag, Tabs } from 'antd'
import { analysisAPI } from '../../services/api'

const { TabPane } = Tabs

interface FundamentalChartProps {
  stockCode: string
}

interface FundamentalData {
  valuation: {
    pe: number
    pb: number
    ps: number
    peg: number
    dividendYield: number
  }
  profitability: {
    roe: number
    roa: number
    grossMargin: number
    netMargin: number
    operatingMargin: number
  }
  growth: {
    revenueGrowth: number
    profitGrowth: number
    assetGrowth: number
    equityGrowth: number
  }
  financial: {
    debtRatio: number
    currentRatio: number
    quickRatio: number
    interestCoverage: number
  }
  quality: {
    score: number
    rating: string
    strengths: string[]
    weaknesses: string[]
  }
}

const FundamentalChart: React.FC<FundamentalChartProps> = ({ stockCode }) => {
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<FundamentalData | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchFundamentalData()
  }, [stockCode])

  const fetchFundamentalData = async () => {
    try {
      setLoading(true)
      const response = await analysisAPI.getFundamentalAnalysis(stockCode)
      setData(response)
    } catch (err) {
      setError('获取基本面分析数据失败')
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

  const getRatingColor = (rating: string) => {
    switch (rating) {
      case 'A': return '#52c41a'
      case 'B': return '#1890ff'
      case 'C': return '#faad14'
      case 'D': return '#ff4d4f'
      default: return '#666'
    }
  }

  const getScoreColor = (score: number) => {
    if (score >= 80) return '#52c41a'
    if (score >= 60) return '#1890ff'
    if (score >= 40) return '#faad14'
    return '#ff4d4f'
  }

  return (
    <div>
      <Card title="基本面分析概览" style={{ marginBottom: 16 }}>
        <Row gutter={[16, 16]}>
          <Col xs={24} sm={8}>
            <Statistic
              title="综合评分"
              value={data.quality.score}
              suffix="/100"
              valueStyle={{ color: getScoreColor(data.quality.score) }}
            />
            <Progress 
              percent={data.quality.score} 
              strokeColor={getScoreColor(data.quality.score)}
              style={{ marginTop: 8 }}
            />
          </Col>
          <Col xs={24} sm={8}>
            <Statistic
              title="质量评级"
              value={data.quality.rating}
              valueStyle={{ color: getRatingColor(data.quality.rating), fontSize: '24px' }}
            />
          </Col>
          <Col xs={24} sm={8}>
            <div>
              <div style={{ marginBottom: 8 }}>
                <strong>优势：</strong>
                {data.quality.strengths.map((strength, index) => (
                  <Tag key={index} color="green" style={{ margin: '2px' }}>
                    {strength}
                  </Tag>
                ))}
              </div>
              <div>
                <strong>劣势：</strong>
                {data.quality.weaknesses.map((weakness, index) => (
                  <Tag key={index} color="red" style={{ margin: '2px' }}>
                    {weakness}
                  </Tag>
                ))}
              </div>
            </div>
          </Col>
        </Row>
      </Card>

      <Card title="详细分析">
        <Tabs defaultActiveKey="valuation">
          <TabPane tab="估值分析" key="valuation">
            <Row gutter={[16, 16]}>
              <Col xs={12} sm={6}>
                <Statistic 
                  title="PE比率" 
                  value={data.valuation.pe.toFixed(2)}
                  valueStyle={{ 
                    color: data.valuation.pe > 0 && data.valuation.pe < 20 ? '#52c41a' : '#ff4d4f' 
                  }}
                />
              </Col>
              <Col xs={12} sm={6}>
                <Statistic 
                  title="PB比率" 
                  value={data.valuation.pb.toFixed(2)}
                  valueStyle={{ 
                    color: data.valuation.pb > 0 && data.valuation.pb < 3 ? '#52c41a' : '#ff4d4f' 
                  }}
                />
              </Col>
              <Col xs={12} sm={6}>
                <Statistic 
                  title="PS比率" 
                  value={data.valuation.ps.toFixed(2)}
                />
              </Col>
              <Col xs={12} sm={6}>
                <Statistic 
                  title="PEG比率" 
                  value={data.valuation.peg.toFixed(2)}
                  valueStyle={{ 
                    color: data.valuation.peg > 0 && data.valuation.peg < 1.5 ? '#52c41a' : '#ff4d4f' 
                  }}
                />
              </Col>
              <Col xs={24}>
                <Statistic 
                  title="股息率" 
                  value={data.valuation.dividendYield.toFixed(2)}
                  suffix="%"
                  valueStyle={{ 
                    color: data.valuation.dividendYield > 3 ? '#52c41a' : '#1890ff' 
                  }}
                />
              </Col>
            </Row>
          </TabPane>
          
          <TabPane tab="盈利能力" key="profitability">
            <Row gutter={[16, 16]}>
              <Col xs={12} sm={6}>
                <Statistic 
                  title="ROE" 
                  value={data.profitability.roe.toFixed(2)}
                  suffix="%"
                  valueStyle={{ 
                    color: data.profitability.roe > 15 ? '#52c41a' : 
                           data.profitability.roe > 10 ? '#1890ff' : '#ff4d4f' 
                  }}
                />
              </Col>
              <Col xs={12} sm={6}>
                <Statistic 
                  title="ROA" 
                  value={data.profitability.roa.toFixed(2)}
                  suffix="%"
                />
              </Col>
              <Col xs={12} sm={6}>
                <Statistic 
                  title="毛利率" 
                  value={data.profitability.grossMargin.toFixed(2)}
                  suffix="%"
                />
              </Col>
              <Col xs={12} sm={6}>
                <Statistic 
                  title="净利率" 
                  value={data.profitability.netMargin.toFixed(2)}
                  suffix="%"
                />
              </Col>
              <Col xs={24}>
                <Statistic 
                  title="营业利润率" 
                  value={data.profitability.operatingMargin.toFixed(2)}
                  suffix="%"
                />
              </Col>
            </Row>
          </TabPane>
          
          <TabPane tab="成长性" key="growth">
            <Row gutter={[16, 16]}>
              <Col xs={12} sm={6}>
                <Statistic 
                  title="营收增长率" 
                  value={data.growth.revenueGrowth.toFixed(2)}
                  suffix="%"
                  valueStyle={{ 
                    color: data.growth.revenueGrowth > 20 ? '#52c41a' : 
                           data.growth.revenueGrowth > 0 ? '#1890ff' : '#ff4d4f' 
                  }}
                />
              </Col>
              <Col xs={12} sm={6}>
                <Statistic 
                  title="利润增长率" 
                  value={data.growth.profitGrowth.toFixed(2)}
                  suffix="%"
                  valueStyle={{ 
                    color: data.growth.profitGrowth > 20 ? '#52c41a' : 
                           data.growth.profitGrowth > 0 ? '#1890ff' : '#ff4d4f' 
                  }}
                />
              </Col>
              <Col xs={12} sm={6}>
                <Statistic 
                  title="资产增长率" 
                  value={data.growth.assetGrowth.toFixed(2)}
                  suffix="%"
                />
              </Col>
              <Col xs={12} sm={6}>
                <Statistic 
                  title="净资产增长率" 
                  value={data.growth.equityGrowth.toFixed(2)}
                  suffix="%"
                />
              </Col>
            </Row>
          </TabPane>
          
          <TabPane tab="财务健康度" key="financial">
            <Row gutter={[16, 16]}>
              <Col xs={12} sm={6}>
                <Statistic 
                  title="资产负债率" 
                  value={data.financial.debtRatio.toFixed(2)}
                  suffix="%"
                  valueStyle={{ 
                    color: data.financial.debtRatio < 50 ? '#52c41a' : 
                           data.financial.debtRatio < 70 ? '#faad14' : '#ff4d4f' 
                  }}
                />
              </Col>
              <Col xs={12} sm={6}>
                <Statistic 
                  title="流动比率" 
                  value={data.financial.currentRatio.toFixed(2)}
                  valueStyle={{ 
                    color: data.financial.currentRatio > 2 ? '#52c41a' : 
                           data.financial.currentRatio > 1 ? '#1890ff' : '#ff4d4f' 
                  }}
                />
              </Col>
              <Col xs={12} sm={6}>
                <Statistic 
                  title="速动比率" 
                  value={data.financial.quickRatio.toFixed(2)}
                />
              </Col>
              <Col xs={12} sm={6}>
                <Statistic 
                  title="利息保障倍数" 
                  value={data.financial.interestCoverage.toFixed(2)}
                  valueStyle={{ 
                    color: data.financial.interestCoverage > 5 ? '#52c41a' : 
                           data.financial.interestCoverage > 2 ? '#1890ff' : '#ff4d4f' 
                  }}
                />
              </Col>
            </Row>
          </TabPane>
        </Tabs>
      </Card>
    </div>
  )
}

export default FundamentalChart
