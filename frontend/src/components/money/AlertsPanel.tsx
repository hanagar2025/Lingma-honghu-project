import React, { useState } from 'react'
import { Modal, Tooltip } from 'antd'
import { LinesChart, Legend } from './Charts'

/**
 * 今日提醒。每张卡只说三件事：机会还是风险 + 量级、一句话数字、持续第几天。
 * 点"查看累计"看 5 / 10 / 20 / 60 日累计表、累计曲线与这条提醒的历史。
 * 只渲染后端算好的结果，不重算，不提供任何操作入口。
 */

type Num = number | null

const LEVEL = { 1: '关注', 2: '警示', 3: '重大' } as Record<number, string>
const CAT = { RISK: '风险', OPP: '机会', NOTE: '注意', DATA: '数据' } as Record<string, string>
const EVENT = { NEW: '新增', UP: '升级', DOWN: '降级', CONTINUE: '持续', RESOLVED: '解除' } as Record<string, string>

const STYLE: Record<string, Record<number, { border: string; bg: string; fg: string }>> = {
  RISK: { 1: { border: '#f0b429', bg: '#3d3208', fg: '#f0b429' }, 2: { border: '#fa8c16', bg: '#4a2c05', fg: '#ffa940' }, 3: { border: '#ff4d4f', bg: '#4b1d1d', fg: '#ff7b72' } },
  OPP: { 1: { border: '#2ea043', bg: '#0f2e1f', fg: '#7ee787' }, 2: { border: '#3fb950', bg: '#0f3d2a', fg: '#7ee787' }, 3: { border: '#3fb950', bg: '#0f3d2a', fg: '#3fb950' } },
  NOTE: { 1: { border: '#58a6ff', bg: '#10375c', fg: '#58a6ff' }, 2: { border: '#58a6ff', bg: '#10375c', fg: '#58a6ff' }, 3: { border: '#58a6ff', bg: '#10375c', fg: '#58a6ff' } },
  DATA: { 1: { border: '#8b96a5', bg: '#2a3038', fg: '#d7dde5' }, 2: { border: '#8b96a5', bg: '#2a3038', fg: '#d7dde5' }, 3: { border: '#8b96a5', bg: '#2a3038', fg: '#d7dde5' } },
}

const CSS = `
.al-card { display:grid; grid-template-columns: 96px 1fr 76px; gap:10px; align-items:start; padding:9px 10px;
  border-radius:6px; margin-bottom:8px; background:#11161d; border-left:4px solid; }
.al-tag { font-size:12px; font-weight:700; padding:2px 6px; border-radius:4px; text-align:center; }
.al-t { font-size:14px; color:#fff; line-height:1.5; }
.al-d { color:#aab4c0; font-size:12px; margin-top:3px; line-height:1.6; }
.al-ev { font-size:11px; color:#8b96a5; margin-top:2px; }
.al-day { text-align:right; color:#8b96a5; font-size:11px; line-height:1.6; }
.al-day b { color:#fff; font-size:13px; }
.al-link { color:#58a6ff; cursor:pointer; font-size:11px; }
.al-mini { font-size:12px; color:#c9d1d9; padding:4px 0; border-bottom:1px dashed #262d36; cursor:pointer; }
.al-kv td, .al-kv th { padding:5px 6px; border-bottom:1px solid #1f252d; text-align:left; font-size:12px; }
.al-kv th { color:#8b96a5; font-weight:normal; }
`

