// 打印手机可访问的局域网地址，并渲染成二维码
//
// 为什么要二维码：上一轮失败的直接原因是把文档里的占位写法 `192.168.1.x`
// 当成真地址输进了手机。只要还需要人手抄一串数字，这类错误就会重复发生。
// 扫码把"读地址 → 记住 → 在手机上输入"三步压成一步。
//
// 两份码：终端里印一份（快），另存一份 PNG 并在 macOS 上自动打开（一定能扫）。
// 终端版用半块字符把两行压成一行，在某些终端的行距下会被拉变形而扫不出来；
// PNG 没有这个问题。宁可多给一份，也不要让人卡在"码扫不出来"上。
//
// 同时把最常见的连不上原因写在旁边（都不是代码问题，只能靠提示）：
//   一、跑的是 npm run web 而不是 web:lan —— 前者只监听 localhost，手机连不上；
//   二、macOS 防火墙拦了 node 的入站连接；
//   三、访客网络或路由器的 AP 隔离禁止设备互访。

import { execFile } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { networkInterfaces, platform, tmpdir } from 'node:os'
import { join } from 'node:path'

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
  // 常见物理网卡优先（en0 通常是 Mac 的 WiFi），虚拟网卡排后面
  const rank = (n) => (/^en0$/.test(n) ? 0 : /^en\d/.test(n) ? 1 : /^wl/.test(n) ? 1 : 5)
  return out.sort((a, b) => rank(a.name) - rank(b.name))
}

/**
 * 二维码是锦上添花，地址是刚需。
 * 若 qrcode 没装（例如 pull 之后没重跑 npm install），绝不能连地址一起吞掉 ——
 * 那会把一个"少个二维码"的小问题变成"完全不知道该访问哪里"的大问题。
 */
async function loadQR() {
  try {
    return (await import('qrcode')).default
  } catch {
    return null
  }
}

const line = '─'.repeat(66)
const found = lanAddresses()
const os = platform()

process.stdout.write(`\n${line}\n手机访问（需与电脑连同一个 WiFi）\n${line}\n`)

if (found.length === 0) {
  process.stdout.write(
    '\n  未找到局域网地址：可能没连 WiFi，或只有虚拟网卡。\n\n' +
    '  改走不需要网络的那条路 —— 运行 npm run report 打开报告文件夹，\n' +
    '  把当日 HTML 隔空投送到手机，用 Safari 打开。完全离线，一定能看到。\n' +
    `${line}\n\n`
  )
  process.exit(0)
}

const QRCode = await loadQR()
const primary = found[0]
const primaryUrl = `http://${primary.address}:${PORT}`

for (const f of found.slice(0, 2)) {
  const url = `http://${f.address}:${PORT}`
  process.stdout.write(`\n  ${url}    （网卡 ${f.name}）\n`)
  if (!QRCode) continue
  // 顶格输出且保留 margin：二维码四周需要空白静区，
  // 若加缩进，左侧会被终端背景色顶掉一列，扫描就可能失败。
  process.stdout.write('  用手机相机扫下面这个码，会直接打开：\n')
  process.stdout.write(await QRCode.toString(url, { type: 'terminal', small: true, margin: 2 }))
}

if (found.length > 2) {
  process.stdout.write(
    `\n  另有 ${found.length - 2} 个地址（多为虚拟网卡，一般用不到）：` +
    `${found.slice(2).map(f => `${f.address}(${f.name})`).join('、')}\n`
  )
}

if (QRCode) {
  const dir = join(tmpdir(), 'tios-qr')
  mkdirSync(dir, { recursive: true })
  const png = join(dir, `lan-${primary.address.replace(/\./g, '-')}-${PORT}.png`)
  await QRCode.toFile(png, primaryUrl, { margin: 2, scale: 8 })
  process.stdout.write(`\n  终端里的码扫不出来时，用这张图片扫（清晰得多）：\n    ${png}\n`)
  if (os === 'darwin') {
    process.stdout.write('    已自动用「预览」打开。\n')
    execFile('open', [png], () => {})
  }
} else {
  process.stdout.write(
    `\n  （未安装 qrcode，只显示地址不显示二维码。跑一次 npm install 即可有码。）\n`
  )
}

process.stdout.write(
  `\n  连不上时按顺序查这三条：\n` +
  `    1. 确认跑的是 npm run web:lan。npm run web 只监听 localhost，手机连不上。\n` +
  `    2. 手机与电脑必须在同一个 WiFi；访客网络与部分路由器的"AP 隔离"会挡住互访。\n`
)
process.stdout.write(
  os === 'darwin'
    ? `    3. macOS 防火墙：系统设置 → 网络 → 防火墙 → 选项，允许 node 接受传入连接。\n`
    : `    3. 本机防火墙是否放行了 ${PORT} 端口的入站连接。\n`
)
process.stdout.write(
  `\n  三条都排除还是不行，就走 npm run report 隔空投送 HTML —— 那条路不经过网络。\n\n` +
  `  这是局域网地址，不是公网链接：离开这个 WiFi 就打不开，外网访问不到。\n` +
  `  对一个显示全部持仓与总资产的页面来说，这个限制是特性而不是缺陷。\n${line}\n\n`
)
