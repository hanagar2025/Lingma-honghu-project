// 发布前体检
//
// 这个脚本存在的唯一理由：**把"不小心把明文传到公网"变成一件做不到的事。**
//
// 那类事故的特征是没有任何报错 —— 构建成功、页面正常、解锁框照样出现，
// 只是 /data/today.json 还静静躺在那里，谁请求谁就拿到全部持仓与总资产。
// 靠人记得检查是不够的；发布前必须有一道会失败的闸门。
//
// 用法：npm run web:preflight（web:deploy 会自动先跑它）

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const DIST = join(HERE, '..', 'frontend', 'dist')

let failed = 0
const problems = []

function check(name, cond, detail = '') {
  if (cond) {
    console.log(`  ✓ ${name}`)
  } else {
    failed++
    problems.push(`${name}${detail ? ` —— ${detail}` : ''}`)
    console.error(`  ✗ ${name}${detail ? ` —— ${detail}` : ''}`)
  }
}

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

const line = '─'.repeat(66)
console.log(`\n${line}\n发布前体检：这份产物能不能放到公网域名下\n${line}\n`)

if (!existsSync(DIST)) {
  console.error(
    `  ✗ 没有构建产物（${DIST}）\n\n` +
    `  先跑：TIOS_PASSPHRASE='你的口令' npm run web:build\n`
  )
  process.exit(1)
}

const files = walk(DIST)

// ── 一、明文快照绝不能出现在产物里 ──
const plain = join(DIST, 'data', 'today.json')
check(
  '产物中不存在明文快照 data/today.json',
  !existsSync(plain),
  existsSync(plain) ? '这个文件含全部持仓与总资产，公网可直接下载。重新用 TIOS_PASSPHRASE=... 构建' : ''
)

// ── 二、密文快照必须存在且真的是密文 ──
const encPath = join(DIST, 'data', 'today.enc.json')
let enc = null
if (existsSync(encPath)) {
  try { enc = JSON.parse(readFileSync(encPath, 'utf-8')) } catch { enc = null }
}
check('存在密文快照 data/today.enc.json', !!enc, existsSync(encPath) ? '文件存在但不是合法 JSON' : '文件缺失')
if (enc) {
  check('密文标记为 encrypted:true', enc.encrypted === true)
  check('密文含盐、IV 与密文体', !!enc.saltB64 && !!enc.ivB64 && !!enc.dataB64)
  check(
    'PBKDF2 迭代次数不低于 20 万',
    Number(enc.iterations) >= 200_000,
    `当前 ${enc.iterations}`
  )
  check('密文文件里不含口令字段', !('passphrase' in enc) && !('pass' in enc))
}

// ── 三、全量扫描 ──
// 只查密文快照是不够的：构建可能把数据内联进 JS bundle，
// 也可能有人手工往 public/ 放了别的东西。
//
// 两份清单，因为两类字符串的性质不同：
//   - 持仓名出现在任何文件里都是信息泄漏。哪怕只是表单的占位示例，
//     也等于告诉所有人"这个人持有它"。（这条真的抓到过一次。）
//   - 字段名（peakAssets 等）是应用结构的一部分，出现在 JS 里不可避免，
//     但绝不该出现在 data/ 目录的文件里 —— 那说明明文数据混进去了。
const HOLDING_NAMES = [
  '中际旭创', '新易盛', '海光信息', '兆易创新', '澜起科技', '中微公司', '北方华创',
]
const ACCOUNT_FIELDS = ['householdAnnualExpense', 'peakAssets', 'positionsValue', 'portfolio.json']

const isBinary = (f) => /\.(png|jpg|jpeg|gif|webp|svg|woff2?|ttf|ico|map)$/i.test(f)
const leaks = []
const dataLeaks = []
for (const f of files) {
  if (isBinary(f)) continue
  const txt = readFileSync(f, 'utf-8')
  const rel = relative(DIST, f)
  for (const s of HOLDING_NAMES) {
    if (txt.includes(s)) leaks.push(`${rel} 含持仓名「${s}」`)
  }
  if (rel.startsWith('data/') || rel.startsWith(`data\\`)) {
    for (const s of ACCOUNT_FIELDS) {
      if (txt.includes(s)) dataLeaks.push(`${rel} 含账户字段「${s}」`)
    }
  }
}
check(
  '产物中任何文件都不含持仓名（含表单占位示例）',
  leaks.length === 0,
  leaks.slice(0, 5).join('；')
)
check(
  'data/ 目录内不含明文账户字段',
  dataLeaks.length === 0,
  dataLeaks.slice(0, 5).join('；')
)

// ── 四、审计档与台账不得被打包 ──
const strays = files.filter(f => /audits|changelog|discovery|freeze-baseline|\.md$/i.test(f))
check(
  '审计档、变化台账、冻结基线未被打包进产物',
  strays.length === 0,
  strays.slice(0, 5).map(f => relative(DIST, f)).join('；')
)

// ── 五、体积与文件清单概览（便于人眼复核） ──
const total = files.reduce((s, f) => s + statSync(f).size, 0)
console.log(`\n  产物：${files.length} 个文件，共 ${(total / 1024 / 1024).toFixed(2)} MB`)
console.log(`  data/ 目录内容：${readdirSync(join(DIST, 'data')).join('、')}`)

console.log(`\n${line}`)
if (failed > 0) {
  console.error(
    `体检未通过：${failed} 项\n\n` +
    problems.map((p, i) => `  ${i + 1}. ${p}`).join('\n') +
    `\n\n**不要发布这份产物。**\n${line}\n`
  )
  process.exit(1)
}
console.log(
  `体检通过。可以发布 frontend/dist。\n\n` +
  `  仍需人工确认两件事（脚本查不到）：\n` +
  `    1. 托管必须启用 HTTPS。浏览器只在安全上下文提供 WebCrypto，\n` +
  `       http:// 下解密按钮会直接报错 —— 这是硬性技术要求，不只是习惯。\n` +
  `    2. 口令不要与其他账号复用，也不要写进任何提交或聊天记录。\n${line}\n`
)
