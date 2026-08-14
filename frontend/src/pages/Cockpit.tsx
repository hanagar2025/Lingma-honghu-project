// 每日投资驾驶舱
//
// 首页只有一张表。其余一切都收在折叠面板里，需要时才展开。
// 这个约束不是审美问题：一屏能看完的东西才会每天真的被看，
// 摊开成十张卡片的东西只会在第三天被跳过。
//
// 页面本身不做任何判断 —— 灯色、阈值、法定理由全部由后端给出。
// 前端若自行判断，规则就会分裂成两份，而分裂的规则等于没有规则。

import React, { useCallback, useEffect, useState } from 'react'
import {
  Alert, Button, Card, Collapse, Descriptions, Empty, message, Popover, Progress,
  Segmented, Space, Statistic, Table, Tag, Typography,
} from 'antd'
import { ReloadOutlined, InfoCircleOutlined, CheckOutlined } from '@ant-design/icons'
import { cockpitAPI, isLocked, tiosAPI } from '../services/api'
import { decryptSnapshot, type EncryptedSnapshot } from '../services/decrypt'
import FiveLayerDashboard from '../components/FiveLayerDashboard'
import TodayVerdict from '../components/TodayVerdict'
import UnlockGate from '../components/UnlockGate'

const { Title, Text, Paragraph } = Typography

const LIGHT_STYLE: Record<string, { dot: string; color: string; label: string }> = {
  GREEN: { dot: '🟢', color: 'green', label: '正常' },
  YELLOW: { dot: '🟡', color: 'orange', label: '风险升高' },
  RED: { dot: '🔴', color: 'red', label: '必须处理' },
  UNKNOWN: { dot: '⚪', color: 'default', label: '数据缺失' },
}

const TIER_STYLE: Record<string, { color: string; label: string }> = {
  ACCOUNTING: { color: 'blue', label: '账务事实·可产生动作' },
  VALIDATED: { color: 'green', label: '已样本外检验·可产生动作' },
  OBSERVATION: { color: 'default', label: '观察指标·只触发复核' },
}

const ACTION_STYLE: Record<string, { color: string; label: string }> = {
  BUY: { color: 'green', label: '买入' },
  HOLD: { color: 'blue', label: '持有' },
  REDUCE: { color: 'red', label: '减仓' },
  NONE: { color: 'default', label: '不动作' },
}

interface Metric {
  label: string
  display: string
  value: number | null
  source: string
  formula: string
  asOf: string
  tier: string
  missingReason?: string
}

