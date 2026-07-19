// 执行层引擎 —— 《AI半导体趋势投资操作系统 V1.0》第2.1节卖出默认模板的代码化
// 全部以收盘价确认触发，动作对应「次日开盘执行」

import type { AccountSnapshot, DailyBar, MarketStage, Position, PortfolioCircuitResult, RuleCard, TriggerAction, TriggerEvent } from './types'
import { consecutiveDaysBelowMA, dayChangePct, sma } from './indicators'

const ACTION_SEVERITY: Record<TriggerAction, number> = {
  EXIT_ALL: 4,
  REDUCE_TO_40: 3,
  REDUCE_30: 2,
  REDUCE_20: 1,
  NONE: 0,
}

/**
 * 对单只持仓核对全部卖出条款，返回触发事件（可能多条）。
 * @param stage 已确认的市场阶段——下跌期时20日线条款由连续2日收紧为1日（V2.0第八章）
 */
export function evaluateSellRules(
  position: Position,
  card: RuleCard,
  bars: DailyBar[],
  stage: MarketStage
): TriggerEvent[] {
  const events: TriggerEvent[] = []
  const close = bars[bars.length - 1].close

  // 硬止损：自成本回撤 ≥ 阈值（默认25%）→ 全部退出
  const drawdownFromCost = 1 - close / position.cost
  if (drawdownFromCost >= card.hardStopPct) {
    events.push({
      code: position.code,
      name: position.name,
      clause: 'V1.0-2.1-硬止损',
      action: 'EXIT_ALL',
      detail: `自成本回撤${(drawdownFromCost * 100).toFixed(1)}% ≥ ${card.hardStopPct * 100}%（收盘${close} / 成本${position.cost}）`,
    })
  }

  // 单日熔断：当日跌幅 ≥ 阈值（默认12%）→ 次日开盘减30%
  // 按行情显示口径四舍五入到基点（0.01%）再比较，避免浮点边界漏判（如实际-11.9998%显示为-12.00%）
  const chg = dayChangePct(bars)
  const chgRounded = chg === null ? null : Math.round(-chg * 10000) / 10000
  if (chg !== null && chgRounded !== null && chgRounded >= card.crashPct) {
    events.push({
      code: position.code,
      name: position.name,
      clause: 'V1.0-2.1-单日熔断',
      action: 'REDUCE_30',
      detail: `当日跌幅${(chg * 100).toFixed(2)}% 触及-${card.crashPct * 100}%熔断线`,
    })
  }

  // 历史熔断补执行位（触发过但未执行的次数）
  if (card.pendingCrashExecutions > 0) {
    events.push({
      code: position.code,
      name: position.name,
      clause: 'V1.0-2.1-熔断补执行',
      action: 'REDUCE_30',
      detail: `存在${card.pendingCrashExecutions}次已触发未执行的熔断，次日开盘补执行`,
    })
  }

  // 均线条款：120日全退 > 60日减至40% > 20日连续N日减20%
  const ma120 = sma(bars, 120)
  const ma60 = sma(bars, 60)
  if (ma120 !== null && close < ma120) {
    events.push({
      code: position.code,
      name: position.name,
      clause: 'V1.0-2.1-破120日线',
      action: 'EXIT_ALL',
      detail: `收盘${close} < 120日线${ma120.toFixed(2)}`,
    })
  } else if (ma60 !== null && close < ma60) {
    events.push({
      code: position.code,
      name: position.name,
      clause: 'V1.0-2.1-破60日线',
      action: 'REDUCE_TO_40',
      detail: `收盘${close} < 60日线${ma60.toFixed(2)}，减持至原仓位40%以下`,
    })
  } else {
    const requiredDays = stage === 'downtrend' ? 1 : 2 // 下跌期零容忍（V2.0第八章）
    const daysBelow20 = consecutiveDaysBelowMA(bars, 20)
    if (daysBelow20 >= requiredDays) {
      events.push({
        code: position.code,
        name: position.name,
        clause: 'V1.0-2.1-破20日线',
        action: 'REDUCE_20',
        detail: `连续${daysBelow20}日收于20日线下方（当前阶段要求${requiredDays}日触发）`,
      })
    }
  }

  return events
}

/** 同一股票多条款触发时取最严动作（体系合并规则） */
export function mergeTriggers(events: TriggerEvent[]): TriggerEvent[] {
  const byCode = new Map<string, TriggerEvent[]>()
  for (const e of events) {
    const list = byCode.get(e.code) ?? []
    list.push(e)
    byCode.set(e.code, list)
  }
  const merged: TriggerEvent[] = []
  for (const list of byCode.values()) {
    list.sort((a, b) => ACTION_SEVERITY[b.action] - ACTION_SEVERITY[a.action])
    const top = list[0]
    if (list.length > 1) {
      merged.push({
        ...top,
        detail: `${top.detail}（另有${list.length - 1}项较轻条款同时触发，按最严执行）`,
      })
    } else {
      merged.push(top)
    }
  }
  return merged
}

/** 组合级熔断：自最高净值回撤≥15%→仓位上限50%；≥25%→上限30%且只卖不买（V1.0第4.3节） */
export function evaluatePortfolioCircuit(snapshot: AccountSnapshot): PortfolioCircuitResult {
  const dd = 1 - snapshot.totalAssets / snapshot.peakAssets
  if (dd >= 0.25) {
    return { drawdownPct: dd, positionCap: 0.3, sellOnly: true, detail: `组合回撤${(dd * 100).toFixed(1)}% ≥ 25%：仓位上限30%，只卖不买` }
  }
  if (dd >= 0.15) {
    return { drawdownPct: dd, positionCap: 0.5, sellOnly: false, detail: `组合回撤${(dd * 100).toFixed(1)}% ≥ 15%：仓位上限50%，暂停左侧买入` }
  }
  return { drawdownPct: dd, positionCap: 1, sellOnly: false, detail: `组合回撤${(dd * 100).toFixed(1)}%，未触发熔断` }
}
