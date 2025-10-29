import React from 'react'
import { RiseOutlined, FallOutlined } from '@ant-design/icons'
import MobileCard from './MobileCard'
import './StatCard.css'

interface StatCardProps {
  title: string
  value: number | string
  prefix?: string
  suffix?: string
  trend?: number
  color?: 'primary' | 'success' | 'danger' | 'warning'
}

const StatCard: React.FC<StatCardProps> = ({
  title,
  value,
  prefix = '',
  suffix = '',
  trend,
  color = 'primary'
}) => {
  const getColorClass = () => {
    const colors = {
      primary: '#007aff',
      success: '#34c759',
      danger: '#ff3b30',
      warning: '#ff9500'
    }
    return colors[color]
  }

  const formatValue = (val: number | string) => {
    if (typeof val === 'number') {
      return val.toFixed(2)
    }
    return val
  }

  return (
    <MobileCard className="stat-card">
      <div className="stat-title">{title}</div>
      <div className="stat-value" style={{ color: getColorClass() }}>
        {prefix}{formatValue(value)}{suffix}
      </div>
      {trend !== undefined && (
        <div 
          className={`stat-trend ${trend >= 0 ? 'up' : 'down'}`}
          style={{ color: trend >= 0 ? '#34c759' : '#ff3b30' }}
        >
          {trend >= 0 ? <RiseOutlined /> : <FallOutlined />}
          <span>{Math.abs(trend).toFixed(2)}%</span>
        </div>
      )}
    </MobileCard>
  )
}

export default StatCard

