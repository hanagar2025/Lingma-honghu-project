/**
 * 资金驾驶舱（R-01）· 发布到仓库，供其他 Agent 通过公开链接读取
 *
 *   npm run money:publish
 *
 * localhost 只有运行服务的那台机器能打开。仓库是公开的，
 * 所以把最近一次收盘结果复制到 share/money/，提交推送后，任何 Agent 都能用
 * raw.githubusercontent.com 的地址直接读，不需要登录。
 *
 *   share/money/latest.agent.md   给大模型读（约 20KB，开头带约束）
 *   share/money/latest.json       完整数据（约 1MB，含 250 日序列）
 *   share/money/YYYY-MM-DD.agent.md  每日存档，便于对比
 *
 * 只复制、不重算。盘中快照不发布 —— 半天的数据不该作为"结果"传出去。
 */

import { execSync } from 'node:child_process'
import { copyFileSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..', '..', '..')
const DATA = join(ROOT, 'frontend', 'public', 'data')
export const SHARE_DIR = join(ROOT, 'share', 'money')
const REPO = 'hanagar2025/Lingma-honghu-project'

export function rawUrl(branch: string, file: string): string {
  return `https://raw.githubusercontent.com/${REPO}/refs/heads/${branch}/share/money/${file}`
}

function main(): void {
  const view = JSON.parse(readFileSync(join(DATA, 'money.json'), 'utf-8')) as { asOf: string; dataNotes: string[] }
  if (view.dataNotes.some(n => n.startsWith('盘中快照'))) {
    process.stderr.write('当前快照是盘中数据，不发布。收盘后 15:05 起跑 npm run money，再发布。\n')
    process.exit(1)
  }
  mkdirSync(SHARE_DIR, { recursive: true })
  copyFileSync(join(DATA, 'money.agent.md'), join(SHARE_DIR, 'latest.agent.md'))
  copyFileSync(join(DATA, 'money.agent.md'), join(SHARE_DIR, `${view.asOf}.agent.md`))
  copyFileSync(join(DATA, 'money.json'), join(SHARE_DIR, 'latest.json'))

  const branch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: ROOT }).toString().trim()
  const push = process.argv.includes('--push')
  if (push) {
    execSync('git add share/money', { cwd: ROOT, stdio: 'inherit' })
    const changed = execSync('git diff --cached --name-only -- share/money', { cwd: ROOT }).toString().trim()
    if (changed) {
      execSync(`git commit -m "资金驾驶舱发布：${view.asOf} 收盘结果" -- share/money`, { cwd: ROOT, stdio: 'inherit' })
      execSync(`git push origin ${branch}`, { cwd: ROOT, stdio: 'inherit' })
    } else {
      process.stdout.write('share/money 没有变化，无需提交。\n')
    }
  }
  process.stdout.write([
    `已复制 ${view.asOf} 收盘结果到 share/money/${push ? '，并已提交推送' : '（加 --push 自动提交推送）'}`,
    '其他 Agent 读这两个地址：',
    `  ${rawUrl(branch, 'latest.agent.md')}`,
    `  ${rawUrl(branch, 'latest.json')}`,
    '',
  ].join('\n'))
}

main()
