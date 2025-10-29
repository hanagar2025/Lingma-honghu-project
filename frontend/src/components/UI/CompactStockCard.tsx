import React from 'react'
import { Card, Row, Col, Tag, Progress, Button } from 'antd'
import { RiseOutlined, FallOutlined, PlayCircleOutlined, PauseCircleOutlined, MoreOutlined } from '@ant-design/icons'

interface CompactStockCardProps {
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
    weight: number
  }
  onPlay?: (stockCode: string) => void
  onPause?: (stockCode: string) => void
  onMore?: (stockCode: string) => void
}

const CompactStockCard: React.FC<CompactStockCardProps> = ({ 
  stock, 
  onPlay, 
  onPause, 
  onMore 
}) => {
  const getCategoryColor = (category: string) => {
    switch (category) {
      case 'right': return '#52c41a'
      case 'left': return '#1890ff'
      case 'defensive': return '#faad14'
      case 'observation': return '#722ed1'
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
        marginBottom: 8,
        borderRadius: 8,
        background: 'linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%)',
        border: '1px solid #e2e8f0',
        boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
      }}
      bodyStyle={{ padding: '12px' }}
    >
      <Row align="middle" gutter={[8, 0]}>
        {/* 播放按钮 */}
        <Col flex="32px">
          <div
            style={{
              width: 32,
              height: 32,
              borderRadius: '50%',
              background: stock.isPlaying ? '#ff4d4f' : '#1890ff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              transition: 'all 0.3s ease'
            }}
            onClick={() => stock.isPlaying ? onPause?.(stock.code) : onPlay?.(stock.code)}
          >
            {stock.isPlaying ? (
              <PauseCircleOutlined style={{ color: 'white', fontSize: 14 }} />
            ) : (
              <PlayCircleOutlined style={{ color: 'white', fontSize: 14 }} />
            )}
          </div>
        </Col>

        {/* 股票信息 */}
        <Col flex="auto">
          <div style={{ marginBottom: 6 }}>
            <div style={{ 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'space-between',
              marginBottom: 2
            }}>
              <span style={{ 
                fontSize: 14, 
                fontWeight: 600, 
                color: '#1f2937' 
              }}>
                {stock.name}
              </span>
              <Tag 
                color={getCategoryColor(stock.category)}
                style={{ 
                  borderRadius: 8,
                  fontSize: 10,
                  fontWeight: 500,
                  margin: 0
                }}
              >
                {getCategoryName(stock.category)}
              </Tag>
            </div>
            <div style={{ 
              fontSize: 11, 
              color: '#6b7280',
              marginBottom: 4
            }}>
              {stock.code} • 权重 {stock.weight.toFixed(1)}%
            </div>
          </div>

          {/* 价格信息 */}
          <div style={{ 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'space-between',
            marginBottom: 6
          }}>
            <div>
              <span style={{ 
                fontSize: 16, 
                fontWeight: 700, 
                color: '#1f2937' 
              }}>
                ¥{stock.currentPrice.toFixed(2)}
              </span>
              <div style={{ 
                display: 'flex', 
                alignItems: 'center', 
                gap: 2,
                marginTop: 1
              }}>
                {stock.change >= 0 ? (
                  <RiseOutlined style={{ color: '#52c41a', fontSize: 10 }} />
                ) : (
                  <FallOutlined style={{ color: '#ff4d4f', fontSize: 10 }} />
                )}
                <span style={{ 
                  fontSize: 11,
                  color: stock.change >= 0 ? '#52c41a' : '#ff4d4f',
                  fontWeight: 500
                }}>
                  {stock.change >= 0 ? '+' : ''}{stock.change.toFixed(2)} ({stock.changeRate >= 0 ? '+' : ''}{stock.changeRate.toFixed(2)}%)
                </span>
              </div>
            </div>
          </div>

          {/* 评分进度条 */}
          <div style={{ marginBottom: 6 }}>
            <div style={{ 
              display: 'flex', 
              justifyContent: 'space-between', 
              alignItems: 'center',
              marginBottom: 2
            }}>
              <span style={{ fontSize: 10, color: '#6b7280' }}>评分</span>
              <span style={{ 
                fontSize: 10, 
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
              strokeWidth={3}
              showInfo={false}
              style={{ borderRadius: 1 }}
            />
          </div>

          {/* 底部信息 */}
          <div style={{ 
            display: 'flex', 
            justifyContent: 'space-between',
            fontSize: 10,
            color: '#6b7280'
          }}>
            <span>成交量: {(stock.volume / 10000).toFixed(1)}万</span>
            <span>市值: {(stock.marketValue / 100000000).toFixed(1)}亿</span>
          </div>
        </Col>

        {/* 更多按钮 */}
        <Col flex="24px">
          <Button
            type="text"
            icon={<MoreOutlined />}
            onClick={() => onMore?.(stock.code)}
            style={{
              width: 24,
              height: 24,
              padding: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          />
        </Col>
      </Row>
    </Card>
  )
}

export default CompactStockCard
