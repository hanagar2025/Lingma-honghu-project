/**
 * 打分。口径照抄 docs/half-year-plan.md 第二节，不另起一套：
 *
 *   资金分 C（0–4），每条 1 分：
 *     5 日融资变化好于全市场；5 日融资变化 ≥0；近 5 天主力净流入的天数 ≥3；近 5 天主力净流入合计 >0
 *   趋势分 T（0–2）：站上 20 日线 1 分，站上 60 日线 1 分
 *   基本面扣分：最新报告期净利同比为负，或登记在册的供应、监管冲击，扣 1 分
 *   证据分 E = C + T − 扣分
 *
 * 5 日融资变化、均线的算法与 scripts/ai-mainline-map.py 一致：
 *   5 日融资变化 = 最新融资余额 / 5 个交易日前的融资余额 − 1；站上 N 日线 = 收盘价高于最近 N 个收盘价的均值。
 *
 * 数据缺的那一条记 0 分，并写进 gaps，不猜。
 * 记 0 分对买入是保守的（分不够就不加、不开），对卖出却会凭空造出“资金 0 分”：
 * 所以另记 cUnknown（有几条是取不到数才没得分的）。卖出条件只在算得全的时候才算成立，算不全就写“核对不了”。
 * 不是两融标的的股票没有融资数据，那两条是确定的 0 分，不算取不到。
 * 融资余额次日早间才公布：收盘时点算出的资金分用的是前一交易日的融资，标为“初算”。
 */
import { PLAN } from "./plan.js";
import type { Flag, Row, Segment, SeriesView, StockData } from "./types.js";

export type Score = {
  code: string;
  name: string;
  segment: string;
  /** 这一行打分所在的交易日 */
  date: string;
  close: number;
  pct: number;
  amount: number;
  c: number;
  /** 资金分四条里，有几条是因为取不到数才没得分的。0 = 资金分算得全 */
  cUnknown: number;
  /** 取不到的是哪几样：主力净流入、融资 */
  cUnknownWhy: string[];
  marginBeatsMarket: boolean | null;
  marginUp: boolean | null;
  mainDaysOk: boolean | null;
  mainSumOk: boolean | null;
  margin5: number | null;
  market5: number | null;
  marginDate: string | null;
  mainDays: number | null;
  /** 近 5 天主力净流入合计占成交额的比例 */
  main5: number | null;
  t: number;
  above20: boolean | null;
  above60: boolean | null;
  /** 收盘价相对 20、60 日线的距离，小数 */
  d20: number | null;
  d60: number | null;
  deduction: number;
  deductionWhy: string | null;
  e: number;
  /** 融资比日线晚一天：资金分是初算 */
  provisional: boolean;
  gaps: string[];
};

const mean = (xs: number[]): number => xs.reduce((s, x) => s + x, 0) / xs.length;

