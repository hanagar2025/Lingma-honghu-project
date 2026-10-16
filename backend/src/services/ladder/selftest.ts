/**
 * 名单治理（L-01）· 自检
 *
 *   npm -w backend run ladder:selftest
 */

import { readFileSync } from 'node:fs'
import { LEFT_RADAR, LEFT_RADAR_LOCK } from '../moneyRadar/config'
import { findMember } from '../msr/universe'
import { appendLadderEvents } from './ledger'
import {
  OBSERVE_PERIODS, addDays, buildLadder, buyPermissionOf, ladderProducesAction, nextReportDeadline,
  type LadderInput, type ReviewDecision,
} from './registry'
import { renderLadder } from './render'
import { collectSources, loadPortfolio, MAP_V1, type PortfolioLite, type SourcedName } from './sources'
import type { BuyPermissionState, LadderView } from './types'

let pass = 0
let fail = 0
function ok(name: string, cond: boolean, detail = ''): void {
  if (cond) { pass++; console.log(`  ✓ ${name}`) } else { fail++; console.log(`  ✗ ${name}${detail ? `  —— ${detail}` : ''}`) }
}

console.log('\n═══ 名单治理 L-01 自检 ═══\n')

const portfolio = loadPortfolio()
const closed: BuyPermissionState = buyPermissionOf(portfolio, { productionBuyApproved: false, exchangeCalendar: false })
const open: BuyPermissionState = { open: true, reasons: [] }
const base = (over: Partial<LadderInput> = {}): LadderView => buildLadder({
  asOf: '2026-10-16', generatedAt: 'test', portfolio, decisions: [], buyPermission: closed, ...over,
})
const v = base()
const by = (view: LadderView, code: string) => view.entries.find(e => e.code === code)

console.log('【一、主名单结构】')
{
  const codes = v.entries.map(e => e.code)
  ok('每只股票只有一个当前层级（代码不重复）', new Set(codes).size === codes.length)
  const all = new Set(collectSources(portfolio).map(s => s.code))
  ok(`六份名单与持仓全部映射进主表（${all.size} 只）`, all.size === codes.length && [...all].every(c => codes.includes(c)))
  ok('重复标记合并、来源保留：沪电同时保留持仓、股票池、R-02 两批、全景图五个来源',
    by(v, '002463')!.sources.map(t => t.source).sort().join() === 'HOLDING,MAP_V1,MSR_UNIVERSE,R02_NEXT,R02_PRESELECT')
  ok('全景图名单 35 只代码为 6 位且不重复', MAP_V1.length === 35 && MAP_V1.every(m => /^\d{6}$/.test(m.code)) && new Set(MAP_V1.map(m => m.code)).size === 35)
  ok('每只股票都写明进入原因与退出条件', v.entries.every(e => e.entryReason.length > 0 && e.exitCondition.length > 0))
  ok('名单治理不产生动作', ladderProducesAction() === false)
}

console.log('\n【二、持仓】')
{
  const held = v.entries.filter(e => e.level === 6)
  ok(`账本持仓 ${portfolio.positions.length} 只全部在第 6 级`, held.length === portfolio.positions.length)
  ok('当前持仓全部属冻结冠军池，没有资格不符提示', held.every(e => e.champion && e.flags.length === 0))
  ok('持仓按执行单管理，权限为 EXECUTION_CARD', held.every(e => e.buyPermission === 'EXECUTION_CARD'))
  const p2: PortfolioLite = { ...portfolio, positions: [...portfolio.positions, { code: '300394', name: '天孚通信', quantity: 100, sector: '通信', theme: 'AI' }] }
  const v2 = base({ portfolio: p2 })
  ok('持有非冠军池股票 → 第 6 级但标出「持仓资格不符」，不出动作', by(v2, '300394')!.level === 6 && by(v2, '300394')!.flags.some(f => f.includes('冠军池')))
}

console.log('\n【三、买入权限与第 5 级】')
{
  ok('当前买入权限关闭（生产买入未批、无交易所日历、峰值待核验、执行债务）',
    !closed.open && closed.reasons.length === 4)
  ok('买入权限关闭 → 第 5 级为空', v.counts[5] === 0)
  ok('买入权限关闭 → 第四级闸门不评估（备选池股票没有价格窗口条目）',
    v.entries.filter(e => e.level === 4).every(e => e.gates.length === 3))
  ok('除第 5、6 级外，所有股票买入权限为无', v.entries.filter(e => e.level < 5).every(e => e.buyPermission === 'NONE'))
  const vOpenNoS3 = base({ buyPermission: open })
  ok('权限开放但第四级闸门未评估 → 仍停在备选池', vOpenNoS3.counts[5] === 0 && by(vOpenNoS3, '603019')!.level === 4)
  const vOpen = base({ buyPermission: open, s3Gates: { '603019': [{ id: 'S3', label: '价格窗口', pass: true, detail: '测试' }] } })
  ok('权限开放且第四级闸门全过 → 第 5 级，只能申请', by(vOpen, '603019')!.level === 5 && by(vOpen, '603019')!.buyPermission === 'APPLY_ONLY')
  const vFail = base({ buyPermission: open, s3Gates: { '603019': [{ id: 'S3', label: '价格窗口', pass: false, detail: '测试' }] } })
  ok('任一闸门失效 → 不进第 5 级', by(vFail, '603019')!.level === 4)
}

