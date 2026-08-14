// 口令解锁界面
//
// 这不是"登录框"。没有账号、没有服务端校验、没有会话：
// 页面拿到的本来就是一坨密文，口令只在浏览器内存里派生出密钥解开它。
// 因此口令错的唯一后果是解不开，不存在"绕过前端就能看到数据"这条路 ——
// 而那恰恰是前端密码框最常见的假象。
//
// 刻意不提供"记住口令"：存进 localStorage 等于把加密降级成 URL 保密，
// 而 URL 保密在公网域名下几乎等于没有保护。
//
// 但**系统钥匙串是另一回事**，而且必须支持：
// 好记与高熵是互斥的，任何背得下来的口令熵都有限。出路是用一串真随机口令
// 并交给 iOS/macOS 钥匙串保管、用 Face ID 调出来 —— 那是操作系统级的加密存储，
// 与"我们自己把明文塞进 localStorage"完全不同。
// 为此表单必须写成规范的 form + autoComplete="current-password"，
// 否则 Safari 不会提示保存，用户就只能退回去背一个弱口令。

import React, { useState } from 'react'
import { Alert, Button, Card, Input, Space, Typography } from 'antd'
import { LockOutlined } from '@ant-design/icons'

const { Title, Text, Paragraph } = Typography

export interface UnlockGateProps {
  /** 密文的生成时间，明文可读 —— 让人在解密前就能确认这是哪天的快照 */
  generatedAt?: string
  /** 返回 false 表示口令不对，由本组件负责展示错误并保留输入 */
  onUnlock: (passphrase: string) => Promise<string | null>
}

const UnlockGate: React.FC<UnlockGateProps> = ({ generatedAt, onUnlock }) => {
  const [pass, setPass] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!pass) return
    setBusy(true)
    setErr(null)
    // 让浏览器先把 loading 状态画出来：PBKDF2 六十万次会占住主线程数百毫秒，
    // 期间点击无反应，若没有可见的 loading 就会被当成"按钮坏了"而反复点击。
    await new Promise(r => setTimeout(r, 30))
    try {
      setErr(await onUnlock(pass))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, background: '#f2f2f7' }}>
      <Card style={{ maxWidth: 520, width: '100%' }}>
        <Space direction="vertical" size="middle" style={{ width: '100%' }}>
          <Space>
            <LockOutlined style={{ fontSize: 20 }} />
            <Title level={4} style={{ margin: 0 }}>驾驶舱已加密</Title>
          </Space>

          <Paragraph type="secondary" style={{ fontSize: 13, marginBottom: 0 }}>
            本页数据以 AES-GCM 加密后静态托管。口令不在服务器上，也不在这个文件里 ——
            服务端自己也解不开。输入口令后由浏览器在本地解密，口令不会被上传或保存。
          </Paragraph>

          {generatedAt && (
            <Text type="secondary" style={{ fontSize: 12 }}>
              快照生成时间：{new Date(generatedAt).toLocaleString('zh-CN')}
            </Text>
          )}

          {/* 规范表单：Safari 据此提示"存入钥匙串"，之后可用 Face ID 自动填入。
              少了 form 或 autoComplete，提示不会出现，人就只能退回去背弱口令。 */}
          <form onSubmit={submit} style={{ width: '100%' }}>
            {/* 钥匙串需要一个用户名字段来归档条目。固定值即可，不参与解密。 */}
            <input
              type="text"
              name="username"
              autoComplete="username"
              value="cockpit"
              readOnly
              hidden
            />
            <Input.Password
              autoFocus
              size="large"
              name="password"
              autoComplete="current-password"
              placeholder="输入口令"
              value={pass}
              disabled={busy}
              onChange={e => setPass(e.target.value)}
            />

            {err && <Alert type="error" showIcon message={err} style={{ marginTop: 12 }} />}

            <Button
              type="primary" size="large" block loading={busy}
              htmlType="submit" disabled={!pass}
              style={{ marginTop: 12 }}
            >
              {busy ? '正在解密（密钥派生需要几百毫秒）' : '解锁'}
            </Button>
          </form>

          <Text type="secondary" style={{ fontSize: 12 }}>
            本页不保存口令，每次刷新都要重新提供 —— 把它写进网页存储等于把加密
            降级成"URL 没人知道"。但可以让 Safari 存进「系统钥匙串」，
            之后用 Face ID 自动填入：那是操作系统的加密存储，与本页无关。
            建议配一串真随机口令交给钥匙串，别用背得下来的。
          </Text>
        </Space>
      </Card>
    </div>
  )
}

export default UnlockGate
