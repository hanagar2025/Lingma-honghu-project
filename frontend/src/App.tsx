import { Routes, Route, Navigate } from 'react-router-dom'
import AppLayout from './components/Layout/AppLayout'
import Login from './pages/Login'
import Cockpit from './pages/Cockpit'
import DailyReport from './pages/DailyReport'
import Portfolio from './pages/Portfolio'
import { useAppSelector } from './hooks/redux'
import { OFFLINE_FORCED } from './services/api'
import './styles/global.css'
import './styles/cockpit.css'

function App() {
  const { isAuthenticated } = useAppSelector(state => state.auth)

  // 离线快照模式下跳过登录：此时页面只读一个静态 JSON，没有后端可鉴权，
  // 也没有任何可写操作（标记执行等按钮会被隐藏）。挡在登录页只会让人看不到当天分析。
  if (!isAuthenticated && !OFFLINE_FORCED) {
    return <Login />
  }

  return (
    <AppLayout>
      <Routes>
        <Route path="/" element={<Cockpit />} />
        <Route path="/daily" element={<DailyReport />} />
        <Route path="/portfolio" element={<Portfolio />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppLayout>
  )
}

export default App
