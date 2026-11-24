// 打一个可以直接拷到服务器上运行的包。
//
// 服务器连不上 GitHub，也不该在上面装构建工具。所以在本机把后端打成一个文件、
// 把页面构建好，一起打包。服务器上只需要 Node.js 18 以上，不需要 npm install。
//
// 用法：
//   node scripts/package-server.mjs           打包到 release/honghu-<版本>.tar.gz
//   node scripts/package-server.mjs --smoke   打包后在本机起一次服务，确认包能跑
//
// 包里有：server.mjs（后端）、web/（页面）、install.sh（服务器上的安装脚本）、VERSION、
// py/（两个扫描脚本原件和已有的历史读数；后端到点调用它们，需要服务器上有 Python 3.8 以上）。

import { build } from 'esbuild'
import { execFileSync, spawn } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
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

// git pull 带来新依赖时 node_modules 会落后于 package-lock.json，先补装，否则构建找不到模块
const installed = join(ROOT, 'node_modules', '.package-lock.json')
if (!existsSync(installed) || statSync(installed).mtimeMs < statSync(join(ROOT, 'package-lock.json')).mtimeMs) {
  console.log('依赖有更新，先安装依赖')
  execFileSync('npm', ['install', '--no-audit', '--no-fund'], { cwd: ROOT, stdio: 'inherit' })
}

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
writeFileSync(join(OUT, 'VERSION'), `${version}\n`)

// 扫描脚本原样带上，一个字不改；历史读数只带按日期存的那些，连续天数靠它们接续
const PY_SCRIPTS = ['ai-mainline-map.py', 'market-scan.py']
const PY_DATA = [['战略组合2026-2030', '数据', 'AI主线'], ['战略组合2026-2030', '数据', '全市场扫描']]
mkdirSync(join(OUT, 'py', 'scripts'), { recursive: true })
for (const f of PY_SCRIPTS) cpSync(join(ROOT, 'scripts', f), join(OUT, 'py', 'scripts', f))
for (const parts of PY_DATA) {
  const from = join(ROOT, ...parts)
  mkdirSync(join(OUT, 'py', ...parts), { recursive: true })
  if (!existsSync(from)) continue
  for (const f of readdirSync(from).filter(n => /^\d{4}-\d{2}-\d{2}\.json$/.test(n))) cpSync(join(from, f), join(OUT, 'py', ...parts, f))
}

const tarball = join(RELEASE, `honghu-${version}.tar.gz`)
// COPYFILE_DISABLE 和 --no-xattrs：不让 macOS 的 tar 往包里塞 ._ 属性文件和扩展属性，
// 否则服务器上解包时每个文件报一行 Ignoring unknown extended header keyword
execFileSync('tar', ['--no-xattrs', '-czf', tarball, '-C', RELEASE, 'honghu'], { env: { ...process.env, COPYFILE_DISABLE: '1' } })
console.log(`已打包：${tarball}（版本 ${version}）`)

if (process.argv.includes('--smoke')) {
  const data = mkdtempSync(join(tmpdir(), 'honghu-smoke-'))
  const port = 20000 + Math.floor(Math.random() * 20000)
  const token = 'smoke-test-token-0000000001'
  const botToken = 'smoke-test-bot-token-000000000000000001'
  // 从包目录之外启动，且不带仓库的 node_modules：确认这个文件自己就能跑
  const child = spawn(process.execPath, [join(OUT, 'server.mjs')], {
    cwd: data,
    // HONGHU_CHAIN=off：试跑不去拉行情，只确认接口和随包的脚本在
    env: { PATH: process.env.PATH, DATA_DIR: data, COMMITTEE_TOKEN: token, BOT_TOKEN: botToken, HONGHU_CHAIN: 'off', PORT: String(port), WEB_DIR: join(OUT, 'web') },
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
    const bot = { Authorization: `Bearer ${botToken}` }
    if ((await fetch(`${base}/api/records`, { headers: bot })).status !== 403) problems.push('汇总机器人的口令读得到账本')
    const series = await fetch(`${base}/api/chain/series`, { headers: bot })
    if (!series.ok || (await series.json()).segments?.length < 15) problems.push('汇总机器人读不到环节名单')
    const mainline = await (await fetch(`${base}/api/chain/mainline?text=0`, { headers: bot })).json()
    if (mainline.state !== 'ready' || !mainline.data?.triggers) problems.push('随包的扫描脚本或历史读数没有就位')
    // 页面上的汇总栏、指令、数据状态：机器人推一份，委员会读到、否决得了
    const committee = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    if ((await (await fetch(`${base}/api/me`, { headers: committee })).json()).role !== 'COMMITTEE') problems.push('页面认不出登录的是委员会')
    const pushed = await fetch(`${base}/api/digest`, {
      method: 'POST',
      headers: { ...bot, 'Content-Type': 'application/json' },
      body: JSON.stringify({ date: '2026-01-05', slot: 'close', title: '冒烟测试汇总', generatedAt: '2026-01-05 16:20:00', asOf: '2026-01-05', markdown: '# 冒烟测试汇总\n\n读数' }),
    })
    const heads = await (await fetch(`${base}/api/digest?days=5`, { headers: committee })).json()
    const full = await (await fetch(`${base}/api/digest/2026-01-05/close?html=1`, { headers: committee })).json()
    if (!pushed.ok || heads.digests?.[0]?.slot !== 'close' || !String(full.html).includes('<h1>冒烟测试汇总</h1>')) problems.push('页面读不到机器人推来的汇总')
    const veto = await fetch(`${base}/api/digest/2026-01-05/close/veto`, { method: 'POST', headers: committee, body: JSON.stringify({ note: '冒烟测试否决' }) })
    if (!veto.ok || (await veto.json()).veto?.note !== '冒烟测试否决') problems.push('委员会否决不了汇总')
    const orders = await fetch(`${base}/api/orders`, { headers: committee })
    if (!orders.ok || !Array.isArray((await orders.json()).instructions)) problems.push('页面读不到指令簿')
    const status = await (await fetch(`${base}/api/chain/status`, { headers: committee })).json()
    if (status.stocks?.expected !== 75 || status.base !== null) problems.push('页面读不到数据状态')
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
  console.log('✓ 包在本机起得来：健康检查、页面、口令、读执行单、提交文字、汇总的推送与否决、指令簿、数据状态与随包脚本均正常')
}
