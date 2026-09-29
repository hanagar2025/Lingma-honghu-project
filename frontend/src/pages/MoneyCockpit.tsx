import React, { useEffect, useMemo, useState } from 'react'
import { Alert, Button, ConfigProvider, Drawer, Empty, Space, Spin, Table, Tabs, Tooltip, message, theme } from 'antd'
import { LinkOutlined } from '@ant-design/icons'
import { FlowBars, Legend, LinesChart, Spark } from '../components/money/Charts'
import AlertsPanel from '../components/money/AlertsPanel'
import { CrossCheckCard, LeadLagCard, SlowMoneyCard, SlowStockBlock } from '../components/money/SlowPanels'

/**
 * 资金驾驶舱（R-01）
 *
 * 读 CLI 盘后落下的 /data/money.json（npm run money 生成），只渲染、不重算。
 * 三块：入口① 持仓、入口② 观察仓、入口③ 市场自选方向，全部以资金池变化衡量。
 * 本页是观察层：最高输出是复核顺序，没有任何操作入口。
 */

const base = import.meta.env.BASE_URL ?? '/'
const SNAPSHOT_URL = `${base}data/money.json`.replace(/([^:])\/{2,}/g, '$1/')

/** 给其他 Agent 的稳定链接：同一份已经算好的结果，开头带约束 */
function absUrl(file: string): string {
  const path = `${base}data/${file}`.replace(/\/{2,}/g, '/')
  return typeof window === 'undefined' ? path : `${window.location.origin}${path}`
}

const AgentLinks: React.FC = () => {
  const copy = async (url: string, what: string) => {
    try {
      await navigator.clipboard.writeText(url)
      message.success(`已复制${what}链接，发给其他 Agent 即可`)
    } catch {
      window.prompt('浏览器拒绝了剪贴板，请手动复制：', url)
    }
  }
  return (
    <Space size={6} wrap>
      <Tooltip title="Markdown，开头带约束，适合直接交给大模型读">
        <Button size="small" type="primary" icon={<LinkOutlined />} onClick={() => copy(absUrl('money.agent.md'), ' Agent ')}>
          复制 Agent 链接
        </Button>
      </Tooltip>
      <Tooltip title="完整 JSON，含每个对象 250 日序列，适合程序做二次计算">
        <Button size="small" onClick={() => copy(absUrl('money.json'), '完整数据')}>复制完整数据链接</Button>
      </Tooltip>
    </Space>
  )
}

type Num = number | null

const STATE_STYLE: Record<string, { bg: string; fg: string }> = {
  潜伏: { bg: '#2a3038', fg: '#9aa5b1' },
  启动: { bg: '#10375c', fg: '#58a6ff' },
  趋势: { bg: '#0f3d2a', fg: '#3fb950' },
  爆发: { bg: '#4a2c05', fg: '#f0b429' },
  高成交: { bg: '#4a3a05', fg: '#f0b429' },
  衰竭: { bg: '#4a3a05', fg: '#f0b429' },
  撤离: { bg: '#3b1236', fg: '#db61a2' },
  样本不足: { bg: '#2a3038', fg: '#6e7681' },
  数据源未接入: { bg: '#2a3038', fg: '#6e7681' },
}

const REVIEW_COLOR: Record<string, string> = {
  DIVERGENCE: '#ff7b72',
  RETREAT: '#db61a2',
  EXHAUST: '#f0b429',
  DIVERGENCE_PENDING_A2: '#f0b429',
  NEW_TRANSITION: '#58a6ff',
}

const DIVERGENCE_TEXT: Record<string, string> = {
  DIVERGENCE: '高位背离',
  DIVERGENCE_PENDING_A2: '背离待 A2 确认',
  LOW_VOLUME_RISE: '缩量上涨（可能锁仓）',
  NONE: '—',
}

const pct = (v: Num, digits = 1) => {
  if (v === null || v === undefined) return '—'
  const s = (v * 100).toFixed(digits)
  if (Number(s) === 0) return '0.0%'
  return `${v > 0 ? '+' : ''}${s}%`
}
const yi = (v: Num, digits = 1) => (v === null || v === undefined ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(digits)} 亿`)
const cls = (v: Num) => (v === null || v === undefined ? '' : v > 0 ? 'mc-up' : v < 0 ? 'mc-dn' : '')

const StateChip: React.FC<{ text: string }> = ({ text }) => {
  const key = Object.keys(STATE_STYLE).find(k => text.startsWith(k)) ?? '潜伏'
  const s = STATE_STYLE[key]!
  return <span className="mc-chip" style={{ background: s.bg, color: s.fg }}>{text}</span>
}

const CSS = `
.mc-root { background:#0d1117; color:#d7dde5; margin:-24px; padding:20px 24px 28px; min-height:100vh;
  font-family:"PingFang SC","Microsoft YaHei","WenQuanYi Micro Hei",sans-serif; font-size:13px; }
