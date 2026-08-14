// 网页快照静态加密
//
// 为什么必须有这个：快照 JSON 含全部持仓、股数、成本、现金与总资产。
// 一旦放到公网域名下，"没人知道 URL" 不构成任何保护 ——
// 静态站点上的 /data/today.json 谁请求谁就能拿到全文。
//
// 常见的错误做法是在前端加一个密码框：数据已经在浏览器里，密码框只是装饰。
// 这里做的是**真加密**：落盘的就是密文，服务端（静态托管）自己也解不开，
// 口令只存在于人的脑子和浏览器内存里，从不上传。
//
// 算法与参数必须与 frontend/src/services/decrypt.ts 逐字一致。
// 两端都用 WebCrypto（Node 18+ 提供同一套 API），因此不存在实现差异，
// 且有自检做真实往返验证。

/** 与前端共享的加密参数。改任何一项都必须同步改前端，否则历史密文解不开 */
export const CRYPTO_SPEC = {
  /** 版本号随格式变化递增，前端据此拒绝无法识别的密文而不是解出乱码 */
  v: 1,
  kdf: 'PBKDF2' as const,
  hash: 'SHA-256' as const,
  /** 迭代次数。取值偏高是刻意的：这份文件可能长期挂在公网，
   *  离线爆破的唯一成本就是 KDF。解密只在人手动输入口令时发生一次，
   *  多花几百毫秒换取暴力破解成本提升是明显划算的交易。 */
  iterations: 600_000,
  cipher: 'AES-GCM' as const,
  keyBits: 256,
  saltBytes: 16,
  ivBytes: 12,
}

export interface EncryptedSnapshot {
  /** 明文标记：让人一眼看出这是密文而不是坏掉的 JSON */
  encrypted: true
  v: number
  kdf: string
  hash: string
  iterations: number
  cipher: string
  saltB64: string
  ivB64: string
  dataB64: string
  /** 生成时间。刻意放在明文里 —— 需要判断"这份快照是哪天的"而不必先解密 */
  generatedAt: string
  hint: string
}

function b64(buf: ArrayBuffer | Uint8Array): string {
  return Buffer.from(buf instanceof Uint8Array ? buf : new Uint8Array(buf)).toString('base64')
}

async function deriveKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']
  )
  return crypto.subtle.deriveKey(
    {
      name: CRYPTO_SPEC.kdf,
      salt: salt as unknown as BufferSource,
      iterations: CRYPTO_SPEC.iterations,
      hash: CRYPTO_SPEC.hash,
    },
    base,
    { name: CRYPTO_SPEC.cipher, length: CRYPTO_SPEC.keyBits },
    false,
    ['encrypt', 'decrypt']
  )
}

/** 口令下限。低于此长度直接拒绝，不是警告 */
export const MIN_PASSPHRASE = 8

/**
 * 口令校验。**必须在流程最前面调用。**
 *
 * 存在理由是一次真实的浪费：校验原本只发生在加密那一步，也就是整个流程的最后。
 * 于是口令写短了会先拉完 60 只标的的行情、算完全部读数、写完 HTML 报告，
 * 9 秒之后才告诉你"口令太短" —— 而这 9 秒的工作全部作废。
 * 参数错误应当在花费任何代价之前就报出来。
 */
export function checkPassphrase(passphrase: string | undefined): string | null {
  if (!passphrase) return '未提供口令'
  if (passphrase.length < MIN_PASSPHRASE) {
    return `口令至少 ${MIN_PASSPHRASE} 个字符，当前 ${passphrase.length} 个。太短的口令使加密形同虚设。`
  }
  return null
}

export async function encryptSnapshot(
  plaintext: string, passphrase: string
): Promise<EncryptedSnapshot> {
  const bad = checkPassphrase(passphrase)
  if (bad) {
    // 一个"看起来加密了"的公网页面比一个明知未加密的页面更危险，所以拒绝而不是警告。
    throw new Error(bad)
  }
  const salt = crypto.getRandomValues(new Uint8Array(CRYPTO_SPEC.saltBytes))
  const iv = crypto.getRandomValues(new Uint8Array(CRYPTO_SPEC.ivBytes))
  const key = await deriveKey(passphrase, salt)
  const data = await crypto.subtle.encrypt(
    { name: CRYPTO_SPEC.cipher, iv: iv as unknown as BufferSource },
    key,
    new TextEncoder().encode(plaintext)
  )
  return {
    encrypted: true,
    v: CRYPTO_SPEC.v,
    kdf: CRYPTO_SPEC.kdf,
    hash: CRYPTO_SPEC.hash,
    iterations: CRYPTO_SPEC.iterations,
    cipher: CRYPTO_SPEC.cipher,
    saltB64: b64(salt),
    ivB64: b64(iv),
    dataB64: b64(data),
    generatedAt: new Date().toISOString(),
    hint: '本文件为 AES-GCM 密文。口令不在文件内，也不在服务端，只在你脑子里。',
  }
}

/**
 * 解密。仅用于自检做真实往返验证 —— 生产路径上解密只发生在浏览器里。
 * 保留它是因为"加密能跑通"和"加密出来的东西真能解开"是两件事，
 * 只测前者的话，某天发现解不开时密文已经积累了一个月。
 */
export async function decryptSnapshot(
  enc: EncryptedSnapshot, passphrase: string
): Promise<string> {
  if (enc.v !== CRYPTO_SPEC.v) throw new Error(`密文版本 ${enc.v} 无法识别`)
  const salt = new Uint8Array(Buffer.from(enc.saltB64, 'base64'))
  const iv = new Uint8Array(Buffer.from(enc.ivB64, 'base64'))
  const key = await deriveKey(passphrase, salt)
  const out = await crypto.subtle.decrypt(
    { name: CRYPTO_SPEC.cipher, iv: iv as unknown as BufferSource },
    key,
    new Uint8Array(Buffer.from(enc.dataB64, 'base64')) as unknown as BufferSource
  )
  return new TextDecoder().decode(out)
}
