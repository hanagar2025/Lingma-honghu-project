// 把当日结果交给其他 Agent。
//
// 人看驾驶舱。模型读一个稳定链接，不要读截图，也不要读带装饰的长文。
// 链接指向同一份已经算好的结果。前端不自己拼摘要。

import React, { useState } from 'react'
import { Alert, Button, Modal, Space, Typography, message } from 'antd'
import { ShareAltOutlined, CopyOutlined, LinkOutlined } from '@ant-design/icons'

const { Text, Paragraph } = Typography

export function agentShareUrl(): string {
  const base = (import.meta.env.BASE_URL ?? '/').replace(/\/?$/, '/')
  const path = `${base}data/today.agent.md`.replace(/\/{2,}/g, '/')
  if (typeof window === 'undefined') return path
  return `${window.location.origin}${path}`
}

export interface ShareButtonProps {
  brief?: string | null
  date?: string
}

const ShareButton: React.FC<ShareButtonProps> = ({ brief, date }) => {
  const [open, setOpen] = useState(false)
  const url = agentShareUrl()
  const canShare = typeof navigator !== 'undefined' && !!navigator.share

  const doCopyUrl = async () => {
    try {
      await navigator.clipboard.writeText(url)
      message.success('已复制 Agent 链接。发给其他 Agent 即可')
    } catch {
      setOpen(true)
    }
  }

  const doShare = async () => {
    try {
      await navigator.share({
        title: `鸿鹄理财 ${date ?? ''}`.trim(),
        text: '同一份已经算好的结果。人看驾驶舱。你只审这份数据。',
        url,
      })
    } catch (e: any) {
      if (e?.name !== 'AbortError') message.error(`分享失败：${e?.message ?? '未知错误'}`)
    }
  }

  const doCopyBrief = async () => {
    if (!brief) return
    try {
      await navigator.clipboard.writeText(brief)
      message.success(`已复制 ${[...brief].length.toLocaleString()} 字符。对方若不能打开链接，再粘这段`)
    } catch {
      setOpen(true)
    }
  }

  return (
    <>
      <Space wrap>
        <Button type="primary" icon={<LinkOutlined />} onClick={doCopyUrl}>
          复制 Agent 链接
        </Button>
        {canShare && (
          <Button icon={<ShareAltOutlined />} onClick={doShare}>
            分享给其他 App
          </Button>
        )}
        {brief && (
          <Button icon={<CopyOutlined />} onClick={doCopyBrief}>
            复制摘要正文
          </Button>
        )}
        <Text type="secondary" style={{ fontSize: 12 }}>
          {url}
        </Text>
      </Space>

      <Modal
        open={open}
        onCancel={() => setOpen(false)}
        footer={null}
        title="手动复制"
        width={760}
      >
        <Paragraph type="secondary" style={{ fontSize: 12 }}>
          浏览器拒绝了剪贴板权限。请全选下面内容手动复制。
        </Paragraph>
        <textarea
          readOnly
          value={url}
          onFocus={e => e.currentTarget.select()}
          style={{
            width: '100%', height: 80, fontSize: 12, lineHeight: 1.6,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          }}
        />
      </Modal>
    </>
  )
}

export default ShareButton

export const ShareHint: React.FC = () => {
  const url = agentShareUrl()
  return (
    <Alert
      type="info"
      showIcon
      style={{ marginBottom: 16 }}
      message="把数据交给别的软件再分析一遍"
      description={
        <div style={{ fontSize: 13, lineHeight: 1.9 }}>
          人看驾驶舱。其他 Agent 打开这个链接：
          <div>
            <Text copyable={{ text: url }} code>{url}</Text>
          </div>
          链接里是同一份已经算好的结果：约束、结论、变化、缺口。没有给人看的装饰。
          不要把看台截图发给模型。
          <div style={{ marginTop: 4 }}>
            摘要开头的约束不要删：不预测涨跌、观察指标不得产生动作、不许输出综合评分、
            「不可判断」是合法结论。
          </div>
        </div>
      }
    />
  )
}
