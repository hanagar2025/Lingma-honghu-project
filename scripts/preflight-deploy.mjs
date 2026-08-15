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
    `  先跑：npm run web:build\n`
  )
  process.exit(1)
}

const files = walk(DIST)

// ── 一、快照必须存在且是合法 JSON ──
// 委员会 2026-08-15 决议去掉口令解锁，故明文快照是**正常且预期**的产物。
// 这一节因此从"禁止明文"改为"确认快照可用" —— 页面能打开但没数据，
// 比页面打不开更难排查：它看起来完全正常，只是所有列都显示"缺失"。
const snap = join(DIST, 'data', 'today.json')
let snapshot = null
if (existsSync(snap)) {
  try { snapshot = JSON.parse(readFileSync(snap, 'utf-8')) } catch { snapshot = null }
}
check('存在快照 data/today.json', !!snapshot,
  existsSync(snap) ? '文件存在但不是合法 JSON' : '文件缺失，先跑 npm run web:snapshot')
if (snapshot) {
  check('快照含交易日期', typeof snapshot.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(snapshot.date),
    String(snapshot.date))
  check('快照含五层驾驶舱数据', !!snapshot.dashboard?.holdings?.length)
  check('快照含今日结论', !!snapshot.verdict?.focus)
  check('快照含外发摘要', typeof snapshot.brief === 'string' && snapshot.brief.length > 1000)
}

// 密文残留会让页面走到已删除的解密路径
const staleEnc = join(DIST, 'data', 'today.enc.json')
check('产物中没有旧的加密快照残留', !existsSync(staleEnc),
  existsSync(staleEnc) ? '口令模式已废弃，请删除该文件后重新构建' : '')

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
// 委员会已决议数据公开无妨，故持仓名出现在 data/ 里是预期的。
// 但出现在 JS 产物里仍属异常 —— 那说明数据被内联进了代码，
// 会导致"改数据必须重新构建"，是个会静默积累的错误。
const inCode = leaks.filter(l => !l.startsWith('data/'))
check(
  '持仓名只出现在 data/ 快照里，未被内联进 JS 产物',
  inCode.length === 0,
  inCode.slice(0, 5).join('；')
)
void dataLeaks  // 账户字段现在允许出现在 data/ 内

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
  `  \x1b[33m本站无口令保护\x1b[0m：持仓、仓位与总资产对任何访问者可见。\n` +
  `  这是 2026-08-15 的明确决议，不是配置遗漏。\n` +
  `  若哪天改变主意，最省事的补救是把站点挪到猜不到的路径下：\n` +
  `    BASE_PATH=/随机串/ ./scripts/deploy-ecs.sh\n${line}\n`
)