console.log('\n【四、备选池三道条件分别检查】')
{
  const lv3 = v.entries.filter(e => e.level === 3 || e.level === 4)
  ok('观察池与备选池每只都分别列出产业证据、盈利核验、主线归因三道条件',
    lv3.every(e => ['INDUSTRY', 'EARNINGS', 'ATTRIBUTION'].every(id => e.gates.filter(g => g.id === id).length === 1)))
  const tf = by(v, '300394')!
  ok('天孚：产业证据通过、盈利核验未过 → 停在观察池，原因写明未过哪一道',
    tf.level === 3 && tf.gates.find(g => g.id === 'INDUSTRY')!.pass === true && tf.gates.find(g => g.id === 'EARNINGS')!.pass === false && tf.ceiling.includes('盈利核验'))
  const dsj = by(v, '002384')!
  ok('东山（证据 B、产业档案未建）：产业证据条件不通过', dsj.gates.find(g => g.id === 'INDUSTRY')!.pass === false)
  const sg = by(v, '603019')!
  ok('中科曙光：三道条件分别通过 → 备选池（买入权限关闭，第 5 级不评估）',
    sg.level === 4 && sg.gates.every(g => g.pass === true) && sg.ceiling.includes('买入权限关闭'))
  ok('备选池只收作战主线：AI 电力股票停在观察池', ['002028', '002837', '002851', '300870'].every(c => by(v, c)!.level === 3 && by(v, c)!.scope === 'RESEARCH_ONLY'))
  ok('未进股票池的股票最高到观察池', v.entries.filter(e => e.scope === 'OUT_OF_UNIVERSE').every(e => e.level <= 3))
}

console.log('\n【五、来源不授予层级】')
{
  const fake = (code: string, name: string, src: SourcedName['tag']['source'], by2: SourcedName['tag']['by']): SourcedName =>
    ({ code, name, tag: { source: src, group: '测试', since: '2026-10-16', by: by2 } })
  const onlyMoney = base({ collect: () => [fake('688041', '海光信息', 'MSR_UNIVERSE', '研究档案'), fake('688041', '海光信息', 'R01_RADAR', '委员会')], portfolio: { ...portfolio, positions: [] } })
  ok('三道条件全过、但只有资金异动观察 → 停在观察池（资金信号不能越级）',
    by(onlyMoney, '688041')!.level === 3 && by(onlyMoney, '688041')!.ceiling.includes('资金'))
  const nominated = base({ collect: () => [fake('688702', '盛科通信', 'MAP_V1', '委员会')], portfolio: { ...portfolio, positions: [] } })
  ok('委员会点名（无观察计划）只能进研究池', by(nominated, '688702')!.level === 2)
  ok('C 级清退（澜起、兆易）最高到研究池', ['688008', '603986'].every(c => by(v, c)!.level === 2 && by(v, c)!.retiredC))
  const radarCodes = new Set(LEFT_RADAR.flatMap(g => g.members.map(m => m.code)))
  const radarHigh = v.entries.filter(e => radarCodes.has(e.code) && e.level >= 4 && e.level < 6)
  ok('左侧雷达股票进入备选池的，资格全部来自股票池核验与盈利验证观察，不来自雷达',
    radarHigh.every(e => e.scope === 'COMBAT' && e.plans.some(p => p.purpose !== 'MONEY') && !!findMember(e.code)?.member.earningsVerified))
  ok('左侧雷达中未进股票池的股票全部停在观察池', v.entries.filter(e => radarCodes.has(e.code) && !findMember(e.code)).every(e => e.level === 3))
}

console.log('\n【六、左侧雷达权限锁】')
{
  const radarCodes = new Set(LEFT_RADAR.flatMap(g => g.members.map(m => m.code)))
  const rs = v.entries.filter(e => radarCodes.has(e.code))
  ok(`左侧雷达 ${rs.length} 只全部带「只观察，不具备建仓权限」锁`, rs.length === 19 && rs.every(e => e.locks.some(l => l.includes(LEFT_RADAR_LOCK.label))))
  ok('锁文字写明战略冻结期', rs.every(e => e.locks.some(l => l.includes('2027 年 1 月'))))
  ok('解除只能来自正式评审：releasedBy 为 null', LEFT_RADAR_LOCK.releasedBy === null)
  ok('AI软件、具身智能、工业AI 标为非作战主线；AI电力标为仅研究',
    LEFT_RADAR.filter(g => ['ai-software', 'embodied', 'industrial-ai'].includes(g.id)).every(g => g.scope === 'NON_MAINLINE')
    && LEFT_RADAR.find(g => g.id === 'ai-power')!.scope === 'RESEARCH_ONLY')
}

