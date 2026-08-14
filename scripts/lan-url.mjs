// 打印手机可访问的局域网地址
//
// Vite 自己也会印 Network URL，但它印在一堆启动日志中间，
// 而这一步的目的是"拿手机扫一眼就能打开"，所以单独醒目地印一次，
// 并把安全边界一起讲清楚：局域网 ≠ 公网，同一个 WiFi 下才通。

import { networkInterfaces } from 'node:os'

const PORT = process.env.PORT ?? 5173

function lanAddresses() {
  const out = []
  for (const [name, addrs] of Object.entries(networkInterfaces())) {
    for (const a of addrs ?? []) {
      if (a.family !== 'IPv4' || a.internal) continue
      // 只认私有网段。公网 IP 出现在这里通常意味着机器直接暴露在互联网上，
      // 那种情况下不该由这个脚本给出"可以打开"的暗示。
      const isPrivate =
        a.address.startsWith('192.168.') ||
        a.address.startsWith('10.') ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(a.address)
      if (isPrivate) out.push({ name, address: a.address })
    }
  }
  return out
}

const found = lanAddresses()
const line = '─'.repeat(64)

process.stdout.write(`\n${line}\n手机访问地址（需与电脑连同一个 WiFi）\n${line}\n`)

if (found.length === 0) {
  process.stdout.write(
    '  未找到局域网地址。可能是没连 WiFi，或只有虚拟网卡。\n' +
    '  可改用另一条路：把 backend/src/services/cockpit/data/reports/ 里的\n' +
    '  当日 HTML 隔空投送到手机，用 Safari 打开，完全不需要网络。\n'
  )
} else {
  for (const f of found) {
    process.stdout.write(`  http://${f.address}:${PORT}    （网卡 ${f.name}）\n`)
  }
  process.stdout.write(
    `\n  注意这是**局域网地址，不是公网链接**：\n` +
    `  离开这个 WiFi 就打不开，外网也访问不到。\n` +
    `  对一个显示全部持仓与总资产的页面来说，这个限制是特性而不是缺陷。\n`
  )
}
process.stdout.write(`${line}\n\n`)
