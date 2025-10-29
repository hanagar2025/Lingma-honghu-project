import React, { useState } from 'react'
import { Card, Typography, Form, Switch, InputNumber, Button, message, Tabs } from 'antd'
import { useAppDispatch, useAppSelector } from '../hooks/redux'
import SystemMonitor from '../components/System/SystemMonitor'
import { systemAPI } from '../services/api'

const { Title } = Typography

const Settings: React.FC = () => {
  const dispatch = useAppDispatch()
  const { user } = useAppSelector(state => state.auth)
  const [activeTab, setActiveTab] = useState('personal')

  const handleSubmit = (values: any) => {
    // TODO: 实现设置保存
    message.success('设置已保存')
  }

  const handleFeedbackSubmit = async (values: any) => {
    try {
      await systemAPI.submitFeedback(values)
      message.success('反馈提交成功')
    } catch (error) {
      message.error('反馈提交失败')
    }
  }

  return (
    <div>
      <Title level={2} style={{ marginBottom: 24 }}>
        系统设置
      </Title>

      <Card>
        <Tabs 
          activeKey={activeTab} 
          onChange={setActiveTab}
          items={[
            {
              key: 'personal',
              label: '个人设置',
              children: (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '16px' }}>
                    <Card title="通知设置">
                      <Form
                        layout="vertical"
                        onFinish={handleSubmit}
                        initialValues={{
                          priceAlert: true,
                          technicalAlert: true,
                          reportEmail: true,
                          reportSms: false,
                        }}
                      >
                        <Form.Item
                          name="priceAlert"
                          label="价格提醒"
                          valuePropName="checked"
                        >
                          <Switch />
                        </Form.Item>

                        <Form.Item
                          name="technicalAlert"
                          label="技术信号提醒"
                          valuePropName="checked"
                        >
                          <Switch />
                        </Form.Item>

                        <Form.Item
                          name="reportEmail"
                          label="报表邮件推送"
                          valuePropName="checked"
                        >
                          <Switch />
                        </Form.Item>

                        <Form.Item
                          name="reportSms"
                          label="报表短信推送"
                          valuePropName="checked"
                        >
                          <Switch />
                        </Form.Item>

                        <Form.Item>
                          <Button type="primary" htmlType="submit">
                            保存设置
                          </Button>
                        </Form.Item>
                      </Form>
                    </Card>

                    <Card title="风险控制">
                      <Form
                        layout="vertical"
                        onFinish={handleSubmit}
                        initialValues={{
                          maxPositionRatio: 10,
                          stopLossRatio: 5,
                          takeProfitRatio: 20,
                        }}
                      >
                        <Form.Item
                          name="maxPositionRatio"
                          label="单只股票最大仓位比例(%)"
                        >
                          <InputNumber
                            style={{ width: '100%' }}
                            min={1}
                            max={50}
                            precision={1}
                          />
                        </Form.Item>

                        <Form.Item
                          name="stopLossRatio"
                          label="止损比例(%)"
                        >
                          <InputNumber
                            style={{ width: '100%' }}
                            min={1}
                            max={20}
                            precision={1}
                          />
                        </Form.Item>

                        <Form.Item
                          name="takeProfitRatio"
                          label="止盈比例(%)"
                        >
                          <InputNumber
                            style={{ width: '100%' }}
                            min={5}
                            max={100}
                            precision={1}
                          />
                        </Form.Item>

                        <Form.Item>
                          <Button type="primary" htmlType="submit">
                            保存设置
                          </Button>
                        </Form.Item>
                      </Form>
                    </Card>
                  </div>

                  <Card title="账户信息" style={{ marginTop: 16 }}>
                    <div style={{ padding: '16px 0' }}>
                      <p><strong>用户名：</strong>{user?.username}</p>
                      <p><strong>邮箱：</strong>{user?.email}</p>
                      <p><strong>注册时间：</strong>2024-01-01</p>
                      <p><strong>最后登录：</strong>2024-01-15 10:30</p>
                    </div>
                  </Card>
                </>
              )
            },
            {
              key: 'monitor',
              label: '系统监控',
              children: <SystemMonitor />
            },
            {
              key: 'feedback',
              label: '用户反馈',
              children: (
            <Card title="问题反馈">
              <Form
                layout="vertical"
                onFinish={handleFeedbackSubmit}
                initialValues={{
                  type: 'improvement',
                  category: 'ui',
                  priority: 'medium',
                  rating: 5
                }}
              >
                <Form.Item
                  name="type"
                  label="反馈类型"
                  rules={[{ required: true, message: '请选择反馈类型' }]}
                >
                  <select style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #d9d9d9' }}>
                    <option value="bug">Bug报告</option>
                    <option value="feature">功能建议</option>
                    <option value="improvement">改进建议</option>
                    <option value="complaint">投诉</option>
                    <option value="praise">表扬</option>
                  </select>
                </Form.Item>

                <Form.Item
                  name="category"
                  label="问题分类"
                  rules={[{ required: true, message: '请选择问题分类' }]}
                >
                  <select style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #d9d9d9' }}>
                    <option value="ui">界面问题</option>
                    <option value="performance">性能问题</option>
                    <option value="functionality">功能问题</option>
                    <option value="data">数据问题</option>
                    <option value="other">其他</option>
                  </select>
                </Form.Item>

                <Form.Item
                  name="title"
                  label="问题标题"
                  rules={[{ required: true, message: '请输入问题标题' }]}
                >
                  <input 
                    style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #d9d9d9' }}
                    placeholder="请简要描述问题"
                  />
                </Form.Item>

                <Form.Item
                  name="description"
                  label="详细描述"
                  rules={[{ required: true, message: '请输入详细描述' }]}
                >
                  <textarea 
                    style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #d9d9d9', minHeight: '100px' }}
                    placeholder="请详细描述问题或建议"
                  />
                </Form.Item>

                <Form.Item
                  name="priority"
                  label="优先级"
                >
                  <select style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #d9d9d9' }}>
                    <option value="low">低</option>
                    <option value="medium">中</option>
                    <option value="high">高</option>
                    <option value="critical">紧急</option>
                  </select>
                </Form.Item>

                <Form.Item
                  name="rating"
                  label="满意度评分 (1-5分)"
                >
                  <InputNumber
                    style={{ width: '100%' }}
                    min={1}
                    max={5}
                    precision={0}
                  />
                </Form.Item>

                <Form.Item>
                  <Button type="primary" htmlType="submit">
                    提交反馈
                  </Button>
                </Form.Item>
              </Form>
            </Card>
              )
            }
          ]}
        />
      </Card>
    </div>
  )
}

export default Settings
