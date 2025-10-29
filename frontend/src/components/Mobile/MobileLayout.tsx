import React from 'react'
import TabBar from './TabBar'
import './MobileLayout.css'

interface MobileLayoutProps {
  children: React.ReactNode
  showTabBar?: boolean
}

const MobileLayout: React.FC<MobileLayoutProps> = ({ 
  children, 
  showTabBar = true 
}) => {
  return (
    <div className="mobile-layout">
      <div className={`mobile-content ${showTabBar ? 'with-tabbar' : ''}`}>
        {children}
      </div>
      {showTabBar && <TabBar />}
    </div>
  )
}

export default MobileLayout

