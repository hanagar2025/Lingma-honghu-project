import React from 'react'
import { Row, Col, Card, Statistic, Typography } from 'antd'
import {
  WalletOutlined,
  RiseOutlined,
  FallOutlined,
  DollarOutlined,
  LineChartOutlined
} from '@ant-design/icons'

const { Title } = Typography

const Dashboard: React.FC = () => {
  // 模拟数据 - 确保所有值都是数字
  const summary = {
    totalAssets: 1000000.0,
    availableCash: 100000.0,
    totalMarketValue: 900000.0,
    totalProfitLoss: 50000.0,
    totalProfitLossRate: 5.56,
    leftSideRatio: 30.0,
    rightSideRatio: 40.0,
    defensiveRatio: 20.0,
    observationRatio: 10.0
  }

  const positions: any[] = []

  return (
    <div style={{ padding: '24px' }}>
      <div style={{ marginBottom: 24 }}>
        <Title level={2} style={{ margin: 0 }}>
          <LineChartOutlined style={{ marginRight: 8, color: '#007aff' }} />
          投资概览
        </Title>
      </div>

      {/* 资产统计卡片 */}
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={24} sm={12} lg={6}>
          <Card style={{ borderRadius: 18 }}>
            <Statistic
              title="总资产"
              value={Number(summary.totalAssets) || 0}
              precision={2}
              prefix={<DollarOutlined style={{ color: '#007aff' }} />}
              valueStyle={{ color: '#1d1d1f', fontSize: 24, fontWeight: 600 }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card style={{ borderRadius: 18 }}>
            <Statistic
              title="持仓市值"
              value={Number(summary.totalMarketValue) || 0}
              precision={2}
              prefix={<WalletOutlined style={{ color: '#007aff' }} />}
              valueStyle={{ color: '#1d1d1f', fontSize: 24, fontWeight: 600 }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card style={{ borderRadius: 18 }}>
            <Statistic
              title="总盈亏"
              value={Number(summary.totalProfitLoss) || 0}
              precision={2}
              prefix={summary.totalProfitLoss >= 0 ? 
                <RiseOutlined style={{ color: '#34c759' }} /> : 
                <FallOutlined style={{ color: '#ff3b30' }} />
              }
              valueStyle={{ 
                color: summary.totalProfitLoss >= 0 ? '#34c759' : '#ff3b30',
                fontSize: 24, 
                fontWeight: 600 
              }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card style={{ borderRadius: 18 }}>
            <Statistic
              title="盈亏比例"
              value={Number(summary.totalProfitLossRate) || 0}
              precision={2}
              suffix="%"
              valueStyle={{ 
                color: summary.totalProfitLossRate >= 0 ? '#34c759' : '#ff3b30',
                fontSize: 24, 
                fontWeight: 600 
              }}
            />
          </Card>
        </Col>
      </Row>

      {/* 仓位分布 */}
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={24} lg={12}>
          <Card title="仓位分布" style={{ borderRadius: 18 }}>
            <div style={{ height: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#86868b' }}>
              图表加载中...
            </div>
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card title="市场概览" style={{ borderRadius: 18 }}>
            <div style={{ height: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#86868b' }}>
              市场数据加载中...
            </div>
          </Card>
        </Col>
      </Row>

      {/* 持仓列表 */}
      <Card title="持仓明细" style={{ borderRadius: 18 }}>
        {positions.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px', color: '#86868b' }}>
            暂无持仓，请添加股票
          </div>
        ) : (
          <div>持仓列表</div>
        )}
      </Card>
    </div>
  )
}

export default Dashboard
