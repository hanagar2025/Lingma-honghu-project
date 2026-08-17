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
// 范围一度只有 frontend/src 与 cockpit/ —— 定义依据是"哪些目录会输出 UI 文本"。
// 但这个集合会长：research/hypotheses.ts 新增后立刻输出到 CLI 与 HTML，
// 而它不在范围内，于是带 ** 的字符串一路混到 HTML 里没被拦住。
// 改为扫 backend/src/services 全部 —— 任何一个服务都可能把文本送到界面上，
// 靠人记得"新目录要加进白名单"是靠不住的。
const UI_DIRS = [
  join(HERE, '..', 'frontend', 'src'),
  join(HERE, '..', 'backend', 'src', 'services'),
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

// ── 四、shell 里不得使用从未赋值的变量 ──
//
// 这条来自连续三次事故：`w?: unbound variable`、`KEY?`、以及删整段代码时
// 把 `TARBALL=` 的赋值一起带走，于是后面 scp 处报 `TARBALL: unbound variable`。
//
// 三次都只在委员会执行时才暴露，因为 `bash -n` 只查语法 ——
// 未定义变量在 `set -u` 下是**运行时**错误。而这类错误可以静态查出来：
// 凡 $VAR 形式的使用，VAR 必须在同文件里被赋值过，或属于环境/特殊变量。
//
// 刻意跳过带引号的 heredoc（<<'X'）：那里的变量在远端展开，本地无从判断。
// 这也是本项目里最常见的写法，若不跳过会得到满屏假报。
const SHELL_ALLOW = new Set([
  'HOME', 'USER', 'PATH', 'SHELL', 'PWD', 'OLDPWD', 'IFS', 'TZ', 'LANG', 'TERM',
  'BASH_SOURCE', 'BASH_VERSION', 'LINENO', 'RANDOM', 'SECONDS', 'PPID', 'UID',
  'FUNCNAME', 'REPLY', 'EDITOR', 'TMPDIR', 'LOGNAME', 'HOSTNAME',
])

/** 去掉带引号的 heredoc 体：其中的变量由远端展开 */
function stripQuotedHeredocs(src) {
  const lines = src.split('\n')
  const out = []
  let end = null
  for (const l of lines) {
    if (end !== null) {
      if (l.trim() === end) { end = null; out.push('') }
      else out.push('')
      continue
    }
    const m = /<<[-]?\s*'([A-Za-z_][A-Za-z0-9_]*)'/.exec(l)
    if (m) { end = m[1]; out.push(l.replace(/<<[-]?\s*'[^']*'/, '')); continue }
    out.push(l)
  }
  return out.join('\n')
}

for (const f of files) {
  // 「不要对 shell 套用 C 风格块注释剥离」。
  //
  // 这里原本有一句 .replace(/\/\*[\s\S]*?\*\//g, '')。shell 没有块注释，
  // 而 `/*` 在 shell 里是路径通配符（"$ROOT"/frontend/release/*.tar.gz），
  // `*/` 也会出现在 sed 表达式里（s/.*<title>...<\/title>.*/\1/p）。
  //
  // 后果不是报错，而是**静默删码**：实测 deploy-ecs.sh 有 269 行
  // （其中 168 行真代码）被当成一个巨大的块注释吃掉，
  // 那些行因此完全不受任何检查覆盖 —— 未括号变量、未赋值变量、Markdown 星号全都查不到。
  //
  // 更隐蔽的是它是潜伏的：在文件里出现第一个 `*/` 之前，正则匹配不到，什么也不删。
  // 是一次无关的编辑（给标题提取加了 sed）才让删除生效。
  // 「一个会静默缩小自身覆盖范围的检查器，比没有检查器更糟」——
  // 它给出的"通过"是关于一份被截断的文件的。
  const raw = readFileSync(f, 'utf-8')
  const src = stripQuotedHeredocs(
    raw.split('\n').map(l => (/^\s*#/.test(l) ? '' : l)).join('\n')
  )

  // ── 检查器自检：预处理不得改变行数 ──
  //
  // 本文件的两步预处理（注释置空、带引号 heredoc 置空）都是**逐行置空**，
  // 设计上保持行数不变。行数一旦变了，说明有某一步在整段删内容 ——
  // 而整段删掉的部分会静默逃过后面所有检查，同时让报错行号全部错位。
  //
  // 这道自检是三次同类事故之后加的：
  //   一次 lint 范围只覆盖两个目录，新目录的问题查不到
  //   一次禁字检查扫整篇，把"说明"当成"违规"
  //   一次对 shell 套用 C 风格块注释剥离，静默吃掉 269 行
  // 三次的共同点是「检查器自身的覆盖范围出了问题，而它照样报告通过」。
  if (src.split('\n').length !== raw.split('\n').length) {
    problems++
    console.error(
      `${f.replace(join(HERE, '..'), '.')}  检查器预处理改变了行数\n`
      + `    原文 ${raw.split('\n').length} 行 → 预处理后 ${src.split('\n').length} 行。\n`
      + '    预处理必须逐行置空、保持行数：否则被删的整段会逃过全部检查，\n'
      + '    而报错行号也会错位。请检查 lint-source.mjs 的预处理步骤。\n'
    )
  }

  const assigned = new Set(SHELL_ALLOW)
  for (const re of [
    /^\s*(?:export\s+|local\s+|declare\s+(?:-\w+\s+)?|readonly\s+)?([A-Za-z_][A-Za-z0-9_]*)\+?=/gm,
    /^\s*for\s+([A-Za-z_][A-Za-z0-9_]*)\s+in\b/gm,
    // read 后面可以跟多个变量名（read -r code name qty ...），必须全部收下。
    // 只捕获第一个会把后面那些误判成未赋值 —— seed 脚本上就这么误报了 7 次。
    /\bread\s+((?:-\w+\s+)*(?:-p\s+"[^"]*"\s+)?[A-Za-z_][A-Za-z0-9_ ]*)/g,
  ]) {
    for (const m of src.matchAll(re)) {
      // 一次匹配可能含多个变量名（read 的情形），逐个拆开
      for (const name of m[1].split(/\s+/)) {
        if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) assigned.add(name)
      }
    }
  }

  // 使用：$VAR 与 ${VAR}。带默认值/替换的形式（${VAR:-x} 等）在 set -u 下安全，故排除。
  const used = new Map()
  for (const m of src.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g)) {
    const name = m[1] ?? m[2]
    // ${VAR:-...} / ${VAR:?...} / ${VAR#...} 之类：前面已被 ${VAR} 分支排除，
    // 这里再挡一次带修饰符的情况
    const after = src.slice(m.index + m[0].length - 1, m.index + m[0].length + 1)
    if (m[1] && /^[:\-+?#%\/^,]/.test(after)) continue
    if (!assigned.has(name) && !used.has(name)) {
      const lineNo = src.slice(0, m.index).split('\n').length
      used.set(name, lineNo)
    }
  }
  // 带修饰符的形式在正则里不会匹配到 ${VAR}，需单独确认没有误报
  for (const [name, lineNo] of used) {
    if (new RegExp(`\\$\\{${name}[:\\-+?#%/^,]`).test(src)) continue
    problems++
    console.error(
      `${f.replace(join(HERE, '..'), '.')}:${lineNo}  使用了从未赋值的变量 $${name}\n`
      + `    set -u 下这是运行时错误（bash -n 查不出来），只会在别人执行时暴露。\n`
      + `    要么补上赋值，要么写成 \${${name}:-默认值}。\n`
    )
  }
}

// ── 五、被引用的 npm 脚本必须真的存在 ──
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
