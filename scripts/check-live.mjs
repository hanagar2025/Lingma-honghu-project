// 线上状态体检 —— 不需要 SSH，只看公网这一侧
//
// 存在理由：「跑通了吗」这个问题会反复出现，而它其实由几个可机械核对的事实组成：
// 线上是哪个版本的前端、快照是哪个交易日的、多久没更新、定时任务有没有在写文件。
// 靠人眼比对 bundle 文件名与时间戳容易看漏，也说不清"没更新"是故障还是休市。
//
// 刻意只用 HTTP 探测：SSH 私钥在委员会的 Mac 上，而这份检查在任何机器上都该能跑。
//
// 用法：npm run web:status

import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')
const DOMAIN = process.env.DEPLOY_DOMAIN ?? 'hhwealth.cc'
const BASE = process.env.BASE_PATH ?? '/'
const origin = `https://${DOMAIN}${BASE.endsWith('/') ? BASE : `${BASE}/`}`
const line = '─'.repeat(70)

const F = { ok: '\x1b[32m✓\x1b[0m', bad: '\x1b[31m✗\x1b[0m', warn: '\x1b[33m!\x1b[0m' }

async function get(path, { text = true } = {}) {
  try {
    const res = await fetch(new URL(path, origin), {
      signal: AbortSignal.timeout(25000),
      cache: 'no-store',
    })
    return { status: res.status, type: res.headers.get('content-type') ?? '', body: text ? await res.text() : null }
  } catch (e) {
    return { status: 0, type: '', body: null, error: e?.message ?? String(e) }
  }
}

/** 北京日期。判"该不该有更新"必须用交易所所在时区，而不是运行这个脚本的机器时区 */
function beijingDate(d = new Date()) {
  return new Date(d.getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10)
}

console.log(`\n${line}\n线上状态：${origin}\n${line}\n`)

let problems = 0
const bad = (msg) => { problems++; console.log(`  ${F.bad} ${msg}`) }

// ── 一、首页是不是本项目 ──
const home = await get('')
if (home.status === 0) {
  bad(`首页取不到：${home.error}`)
} else {
  const title = /<title>(.*?)<\/title>/.exec(home.body ?? '')?.[1] ?? '（无标题）'
  if ((home.body ?? '').includes('鸿鹄理财') || (home.body ?? '').includes('TIOS')) console.log(`  ${F.ok} 首页是本项目（${title}）`)
  else bad(`首页不是本项目，实际标题「${title}」`)
}

