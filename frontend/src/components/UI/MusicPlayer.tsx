import React, { useState } from 'react'
import { Card, Button, Progress, Slider, Row, Col, Typography } from 'antd'
import { 
  PlayCircleOutlined, 
  PauseCircleOutlined, 
  StepBackwardOutlined, 
  StepForwardOutlined,
  SoundOutlined,
  HeartOutlined,
  ShareAltOutlined,
  MoreOutlined
} from '@ant-design/icons'

const { Text } = Typography

interface MusicPlayerProps {
  currentStock?: {
    code: string
    name: string
    currentPrice: number
    change: number
    changeRate: number
    category: string
    score: number
  }
  isPlaying: boolean
  onPlay: () => void
  onPause: () => void
  onPrevious: () => void
  onNext: () => void
  onVolumeChange: (volume: number) => void
}

const MusicPlayer: React.FC<MusicPlayerProps> = ({
  currentStock,
  isPlaying,
  onPlay,
  onPause,
  onPrevious,
  onNext,
  onVolumeChange
}) => {
  const [currentTime, setCurrentTime] = useState(0)
  const [duration] = useState(180) // 3分钟
  const [volume, setVolume] = useState(80)

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins}:${secs.toString().padStart(2, '0')}`
  }

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
      case 'right': return '右侧进攻'
      case 'left': return '左侧价值'
      case 'defensive': return '防御配置'
      case 'observation': return '观察等待'
      default: return '未知'
    }
  }

  if (!currentStock) {
    return (
      <Card
        style={{
          borderRadius: 16,
          background: 'linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%)',
          border: 'none',
          boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
        }}
        bodyStyle={{ padding: '20px', textAlign: 'center' }}
      >
        <SoundOutlined style={{ fontSize: 48, color: '#d1d5db', marginBottom: 16 }} />
        <div style={{ color: '#6b7280', fontSize: 16 }}>
          选择一只股票开始分析
        </div>
      </Card>
    )
  }

  return (
    <Card
      style={{
        borderRadius: 16,
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        border: 'none',
        boxShadow: '0 8px 32px rgba(0,0,0,0.15)',
        color: 'white'
      }}
      bodyStyle={{ padding: '20px' }}
    >
      {/* 股票信息 */}
      <Row align="middle" gutter={[16, 16]} style={{ marginBottom: 20 }}>
        <Col flex="60px">
          <div style={{
            width: 60,
            height: 60,
            borderRadius: 12,
            background: 'rgba(255,255,255,0.2)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 24,
            fontWeight: 'bold'
          }}>
            {currentStock.name.charAt(0)}
          </div>
        </Col>
        <Col flex="auto">
          <div style={{ marginBottom: 4 }}>
            <Text style={{ color: 'white', fontSize: 18, fontWeight: 600 }}>
              {currentStock.name}
            </Text>
          </div>
          <div style={{ marginBottom: 4 }}>
            <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 14 }}>
              {currentStock.code}
            </Text>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ 
              color: 'white', 
              fontSize: 16, 
              fontWeight: 600 
            }}>
              ¥{currentStock.currentPrice.toFixed(2)}
            </span>
            <span style={{ 
              color: currentStock.change >= 0 ? '#52c41a' : '#ff4d4f',
              fontSize: 14,
              fontWeight: 500
            }}>
              {currentStock.change >= 0 ? '+' : ''}{currentStock.change.toFixed(2)} ({currentStock.changeRate >= 0 ? '+' : ''}{currentStock.changeRate.toFixed(2)}%)
            </span>
          </div>
        </Col>
        <Col>
          <div style={{
            padding: '4px 12px',
            borderRadius: 12,
            background: getCategoryColor(currentStock.category),
            color: 'white',
            fontSize: 12,
            fontWeight: 500
          }}>
            {getCategoryName(currentStock.category)}
          </div>
        </Col>
      </Row>

      {/* 进度条 */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
          <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 12 }}>
            {formatTime(currentTime)}
          </Text>
          <Text style={{ color: 'rgba(255,255,255,0.8)', fontSize: 12 }}>
            {formatTime(duration)}
          </Text>
        </div>
        <Slider
          value={currentTime}
          max={duration}
          onChange={setCurrentTime}
          trackStyle={{ background: 'rgba(255,255,255,0.3)' }}
          handleStyle={{ 
            background: 'white',
            border: 'none',
            boxShadow: '0 2px 8px rgba(0,0,0,0.2)'
          }}
          railStyle={{ background: 'rgba(255,255,255,0.2)' }}
        />
      </div>

      {/* 控制按钮 */}
      <Row justify="center" align="middle" gutter={[16, 0]} style={{ marginBottom: 20 }}>
        <Col>
          <Button
            type="text"
            icon={<StepBackwardOutlined />}
            onClick={onPrevious}
            style={{ 
              color: 'white', 
              fontSize: 20,
              width: 40,
              height: 40,
              borderRadius: '50%',
              background: 'rgba(255,255,255,0.1)'
            }}
          />
        </Col>
        <Col>
          <Button
            type="text"
            icon={isPlaying ? <PauseCircleOutlined /> : <PlayCircleOutlined />}
            onClick={isPlaying ? onPause : onPlay}
            style={{ 
              color: 'white', 
              fontSize: 32,
              width: 60,
              height: 60,
              borderRadius: '50%',
              background: 'rgba(255,255,255,0.2)'
            }}
          />
        </Col>
        <Col>
          <Button
            type="text"
            icon={<StepForwardOutlined />}
            onClick={onNext}
            style={{ 
              color: 'white', 
              fontSize: 20,
              width: 40,
              height: 40,
              borderRadius: '50%',
              background: 'rgba(255,255,255,0.1)'
            }}
          />
        </Col>
      </Row>

      {/* 底部操作栏 */}
      <Row justify="space-between" align="middle">
        <Col>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <SoundOutlined style={{ color: 'rgba(255,255,255,0.8)' }} />
            <Slider
              value={volume}
              max={100}
              onChange={(value) => {
                setVolume(value)
                onVolumeChange(value)
              }}
              style={{ width: 80 }}
              trackStyle={{ background: 'rgba(255,255,255,0.3)' }}
              handleStyle={{ 
                background: 'white',
                border: 'none',
                boxShadow: '0 2px 8px rgba(0,0,0,0.2)'
              }}
              railStyle={{ background: 'rgba(255,255,255,0.2)' }}
            />
          </div>
        </Col>
        <Col>
          <div style={{ display: 'flex', gap: 12 }}>
            <Button
              type="text"
              icon={<HeartOutlined />}
              style={{ color: 'rgba(255,255,255,0.8)' }}
            />
            <Button
              type="text"
              icon={<ShareAltOutlined />}
              style={{ color: 'rgba(255,255,255,0.8)' }}
            />
            <Button
              type="text"
              icon={<MoreOutlined />}
              style={{ color: 'rgba(255,255,255,0.8)' }}
            />
          </div>
        </Col>
      </Row>
    </Card>
  )
}

export default MusicPlayer
