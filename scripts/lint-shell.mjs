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

import { readFileSync, readdirSync } from 'node:fs'
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

if (problems > 0) {
  console.error(`\n✗ ${problems} 处问题\n`)
  process.exit(1)
}
console.log(`✓ ${files.length} 个 shell 脚本检查通过`)
