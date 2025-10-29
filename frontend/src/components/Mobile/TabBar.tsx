import React from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import {
  HomeOutlined,
  WalletOutlined,
  BarChartOutlined,
  BulbOutlined,
  UserOutlined,
} from '@ant-design/icons'
import './TabBar.css'

interface TabItem {
  key: string
  title: string
  icon: React.ReactNode
  path: string
}

const TabBar: React.FC = () => {
  const navigate = useNavigate()
  const location = useLocation()

  const tabs: TabItem[] = [
    {
      key: 'home',
      title: '首页',
      icon: <HomeOutlined />,
      path: '/',
    },
    {
      key: 'portfolio',
      title: '持仓',
      icon: <WalletOutlined />,
      path: '/portfolio',
    },
    {
      key: 'analysis',
      title: '分析',
      icon: <BarChartOutlined />,
      path: '/analysis',
    },
    {
      key: 'ai',
      title: 'AI',
      icon: <BulbOutlined />,
      path: '/ai',
    },
    {
      key: 'profile',
      title: '我的',
      icon: <UserOutlined />,
      path: '/profile',
    },
  ]

  const isActive = (path: string) => {
    return location.pathname === path
  }

  const handleTabClick = (path: string) => {
    navigate(path)
  }

  return (
    <div className="tab-bar-container">
      <div className="tab-bar">
        {tabs.map((tab) => (
          <div
            key={tab.key}
            className={`tab-item ${isActive(tab.path) ? 'active' : ''}`}
            onClick={() => handleTabClick(tab.path)}
          >
            <div className="tab-icon">{tab.icon}</div>
            <div className="tab-title">{tab.title}</div>
          </div>
        ))}
      </div>
      {/* Safe Area for iOS */}
      <div className="tab-bar-safe-area" />
    </div>
  )
}

export default TabBar

