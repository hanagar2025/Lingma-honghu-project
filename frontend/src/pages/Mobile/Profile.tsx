import React from 'react'
import { useNavigate } from 'react-router-dom'
import { SettingOutlined, FileTextOutlined, QuestionCircleOutlined, LogoutOutlined } from '@ant-design/icons'
import Header from '../../components/Mobile/Header'
import MobileLayout from '../../components/Mobile/MobileLayout'
import MobileCard from '../../components/Mobile/MobileCard'
import { useAppDispatch, useAppSelector } from '../../hooks/redux'
import { logout } from '../../store/slices/authSlice'
import '../../styles/mobile.css'

const Profile: React.FC = () => {
  const navigate = useNavigate()
  const dispatch = useAppDispatch()
  const { user } = useAppSelector(state => state.auth)

  const handleLogout = () => {
    dispatch(logout())
    navigate('/login')
  }

  const username = user?.username || '用户'
  const userInitial = username.charAt(0).toUpperCase()

  return (
    <MobileLayout>
      <Header title="我的" />
      
      <div style={{ padding: '16px', paddingBottom: '80px' }}>
        {/* 用户信息卡片 */}
        <MobileCard style={{ padding: '24px', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div style={{
              width: 64,
              height: 64,
              borderRadius: '50%',
              background: '#007aff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 28,
              fontWeight: 600,
              color: '#ffffff'
            }}>
              {userInitial}
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 20, fontWeight: 600, marginBottom: 4 }}>
                {username}
              </div>
              <div style={{ fontSize: 15, color: '#8e8e93' }}>
                投资经理
              </div>
            </div>
          </div>
        </MobileCard>

        {/* 账户信息 */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 13, color: '#8e8e93', fontWeight: 600, marginBottom: 8, paddingLeft: 4 }}>
            账户信息
          </div>
          <MobileCard className="list-item">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ fontSize: 20 }}>📧</span>
                <span style={{ fontSize: 17 }}>邮箱</span>
              </div>
              <span style={{ fontSize: 17, color: '#8e8e93' }}>{user?.email || '未设置'}</span>
            </div>
          </MobileCard>
          <MobileCard className="list-item">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ fontSize: 20 }}>📱</span>
                <span style={{ fontSize: 17 }}>手机</span>
              </div>
              <span style={{ fontSize: 17, color: '#8e8e93' }}>未绑定</span>
            </div>
          </MobileCard>
        </div>

        {/* 功能菜单 */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 13, color: '#8e8e93', fontWeight: 600, marginBottom: 8, paddingLeft: 4 }}>
            功能
          </div>
          <MobileCard 
            className="list-item clickable"
            onClick={() => navigate('/portfolio')}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <SettingOutlined style={{ fontSize: 20, color: '#007aff' }} />
              <span style={{ fontSize: 17 }}>设置</span>
            </div>
          </MobileCard>
          <MobileCard 
            className="list-item clickable"
            onClick={() => navigate('/reports')}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <FileTextOutlined style={{ fontSize: 20, color: '#34c759' }} />
              <span style={{ fontSize: 17 }}>报表中心</span>
            </div>
          </MobileCard>
          <MobileCard className="list-item clickable">
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <QuestionCircleOutlined style={{ fontSize: 20, color: '#ff9500' }} />
              <span style={{ fontSize: 17 }}>帮助与反馈</span>
            </div>
          </MobileCard>
        </div>

        {/* 退出登录 */}
        <MobileCard 
          className="list-item clickable"
          onClick={handleLogout}
          style={{ border: '1px solid #ff3b30' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'center' }}>
            <LogoutOutlined style={{ fontSize: 18, color: '#ff3b30' }} />
            <span style={{ fontSize: 17, color: '#ff3b30', fontWeight: 600 }}>退出登录</span>
          </div>
        </MobileCard>
      </div>
    </MobileLayout>
  )
}

export default Profile

