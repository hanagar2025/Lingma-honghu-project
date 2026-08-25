// 看台 —— 投资人第一屏。
//
// 数据后台越来越完整。投资人前台只看这一问：
// 今天有没有出现足以改变资本状态的新事实？
//
// 必须完整呈现四轴：Ownership / Evidence / Exposure / Action。
// 只显示动作，会把「核心 + 超限 + 降暴露」读成「这家公司没价值」。
//
// 本组件不产生判断：动作、理由、变化全部由后端给出。
// 价格复核对账单单独收口，不得写成风险或机会。

import React from 'react'

export type LookoutSection = 'must' | 'changes' | 'holds' | 'unknown'

export interface LookoutBoardProps {
  date?: string
  dailyQuestion?: string
  lifeline?: any[]
  changes?: { items?: any[]; prevDate?: string | null }
  pendingSellCount?: number
  pendingSells?: any[] | null
  unjudgable?: any[]
  lookout?: any
  onOpen?: (section: LookoutSection) => void
}

const actionClass = (action?: string) => {
  if (action === 'EXIT') return 'hh-action is-exit'
  if (action === 'REDUCE_EXPOSURE' || action === 'INCREASE_CAPITAL') return 'hh-action is-must'
  return 'hh-action'
}

const Axis: React.FC<{ r: any }> = ({ r }) => (
  <div className="hh-axis">
    <div className="hh-axis-cell">
      <span className="hh-axis-k">Ownership</span>
      <span className="hh-axis-v">{r.ownYes ? '成立' : '不成立'} {r.ownership}</span>
    </div>
    <div className="hh-axis-cell">
      <span className="hh-axis-k">Evidence</span>
      <span className="hh-axis-v">{r.evidence}</span>
    </div>
    <div className={`hh-axis-cell${r.exposure === '超限' ? ' is-hot' : ''}`}>
      <span className="hh-axis-k">Exposure</span>
      <span className="hh-axis-v">{r.exposure}</span>
    </div>
    <div className="hh-axis-cell">
      <span className="hh-axis-k">Action</span>
      <span className="hh-axis-v">{r.actionText ?? r.action} · {r.hunter}</span>
    </div>
  </div>
)

const NameBlock: React.FC<{ r: any; onOpen?: () => void; link: string }> = ({
  r, onOpen, link,
}) => (
  <div className="hh-name">
    <div className="hh-name-h">
      <strong>{r.name}</strong>
      <span className={actionClass(r.action)}>{r.actionText ?? r.action}</span>
    </div>
    <Axis r={r} />
    <div className="hh-reason">{r.oneReason}</div>
    <button type="button" className="hh-link" onClick={onOpen}>{link}</button>
  </div>
)

