// 一键外发 —— 把当日摘要交给别的软件
//
// 委员会要的是"分享到 ChatGPT / 豆包 / Claude 让它们再分析一遍"。
// 手机上真正能做到"一键到另一个 App"的只有 Web Share API（iOS Safari 支持），
// 它会拉起系统分享面板，里面就有那些 App。桌面浏览器多半不支持，退回复制到剪贴板。
//
// 摘要文本由后端生成并随快照下发（share 字段），前端不自己拼 ——
// 否则同一份数据会有两套措辞，而其中一套迟早会漏掉那段约束前言。
//
// 默认脱敏（无金额、无股数、无总资产）：发给第三方模型的分析
// 只需要百分比与趋势，不需要净值。

import React, { useState } from 'react'
import { Alert, Button, Modal, Space, Typography, message } from 'antd'
import { ShareAltOutlined, CopyOutlined, DownloadOutlined } from '@ant-design/icons'

const { Text, Paragraph } = Typography

export interface ShareButtonProps {
  /** 后端生成的 Markdown 摘要。缺失时按钮不出现 */
  brief?: string | null
  date?: string
}

const ShareButton: React.FC<ShareButtonProps> = ({ brief, date }) => {
  const [open, setOpen] = useState(false)
  if (!brief) return null

  const chars = [...brief].length
  const canShare = typeof navigator !== 'undefined' && !!navigator.share

  const doShare = async () => {
    try {
      await navigator.share({ title: `投资驾驶舱摘要 ${date ?? ''}`, text: brief })
    } catch (e: any) {
      // 用户主动取消分享面板会抛 AbortError —— 那不是失败，不该弹错误提示
      if (e?.name !== 'AbortError') message.error(`分享失败：${e?.message ?? '未知错误'}`)
    }
  }

  const doCopy = async () => {
    try {
      await navigator.clipboard.writeText(brief)
      message.success(`已复制 ${chars.toLocaleString()} 字符，粘贴到对话框即可`)
    } catch {
      // clipboard API 在非安全上下文或权限被拒时不可用。
      // 此时给出可全选的文本框，而不是只说一句"复制失败" —— 那等于没有出路。
      setOpen(true)
    }
  }

  const doDownload = () => {
    const blob = new Blob([brief], { type: 'text/markdown;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `驾驶舱摘要-${date ?? 'today'}.md`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <>
      <Space wrap>
        {canShare && (
          <Button type="primary" icon={<ShareAltOutlined />} onClick={doShare}>
            分享给其他 App
          </Button>
        )}
        <Button icon={<CopyOutlined />} onClick={doCopy}>复制摘要</Button>
        <Button icon={<DownloadOutlined />} onClick={doDownload}>下载 .md</Button>
        <Text type="secondary" style={{ fontSize: 12 }}>
          {chars.toLocaleString()} 字符 · 已脱敏（无金额与总资产）· 含约束前言
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
          浏览器拒绝了剪贴板权限（通常是非 HTTPS 页面）。请全选下面内容手动复制。
        </Paragraph>
        <textarea
          readOnly
          value={brief}
          onFocus={e => e.currentTarget.select()}
          style={{
            width: '100%', height: 360, fontSize: 12, lineHeight: 1.6,
            fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          }}
        />
      </Modal>
    </>
  )
}

export default ShareButton

export const ShareHint: React.FC = () => (
  <Alert
    type="info"
    showIcon
    style={{ marginBottom: 16 }}
    message="把数据交给别的软件再分析一遍"
    description={
      <div style={{ fontSize: 13, lineHeight: 1.9 }}>
        摘要是 Markdown：大模型对它的解析最稳，token 效率也高于 JSON。
        完整快照有 5 万字符以上，其中大半是每个指标的来源与算法 ——
        对人有用，对模型是噪声，还会把信号淹掉。
        <div style={{ marginTop: 4 }}>
          摘要开头带一段约束前言（不预测涨跌、观察指标不得产生动作、不许输出综合评分、
          「不可判断」是合法结论）。<Text strong>不要删掉它</Text> ——
          否则外部模型读完第一句就会给你择时建议，而那正是这套系统要抵抗的东西。
        </div>
        <div style={{ marginTop: 4 }}>
          要用 Excel 或 pandas 算，在电脑上跑 <Text code>npm run share</Text>，
          会另出持仓与产业节点两个 CSV。
        </div>
      </div>
    }
  />
)
