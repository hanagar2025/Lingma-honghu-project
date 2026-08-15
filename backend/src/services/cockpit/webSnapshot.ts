// 离线网页快照 —— 让浏览器里的 React 驾驶舱脱离 MySQL 与登录运行
//
// 为什么需要它：
//   网页端原本的链路是 浏览器 → 登录 → Express → MySQL。三个环节任意一个没起来，
//   当天就看不到分析结果。而"今天没看"重复三次，系统就等于不存在 ——
//   30 天观察期考的是"是否真的每天在用"，不是代码写得多完整。
//
// 做法：CLI 盘后把前端页面需要的**同一份 payload** 落成一个静态 JSON，
// 前端在离线模式下直接 fetch 它。数据来源与 CLI/HTML 报告完全一致，
// 因此三个出口不可能给出互相矛盾的结论。
//
// 边界（刻意保留的能力缺口，宁可显式缺失也不伪造）：
//   - 执行债务明细、KPI E1–E4 存在数据库里，离线快照拿不到 → 显式标 null，
//     前端据此隐藏"标记已执行"按钮，而不是给一个点了没反应的按钮。
//   - 本文件只做搬运与序列化，不含任何判据、阈值、评分，不影响规则指纹。

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Dashboard } from './dashboard'
import type { CockpitReport } from './types'
import { ACTION_TEXT, EVIDENCE_TIER_TEXT, LEGAL_REASON_TEXT, LIGHT_TEXT } from './types'
import { LIMITS } from './safety'
import type { Change } from '../governance/changeLog'
import { stageAdvances, type DiscoveryLedger } from '../governance/changeLog'
import type { DailyAudit } from '../governance/audit'
import type { FreezeBaseline } from '../governance/ruleRegistry'
import { fingerprint } from '../governance/ruleRegistry'

export interface WebSnapshotInput {
  report: CockpitReport
  dashboard: Dashboard | null
  /** 今日结论。网页端与 CLI/HTML 必须给出同一份结论，否则三个出口会各说一套 */
  verdict?: unknown
  /**
   * 外发摘要（Markdown）。由后端生成后随快照下发，前端不自己拼 ——
   * 否则同一份数据会有两套措辞，而其中一套迟早会漏掉那段约束前言。
   */
  brief?: string | null
  changes: Change[]
  prevDate: string | null
  discovery: DiscoveryLedger | null
  audit: DailyAudit
  auditMarkdown: string
  baseline: FreezeBaseline | null
  /** 取不到K线的代码 */
  missing: string[]
  valuationUsable: number
  valuationLoaded: number
  intraday: boolean
  marketAllows: boolean
  pendingSellCount: number
  externalCash: { amount: number; note: string; denominatorNow: number } | null
}

/**
 * 前端 `/api/cockpit/today` 返回体的离线等价物。
 * 字段名必须与接口逐一对齐，否则同一个页面读两个源会出现"某些卡片只在某个模式下有"。
 */
export function buildWebSnapshot(input: WebSnapshotInput): Record<string, unknown> {
  const {
    report, dashboard, changes, prevDate, discovery, audit, auditMarkdown,
    baseline, missing, valuationUsable, valuationLoaded, intraday, marketAllows, externalCash,
  } = input

  return {
    ...report,
    dashboard,
    verdict: input.verdict ?? null,
    brief: input.brief ?? null,
    dashboardText: null,
    changes: { prevDate, items: changes },
    discovery: {
      nodeCount: discovery?.entries.length ?? 0,
      advances: discovery ? stageAdvances(discovery) : [],
      firstSeenToday: discovery?.entries.filter(e => e.firstSeen === report.date).map(e => e.key) ?? [],
    },
    provisional: {
      intraday,
      archived: !intraday,
      note: intraday
        ? `最新K线 ${report.date} 尚未收盘，本页读数为临时值（仓位%、相对强度、成交比值都会随收盘变化），且未写入30天档案。`
        : '',
    },
    audit,
    auditMarkdown,
    freeze: { baseline, current: fingerprint() },
    marketStage: marketAllows
      ? '已确认允许建仓（CLI 以 MARKET_ALLOWS=1 运行）'
      : '未确认（按不允许建仓处理）',
    missing,
    limits: LIMITS,
    lightText: LIGHT_TEXT,
    actionText: ACTION_TEXT,
    legalReasonText: LEGAL_REASON_TEXT,
    evidenceTierText: EVIDENCE_TIER_TEXT,
    valuationUsable,
    valuationLoaded,

    // ── 离线模式专有 ──
    offline: {
      generatedAt: new Date().toISOString(),
      source: 'CLI 盘后快照（backend/src/services/cockpit/data/portfolio.json + 实时行情）',
      // 数据库里的东西拿不到，明说拿不到
      unavailable: [
        '执行债务明细（存于 trade_executions 表）→ 无法在离线页面勾选"标记已执行"',
        'KPI E1–E4（需要 decision_audits 与 trade_executions 历史）',
        '家庭年度刚性支出（存于 account_state 表）',
      ],
    },
    // 接口版给出明细列表；离线版只有条数。用 null 与空数组区分开：
    // null = 拿不到明细，[] = 拿到了且确实为零。前端据此决定"隐藏"还是显示"已清零"。
    pendingSells: null,
    pendingSellCount: input.pendingSellCount,
    kpi: null,
    externalCash,
  }
}

export function saveWebSnapshot(
  payload: Record<string, unknown>, file: string
): string {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, 'utf-8')
  return file
}

/**
 * 加密落盘。
 *
 * 关键在于**同时删掉明文**：加密快照与明文快照并存于同一个 public/ 目录时，
 * 构建会把两份都拷进 dist/，于是密文旁边就躺着一份明文 —— 加密等于没做。
 * 这类失误不会有任何报错，所以必须在写入时就消除可能性。
 */
export async function saveEncryptedWebSnapshot(
  payload: Record<string, unknown>, plainFile: string, passphrase: string
): Promise<{ file: string; removedPlain: boolean }> {
  const { encryptSnapshot, decryptSnapshot } = await import('./webEncrypt')
  const json = JSON.stringify(payload)
  const enc = await encryptSnapshot(json, passphrase)

  // 写盘前先解一次。生成了解不开的密文而当时没发现，等于当天的分析直接丢失，
  // 而这种问题往往要到第二天想看昨天数据时才暴露。
  const back = await decryptSnapshot(enc, passphrase)
  if (back !== json) throw new Error('加密自检失败：密文解出的内容与原文不一致，已中止写盘。')

  const encFile = encryptedSnapshotPath(plainFile)
  mkdirSync(dirname(encFile), { recursive: true })
  writeFileSync(encFile, `${JSON.stringify(enc, null, 2)}\n`, 'utf-8')

  let removedPlain = false
  if (existsSync(plainFile)) {
    rmSync(plainFile)
    removedPlain = true
  }
  return { file: encFile, removedPlain }
}

/** 前端静态资源目录。Vite 会把 public/ 原样拷进 dist/ */
export function webSnapshotFile(repoRoot: string): string {
  return join(repoRoot, 'frontend', 'public', 'data', 'today.json')
}

export function encryptedSnapshotPath(plainFile: string): string {
  return plainFile.replace(/\.json$/, '.enc.json')
}