const LookoutBoard: React.FC<LookoutBoardProps> = ({
  date,
  lookout,
  onOpen,
}) => {
  if (!lookout) {
    return (
      <article className="hh-look">
        <div className="hh-kicker">第一层 · 看台</div>
        <p className="hh-empty">看台尚未生成。后端未返回 lookout 字段。详细数据仍可点开。</p>
      </article>
    )
  }

  const must = lookout.must ?? []
  const holds = lookout.holds ?? []
  const observes = lookout.observes ?? []
  const capitalChanges = lookout.capitalChanges ?? []
  const reviewChanges = lookout.reviewChanges ?? []
  const unjudgable = lookout.unjudgable ?? []
  const debtCount = lookout.debtCount ?? 0
  const blockingUnknown = unjudgable.slice(0, 1)
  const portfolio = lookout.portfolio
  const wontDo: string[] = lookout.wontDo ?? []

  return (
    <article className="hh-look">
      <header className="hh-look-head">
        <div className="hh-kicker">第一层 · 看台</div>
        <div className="hh-look-date">{lookout.date ?? date ?? ''}</div>
      </header>

      <h1 className="hh-q">{lookout.dailyQuestion}</h1>
      <p className={`hh-answer${lookout.hasNewFact ? ' is-yes' : ''}`}>{lookout.answer}</p>

      <div className="hh-principles">
        <div>{lookout.priceIsNotLoss}</div>
        <div>{lookout.principle}</div>
        <div>{(lookout.spine ?? []).map((s: any) => s.name).join(' → ')}</div>
        <div>{lookout.spineNote}</div>
        <div>{lookout.layer}</div>
      </div>

      {portfolio && (
        <section className="hh-read">
          <div className="hh-kicker">{portfolio.eyebrow || '今日组合读法'}</div>
          <div className="hh-stance">{portfolio.stance}</div>
          <p>{portfolio.structure}</p>
          <p>{portfolio.cash}</p>
          <div className="hh-note">{portfolio.note}</div>
        </section>
      )}

      <section className="hh-sec">
        <div className="hh-sec-h">
          <strong>必须处理</strong>
          <span className="hh-kicker">{must.length + (debtCount > 0 ? 1 : 0)}</span>
        </div>
        {must.length === 0 && debtCount === 0 && (
          <div className="hh-empty">今日没有必须改资本的事项。</div>
        )}
        {must.map((r: any) => (
          <NameBlock key={r.code} r={r} onOpen={() => onOpen?.('must')} link="查看依据" />
        ))}
        {debtCount > 0 && (
          <div className="hh-name">
            <div className="hh-name-h">
              <strong>执行债务</strong>
              <span className="hh-action is-exit">{debtCount} 条未清偿</span>
            </div>
            <div className="hh-reason">{lookout.debtNote}</div>
            <button type="button" className="hh-link" onClick={() => onOpen?.('must')}>查看依据</button>
          </div>
        )}
      </section>

      <section className="hh-sec">
        <div className="hh-sec-h">
          <strong>正在变化</strong>
          <span className="hh-kicker">{capitalChanges.length}</span>
        </div>
        {!lookout.prevDate && (
          <div className="hh-empty">尚无昨日对照，变化带明天才有内容。</div>
        )}
        {lookout.prevDate && capitalChanges.length === 0 && (
          <div className="hh-empty">今日无足以改变资本状态的新事实。</div>
        )}
        {capitalChanges.slice(0, 8).map((c: any, i: number) => (
          <div key={`${c.scope}-${c.key}-${c.field}-${i}`} className="hh-change">
            {c.scope} · {c.key} · {c.field}
            {' '}
            <s>{c.from}</s>
            {' → '}
            <b>{c.to}</b>
          </div>
        ))}
        {capitalChanges.length > 8 && (
          <div className="hh-empty">其余 {capitalChanges.length - 8} 项在依据里。</div>
        )}
        {reviewChanges.length > 0 && (
          <div className="hh-note">
            另有 {reviewChanges.length} 项价格复核，点开看（不构成动作）。
          </div>
        )}
        <div style={{ marginTop: 8 }}>
          <button type="button" className="hh-link" onClick={() => onOpen?.('changes')}>查看变化依据</button>
        </div>
      </section>

      {observes.length > 0 && (
        <section className="hh-sec">
          <div className="hh-sec-h">
            <strong>仍在观察</strong>
            <span className="hh-kicker">{observes.length}</span>
          </div>
          <div className="hh-empty">观察不是卖出，也不是维持资本。</div>
          {observes.map((r: any) => (
            <NameBlock key={r.code} r={r} onOpen={() => onOpen?.('holds')} link="查看生命线" />
          ))}
        </section>
      )}

      <section className="hh-sec">
        <div className="hh-sec-h">
          <strong>明确维持</strong>
          <span className="hh-kicker">{holds.length}</span>
        </div>
        {holds.length === 0 ? (
          <div className="hh-empty">今日没有记为维持的持仓。</div>
        ) : (
          <>
            {holds.map((r: any) => (
              <NameBlock key={r.code} r={r} onOpen={() => onOpen?.('holds')} link="查看生命线" />
            ))}
            <div className="hh-note">{lookout.holdIsDecision}</div>
          </>
        )}
      </section>

      {wontDo.length > 0 && (
        <section className="hh-wont">
          <div className="hh-kicker">今日明确不做什么</div>
          <ul>
            {wontDo.map(x => <li key={x}>{x}</li>)}
          </ul>
        </section>
      )}

      {blockingUnknown.length > 0 && (
        <div className="hh-unknown">
          <div>不可判断 {unjudgable.length} 项。不知道本身就是信息。</div>
          <div>{blockingUnknown[0].topic}：{blockingUnknown[0].why}</div>
          <button type="button" className="hh-link" onClick={() => onOpen?.('unknown')}>
            查看全部不可判断
          </button>
        </div>
      )}
    </article>
  )
}

export default LookoutBoard