console.log('\n【七、观察期限与到期决定】')
{
  ok('观察期限为预登记值（待委员会确认）', OBSERVE_PERIODS.status === 'PRE_REGISTERED')
  ok('盈利验证期限 = 下一个定期报告法定截止日',
    nextReportDeadline('2026-10-15') === '2026-10-31' && nextReportDeadline('2026-11-01') === '2027-04-30'
    && nextReportDeadline('2026-05-01') === '2026-08-31' && nextReportDeadline('2026-04-30') === '2026-04-30')
  ok('资金异动期限 = 30 个自然日', by(v, '300394')!.plans.find(p => p.purpose === 'MONEY')!.reviewBy === addDays('2026-09-23', 30))
  ok('观察池每只都有复核期限', v.entries.filter(e => e.level === 3 || e.level === 4).every(e => !!e.reviewBy))
  const late = base({ asOf: '2026-10-24' })
  ok('期限届满 → 标「已到期待决定」，不自动移出', by(late, '300394')!.reviewOverdue && by(late, '300394')!.level === 3)
  const keep: ReviewDecision[] = [{ date: '2026-10-24', code: '300394', action: 'KEEP', purpose: 'MONEY', approver: '委员会', note: '测试' }]
  const vk = base({ asOf: '2026-10-24', decisions: keep })
  ok('续留 → 从续留日重算期限', by(vk, '300394')!.plans.find(p => p.purpose === 'MONEY')!.reviewBy === '2026-11-23')
  const down: ReviewDecision[] = [{ date: '2026-10-24', code: '002384', action: 'DOWN', approver: '委员会', note: '测试' }]
  ok('降级 → 观察计划作废，回研究池', by(base({ asOf: '2026-10-24', decisions: down }), '002384')!.level === 2)
  const rm: ReviewDecision[] = [{ date: '2026-10-24', code: '688521', action: 'REMOVE', approver: '委员会', note: '测试' }]
  ok('移出（未进股票池的股票）→ 回到全市场', by(base({ asOf: '2026-10-24', decisions: rm }), '688521')!.level === 1)
}

console.log('\n【八、留痕台账】')
{
  const first = appendLadderEvents(null, v, [])
  ok('首次运行：每只股票记一条进入事件，审批人「规则计算」',
    first.added.length === v.entries.length && first.added.every(e => e.kind === 'ENTER' && e.approver === '规则计算'))
  ok('进入事件记录来源与日期', first.added.every(e => e.sources.length > 0 && /\d{4}-\d{2}-\d{2}/.test(e.sources[0]!)))
  const again = appendLadderEvents(JSON.parse(JSON.stringify(first.ledger)), v, [])
  ok('同一结果重跑不重复记账', again.added.length === 0)
  const down: ReviewDecision[] = [{ date: '2026-10-24', code: '002384', action: 'DOWN', approver: '委员会', note: '测试' }]
  const v3 = base({ asOf: '2026-10-24', decisions: down })
  const moved = appendLadderEvents(JSON.parse(JSON.stringify(first.ledger)), v3, down)
  ok('降级记一条 DOWN（原层级 3 → 2）和一条委员会决定，审批人照录',
    moved.added.some(e => e.code === '002384' && e.kind === 'DOWN' && e.from === 3 && e.to === 2)
    && moved.added.some(e => e.kind === 'REVIEW' && e.approver === '委员会'))
  const twice = appendLadderEvents(JSON.parse(JSON.stringify(moved.ledger)), v3, down)
  ok('委员会决定不重复记', twice.added.length === 0)
}

console.log('\n【九、渲染】')
{
  const md = renderLadder(v, { pricedAt: 'test', sectors: [{ label: '电子', pct: 0.32, limit: 0.3 }], themes: [{ label: 'AI', pct: 0.41, limit: 0.45 }], note: '' })
  ok('报告写明买入权限关闭及原因', md.includes('买入权限：关闭') && closed.reasons.every(r => md.includes(r)))
  ok('持仓风险提示独立保留：板块超限写明「只显示，不自动出卖单」', md.includes('只显示，不自动出卖单'))
  ok('报告不出现买入、卖出指令字样', !/(建议买入|立即买入|建议卖出|卖出 \d+ 股)/.test(md))
  let bad = 0
  let cols = -1
  for (const l of md.split('\n')) {
    if (!l.startsWith('|')) { cols = -1; continue }
    const n = l.split('|').length
    if (cols < 0) cols = n
    else if (n !== cols) bad++
  }
  ok('表格每行列数一致', bad === 0, `${bad} 行不一致`)
}

console.log('\n【十、隔离】')
{
  const files = ['types.ts', 'sources.ts', 'registry.ts', 'ledger.ts', 'render.ts', 'run.ts']
  const src = files.map(f => readFileSync(new URL(f, import.meta.url), 'utf-8')).join('\n')
  const imports = src.split('\n').filter(l => l.trimStart().startsWith('import')).join('\n')
  ok('名单治理不 import 动作构造器与风控闸门', !['makeAction', 'findLimitBreaches', 'computeCircuit', 'evaluateActions', 'dailyDecision', 'executionEngine'].some(b => imports.includes(b)))
}

console.log(`\n═══ 结果：${pass} 通过 / ${fail} 失败 ═══\n`)
if (fail) process.exit(1)
