import React, { useState } from 'react'
import { Card, Typography, List, Button, Space, Tag, Tabs, Row, Col } from 'antd'
import { FileTextOutlined, DownloadOutlined, EyeOutlined, ClockCircleOutlined, RiseOutlined, FallOutlined, CheckCircleOutlined } from '@ant-design/icons'
import ReportViewer from '../components/Reports/ReportViewer'

const { Title } = Typography

const Reports: React.FC = () => {
  const [activeTab, setActiveTab] = useState('pre_market')

  const reportTypes = [
    {
      key: 'pre_market',
      title: '盘前准备报表',
      description: '每日9:00自动生成，包含持仓概览、重要资讯、今日关注等',
      time: '09:00',
      icon: <ClockCircleOutlined />,
      status: 'active',
    },
    {
      key: 'intraday',
      title: '盘中观察报表',
      description: '11:30和14:00自动生成，实时监控持仓异动和资金流向',
      time: '11:30, 14:00',
      icon: <RiseOutlined />,
      status: 'active',
    },
    {
      key: 'post_market',
      title: '收盘复盘报表',
      description: '15:30自动生成，包含今日表现、技术复盘、基本面变化等',
      time: '15:30',
      icon: <FallOutlined />,
      status: 'active',
    },
    {
      key: 'daily_decision',
      title: '日终决策报表',
      description: '20:00自动生成，AI决策建议、仓位调整方案、明日计划',
      time: '20:00',
      icon: <CheckCircleOutlined />,
      status: 'active',
    },
  ]

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active':
        return 'green'
      case 'completed':
        return 'blue'
      case 'pending':
        return 'orange'
      default:
        return 'default'
    }
  }

  return (
    <div>
      <Title level={2} style={{ marginBottom: 24 }}>
        智能报表
      </Title>

      <Card>
        <Tabs 
          activeKey={activeTab} 
          onChange={setActiveTab}
          items={reportTypes.map(report => ({
            key: report.key,
            label: (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {report.icon}
                {report.title}
                <Tag color={getStatusColor(report.status)}>{report.time}</Tag>
              </div>
            ),
            children: <ReportViewer reportType={report.key as any} />
          }))}
        />
      </Card>

      <Card title="报表功能说明" style={{ marginTop: 16 }}>
        <div style={{ padding: '16px 0' }}>
          <h4>自动化报表系统特点：</h4>
          <ul>
            <li><strong>盘前准备</strong>：每日开盘前自动分析持仓情况，提供当日关注要点</li>
            <li><strong>盘中观察</strong>：实时监控持仓异动，及时提醒重要变化</li>
            <li><strong>收盘复盘</strong>：全面复盘当日表现，分析技术面和基本面变化</li>
            <li><strong>日终决策</strong>：AI智能分析，提供具体的调仓建议和明日计划</li>
          </ul>
          <p style={{ marginTop: 16, color: '#666' }}>
            所有报表均基于免费数据源生成，确保数据的及时性和准确性。
          </p>
        </div>
      </Card>
    </div>
  )
}

export default Reports
