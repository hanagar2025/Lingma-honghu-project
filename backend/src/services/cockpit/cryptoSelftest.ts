// 网页快照加密自检
//
// 这个自检的价值全在一件事上：**证明后端加出来的东西，前端那段代码真能解开。**
// 两端是两份独立源码（Node 与浏览器各一份参数表），一旦有人改了一边的迭代次数、
// 盐长度或算法名，密文就变成一堆永久打不开的字节 —— 而且不会有任何报错，
// 要等到某天真的想看昨天数据时才发现。
//
// 做法不是比对参数字符串，而是**直接 import 前端那个模块**来解后端加的密文。
// decrypt.ts 只用到 atob / crypto.subtle / TextDecoder，这些在 Node 22 里都有，
// 所以能原样跑。参数比对只能证明"两处数字一样"，真实调用才能证明"密文真能解开"。
//
// 运行：npx tsx backend/src/services/cockpit/cryptoSelftest.ts

import { readFileSync } from 'node:fs'
import { CRYPTO_SPEC, encryptSnapshot, decryptSnapshot, bitsOfChar, passphraseBits } from './webEncrypt'

// 用运行时动态导入而不是静态 import：前端源码不在 backend 的 rootDir 下，
// 静态引用会让 tsc 报 TS6059。specifier 写成变量，tsc 就不做静态解析，
// 而 tsx 在运行时照样能加载并转译这个 .ts 文件 ——
// 于是既保住"真的用前端那份代码解密"这个验证，又不破坏两个工程的边界。
const FE_DECRYPT_URL = new URL(
  '../../../../frontend/src/services/decrypt.ts', import.meta.url
).href
const fe = await import(FE_DECRYPT_URL) as {
  decryptSnapshot: (enc: unknown, pass: string) => Promise<unknown>
  isEncryptedSnapshot: (x: unknown) => boolean
}
const feDecrypt = fe.decryptSnapshot
const feIsEncrypted = fe.isEncryptedSnapshot

let failed = 0
let passed = 0

function ok(name: string, cond: boolean, extra = ''): void {
  if (cond) { passed++; console.log(`  ✓ ${name}`) }
  else { failed++; console.error(`  ✗ ${name} ${extra}`) }
}

const PASS = 'correct-horse-battery'
const PAYLOAD = JSON.stringify({
  date: '2026-08-14',
  holdings: [{ name: '海光信息', posPct: 0.186, legalReason: '仓位18.6% > 上限12.0%' }],
  totalAssets: 3771000,
  externalCash: 2000000,
  中文: '含中文与 emoji 🔒 的负数 -12.34',
})

const feSrc = readFileSync(
  new URL('../../../../frontend/src/services/decrypt.ts', import.meta.url), 'utf-8'
)

console.log('\n【跨端真实解密：后端加密 → 前端源码解密】')

const encForFe = await encryptSnapshot(PAYLOAD, PASS)
ok('前端能识别后端产出的密文格式', feIsEncrypted(encForFe))

const feBack = await feDecrypt(encForFe, PASS)
ok('前端解出的对象与原始载荷逐字段相同',
  JSON.stringify(feBack) === JSON.stringify(JSON.parse(PAYLOAD)))
ok('前端解出的持仓法定理由未被破坏',
  (feBack as { holdings: { legalReason: string }[] }).holdings[0].legalReason
    === '仓位18.6% > 上限12.0%')

let feWrongRejected = false
try {
  await feDecrypt(encForFe, 'wrong-passphrase')
} catch { feWrongRejected = true }
ok('前端对错误口令报错而非解出乱码', feWrongRejected)

// 版本不匹配必须被前端拒绝，否则将来改格式时会解出乱码而不是给出可读提示
let feVerRejected = false
try {
  await feDecrypt({ ...encForFe, v: 999 }, PASS)
} catch (e) {
  feVerRejected = e instanceof Error && e.message.includes('999')
}
ok('前端拒绝无法识别的密文版本并说明版本号', feVerRejected)

console.log('\n【后端往返】')

const enc = await encryptSnapshot(PAYLOAD, PASS)
ok('密文带 encrypted 标记，便于人和代码区分密文与坏 JSON', enc.encrypted === true)
ok('密文不含明文片段（抽查持仓名与金额）',
  !enc.dataB64.includes('海光') && !JSON.stringify(enc).includes('3771000'))
ok('口令不出现在密文文件的任何字段里',
  !JSON.stringify(enc).includes(PASS))
ok('盐与 IV 长度符合规格',
  Buffer.from(enc.saltB64, 'base64').length === CRYPTO_SPEC.saltBytes &&
  Buffer.from(enc.ivB64, 'base64').length === CRYPTO_SPEC.ivBytes)
ok('生成时间留在明文里（解密前即可判断是哪天的快照）', !!enc.generatedAt)

const back = await decryptSnapshot(enc, PASS)
ok('正确口令解出的内容与原文逐字相同', back === PAYLOAD)
ok('中文与 emoji 未被破坏', JSON.parse(back).中文.includes('🔒'))

