// 审计归档与读取
//
// 每次驾驶舱运行都落一条（同日覆盖）。同时存 JSON 与 Markdown：
// JSON 供 KPI 计算，Markdown 供三个月后人工回看 —— 那时读者可能没有跑起来的系统。

import { getConnection } from '../../config/database'
import type { DailyAudit } from './audit'
import { renderAuditMarkdown } from './audit'

export async function saveAudit(userId: string, audit: DailyAudit, markdown?: string): Promise<void> {
  const conn = getConnection()
  await conn.execute(
    `INSERT INTO decision_audits
       (user_id, audit_date, rules_fingerprint, rules_drifted, buy_frozen, core_decision, audit_json, audit_md)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       rules_fingerprint=VALUES(rules_fingerprint), rules_drifted=VALUES(rules_drifted),
       buy_frozen=VALUES(buy_frozen), core_decision=VALUES(core_decision),
       audit_json=VALUES(audit_json), audit_md=VALUES(audit_md)`,
    [
      userId, audit.date, audit.rules.fingerprint.hash,
      audit.rules.drift?.drifted ? 1 : 0,
      audit.buyFrozen ? 1 : 0,
      audit.coreDecision.slice(0, 500),
      JSON.stringify(audit),
      markdown ?? renderAuditMarkdown(audit),
    ]
  )
}

/** 按日期升序读取审计序列，供 E3 逐日比对 */
export async function loadAudits(userId: string, limit = 60): Promise<DailyAudit[]> {
  const conn = getConnection()
  const [rows] = await conn.execute(
    `SELECT audit_json FROM decision_audits WHERE user_id = ?
     ORDER BY audit_date DESC LIMIT ?`,
    [userId, limit]
  )
  const arr = rows as { audit_json: string | DailyAudit }[]
  return arr
    .map(r => (typeof r.audit_json === 'string' ? (JSON.parse(r.audit_json) as DailyAudit) : r.audit_json))
    .reverse()
}

export async function loadAuditMarkdown(userId: string, date: string): Promise<string | null> {
  const conn = getConnection()
  const [rows] = await conn.execute(
    'SELECT audit_md FROM decision_audits WHERE user_id = ? AND audit_date = ?',
    [userId, date]
  )
  const arr = rows as { audit_md: string }[]
  return arr.length ? arr[0].audit_md : null
}
