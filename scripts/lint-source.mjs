// Shell 脚本静态检查
//
// 只查一类问题，但这一类真的把部署卡住过：
//
//   die "口令里含「$w」"
//
// `$w` 后面紧跟全角字符「，某些 bash 会把后续字节一起当成变量名，
// 于是在 set -u 下报 `w?: unbound variable` —— 而报错信息里的 `w?`
// 完全指不到"是中文标点挨着变量"这个原因。
// 本仓库的脚本里中文很多，这类相邻几乎必然反复出现，所以做成机械检查。
//
// 修法永远是加花括号：${w}。
//
// 运行：node scripts/lint-shell.mjs

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const files = readdirSync(HERE).filter(f => f.endsWith('.sh')).map(f => join(HERE, f))

// 裸 $VAR（无花括号）紧跟一个非 ASCII 字符
const BARE_VAR_BEFORE_CJK = /\$[A-Za-z_][A-Za-z0-9_]*(?=[^\x00-\x7F])/

let problems = 0
for (const f of files) {
  const lines = readFileSync(f, 'utf-8').split('\n')
  lines.forEach((line, i) => {
    // 注释行不影响运行，跳过
    if (/^\s*#/.test(line)) return
    const m = BARE_VAR_BEFORE_CJK.exec(line)
    if (!m) return
    problems++
    const name = m[0].slice(1)
    console.error(
      `${f.replace(HERE, 'scripts')}:${i + 1}  裸 ${m[0]} 紧邻非 ASCII 字符\n`
      + `    ${line.trim()}\n`
      + `    改为 \${${name}} —— 否则某些 bash 会把后续字节并入变量名，\n`
      + `    在 set -u 下报 "${name}?: unbound variable"，而报错指不到真正原因。\n`
    )
  })
}

// 顺带查一条：set -euo pipefail 必须在第一条可执行语句之前设好。
// 不限定前 N 行 —— 本仓库的脚本头部有长篇注释解释设计取舍，
// 按行数卡会把"注释写得详细"误判成"没设严格模式"。
for (const f of files) {
  const lines = readFileSync(f, 'utf-8').split('\n')
  const firstCode = lines.findIndex(
    l => l.trim() && !l.trim().startsWith('#')
  )
  const before = lines.slice(0, firstCode + 1).join('\n')
  if (!/set -euo pipefail/.test(before)) {
    console.error(
      `${f.replace(HERE, 'scripts')}  第一条可执行语句之前没有 set -euo pipefail\n`
      + `    没有 -e 时，中间某步失败仍会继续往下跑 —— 部署脚本尤其危险。\n`
    )
    problems++
  }
}

// ── 三、界面文案里的 Markdown 星号 ──
//
// 写 `**重点**` 是写文档的肌肉记忆，但 HTML 与 React 不渲染它 ——
// 页面上会老老实实显示两个星号。这个错误犯过两次（HTML 报告一次、解锁页一次），
// 且只有截图才看得出来，代码评审时完全不显眼，故做成机械检查。
// 要强调就用「」。
const UI_DIRS = [
  join(HERE, '..', 'frontend', 'src'),
  join(HERE, '..', 'backend', 'src', 'services', 'cockpit'),
]

function walk(dir, out = []) {
  let entries
  try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return out }
  for (const e of entries) {
    const p = join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p)
  }
  return out
}

/** 去掉注释：JSDoc 里的 `**` 是合法的块注释语法，不是界面文案 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
}

let uiFiles = 0
// shell 脚本也算界面：终端同样不渲染 Markdown。
// 漏掉它们的后果实测过一次 —— 部署脚本的干跑输出里赫然印着两个星号。
/**
 * 显式豁免标记。
 *
 * 有的文件**就是要**生成 Markdown（share.ts 导出给大模型与 Markdown 阅读器读的摘要），
 * 那里的 `**` 会被正确渲染，不是 bug。
 * 做成文件顶部的显式声明而不是放宽规则：可以随时 grep 出谁声明了豁免，
 * 而放宽规则会让真正的错误重新溜回来。
 */
const EXEMPT = '// lint-source: emits-markdown'

const uiTargets = [...UI_DIRS.flatMap(d => walk(d)), ...files]
for (const f of uiTargets) {
  uiFiles++
  const raw = readFileSync(f, 'utf-8')
  if (raw.includes(EXEMPT)) continue
  const isShell = f.endsWith('.sh')
  const code = isShell
    // shell 只有 # 注释；不能套用 // 与 /* */ 的剥离规则，
    // 否则 URL 里的 // 会把整行后半截当成注释吃掉。
    ? readFileSync(f, 'utf-8').split('\n').map(l => (/^\s*#/.test(l) ? '' : l)).join('\n')
    : stripComments(readFileSync(f, 'utf-8'))
  code.split('\n').forEach((line, i) => {
    if (!/\*\*/.test(line)) return
    problems++
    console.error(
      `${f.replace(join(HERE, '..'), '.')}:${i + 1}  界面文案里有 Markdown 星号\n`
      + `    ${line.trim().slice(0, 110)}\n`
      + `    HTML、React 与终端都不渲染 ** —— 会原样显示成两个星号。要强调请用「」。\n`
    )
  })
}

// ── 四、被引用的 npm 脚本必须真的存在 ──
//
// 这条检查来自一次真实事故：README 与对话里都写了 `npm run ship`，
// 而添加它的那步命令因为 && 链在前一步失败时中断，从未执行。
// 之后我只验证了 `./scripts/ship.sh` 能跑，没验证 `npm run ship` ——
// 于是给出去的命令直接报 Missing script。
//
// 教训是"验证等价命令不算验证"，而这件事可以机械化：
// 凡文档与脚本里出现的 npm run X，X 必须在某个 package.json 的 scripts 里。
const PKGS = ['package.json', 'backend/package.json', 'frontend/package.json']
const known = new Set()
for (const rel of PKGS) {
  const p = join(HERE, '..', rel)
  if (!existsSync(p)) continue
  for (const k of Object.keys(JSON.parse(readFileSync(p, 'utf-8')).scripts ?? {})) known.add(k)
}

const REF_FILES = [join(HERE, '..', 'README.md'), ...files, ...UI_DIRS.flatMap(d => walk(d))]
const missing = new Map()
for (const f of REF_FILES) {
  if (!existsSync(f)) continue
  const txt = readFileSync(f, 'utf-8')
  for (const m of txt.matchAll(/npm run (?:--silent )?(?:-s )?([a-z][a-z0-9:_-]*)/g)) {
    const name = m[1]
    // -w <workspace> 形式与占位示例不查
    if (name === 'dev' && /npm run dev --workspace/.test(txt)) continue
    if (!known.has(name)) {
      if (!missing.has(name)) missing.set(name, [])
      missing.get(name).push(f.replace(join(HERE, '..'), '.'))
    }
  }
}
for (const [name, where] of missing) {
  problems++
  console.error(
    `引用了不存在的 npm 脚本「${name}」\n`
    + `    出现在：${[...new Set(where)].slice(0, 4).join('、')}\n`
    + `    package.json 里没有它 —— 照文档执行会直接报 Missing script。\n`
  )
}

if (problems > 0) {
  console.error(`\n✗ ${problems} 处问题\n`)
  process.exit(1)
}
console.log(`✓ ${files.length} 个 shell 脚本 + ${uiFiles} 个源文件检查通过`)
