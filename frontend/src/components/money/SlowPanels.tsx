import React from 'react'
import { Tooltip } from 'antd'

/**
 * 资金驾驶舱 · 时效检验与慢钱
 *
 * 时效检验回答"资金信号领先还是跟随价格"；慢钱回答"钱是谁的"（被动 ETF、基金、股东户数）。
 * 两块都只读 money.json 里已经算好的结果。
 */

type Num = number | null

const pct = (v: Num, d = 1) => (v === null || v === undefined ? '—' : `${v > 0 ? '+' : ''}${(v * 100).toFixed(d)}%`)
const yi = (v: Num, d = 1) => (v === null || v === undefined ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(d)} 亿`)
const ic = (v: Num) => (v === null || v === undefined ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(3)}`)
const pp = (v: Num, d = 1) => (v === null || v === undefined ? '—' : `${v.toFixed(d)}%`)
const cls = (v: Num) => (v === null || v === undefined ? '' : v > 0 ? 'mc-up' : v < 0 ? 'mc-dn' : '')

const sigText = (ci: [number, number] | null, pos: string, neg: string, none: string) =>
  (!ci ? '样本不足' : ci[0] > 0 ? pos : ci[1] < 0 ? neg : none)

/** 慢钱横截面检验的一句话（取全部 A 股） */
const crossLine = (ev: any, signal: string) => {
  const c = ev?.cross?.find((x: any) => x.signal === signal && x.universe === '全部')
  return c ? `${c.text}：${c.rows.length} 期里之后 60 日 IC 为正 ${c.positive[0]} 期，均值 ${ic(c.meanFwdIc)}；形成期间与价格 IC ${ic(c.meanPastIc)}` : null
}

const LEAD_STYLE: Record<string, { text: string; color: string }> = {
  LEADS_SAME: { text: '领先·同向', color: '#3fb950' },
  LEADS_REVERSE: { text: '领先·反向', color: '#ff7b72' },
  NO_LEAD: { text: '不领先', color: '#8b96a5' },
  UNSTABLE: { text: '不稳定', color: '#f0b429' },
  INSUFFICIENT: { text: '样本不足', color: '#6e7681' },
}

const FOLLOW_TEXT: Record<string, string> = {
  FOLLOWS: '跟随价格',
  FOLLOWS_REVERSE: '逆价格',
  INDEPENDENT: '无关',
}

const SIGNAL_SHORT: Record<string, string> = {
  A1_ACCEL: '短期放量',
  A1_LEVEL: '资金集中度',
  A2_MARGIN: '融资 5 日变化',
}

const UNIVERSE_SHORT: Record<string, string> = {
  ALL: '全部 A 股', STAR: '科创板', CHINEXT: '创业板', TECH: '科技', INDUSTRY: '申万二级行业',
}

