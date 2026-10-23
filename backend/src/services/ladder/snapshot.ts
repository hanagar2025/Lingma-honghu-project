/**
 * 名单治理（L-01）· 规则快照
 *
 *   npm -w backend run ladder:snapshot
 *
 * 委员会 2026-10-16 裁定执行顺序第一步：先冻结当前规则快照 ——
 * 六份名单、三套卖出规则、各自来源和代码调用位置。只做审计，不覆盖旧规则。
 *
 * 名单从代码常量读；调用位置从源码扫描得出，不手抄。
 * 回滚点是 git 标签 rules-snapshot-2026-10-16（指向本快照生成前的提交）。
 */

import { execSync } from 'node:child_process'
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MAINLINES } from '../msr/universe'
import { LEFT_RADAR, LEFT_RADAR_CONFIRMED_ON, WATCHLIST, WATCHLIST_CONFIRMED_ON } from '../moneyRadar/config'
import { NEXT_WAVE_POOL, PRESELECT_POOL } from '../research/rerating'
import { MAP_V1, MAP_V1_SINCE, R02_CONFIRMED_ON } from './sources'

const SERVICES = fileURLToPath(new URL('..', import.meta.url))
const ROOT = join(SERVICES, '..', '..', '..')
export const SNAPSHOT_DATE = '2026-10-16'
export const SNAPSHOT_TAG = 'rules-snapshot-2026-10-16'
export const SNAPSHOT_JSON = join(SERVICES, 'governance', 'data', `rule-snapshot-${SNAPSHOT_DATE}.json`)
export const SNAPSHOT_MD = join(ROOT, '战略组合2026-2030', `规则快照-${SNAPSHOT_DATE}.md`)

function walk(dir: string): string[] {
  const out: string[] = []
  for (const f of readdirSync(dir)) {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else if (p.endsWith('.ts')) out.push(p)
  }
  return out
}

/** 哪些源文件 import 了某个模块（按 import 语句扫描） */
export function importersOf(moduleBase: string, files = walk(join(SERVICES, '..'))): string[] {
  return files
    .filter(f => readFileSync(f, 'utf-8').split('\n')
      .some(l => /^\s*import\b/.test(l) && new RegExp(`['"][./]*[\\w/]*${moduleBase}['"]`).test(l)))
    .map(f => relative(ROOT, f))
    .sort()
}

function lineOf(file: string, needle: string): number | null {
  const lines = readFileSync(join(ROOT, file), 'utf-8').split('\n')
  const i = lines.findIndex(l => l.includes(needle))
  return i < 0 ? null : i + 1
}

