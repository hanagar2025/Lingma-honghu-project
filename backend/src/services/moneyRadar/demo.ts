/**
 * 资金驾驶舱（R-01）· 示意输出
 *
 *   npm run money:demo           骨架视图：数据源未接入时驾驶舱长什么样
 *   npm run money:demo -- fixture 合成数据视图：一只持仓走完堆积 → 背离的完整过程
 *
 * 合成数据只用来展示计算链路，标注为 FIXTURE，不是真实行情。
 */

import { holdingCodes } from './config'
import { synthDataSet, wobble } from './fixtures'
import { buildMoneyCockpitView, entryObjects, renderMoneyCockpit } from './radar'

const useFixture = process.argv.includes('fixture')

if (!useFixture) {
  process.stdout.write(renderMoneyCockpit(buildMoneyCockpitView(null)))
} else {
  const objs = entryObjects()
  const codes = [...new Set(Object.values(objs).flat().flatMap(o => o.codes))]
  const target = holdingCodes()[0]!.code
  const n = 400
  const stocks = codes.map(code => code === target
    ? {
      code,
      share: (t: number) => (t < 300 ? 0.01 + wobble(t, 0.0003) : t < 385 ? 0.03 : 0.022),
      price: (t: number) => 10 + t * 0.02,
      margin: (t: number) => (t < 390 ? 1e9 + t * 1e6 : 1e9 + 390e6 - (t - 389) * 5e6),
    }
    : {
      code,
      share: (t: number) => 0.002 + wobble(t + code.length, 0.0001),
      price: (t: number) => 10 + wobble(t, 0.2),
      margin: (t: number) => 5e8 + t * 1e5,
    })
  process.stdout.write(renderMoneyCockpit(buildMoneyCockpitView(synthDataSet(n, stocks), 'FIXTURE')))
}
