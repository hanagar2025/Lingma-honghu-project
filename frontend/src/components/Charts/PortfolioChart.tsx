import React from 'react'
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend } from 'recharts'
import { Typography } from 'antd'

const { Text } = Typography

interface PortfolioChartProps {
  data: {
    leftSideRatio?: number
    rightSideRatio?: number
    defensiveRatio?: number
    observationRatio?: number
  } | null
}

const PortfolioChart: React.FC<PortfolioChartProps> = ({ data }) => {
  if (!data) {
    return <div>暂无数据</div>
  }

  const chartData = [
    { name: '左侧仓位', value: data.leftSideRatio || 0, color: '#1890ff' },
    { name: '右侧仓位', value: data.rightSideRatio || 0, color: '#52c41a' },
    { name: '防御仓位', value: data.defensiveRatio || 0, color: '#faad14' },
    { name: '观察仓位', value: data.observationRatio || 0, color: '#722ed1' },
  ].filter(item => item.value > 0)

  const COLORS = ['#1890ff', '#52c41a', '#faad14', '#722ed1']

  return (
    <div style={{ height: 300 }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={chartData}
            cx="50%"
            cy="50%"
            labelLine={false}
            label={({ name, percent }) => `${name} ${(percent * 100).toFixed(1)}%`}
            outerRadius={80}
            fill="#8884d8"
            dataKey="value"
          >
            {chartData.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
            ))}
          </Pie>
          <Tooltip formatter={(value) => [`${value}%`, '占比']} />
          <Legend />
        </PieChart>
      </ResponsiveContainer>
    </div>
  )
}

export default PortfolioChart
