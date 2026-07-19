import React, { useCallback, useEffect, useState } from 'react'
import {
  Alert, Button, Card, Col, Divider, Empty, InputNumber, message, Popover, Row,
  Space, Statistic, Switch, Table, Tag, Typography,
} from 'antd'
import { PlayCircleOutlined, ReloadOutlined, SaveOutlined, ThunderboltOutlined } from '@ant-design/icons'
import { tiosAPI } from '../services/api'

const { Title, Text, Paragraph } = Typography

const STAGE_TEXT: Record<string, { label: string; color: string }> = {
  uptrend: { label: '上升期（仓位上限80%）', color: 'green' },
  range: { label: '震荡期（仓位上限60%）', color: 'orange' },
  downtrend: { label: '下跌期（仓位上限40%·禁止买入）', color: 'red' },
}

const ACTION_TEXT: Record<string, string> = {
  EXIT_ALL: '全部退出',
  REDUCE_TO_40: '减至原仓位40%以下',
  REDUCE_30: '减仓30%',
  REDUCE_20: '减仓20%',
}

const FREEZE_TEXT: Record<string, string> = {
  STAGE_DOWNTREND: '下跌期冻结',
  STOCK_CAP_12: '单股超12%上限',
  SECTOR_CAP_30: '板块超30%上限',
  THEME_CAP_45: '主题超45%上限',
  CASH_FLOOR_10: '现金低于10%红线',
  BAN_LIST: '禁买名单',
  SELLING_IN_PROGRESS: '卖出条款执行中',
  NO_STOP_FALL: '止跌三要素未达成',
  RR_TOO_LOW: '赔率不足',
}

