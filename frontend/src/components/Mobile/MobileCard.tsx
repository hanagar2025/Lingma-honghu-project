import React from 'react'
import './MobileCard.css'

interface MobileCardProps {
  children: React.ReactNode
  className?: string
  onClick?: () => void
}

const MobileCard: React.FC<MobileCardProps> = ({ 
  children, 
  className = '',
  onClick 
}) => {
  return (
    <div 
      className={`mobile-card ${className}`}
      onClick={onClick}
    >
      {children}
    </div>
  )
}

export default MobileCard

