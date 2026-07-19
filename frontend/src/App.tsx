import { Routes, Route, Navigate } from 'react-router-dom'
import AppLayout from './components/Layout/AppLayout'
import Login from './pages/Login'
import DailyReport from './pages/DailyReport'
import Portfolio from './pages/Portfolio'
import { useAppSelector } from './hooks/redux'
import './styles/global.css'

function App() {
  const { isAuthenticated } = useAppSelector(state => state.auth)

  if (!isAuthenticated) {
    return <Login />
  }

  return (
    <AppLayout>
      <Routes>
        <Route path="/" element={<DailyReport />} />
        <Route path="/portfolio" element={<Portfolio />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppLayout>
  )
}

export default App
