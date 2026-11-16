/**
 * 登录自检。守四条：
 *   ① 好记的口令只存散列，至少 6 个字（汉字按字数算）；
 *   ② 登录链接作废后旧链接立即失效；
 *   ③ 所有来源合计答错满限额后，好记的口令暂停，长口令照常可用；
 *   ④ 战略侧口令永远拿不到委员会身份。
 */
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Auth, GLOBAL_FAILURE_LIMIT, passwordProblem } from './auth'

let passed = 0
let failed = 0
function ok(cond: boolean, name: string): void {
  if (cond) passed++
  else failed++
  process.stdout.write(`  ${cond ? '✓' : '✗'} ${name}\n`)
}

const dir = mkdtempSync(join(tmpdir(), 'honghu-auth-'))
const file = join(dir, 'auth.json')
const COMMITTEE = 'committee-token-000000000001'
const AGENT = 'agent-token-0000000000000001'
let clock = Date.UTC(2026, 10, 16, 3, 0)
const now = (): number => clock

try {
  process.stdout.write('\n【口令长度】\n')
  ok(passwordProblem('鸿鹄高飞万里') === null, '6 个汉字可以')
  ok(passwordProblem('abc123') === null, '6 位字母数字可以')
  ok(passwordProblem('鸿鹄高飞') !== null, '4 个汉字不行')
  ok(passwordProblem(' 鸿鹄高飞万里') !== null, '首尾有空格不行')

  process.stdout.write('\n【三把钥匙】\n')
  const auth = new Auth(file, { committee: COMMITTEE, agent: AGENT }, now)
  ok(statSync(file).mode % 0o1000 === 0o600, '设置文件只有服务账号能读')
  ok(auth.roleFor(COMMITTEE) === 'COMMITTEE', '安装口令可用')
  ok(auth.roleFor(AGENT) === 'AGENT', '战略侧口令是战略侧身份')
  ok(auth.roleFor(auth.linkKey) === 'COMMITTEE', '登录链接可用')
  ok(auth.roleFor('鸿鹄高飞万里') === null, '没设好记的口令时，随便一句话进不来')

  ok(auth.setPassword('鸿鹄') !== null, '太短的口令设不上')
  ok(auth.setPassword('鸿鹄高飞万里') === null, '设好记的口令')
  ok(!readFileSync(file, 'utf-8').includes('鸿鹄高飞万里'), '文件里不存口令原文')
  ok(auth.roleFor('鸿鹄高飞万里') === 'COMMITTEE', '好记的口令可用')
  ok(new Auth(file, { committee: COMMITTEE }, now).roleFor('鸿鹄高飞万里') === 'COMMITTEE', '重启后仍然可用')
  ok(auth.roleFor('鸿鹄高飞万米') === null, '错一个字进不来')
  ok(auth.roleFor(AGENT) !== 'COMMITTEE', '战略侧口令拿不到委员会身份')

  auth.setPassword('另一句好记的话')
  ok(auth.roleFor('鸿鹄高飞万里') === null, '改口令后旧口令立即失效')
  ok(auth.roleFor('另一句好记的话') === 'COMMITTEE', '新口令可用')

  process.stdout.write('\n【登录链接】\n')
  const old = auth.linkKey
  const fresh = auth.newLink()
  ok(fresh !== old && fresh.length >= 32, '作废后生成新的长码')
  ok(auth.roleFor(old) === null, '旧链接立即失效')
  ok(auth.roleFor(fresh) === 'COMMITTEE', '新链接可用')

  process.stdout.write('\n【答错限次】\n')
  for (let i = 0; i < GLOBAL_FAILURE_LIMIT; i++) auth.noteFailure()
  ok(auth.passwordPaused, `合计答错 ${GLOBAL_FAILURE_LIMIT} 次后好记的口令暂停`)
  ok(auth.roleFor('另一句好记的话') === null, '暂停期间好记的口令进不来，即使答对')
  ok(auth.roleFor(fresh) === 'COMMITTEE' && auth.roleFor(COMMITTEE) === 'COMMITTEE', '暂停期间登录链接和安装口令照常可用')
  clock += 61 * 60_000
  ok(!auth.passwordPaused && auth.roleFor('另一句好记的话') === 'COMMITTEE', '一小时后恢复')
} finally {
  rmSync(dir, { recursive: true, force: true })
}

process.stdout.write(`\n登录自检：${passed} 通过，${failed} 失败\n`)
if (failed) process.exit(1)