// ── 二、线上前端与本地构建是否同一版本 ──
// 只对比文件名里的内容哈希：名字不同就一定是不同的代码，不需要下载全文。
const liveJs = /src="([^"]*\/assets\/[^"]+\.js)"/.exec(home.body ?? '')?.[1] ?? null
const distDir = join(ROOT, 'frontend', 'dist', 'assets')
const localJs = existsSync(distDir)
  ? (readdirSync(distDir).find(f => f.endsWith('.js')) ?? null)
  : null
if (!liveJs) {
  bad('首页里找不到 JS 引用')
} else if (!localJs) {
  console.log(`  ${F.warn} 线上 ${liveJs.split('/').pop()}；本地没有构建产物，无法比对`)
} else if (liveJs.endsWith(localJs)) {
  console.log(`  ${F.ok} 前端版本与本地一致（${localJs}）`)
} else {
  bad(`前端版本落后：线上 ${liveJs.split('/').pop()}，本地 ${localJs}　→ 需要重新部署`)
}

// ── 三、功能是否在线上（按代码里的标识串判断） ──
if (liveJs) {
  const js = await get(liveJs.startsWith('http') ? liveJs : liveJs.replace(/^\//, ''))
  const b = js.body ?? ''
  const feats = [
    ['今日结论', '结论页'],
    ['焦点：今天真正需要', '焦点名单'],
    ['复制 Agent 链接', 'Agent 链接'],
    ['把数据交给别的软件', '外发说明'],
    ['这不是今天的开盘或收盘数据', '过期快照警告'],
    ['看台', '看台'],
    ['今日维持是经过验证的决策', '零动作日文案'],
  ]
  for (const [needle, label] of feats) {
    if (b.includes(needle)) console.log(`  ${F.ok} ${label}已上线`)
    else bad(`${label}不在线上　→ 需要重新部署`)
  }
  if (b.includes('驾驶舱已加密')) {
    bad('线上仍是口令加密版（已废弃）　→ 需要重新部署')
  }
}

// ── 四、快照 ──
const snap = await get('data/today.json')
let snapDate = null
if (snap.status === 200 && snap.type.includes('json')) {
  try {
    const d = JSON.parse(snap.body)
    snapDate = d.date ?? null
    const kb = Math.round((snap.body?.length ?? 0) / 1024)
    console.log(`  ${F.ok} 快照可取：交易日 ${snapDate}，${kb}KB`)
    if (!d.dashboard?.holdings?.length) bad('快照里没有持仓数据')
    if (typeof d.brief !== 'string') bad('快照里没有外发摘要（brief）')
    if (d.agentShare !== 'data/today.agent.md') {
      bad('快照没有 Agent 分享路径 agentShare　→ 需要重新部署带时钟的代码')
    }

    // ── 代码版本核对 ──
    //
    // 这一段来自一次真实的隐性故障：服务器的 cron 不拉代码，每天忠实地用同一份
    // 旧代码跑；而快照里没有版本标记，于是从外部完全看不出它在跑哪一版。
    // 报告照样每天出，数字全错却不报错。
    //
    // 「一份看起来正常、数字全错的报告，比一份生成失败的报告危险得多」——
    // 后者会让人立刻去修，前者会被当成事实用来做决定。
    const liveCommit = d.codeCommit ?? null
    if (!liveCommit || liveCommit === 'unknown') {
      bad('快照没有代码版本标记（codeCommit）　→ 服务器在跑旧版脚本，'
        + '须从本机跑 scripts/schedule-server.sh update')
    } else {
      let localCommit = null
      try {
        const { execSync } = await import('node:child_process')
        localCommit = execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim()
      } catch { /* 不在 git 仓库里就跳过比较 */ }
      if (localCommit && liveCommit !== localCommit) {
        bad(`线上代码版本 ${liveCommit} ≠ 本地 ${localCommit}`
          + '　→ 服务器落后，明日报告会用旧代码生成（不会报错，只会给出旧数字）')
      } else if (localCommit) {
        console.log(`  ${F.ok} 代码版本一致：${liveCommit}`)
      } else {
        console.log(`  ${F.ok} 线上代码版本 ${liveCommit}（本地非 git 仓库，跳过比较）`)
      }
    }
    if (d.generatedAt) {
      const ageH = (Date.now() - Date.parse(d.generatedAt)) / 3600000
      console.log(`  ${F.ok} 快照生成于 ${d.generatedAt}（${ageH.toFixed(1)} 小时前）`)
    } else {
      bad('快照没有生成时刻（generatedAt）　→ 无法判断它是哪次运行的产物')
    }
  } catch {
    bad('快照不是合法 JSON')
  }
} else {
  bad(`快照不可取（HTTP ${snap.status}）　→ 未部署明文快照`)
}

const agent = await get('data/today.agent.md')
if (agent.status === 200 && (agent.body ?? '').includes('kind: agent-share')) {
  console.log(`  ${F.ok} Agent 分享可取：data/today.agent.md`)
} else {
  bad(`Agent 分享不可取（HTTP ${agent.status}）　→ 其他 Agent 还没有稳定链接`)
}

// 旧密文残留会让人以为还在加密模式
const enc = await get('data/today.enc.json', { text: false })
if (enc.status === 200) bad('服务器上还留着旧的加密快照 data/today.enc.json　→ 重新部署会清掉')
else console.log(`  ${F.ok} 无旧加密快照残留`)

// ── 五、数据新鲜度：区分"故障"与"休市" ──
// 这一段是整个检查里最容易误判的地方：数据没更新既可能是定时任务挂了，
// 也可能是今天本来就不交易。用"最新K线日期 vs 北京日期 vs 星期"三者一起判。
if (snapDate) {
  const today = beijingDate()
  const dow = new Date(`${today}T00:00:00Z`).getUTCDay()
  const weekend = dow === 0 || dow === 6
  const lag = Math.round((new Date(`${today}T00:00:00Z`) - new Date(`${snapDate}T00:00:00Z`)) / 86400000)

  if (snapDate === today) {
    console.log(`  ${F.ok} 数据是今天（${today}）的`)
  } else if (weekend) {
    console.log(`  ${F.ok} 数据为 ${snapDate}，今天 ${today} 是周末不交易 —— 这是正确行为，不是故障`)
  } else if (lag <= 1) {
    console.log(`  ${F.warn} 数据为 ${snapDate}，落后 ${lag} 天。若今天已过 15:10 仍未更新，检查定时任务`)
  } else {
    bad(`数据为 ${snapDate}，落后 ${lag} 天（今天 ${today} 非周末）　→ 定时任务可能未运行`)
  }
}

// ── 六、缓存头：快照绝不能被缓存 ──
// 缓存住会让人看着昨天的数据做今天的决定，而页面看起来完全正常。
if (snap.status === 200) {
  const res = await fetch(new URL('data/today.json', origin), { signal: AbortSignal.timeout(20000) })
    .catch(() => null)
  const cc = res?.headers.get('cache-control') ?? ''
  if (/no-store|no-cache/.test(cc)) console.log(`  ${F.ok} 快照禁用缓存（${cc}）`)
  else bad(`快照的 Cache-Control 是「${cc || '未设置'}」　→ 浏览器可能一直显示旧数据`)
}

console.log(`\n${line}`)
if (problems === 0) {
  console.log('全部正常。')
} else {
  console.log(`${problems} 项需要处理。最常见的一条修法：\n`)
  console.log('  DEPLOY_HOST=39.104.86.200 DEPLOY_KEY=~/.ssh/tios_ecs ./scripts/deploy-ecs.sh\n')
  console.log('服务器定时任务的状态需要 SSH 才能看：')
  console.log('  DEPLOY_HOST=39.104.86.200 DEPLOY_KEY=~/.ssh/tios_ecs ./scripts/schedule-server.sh status')
}
console.log(`${line}\n`)
process.exit(problems === 0 ? 0 : 1)
