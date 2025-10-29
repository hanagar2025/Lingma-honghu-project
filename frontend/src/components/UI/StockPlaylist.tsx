import React, { useState } from 'react'
import { Card, List, Input, Button, Tag, Space, Row, Col, Statistic } from 'antd'
import { SearchOutlined, PlayCircleOutlined, PauseCircleOutlined, SoundOutlined } from '@ant-design/icons'
import StockCard from './StockCard'

interface StockPlaylistProps {
  title: string
  stocks: Array<{
    code: string
    name: string
    currentPrice: number
    change: number
    changeRate: number
    volume: number
    marketValue: number
    category: 'right' | 'left' | 'defensive' | 'observation'
    score: number
  }>
  onStockSelect?: (stockCode: string) => void
}

const StockPlaylist: React.FC<StockPlaylistProps> = ({ title, stocks, onStockSelect }) => {
  const [searchText, setSearchText] = useState('')
  const [playingStock, setPlayingStock] = useState<string | null>(null)
  const [filteredStocks, setFilteredStocks] = useState(stocks)

  // 搜索过滤
  const handleSearch = (value: string) => {
    setSearchText(value)
    const filtered = stocks.filter(stock => 
      stock.name.toLowerCase().includes(value.toLowerCase()) ||
      stock.code.toLowerCase().includes(value.toLowerCase())
    )
    setFilteredStocks(filtered)
  }

  // 播放/暂停控制
  const handlePlay = (stockCode: string) => {
    setPlayingStock(stockCode)
    onStockSelect?.(stockCode)
  }

  const handlePause = (stockCode: string) => {
    setPlayingStock(null)
  }

  // 计算统计信息
  const totalStocks = stocks.length
  const avgScore = stocks.reduce((sum, stock) => sum + stock.score, 0) / totalStocks
  const categoryCount = stocks.reduce((acc, stock) => {
    acc[stock.category] = (acc[stock.category] || 0) + 1
    return acc
  }, {} as Record<string, number>)

  return (
    <Card
      title={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <SoundOutlined style={{ color: '#1890ff' }} />
          <span style={{ fontSize: 18, fontWeight: 600 }}>{title}</span>
          <Tag color="blue">{totalStocks}只</Tag>
        </div>
      }
      style={{
        borderRadius: 16,
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        border: 'none',
        boxShadow: '0 8px 32px rgba(0,0,0,0.1)'
      }}
      headStyle={{
        background: 'rgba(255,255,255,0.1)',
        borderRadius: '16px 16px 0 0',
        border: 'none',
        color: 'white'
      }}
      bodyStyle={{
        background: 'rgba(255,255,255,0.95)',
        borderRadius: '0 0 16px 16px',
        padding: '20px'
      }}
    >
      {/* 搜索栏 */}
      <div style={{ marginBottom: 16 }}>
        <Input
          placeholder="搜索股票名称或代码..."
          prefix={<SearchOutlined style={{ color: '#1890ff' }} />}
          value={searchText}
          onChange={(e) => handleSearch(e.target.value)}
          style={{
            borderRadius: 20,
            border: '2px solid #e5e7eb',
            borderRadius: 20,
            height: 40
          }}
        />
      </div>

      {/* 统计信息 */}
      <Row gutter={[16, 16]} style={{ marginBottom: 20 }}>
        <Col xs={12} sm={6}>
          <Statistic
            title="平均评分"
            value={avgScore.toFixed(1)}
            valueStyle={{ color: '#1890ff', fontSize: 16 }}
          />
        </Col>
        <Col xs={12} sm={6}>
          <Statistic
            title="右侧仓位"
            value={categoryCount.right || 0}
            valueStyle={{ color: '#52c41a', fontSize: 16 }}
          />
        </Col>
        <Col xs={12} sm={6}>
          <Statistic
            title="左侧仓位"
            value={categoryCount.left || 0}
            valueStyle={{ color: '#1890ff', fontSize: 16 }}
          />
        </Col>
        <Col xs={12} sm={6}>
          <Statistic
            title="防御仓位"
            value={categoryCount.defensive || 0}
            valueStyle={{ color: '#faad14', fontSize: 16 }}
          />
        </Col>
      </Row>

      {/* 股票列表 */}
      <List
        dataSource={filteredStocks}
        renderItem={(stock) => (
          <List.Item style={{ padding: 0, marginBottom: 8 }}>
            <StockCard
              stock={{
                ...stock,
                isPlaying: playingStock === stock.code
              }}
              onPlay={handlePlay}
              onPause={handlePause}
            />
          </List.Item>
        )}
        locale={{ emptyText: '暂无股票数据' }}
      />

      {/* 底部控制栏 */}
      {playingStock && (
        <div style={{
          position: 'sticky',
          bottom: 0,
          background: 'rgba(24, 144, 255, 0.1)',
          padding: '12px 16px',
          borderRadius: 12,
          marginTop: 16,
          border: '1px solid rgba(24, 144, 255, 0.2)'
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{
              width: 32,
              height: 32,
              borderRadius: '50%',
              background: '#ff4d4f',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer'
            }}>
              <PauseCircleOutlined style={{ color: 'white', fontSize: 16 }} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#1f2937' }}>
                {stocks.find(s => s.code === playingStock)?.name}
              </div>
              <div style={{ fontSize: 12, color: '#6b7280' }}>
                正在分析中...
              </div>
            </div>
            <Button 
              type="primary" 
              size="small"
              onClick={() => setPlayingStock(null)}
            >
              停止
            </Button>
          </div>
        </div>
      )}
    </Card>
  )
}

export default StockPlaylist
