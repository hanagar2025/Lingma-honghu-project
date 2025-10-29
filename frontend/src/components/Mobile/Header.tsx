import React from 'react'
import { useNavigate } from 'react-router-dom'
import { LeftOutlined } from '@ant-design/icons'
import './Header.css'

interface HeaderProps {
  title: string
  showBack?: boolean
  rightButton?: React.ReactNode
}

const Header: React.FC<HeaderProps> = ({ 
  title, 
  showBack = false, 
  rightButton 
}) => {
  const navigate = useNavigate()

  const handleBack = () => {
    navigate(-1)
  }

  return (
    <div className="mobile-header">
      <div className="header-safe-area" />
      <div className="header-content">
        <div className="header-left">
          {showBack && (
            <button className="header-back-btn" onClick={handleBack}>
              <LeftOutlined />
            </button>
          )}
        </div>
        <h1 className="header-title">{title}</h1>
        <div className="header-right">
          {rightButton}
        </div>
      </div>
    </div>
  )
}

export default Header

