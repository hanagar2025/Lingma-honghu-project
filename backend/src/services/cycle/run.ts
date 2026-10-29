/**
 * CY-01 命令行
 *
 *   npm -w backend run cycle:package          生成今日证据包并落档（同日已有则不写；CYCLE_REVISION=1 写 -r2）
 *   npm -w backend run cycle:record -- <file> 落档一条研判或验证草稿（先校验；记录时刻取落档时刻）
 *   npm -w backend run cycle:check            校验档案：指纹、哈希链、引用、时序、git 只增不改
 *   npm -w backend run cycle:docs             重生成映射表与指标登记表文档
 *
 * 只写 share/cycle/ 与研究文档；不读写账本，不产生任何动作，每日执行单不调用。
 * 环境变量：CYCLE_TODAY（证据包日期，默认北京时间今日）。
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadInputs } from './collect'
import { buildPackage } from './package'
import { archivePackage, archiveRecord, checkArchive } from './archive'
import { renderMappingDoc, renderRegisterDoc } from './render'
import { unmappedUniverseNodes } from './nodes'
import { MAPPING_DOC, REGISTER_DOC } from './docPaths'

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..', '..')

const beijingToday = () => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10)
const nowIso = () => new Date().toISOString()

function docs(): void {
  writeFileSync(join(ROOT, MAPPING_DOC), renderMappingDoc())
  writeFileSync(join(ROOT, REGISTER_DOC), renderRegisterDoc())
  console.log(`已生成 ${MAPPING_DOC}、${REGISTER_DOC}`)
}

function main(): void {
  const [cmd, arg] = process.argv.slice(2)
  if (cmd === 'package') {
    const unmapped = unmappedUniverseNodes()
    if (unmapped.length) {
      console.error(`股票池有成员未映射到产业节点，先补 cycle/nodes.ts：${unmapped.join('、')}`)
      process.exit(1)
    }
    const today = process.env.CYCLE_TODAY ?? beijingToday()
    const pkg = buildPackage(loadInputs(ROOT, today), nowIso())
    const entry = archivePackage(ROOT, pkg, process.env.CYCLE_REVISION === '1')
    if (!entry) {
      console.log(`${today} 的证据包已存在，未覆盖。如需修订版，设 CYCLE_REVISION=1。`)
      return
    }
    console.log(`已落档 ${entry.file}（SHA-256 ${entry.sha256}）与 ${entry.mdFile}`)
    console.log('请及时提交并推送 share/cycle/，研判记录引用本文件名与指纹。')
  } else if (cmd === 'record') {
    if (!arg) throw new Error('用法：cycle:record -- <草稿文件>')
    const draft = JSON.parse(readFileSync(resolve(process.env.INIT_CWD ?? process.cwd(), arg), 'utf8'))
    const { entry, errors } = archiveRecord(ROOT, draft, nowIso())
    if (errors.length) {
      console.error('未落档，校验不通过：')
      for (const e of errors) console.error(`  - ${e}`)
      process.exit(1)
    }
    console.log(`已落档 ${entry!.file}（SHA-256 ${entry!.sha256}，记录时刻 ${entry!.recordedAt}）。请立即提交并推送。`)
  } else if (cmd === 'check') {
    const r = checkArchive(ROOT)
    console.log(`CY-01 档案：证据包 ${r.counts.PACKAGE}，研判 ${r.counts.JUDGMENT}，验证 ${r.counts.VERIFICATION}；git 只增不改检查${r.gitChecked ? '已执行' : '未执行（不在 git 仓库内）'}`)
    if (r.problems.length) {
      for (const p of r.problems) console.error(`  ✗ ${p}`)
      process.exit(1)
    }
    console.log('  通过')
  } else if (cmd === 'docs') {
    docs()
  } else {
    console.error('用法：run.ts package | record <file> | check | docs')
    process.exit(1)
  }
}

main()
