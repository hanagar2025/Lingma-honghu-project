import React, { useState } from 'react'
import { Card, Typography, Tabs, Row, Col, Statistic, Tag, Button, List } from 'antd'
import { 
  ClockCircleOutlined, 
  CalendarOutlined, 
  HistoryOutlined,
  BarChartOutlined,
  CheckCircleOutlined,
  RiseOutlined,
  FallOutlined
} from '@ant-design/icons'
import DecisionViewer from '../components/Decisions/DecisionViewer'
import { decisionsAPI } from '../services/api'

const { Title } = Typography

const Decisions: React.FC = () => {
  const [activeTab, setActiveTab] = useState('daily')
  const [decisionStats, setDecisionStats] = useState<any>(null)

  const timeHorizons = [
    {
      key: 'daily',
      title: '日度决策',
      description: '基于30天数据分析的短期决策',
      icon: <ClockCircleOutlined />,
      color: 'blue'
    },
    {
      key: 'weekly',
      title: '周度决策',
      description: '基于12周数据分析的中期决策',
      icon: <CalendarOutlined />,
      color: 'green'
    },
    {
      key: 'monthly',
      title: '月度决策',
      description: '基于6个月数据分析的长期决策',
      icon: <HistoryOutlined />,
      color: 'orange'
    }
  ]

  const getTimeHorizonText = (key: string) => {
    switch (key) {
      case 'daily': return '日度'
      case 'weekly': return '周度'
      case 'monthly': return '月度'
      default: return '未知'
    }
  }

  const getTimeHorizonColor = (key: string) => {
    switch (key) {
      case 'daily': return 'blue'
      case 'weekly': return 'green'
      case 'monthly': return 'orange'
      default: return 'default'
    }
  }

  return (
    <div>
      <Title level={2} style={{ marginBottom: 24 }}>
        AI投资决策
      </Title>

      <Card>
        <Tabs 
          activeKey={activeTab} 
          onChange={setActiveTab}
          items={timeHorizons.map(horizon => ({
            key: horizon.key,
            label: (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {horizon.icon}
                {horizon.title}
                <Tag color={horizon.color}>{horizon.description}</Tag>
              </div>
            ),
            children: <DecisionViewer timeHorizon={horizon.key as any} />
          }))}
        />
      </Card>

      <Card title="决策功能说明" style={{ marginTop: 16 }}>
        <div style={{ padding: '16px 0' }}>
          <h4>AI决策引擎特点：</h4>
          <ul>
            <li><strong>日度决策</strong>：基于30天技术面和基本面数据，提供短期操作建议</li>
            <li><strong>周度决策</strong>：基于12周趋势分析，提供中期仓位调整方案</li>
            <li><strong>月度决策</strong>：基于6个月深度分析，提供长期投资策略</li>
          </ul>
          
          <h4 style={{ marginTop: 24 }}>决策输出内容：</h4>
          <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
            <Col xs={24} sm={8}>
              <Card size="small" title="整体评估">
                <div>• 组合健康度评分</div>
                <div>• 风险等级评估</div>
                <div>• 预期收益预测</div>
                <div>• 决策置信度</div>
              </Card>
            </Col>
            <Col xs={24} sm={8}>
              <Card size="small" title="持仓决策">
                <div>• 继续持有/买入/卖出</div>
                <div>• 加仓/减仓建议</div>
                <div>• 目标价和止损价</div>
                <div>• 具体操作理由</div>
              </Card>
            </Col>
            <Col xs={24} sm={8}>
              <Card size="small" title="组合调整">
                <div>• 左右侧仓位比例</div>
                <div>• 防御性仓位配置</div>
                <div>• 再平衡操作建议</div>
                <div>• 风险控制措施</div>
              </Card>
            </Col>
          </Row>
          
          <h4 style={{ marginTop: 24 }}>决策执行流程：</h4>
          <div style={{ marginTop: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <CheckCircleOutlined style={{ color: '#52c41a' }} />
              <span><strong>即时执行</strong>：高优先级操作建议立即执行</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <ClockCircleOutlined style={{ color: '#1890ff' }} />
              <span><strong>短期调整</strong>：1-2周内完成仓位调整</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <BarChartOutlined style={{ color: '#faad14' }} />
              <span><strong>持续观察</strong>：关注市场变化，适时调整策略</span>
            </div>
          </div>
          
          <p style={{ marginTop: 16, color: '#666' }}>
            所有决策均基于免费数据源和自建算法生成，确保数据的及时性和准确性。
            决策仅供参考，投资有风险，请谨慎决策。
          </p>
        </div>
      </Card>
    </div>
  )
}

export default Decisions
