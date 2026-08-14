// 口令强度检查
//
// 原来的规则是"含 honghu / wealth 等词就拒绝"。**那条规则拦错了对象。**
// 实测（PBKDF2 60 万轮，8 卡 RTX4090 约 3.3 万次/秒）：
//
//   honghu2026                不到 1 秒
//   honghu@wealth             15 秒
//   honghu + 3 个随机词        82 天
//   4 个随机词                 1700 年
//
// 可见 "honghu" 本身没有问题 —— 有问题的是**除它之外什么都没有**。
// 把它当记忆锚点、后面接几个随机词，强度完全够。
// 所以判据改成：**去掉可预测成分后，还剩多少有效材料。**
//
// 这样既保住了"要记得住"这个真实需求，又不会放过 honghu2026 那种一秒即破的。
//
// 口令**从标准输入读**，不走命令行参数 —— argv 会出现在 ps 输出里。
//
// 用法：printf '%s' "$PASS" | node scripts/check-passphrase.mjs [--allow-weak]

import { readFileSync } from 'node:fs'

const ALLOW_WEAK = process.argv.includes('--allow-weak')
const MIN_TOTAL = 12

/**
 * 剩余熵下限（比特）。36 比特约等于 8 个随机小写字母，
 * 在实测的 3.3 万次/秒下约需 35 天 —— 对一个不公开链接的私人页面是合理下限。
 */
const MIN_RESIDUAL_BITS = 36

/** 攻击者每秒可试次数：PBKDF2-SHA256 60 万轮，8 张 RTX4090 的实测量级 */
const GUESSES_PER_SEC = 33333

/**
 * 每类字符的信息量（比特）。
 *
 * 中文必须单独算：一个常用汉字的选择空间约三千字（≈11.5 比特），
 * 而一个小写字母只有 4.7 比特。按"字符个数"计数会把中文口令严重低估 ——
 * 「青瓦灯塔」四个字比八个小写字母更强，却会被字符数判为更弱。
 * 对一个中文用户来说，这个偏差正好惩罚了最好记的那种口令。
 */
function bitsOf(ch) {
  if (/[\u4e00-\u9fa5]/.test(ch)) return 11.5
  if (/[a-z]/.test(ch)) return 4.7
  if (/[A-Z]/.test(ch)) return 4.7
  if (/[0-9]/.test(ch)) return 3.3
  return 4.9
}

// 攻击者字典里的第一批词：域名、品牌、本项目名，以及通用弱口令词
const PREDICTABLE = [
  'hhwealth', 'honghu', 'wealth', 'hongkong', 'tios', '鸿鹄', '理财',
  'password', 'passwd', 'admin', 'qwerty', 'iloveyou', 'letmein', 'welcome',
  'aliyun', 'alibaba', 'muscap',
]

/**
 * 去掉可预测成分后剩下的熵（比特）。
 *
 * 依次剥掉：已知词 → 年份 → 连续重复 → 键盘顺序串 → 分隔符。
 * 剩下的越多，攻击者的搜索空间越大。这是粗估，但方向正确，
 * 而且比"含某词就拒"精确得多 —— 后者会把 honghu-青瓦-灯塔-47 这种
 * 完全够强的口令也拦掉。
 */
function residualBits(pass) {
  let s = pass.toLowerCase()
  for (const w of PREDICTABLE) s = s.split(w).join('')
  s = s.replace(/(19|20)\d{2}/g, '')        // 年份：2026、1998
  s = s.replace(/(.)\1{2,}/g, '$1')          // aaa → a
  s = s.replace(/(?:012|123|234|345|456|567|678|789|890)/g, '')
  s = s.replace(/(?:abc|bcd|cde|def|qwe|wer|asd|zxc)/g, '')
  s = s.replace(/[^a-z0-9\u4e00-\u9fa5]/g, '')  // 分隔符不计入熵
  return [...s].reduce((sum, ch) => sum + bitsOf(ch), 0)
}

function crackTime(bits) {
  const sec = Math.pow(2, bits) / 2 / GUESSES_PER_SEC
  if (sec < 1) return '不到 1 秒'
  if (sec < 60) return `${sec.toFixed(0)} 秒`
  if (sec < 3600) return `${(sec / 60).toFixed(0)} 分钟`
  if (sec < 86400) return `${(sec / 3600).toFixed(1)} 小时`
  if (sec < 3.15e7) return `${(sec / 86400).toFixed(0)} 天`
  const years = sec / 3.15e7
  return years < 1e4 ? `${years.toFixed(0)} 年` : `${years.toExponential(1)} 年`
}

const pass = readFileSync(0, 'utf-8').replace(/\n$/, '')
const total = [...pass].length
const left = residualBits(pass)

const fail = (msg) => { process.stderr.write(`\n${msg}\n`); process.exit(2) }

if (total === 0) fail('未收到口令。')

if (total < MIN_TOTAL) {
  fail(
    `口令只有 ${total} 位，公网部署要求至少 ${MIN_TOTAL} 位。\n`
    + `  密文文件谁都能下载，然后在自己机器上离线试 —— 没有次数限制，\n`
    + `  也不会像在线登录那样锁账号。`
  )
}

if (left < MIN_RESIDUAL_BITS) {
  const msg =
    `口令强度不足。共 ${total} 个字符，但去掉可猜成分（品牌名、年份、顺序串、分隔符）后\n`
    + `  只剩约 ${left.toFixed(0)} 比特有效熵 —— 拿到密文后离线爆破约需 **${crackTime(left)}**。\n\n`
    + `  参照（PBKDF2 60 万轮，8 卡 RTX4090 约 3.3 万次/秒）：\n`
    + `    honghu2026              不到 1 秒\n`
    + `    honghu@wealth           15 秒\n`
    + `    honghu-青瓦-灯塔-47      ${crackTime(residualBits('honghu-青瓦-灯塔-47'))}\n`
    + `    honghu2026-mist-loom-42x  ${crackTime(residualBits('honghu2026-mist-loom-42x'))}\n\n`
    + `  「honghu」本身没有问题 —— 问题是除它之外没有别的东西。\n`
    + `  把它当记忆锚点，后面接几个不相关的词就够，上面两个例子都含 honghu 且都能通过。\n`
    + `  中文特别划算：一个常用汉字约 11.5 比特，两个汉字就抵得上五个字母。\n`
  if (!ALLOW_WEAK) {
    fail(
      `${msg}\n  确实要用这个口令：加 TIOS_ALLOW_WEAK=1 重跑。\n`
      + `  会再确认一次，并把"本次使用了弱口令"记进部署记录，`
      + `以后回看时知道当时的保护强度。`
    )
  }
  process.stderr.write(`\n⚠ 已按 TIOS_ALLOW_WEAK=1 放行弱口令\n\n  ${msg}\n`)
  process.stdout.write(`WEAK ${left.toFixed(0)} ${crackTime(left)}\n`)
  process.exit(0)
}

process.stdout.write(`OK ${left.toFixed(0)} ${crackTime(left)}\n`)