.mc-hdr { display:flex; justify-content:space-between; align-items:flex-end; margin-bottom:14px; gap:16px; flex-wrap:wrap; }
.mc-hdr h1 { margin:0; font-size:22px; color:#fff; letter-spacing:1px; }
.mc-sub { color:#8b96a5; font-size:12px; line-height:1.7; }
.mc-grid { display:grid; gap:12px; }
.mc-card { background:#161b22; border:1px solid #262d36; border-radius:8px; padding:12px 14px; min-width:0; }
.mc-card h3 { margin:0 0 8px; font-size:14px; color:#fff; display:flex; justify-content:space-between; align-items:baseline; gap:8px; }
.mc-card h3 small { color:#8b96a5; font-weight:normal; font-size:11px; }
.mc-kpi { font-size:22px; color:#fff; font-weight:700; }
.mc-note { color:#8b96a5; font-size:11px; line-height:1.7; }
.mc-chip { display:inline-block; padding:1px 8px; border-radius:10px; font-size:11px; white-space:nowrap; }
.mc-up { color:#ff7b72; } .mc-dn { color:#3fb950; }
.mc-warn { color:#ff7b72; font-weight:700; }
.mc-alert { border-left:3px solid #58a6ff; background:#121a24; padding:6px 10px; margin-bottom:6px; border-radius:4px; font-size:12px; cursor:pointer; }
.mc-foot { margin-top:14px; color:#8b96a5; font-size:11px; border-top:1px dashed #262d36; padding-top:8px; line-height:1.8; }
.mc-root .ant-table { font-size:12px; }
.mc-root .ant-table-row { cursor:pointer; }
.mc-kv td { padding:4px 6px; border-bottom:1px solid #1f252d; }
.mc-kv td:first-child { color:#8b96a5; white-space:nowrap; }
`

const MoneyCockpit: React.FC = () => {
  const [data, setData] = useState<any>(null)
  const [err, setErr] = useState<string | null>(null)
  const [detail, setDetail] = useState<any>(null)
  const [tab, setTab] = useState('1')

  useEffect(() => {
    fetch(SNAPSHOT_URL, { cache: 'no-store' })
      .then(async r => {
        if (!r.ok || !(r.headers.get('content-type') ?? '').includes('json')) throw new Error('not found')
        setData(await r.json())
      })
      .catch(() => setErr(`未找到资金驾驶舱快照（${SNAPSHOT_URL}）。先在 backend 目录跑一次 npm run money 生成它。`))
  }, [])

  const byId = useMemo(() => {
    const m = new Map<string, any>()
    for (const e of data?.entries ?? []) for (const o of e.objects) m.set(o.id, o)
    return m
  }, [data])

  // ?detail=stock:300308 直接打开某张资金卡，便于分享
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('detail')
    if (id && byId.has(id)) setDetail(byId.get(id))
  }, [byId])

  if (err) return <div className="mc-root"><style>{CSS}</style><Alert type="warning" message={err} /></div>
  if (!data) return <div className="mc-root" style={{ display: 'grid', placeItems: 'center' }}><style>{CSS}</style><Spin /></div>

  const e1 = data.entries[0]
  const e2 = data.entries[1]
  const e3 = data.entries[2]
  const mk = data.market
  const nt = data.nationalTeam
  const es = data.entryShares
  const colors = ['#58a6ff', '#3fb950', '#f0b429']

  const columns = (entry: number) => [
    {
      title: entry === 3 ? '方向（申万二级）' : '对象', dataIndex: 'name', width: entry === 3 ? 130 : 150,
      render: (v: string, r: any) => (
        <span>{v}{r.kind === 'BASKET' && <span className="mc-note">　篮子</span>}</span>
      ),
    },
    { title: '资金状态', dataIndex: 'stateText', width: 130, render: (v: string) => <StateChip text={v} /> },
    {
      title: <Tooltip title="20 日平均成交额 / 250 日水位对应的 20 日平均成交额（亿元/日）。成交额没有方向，不是资金流入">20日均成交额 / 水位</Tooltip>,
      width: 130, align: 'right' as const,
      render: (_: unknown, r: any) => (
        <span>{r.level20Yi === null ? '—' : r.level20Yi.toFixed(1)}<span className="mc-note"> / {r.base20Yi === null ? '—' : r.base20Yi.toFixed(1)} 亿</span></span>
      ),
    },
    {
      title: <Tooltip title="= 20日均成交额 − 水位，原始精度计算，展示各自取整">日均超额</Tooltip>,
      dataIndex: 'excessDailyYi', width: 100, align: 'right' as const,
      render: (v: Num) => <span className={cls(v)}>{yi(v)}</span>,
    },
    {
      title: <Tooltip title="当前状态已持续的交易日数 / 此前同一状态最长的一段">状态天数</Tooltip>, width: 80, align: 'right' as const,
      render: (_: unknown, r: any) => <span>{r.stateDays ?? '—'}<span className="mc-note"> / {r.stateLongestDays ?? '—'}</span></span>,
    },
    {
      title: <Tooltip title="5 日份额连续高于自身水位的天数 / 此前最长的一段。与状态无关；当前 ≥ 此前最长（标红）= 创纪录">高于水位连续</Tooltip>, width: 100, align: 'right' as const,
      render: (_: unknown, r: any) => {
        const record = r.maxPersistBefore >= 10 && r.persist >= r.maxPersistBefore
        return <span className={record ? 'mc-warn' : ''}>{r.persist ?? '—'} / {r.maxPersistBefore ?? '—'}</span>
      },
    },
    { title: '5 日偏离', dataIndex: 'dev5', width: 80, align: 'right' as const, render: (v: Num) => <span className={cls(v)}>{pct(v)}</span> },
    { title: '20 日涨幅', dataIndex: 'ret20', width: 80, align: 'right' as const, render: (v: Num) => <span className={cls(v)}>{pct(v)}</span> },
    {
      title: '背离', dataIndex: 'divergence', width: 120,
      render: (v: string | null) => (v && v !== 'NONE'
        ? <span style={{ color: v === 'DIVERGENCE' ? '#ff7b72' : '#f0b429' }}>{DIVERGENCE_TEXT[v]}</span> : <span className="mc-note">—</span>),
    },
    entry === 3
      ? {
        title: '份额前三', dataIndex: 'leaders',
        render: (ls: any[]) => <span className="mc-note">{(ls ?? []).map(l => `${l.name} ${(l.share20 * 100).toFixed(0)}%`).join(' · ')}</span>,
      }
      : { title: '在册', dataIndex: 'standing', width: 110, render: (v: string | null) => <span className="mc-note">{v ?? '—'}</span> },
  ]

  return (
    <ConfigProvider theme={{ algorithm: theme.darkAlgorithm, token: { colorBgContainer: '#161b22', colorBorderSecondary: '#262d36' } }}>
      <div className="mc-root">
        <style>{CSS}</style>
        <div className="mc-hdr">
          <div>
            <h1>鸿鹄 · 资金驾驶舱</h1>
            <div className="mc-sub">
              截至 {data.asOf}　|　{data.dataMode === 'LIVE' ? '真实数据' : data.dataMode === 'FIXTURE' ? '合成数据（示意）' : '数据源未接入'}
              　|　{data.provenance.map((p: any) => `${p.kind} ${p.status === 'OK' ? '✓' : p.status === 'PENDING' ? '⏳' : '✗'}`).join('　')}
            </div>
          </div>
          <div className="mc-sub" style={{ textAlign: 'right' }}>
            <div style={{ marginBottom: 6 }}><AgentLinks /></div>
            口径：申万 2021 二级为行业骨架 · 主线篮子为分析刀 · 主力净流入等估算数据不入判定<br />
            阈值 {data.thresholds.status === 'FROZEN' ? '已冻结' : data.thresholds.status}（登记于 {data.thresholds.registeredOn}）· 生成于 {new Date(data.generatedAt).toLocaleString('zh-CN')}
          </div>
        </div>

        {data.crossCheck && <div style={{ marginBottom: 12 }}><CrossCheckCard c={data.crossCheck} /></div>}

        {data.alerts && <AlertsPanel alerts={data.alerts} />}

        {/* 背景层 */}
        <div className="mc-grid" style={{ gridTemplateColumns: '1.3fr 1fr 1fr 1.2fr' }}>
          <div className="mc-card">
            <h3>市场总水位 <small>两市成交额 5 日均值 vs 250 日水位</small></h3>
            {mk ? (
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <div>
                  <div className="mc-kpi">{mk.latestYi ? `${(mk.latestYi / 1e4).toFixed(2)} 万亿` : '—'}</div>
                  <div className="mc-note">偏离水位 <span className={cls(mk.deviation)}>{pct(mk.deviation)}</span>
                    {mk.daysAbove > 0 ? ` · 高于水位第 ${mk.daysAbove} 日` : ' · 低于水位'}</div>
                </div>
                <Spark data={mk.amount5Yi} baseline={mk.baselineYi} color="#58a6ff" width={230} />
              </div>
            ) : <Empty />}
            <div className="mc-note">水位高只说明交换规模大，本身没有方向</div>
          </div>
          <div className="mc-card">
            <h3>国家队温度计 <small>{nt.withHistory}/{nt.etfs.length} 只宽基 ETF 有份额历史</small></h3>
            {nt.flowYi?.length ? <FlowBars data={nt.flowYi} width={300} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="份额历史积累中" />}
            <div className="mc-note">近 10 日净申赎 <span className={cls(nt.net10Yi)}>{yi(nt.net10Yi)}</span>
              {nt.lastDay ? ` · 最近一日 ${nt.lastDay === 'RESCUE' ? '托底' : nt.lastDay === 'COOL' ? '降温' : '常态'}` : ''}
              　红=申购（托底）绿=赎回（降温）。背景层，不是主线信号</div>
          </div>
          <div className="mc-card">
            <h3>杠杆资金 <small>全市场融资余额</small></h3>
            {mk ? (
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <div>
                  <div className="mc-kpi">{(() => { const v = [...mk.marginYi].reverse().find((x: Num) => x !== null); return v ? `${(v / 1e4).toFixed(2)} 万亿` : '—' })()}</div>
                  <div className="mc-note">20 日 <span className={cls(mk.marginDelta20Yi)}>{yi(mk.marginDelta20Yi, 0)}</span></div>
                </div>
                <Spark data={mk.marginYi} color="#db61a2" width={150} />
              </div>
            ) : <Empty />}
            <div className="mc-note">融资余额 T+1 约 08:30 发布</div>
          </div>
          <div className="mc-card">
            <h3>复核顺序 <small>按类别排，不打分</small></h3>
            {data.reviewQueue.length === 0 && <div className="mc-note">今日没有需要优先复核的对象。</div>}
            {data.reviewQueue.slice(0, 6).map((r: any) => (
              <div key={r.id} className="mc-alert" style={{ borderLeftColor: REVIEW_COLOR[r.reviewClass] ?? '#58a6ff' }}
                onClick={() => setDetail(byId.get(r.id))}>
                <b>{r.name}</b>　{r.text}<span className="mc-note">　入口{['', '①', '②', '③'][r.entry]}</span>
              </div>
            ))}
            {data.reviewQueue.length > 6 && <div className="mc-note">另有 {data.reviewQueue.length - 6} 项，见下方各入口</div>}
          </div>
        </div>

        {data.slow && <div style={{ marginTop: 12 }}><SlowMoneyCard s={data.slow} /></div>}

        {/* 三入口份额迁移 */}
        <div className="mc-grid" style={{ gridTemplateColumns: '2.3fr 1fr', marginTop: 12 }}>
          <div className="mc-card">
            <h3>三个资金入口 · 份额迁移 <small>各入口 20 日成交额占两市比例 · 近 250 日 · 虚线为各自 250 日水位</small></h3>
            {es ? (
              <>
                <Legend items={es.lines.map((l: any, i: number) => ({ color: colors[i]!, label: l.label + (l.entry === 3 && es.entry3Members.length ? `（${es.entry3Members.join('、')}）` : '') }))} />
                <LinesChart dates={es.dates} width={1000} height={240}
                  lines={es.lines.map((l: any, i: number) => ({ data: l.s20, color: colors[i]!, width: 2.2, label: l.label }))}
                  refs={es.lines.map((l: any, i: number) => ({ value: l.baseline, color: colors[i]! }))} />
                <div className="mc-note">读法：一个入口份额从高位回落、另一个入口越过自身水位 —— 这种一出一进持续 10 日以上，才叫主线迁移。只出不进叫退潮，只进不出叫扩散。入口③ 取当前资金流入最强的 5 个行业。</div>
              </>
            ) : <Empty />}
          </div>
          <div className="mc-card">
            <h3>成交额份额迁移 <small>一出一进持续 10 日 · 不是净资金流向</small></h3>
            {data.migrations.length === 0
              ? <div className="mc-note">当前没有满足条件的份额迁移。</div>
              : data.migrations.slice(0, 8).map((m: any, i: number) => (
                <div key={i} className="mc-alert" style={{ borderLeftColor: m.confirmation === 'CONFIRMED' ? '#ff7b72' : m.confirmation === 'CONFLICT' ? '#8b96a5' : '#f0b429', cursor: 'default' }}>
                  {m.from} → <b>{m.to}</b>　{m.days} 日　<span className="mc-note">{({ CONFIRMED: '两端融资方向一致', CONFLICT: '融资方向矛盾', INFERRED: '仅份额推断' } as Record<string, string>)[m.confirmation]}
                    （出端 {yi(m.fromA2Yi)}，进端 {yi(m.toA2Yi)}）</span>
                </div>
              ))}
            <h3 style={{ marginTop: 12 }}>入口③ 资金正在积累的方向 <small>前 5</small></h3>
            {[...e3.objects].filter((o: any) => (o.excessDailyYi ?? 0) > 0 && ['启动', '趋势', '爆发'].some(k => o.stateText.startsWith(k)))
              .sort((a: any, b: any) => (b.excessDailyYi ?? 0) - (a.excessDailyYi ?? 0)).slice(0, 5).map((o: any) => (
              <div key={o.id} className="mc-alert" onClick={() => setDetail(o)}>
                <b>{o.name}</b>　<StateChip text={o.stateText} />　<span className="mc-up">日均 {yi(o.excessDailyYi)}</span>
                <div className="mc-note">{o.leaders.map((l: any) => l.name).join(' · ')}</div>
              </div>
            ))}
          </div>
        </div>

        {/* 三个入口明细 */}
        <div className="mc-card" style={{ marginTop: 12 }}>
          <Tabs activeKey={tab} onChange={setTab} items={[
            { key: '1', label: `入口① 持仓 · ${e1.objects.length}`, children: <><div className="mc-note" style={{ marginBottom: 6 }}>{e1.note}。点击任一行看资金卡</div><Table size="small" rowKey="id" pagination={false} dataSource={e1.objects} columns={columns(1)} onRow={r => ({ onClick: () => setDetail(r) })} /></> },
            { key: '2', label: `入口② 观察仓 · ${e2.objects.length}`, children: <><div className="mc-note" style={{ marginBottom: 6 }}>{e2.note}</div><Table size="small" rowKey="id" pagination={false} dataSource={e2.objects} columns={columns(2)} onRow={r => ({ onClick: () => setDetail(r) })} /></> },
            { key: '3', label: `入口③ 市场自选 · ${e3.objects.length}`, children: <><div className="mc-note" style={{ marginBottom: 6 }}>{e3.note}。不在册股票只显示、不进候选</div><Table size="small" rowKey="id" pagination={{ pageSize: 20, size: 'small' }} dataSource={e3.objects} columns={columns(3)} onRow={r => ({ onClick: () => setDetail(r) })} /></> },
          ]} />
        </div>

        {data.leadlag && <div style={{ marginTop: 12 }}><LeadLagCard l={data.leadlag} /></div>}

        {(data.calibration || data.shadow) && (
          <div className="mc-grid" style={{ gridTemplateColumns: '1.35fr 1fr', marginTop: 12 }}>
            {data.calibration && <CalibrationCard c={data.calibration} />}
            {data.shadow && <ShadowCard s={data.shadow} />}
          </div>
        )}

        {data.dataNotes?.length > 0 && (
          <div className="mc-card" style={{ marginTop: 12 }}>
            <h3>数据说明</h3>
            {data.dataNotes.map((x: string, i: number) => <div key={i} className="mc-note">· {x}</div>)}
          </div>
        )}

        <div className="mc-foot">
          本页是观察层（OBSERVATION）：状态跃迁只决定"先复核谁"，不产生买卖指令。资金规则须经影子运行、样本外检验并由委员会冻结后，才可能进入法定理由。
          {data.doesNotImply.map((x: string) => `　· ${x}`).join('')}
        </div>

        <Drawer open={!!detail} onClose={() => setDetail(null)} width={1120} title={detail ? `资金卡 · ${detail.name}` : ''}
          styles={{ body: { background: '#0d1117', padding: 16 }, header: { background: '#161b22' } }}>
          {detail && <DetailCard o={detail} slow={data.slow} />}
        </Drawer>
      </div>
    </ConfigProvider>
  )
}

const VERDICT_STYLE: Record<string, { text: string; color: string }> = {
  INSUFFICIENT_SAMPLE: { text: '样本不足', color: '#8b96a5' },
  SUPPORTS: { text: '支持预期', color: '#3fb950' },
  CONTRADICTS: { text: '与预期相反', color: '#ff7b72' },
  NO_EFFECT: { text: '无显著效果', color: '#f0b429' },
}

const RULE_TEXT: Record<string, string> = {
  START: '启动', TREND: '趋势', BURST: '爆发', EXHAUST: '高成交·价格停滞', RETREAT: '撤离', FAILED_START: '启动失败', DIVERGENCE: '高位背离',
}

const CalibrationCard: React.FC<{ c: any }> = ({ c }) => {
  const rows = (c.outOfSample ?? []).filter((r: any) => r.horizon === 20)
  const r60 = new Map((c.outOfSample ?? []).filter((r: any) => r.horizon === 60).map((r: any) => [r.rule, r]))
  return (
    <div className="mc-card">
      <h3>校准与样本外检验 <small>一次性 · {c.runOn} · 阈值指纹 {c.thresholdsHash}</small></h3>
      <div className="mc-note" style={{ marginBottom: 6 }}>
        样本内 {c.split.inSample[0]} ~ {c.split.inSample[1]}：只检查信号卫生，不拿收益调参 ——
        {c.decision === 'CONFIRMED_NO_CHANGE' ? '预登记初值全部通过，原样确认并冻结' : '有未通过项'}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 }}>
        {c.hygiene.map((h: any) => (
          <Tooltip key={h.id} title={h.text}>
            <span className="mc-chip" style={{ background: h.pass ? '#0f3d2a' : '#4b1d1d', color: h.pass ? '#3fb950' : '#ff7b72' }}>
              {h.pass ? '✓' : '✗'} {h.id}
            </span>
          </Tooltip>
        ))}
      </div>
      <div className="mc-note" style={{ marginBottom: 4 }}>
        样本外 {c.split.outOfSample[0]} ~ {c.split.outOfSample[1]}：触发后相对两市基准的超额收益，95% 置信区间按交易日分组抽样
      </div>
      <table className="mc-kv" style={{ width: '100%', fontSize: 12 }}>
        <tbody>
          <tr style={{ color: '#8b96a5' }}><td>规则（预期）</td><td>触发</td><td>20 日均值</td><td>20 日区间</td><td>结论</td><td>60 日结论</td></tr>
          {rows.map((r: any) => {
            const v = VERDICT_STYLE[r.verdict]!
            const s60: any = r60.get(r.rule)
            const v60 = s60 ? VERDICT_STYLE[s60.verdict]! : null
            return (
              <tr key={r.rule}>
                <td>{RULE_TEXT[r.rule]}<span className="mc-note">　{r.hypothesis.split('→')[1]?.trim()}</span></td>
                <td>{r.n}</td>
                <td className={cls(r.mean)}>{pct(r.mean, 2)}</td>
                <td className="mc-note">{r.ci ? `[${pct(r.ci[0], 2)}, ${pct(r.ci[1], 2)}]` : '—'}</td>
                <td style={{ color: v.color }}>{v.text}</td>
                <td style={{ color: v60?.color }}>{v60?.text ?? '—'}{s60 ? <span className="mc-note">（{pct(s60.mean, 1)}）</span> : null}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <div className="mc-note" style={{ marginTop: 6 }}>{c.note}</div>
    </div>
  )
}

const ShadowCard: React.FC<{ s: any }> = ({ s }) => (
  <div className="mc-card">
    <h3>影子运行台账 <small>自 {s.startedOn} 起 · 累计 {s.total} 条</small></h3>
    <div className="mc-note" style={{ marginBottom: 6 }}>阈值冻结后每日记录状态跃迁，到期回填第 20 / 60 日结果；只增不改。每条规则攒够 30 次触发才交委员会裁定。</div>
    <table className="mc-kv" style={{ width: '100%', fontSize: 12 }}>
      <tbody>
        <tr style={{ color: '#8b96a5' }}><td>规则</td><td>触发</td><td>已到期 20 日</td><td>20 日均值</td><td>距 30 次</td></tr>
        {s.rows.map((r: any) => (
          <tr key={r.rule}>
            <td>{RULE_TEXT[r.rule]}</td>
            <td>{r.count}</td>
            <td>{r.filled20}</td>
            <td className={cls(r.mean20)}>{pct(r.mean20, 2)}</td>
            <td className="mc-note">{r.toVerdict === 0 ? '可裁定' : `还差 ${r.toVerdict}`}</td>
          </tr>
        ))}
      </tbody>
    </table>
    {s.latest?.length > 0 && (
      <>
        <h3 style={{ marginTop: 10 }}>最近记录</h3>
        {s.latest.slice(0, 8).map((e: any) => (
          <div key={e.key} className="mc-note">
            {e.date}　{e.entry ? `入口${['', '①', '②', '③'][e.entry]}` : ''} <b style={{ color: '#d7dde5' }}>{e.name}</b>　{RULE_TEXT[e.rule]}
          </div>
        ))}
      </>
    )}
  </div>
)

const DetailCard: React.FC<{ o: any; slow?: any }> = ({ o, slow }) => {
  const s = o.series
  const slowStock = o.kind === 'STOCK' ? slow?.stocks?.find((x: any) => x.code === o.codes?.[0] || `stock:${x.code}` === o.id) : null
  const div = o.divergence as string | null
  const lastOf = (xs: Num[] | undefined) => (xs ? [...xs].reverse().find(v => v !== null) ?? null : null)
  return (
    <div style={{ color: '#d7dde5' }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
        <StateChip text={o.stateText} />
        {o.stateSince && <span className="mc-note">自 {o.stateSince} 起</span>}
        {o.standing && <span className="mc-note">· {o.standing}</span>}
        {div && div !== 'NONE' && <span className="mc-chip" style={{ background: '#4b1d1d', color: '#ff7b72' }}>{DIVERGENCE_TEXT[div]}</span>}
      </div>
      <div className="mc-grid" style={{ gridTemplateColumns: '2.2fr 1fr' }}>
        <div className="mc-card">
          <h3>资金波形图 <small>近 250 日 · 同一时间轴：水位带 / 成交额份额 / 价格</small></h3>
          {s ? (
            <>
              <Legend items={[
                { color: '#3a4452', label: '水位带（25%–75% 分位）', band: true },
                { color: '#8b96a5', label: '水位（中位数）', dash: true },
                { color: '#58a6ff', label: '份额 20 日' },
                { color: '#f0b429', label: '份额 5 日' },
                { color: '#ff7b72', label: o.kind === 'STOCK' ? '股价（右轴）' : '等权指数（右轴）' },
              ]} />
              <LinesChart dates={s.dates} width={720} height={280}
                band={{ lo: s.q25.map((v: Num) => (v === null ? null : v * 100)), hi: s.q75.map((v: Num) => (v === null ? null : v * 100)) }}
                lines={[
                  { data: s.median.map((v: Num) => (v === null ? null : v * 100)), color: '#8b96a5', width: 1, dash: '5 4', label: '水位' },
                  { data: s.s20.map((v: Num) => (v === null ? null : v * 100)), color: '#58a6ff', width: 2.4, label: '20日' },
                  { data: s.s5.map((v: Num) => (v === null ? null : v * 100)), color: '#f0b429', width: 1.2, label: '5日' },
                ]}
                right={{ data: s.close, color: '#ff7b72', label: '价格' }} />
              <h3 style={{ marginTop: 10 }}>成交额 <small>20 日平均成交额 vs 水位（亿元/日）· 融资余额（亿元，右轴）</small></h3>
              <Legend items={[
                { color: '#3fb950', label: '20日均成交额' },
                { color: '#8b96a5', label: '水位', dash: true },
                { color: '#db61a2', label: '融资余额（右轴）' },
              ]} />
              <LinesChart dates={s.dates} width={720} height={150} unit=""
                lines={[
                  { data: s.level20Yi, color: '#3fb950', width: 2, label: '20日均成交额' },
                  { data: s.base20Yi, color: '#8b96a5', width: 1, dash: '5 4', label: '水位' },
                ]}
                right={{ data: s.margin, color: '#db61a2', label: '融资' }} />
            </>
          ) : <Empty description="该对象未生成图表序列" />}
          {o.leaders?.length > 0 && (
            <>
              <h3 style={{ marginTop: 10 }}>内部份额排名 <small>核心股是否在切换 · 20 日成交额占比</small></h3>
              <table className="mc-kv" style={{ width: '100%', fontSize: 12 }}>
                <tbody>
                  <tr><td>份额前三</td><td>{o.leaders.map((l: any) => `${l.name} ${(l.share20 * 100).toFixed(1)}%（${l.change20 === null ? '—' : `${l.change20 > 0 ? '+' : ''}${(l.change20 * 100).toFixed(1)}pt`}）· ${l.standing}`).join('　')}</td></tr>
                  <tr><td>上升最快</td><td>{o.risers.length ? o.risers.map((l: any) => `${l.name} +${(l.change20 * 100).toFixed(1)}pt · ${l.standing}`).join('　') : '—'}</td></tr>
                </tbody>
              </table>
            </>
          )}
        </div>
        <div className="mc-grid" style={{ gap: 12, alignContent: 'start' }}>
          <div className="mc-card">
            <h3>成交额四问 <small>成交额没有方向</small></h3>
            <table className="mc-kv" style={{ width: '100%' }}>
              <tbody>
                <tr><td>水位（20日均成交额）</td><td>{o.base20Yi === null ? '—' : `${o.base20Yi.toFixed(1)} 亿/日`}<span className="mc-note">　份额中位数 {s ? `${((lastOf(s.median) ?? 0) * 100).toFixed(3)}%` : '—'}</span></td></tr>
                <tr><td>20日均成交额</td><td>{o.level20Yi === null ? '—' : `${o.level20Yi.toFixed(1)} 亿/日`}</td></tr>
                <tr><td>状态天数</td><td>{o.stateDays ?? '—'} 日（自 {o.stateSince ?? '—'}）/ 此前同状态最长 {o.stateLongestDays ?? '—'} 日</td></tr>
                <tr><td>高于水位连续</td><td>{o.persist ?? '—'} 日 / 此前最长 {o.maxPersistBefore ?? '—'} 日<span className="mc-note">　与状态无关</span></td></tr>
                <tr><td>近 20 日日均超额</td><td className={cls(o.excessDailyYi)}>{yi(o.excessDailyYi)}</td></tr>
                <tr><td>5 / 20 日偏离</td><td>{pct(o.dev5)} / {pct(o.dev20)}</td></tr>
                <tr><td>对应价格</td><td className={cls(o.ret20)}>20 日 {pct(o.ret20)}</td></tr>
              </tbody>
            </table>
          </div>
          <div className="mc-card">
            <h3>资金目的 · 方向性数据 <small>近 10 日</small></h3>
            <table className="mc-kv" style={{ width: '100%' }}>
              <tbody>
                <tr><td>融资余额变化（杠杆）</td><td className={cls(o.a2.marginDelta10Yi)}>{yi(o.a2.marginDelta10Yi, 2)}</td></tr>
                <tr><td>主题 ETF 净申赎（配置）</td><td className={cls(o.a2.etfNet10Yi)}>{yi(o.a2.etfNet10Yi, 2)}</td></tr>
                <tr><td>龙虎榜机构净买（机构）</td><td className={cls(o.a2.instNet10Yi)}>{yi(o.a2.instNet10Yi, 2)}</td></tr>
              </tbody>
            </table>
            <div className="mc-note">"—" 表示没有观察到（未上榜、无对应 ETF 或未发布），不是 0</div>
          </div>
          {slowStock && <SlowStockBlock x={slowStock} evidence={slow?.evidence} />}
          <div className="mc-card">
            <h3>背离判定 <small>四项全满足才成立</small></h3>
            <div style={{ marginBottom: 6 }}>
              {div && div !== 'NONE' ? <b style={{ color: div === 'DIVERGENCE' ? '#ff7b72' : '#f0b429' }}>{DIVERGENCE_TEXT[div]}</b> : '未成立'}
            </div>
            {o.divergenceChecks && ([
              ['① 堆积处于自身历史高位', o.divergenceChecks.poolHigh],
              ['② 5 日份额连续 5 日低于 20 日份额', o.divergenceChecks.shareFading],
              ['③ 方向性流出（融资降 / ETF 赎回 / 机构卖）', o.divergenceChecks.directionalOutflow],
              ['④ 价格仍在上涨、接近 60 日高点', o.divergenceChecks.priceHolding],
            ] as [string, boolean | null][]).map(([t, v]) => (
              <div key={t} className="mc-note" style={{ color: v === true ? '#ff7b72' : undefined }}>
                {v === true ? '✓' : v === null ? '？' : '·'} {t}{v === null ? '（数据缺失）' : ''}
              </div>
            ))}
            <div className="mc-note" style={{ marginTop: 6 }}>缺方向性确认（融资下降、ETF 赎回或机构净卖出）时只记"缩量上涨"或"待 A2 确认"，不升为背离。</div>
          </div>
          <div className="mc-card" style={{ borderColor: '#5a2a2a' }}>
            <h3>系统输出 <small>观察层 · 不是指令</small></h3>
            <div className="mc-alert" style={{ borderLeftColor: REVIEW_COLOR[o.reviewClass] ?? '#5b6573', cursor: 'default' }}>
              复核类别：{({ DIVERGENCE: '高位背离，最高优先', RETREAT: '资金撤离', EXHAUST: '高成交·价格停滞（不是卖出信号）', DIVERGENCE_PENDING_A2: '背离待 A2 确认', NEW_TRANSITION: '近 5 日状态跃迁', WATCH: '常规观察' } as Record<string, string>)[o.reviewClass]}
            </div>
            <div className="mc-note">法定理由以每日驾驶舱第⑤问为准。本卡不发令；若委员会裁定退出，按"债务执行窗口"分批执行。</div>
          </div>
        </div>
      </div>
    </div>
  )
}

export default MoneyCockpit