let wrongRejected = false
try { await decryptSnapshot(enc, `${PASS}x`) } catch { wrongRejected = true }
ok('错误口令被拒绝（AES-GCM 认证失败而非解出乱码）', wrongRejected)

// 篡改任意一个字节都必须导致解密失败，否则密文可被静默修改
const tampered = { ...enc }
const raw = Buffer.from(enc.dataB64, 'base64')
raw[Math.floor(raw.length / 2)] ^= 0xff
tampered.dataB64 = raw.toString('base64')
let tamperRejected = false
try { await decryptSnapshot(tampered, PASS) } catch { tamperRejected = true }
ok('密文被篡改后解密失败（GCM 提供完整性保护）', tamperRejected)

// 两次加密同一内容必须产生不同密文，否则可从"密文没变"推断"当天数据没变"
const enc2 = await encryptSnapshot(PAYLOAD, PASS)
ok('相同内容两次加密得到不同密文（盐与 IV 随机）',
  enc2.dataB64 !== enc.dataB64 && enc2.saltB64 !== enc.saltB64)

console.log('\n【口令强度：按比特而非字符个数】')
let shortRejected = false
try { await encryptSnapshot(PAYLOAD, 'abc') } catch { shortRejected = true }
ok('过弱口令被拒绝而非仅告警', shortRejected)

let digitsRejected = false
try { await encryptSnapshot(PAYLOAD, '12345678') } catch { digitsRejected = true }
ok('八位纯数字被拒（26 比特，按字符数会误判为达标）', digitsRejected)

// 七个汉字约 81 比特，远强于八个字母的 38 比特。
// 按字符个数计数会把它判为"不足 8 位"而拒绝 —— 这个偏差实测拦下过一个够强的口令。
ok('中文口令按比特计：七个汉字约 81 比特',
  Math.abs(passphraseBits('青瓦灯塔鸿鹄远') - 80.5) < 0.1,
  String(passphraseBits('青瓦灯塔鸿鹄远')))
const zhEnc = await encryptSnapshot(PAYLOAD, '青瓦灯塔鸿鹄远')
ok('七个汉字的口令可用（不因"少于8个字符"被拒）', zhEnc.encrypted === true)
ok('中文口令的密文可被前端解开',
  await feDecrypt(zhEnc, '青瓦灯塔鸿鹄远') !== null)
ok('汉字每字权重高于字母', bitsOfChar('青') > bitsOfChar('a'))

// 两处比特表必须一致：一处在库里（TS），一处在部署检查器里（mjs）。
// 不一致会导致"部署脚本放行的口令，加密层却拒绝"这种自相矛盾的失败。
const mjsSrc = readFileSync(
  new URL('../../../../scripts/check-passphrase.mjs', import.meta.url), 'utf-8'
)
for (const [re, expect, label] of [
  [/\[\\u4e00-\\u9fa5\]\/\.test\(ch\)\) return ([\d.]+)/, bitsOfChar('青'), '汉字'],
  [/\[a-z\]\/\.test\(ch\)\) return ([\d.]+)/, bitsOfChar('a'), '小写字母'],
  [/\[0-9\]\/\.test\(ch\)\) return ([\d.]+)/, bitsOfChar('7'), '数字'],
] as [RegExp, number, string][]) {
  const m = re.exec(mjsSrc)
  ok(`检查器与库对「${label}」的比特取值一致（${expect}）`,
    !!m && Number(m[1]) === expect, m ? m[1] : '未匹配到')
}

console.log('\n【明文与密文不得并存】')
const snapSrc = readFileSync(new URL('./webSnapshot.ts', import.meta.url), 'utf-8')
ok('加密写盘时删除同目录明文', /rmSync\(plainFile\)/.test(snapSrc))
ok('加密写盘前先解密回验', /decryptSnapshot\(enc, passphrase\)/.test(snapSrc))
const runSrc = readFileSync(new URL('./run.ts', import.meta.url), 'utf-8')
ok('明文写盘时删除残留密文', /rmSync\(stale\)/.test(runSrc))
ok('未设口令时提示不要发到公网', /要发到公网域名/.test(runSrc))

console.log('\n【前端不缓存口令】')

/**
 * 剥掉注释再断言。
 * 这两处的注释本身就在解释"为什么不用 localStorage"，
 * 若直接对全文做正则，注释里的词会把自己判成违规 ——
 * 那会逼着人删掉解释性注释来讨好自检，是本末倒置。
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const feCode = stripComments(feSrc)
ok('decrypt.ts 不写 localStorage/sessionStorage',
  !/localStorage|sessionStorage/.test(feCode))
const gateSrc = readFileSync(
  new URL('../../../../frontend/src/components/UnlockGate.tsx', import.meta.url), 'utf-8'
)
const gateCode = stripComments(gateSrc)
ok('解锁界面代码不触碰浏览器存储', !/localStorage|sessionStorage/.test(gateCode))
ok('解锁界面明说每次刷新需重输，不提供记住选项',
  /每次刷新都需重新输入/.test(gateSrc) && !/记住口令/.test(gateCode))

console.log(`\n═══ 结果：${passed} 通过 / ${failed} 失败 ═══\n`)
if (failed > 0) process.exit(1)
