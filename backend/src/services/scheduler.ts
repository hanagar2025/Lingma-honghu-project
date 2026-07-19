// 定时任务 —— 工作日17:00（北京时间）自动跑完整闭环：同步K线→生成盘前四问→留痕
// 失败只记日志不中断进程；用户也可随时在页面上手动触发

import cron from 'node-cron'
import { getConnection } from '../config/database'
import { logger } from '../utils/logger'
import { runDailyPipeline } from './tiosService'

export function setupScheduler(): void {
  cron.schedule(
    '0 17 * * 1-5',
    async () => {
      logger.info('定时任务启动：生成全部用户的盘前四问')
      try {
        const conn = getConnection()
        const [rows] = await conn.execute('SELECT DISTINCT user_id FROM positions')
        for (const { user_id } of rows as { user_id: string }[]) {
          try {
            const { report } = await runDailyPipeline(user_id)
            logger.info(`定时生成成功 user=${user_id} date=${report.date}`)
          } catch (err) {
            logger.error(`定时生成失败 user=${user_id}:`, err)
          }
        }
      } catch (err) {
        logger.error('定时任务执行失败:', err)
      }
    },
    { timezone: 'Asia/Shanghai' }
  )
  logger.info('定时任务已注册：工作日17:00（北京时间）自动生成盘前四问')
}
