import { Routes, Route } from 'react-router-dom'
import { useState, useEffect } from 'react'
import AppLayout from './components/Layout/AppLayout'
import MobileLayout from './components/Mobile/MobileLayout'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Portfolio from './pages/Portfolio'
import Analysis from './pages/Analysis'
import Reports from './pages/Reports'
import Decisions from './pages/Decisions'
import Settings from './pages/Settings'
import SmartRecommendation from './pages/SmartRecommendation'
import PortfolioStrategy from './pages/PortfolioStrategy'
import Overview from './pages/Mobile/Overview'
import Profile from './pages/Mobile/Profile'
import TestAddStock from './TestAddStock'
import { useAppSelector } from './hooks/redux'
import './styles/global.css'

function App() {
  const { isAuthenticated } = useAppSelector(state => state.auth)
  const [isMobile, setIsMobile] = useState(false)

  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth <= 768)
    }
    
    checkMobile()
    window.addEventListener('resize', checkMobile)
    
    return () => window.removeEventListener('resize', checkMobile)
  }, [])

  // 如果未认证，显示登录页
  if (!isAuthenticated) {
    return <Login />
  }

  // 移动端布局
  if (isMobile) {
    return (
      <Routes>
        <Route path="/" element={<Overview />} />
        <Route path="/portfolio" element={<Portfolio />} />
        <Route path="/analysis" element={<Analysis />} />
        <Route path="/ai" element={<SmartRecommendation />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/test" element={<TestAddStock />} />
      </Routes>
    )
  }

  // 桌面端布局
  return (
    <AppLayout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/portfolio" element={<Portfolio />} />
        <Route path="/analysis" element={<Analysis />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/decisions" element={<Decisions />} />
        <Route path="/smart-recommendation" element={<SmartRecommendation />} />
        <Route path="/portfolio-strategy" element={<PortfolioStrategy />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/test" element={<TestAddStock />} />
        <Route path="/ai" element={<SmartRecommendation />} />
        <Route path="/profile" element={<Settings />} />
      </Routes>
    </AppLayout>
  )
}

export default App
