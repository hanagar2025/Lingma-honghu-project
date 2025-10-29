import React from 'react'
import { List, Typography, Tag } from 'antd'
import { RiseOutlined, FallOutlined } from '@ant-design/icons'
import { MarketIndex } from '../../store/slices/marketSlice'

const { Text } = Typography

interface MarketOverviewProps {
  indices: MarketIndex[]
}

const MarketOverview: React.FC<MarketOverviewProps> = ({ indices }) => {
  const getChangeIcon = (change: number) => {
    return change >= 0 ? <RiseOutlined style={{ color: '#52c41a' }} /> : <FallOutlined style={{ color: '#ff4d4f' }} />
  }

  const getChangeColor = (change: number) => {
    return change >= 0 ? '#52c41a' : '#ff4d4f'
  }

  return (
    <List
      dataSource={indices}
      renderItem={(item) => (
        <List.Item>
          <List.Item.Meta
            title={
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text strong>{item.name}</Text>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {getChangeIcon(item.change)}
                  <Text style={{ color: getChangeColor(item.change), fontWeight: 'bold' }}>
                    {item.change >= 0 ? '+' : ''}{item.change.toFixed(2)}
                  </Text>
                  <Tag color={item.change >= 0 ? 'green' : 'red'}>
                    {item.change >= 0 ? '+' : ''}{item.changeRate.toFixed(2)}%
                  </Tag>
                </div>
              </div>
            }
            description={
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <Text type="secondary">{item.code}</Text>
                <Text strong style={{ fontSize: '16px' }}>
                  {item.value.toFixed(2)}
                </Text>
              </div>
            }
          />
        </List.Item>
      )}
    />
  )
}

export default MarketOverview
