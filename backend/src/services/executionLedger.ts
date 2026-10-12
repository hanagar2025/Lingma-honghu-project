// 执行台账 —— 执行债务的唯一查询入口
//
// 为什么值得单独一个文件：执行债务是全系统唯一的**硬闸门**（未清偿即禁止一切新增建仓）。
// 它此前在 routes/msr.ts 里内联查询，且过滤了一个不存在的列名 `action`
// （实际列名是 `required_action`），会在运行期抛错 —— 一个抛错的闸门等于没有闸门。
//
// 闸门的输入只能有一个来源，且不接受客户端传值。

import { getConnection } from '../config/database'

/**
 * 未执行的卖出指令条数。
 *
 * trade_executions 只写入卖出指令（见 tiosService.runDailyPipeline），
 * 因此"未执行行数"即"执行债务"。
 */
export async function countPendingSells(userId: string): Promise<number> {
  const conn = getConnection()
  const [rows] = await conn.execute(
    `SELECT COUNT(*) AS cnt FROM trade_executions
     WHERE user_id = ? AND executed = 0`,
    [userId]
  )
  const r = (rows as { cnt: number | string }[])[0]
  return Number(r?.cnt ?? 0)
}

export interface PendingSell {
  id: number
  reportDate: string
  code: string
  clause: string
  requiredAction: string
}

/** 未执行卖出指令明细 —— 驾驶舱要把"欠了什么"逐条摆出来，而不只是给个数字 */
export async function listPendingSells(userId: string): Promise<PendingSell[]> {
  const conn = getConnection()
  const [rows] = await conn.execute(
    `SELECT id, DATE_FORMAT(report_date, '%Y-%m-%d') AS reportDate,
            stock_code AS code, clause, required_action AS requiredAction
     FROM trade_executions
     WHERE user_id = ? AND executed = 0
     ORDER BY report_date ASC, id ASC`,
    [userId]
  )
  return rows as PendingSell[]
}
