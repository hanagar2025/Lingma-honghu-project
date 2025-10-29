import React, { Component, ReactNode } from 'react'
import { Button, Result } from 'antd'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    console.error('ErrorBoundary捕获错误:', error)
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('组件错误详情:', error, errorInfo)
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null })
    window.location.reload()
  }

  handleClear = () => {
    localStorage.clear()
    window.location.reload()
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ 
          minHeight: '100vh', 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center',
          background: '#f5f5f7',
          padding: '20px'
        }}>
          <Result
            status="error"
            title="页面加载失败"
            subTitle={this.state.error?.message || '出现了未知错误'}
            extra={[
              <Button type="primary" key="reload" onClick={this.handleReset}>
                刷新页面
              </Button>,
              <Button key="clear" onClick={this.handleClear}>
                清除数据
              </Button>
            ]}
          />
        </div>
      )
    }

    return this.props.children
  }
}

export default ErrorBoundary

