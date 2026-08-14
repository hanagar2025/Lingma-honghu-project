// 浏览器端解密网页快照
//
// 参数必须与 backend/src/services/cockpit/webEncrypt.ts 的 CRYPTO_SPEC 逐字一致。
// 后端自检会做真实往返验证，两端任一处改动而另一处没跟上，自检立刻失败。
//
// 口令只存在于本函数的调用栈里：不写 localStorage、不进 URL、不发任何请求。
// 代价是每次刷新都要重输一次 —— 这个代价是刻意保留的，
// 把口令缓存下来等于把"加密"降级成"URL 保密"。

const SPEC = {
  v: 1,
  kdf: 'PBKDF2',
  hash: 'SHA-256',
  iterations: 600_000,
  cipher: 'AES-GCM',
  keyBits: 256,
} as const

export interface EncryptedSnapshot {
  encrypted: true
  v: number
  iterations: number
  saltB64: string
  ivB64: string
  dataB64: string
  generatedAt: string
}

export function isEncryptedSnapshot(x: unknown): x is EncryptedSnapshot {
  return !!x && typeof x === 'object' && (x as { encrypted?: unknown }).encrypted === true
}

// 显式基于 ArrayBuffer 构造：TS 5.7 起 Uint8Array 带缓冲区类型参数，
// 默认的 ArrayBufferLike 含 SharedArrayBuffer，不满足 WebCrypto 的 BufferSource。
function fromB64(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s)
  const buf = new ArrayBuffer(bin.length)
  const out = new Uint8Array(buf)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export async function decryptSnapshot(
  enc: EncryptedSnapshot, passphrase: string
): Promise<unknown> {
  if (enc.v !== SPEC.v) {
    throw new Error(
      `密文版本 ${enc.v} 无法识别（本页支持 v${SPEC.v}）。前端与生成快照的后端版本不一致。`
    )
  }
  if (!globalThis.crypto?.subtle) {
    // http:// 下的非 localhost 源不提供 WebCrypto。这正是"必须用 HTTPS"的技术原因，
    // 而不只是习惯问题 —— 说清楚可以省掉一轮"为什么解密按钮没反应"。
    throw new Error(
      '当前页面无法使用 WebCrypto。浏览器只在 HTTPS（或 localhost）下提供解密能力，'
      + '请通过 https:// 访问。'
    )
  }
  const base = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']
  )
  const key = await crypto.subtle.deriveKey(
    {
      name: SPEC.kdf,
      salt: fromB64(enc.saltB64),
      // 迭代次数取自文件而非常量：换过口令、改过参数的历史快照仍要能打开。
      iterations: enc.iterations || SPEC.iterations,
      hash: SPEC.hash,
    },
    base,
    { name: SPEC.cipher, length: SPEC.keyBits },
    false,
    ['decrypt']
  )
  let plain: ArrayBuffer
  try {
    plain = await crypto.subtle.decrypt(
      { name: SPEC.cipher, iv: fromB64(enc.ivB64) }, key, fromB64(enc.dataB64)
    )
  } catch {
    // AES-GCM 的认证失败无法区分"口令错"与"文件被改过"。
    // 两者都不该继续往下走，所以合并成一句，但不谎称一定是口令错。
    throw new Error('解密失败：口令不正确，或文件已损坏/被篡改。')
  }
  return JSON.parse(new TextDecoder().decode(plain))
}
