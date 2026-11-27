/**
 * 半年计划里写死的数。出处：docs/half-year-plan.md 第〇、二、五节。
 * 只有指数和百分比。基准（指数 100）对应的金额只存在小程序服务器上。
 *
 * 这里的数只能跟着战略书改，不在代码里另起口径。
 */
export const PLAN = {
  /** 基准时点：这一刻的总资产记为 100 */
  baseAt: "2026-11-24 09:37",
  deadline: "2027-05-20",
  lines: { target: 178, watch: 95, warn: 90, stop: 85 },
  /** 停手线只上移：到过 reach，停手线移到 stop */
  ratchets: [
    { reach: 121, stop: 100 },
    { reach: 147, stop: 125 },
  ],
  checkpoints: [
    { date: "2026-12-20", index: 110 },
    { date: "2027-01-20", index: 121 },
    { date: "2027-02-20", index: 133 },
    { date: "2027-03-20", index: 147 },
    { date: "2027-04-20", index: 162 },
    { date: "2027-05-20", index: 178 },
  ],
  /** 加仓上限：证据分 → 单票占比上限。E≤3 不加 */
  addCap: { 6: 0.2, 5: 0.15, 4: 0.1 } as Record<number, number>,
  /** 相关环节合计上限，只限加仓 */
  related: { segments: ["光模块", "PCB"], cap: 0.3 },
  /** 新开仓：E≥5、当天涨幅 ≤3%、日成交 ≥10 亿、没有基本面扣分 */
  entry: { minE: 5, maxPct: 0.03, minAmount: 1_000_000_000 },
  /** 周五重排：持仓 E≤2 且有候选 E=6 → 下周一换仓 */
  rotation: { holdMaxE: 2, candidateE: 6 },
  /** 备用目标触发条件 4：连续 10 个交易日没有一只候选 E≥5 */
  backup: { days: 10, minE: 5 },
} as const;

/** 现在生效的停手线 */
export function stopLine(navHigh: number | null): number {
  let stop: number = PLAN.lines.stop;
  for (const r of PLAN.ratchets) if (navHigh !== null && navHigh >= r.reach) stop = r.stop;
  return stop;
}

/** 下一个进度线对账日 */
export function nextCheckpoint(today: string): { date: string; index: number } | null {
  return PLAN.checkpoints.find((c) => c.date >= today) ?? null;
}