const DailyReport: React.FC = () => {
  const [report, setReport] = useState<any>(null)
  const [running, setRunning] = useState(false)
  const [account, setAccount] = useState<{ cash: number; peakAssets: number; stageIndexCode?: string }>({ cash: 0, peakAssets: 0 })
  const [accountDraft, setAccountDraft] = useState<{ cash: number; peakAssets: number }>({ cash: 0, peakAssets: 0 })
  const [ruleCards, setRuleCards] = useState<any[]>([])
  const [executions, setExecutions] = useState<any[]>([])
  const [stats, setStats] = useState<{ total: number; done: number; rate: number }>({ total: 0, done: 0, rate: 1 })

  const loadAll = useCallback(async () => {
    try {
      const [r, acc, cards, execs, st] = await Promise.all([
        tiosAPI.getLatestReport(),
        tiosAPI.getAccount(),
        tiosAPI.getRuleCards(),
        tiosAPI.getExecutions(),
        tiosAPI.getExecutionStats(),
      ])
      setReport(r)
      setAccount(acc)
      setAccountDraft({ cash: acc.cash, peakAssets: acc.peakAssets })
      setRuleCards(cards)
      setExecutions(execs)
      setStats(st)
    } catch (err: any) {
      message.error(`加载失败: ${err?.response?.data?.error?.message || err.message}`)
    }
  }, [])

  useEffect(() => { loadAll() }, [loadAll])

  const handleRun = async () => {
    setRunning(true)
    try {
      const result = await tiosAPI.run()
      setReport(result.report)
      const failed = (result.synced || []).filter((s: any) => s.error)
      if (failed.length > 0) {
        message.warning(`部分行情同步失败: ${failed.map((f: any) => f.code).join('、')}`)
      } else {
        message.success('已同步真实K线并生成盘前四问')
      }
      await loadAll()
    } catch (err: any) {
      message.error(`运行失败: ${err?.response?.data?.error?.message || err.message}`)
    } finally {
      setRunning(false)
    }
  }

  const handleSaveAccount = async () => {
    try {
      await tiosAPI.updateAccount(accountDraft)
      message.success('账户状态已保存')
      await loadAll()
    } catch (err: any) {
      message.error(`保存失败: ${err?.response?.data?.error?.message || err.message}`)
    }
  }

  const handleToggleExecution = async (record: any, executed: boolean) => {
    try {
      await tiosAPI.updateExecution(record.id, { executed })
      setExecutions(prev => prev.map(e => (e.id === record.id ? { ...e, executed: executed ? 1 : 0 } : e)))
      const st = await tiosAPI.getExecutionStats()
      setStats(st)
    } catch (err: any) {
      message.error(`更新失败: ${err.message}`)
    }
  }

  const handleToggleBan = async (card: any, banBuy: boolean) => {
    try {
      await tiosAPI.updateRuleCard(card.code, { banBuy })
      setRuleCards(prev => prev.map(c => (c.code === card.code ? { ...c, banBuy } : c)))
      message.success(`${card.code} 已${banBuy ? '加入' : '移出'}禁买名单`)
    } catch (err: any) {
      message.error(`更新失败: ${err.message}`)
    }
  }

  const stage = report?.stage
  const stageInfo = stage ? STAGE_TEXT[stage.confirmed] : null

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <Title level={2} style={{ margin: 0 }}>
          <ThunderboltOutlined style={{ marginRight: 8, color: '#007aff' }} />
          盘前四问
        </Title>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={loadAll}>刷新</Button>
          <Button type="primary" icon={<PlayCircleOutlined />} loading={running} onClick={handleRun}>
            同步行情并生成今日决策
          </Button>
        </Space>
      </div>

      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="铁律：所有决策由规则引擎在盘前生成，盘中不改规则、不做临时决定。卖出条款优先级最高。"
      />

      {/* 账户状态与执行率 */}
      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} md={12}>
          <Card title="账户状态（组合熔断的判定基准）" size="small">
            <Space wrap>
              <span>
                现金：
                <InputNumber
                  value={accountDraft.cash}
                  min={0}
                  step={10000}
                  style={{ width: 150 }}
                  onChange={v => setAccountDraft(d => ({ ...d, cash: Number(v) || 0 }))}
                />
              </span>
              <span>
                净值高点：
                <InputNumber
                  value={accountDraft.peakAssets}
                  min={0}
                  step={10000}
                  style={{ width: 150 }}
                  onChange={v => setAccountDraft(d => ({ ...d, peakAssets: Number(v) || 0 }))}
                />
              </span>
              <Button size="small" icon={<SaveOutlined />} onClick={handleSaveAccount}>保存</Button>
            </Space>
            <div style={{ marginTop: 8 }}>
              <Text type="secondary">阶段判定基准指数：{account.stageIndexCode || 'sh000688'}（科创50，可用环境变量 TIOS_INDEX_CODE 更换）</Text>
            </div>
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic title="铁律执行率" value={stats.rate * 100} precision={0} suffix="%" 
              valueStyle={{ color: stats.rate >= 0.95 ? '#34c759' : '#ff3b30' }} />
            <Text type="secondary">{stats.done}/{stats.total} 条卖出指令已执行</Text>
          </Card>
        </Col>
        <Col xs={12} md={6}>
          <Card size="small">
            <Statistic title="组合回撤" 
              value={report ? report.portfolioCircuit.drawdownPct * 100 : 0} precision={1} suffix="%" 
              valueStyle={{ color: report && report.portfolioCircuit.sellOnly ? '#ff3b30' : '#1d1d1f' }} />
            <Text type="secondary">{report?.portfolioCircuit?.detail || '尚未生成报告'}</Text>
          </Card>
        </Col>
      </Row>

      {!report ? (
        <Card>
          <Empty description="还没有决策报告。请先在「持仓管理」录入持仓，然后点击右上角按钮生成。" />
        </Card>
      ) : (
        <>
          {/* 阶段与结论 */}
          <Card style={{ marginBottom: 16 }}>
            <Space align="center" wrap>
              <Text strong style={{ fontSize: 16 }}>{report.date}</Text>
              {stageInfo && <Tag color={stageInfo.color} style={{ fontSize: 14, padding: '2px 10px' }}>{stageInfo.label}</Tag>}
              <Text type="secondary">{stage?.detail}</Text>
            </Space>
            <Divider style={{ margin: '12px 0' }} />
            <Paragraph strong style={{ fontSize: 16, marginBottom: 0 }}>
              今日结论：{report.conclusion}
            </Paragraph>
          </Card>

          <Row gutter={[16, 16]}>
            {/* 问2：卖出（优先级最高，放最前） */}
            <Col xs={24} lg={12}>
              <Card title={`问2 · 今天必须卖出什么？（${report.sells.length}）`} size="small"
                styles={{ header: { background: report.sells.length > 0 ? '#fff1f0' : undefined } }}>
                {report.sells.length === 0 ? <Empty description="无卖出触发" image={Empty.PRESENTED_IMAGE_SIMPLE} /> : (
                  <Table
                    size="small" rowKey={(r: any) => `${r.code}-${r.clause}`} pagination={false}
                    dataSource={report.sells}
                    columns={[
                      { title: '股票', render: (r: any) => `${r.name}(${r.code})` },
                      { title: '触发条款', dataIndex: 'clause', render: (v: string) => <Tag color="red">{v}</Tag> },
                      { title: '动作', dataIndex: 'action', render: (v: string) => <Text strong type="danger">{ACTION_TEXT[v] || v}</Text> },
                      { title: '依据', dataIndex: 'detail', ellipsis: true, render: (v: string) => <Popover content={v}><span>{v}</span></Popover> },
                    ]}
                  />
                )}
              </Card>
            </Col>

            {/* 问1：买入 */}
            <Col xs={24} lg={12}>
              <Card title={`问1 · 今天允许买入什么？（${report.buys.length}）`} size="small">
                {report.buys.length === 0 ? <Empty description="无买入解锁（默认状态就是不买）" image={Empty.PRESENTED_IMAGE_SIMPLE} /> : (
                  <Table
                    size="small" rowKey="code" pagination={false}
                    dataSource={report.buys}
                    columns={[
                      { title: '代码', dataIndex: 'code' },
                      { title: '闸门', dataIndex: 'detail', ellipsis: true },
                    ]}
                  />
                )}
                <Alert type="warning" showIcon style={{ marginTop: 8 }}
                  message="买入解锁≠必须买。仍需星级价格资格 + RR≥3 + 调仓三问，缺一不可。" />
              </Card>
            </Col>

            {/* 问3：持有 */}
            <Col xs={24} lg={12}>
              <Card title={`问3 · 继续持有什么？（${report.holds.length}）`} size="small">
                {report.holds.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} /> : (
                  <Space wrap>{report.holds.map((h: string) => <Tag key={h} color="blue">{h}</Tag>)}</Space>
                )}
              </Card>
            </Col>

            {/* 问4：禁止 */}
            <Col xs={24} lg={12}>
              <Card title={`问4 · 今天禁止做什么？（${report.banned.length}）`} size="small">
                {report.banned.length === 0 ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} /> : (
                  <Table
                    size="small" rowKey="code" pagination={false}
                    dataSource={report.banned}
                    columns={[
                      { title: '代码', dataIndex: 'code' },
                      {
                        title: '冻结原因', dataIndex: 'reasons',
                        render: (reasons: string[]) => <Space wrap>{reasons.map(r => <Tag key={r} color="volcano">{FREEZE_TEXT[r] || r}</Tag>)}</Space>,
                      },
                    ]}
                  />
                )}
              </Card>
            </Col>
          </Row>
        </>
      )}

      {/* 执行记录（闭环反馈） */}
      <Card title="卖出指令执行记录（盘后回填，统计铁律执行率）" size="small" style={{ marginTop: 16 }}>
        <Table
          size="small" rowKey="id" pagination={{ pageSize: 8 }}
          dataSource={executions}
          columns={[
            { title: '日期', dataIndex: 'reportDate' },
            { title: '代码', dataIndex: 'stockCode' },
            { title: '条款', dataIndex: 'clause', render: (v: string) => <Tag>{v}</Tag> },
            { title: '应执行', dataIndex: 'requiredAction', render: (v: string) => ACTION_TEXT[v] || v },
            {
              title: '已执行', dataIndex: 'executed',
              render: (v: number, record: any) => (
                <Switch checked={v === 1} size="small" onChange={checked => handleToggleExecution(record, checked)} />
              ),
            },
          ]}
        />
      </Card>

      {/* 规则卡 */}
      <Card title="个股规则卡（一股一卡：硬止损25% / 单日熔断12% / 禁买名单）" size="small" style={{ marginTop: 16 }}>
        <Table
          size="small" rowKey="code" pagination={false}
          dataSource={ruleCards}
          columns={[
            { title: '代码', dataIndex: 'code' },
            { title: '硬止损', dataIndex: 'hardStopPct', render: (v: number) => `${(v * 100).toFixed(0)}%` },
            { title: '单日熔断', dataIndex: 'crashPct', render: (v: number) => `${(v * 100).toFixed(0)}%` },
            {
              title: '禁买', dataIndex: 'banBuy',
              render: (v: boolean, record: any) => (
                <Switch checked={v} size="small" onChange={checked => handleToggleBan(record, checked)} />
              ),
            },
            { title: '待补执行熔断', dataIndex: 'pendingCrashExecutions' },
          ]}
        />
      </Card>
    </div>
  )
}

export default DailyReport
