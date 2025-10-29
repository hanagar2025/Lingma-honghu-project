import React from 'react'
import { Card, Typography, Button, Space } from 'antd'
import { SoundOutlined, PlayCircleOutlined } from '@ant-design/icons'

const { Title, Paragraph } = Typography

const TestPage: React.FC = () => {
  return (
    <div style={{ 
      minHeight: '100vh', 
      background: 'linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%)',
      padding: '20px'
    }}>
      <Card style={{
        maxWidth: 800,
        margin: '0 auto',
        borderRadius: 16,
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
        border: 'none',
        boxShadow: '0 8px 32px rgba(0,0,0,0.15)',
        color: 'white'
      }}>
        <div style={{ textAlign: 'center', padding: '40px 20px' }}>
          <SoundOutlined style={{ fontSize: 64, color: 'white', marginBottom: 20 }} />
          <Title level={1} style={{ color: 'white', marginBottom: 16 }}>
            股票音乐盒
          </Title>
          <Paragraph style={{ color: 'rgba(255,255,255,0.9)', fontSize: 18, marginBottom: 32 }}>
            音乐播放器风格的投资管理系统
          </Paragraph>
          <Space size="large">
            <Button 
              type="primary" 
              size="large"
              icon={<PlayCircleOutlined />}
              style={{
                background: 'rgba(255,255,255,0.2)',
                border: '2px solid rgba(255,255,255,0.3)',
                borderRadius: 25,
                height: 50,
                padding: '0 30px',
                fontSize: 16,
                fontWeight: 600
              }}
            >
              开始使用
            </Button>
            <Button 
              size="large"
              style={{
                background: 'rgba(255,255,255,0.1)',
                border: '2px solid rgba(255,255,255,0.3)',
                borderRadius: 25,
                height: 50,
                padding: '0 30px',
                fontSize: 16,
                fontWeight: 600,
                color: 'white'
              }}
            >
              了解更多
            </Button>
          </Space>
        </div>
      </Card>
      
      <div style={{ textAlign: 'center', marginTop: 40 }}>
        <Title level={3} style={{ color: '#666' }}>
          🎵 服务状态
        </Title>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 20, marginTop: 20 }}>
          <div style={{
            padding: '10px 20px',
            background: '#52c41a',
            color: 'white',
            borderRadius: 8,
            fontWeight: 600
          }}>
            ✅ 前端服务运行中 (端口: 5173)
          </div>
          <div style={{
            padding: '10px 20px',
            background: '#1890ff',
            color: 'white',
            borderRadius: 8,
            fontWeight: 600
          }}>
            🔧 后端服务启动中 (端口: 3000)
          </div>
        </div>
      </div>
    </div>
  )
}

export default TestPage