const pct = (v: Num, d = 1) => (v === null || v === undefined ? '—' : `${v > 0 ? '+' : ''}${(v * 100).toFixed(d)}%`)
const yi = (v: Num, d = 1) => (v === null || v === undefined ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(d)} 亿`)
const cls = (v: Num) => (v === null || v === undefined ? '' : v > 0 ? 'mc-up' : v < 0 ? 'mc-dn' : '')

const Card: React.FC<{ c: any; onOpen: (c: any) => void }> = ({ c, onOpen }) => {
  const s = STYLE[c.category]![c.level]!
  return (
    <div className="al-card" style={{ borderLeftColor: s.border }}>
      <div className="al-tag" style={{ background: s.bg, color: s.fg }}>{CAT[c.category]} · {LEVEL[c.level]}</div>
      <div>
        <div className="al-t"><b>{c.name}</b>　{c.title}</div>
        <div className="al-d">{c.detail}</div>
        <div className="al-ev">
          证据：{c.evidence}
          {c.tags?.length > 0 && <>　|　另：{c.tags.map((x: any) => x.text).join('、')}</>}
        </div>
      </div>
      <div className="al-day">
        第 <b>{c.days}</b> 天<br />{EVENT[c.event]}<br />
        <span className="al-link" onClick={() => onOpen(c)}>查看累计 ›</span>
      </div>
    </div>
  )
}

const Column: React.FC<{ title: string; sub: string; cards: any[]; onOpen: (c: any) => void; empty: string }> = ({ title, sub, cards, onOpen, empty }) => {
  const shown = cards.filter(c => c.expanded)
  const rest = cards.filter(c => !c.expanded)
  return (
    <div className="mc-card">
      <h3>{title} <small>{sub}</small></h3>
      {!cards.length && <div className="mc-note">{empty}</div>}
      {shown.map(c => <Card key={c.objectId} c={c} onOpen={onOpen} />)}
      {rest.length > 0 && (
        <div style={{ marginTop: 4 }}>
          <div className="mc-note" style={{ marginBottom: 4 }}>其余 {rest.length} 条（点开看累计）</div>
          {rest.map(c => (
            <div key={c.objectId} className="al-mini" onClick={() => onOpen(c)}>
              <span style={{ color: STYLE[c.category]![c.level]!.fg }}>{CAT[c.category]}·{LEVEL[c.level]}</span>　
              <b>{c.name}</b>　{c.title}<span className="mc-note">　第 {c.days} 天</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const Cumulative: React.FC<{ c: any }> = ({ c }) => {
  const s = c.series
  return (
    <div style={{ color: '#d7dde5' }}>
      <div className="al-d" style={{ fontSize: 13, marginBottom: 10 }}>{c.title}。{c.detail}</div>
      <table className="al-kv" style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr><th>窗口</th><th>累计超额资金</th><th>自身历史分位</th><th>同期价格</th><th>同期融资</th></tr>
        </thead>
        <tbody>
          {c.windows.map((w: any) => (
            <tr key={w.k}>
              <td>近 {w.k} 日</td>
              <td className={cls(w.cumYi)}>{yi(w.cumYi, 0)}</td>
              <td>{w.pct === null ? '—' : `${Math.round(w.pct * 100)}%`}</td>
              <td className={cls(w.priceChg)}>{pct(w.priceChg)}</td>
              <td className={cls(w.marginChgYi)}>{yi(w.marginChgYi)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ marginTop: 12 }}>
        <Legend items={[
          { color: '#58a6ff', label: '20 日日均超额（亿元/日）' },
          { color: '#f0b429', label: '自身历史 15% / 85% 分位', dash: true },
          { color: '#ff7b72', label: c.kind === 'STOCK' ? '股价（右轴）' : '等权指数（右轴）' },
        ]} />
        <LinesChart dates={s.dates} width={880} height={230} unit=""
          lines={[{ data: s.e20, color: '#58a6ff', width: 2.2, label: '超额' }]}
          refs={[{ value: 0, color: '#8b96a5' }, { value: s.p15, color: '#f0b429' }, { value: s.p85, color: '#f0b429' }]}
          right={{ data: s.close, color: '#ff7b72', label: '价格' }} />
        <Legend items={[{ color: '#db61a2', label: '融资余额（亿元）' }]} />
        <LinesChart dates={s.dates} width={880} height={120} unit="" lines={[{ data: s.marginYi, color: '#db61a2', width: 2, label: '融资' }]} />
      </div>
      <div style={{ marginTop: 10 }}>
        <div className="mc-note">这条提醒的历史</div>
        {c.history.map((h: any, i: number) => (
          <div key={i} className="mc-note">{h.date}　{EVENT[h.event]}　{LEVEL[h.level]}</div>
        ))}
        {String(c.firstDate).startsWith('≤') && <div className="mc-note">起点早于回放窗口（120 个交易日），实际持续时间更长</div>}
      </div>
      <div className="mc-note" style={{ marginTop: 10 }}>证据：{c.evidence}。提醒只决定先复核谁，不是买卖指令。</div>
    </div>
  )
}

const AlertsPanel: React.FC<{ alerts: any }> = ({ alerts }) => {
  const [open, setOpen] = useState<any>(null)
  const left = alerts.cards.filter((c: any) => c.column === 'LEFT')
  const right = alerts.cards.filter((c: any) => c.column === 'RIGHT')
  const d = alerts.digest
  return (
    <>
      <style>{CSS}</style>
      {alerts.anomalies?.length > 0 && (
        <div className="mc-card" style={{ marginBottom: 12, borderColor: '#8b96a5' }}>
          {alerts.anomalies.map((a: any) => <div key={a.kind} className="al-t">⚠ 数据异常：{a.text}</div>)}
        </div>
      )}
      <div className="mc-grid" style={{ gridTemplateColumns: '1fr 1fr', marginBottom: 12 }}>
        <Column title="持仓 · 需要先看" sub="入口① · 风险在前" cards={left} onOpen={setOpen} empty="持仓今天没有达到提醒量级的累计变化。" />
        <Column title="观察仓与市场 · 机会在哪" sub="入口② 观察仓 · 入口③ 资金投票" cards={right} onOpen={setOpen} empty="观察仓与市场今天没有达到提醒量级的累计变化。" />
      </div>
      <div className="mc-grid" style={{ gridTemplateColumns: '1fr 1.4fr 1fr', marginBottom: 12 }}>
        <div className="mc-card">
          <h3>今日解除 <small>条件不再成立</small></h3>
          {!alerts.resolvedToday.length && <div className="mc-note">无</div>}
          {alerts.resolvedToday.map((r: any, i: number) => <div key={i} className="mc-note"><b style={{ color: '#d7dde5' }}>{r.name}</b>　{r.text}</div>)}
        </div>
        <div className="mc-card">
          <h3>临时观察池 <small>市场新方向自动加入 · 20 日无提醒自动移出</small></h3>
          {!alerts.tempPool.length && <div className="mc-note">当前没有市场新方向进入临时观察。</div>}
          {alerts.tempPool.map((p: any) => (
            <Tooltip key={p.objectId} title={`加入 ${p.joined}，最近一次提醒 ${p.lastAlert}，若无新提醒将于 ${p.expires} 后移出`}>
              <div className="mc-note"><b style={{ color: '#d7dde5' }}>{p.name}</b>　核心股 {p.leaders.join(' · ')}　<span>自 {p.joined}</span></div>
            </Tooltip>
          ))}
        </div>
        <div className="mc-card">
          <h3>提醒变化 <small>周报 / 月报口径</small></h3>
          <div className="mc-note">近 5 日：新增 {d.days5.newCount} · 升级 {d.days5.upCount} · 解除 {d.days5.resolvedCount}</div>
          <div className="mc-note">近 20 日：新增 {d.days20.newCount} · 升级 {d.days20.upCount} · 解除 {d.days20.resolvedCount}</div>
          <div style={{ maxHeight: 140, overflow: 'auto', marginTop: 6 }}>
            {[...d.days5.items].reverse().map((x: string, i: number) => <div key={i} className="mc-note">{x}</div>)}
          </div>
        </div>
      </div>
      <Modal open={!!open} onCancel={() => setOpen(null)} footer={null} width={960}
        title={open ? `${open.name} · 累计变化` : ''}
        styles={{ body: { background: '#0d1117' }, header: { background: '#161b22' }, content: { background: '#0d1117' } }}>
        {open && <Cumulative c={open} />}
      </Modal>
    </>
  )
}

export default AlertsPanel