/** 在第 at 根（含）为止的数据上打分 */
export function scoreAt(
  code: string,
  segment: string,
  stock: StockData,
  at: number,
  market: ReadonlyMap<string, number>,
  flags: readonly Flag[],
): Score {
  const rows = stock.rows;
  const row = rows[at]!;
  const gaps: string[] = [];

  // 趋势
  const closes = rows.slice(0, at + 1).map((r) => r.close);
  const ma20 = closes.length >= 20 ? mean(closes.slice(-20)) : null;
  const ma60 = closes.length >= 60 ? mean(closes.slice(-60)) : null;
  if (ma20 === null) gaps.push("不足 20 根日线");
  if (ma60 === null) gaps.push("不足 60 根日线");
  const above20 = ma20 === null ? null : row.close > ma20;
  const above60 = ma60 === null ? null : row.close > ma60;

  // 主力
  const last5: Row[] = rows.slice(Math.max(0, at - 4), at + 1);
  let mainDays: number | null = null;
  let mainSum: number | null = null;
  if (last5.length === 5 && last5.every((r) => r.main !== null)) {
    mainDays = last5.filter((r) => (r.main as number) > 0).length;
    mainSum = last5.reduce((s, r) => s + (r.main as number), 0);
  } else gaps.push("近 5 天主力净流入不全");
  const amount5 = last5.reduce((s, r) => s + r.amount, 0);

  // 融资：取到 at 为止最新公布的一天，和它 5 个交易日前比
  let m = at;
  while (m >= 0 && rows[m]!.margin === null) m--;
  let margin5: number | null = null;
  let market5: number | null = null;
  const marginDate = m >= 0 ? rows[m]!.date : null;
  if (m < 0) gaps.push("没有融资数据（不是两融标的）");
  else if (at - m > 1) gaps.push(`融资停在 ${marginDate}`);
  if (m >= 5 && at - m <= 1) {
    const before = rows[m - 5]!;
    if (before.margin !== null && before.margin > 0) margin5 = rows[m]!.margin! / before.margin - 1;
    else gaps.push("5 个交易日前没有融资余额");
    const mNow = market.get(rows[m]!.date);
    const mBefore = market.get(before.date);
    if (mNow !== undefined && mBefore !== undefined && mBefore > 0) market5 = mNow / mBefore - 1;
    else gaps.push("全市场融资不全");
  }
  const marginBeatsMarket = margin5 === null || market5 === null ? null : margin5 > market5;
  const marginUp = margin5 === null ? null : margin5 >= 0;
  const mainDaysOk = mainDays === null ? null : mainDays >= 3;
  const mainSumOk = mainSum === null ? null : mainSum > 0;
  const c = [marginBeatsMarket, marginUp, mainDaysOk, mainSumOk].filter((x) => x === true).length;
  const noMarginTarget = m < 0;
  const marginUnknown = noMarginTarget ? 0 : [marginBeatsMarket, marginUp].filter((x) => x === null).length;
  const mainUnknown = [mainDaysOk, mainSumOk].filter((x) => x === null).length;
  const cUnknownWhy = [...(mainUnknown ? ["主力净流入"] : []), ...(marginUnknown ? ["融资"] : [])];
  const t = [above20, above60].filter((x) => x === true).length;

  // 基本面扣分
  const why: string[] = [];
  const np = stock.earning?.npYoy ?? null;
  if (np !== null && np < 0) why.push(`${stock.earning!.report.slice(0, 7)} 报告期净利同比 ${(np * 100).toFixed(0)}%`);
  if (!stock.earning) gaps.push("没有业绩报表");
  for (const f of flags) {
    if (f.code === code && f.since <= row.date && (f.until === null || f.until >= row.date)) why.push(f.reason);
  }
  const deduction = why.length ? 1 : 0;

  return {
    code,
    name: stock.name,
    segment,
    date: row.date,
    close: row.close,
    pct: row.pct,
    amount: row.amount,
    c,
    cUnknown: marginUnknown + mainUnknown,
    cUnknownWhy,
    marginBeatsMarket,
    marginUp,
    mainDaysOk,
    mainSumOk,
    margin5,
    market5,
    marginDate,
    mainDays,
    main5: mainSum === null || amount5 <= 0 ? null : mainSum / amount5,
    t,
    above20,
    above60,
    d20: ma20 === null ? null : row.close / ma20 - 1,
    d60: ma60 === null ? null : row.close / ma60 - 1,
    deduction,
    deductionWhy: why.length ? why.join("；") : null,
    e: c + t - deduction,
    provisional: m >= 0 && m < at,
    gaps,
  };
}

export type Board = {
  asOf: string;
  /** 每只股票在 asOf（或它自己最后一个交易日）的分 */
  now: Record<string, Score>;
  /** 前一个交易日的分。卖出规则“连续 2 天”要用 */
  prev: Record<string, Score>;
  /** 截至 asOf，连续多少个交易日全链没有一只 E≥5；最多数到 limit */
  noCandidateDays: number;
  gaps: string[];
};

export function segmentOf(segments: readonly Segment[], code: string): string {
  return segments.find((s) => s.codes.includes(code))?.segment ?? "";
}

/** 全链打分。asOf 缺省取日线最新的已收盘交易日 */
export function buildBoard(view: SeriesView, asOf = view.asOf): Board | null {
  if (!asOf) return null;
  const market = new Map(view.marketMargin.map((r) => [r.date, r.balance]));
  const now: Record<string, Score> = {};
  const prev: Record<string, Score> = {};
  const gaps: string[] = [];
  const history: Score[][] = Array.from({ length: PLAN.backup.days }, () => []);
  for (const seg of view.segments) {
    for (const code of seg.codes) {
      const stock = view.stocks[code];
      if (!stock) {
        gaps.push(`${code} 没有数据`);
        continue;
      }
      // 这只股票在 asOf 当天（停牌就取之前最后一天）的那一根
      let at = stock.rows.length - 1;
      while (at >= 0 && stock.rows[at]!.date > asOf) at--;
      if (at < 0) {
        gaps.push(`${stock.name} 没有 ${asOf} 之前的日线`);
        continue;
      }
      if (stock.rows[at]!.date !== asOf) gaps.push(`${stock.name} 日线停在 ${stock.rows[at]!.date}`);
      now[code] = scoreAt(code, seg.segment, stock, at, market, view.flags);
      if (at >= 1) prev[code] = scoreAt(code, seg.segment, stock, at - 1, market, view.flags);
      for (let k = 0; k < PLAN.backup.days && at - k >= 0; k++) {
        history[k]!.push(k === 0 ? now[code]! : scoreAt(code, seg.segment, stock, at - k, market, view.flags));
      }
    }
  }
  // 某天有股票的资金分算不全、补齐后可能到 E≥5：这一天说不准，不计入也不打断，写进缺口
  let noCandidateDays = 0;
  let unsureDays = 0;
  for (const day of history) {
    if (!day.length || day.some((s) => s.e >= PLAN.backup.minE)) break;
    if (day.some((s) => s.e + s.cUnknown >= PLAN.backup.minE)) unsureDays++;
    else noCandidateDays++;
  }
  if (unsureDays) gaps.push(`“全链没有一只 E≥5”有 ${unsureDays} 天因为资金分算不全说不准，没有计入连续天数`);
  return { asOf, now, prev, noCandidateDays, gaps };
}