/** 指标追溯气泡 —— 任何数字都能点开看它是怎么算出来的 */
const MetricTrace: React.FC<{ metrics?: Metric[] }> = ({ metrics }) => {
  if (!metrics || metrics.length === 0) return null
  return (
    <Popover
      trigger="click"
      placement="left"
      overlayStyle={{ maxWidth: 520 }}
      title="数据来源与计算过程"
      content={
        <div style={{ maxHeight: 420, overflowY: 'auto' }}>
          {metrics.map((m, i) => (
            <div key={i} style={{ marginBottom: 12, paddingBottom: 12, borderBottom: '1px solid #f0f0f0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                <Text strong>{m.label}</Text>
                <Text style={{ fontVariantNumeric: 'tabular-nums' }}>{m.display}</Text>
              </div>
              <div style={{ marginTop: 4 }}>
                <Tag color={TIER_STYLE[m.tier]?.color}>{TIER_STYLE[m.tier]?.label ?? m.tier}</Tag>
              </div>
              <div style={{ fontSize: 12, color: '#666', marginTop: 6, lineHeight: 1.7 }}>
                <div>来源：{m.source}</div>
                <div>算法：{m.formula}</div>
                <div>截至：{m.asOf}</div>
                {m.missingReason && <div style={{ color: '#ff3b30' }}>缺失原因：{m.missingReason}</div>}
              </div>
            </div>
          ))}
        </div>
      }
    >
      <Button type="link" size="small" icon={<InfoCircleOutlined />} style={{ paddingInline: 4 }}>
        追溯
      </Button>
    </Popover>
  )
}

const Light: React.FC<{ light: string }> = ({ light }) => {
  const s = LIGHT_STYLE[light] ?? LIGHT_STYLE.UNKNOWN
  return <span title={s.label} style={{ fontSize: 16 }}>{s.dot}</span>
}

/** KPI 单格。缺样本时显示"—"而非 0 —— 0 会把"没统计过"读成"表现完美" */
const KpiCell: React.FC<{
  title: string; rate: number | null; detail: string; goodAbove?: number
}> = ({ title, rate, detail, goodAbove = 0.9 }) => (
  <Card size="small" style={{ flex: 1, minWidth: 220 }}>
    <Statistic
      title={title}
      value={rate === null ? '—' : `${(rate * 100).toFixed(1)}%`}
      valueStyle={{
        color: rate === null ? '#8e8e93' : rate >= goodAbove ? '#34c759' : rate >= 0.6 ? '#ff9500' : '#ff3b30',
      }}
    />
    {rate !== null && <Progress
      percent={Math.round(rate * 100)}
      showInfo={false}
      strokeColor={rate >= goodAbove ? '#34c759' : rate >= 0.6 ? '#ff9500' : '#ff3b30'}
      size="small"
    />}
    <div style={{ fontSize: 12, color: '#666', marginTop: 4, lineHeight: 1.6 }}>{detail}</div>
  </Card>
)

const Cockpit: React.FC = () => {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [marking, setMarking] = useState<number | null>(null)
  const [session, setSession] = useState<'pre' | 'post'>('post')
  const [offline, setOffline] = useState<{ on: boolean; reason: string }>({ on: false, reason: '' })
  const [locked, setLocked] = useState<EncryptedSnapshot | null>(null)

  const load = useCallback(async (live = false, s: 'pre' | 'post' = session) => {
    setLoading(true)
    try {
      const r = await cockpitAPI.getTodayOrOffline(live, s)
      if (isLocked(r.data)) {
        setLocked(r.data.enc)
        setOffline({ on: true, reason: r.reason || '已加密的静态快照' })
      } else {
        setData(r.data)
        setOffline({ on: r.offline, reason: r.reason })
      }
      setSession(s)
    } catch (err: any) {
      message.error(err?.response?.data?.error?.message || err.message || '驾驶舱加载失败')
    } finally {
      setLoading(false)
    }
  }, [session])

  const unlock = useCallback(async (passphrase: string): Promise<string | null> => {
    if (!locked) return '没有待解密的快照'
    try {
      setData(await decryptSnapshot(locked, passphrase))
      setLocked(null)
      return null
    } catch (e: any) {
      return e?.message ?? '解密失败'
    }
  }, [locked])

  // 标记执行 —— 清偿执行债务是当前第一优先级，因此这个按钮直接放在驾驶舱里，
  // 不必跳到别的页面。执行时间由后端回填，用于 KPI E4。
  const markExecuted = useCallback(async (id: number, code: string) => {
    setMarking(id)
    try {
      await tiosAPI.updateExecution(id, { executed: true })
      message.success(`${code} 已标记执行，执行时间已记入延迟统计`)
      await load(false)
    } catch (err: any) {
      message.error(err?.response?.data?.error?.message || err.message || '标记失败')
    } finally {
      setMarking(null)
    }
  }, [load])

  useEffect(() => { load(false) }, [load])

  // 解锁界面必须在一切之前返回：不能先渲染半个驾驶舱再叠一个弹窗，
  // 那样密文之外的框架信息（会话、按钮、菜单）会先露出来，容易被误读成"已经进去了"。
  if (locked) return <UnlockGate generatedAt={locked.generatedAt} onUnlock={unlock} />

  if (!data) {
    return (
      <Card loading={loading}>
        {!loading && <Empty description="尚无驾驶舱数据">
          <Button type="primary" onClick={() => load(false)}>加载</Button>
        </Empty>}
      </Card>
    )
  }

  const answers: any[] = data.answers ?? []
  const actions: any[] = data.actions ?? []

  return (
    <div>
      {/* ── 离线快照模式：必须明说，否则会被当成实时接口数据 ── */}
      {offline.on && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message={<Text strong>离线快照模式（无数据库、无登录）</Text>}
          description={
            <div style={{ fontSize: 13, lineHeight: 1.8 }}>
              <div>{offline.reason}</div>
              <div style={{ marginTop: 4 }}>
                快照生成于 {data.offline?.generatedAt ?? '未知时间'}，数据源：{data.offline?.source ?? '未知'}。
                与命令行版、HTML 报告读的是同一份数据，结论不会互相矛盾。
              </div>
              {(data.offline?.unavailable ?? []).length > 0 && (
                <div style={{ marginTop: 6 }}>
                  本模式下拿不到（宁可显式缺失，不伪造）：
                  <ul style={{ margin: '4px 0 0', paddingLeft: 20 }}>
                    {data.offline.unavailable.map((u: string, i: number) => <li key={i}>{u}</li>)}
                  </ul>
                </div>
              )}
            </div>
          }
        />
      )}

      {/* ── 外围现金口径：需要战略层裁定，放在最上面 ── */}
      {data.externalCash && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message={
            <Text strong>
              外围现金 {(data.externalCash.amount / 10000).toFixed(0)} 万 —— 口径待战略层裁定，未计入仓位上限分母
            </Text>
          }
          description={
            <div style={{ fontSize: 13, lineHeight: 1.8 }}>
              <div>{data.externalCash.note}</div>
              <div style={{ marginTop: 4 }}>
                本页所有仓位百分比的分母是证券账户总资产
                {' '}{(data.externalCash.denominatorNow / 10000).toFixed(1)} 万；
                若并入这 {(data.externalCash.amount / 10000).toFixed(0)} 万，分母变为
                {' '}{((data.externalCash.denominatorNow + data.externalCash.amount) / 10000).toFixed(1)} 万，
                超限结论会随之改变。并入分母等于用一个记账动作消掉真实集中度风险，故未裁定期间按从严口径。
              </div>
            </div>
          }
        />
      )}

      {/* ── 能力披露：置顶且不可关闭 ── */}
      <Alert
        type="warning"
        showIcon
        style={{ marginBottom: 16 }}
        message="本系统不预测涨跌"
        description={
          <div style={{ fontSize: 13, lineHeight: 1.8 }}>
            {data.disclosure?.headline}
            <div style={{ marginTop: 8 }}>
              {(data.disclosure?.items ?? []).map((it: any, i: number) => (
                <div key={i} style={{ marginBottom: 4 }}>
                  <Tag color={TIER_STYLE[it.tier]?.color}>{TIER_STYLE[it.tier]?.label ?? it.tier}</Tag>
                  <Text strong>{it.model}</Text>
                  <Text type="secondary"> —— {it.measured}</Text>
                </div>
              ))}
            </div>
          </div>
        }
      />

      {/* ── 会话切换：盘前只看必办，盘后看完整报告 ── */}
      <Card size="small" style={{ marginBottom: 16 }}>
        <Space wrap>
          <Segmented
            value={session}
            onChange={v => load(false, v as 'pre' | 'post')}
            options={[
              { label: '盘前 09:20–09:25', value: 'pre' },
              { label: '盘后 15:10–15:30', value: 'post' },
            ]}
          />
          <Button icon={<ReloadOutlined />} onClick={() => load(false)} loading={loading}>刷新</Button>
          {/* 直连行情复跑要走后端。离线模式下给一个点了没反应的按钮，比不给更糟 */}
          {!offline.on && <Button onClick={() => load(true)} loading={loading}>直连行情复跑</Button>}
          {offline.on && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              离线模式下切换盘前/盘后与复跑均需后端；要更新快照请在 backend 目录重跑
              {' '}<Text code>WEB=1 npm run cockpit</Text>
            </Text>
          )}
        </Space>
      </Card>

      {/* ── 今日结论：结论先于依据，放在四张表之前 ── */}
      <TodayVerdict verdict={data.verdict} />

      {/* ── 五层驾驶舱：四张研究表 + 隔离的动作区 ── */}
      <FiveLayerDashboard
        dashboard={data.dashboard}
        changes={data.changes}
        discovery={data.discovery}
        provisional={data.provisional}
      />

      {/* ── 首页单表（六问汇总） ── */}
      <Card
        title={<Space><Title level={5} style={{ margin: 0 }}>六问汇总</Title><Text type="secondary">{data.date}</Text></Space>}
        style={{ marginBottom: 16 }}
      >
        <Table
          dataSource={(data.table ?? []).map((r: any, i: number) => ({ ...r, key: i }))}
          pagination={false}
          size="middle"
          columns={[
            { title: '项目', dataIndex: 'item', width: 200 },
            {
              title: '今日状态', dataIndex: 'todayStatus',
              render: (v: string, r: any) => <Space><Light light={r.light} /><Text>{v}</Text></Space>,
            },
            { title: '决策', dataIndex: 'decision', width: 300, render: (v: string) => <Text type="secondary">{v}</Text> },
          ]}
        />

        {/* ── 最下面只有一句 ── */}
        <div
          style={{
            marginTop: 20, padding: '18px 22px', borderRadius: 14,
            background: '#f2f2f7', borderLeft: '4px solid #007aff',
          }}
        >
          <Text type="secondary" style={{ fontSize: 13 }}>今日核心决策</Text>
          <div style={{ fontSize: 18, fontWeight: 600, marginTop: 6, lineHeight: 1.6 }}>
            {data.coreDecision}
          </div>
        </div>
      </Card>

      {/* ── 今日无新增建仓：显式结论 ── */}
      {data.noNewEntry?.verdict && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          message={<Text strong style={{ fontSize: 16 }}>今日无新增建仓</Text>}
          description={
            <div style={{ fontSize: 13, lineHeight: 1.9 }}>
              <div style={{ marginBottom: 6 }}>
                不为了让系统"每天有输出"而强行找一只股票买。原因逐条如下：
              </div>
              <ol style={{ margin: 0, paddingLeft: 20 }}>
                {(data.noNewEntry.reasons ?? []).map((r: string, i: number) => <li key={i}>{r}</li>)}
              </ol>
            </div>
          }
        />
      )}

      {/* ── 今日动作 ── */}
      <Card title="今日动作（只有买入 / 持有 / 减仓 / 不动作四种）" style={{ marginBottom: 16 }}>
        <Table
          dataSource={actions.map((a: any, i: number) => ({ ...a, key: i }))}
          pagination={false}
          size="small"
          columns={[
            {
              title: '标的', dataIndex: 'name', width: 130,
              render: (v: string, r: any) => <span>{v}<br /><Text type="secondary" style={{ fontSize: 12 }}>{r.code}</Text></span>,
            },
            {
              title: '动作', dataIndex: 'kind', width: 90,
              render: (v: string) => <Tag color={ACTION_STYLE[v]?.color}>{ACTION_STYLE[v]?.label ?? v}</Tag>,
            },
            {
              title: '数量', width: 130,
              render: (_: any, r: any) => (
                <Popover content={r.size?.note} title="换算过程">
                  <Text style={{ cursor: 'help' }}>{r.size?.display}</Text>
                </Popover>
              ),
            },
            {
              title: '法定理由',
              render: (_: any, r: any) => (
                <div>
                  <Tag color="blue">{data.legalReasonText?.[r.reason] ?? r.reason}</Tag>
                  <div style={{ fontSize: 12, marginTop: 4 }}>{r.reasonDetail}</div>
                </div>
              ),
            },
            {
              title: '非理由', width: 240,
              render: (_: any, r: any) =>
                (r.notReason ?? []).length === 0 ? <Text type="secondary">—</Text> : (
                  <div style={{ fontSize: 12, color: '#8e8e93' }}>
                    {r.notReason.map((n: string, i: number) => <div key={i}>· {n}</div>)}
                  </div>
                ),
            },
            {
              title: '观察项（仅复核）', width: 220,
              render: (_: any, r: any) =>
                (r.reviewTriggers ?? []).length === 0 ? <Text type="secondary">—</Text> : (
                  <Popover
                    trigger="click"
                    overlayStyle={{ maxWidth: 420 }}
                    title="触发复核的观察项 —— 不构成动作理由"
                    content={<ul style={{ margin: 0, paddingLeft: 18 }}>
                      {r.reviewTriggers.map((t: string, i: number) => <li key={i}>{t}</li>)}
                    </ul>}
                  >
                    <Tag style={{ cursor: 'pointer' }}>{r.reviewTriggers.length} 项复核</Tag>
                  </Popover>
                ),
            },
            { title: '追溯', width: 90, render: (_: any, r: any) => <MetricTrace metrics={r.metrics} /> },
          ]}
        />
      </Card>

      {/* ── 六问详情 ── */}
      <Card title="六问详情" style={{ marginBottom: 16 }}>
        <Collapse
          accordion
          items={answers.map((a: any) => ({
            key: String(a.no),
            label: (
              <Space>
                <Light light={a.light} />
                <Text strong>{['①', '②', '③', '④', '⑤', '⑥'][a.no - 1]} {a.question}</Text>
                <Text type="secondary" style={{ fontSize: 13 }}>{a.headline}</Text>
              </Space>
            ),
            children: (
              <Table
                dataSource={(a.rows ?? []).map((r: any, i: number) => ({ ...r, key: i }))}
                pagination={false}
                size="small"
                columns={[
                  { title: '项目', dataIndex: 'label', width: 200 },
                  {
                    title: '今日状态', dataIndex: 'status',
                    render: (v: string, r: any) => <Space><Light light={r.light} /><Text>{v}</Text></Space>,
                  },
                  {
                    title: '决策 / 含义', dataIndex: 'decision', width: 340,
                    render: (v: string) => <Text type="secondary" style={{ fontSize: 12 }}>{v}</Text>,
                  },
                  {
                    title: '观察项', width: 110,
                    render: (_: any, r: any) =>
                      (r.reviewTriggers ?? []).length === 0 ? <Text type="secondary">—</Text> : (
                        <Popover
                          trigger="click"
                          overlayStyle={{ maxWidth: 460 }}
                          title="观察项 —— 只触发复核，不构成动作理由"
                          content={<ul style={{ margin: 0, paddingLeft: 18 }}>
                            {r.reviewTriggers.map((t: string, i: number) => <li key={i}>{t}</li>)}
                          </ul>}
                        >
                          <Tag style={{ cursor: 'pointer' }}>{r.reviewTriggers.length}</Tag>
                        </Popover>
                      ),
                  },
                  { title: '追溯', width: 90, render: (_: any, r: any) => <MetricTrace metrics={r.metrics} /> },
                ]}
              />
            ),
          }))}
        />
      </Card>

      {/* ── 执行债务：离线拿不到明细，但条数不能不说 ── */}
      {/* null = 拿不到明细（离线），[] = 确实已清零。两者必须区分：
          把"不知道"显示成"已清零"，正好抹掉当前第一优先级的那件事。 */}
      {data.pendingSells === null && (data.pendingSellCount ?? 0) > 0 && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 16 }}
          message={<Text strong style={{ fontSize: 16 }}>
            执行债务：{data.pendingSellCount} 条未执行卖出指令（离线模式无明细）
          </Text>}
          description={
            <div style={{ fontSize: 13, lineHeight: 1.8 }}>
              这是硬闸门，未清零期间系统锁死全部新增建仓输出，不受任何评分或配置影响。
              <div style={{ marginTop: 4 }}>
                指令明细与"标记已执行"存在数据库里，需启动后端才能勾选清偿。
              </div>
            </div>
          }
        />
      )}

      {/* ── 执行债务：勾选清偿 ── */}
      {(data.pendingSells ?? []).length > 0 && (
        <Card
          title={`执行债务：${data.pendingSells.length} 条未执行卖出指令`}
          style={{ marginBottom: 16, borderColor: '#ff3b30' }}
        >
          <Alert
            type="error"
            showIcon
            style={{ marginBottom: 12 }}
            message="执行债务未清零期间，系统锁死全部新增建仓输出"
            description={
              <span>
                这是硬闸门，不受任何评分或配置影响。清偿顺序优先于一切研究结论。
                过去最大的问题不是找不到好股票，而是旧仓位没处理完就不断增加新仓位。
              </span>
            }
          />
          <Table
            dataSource={data.pendingSells.map((p: any) => ({ ...p, key: p.id }))}
            pagination={false}
            size="small"
            columns={[
              { title: '指令日期', dataIndex: 'reportDate', width: 110 },
              { title: '标的', dataIndex: 'code', width: 90 },
              { title: '触发条款', dataIndex: 'clause' },
              { title: '应执行动作', dataIndex: 'requiredAction', width: 150 },
              {
                title: '操作', width: 130,
                render: (_: any, r: any) => (
                  <Button
                    size="small" type="primary" icon={<CheckOutlined />}
                    loading={marking === r.id}
                    onClick={() => markExecuted(r.id, r.code)}
                  >
                    标记已执行
                  </Button>
                ),
              },
            ]}
          />
        </Card>
      )}

      {/* ── KPI E1–E4 ── */}
      {data.kpi && (
        <Card title="KPI（30个交易日观察期）" style={{ marginBottom: 16 }}>
          <Space style={{ width: '100%', flexWrap: 'wrap' }} align="start">
            <KpiCell title="E1 执行率" rate={data.kpi.e1?.rate ?? null} detail={data.kpi.e1?.detail ?? ''} />
            <KpiCell title="E2 数据完整度" rate={data.kpi.e2?.rate ?? null} detail={data.kpi.e2?.detail ?? ''} goodAbove={1} />
            <KpiCell
              title="E3 规则一致性"
              rate={data.kpi.e3?.complianceRate ?? null}
              detail={(data.kpi.e3?.checks ?? []).map((c: any) => `${c.passed ? '✓' : '✗'} ${c.name}`).join('；')}
              goodAbove={1}
            />
            <Card size="small" style={{ flex: 1, minWidth: 220 }}>
              <Statistic
                title="E4 决策到执行延迟"
                value={data.kpi.e4?.medianDays === null || data.kpi.e4?.medianDays === undefined
                  ? '—' : `${data.kpi.e4.medianDays} 天`}
                valueStyle={{ color: '#8e8e93' }}
              />
              <div style={{ fontSize: 12, color: '#666', marginTop: 4, lineHeight: 1.6 }}>
                {data.kpi.e4?.detail}
              </div>
            </Card>
          </Space>
          <Alert
            type="info"
            style={{ marginTop: 12 }}
            message={<Text style={{ fontSize: 13 }}>E3 方法论</Text>}
            description={<Text type="secondary" style={{ fontSize: 12 }}>{data.kpi.e3?.methodology}</Text>}
          />
          {(data.kpi.e3?.unauthorizedBuys ?? []).length > 0 && (
            <Alert
              type="error" showIcon style={{ marginTop: 12 }}
              message="检出未授权买入"
              description={
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {data.kpi.e3.unauthorizedBuys.map((u: any, i: number) => (
                    <li key={i}>{u.date} {u.name} 持仓成本 +{(u.costIncrease / 10000).toFixed(1)}万（当日处于禁止建仓状态）</li>
                  ))}
                </ul>
              }
            />
          )}
        </Card>
      )}

      {/* ── 规则冻结状态 ── */}
      {data.freeze?.baseline && (
        <Card title="规则冻结状态" style={{ marginBottom: 16 }}>
          <Paragraph type="secondary" style={{ fontSize: 13 }}>
            冻结期内不新增决策规则，只修 Bug、补数据、记录结果。
            全部决策生效参数取指纹并随每日审计存档 —— 三个月后比对指纹即可回答
            「当时的规则是不是今天这套」，不需要任何人回忆。
          </Paragraph>
          <Descriptions size="small" column={2} bordered>
            <Descriptions.Item label="冻结起始">{data.freeze.baseline.frozenAt}</Descriptions.Item>
            <Descriptions.Item label="冻结天数">{data.freeze.baseline.tradingDays} 个交易日</Descriptions.Item>
            <Descriptions.Item label="基线指纹">
              <Text code>{data.freeze.baseline.hash}</Text>
            </Descriptions.Item>
            <Descriptions.Item label="当前指纹">
              <Space>
                <Text code>{data.freeze.current?.hash}</Text>
                {data.freeze.current?.hash === data.freeze.baseline.hash
                  ? <Tag color="green">未漂移</Tag>
                  : <Tag color="red">已漂移</Tag>}
              </Space>
            </Descriptions.Item>
            <Descriptions.Item label="规则条数" span={2}>
              {data.freeze.current?.entryCount} 条｜
              {Object.entries(data.freeze.current?.tierCounts ?? {}).map(([t, n]) => (
                <Tag key={t} color={TIER_STYLE[t]?.color}>{t}={String(n)}</Tag>
              ))}
            </Descriptions.Item>
          </Descriptions>
        </Card>
      )}

      {/* ── 今日决策审计 ── */}
      {data.auditMarkdown && (
        <Card
          title="今日决策审计（已归档）"
          style={{ marginBottom: 16 }}
          extra={<Text type="secondary" style={{ fontSize: 12 }}>
            三个月后可回答「当时为什么没买、为什么没卖」，而不是凭记忆重新解释
          </Text>}
        >
          <pre style={{
            margin: 0, padding: 16, background: '#f2f2f7', borderRadius: 12,
            fontSize: 12.5, lineHeight: 1.8, whiteSpace: 'pre-wrap', wordBreak: 'break-word',
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          }}>
            {data.auditMarkdown}
          </pre>
        </Card>
      )}

      {/* ── 数据缺口 ── */}
      <Card title="数据完整性">
        <Paragraph type="secondary" style={{ fontSize: 13 }}>
          缺什么就明说缺什么。缺失项一律显示"缺失"并按必须处理对待，不用默认值替代 ——
          默认值会把一个未知项伪装成通过项。
        </Paragraph>
        <ul style={{ paddingLeft: 20, lineHeight: 2 }}>
          {(data.dataGaps ?? []).map((g: string, i: number) => <li key={i}><Text>{g}</Text></li>)}
        </ul>
        <Descriptions size="small" column={2} style={{ marginTop: 12 }}>
          <Descriptions.Item label="市场阶段">{data.marketStage}</Descriptions.Item>
          <Descriptions.Item label="PE分位可用">
            {data.valuationUsable} / {data.valuationLoaded}
          </Descriptions.Item>
          <Descriptions.Item label="K线缺失">
            {(data.missing ?? []).length === 0 ? '无' : data.missing.join('、')}
          </Descriptions.Item>
          <Descriptions.Item label="单票上限">
            {((data.limits?.singleStock ?? 0) * 100).toFixed(0)}%
          </Descriptions.Item>
        </Descriptions>
      </Card>
    </div>
  )
}

export default Cockpit
