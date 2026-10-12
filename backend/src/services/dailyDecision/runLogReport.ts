/**
 * 用法：
 *   gh run list --workflow daily-decision.yml -L 300 --json databaseId,event,createdAt,conclusion > /tmp/runs.json
 *   RUN_LIST=/tmp/runs.json npm -w backend run decision:runlog
 * 不给 RUN_LIST 时，台账无记录的轮次只能记为「未核对」，分不清没启动还是没留痕。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadRunLog, renderSummary, summarize, type GithubRun } from './runLog'

const HERE = dirname(fileURLToPath(import.meta.url))
const path = process.env.RUN_LOG ?? join(HERE, '..', '..', '..', '..', 'share', 'decision', 'run-log.csv')
const runs = process.env.RUN_LIST ? (JSON.parse(readFileSync(process.env.RUN_LIST, 'utf8')) as GithubRun[]) : undefined
process.stdout.write(renderSummary(summarize(loadRunLog(path), new Date(), runs)) + '\n')
