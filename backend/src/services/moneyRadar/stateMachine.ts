/**
 * 资金驾驶舱（R-01）· 状态机
 *
 *   潜伏 → 启动 → 趋势 → 爆发 → 衰竭 → 撤离 → 潜伏
 *            └→ 失败（未站稳即回落）→ 潜伏
 *
 * 三条滞后纪律（M-01 的教训：没有滞后，7 个基点就能让灯每天换色）：
 *   ① 进出阈值不同：进入看 75% 分位，退出看中位数；
 *   ② 连续确认：进入和退出都要求连续 K 日满足；
 *   ③ 最短保持：进入某状态后 5 日内不再跃迁；异常日不跃迁。
 *
 * 需要 A2 方向性数据才能确认的跃迁（趋势、撤离），在 A2 缺失时停在原状态，
 * 并挂一个"待 A2 确认"标记 —— 不因为缺数据就放行，也不因为缺数据就当作反向。
 */

import { THRESHOLDS as T } from './config'
import { lastKDays, type DayMetrics } from './metrics'

export type MoneyState = 'NO_BASELINE' | 'LATENT' | 'START' | 'TREND' | 'BURST' | 'EXHAUST' | 'RETREAT'

export const STATE_TEXT: Record<MoneyState, string> = {
  NO_BASELINE: '样本不足',
  LATENT: '潜伏',
  START: '启动',
  TREND: '趋势',
  BURST: '爆发',
  EXHAUST: '衰竭',
  RETREAT: '撤离',
}

export type Pending = 'TREND_NEEDS_A2' | 'RETREAT_NEEDS_A2' | null

export interface StateDay {
  state: MoneyState
  /** 进入当前状态的交易日下标 */
  since: number
  pending: Pending
}

export interface Transition {
  t: number
  from: MoneyState
  to: MoneyState
  /** 启动后未站稳即回落时为 true，对应状态图里的"失败"分支 */
  failed: boolean
  reason: string
}

const gt = (a: number | null, b: number | null) => (a === null || b === null ? null : a > b)
const lt = (a: number | null, b: number | null) => (a === null || b === null ? null : a < b)

function exhaustCond(m: DayMetrics): boolean | null {
  if (m.s20 === null || m.q75 === null || m.pr10 === null || m.pr10Mean60 === null) return null
  return m.s20 > m.q75 && m.pr10 < T.exhaustResponseRatio * m.pr10Mean60
}

export function runStateMachine(ms: readonly DayMetrics[]): { days: StateDay[]; transitions: Transition[] } {
  const days: StateDay[] = []
  const transitions: Transition[] = []
  let state: MoneyState = 'NO_BASELINE'
  let since = 0

  const go = (t: number, to: MoneyState, reason: string, failed = false) => {
    transitions.push({ t, from: state, to, failed, reason })
    state = to
    since = t
  }

  for (let t = 0; t < ms.length; t++) {
    const m = ms[t]!
    let pending: Pending = null

    if (state === 'NO_BASELINE') {
      if (m.basis !== 'INSUFFICIENT') go(t, 'LATENT', '水位样本足够')
      days.push({ state, since, pending })
      continue
    }

    const held = t - since
    const locked = held < T.minHoldDays || m.anomaly

    if (!locked) {
      const s20BelowMedian = (k: number) => lastKDays(ms, t, k, x => lt(x.s20, x.median))

      switch (state) {
        case 'LATENT':
          if (lastKDays(ms, t, T.startConfirmDays, x => gt(x.s5, x.q75)) && gt(m.s5, m.s20) === true) {
            go(t, 'START', `5 日份额连续 ${T.startConfirmDays} 日高于 75% 分位，且高于 20 日份额`)
          }
          break

        case 'START':
          if (gt(m.s20, m.q75) === true && m.persist >= T.trendPersistDays) {
            if (m.a2Inflow === true) go(t, 'TREND', `20 日份额高于 75% 分位，持续 ${m.persist} 日，A2 同向流入`)
            else if (m.a2Inflow === null) pending = 'TREND_NEEDS_A2'
          } else if (lastKDays(ms, t, T.startExitDays, x => lt(x.s5, x.median))) {
            const failed = held <= T.failWindowDays
            go(t, 'LATENT', failed ? `启动后 ${held} 日未站稳即回落到中位数以下` : '5 日份额回落到中位数以下', failed)
          }
          break

        case 'TREND':
          if (lastKDays(ms, t, T.exhaustConfirmDays, exhaustCond)) {
            go(t, 'EXHAUST', `份额仍高，但价格响应连续 ${T.exhaustConfirmDays} 日低于 60 日均值的一半`)
          } else if (gt(m.s5, m.q95) === true && m.ret20 !== null && m.ret20Q90 !== null && m.ret20 >= m.ret20Q90) {
            go(t, 'BURST', '5 日份额高于 95% 分位，20 日涨幅处于自身 90% 分位以上')
          } else if (s20BelowMedian(T.trendExitDays)) {
            if (m.a2Outflow === true) go(t, 'RETREAT', `20 日份额连续 ${T.trendExitDays} 日低于中位数，A2 反向流出`)
            else if (m.a2Outflow === null) pending = 'RETREAT_NEEDS_A2'
            else go(t, 'LATENT', '份额回落到中位数以下，无方向性流出')
          }
          break

        case 'BURST':
          if (lastKDays(ms, t, T.exhaustConfirmDays, exhaustCond)) {
            go(t, 'EXHAUST', '爆发后价格响应衰减')
          } else if (lastKDays(ms, t, T.burstExitDays, x => (x.s5 === null || x.q95 === null ? null : x.s5 <= x.q95))) {
            go(t, 'TREND', `5 日份额连续 ${T.burstExitDays} 日回到 95% 分位以下`)
          }
          break

        case 'EXHAUST':
          if (s20BelowMedian(T.trendExitDays)) {
            if (m.a2Outflow === true) go(t, 'RETREAT', `衰竭后 20 日份额连续 ${T.trendExitDays} 日低于中位数，A2 反向流出`)
            else if (m.a2Outflow === null) pending = 'RETREAT_NEEDS_A2'
            else go(t, 'LATENT', '份额回落到中位数以下，无方向性流出')
          } else if (lastKDays(ms, t, T.exhaustConfirmDays, x =>
            x.pr10 === null || x.pr10Mean60 === null || x.s20 === null || x.q75 === null
              ? null : x.pr10 >= x.pr10Mean60 && x.s20 > x.q75)) {
            go(t, 'TREND', '价格响应恢复，份额仍高于 75% 分位')
          }
          break

        case 'RETREAT':
          if (lastKDays(ms, t, T.retreatRecoverDays, x => (x.a2Outflow === null ? null : !x.a2Outflow))) {
            go(t, 'LATENT', `连续 ${T.retreatRecoverDays} 日不再有方向性流出`)
          }
          break
      }
    }

    days.push({ state, since, pending })
  }
  return { days, transitions }
}
