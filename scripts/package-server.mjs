// 打一个可以直接拷到服务器上运行的包。
//
// 服务器连不上 GitHub，也不该在上面装构建工具。所以在本机把后端打成一个文件、
// 把页面构建好，一起打包。服务器上只需要 Node.js 18 以上，不需要 npm install。
//
// 用法：
//   node scripts/package-server.mjs           打包到 release/honghu-<版本>.tar.gz
//   node scripts/package-server.mjs --smoke   打包后在本机起一次服务，确认包能跑
//
// 包里有：server.mjs（后端）、web/（页面）、install.sh（服务器上的安装脚本）、
// seed-ledger.json（仓库里的旧账本，首次安装时作为峰值与口径的种子）、VERSION。

import { build } from 'esbuild'
import { execFileSync, spawn } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const RELEASE = join(ROOT, 'release')
const OUT = join(RELEASE, 'honghu')

function git(...args) {
  try {
    return execFileSync('git', args, { cwd: ROOT, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return ''
  }
}

const commit = git('rev-parse', '--short', 'HEAD') || 'unknown'
const dirty = git('status', '--porcelain', '--untracked-files=no') ? '-dirty' : ''
const version = `${commit}${dirty}`

rmSync(RELEASE, { recursive: true, force: true })
mkdirSync(OUT, { recursive: true })

execFileSync('npm', ['run', 'build', '--workspace', 'frontend'], { cwd: ROOT, stdio: 'inherit' })
cpSync(join(ROOT, 'frontend', 'dist'), join(OUT, 'web'), { recursive: true })

await build({
  entryPoints: [join(ROOT, 'backend', 'src', 'index.ts')],
  outfile: join(OUT, 'server.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node18',
  // express 及其依赖是 CommonJS，打进 ESM 文件后仍会调用 require 取 Node 内置模块
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
  define: { 'process.env.HONGHU_VERSION': JSON.stringify(version) },
  legalComments: 'none',
  logLevel: 'warning',
})

cpSync(join(ROOT, 'scripts', 'install-on-server.sh'), join(OUT, 'install.sh'))
const seed = join(ROOT, 'backend', 'src', 'services', 'dailyDecision', 'data', 'portfolio.json')
if (existsSync(seed)) cpSync(seed, join(OUT, 'seed-ledger.json'))
writeFileSync(join(OUT, 'VERSION'), `${version}\n`)

const tarball = join(RELEASE, `honghu-${version}.tar.gz`)
// COPYFILE_DISABLE：不让 macOS 的 tar 往包里塞 ._ 开头的属性文件
execFileSync('tar', ['czf', tarball, '-C', RELEASE, 'honghu'], { env: { ...process.env, COPYFILE_DISABLE: '1' } })
console.log(`已打包：${tarball}（版本 ${version}）`)

if (process.argv.includes('--smoke')) {
  const data = mkdtempSync(join(tmpdir(), 'honghu-smoke-'))
  const port = 20000 + Math.floor(Math.random() * 20000)
  const token = 'smoke-test-token-0000000001'
  // 从包目录之外启动，且不带仓库的 node_modules：确认这个文件自己就能跑
  const child = spawn(process.execPath, [join(OUT, 'server.mjs')], {
    cwd: data,
    env: { PATH: process.env.PATH, DATA_DIR: data, COMMITTEE_TOKEN: token, PORT: String(port), WEB_DIR: join(OUT, 'web') },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let log = ''
  child.stdout.on('data', d => { log += d })
  child.stderr.on('data', d => { log += d })
  const base = `http://127.0.0.1:${port}`
  const problems = []
  try {
    let up = false
    for (let i = 0; i < 50 && !up; i++) {
      await new Promise(r => setTimeout(r, 200))
      up = await fetch(`${base}/health`).then(r => r.ok, () => false)
    }
    if (!up) throw new Error('服务没有起来')
    const health = await (await fetch(`${base}/health`)).json()
    if (health.version !== version) problems.push(`版本不对：${health.version}`)
    const page = await fetch(`${base}/`)
    if (!page.ok || !(await page.text()).includes('<div id="root">')) problems.push('页面没有出来')
    if ((await fetch(`${base}/api/state`)).status !== 401) problems.push('不带口令也能读')
    const state = await fetch(`${base}/api/state`, { headers: { Authorization: `Bearer ${token}` } })
    if (!state.ok || !(await state.json()).card?.title) problems.push('带口令读不出执行单')
    const sent = await fetch(`${base}/api/intake`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '冒烟测试留言' }),
    })
    if (!sent.ok || (await sent.json()).submission?.status !== 'RECORDED') problems.push('提交文字失败')
  } catch (e) {
    problems.push(e instanceof Error ? e.message : String(e))
  } finally {
    child.kill()
    rmSync(data, { recursive: true, force: true })
  }
  if (problems.length) {
    console.error(`✗ 包不能用：${problems.join('；')}\n${log}`)
    process.exit(1)
  }
  console.log('✓ 包在本机起得来：健康检查、页面、口令、读执行单、提交文字均正常')
}