// ── 规则核对：只回答“条件成立没有”，动作写规则原文 ──

export type SellCheck = {
  code: string;
  name: string;
  /** 资金分连续 2 天 ≤1 → 减半 */
  halve: boolean;
  /** 资金 0 分 → 清仓 */
  clearByC: boolean;
  /** 收盘跌破 60 日线且融资在降 → 清仓 */
  clearByTrend: boolean;
  provisional: boolean;
  note: string;
  /** 资金分算不全，按已有的数看像是成立、但不能算成立的那几条。null = 都核对得了 */
  unsure: string | null;
};

/**
 * 卖出条件。两处取了最贴近原文的读法，汇总里照实写明：
 *   “收盘跌破 60 日线” = 当天收盘从线上跌到线下（前一天收盘不低于 60 日线）。
 *     不取“在线下方”这个状态：战略书第三节里多只持仓在 60 日线下方、5 日融资为负，写的都是“拿”。
 *   “融资在降” = 5 日融资变化为负。
 */
export function sellCheck(now: Score, prev: Score | undefined): SellCheck {
  // 算得全才算成立：c + cUnknown 是补齐数据后资金分最多能到的数
  const top = (s: Score): number => s.c + s.cUnknown;
  const halve = top(now) <= 1 && prev !== undefined && top(prev) <= 1;
  const clearByC = top(now) === 0;
  const crossed = now.above60 === false && prev?.above60 === true;
  const clearByTrend = crossed && now.margin5 !== null && now.margin5 < 0;
  const parts: string[] = [];
  if (clearByC) parts.push("资金 0 分");
  else if (halve) parts.push(`资金分连续 2 天 ≤1（前一日 ${prev!.c}，当日 ${now.c}）`);
  if (crossed) parts.push(`收盘跌破 60 日线，5 日融资 ${now.margin5 === null ? "缺" : `${(now.margin5 * 100).toFixed(1)}%`}`);

  // 按已有的数看像是成立、但缺数据的
  const lacking = [...new Set([...now.cUnknownWhy, ...(prev && prev.c <= 1 ? prev.cUnknownWhy : [])])].join("、");
  const doubt: string[] = [];
  if (!clearByC && now.c === 0) doubt.push("资金 0 分");
  if (!halve && !clearByC && now.c <= 1 && prev !== undefined && prev.c <= 1) doubt.push("资金分连续 2 天 ≤1");
  if (crossed && now.margin5 === null && now.marginDate !== null) doubt.push("收盘跌破 60 日线且融资在降（5 日融资算不出）");
  const unsure = doubt.length ? `${doubt.join("、")}：缺${lacking || "融资"}数据，资金分已得 ${now.c} 分、另有 ${now.cUnknown} 条算不出，核对不了` : null;
  return { code: now.code, name: now.name, halve: halve && !clearByC, clearByC, clearByTrend, provisional: now.provisional, note: parts.join("；"), unsure };
}

export type AddRoom = {
  code: string;
  name: string;
  weight: number;
  /** 证据分对应的单票上限；E≤3 为 0 */
  cap: number;
  /** 还能加多少（占总资产）。相关环节合计超 30% 时为 0 */
  room: number;
  blockedBy: string | null;
};

/** 加仓空间。相关环节（光模块加 PCB）合计超过 30% 只限加仓，不触发卖出 */
export function addRoom(score: Score, weight: number, relatedWeight: number, navIndex: number | null, stop: number): AddRoom {
  const cap = PLAN.addCap[score.e] ?? 0;
  let blockedBy: string | null = null;
  const related = (PLAN.related.segments as readonly string[]).includes(score.segment);
  if (cap === 0) blockedBy = `E=${score.e}，不加`;
  else if (related && relatedWeight >= PLAN.related.cap) blockedBy = `相关环节合计 ${(relatedWeight * 100).toFixed(1)}%，已到 30%`;
  else if (navIndex !== null && navIndex <= stop) blockedBy = `净值指数在停手线 ${stop} 以下，停止一切买入`;
  let room = blockedBy ? 0 : Math.max(0, cap - weight);
  if (!blockedBy && related) room = Math.min(room, Math.max(0, PLAN.related.cap - relatedWeight));
  return { code: score.code, name: score.name, weight, cap, room, blockedBy };
}

/** 新开仓准入：E≥5、当天涨幅 ≤3%、日成交 ≥10 亿、没有基本面扣分 */
export function entryCheck(s: Score, pctNow = s.pct, amountNow = s.amount): { ok: boolean; why: string[] } {
  const why: string[] = [];
  if (s.e < PLAN.entry.minE) why.push(`E=${s.e}`);
  if (pctNow > PLAN.entry.maxPct) why.push(`当天涨幅 ${(pctNow * 100).toFixed(1)}%`);
  if (amountNow < PLAN.entry.minAmount) why.push(`成交 ${(amountNow / 1e8).toFixed(1)} 亿`);
  if (s.deduction > 0) why.push("有基本面扣分");
  return { ok: why.length === 0, why };
}
