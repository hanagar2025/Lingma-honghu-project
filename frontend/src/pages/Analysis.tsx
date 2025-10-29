import React, { useState } from 'react'
import { Card, Typography, Row, Col, Tabs, Input, Button, Select } from 'antd'
import { BarChartOutlined, LineChartOutlined, PieChartOutlined, SearchOutlined, AppstoreOutlined } from '@ant-design/icons'
import TechnicalChart from '../components/Analysis/TechnicalChart'
import FundamentalChart from '../components/Analysis/FundamentalChart'
import PositionAnalysis from '../components/Analysis/PositionAnalysis'
import SectorAnalysis from '../components/Sector/SectorAnalysis'

const { Title } = Typography
const { Option } = Select

const Analysis: React.FC = () => {
  const [selectedStock, setSelectedStock] = useState('000001')
  const [stockInput, setStockInput] = useState('000001')

  const handleStockSearch = () => {
    if (stockInput.trim()) {
      setSelectedStock(stockInput.trim())
    }
  }

  const tabItems = [
    {
      key: 'technical',
      label: '技术分析',
      icon: <LineChartOutlined />,
      children: (
        <div>
          <div style={{ marginBottom: 16, display: 'flex', gap: 8 }}>
            <Input
              placeholder="请输入股票代码"
              value={stockInput}
              onChange={(e) => setStockInput(e.target.value)}
              onPressEnter={handleStockSearch}
              style={{ width: 200 }}
            />
            <Button 
              type="primary" 
              icon={<SearchOutlined />} 
              onClick={handleStockSearch}
            >
              分析
            </Button>
          </div>
          <TechnicalChart stockCode={selectedStock} />
        </div>
      ),
    },
    {
      key: 'fundamental',
      label: '基本面分析',
      icon: <BarChartOutlined />,
      children: (
        <div>
          <div style={{ marginBottom: 16, display: 'flex', gap: 8 }}>
            <Input
              placeholder="请输入股票代码"
              value={stockInput}
              onChange={(e) => setStockInput(e.target.value)}
              onPressEnter={handleStockSearch}
              style={{ width: 200 }}
            />
            <Button 
              type="primary" 
              icon={<SearchOutlined />} 
              onClick={handleStockSearch}
            >
              分析
            </Button>
          </div>
          <FundamentalChart stockCode={selectedStock} />
        </div>
      ),
    },
    {
      key: 'portfolio',
      label: '组合分析',
      icon: <PieChartOutlined />,
      children: <PositionAnalysis />,
    },
    {
      key: 'sector',
      label: '板块分析',
      icon: <AppstoreOutlined />,
      children: <SectorAnalysis />,
    },
  ]

  return (
    <div>
      <Title level={2} style={{ marginBottom: 24 }}>
        数据分析
      </Title>

      <Row gutter={[16, 16]}>
        <Col span={24}>
          <Card>
            <Tabs
              defaultActiveKey="technical"
              items={tabItems}
              size="large"
            />
          </Card>
        </Col>
      </Row>
    </div>
  )
}

export default Analysis
