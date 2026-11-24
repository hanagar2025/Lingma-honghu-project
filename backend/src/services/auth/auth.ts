/**
 * 页面登录。三把钥匙都对应委员会，另有一把给战略侧、一把给定时汇总的 bot：
 *
 *   好记的口令   委员会在页面上自己设，至少 6 个字。只存加盐散列。
 *   登录链接     一串随机长码，放在链接 # 后面，扫码即登录。可以作废重发。
 *   安装口令     安装时生成、写在 /etc/honghu.env 里的长口令。页面上的设置弄丢时用它恢复。
 *   战略侧口令   同上，只能读取和交回识别结果。
 *   bot 口令     服务器环境变量 BOT_TOKEN（汇总机器人那边存成 HONGHU_AGENT_TOKEN）。只能读行情类数据、占比和净值指数，写定时汇总；读不到账本、成交和截图。
 *
 * 好记的口令短，靠限次守住：所有来源合计一小时内答错满 30 次，好记的口令暂停生效，
 * 登录链接和安装口令照常可用。单一来源的限次在服务器入口另算。
 */
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'

export type Role = 'COMMITTEE' | 'AGENT' | 'BOT'

export const PASSWORD_MIN = 6
export const PASSWORD_MAX = 64
export const GLOBAL_FAILURE_LIMIT = 30
const GLOBAL_WINDOW_MS = 60 * 60_000
const VERIFIED_TTL_MS = 10 * 60_000

interface AuthFile {
  linkKey: string
  linkSetAt: string
  passwordSalt?: string
  passwordHash?: string
  passwordSetAt?: string
}

function digest(s: string): Buffer {
  return createHash('sha256').update(s).digest()
}

function scrypt(password: string, salt: string): Buffer {
  return scryptSync(password.normalize('NFC'), Buffer.from(salt, 'hex'), 32, { N: 16384, r: 8, p: 1 })
}

/** 按字数算长度：一个汉字算一个字 */
export function passwordProblem(p: string): string | null {
  const n = Array.from(p).length
  if (p !== p.trim()) return '口令首尾不能是空格'
  if (n < PASSWORD_MIN) return `口令至少 ${PASSWORD_MIN} 个字`
  if (n > PASSWORD_MAX) return `口令不能超过 ${PASSWORD_MAX} 个字`
  return null
}

export class Auth {
  private data: AuthFile
  private readonly exact: [Role, Buffer][]
  private failures: number[] = []
  /** 散列算一次要几十毫秒；答对后十分钟内同一口令不再重算 */
  private verified = new Map<string, number>()

  constructor(
    private readonly file: string,
    tokens: { committee: string; agent?: string; bot?: string },
    private readonly now: () => number = Date.now,
  ) {
    this.exact = [['COMMITTEE', digest(tokens.committee)]]
    if (tokens.agent) this.exact.push(['AGENT', digest(tokens.agent)])
    if (tokens.bot) this.exact.push(['BOT', digest(tokens.bot)])
    if (existsSync(file)) {
      this.data = JSON.parse(readFileSync(file, 'utf-8')) as AuthFile
    } else {
      this.data = { linkKey: '', linkSetAt: '' }
      this.newLink()
    }
  }

  get linkKey(): string {
    return this.data.linkKey
  }

  get hasPassword(): boolean {
    return Boolean(this.data.passwordHash)
  }

  get passwordSetAt(): string | null {
    return this.data.passwordSetAt ?? null
  }

  /** 好记的口令因为答错太多暂停中 */
  get passwordPaused(): boolean {
    const since = this.now() - GLOBAL_WINDOW_MS
    this.failures = this.failures.filter(t => t > since)
    return this.failures.length >= GLOBAL_FAILURE_LIMIT
  }

  roleFor(given: string): Role | null {
    const d = digest(given)
    for (const [role, t] of [...this.exact, ['COMMITTEE', digest(this.data.linkKey)] as [Role, Buffer]]) {
      if (timingSafeEqual(t, d)) return role
    }
    if (!this.data.passwordHash || !this.data.passwordSalt || this.passwordPaused) return null
    const key = d.toString('hex')
    const until = this.verified.get(key)
    if (until && until > this.now()) return 'COMMITTEE'
    if (passwordProblem(given)) return null
    if (timingSafeEqual(scrypt(given, this.data.passwordSalt), Buffer.from(this.data.passwordHash, 'hex'))) {
      this.verified.set(key, this.now() + VERIFIED_TTL_MS)
      return 'COMMITTEE'
    }
    return null
  }

  noteFailure(): void {
    this.failures.push(this.now())
  }

  setPassword(p: string): string | null {
    const problem = passwordProblem(p)
    if (problem) return problem
    const salt = randomBytes(16).toString('hex')
    this.data = { ...this.data, passwordSalt: salt, passwordHash: scrypt(p, salt).toString('hex'), passwordSetAt: this.stamp() }
    this.verified.clear()
    this.save()
    return null
  }

  newLink(): string {
    this.data = { ...this.data, linkKey: randomBytes(24).toString('base64url'), linkSetAt: this.stamp() }
    this.save()
    return this.data.linkKey
  }

  private stamp(): string {
    return new Date(this.now() + 8 * 3600_000).toISOString().slice(0, 16).replace('T', ' ')
  }

  private save(): void {
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, `${JSON.stringify(this.data, null, 2)}\n`, { mode: 0o600 })
    renameSync(tmp, this.file)
  }
}
