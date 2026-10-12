import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadRunLog, renderSummary, summarize } from './runLog'

const HERE = dirname(fileURLToPath(import.meta.url))
const path = process.env.RUN_LOG ?? join(HERE, '..', '..', '..', '..', 'share', 'decision', 'run-log.csv')
process.stdout.write(renderSummary(summarize(loadRunLog(path))) + '\n')