export const LeadLagCard: React.FC<{ l: any }> = ({ l }) => {
  const universes = [...new Set((l.rows ?? []).map((r: any) => r.universe))] as string[]
  const signals = Object.keys(SIGNAL_SHORT)
  const cell = (u: string, s: string) => (l.rows ?? []).find((r: any) => r.universe === u && r.signal === s)
  return (
    <div className="mc-card">
      <h3>资金信号时效检验 <small>{l.period[0]} ~ {l.period[1]} · {l.runOn}</small></h3>
      <div className="mc-alert" style={{ borderLeftColor: '#f0b429', cursor: 'default', fontSize: 13 }}>
        <b>战术一句话：</b>{l.verdict}
      </div>
      <div className="mc-note" style={{ margin: '4px 0 6px' }}>
        每格：过去 20 日 IC → 之后 20 日 IC（每日横截面秩相关的均值，之后收益从 T+1 收盘起算）。
        过去 IC 大 = 资金跟着价格走；之后 IC 为负 = 资金越热、之后越弱。
      </div>
      <table className="mc-kv" style={{ width: '100%', fontSize: 12 }}>
        <tbody>
          <tr style={{ color: '#8b96a5' }}>
            <td>股票池</td>
            {signals.map(s => <td key={s}>{SIGNAL_SHORT[s]}</td>)}
          </tr>
          {universes.map(u => (
            <tr key={u}>
              <td>{UNIVERSE_SHORT[u] ?? u}</td>
              {signals.map(s => {
                const r = cell(u, s)
                if (!r) return <td key={s}>—</td>
                const st = LEAD_STYLE[r.lead] ?? LEAD_STYLE.INSUFFICIENT!
                return (
                  <td key={s}>
                    <Tooltip title={`${r.signalText}（${r.knownAt}可得）｜${FOLLOW_TEXT[r.follow]}｜之后 20 日区间 ${r.fwdCi ? `[${ic(r.fwdCi[0])}, ${ic(r.fwdCi[1])}]` : '—'}｜最强 1/5 ${pct(r.top, 2)}、最弱 1/5 ${pct(r.bottom, 2)}`}>
                      <span className="mc-note">{ic(r.pastIc)} → </span>
                      <span style={{ color: st.color }}>{ic(r.fwdIc)} {st.text}</span>
                    </Tooltip>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ marginTop: 8 }}>
        {(l.timing ?? []).map((t: any) => (
          <div key={t.signal} className="mc-note">
            · 大盘择时｜{t.text}：与过去 20 日 r={ic(t.past.r)}，与之后 20 日 r={ic(t.fwd.r)}
            {t.fwd.ci && t.fwd.ci[0] <= 0 && t.fwd.ci[1] >= 0 ? '（无显著预测力）' : ''}　独立样本约 {t.independent} 段
          </div>
        ))}
        {(l.eventDelay ?? []).map((e: any) => (
          <div key={`${e.rule}${e.horizon}`} className="mc-note">
            · 冻结规则 {e.rule === 'TREND' ? '趋势' : '衰竭'} {e.horizon} 日：T 日收盘起算 {pct(e.meanT0, 2)} → T+1 收盘起算 {pct(e.meanT1, 2)}（{e.verdictT1.split('（')[0]}）
          </div>
        ))}
        {(l.slow ?? []).map((s: string, i: number) => <div key={i} className="mc-note">· 慢钱｜{s}</div>)}
      </div>
    </div>
  )
}

export const SlowMoneyCard: React.FC<{ s: any }> = ({ s }) => (
  <div className="mc-card">
    <h3>慢钱 · 钱是谁的 <small>科创系 ETF 申赎（T+1）· 基金持仓（半年）· 股东户数（按公告日）</small></h3>
    <div className="mc-grid" style={{ gridTemplateColumns: '1.35fr 1fr' }}>
      <div>
        <table className="mc-kv" style={{ width: '100%', fontSize: 12 }}>
          <tbody>
            <tr style={{ color: '#8b96a5' }}>
              <td>指数（跟踪 ETF）</td><td>5 日</td><td>20 日</td><td>60 日</td><td>ETF 规模</td><td>20 日/规模</td><td>指数 20 日</td><td>ETF/成分市值</td>
            </tr>
            {s.indexes.map((x: any) => (
              <tr key={x.index}>
                <td>
                  <Tooltip title={x.rejected?.length ? `名称相近但日收益与指数相关不足 0.97、已剔除：${x.rejected.join('、')}` : '全部名称匹配的 ETF 都通过跟踪校验'}>
                    {x.name}<span className="mc-note">（{x.etfCount} 只）</span>
                  </Tooltip>
                </td>
                <td className={cls(x.flow5)}>{yi(x.flow5)}</td>
                <td className={cls(x.flow20)}>{yi(x.flow20)}</td>
                <td className={cls(x.flow60)}>{yi(x.flow60)}</td>
                <td>{x.aum === null ? '—' : `${x.aum.toFixed(0)} 亿`}</td>
                <td className={cls(x.flow20Pct)}>{pct(x.flow20Pct, 1)}</td>
                <td className={cls(x.ret20)}>{pct(x.ret20)}</td>
                <td>{x.aumOfCap === null ? '—' : `${(x.aumOfCap * 100).toFixed(1)}%`}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mc-note" style={{ marginTop: 4 }}>
          份额截至 {s.indexes[0]?.asOf ?? '—'}。红 = 净申购、绿 = 净赎回。
          {(() => {
            const e = s.evidence?.etfTiming?.find((r: any) => r.index === '000688')
            return e ? `检验：科创 50 申赎${sigText(e.past.ci, '跟涨申购', '逆势申购（跌了才买）', '与过去涨跌无关')}，对之后 20 日${sigText(e.fwd.ci, '正相关', '负相关', '无显著预测力')}。` : ''
          })()}
        </div>
      </div>
      <div>
        <table className="mc-kv" style={{ width: '100%', fontSize: 12 }}>
          <tbody>
            <tr style={{ color: '#8b96a5' }}>
              <td>分组</td><td>基金/流通 {s.holdReport?.slice(0, 7)}</td><td>{s.holdReportPrev?.slice(0, 7)}</td><td>机构合计</td><td>户数变化中位</td>
            </tr>
            {s.groups.map((g: any) => (
              <tr key={g.id}>
                <td>{({ STAR: '科创板', TECH: '科技', ALL: '全部 A 股' } as Record<string, string>)[g.id]}<span className="mc-note">（{g.size}）</span></td>
                <td>{pp(g.fundRatio)}</td>
                <td className="mc-note">{pp(g.fundRatioPrev)}</td>
                <td>{pp(g.instRatio)}</td>
                <td className={cls(g.holdersChangeMedian === null ? null : -g.holdersChangeMedian)}>{g.holdersChangeMedian === null ? '—' : `${g.holdersChangeMedian > 0 ? '+' : ''}${g.holdersChangeMedian.toFixed(1)}%`}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mc-note" style={{ marginTop: 4 }}>
          按总市值加权。机构合计含一般法人等"其他"，1 − 机构合计 ≠ 散户占比。户数下降（红）= 筹码集中。
        </div>
      </div>
    </div>
    <table className="mc-kv" style={{ width: '100%', fontSize: 12, marginTop: 10 }}>
      <tbody>
        <tr style={{ color: '#8b96a5' }}>
          <td>持仓 / 观察仓</td><td>科创系权重</td><td>被动资金 20 日摊到该股</td><td>占日均成交</td><td>基金/流通</td><td>较上期</td><td>机构合计</td><td>股东户数较上期</td>
        </tr>
        {s.stocks.map((x: any) => {
          const d = x.fundRatio !== null && x.fundRatioPrev !== null ? x.fundRatio - x.fundRatioPrev : null
          return (
            <tr key={x.code}>
              <td>{x.name}<span className="mc-note"> {x.code}</span></td>
              <td className="mc-note">{x.indexWeights.length ? x.indexWeights.map((w: any) => `${w.name} ${w.weight.toFixed(1)}%`).join('、') : '—'}</td>
              <td className={cls(x.passive20)}>{yi(x.passive20, 2)}</td>
              <td className="mc-note">{x.passiveOfTurnover === null ? '—' : pct(x.passiveOfTurnover, 2)}</td>
              <td>{pp(x.fundRatio)}</td>
              <td className={cls(d)}>{d === null ? '—' : `${d > 0 ? '+' : ''}${d.toFixed(1)}pt`}</td>
              <td>{pp(x.instRatio)}</td>
              <td className={cls(x.holdersChange === null ? null : -x.holdersChange)}>
                <Tooltip title={x.holdersEndDate ? `截止 ${x.holdersEndDate}，公告 ${x.holdersNotice}，${x.holders} 户` : ''}>
                  {x.holdersChange === null ? '—' : `${x.holdersChange > 0 ? '+' : ''}${x.holdersChange.toFixed(1)}%`}
                </Tooltip>
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
    {s.notes.map((n: string, i: number) => <div key={i} className="mc-note">· {n}</div>)}
  </div>
)

export const SlowStockBlock: React.FC<{ x: any; evidence?: any }> = ({ x, evidence }) => {
  const d = x.fundRatio !== null && x.fundRatioPrev !== null ? x.fundRatio - x.fundRatioPrev : null
  return (
    <div className="mc-card">
      <h3>慢钱 · 钱是谁的 <small>{x.holdReport ?? '—'} 全持仓</small></h3>
      <table className="mc-kv" style={{ width: '100%' }}>
        <tbody>
          <tr><td>基金持股 / 流通股</td><td>{pp(x.fundRatio)}<span className={`mc-note ${cls(d)}`}>　较 {x.holdReportPrev ?? '—'} {d === null ? '—' : `${d > 0 ? '+' : ''}${d.toFixed(1)}pt`}</span></td></tr>
          <tr><td>机构合计 / 流通股</td><td>{pp(x.instRatio)}</td></tr>
          <tr><td>股东户数</td><td>{x.holders ?? '—'}<span className={`mc-note ${cls(x.holdersChange === null ? null : -x.holdersChange)}`}>　较上期 {x.holdersChange === null ? '—' : `${x.holdersChange > 0 ? '+' : ''}${x.holdersChange.toFixed(1)}%`}（截止 {x.holdersEndDate ?? '—'}，公告 {x.holdersNotice ?? '—'}）</span></td></tr>
          <tr><td>科创系指数权重</td><td>{x.indexWeights.length ? x.indexWeights.map((w: any) => `${w.name} ${w.weight.toFixed(2)}%`).join('、') : '不在科创系指数中'}</td></tr>
          <tr><td>被动资金 20 日</td><td className={cls(x.passive20)}>{yi(x.passive20, 2)}<span className="mc-note">{x.passiveOfTurnover === null ? '' : `　约为日均成交额的 ${(x.passiveOfTurnover * 100).toFixed(2)}%`}</span></td></tr>
        </tbody>
      </table>
      {['HOLDER_DROP', 'FUND_DELTA'].map(sg => crossLine(evidence, sg)).filter(Boolean).map((t, i) => (
        <div key={i} className="mc-note">· 检验｜{t}</div>
      ))}
    </div>
  )
}
