import React, { useEffect, useState } from 'react'
import { Card, Button, Space, Modal, Form, Input, InputNumber, Select, message, Typography, Row, Col, Statistic, Tabs, Tag, Alert } from 'antd'
import { PlusOutlined, UploadOutlined, WalletOutlined, RiseOutlined, FallOutlined, LineChartOutlined, RightCircleOutlined, LeftCircleOutlined, BulbOutlined } from '@ant-design/icons'
import { useAppDispatch, useAppSelector } from '../hooks/redux'
import { fetchPositions, addPosition, updatePosition, deletePosition, clearError } from '../store/slices/portfolioSlice'
import { Position } from '../store/slices/portfolioSlice'
import PositionList from '../components/Portfolio/PositionList'
import { marketAPI } from '../services/api'

const { Option } = Select
const { Title } = Typography

const Portfolio: React.FC = () => {
  const dispatch = useAppDispatch()
  const { positions, loading, error } = useAppSelector(state => state.portfolio)
  const [isModalVisible, setIsModalVisible] = useState(false)
  const [editingPosition, setEditingPosition] = useState<Position | null>(null)
  const [form] = Form.useForm()

  useEffect(() => {
    dispatch(fetchPositions())
  }, [dispatch])

  // 显示错误信息
  useEffect(() => {
    if (error) {
      message.error(error)
      dispatch(clearError())
    }
  }, [error, dispatch])

  // 计算统计信息 - 确保返回数字
  const totalValue = positions.reduce((sum, pos) => {
    const price = Number(pos.currentPrice) || 0
    const qty = Number(pos.quantity) || 0
    return sum + (price * qty)
  }, 0)
  const totalProfitLoss = positions.reduce((sum, pos) => sum + (Number(pos.profitLoss) || 0), 0)
  const avgProfitRate = positions.length > 0 
    ? positions.reduce((sum, pos) => sum + (Number(pos.profitLossRate) || 0), 0) / positions.length 
    : 0

  const handleAdd = () => {
    setEditingPosition(null)
    form.resetFields()
    setIsModalVisible(true)
  }

  const handleEdit = (position: Position) => {
    setEditingPosition(position)
    form.setFieldsValue(position)
    setIsModalVisible(true)
  }

  const handleDelete = async (id: string) => {
    try {
      await dispatch(deletePosition(id)).unwrap()
      message.success('删除成功')
    } catch (error) {
      message.error('删除失败')
    }
  }

  const handleSubmit = async (values: any) => {
    try {
      if (editingPosition) {
        await dispatch(updatePosition({ id: editingPosition.id, data: values })).unwrap()
        message.success('更新成功')
      } else {
        console.log('提交数据:', values)
        const result = await dispatch(addPosition(values)).unwrap()
        console.log('添加成功，返回数据:', result)
        message.success('添加成功')
      }
      setIsModalVisible(false)
      form.resetFields()
    } catch (error: any) {
      console.error('添加失败，错误详情:', error)
      message.error(editingPosition ? '更新失败' : `添加失败: ${error?.message || '未知错误'}`)
    }
  }

  const handleImport = () => {
    message.info('导入功能开发中')
  }

  // 当股票代码改变时，自动获取股票信息
  const handleStockCodeChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const stockCode = e.target.value.trim()
    
    if (stockCode && stockCode.length >= 6) {
      try {
        console.log('查询股票信息:', stockCode)
        const response = await marketAPI.getStockQuotes([stockCode])
        console.log('股票信息返回:', response)
        
        if (response && response.length > 0) {
          const stock = response[0]
          // 自动填充股票名称和现价
          form.setFieldsValue({
            stockName: stock.name,
            currentPrice: stock.price
          })
          message.success(`已获取: ${stock.name} 现价: ¥${stock.price.toFixed(2)}`)
        }
      } catch (error) {
        console.error('获取股票信息失败:', error)
        // 不显示错误，避免干扰用户输入
      }
    }
  }

  // 当股票名称改变时，自动搜索并填充代码和现价
  const handleStockNameChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const stockName = e.target.value.trim()
    
    if (stockName && stockName.length >= 2) {
      try {
        console.log('搜索股票:', stockName)
        const response = await marketAPI.searchStockByName(stockName)
        console.log('搜索结果:', response)
        
        if (response && response.length > 0) {
          const stock = response[0]
          // 自动填充股票代码和现价
          form.setFieldsValue({
            stockCode: stock.code,
            currentPrice: stock.price
          })
          message.success(`已找到: ${stock.code} ${stock.name} 现价: ¥${stock.price.toFixed(2)}`)
        }
      } catch (error) {
        console.error('搜索股票失败:', error)
        // 不显示错误，避免干扰用户输入
      }
    }
  }

  return (
    <div>
      <div style={{ 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'space-between',
        marginBottom: 24 
      }}>
        <Title level={2} style={{ margin: 0 }}>
          <WalletOutlined style={{ marginRight: 8, color: '#007aff' }} />
          持仓管理
        </Title>
        <Space>
          <Button icon={<UploadOutlined />} onClick={handleImport}>
            导入持仓
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>
            添加持仓
          </Button>
        </Space>
      </div>

      {/* 统计卡片 */}
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={24} sm={8}>
          <Card style={{ borderRadius: 18 }}>
            <Statistic
              title="总市值"
              value={Number(totalValue) || 0}
              precision={2}
              prefix={<RiseOutlined style={{ color: '#007aff' }} />}
              valueStyle={{ color: '#1d1d1f', fontSize: 20, fontWeight: 600 }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card style={{ borderRadius: 18 }}>
            <Statistic
              title="总盈亏"
              value={Number(totalProfitLoss) || 0}
              precision={2}
              prefix={totalProfitLoss >= 0 ? 
                <RiseOutlined style={{ color: '#34c759' }} /> : 
                <FallOutlined style={{ color: '#ff3b30' }} />
              }
              valueStyle={{ 
                color: totalProfitLoss >= 0 ? '#34c759' : '#ff3b30',
                fontSize: 20, 
                fontWeight: 600 
              }}
            />
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card style={{ borderRadius: 18 }}>
            <Statistic
              title="平均盈亏率"
              value={Number(avgProfitRate) || 0}
              precision={2}
              suffix="%"
              valueStyle={{ 
                color: avgProfitRate >= 0 ? '#34c759' : '#ff3b30',
                fontSize: 20, 
                fontWeight: 600 
              }}
            />
          </Card>
        </Col>
      </Row>

      {/* 仓位说明 */}
      <Alert
        message="仓位管理策略"
        description={
          <div>
            <p><strong>主仓（主线组合）</strong>：机器人+半导体+资源防御+核心港股科技（长期配置，核心持仓）</p>
            <p><strong>右仓（补充仓位）</strong>：主线持仓补充个股，组合结构加强、增加新火力（中期持有）</p>
            <p><strong>左仓（方向仓位）</strong>：数据推荐最新方向，如红利轮转、政策窗口期、核心股已调整到合理价格区（短期布局）</p>
          </div>
        }
        type="info"
        showIcon
        style={{ marginBottom: 24 }}
      />

      {/* 按仓位分类展示 */}
      <Tabs
        defaultActiveKey="mainline"
        items={[
          {
            key: 'mainline',
            label: (
              <span>
                <LineChartOutlined style={{ marginRight: 4 }} />
                主仓（主线）
              </span>
            ),
            children: (
              <Card>
                <Alert
                  type="info"
                  message="主仓组合结构"
                  description="核心持仓：机器人+半导体+资源防御+核心港股科技。通过配置不同类型标的（进攻型、防御型、平衡型）形成攻防兼备的组合结构。"
                  style={{ marginBottom: 16 }}
                />
                <PositionList
                  positions={positions.filter(p => p.category === 'mainline')}
                  onEdit={handleEdit}
                  onDelete={handleDelete}
                />
              </Card>
            )
          },
          {
            key: 'right',
            label: (
              <span>
                <RightCircleOutlined style={{ marginRight: 4 }} />
                右仓（补充）
              </span>
            ),
            children: (
              <Card>
                <Alert
                  type="success"
                  message="右仓定位"
                  description="主线持仓补充个股，组合结构加强、增加新火力。可以是产业链延伸、主题补充、个股强化。"
                  style={{ marginBottom: 16 }}
                />
                <PositionList
                  positions={positions.filter(p => p.category === 'right')}
                  onEdit={handleEdit}
                  onDelete={handleDelete}
                />
              </Card>
            )
          },
          {
            key: 'left',
            label: (
              <span>
                <LeftCircleOutlined style={{ marginRight: 4 }} />
                左仓（方向）
              </span>
            ),
            children: (
              <Card>
                <Alert
                  type="warning"
                  message="左仓定位"
                  description="数据推荐最新方向：红利轮转、政策窗口期、核心股已调整到合理价格区。轻仓试错，快速响应市场变化。"
                  style={{ marginBottom: 16 }}
                />
                <PositionList
                  positions={positions.filter(p => p.category === 'left')}
                  onEdit={handleEdit}
                  onDelete={handleDelete}
                />
                <div style={{ marginTop: 16 }}>
                  <Button type="primary" icon={<BulbOutlined />} onClick={() => {
                    window.location.href = '/smart-recommendation'
                  }}>
                    获取AI推荐最新方向
                  </Button>
                </div>
              </Card>
            )
          },
          {
            key: 'all',
            label: '全部持仓',
            children: (
              <Card>
                <PositionList
                  positions={positions}
                  onEdit={handleEdit}
                  onDelete={handleDelete}
                />
              </Card>
            )
          }
        ]}
      />

      {/* 添加/编辑模态框 */}
      <Modal
        title={editingPosition ? '编辑持仓' : '添加持仓'}
        open={isModalVisible}
        onCancel={() => {
          setIsModalVisible(false)
          form.resetFields()
        }}
        onOk={() => form.submit()}
        confirmLoading={loading}
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={handleSubmit}
        >
          <Form.Item
            name="stockCode"
            label="股票代码"
            rules={[{ required: true, message: '请输入股票代码' }]}
          >
            <Input 
              placeholder="如：000001" 
              onChange={handleStockCodeChange}
              onBlur={handleStockCodeChange}
            />
          </Form.Item>

          <Form.Item
            name="stockName"
            label="股票名称"
            rules={[{ required: true, message: '请输入股票名称' }]}
          >
            <Input 
              placeholder="如：兆易创新" 
              onChange={handleStockNameChange}
              onBlur={handleStockNameChange}
            />
          </Form.Item>

          <Form.Item
            name="quantity"
            label="持仓数量"
            rules={[{ required: true, message: '请输入持仓数量' }]}
          >
            <InputNumber
              style={{ width: '100%' }}
              placeholder="如：1000"
              min={1}
            />
          </Form.Item>

          <Form.Item
            name="costPrice"
            label="成本价"
            rules={[{ required: true, message: '请输入成本价' }]}
          >
            <InputNumber
              style={{ width: '100%' }}
              placeholder="如：10.50"
              min={0}
              precision={2}
            />
          </Form.Item>

          <Form.Item
            name="currentPrice"
            label="当前价"
            rules={[{ required: true, message: '请输入当前价' }]}
          >
            <InputNumber
              style={{ width: '100%' }}
              placeholder="如：11.20"
              min={0}
              precision={2}
            />
          </Form.Item>

          <Form.Item
            name="category"
            label="仓位分类"
            rules={[{ required: true, message: '请选择仓位分类' }]}
          >
            <Select placeholder="请选择仓位分类">
              <Option value="mainline">主仓（主线）</Option>
              <Option value="right">右仓（补充）</Option>
              <Option value="left">左仓（方向）</Option>
            </Select>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

export default Portfolio
