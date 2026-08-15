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
  /**
   * 快照对应的交易日。同样刻意留在明文里。
   *
   * 用处很具体：定时任务要判断"今天是否已经发过一份最新的"，
   * 若这个字段藏在密文里，判断就必须先解密 —— 而定时任务不该持有口令的使用权限
   * 之外还去解密数据。交易日期本身不是敏感信息（交易日历是公开的）。
   */
  snapshotDate: string | null
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

/**
 * 每类字符的信息量（比特）。
 *
 * 必须按类别区分，不能按字符个数计数：
 * 一个常用汉字的选择空间约三千字（≈11.5 比特），一个小写字母只有 4.7。
 * 按个数算会把「青瓦灯塔鸿鹄远」（7 字，约 80 比特）判得比 8 个字母（38 比特）还弱，
 * 正好惩罚了对中文用户最好记的那种口令 —— 这个偏差实测拦下过一个完全够强的口令。
 *
 * 与 scripts/check-passphrase.mjs 的取值必须一致，由 cryptoSelftest 断言。
 */
export function bitsOfChar(ch: string): number {
  if (/[\u4e00-\u9fa5]/.test(ch)) return 11.5
  if (/[a-zA-Z]/.test(ch)) return 4.7
  if (/[0-9]/.test(ch)) return 3.3
  return 4.9
}

/** 口令熵估算（比特） */
export function passphraseBits(passphrase: string): number {
  return [...passphrase].reduce((sum, ch) => sum + bitsOfChar(ch), 0)
}

/**
 * 库层下限（比特）。30 比特很宽松 —— 本机与局域网用这个强度够了，
 * 公网部署另有更严的判据（scripts/check-passphrase.mjs，按剩余熵 36 比特）。
 * 这里只拦"形同虚设"的那一档：abc、12345678 之类。
 */
export const MIN_PASSPHRASE_BITS = 30

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
  const bits = passphraseBits(passphrase)
  if (bits < MIN_PASSPHRASE_BITS) {
    return `口令强度约 ${bits.toFixed(0)} 比特，低于下限 ${MIN_PASSPHRASE_BITS} 比特`
      + `（当前 ${[...passphrase].length} 个字符）。太弱的口令使加密形同虚设。`
      + `　提示：汉字每字约 11.5 比特，三个汉字即可达标。`
  }
  return null
}

export async function encryptSnapshot(
  plaintext: string, passphrase: string, snapshotDate: string | null = null
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
    snapshotDate,
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
