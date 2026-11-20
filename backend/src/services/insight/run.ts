/**
 * 在本机按一份账本现算执行单和简报，打印出来。不落盘、不推送。
 * 用法：PORTFOLIO=<账本路径> npm -w backend run brief
 */
import { beijingToday, loadLedger } from '../dailyDecision/ledger'
import { produceCard } from '../dailyDecision/produce'
import { collectMarket } from '../market/data'
import { briefCodes, buildBrief } from './brief'

async function main(): Promise<void> {
  const produced = await produceCard(loadLedger())
  const market = await collectMarket(briefCodes(produced.input))
  const brief = buildBrief(produced.input, produced.card, market, beijingToday())
  process.stdout.write(`${produced.card.push}\n\n${brief.push}\n`)
  for (const s of brief.sections) process.stdout.write(`\n\n━━ ${s.title} ━━\n\n${s.markdown}\n`)
}

main().catch(e => {
  process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`)
  process.exit(1)
})
