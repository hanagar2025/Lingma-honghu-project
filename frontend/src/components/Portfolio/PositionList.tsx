import React from 'react'
import { Table, Tag, Space, Button } from 'antd'
import { EditOutlined, DeleteOutlined } from '@ant-design/icons'
import { Position } from '../../store/slices/portfolioSlice'

interface PositionListProps {
  positions: Position[]
  onEdit?: (position: Position) => void
  onDelete?: (id: string) => void
}

const PositionList: React.FC<PositionListProps> = ({ positions, onEdit, onDelete }) => {
  const getCategoryColor = (category: string) => {
    switch (category) {
      case 'left':
        return 'blue'
      case 'right':
        return 'green'
      case 'defensive':
        return 'orange'
      case 'observation':
        return 'purple'
      default:
        return 'default'
    }
  }

  const getCategoryName = (category: string) => {
    switch (category) {
      case 'left':
        return '左侧'
      case 'right':
        return '右侧'
      case 'defensive':
        return '防御'
      case 'observation':
        return '观察'
      default:
        return '未知'
    }
  }

  const columns = [
    {
      title: '股票代码',
      dataIndex: 'stockCode',
      key: 'stockCode',
      width: 100,
    },
    {
      title: '股票名称',
      dataIndex: 'stockName',
      key: 'stockName',
      width: 120,
    },
    {
      title: '持仓数量',
      dataIndex: 'quantity',
      key: 'quantity',
      width: 100,
      render: (value: number) => value.toLocaleString(),
    },
    {
      title: '成本价',
      dataIndex: 'costPrice',
      key: 'costPrice',
      width: 100,
      render: (value: number) => `¥${Number(value || 0).toFixed(2)}`,
    },
    {
      title: '现价',
      dataIndex: 'currentPrice',
      key: 'currentPrice',
      width: 100,
      render: (value: number) => `¥${Number(value || 0).toFixed(2)}`,
    },
    {
      title: '市值',
      dataIndex: 'marketValue',
      key: 'marketValue',
      width: 120,
      render: (value: number) => `¥${value.toLocaleString()}`,
    },
    {
      title: '盈亏',
      key: 'profitLoss',
      width: 120,
      render: (_: any, record: Position) => (
        <div>
          <div style={{ 
            color: record.profitLoss >= 0 ? '#52c41a' : '#ff4d4f',
            fontWeight: 'bold'
          }}>
            ¥{Number(record.profitLoss || 0).toLocaleString()}
          </div>
          <div style={{ 
            color: record.profitLossRate >= 0 ? '#52c41a' : '#ff4d4f',
            fontSize: '12px'
          }}>
            {record.profitLossRate >= 0 ? '+' : ''}{Number(record.profitLossRate || 0).toFixed(2)}%
          </div>
        </div>
      ),
    },
    {
      title: '仓位占比',
      dataIndex: 'positionRatio',
      key: 'positionRatio',
      width: 100,
      render: (value: number) => `${Number(value || 0).toFixed(2)}%`,
    },
    {
      title: '分类',
      dataIndex: 'category',
      key: 'category',
      width: 100,
      render: (category: string) => (
        <Tag color={getCategoryColor(category)}>
          {getCategoryName(category)}
        </Tag>
      ),
    },
    {
      title: '操作',
      key: 'action',
      width: 120,
      render: (_: any, record: Position) => (
        <Space size="small">
          <Button
            type="link"
            icon={<EditOutlined />}
            onClick={() => onEdit?.(record)}
            size="small"
          />
          <Button
            type="link"
            danger
            icon={<DeleteOutlined />}
            onClick={() => onDelete?.(record.id)}
            size="small"
          />
        </Space>
      ),
    },
  ]

  return (
    <Table
      columns={columns}
      dataSource={positions}
      rowKey="id"
      pagination={{
        pageSize: 10,
        showSizeChanger: true,
        showQuickJumper: true,
        showTotal: (total) => `共 ${total} 条记录`,
      }}
      scroll={{ x: 1000 }}
    />
  )
}

export default PositionList
