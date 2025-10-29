import React from 'react'
import { useNavigate } from 'react-router-dom'
import { PlusOutlined, WalletOutlined } from '@ant-design/icons'
import Header from '../../components/Mobile/Header'
import MobileLayout from '../../components/Mobile/MobileLayout'
import MobileCard from '../../components/Mobile/MobileCard'
import StatCard from '../../components/Mobile/StatCard'
import '../../styles/mobile.css'

const Overview: React.FC = () => {
  const navigate = useNavigate()

  // 模拟数据
  const summary = {
    totalAssets: 1000000.0,
    totalMarketValue: 900000.0,
    totalProfitLoss: 50000.0,
    totalProfitLossRate: 5.56,
    availableCash: 100000.0
  }

  const recentPositions = [
    { code: '603986', name: '兆易创新', price: 120.50, change: 3.2 },
    { code: '002241', name: '歌尔股份', price: 45.80, change: -1.5 },
    { code: '000001', name: '平安银行', price: 12.30, change: 0.8 },
  ]

  return (
    <MobileLayout>
      <Header 
        title="投资概览"
        rightButton={
          <PlusOutlined 
            style={{ fontSize: 22, color: '#007aff', cursor: 'pointer' }}
            onClick={() => navigate('/portfolio')}
          />
        }
      />
      
      <div style={{ padding: '16px 16px 80px' }}>
        {/* 总资产卡片 */}
        <MobileCard>
          <div style={{ textAlign: 'center', padding: '8px 0' }}>
            <div style={{ fontSize: 13, color: '#8e8e93', marginBottom: 8 }}>
              总资产
            </div>
            <div style={{ fontSize: 36, fontWeight: 600, color: '#000000', marginBottom: 4 }}>
              ¥{(summary.totalAssets / 10000).toFixed(1)}万
            </div>
            <div style={{ fontSize: 15, color: summary.totalProfitLossRate >= 0 ? '#34c759' : '#ff3b30' }}>
              {summary.totalProfitLossRate >= 0 ? '↗' : '↘'} {Math.abs(summary.totalProfitLossRate).toFixed(2)}%
            </div>
          </div>
        </MobileCard>

        {/* 快速统计 */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: 16 }}>
          <StatCard
            title="持仓市值"
            value={(summary.totalMarketValue / 10000).toFixed(1)}
            suffix="万"
            color="primary"
          />
          <StatCard
            title="总盈亏"
            value={(summary.totalProfitLoss / 10000).toFixed(1)}
            suffix="万"
            trend={summary.totalProfitLossRate}
            color={summary.totalProfitLoss >= 0 ? 'success' : 'danger'}
          />
        </div>

        {/* 仓位分布 */}
        <MobileCard>
          <div style={{ fontSize: 17, fontWeight: 600, marginBottom: 16 }}>
            📊 仓位分布
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 15 }}>主仓（主线）</span>
              <span style={{ fontSize: 17, fontWeight: 600, color: '#007aff' }}>40%</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 15 }}>右仓（补充）</span>
              <span style={{ fontSize: 17, fontWeight: 600, color: '#34c759' }}>30%</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 15 }}>左仓（方向）</span>
              <span style={{ fontSize: 17, fontWeight: 600, color: '#ff9500' }}>20%</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 15 }}>现金</span>
              <span style={{ fontSize: 17, fontWeight: 600, color: '#86868b' }}>10%</span>
            </div>
          </div>
        </MobileCard>

        {/* 最近持仓 */}
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 17, fontWeight: 600, marginBottom: 12, paddingLeft: 4 }}>
            📝 最近持仓
          </div>
          {recentPositions.map((position, index) => (
            <MobileCard 
              key={index}
              className="list-item clickable"
              onClick={() => navigate(`/portfolio`)}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 17, fontWeight: 600, marginBottom: 4 }}>
                    {position.name}
                  </div>
                  <div style={{ fontSize: 13, color: '#8e8e93' }}>
                    {position.code}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 17, fontWeight: 600, marginBottom: 4 }}>
                    ¥{position.price.toFixed(2)}
                  </div>
                  <div style={{ 
                    fontSize: 15, 
                    fontWeight: 600,
                    color: position.change >= 0 ? '#34c759' : '#ff3b30'
                  }}>
                    {position.change >= 0 ? '↑' : '↓'} {Math.abs(position.change).toFixed(2)}%
                  </div>
                </div>
              </div>
            </MobileCard>
          ))}
          
          {recentPositions.length === 0 && (
            <MobileCard>
              <div className="empty-state">
                <WalletOutlined className="empty-state-icon" />
                <div className="empty-state-title">暂无持仓</div>
                <div className="empty-state-description">
                  点击右上角添加您的第一只股票
                </div>
              </div>
            </MobileCard>
          )}
        </div>

        {/* 快捷操作 */}
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 17, fontWeight: 600, marginBottom: 12, paddingLeft: 4 }}>
            ⚡ 快捷操作
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <MobileCard 
              className="clickable"
              onClick={() => navigate('/analysis')}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ fontSize: 24 }}>📊</div>
                <div>
                  <div style={{ fontSize: 17, fontWeight: 600 }}>数据分析</div>
                  <div style={{ fontSize: 13, color: '#8e8e93' }}>查看技术分析</div>
                </div>
              </div>
            </MobileCard>
            <MobileCard 
              className="clickable"
              onClick={() => navigate('/ai')}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ fontSize: 24 }}>🤖</div>
                <div>
                  <div style={{ fontSize: 17, fontWeight: 600 }}>AI推荐</div>
                  <div style={{ fontSize: 13, color: '#8e8e93' }}>获取投资建议</div>
                </div>
              </div>
            </MobileCard>
          </div>
        </div>
      </div>
    </MobileLayout>
  )
}

export default Overview

