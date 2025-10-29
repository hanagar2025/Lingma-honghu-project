import React, { useState } from 'react'
import { Form, Input, Button, Card, Typography, Tabs, message } from 'antd'
import { UserOutlined, LockOutlined, MailOutlined } from '@ant-design/icons'
import { useAppDispatch, useAppSelector } from '../hooks/redux'
import { login, register, clearError } from '../store/slices/authSlice'

const { Title, Text } = Typography

const Login: React.FC = () => {
  const dispatch = useAppDispatch()
  const { loading, error } = useAppSelector(state => state.auth)
  const [activeTab, setActiveTab] = useState('login')

  const handleLogin = async (values: { username: string; password: string }) => {
    try {
      console.log('尝试登录:', values)
      const result = await dispatch(login(values)).unwrap()
      console.log('登录成功:', result)
      message.success('登录成功')
    } catch (err: any) {
      console.error('登录失败:', err)
      message.error(`登录失败: ${err?.message || '未知错误'}`)
    }
  }

  const handleRegister = async (values: { username: string; email: string; password: string }) => {
    try {
      console.log('尝试注册:', values)
      const result = await dispatch(register(values)).unwrap()
      console.log('注册成功:', result)
      message.success('注册成功')
    } catch (err: any) {
      console.error('注册失败:', err)
      message.error(`注册失败: ${err?.message || '未知错误'}`)
    }
  }

  const loginForm = (
    <Form
      name="login"
      onFinish={handleLogin}
      autoComplete="off"
      size="large"
    >
      <Form.Item
        name="username"
        rules={[{ required: true, message: '请输入用户名' }]}
      >
        <Input
          prefix={<UserOutlined />}
          placeholder="用户名"
        />
      </Form.Item>

      <Form.Item
        name="password"
        rules={[{ required: true, message: '请输入密码' }]}
      >
        <Input.Password
          prefix={<LockOutlined />}
          placeholder="密码"
        />
      </Form.Item>

      <Form.Item>
        <Button
          type="primary"
          htmlType="submit"
          loading={loading}
          style={{ width: '100%' }}
        >
          登录
        </Button>
      </Form.Item>
    </Form>
  )

  const registerForm = (
    <Form
      name="register"
      onFinish={handleRegister}
      autoComplete="off"
      size="large"
    >
      <Form.Item
        name="username"
        rules={[{ required: true, message: '请输入用户名' }]}
      >
        <Input
          prefix={<UserOutlined />}
          placeholder="用户名"
        />
      </Form.Item>

      <Form.Item
        name="email"
        rules={[
          { required: true, message: '请输入邮箱' },
          { type: 'email', message: '请输入有效的邮箱地址' }
        ]}
      >
        <Input
          prefix={<MailOutlined />}
          placeholder="邮箱"
        />
      </Form.Item>

      <Form.Item
        name="password"
        rules={[
          { required: true, message: '请输入密码' },
          { min: 6, message: '密码至少6位' }
        ]}
      >
        <Input.Password
          prefix={<LockOutlined />}
          placeholder="密码"
        />
      </Form.Item>

      <Form.Item>
        <Button
          type="primary"
          htmlType="submit"
          loading={loading}
          style={{ width: '100%' }}
        >
          注册
        </Button>
      </Form.Item>
    </Form>
  )

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      padding: '20px'
    }}>
      <Card
        style={{
          width: '100%',
          maxWidth: 400,
          boxShadow: '0 8px 32px rgba(0,0,0,0.1)',
          borderRadius: '12px'
        }}
      >
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <Title level={2} style={{ color: '#007aff', marginBottom: 8 }}>
            股票投资系统
          </Title>
          <Text type="secondary">
            专业投资管理平台
          </Text>
        </div>

        {error && (
          <div style={{ 
            marginBottom: 16, 
            padding: '8px 12px', 
            background: '#fff2f0', 
            border: '1px solid #ffccc7',
            borderRadius: '6px',
            color: '#ff4d4f'
          }}>
            {error}
          </div>
        )}

        <Tabs
          activeKey={activeTab}
          onChange={setActiveTab}
          centered
          items={[
            {
              key: 'login',
              label: '登录',
              children: loginForm,
            },
            {
              key: 'register',
              label: '注册',
              children: registerForm,
            },
          ]}
        />
      </Card>
    </div>
  )
}

export default Login
