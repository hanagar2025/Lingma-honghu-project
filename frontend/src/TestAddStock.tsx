import React, { useState } from 'react'
import { Button, Input, message } from 'antd'
import axios from 'axios'

const TestAddStock: React.FC = () => {
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<any>(null)

  const testAddStock = async () => {
    setLoading(true)
    setResult(null)
    
    try {
      // 先登录
      const loginRes = await axios.post('http://localhost:3000/api/auth/login', {
        username: 'test',
        password: '123456'
      })
      
      const token = loginRes.data.data.token
      console.log('登录成功，token:', token)
      
      // 添加股票
      const addRes = await axios.post(
        'http://localhost:3000/api/portfolio/positions',
        {
          stockCode: '000001',
          stockName: '平安银行',
          quantity: 1000,
          costPrice: 10.50,
          currentPrice: 11.20,
          category: 'left'
        },
        {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        }
      )
      
      console.log('添加成功:', addRes.data)
      setResult(addRes.data)
      message.success('添加成功！')
    } catch (error: any) {
      console.error('添加失败:', error)
      setResult(error.response?.data || error.message)
      message.error('添加失败: ' + (error.response?.data?.message || error.message))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ padding: '20px' }}>
      <h2>测试添加股票</h2>
      <Button type="primary" onClick={testAddStock} loading={loading}>
        测试添加股票
      </Button>
      
      {result && (
        <div style={{ marginTop: '20px', padding: '10px', background: '#f5f5f5' }}>
          <h3>结果:</h3>
          <pre>{JSON.stringify(result, null, 2)}</pre>
        </div>
      )}
    </div>
  )
}

export default TestAddStock

