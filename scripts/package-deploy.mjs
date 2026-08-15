// 打包待上传的产物，并给出照抄即可的上传与 nginx 配置
//
// 为什么需要它：hhwealth.cc 根目录已经跑着另一个应用（2026-02 部署的老版鸿鹄理财）。
// 直接把我们的产物覆盖上去会把那个应用弄没了，所以必须挂在子路径。
// 而子路径部署有两个几乎必然踩的坑，都表现为"页面白屏但资源全是 200"：
//   ① 构建时没设 base → 产物引用 /assets/...，浏览器去站点根目录找 → 404；
//   ② React Router 没设 basename → 拿 "/tios/" 去匹配声明为 "/" 的路由 → 匹配不上。
// 这两条都已在代码里由 BASE_PATH 统一驱动，这个脚本负责把它们校验一遍再打包。

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, mkdirSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const DIST = join(ROOT, 'frontend', 'dist')
const OUT_DIR = join(ROOT, 'frontend', 'release')

const rawBase = process.env.BASE_PATH ?? '/'
const base = rawBase.endsWith('/') ? rawBase : `${rawBase}/`
const sub = base.replace(/^\/|\/$/g, '')

const line = '─'.repeat(70)
console.log(`\n${line}\n打包待上传产物\n${line}\n`)

if (!existsSync(DIST)) {
  console.error(`  ✗ 没有构建产物。先跑：\n`
    + `    BASE_PATH=${base} npm run web:deploy\n`)
  process.exit(1)
}

// ── 校验 base 与产物一致 ──
// 这一步是整个脚本存在的主要理由：base 不一致的产物上传后白屏，
// 而白屏时资源请求全是 200（被 SPA 回退接走），从现象上完全看不出原因。
const html = readFileSync(join(DIST, 'index.html'), 'utf-8')
const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(m => m[1])
const assetRefs = refs.filter(r => r.includes('/assets/'))
const bad = assetRefs.filter(r => !r.startsWith(base))

if (bad.length) {
  console.error(
    `  ✗ 产物的资源路径与 BASE_PATH 不一致\n`
    + `    BASE_PATH=${base}，但 index.html 引用的是：\n`
    + bad.map(b => `      ${b}`).join('\n')
    + `\n\n    上传后会白屏，且资源请求全是 200（被 SPA 回退接走），从现象上看不出原因。\n`
    + `    重新构建：BASE_PATH=${base} npm run web:deploy\n`
  )
  process.exit(1)
}
console.log(`  ✓ 资源路径与 BASE_PATH=${base} 一致（${assetRefs.length} 项）`)

// 快照检查。
//
// 这里曾经写着"产物里有明文快照就报错"——那是口令时代的判据，
// 而 2026-08-15 决议去掉口令后明文才是**预期**产物。
// 漏改的原因很具体：同一条检查在 preflight-deploy.mjs 里也有一份，
// 我只改了那一份。**重复的判据必然会漏改其中一份**，
// 所以这里只保留本脚本独有的 base 路径校验，快照内容交给 preflight 统一负责
// （ship.sh 与 web:deploy 都会先跑 preflight）。
const plain = join(DIST, 'data', 'today.json')
const enc = join(DIST, 'data', 'today.enc.json')
if (existsSync(enc)) {
  console.error(
    `  ✗ 产物里还有旧的加密快照 data/today.enc.json —— 口令模式已废弃。\n`
    + `    删掉它再重新构建。\n`
  )
  process.exit(1)
}
console.log(existsSync(plain)
  ? `  ✓ 快照存在（data/today.json）`
  : `  ⚠ 没有快照文件。页面能打开但所有列都显示"缺失"`)

// ── 打包 ──
mkdirSync(OUT_DIR, { recursive: true })
const stamp = new Date().toISOString().slice(0, 10)
const tar = join(OUT_DIR, `tios-${sub || 'root'}-${stamp}.tar.gz`)
execFileSync('tar', ['-czf', tar, '-C', DIST, '.'])
const size = (statSync(tar).size / 1024 / 1024).toFixed(2)
console.log(`  ✓ 已打包 ${tar}（${size} MB）`)

// ── 上传与配置 ──
const remoteDir = `/var/www/${sub || 'html'}`
console.log(`\n${line}\n接下来在你的机器上执行（服务器 39.104.86.200）\n${line}\n`)
console.log(`一、上传（把 root 换成你的 ECS 登录用户）\n`)
console.log(`  scp ${tar} root@39.104.86.200:/tmp/\n`)
console.log(`二、登录服务器并解包到子目录\n`)
console.log(`  ssh root@39.104.86.200`)
console.log(`  sudo mkdir -p ${remoteDir}`)
console.log(`  sudo tar -xzf /tmp/${tar.split('/').pop()} -C ${remoteDir}`)
console.log(`  sudo chown -R www-data:www-data ${remoteDir}\n`)
console.log(`三、在 nginx 的 443 server 块里加一段（不要动根目录的 location /）\n`)
console.log(`  location ${base} {`)
console.log(`      alias ${remoteDir}/;`)
console.log(`      try_files $uri $uri/ ${base}index.html;`)
console.log(`      # 快照每个交易日都会换，不能让浏览器缓存住昨天的数据`)
console.log(`      location ~* /data/.*\\.json$ {`)
console.log(`          alias ${remoteDir}/data/;`)
console.log(`          add_header Cache-Control "no-store";`)
console.log(`      }`)
console.log(`  }\n`)
console.log(`四、检查语法并生效\n`)
console.log(`  sudo nginx -t && sudo systemctl reload nginx\n`)
console.log(`然后手机打开 https://hhwealth.cc${base} —— 会先出现口令解锁页。\n`)
console.log(`${line}`)
console.log(`每个交易日更新数据只需重复一次这四步中的一、二 ——`)
console.log(`或者只传 data/today.json 这一个文件（约 380KB），nginx 无需重载。`)
console.log(`${line}\n`)
