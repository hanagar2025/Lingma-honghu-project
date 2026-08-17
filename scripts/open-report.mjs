// 打开当日 HTML 报告，并在文件管理器里定位到它
//
// 这条路是**手机端的兜底方案**：完全不经过网络。
// 局域网访问会被防火墙、访客网络、AP 隔离挡住，而这些都不是代码能修的；
// 隔空投送一个自包含 HTML 文件则没有任何中间环节可失败。

import { execFile } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { platform } from 'node:os'

const HERE = dirname(fileURLToPath(import.meta.url))
const DIR = join(HERE, '..', 'backend', 'src', 'services', 'cockpit', 'data', 'reports')

if (!existsSync(DIR)) {
  process.stderr.write(
    `还没有生成过报告。先跑一次：\n  npm run web:snapshot\n\n` +
    `（它会同时产出 HTML 报告与网页快照）\n`
  )
  process.exit(1)
}

// 取最新一份正式报告。盘中档带"-盘前"后缀，排序时自然落在同日正式档之后，
// 故显式挑不带后缀的那份优先。
const files = readdirSync(DIR).filter(f => f.endsWith('.html')).sort()
if (files.length === 0) {
  process.stderr.write(`${DIR} 里没有 HTML 报告。先跑 npm run web:snapshot\n`)
  process.exit(1)
}
const formal = files.filter(f => /^\d{4}-\d{2}-\d{2}\.html$/.test(f))
const latest = (formal.length ? formal : files)[(formal.length ? formal : files).length - 1]
const full = join(DIR, latest)

const line = '─'.repeat(66)
process.stdout.write(`\n${line}\n手机端兜底方案：隔空投送（完全不经过网络）\n${line}\n\n`)
process.stdout.write(`  当日报告：${full}\n\n`)

const os = platform()
if (os === 'darwin') {
  process.stdout.write(
    `  已在 Finder 中选中该文件。接下来：\n` +
    `    右键 → 共享 → 隔空投送 → 选你的 iPhone\n` +
    `    手机上收到后选"用 Safari 打开"\n\n` +
    `  也可以直接双击在电脑浏览器里看。窄屏已适配，手机上表格横滑即可。\n`
  )
  // -R 在 Finder 中定位并选中文件，而不是直接打开 —— 要投送的是文件本身
  execFile('open', ['-R', full], () => {})
} else if (os === 'win32') {
  process.stdout.write(`  已在资源管理器中选中该文件。\n`)
  execFile('explorer', [`/select,${full}`], () => {})
} else {
  process.stdout.write(`  用浏览器打开上面的路径即可（本机无 Finder/资源管理器）。\n`)
}
process.stdout.write(`${line}\n\n`)
