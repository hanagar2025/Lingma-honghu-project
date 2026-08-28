// 快照时钟。过期数据必须先看见，不能假装是今天的开盘或收盘。
// 不改看台「必须处理」，不产生新判断。

import React from 'react'
import { Alert, Typography } from 'antd'
import { snapshotClock } from '../utils/clock'

const { Text } = Typography

export interface ClockBannerProps {
  tradeDate?: string | null
  generatedAt?: string | null
  codeCommit?: string | null
  session?: string | null
}

const ClockBanner: React.FC<ClockBannerProps> = ({
  tradeDate, generatedAt, codeCommit, session,
}) => {
  const clock = snapshotClock(tradeDate)
  const sessionText = session === 'PRE_OPEN' || session === 'pre' ? '盘前' : '盘后'
  const when = generatedAt
    ? generatedAt.replace('T', ' ').replace(/\.\d+Z$/, ' UTC')
    : '未知时刻'

  if (clock.isToday) {
    return (
      <Alert
        type="success"
        showIcon
        style={{ marginBottom: 16 }}
        message={<Text strong>这是今天的{sessionText}数据</Text>}
        description={
          <div style={{ fontSize: 13, lineHeight: 1.8 }}>
            <div>
              交易日 {tradeDate}。生成于 {when}
              {codeCommit ? `。代码 ${codeCommit}` : ''}。
              下次自动更新：{clock.nextSlot}。
            </div>
            <div>人看这一页。其他 Agent 用下面的链接，不要发截图。</div>
          </div>
        }
      />
    )
  }

  if (clock.weekend && clock.staleDays !== null && clock.staleDays <= 3) {
    return (
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message={<Text strong>今天休市。最新交易日是 {tradeDate}</Text>}
        description={
          <div style={{ fontSize: 13, lineHeight: 1.8 }}>
            北京今天 {clock.beijingToday}。休市日不覆盖快照，这是正确行为。
            下次自动更新：{clock.nextSlot}。
          </div>
        }
      />
    )
  }

  return (
    <Alert
      type="error"
      showIcon
      style={{ marginBottom: 16 }}
      message={<Text strong>这不是今天的开盘或收盘数据</Text>}
      description={
        <div style={{ fontSize: 13, lineHeight: 1.8 }}>
          <div>
            快照交易日 {tradeDate ?? '未知'}，北京今天 {clock.beijingToday}
            {clock.staleDays !== null ? `，落后 ${clock.staleDays} 天` : ''}。
            生成于 {when}
            {codeCommit ? `。代码 ${codeCommit}` : ''}。
          </div>
          <div style={{ marginTop: 4 }}>
            今日资本状态必须来自最近一次 09:20 盘前或 15:10 盘后。
            过期结论不能当成今天的动作令。研究观察可以停在证据日期；持仓股数以最近账户快照为准。
          </div>
          <div>自动更新应由服务器完成。你不用在代码目录敲命令。</div>
        </div>
      }
    />
  )
}

export default ClockBanner
