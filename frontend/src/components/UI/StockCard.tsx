import React from 'react'
import { Card, Row, Col, Tag, Progress } from 'antd'
import { RiseOutlined, FallOutlined, PlayCircleOutlined, PauseCircleOutlined } from '@ant-design/icons'

interface StockCardProps {
  stock: {
    code: string
    name: string
    currentPrice: number
    change: number
    changeRate: number
    volume: number
    marketValue: number
    category: 'right' | 'left' | 'defensive' | 'observation'
    isPlaying?: boolean
    score: number
  }
  onPlay?: (stockCode: string) => void
  onPause?: (stockCode: string) => void
}

const StockCard: React.FC<StockCardProps> = ({ stock, onPlay, onPause }) => {
  const getCategoryColor = (category: string) => {
    switch (category) {
      case 'right': return '#52c41a' // 绿色 - 右侧进攻
      case 'left': return '#1890ff'  // 蓝色 - 左侧价值
      case 'defensive': return '#faad14' // 橙色 - 防御
      case 'observation': return '#722ed1' // 紫色 - 观察
      default: return '#666'
    }
  }

  const getCategoryName = (category: string) => {
    switch (category) {
      case 'right': return '右侧'
      case 'left': return '左侧'
      case 'defensive': return '防御'
      case 'observation': return '观察'
      default: return '未知'
    }
  }

  const getScoreColor = (score: number) => {
    if (score >= 80) return '#52c41a'
    if (score >= 60) return '#1890ff'
    if (score >= 40) return '#faad14'
    return '#ff4d4f'
  }

  return (
    <Card
      hoverable
      style={{
        marginBottom: 12,
        borderRadius: 12,
        background: 'linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%)',
        border: 'none',
        boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
      }}
      bodyStyle={{ padding: '16px' }}
    >
      <Row align="middle" gutter={[12, 0]}>
        {/* 播放控制按钮 */}
        <Col flex="40px">
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: '50%',
              background: stock.isPlaying ? '#ff4d4f' : '#52c41a',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              transition: 'all 0.3s ease'
            }}
            onClick={() => stock.isPlaying ? onPause?.(stock.code) : onPlay?.(stock.code)}
          >
            {stock.isPlaying ? (
              <PauseCircleOutlined style={{ color: 'white', fontSize: 20 }} />
            ) : (
              <PlayCircleOutlined style={{ color: 'white', fontSize: 20 }} />
            )}
          </div>
        </Col>

        {/* 股票信息 */}
        <Col flex="auto">
          <div style={{ marginBottom: 8 }}>
            <div style={{ 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'space-between',
              marginBottom: 4
            }}>
              <span style={{ 
                fontSize: 16, 
                fontWeight: 600, 
                color: '#1f2937' 
              }}>
                {stock.name}
              </span>
              <Tag 
                color={getCategoryColor(stock.category)}
                style={{ 
                  borderRadius: 12,
                  fontSize: 11,
                  fontWeight: 500
                }}
              >
                {getCategoryName(stock.category)}
              </Tag>
            </div>
            <div style={{ 
              fontSize: 12, 
              color: '#6b7280',
              marginBottom: 4
            }}>
              {stock.code}
            </div>
          </div>

          {/* 价格信息 */}
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'space-between',
            marginBottom: 8
          }}>
            <div>
              <span style={{ 
                fontSize: 18, 
                fontWeight: 700, 
                color: '#1f2937' 
              }}>
                ¥{stock.currentPrice.toFixed(2)}
              </span>
              <div style={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: 4,
                marginTop: 2
              }}>
                {stock.change >= 0 ? (
                  <RiseOutlined style={{ color: '#52c41a', fontSize: 12 }} />
                ) : (
                  <FallOutlined style={{ color: '#ff4d4f', fontSize: 12 }} />
                )}
                <span style={{ 
                  fontSize: 12,
                  color: stock.change >= 0 ? '#52c41a' : '#ff4d4f',
                  fontWeight: 500
                }}>
                  {stock.change >= 0 ? '+' : ''}{stock.change.toFixed(2)} ({stock.changeRate >= 0 ? '+' : ''}{stock.changeRate.toFixed(2)}%)
                </span>
              </div>
            </div>
          </div>

          {/* 评分进度条 */}
          <div style={{ marginBottom: 8 }}>
            <div style={{ 
              display: 'flex', 
              justifyContent: 'space-between', 
              alignItems: 'center',
              marginBottom: 4
            }}>
              <span style={{ fontSize: 11, color: '#6b7280' }}>综合评分</span>
              <span style={{ 
                fontSize: 11, 
                fontWeight: 600,
                color: getScoreColor(stock.score)
              }}>
                {stock.score.toFixed(1)}
              </span>
            </div>
            <Progress
              percent={stock.score}
              strokeColor={getScoreColor(stock.score)}
              trailColor="#e5e7eb"
              strokeWidth={4}
              showInfo={false}
              style={{ borderRadius: 2 }}
            />
          </div>

          {/* 底部信息 */}
          <div style={{ 
            display: 'flex', 
            justifyContent: 'space-between',
            fontSize: 11,
            color: '#6b7280'
          }}>
            <span>成交量: {(stock.volume / 10000).toFixed(1)}万</span>
            <span>市值: {(stock.marketValue / 100000000).toFixed(1)}亿</span>
          </div>
        </Col>
      </Row>
    </Card>
  )
}

export default StockCard