export function buildSnapshot(baseCommit: string) {
  const at = (file: string, needle: string) => `${file}:${lineOf(file, needle) ?? '?'}`
  const lists = [
    {
      id: 'MSR_UNIVERSE', label: 'MSR 股票池', file: 'backend/src/services/msr/universe.ts', confirmedOn: '2026-07-26（CTC 冻结令；节点内标的可由研究增减）',
      members: MAINLINES.flatMap(ml => ml.members.map(m => ({ code: m.code, name: m.name, group: `${ml.name} · ${m.node}`, evidence: m.evidence, champion: !!m.champion, retiredC: !!m.retiredC }))),
    },
    {
      id: 'R01_WATCH', label: '资金哨兵入口② 起始名单', file: 'backend/src/services/moneyRadar/config.ts', confirmedOn: WATCHLIST_CONFIRMED_ON,
      members: WATCHLIST.map(w => ({ code: w.code, name: w.name, group: null })),
    },
    {
      id: 'R01_RADAR', label: '资金哨兵入口② 左侧雷达', file: 'backend/src/services/moneyRadar/config.ts', confirmedOn: LEFT_RADAR_CONFIRMED_ON,
      members: LEFT_RADAR.flatMap(g => g.members.map(m => ({ code: m.code, name: m.name, group: g.name }))),
    },
    {
      id: 'R02_PRESELECT', label: 'R-02 第一批', file: 'backend/src/services/research/rerating.ts', confirmedOn: R02_CONFIRMED_ON,
      members: PRESELECT_POOL.map(m => ({ code: m.code, name: m.name, group: m.group })),
    },
    {
      id: 'R02_NEXT', label: 'R-02 第二批（不含现有核心对照组）', file: 'backend/src/services/research/rerating.ts', confirmedOn: R02_CONFIRMED_ON,
      members: NEXT_WAVE_POOL.filter(m => !m.group.includes('对照')).map(m => ({ code: m.code, name: m.name, group: m.group })),
    },
    {
      id: 'MAP_V1', label: '全景图观察名单初稿（总纲第三章，文档名单，代码于 2026-10-16 逐只登记）', file: '战略组合2026-2030/AI产业链全景图与观察名单V1.0.md', confirmedOn: MAP_V1_SINCE,
      members: MAP_V1.map(m => ({ code: m.code, name: m.name, group: m.track })),
    },
  ]

  const tiosDoc = '交易操作系统/AI半导体趋势投资操作系统V1.0.md'
  const sellRules = [
    {
      id: 'TIOS_V1',
      label: '交易操作系统 V1.0 均线与止损条款',
      status: '代码存在，每日执行单不调用',
      rules: [
        '收盘跌破 20 日线连续 2 日（下跌期 1 日）→ 减 20%',
        '收盘跌破 60 日线（单日）→ 减持至原仓位 40% 以下',
        '收盘跌破 120 日线（单日）→ 全部退出',
        '自成本回撤 ≥ 25% → 全部退出（硬止损）',
        '单日跌幅 ≥ 12% → 次日开盘减 30%',
      ],
      sources: [at(tiosDoc, '收盘价跌破60日均线'), at(tiosDoc, '收盘跌破60日线 → 减'), at('backend/src/services/tios/executionEngine.ts', '均线条款')],
      ambiguity: `「减到 40%」口径不一：${at(tiosDoc, '收盘价跌破60日均线')} 写「减持至原仓位的 40% 以下（即累计至少减 60%）」，`
        + `${at(tiosDoc, '收盘跌破60日线 → 减')} 的个股示例写「减 40%」；代码按前者（REDUCE_TO_40）。`
        + '两处都指该股票自身的持仓，不是组合总资产的 40%。',
      callSites: importersOf('executionEngine'),
    },
    {
      id: 'COMMITTEE_SIM_1012',
      label: '委员会模拟阶段候选参数（2026-10-12 交易规则决议单）',
      status: '只用于回测与模拟，未写代码',
      rules: [
        'MA60：连续两日收盘确认跌破后减仓',
        'MA120：单日收盘确认跌破后按规则清仓',
        '止损距离缓冲系数 1.5 倍',
        '组合未保护风险上限：总资产 4%',
        '第一阶段只进入回测与模拟执行，不生成生产买单；交易所日历先行；生产买入权限另行审批',
      ],
      sources: ['委员会 2026-10-12 讨论记录（对话，未入库）'],
      ambiguity: '分母口径：委员会同意「本轮持仓周期内最高持股数」；MA120 清退应覆盖同日 MA60、MA20 的部分减仓，不叠加多笔卖单',
      callSites: [] as string[],
    },
    {
      id: 'RULING_0813',
      label: '8/13 委员会裁定：技术指标只能触发复核，不能单独产生卖出',
      status: '代码生效（类型约束：持仓势能一问全部为观察等级，函数不返回动作）',
      rules: ['技术指标只能触发复核；减仓的法定理由只能是仓位超限、熔断、C 级清退等账务条款'],
      sources: [at('backend/src/services/cockpit/momentum.ts', '技术指标只能触发复核'), at('backend/src/services/cockpit/types.ts', 'S3_PASSED_ALL_GATES')],
      ambiguity: null,
      callSites: importersOf('momentum'),
    },
  ]

  const inForce = {
    label: '每日执行单当前生效的卖出规则',
    order: 'C 级清退 → 单票归位 → 熔断 → 新增（10/10 裁定）',
    rules: ['C 级清退：全部卖出', '单票归位：超过 12% 卖到 ≤ 12%，股数向上取整，「卖后持有不超过 N 股」', '熔断降仓：峰值待核验期间不执行、不撤销'],
    displayOnly: ['板块 30% / 主题 45% 上限：只显示，不生成卖单'],
    sources: [at('backend/src/services/dailyDecision/card.ts', 'C 级清退'), at('backend/src/services/dailyDecision/orders.ts', "reason: 'C 级清退'"), at('backend/src/services/cockpit/safety.ts', 'singleStock')],
    imports: readdirSync(join(SERVICES, 'dailyDecision')).filter(f => f.endsWith('.ts'))
      .flatMap(f => readFileSync(join(SERVICES, 'dailyDecision', f), 'utf-8').split('\n')
        .filter(l => /^\s*import\b.*from '\.\.\//.test(l)).map(l => l.replace(/.*from '(.*)'.*/, '$1')))
      .filter((x, i, a) => a.indexOf(x) === i).sort(),
  }

  const baseline = JSON.parse(readFileSync(join(SERVICES, 'governance', 'data', 'freeze-baseline.json'), 'utf-8')) as { hash?: string }
  return {
    id: 'RULE-SNAPSHOT', date: SNAPSHOT_DATE, tag: SNAPSHOT_TAG, baseCommit,
    note: '只做审计，不覆盖旧规则。回滚：git checkout rules-snapshot-2026-10-16',
    freezeBaseline: baseline.hash ?? null,
    lists, sellRules, inForce,
  }
}

function renderSnapshot(s: ReturnType<typeof buildSnapshot>): string {
  const L: string[] = [`# 规则快照（${s.date}）`, '']
  L.push(`> ${s.note}。快照基于提交 \`${s.baseCommit}\`，规则冻结基线 \`${s.freezeBaseline}\`。由 \`npm -w backend run ladder:snapshot\` 从代码常量与源码扫描生成。`, '')
  L.push('## 一、六份名单', '')
  L.push('| 名单 | 确认日期 | 数量 | 文件 |', '|---|---|---|---|')
  for (const l of s.lists) L.push(`| ${l.label} | ${l.confirmedOn} | ${l.members.length} | \`${l.file}\` |`)
  L.push('')
  for (const l of s.lists) L.push(`- ${l.label}：${l.members.map(m => `${m.name}（${m.code}）`).join('、')}`)
  L.push('', '## 二、三套卖出规则', '')
  for (const r of s.sellRules) {
    L.push(`### ${r.label}`, '', `状态：${r.status}`, '')
    for (const x of r.rules) L.push(`- ${x}`)
    L.push('', `出处：${r.sources.map(x => `\`${x}\``).join('、')}`)
    if (r.ambiguity) L.push('', `口径问题：${r.ambiguity}`)
    L.push('', `代码调用位置：${r.callSites.length ? r.callSites.map(x => `\`${x}\``).join('、') : '无'}`, '')
  }
  L.push(`## 三、${s.inForce.label}`, '', `顺序：${s.inForce.order}`, '')
  for (const x of s.inForce.rules) L.push(`- ${x}`)
  for (const x of s.inForce.displayOnly) L.push(`- ${x}`)
  L.push('', `出处：${s.inForce.sources.map(x => `\`${x}\``).join('、')}`)
  L.push('', `每日执行单引用的上层模块：${s.inForce.imports.map(x => `\`${x}\``).join('、')}`, '')
  return L.join('\n')
}

function main(): void {
  const head = execSync('git rev-parse --short HEAD', { cwd: ROOT }).toString().trim()
  const s = buildSnapshot(process.env.SNAPSHOT_BASE ?? head)
  writeFileSync(SNAPSHOT_JSON, `${JSON.stringify(s, null, 1)}\n`, 'utf-8')
  writeFileSync(SNAPSHOT_MD, renderSnapshot(s), 'utf-8')
  process.stdout.write(`已写 ${relative(ROOT, SNAPSHOT_JSON)} 与 ${relative(ROOT, SNAPSHOT_MD)}\n`)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main()
