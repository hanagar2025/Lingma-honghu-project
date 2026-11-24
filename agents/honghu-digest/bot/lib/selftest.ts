/**
 * 汇总 bot 自检。离线，数据全是编的，不需要任何口令。守五条：
 *   ① 打分照 half-year-plan 第二节：C 四条各 1 分，T 两条各 1 分，扣分 1 分，E = C + T − 扣分；缺数据的那条记 0 分并写明；
 *   ② 卖出、加仓、新开仓、换仓只核对条件，动作写规则原文；
 *   ③ S1–S5 只读脚本的 triggers，脚本没给就说没给，不自己核对；
 *   ④ 汇总里没有股数和金额；休市不出；只算不推时不写小程序；
 *   ⑤ 五个定时任务的时刻换成北京时间是 08:40、11:40、16:20、16:40、周五 16:50。
 */
import type { Client } from "./client.js";
import { compose, linesSection, mainlineGaps, triggersSection, type Inputs } from "./compose.js";
import { nextCheckpoint, PLAN, stopLine } from "./plan.js";
import { runSlot } from "./run.js";
import { addRoom, buildBoard, entryCheck, scoreAt, sellCheck } from "./score.js";
import type { Calendar, Digest, Mainline, Portfolio, Row, ScriptOutput, SeriesView, StockData } from "./types.js";

let passed = 0;
let failed = 0;
function ok(cond: boolean, name: string): void {
  if (cond) passed++;
  else failed++;
  process.stdout.write(`  ${cond ? "✓" : "✗"} ${name}\n`);
}

// ── 编的数据：70 个交易日，最后一天 2026-11-27（周五） ──

const N = 70;
const DAYS: string[] = [];
for (const d = new Date("2026-11-27T00:00:00Z"); DAYS.length < N; d.setUTCDate(d.getUTCDate() - 1)) {
  if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) DAYS.unshift(d.toISOString().slice(0, 10));
}
const LAST = DAYS[N - 1]!;
const PREV = DAYS[N - 2]!;

type Shape = { close?: (i: number) => number; main?: (i: number) => number | null; margin?: (i: number) => number | null; pct?: number; amount?: number; npYoy?: number | null };
function stock(name: string, s: Shape = {}): StockData {
  const rows: Row[] = DAYS.map((date, i) => ({
    date,
    close: (s.close ?? ((k) => 100 + k * 0.5))(i),
    amount: s.amount ?? 2_000_000_000,
    pct: i === N - 1 ? (s.pct ?? 0.01) : 0.01,
    main: (s.main ?? (() => 10_000_000))(i),
    margin: (s.margin ?? ((k) => 1e9 * (1 + k * 0.01)))(i),
  }));
  return { name, rows, earning: s.npYoy === null ? null : { report: "2026-09-30", notice: "2026-10-25", revYoy: 0.2, npYoy: s.npYoy ?? 0.3 } };
}
const up = (i: number): number => 100 + i * 0.5;
const down = (i: number): number => 200 - i * 0.5;
/** 一直在 60 日线上方，最后一天跌到线下 */
const crossDown = (i: number): number => (i === N - 1 ? 90 : 100 + i * 0.1);
const marginDown = (i: number): number => 1e9 * (1 - i * 0.004);

const STOCKS: Record<string, StockData> = {
  "300308": stock("强甲"),
  "002463": stock("弱乙", { close: down, main: () => -5_000_000, margin: marginDown }),
  "688981": stock("破线丙", { close: crossDown, margin: marginDown }),
  "688347": stock("候选丁"),
  "002371": stock("扣分戊", { npYoy: -0.2 }),
  "601138": stock("非两融己", { margin: () => null }),
  "603986": stock("追高庚", { pct: 0.05 }),
  "688008": stock("量小辛", { amount: 500_000_000 }),
  "300750": stock("链外壬", { main: (i) => (i >= N - 5 ? (i % 2 ? -1_000_000 : 9_000_000) : 1) }),
};
function makeView(over: Partial<SeriesView> = {}, stocks = STOCKS): SeriesView {
  return {
    generatedAt: `${LAST} 16:20:00`,
    asOf: LAST,
    marginAsOf: LAST,
    segments: [
      { layer: "上游", segment: "晶圆代工", codes: ["688981", "688347"] },
      { layer: "上游", segment: "半导体设备", codes: ["002371"] },
      { layer: "上游", segment: "存储", codes: ["603986", "688008"] },
      { layer: "中游", segment: "服务器、算力", codes: ["601138"] },
      { layer: "中游", segment: "光模块", codes: ["300308"] },
      { layer: "中游", segment: "PCB", codes: ["002463"] },
      { layer: "持仓", segment: "链外持仓", codes: ["300750"] },
    ],
    stocks,
    // 全市场融资每天 +0.1%
    marketMargin: DAYS.map((date, i) => ({ date, balance: 2e12 * (1 + i * 0.001) })),
    flags: [],
    gaps: [],
    ...over,
  };
}
const market = new Map(makeView().marketMargin.map((r) => [r.date, r.balance]));
const PORTFOLIO: Portfolio = {
  generatedAt: `${LAST} 16:20:00`,
  ledgerAsOf: LAST,
  positions: [
    { code: "300308", name: "强甲", weight: 0.14 },
    { code: "002463", name: "弱乙", weight: 0.12 },
    { code: "688981", name: "破线丙", weight: 0.05 },
    { code: "300750", name: "链外壬", weight: 0.04 },
  ],
  stockWeight: 0.35,
  cashWeight: 0.65,
  navIndex: 103.4,
  navHigh: 104,
  baseAt: "2026-11-24 09:37",
  gaps: [],
};
const calendar = (over: Partial<Calendar> = {}): Calendar => ({ now: `${LAST} 16:20:05`, today: LAST, weekday: 5, trading: true, lastClosed: LAST, marginAsOf: PREV, ...over });
const TRIGGERS: Mainline["triggers"] = {
  S1: { hit: false, segments: [], streak: { 光模块: 1, PCB: 0 } },
  S2: { hit: true, segments: ["晶圆代工"], streak: { 晶圆代工: 3, 半导体设备: 0 }, above20: { 晶圆代工: 0.33, 半导体设备: 0.83 } },
  S3: { hit: false, segments: [], streak: { 存储: 0 } },
  S4: { hit: false, segments: [], streak: { 机器人: 0 } },
  S5: { hit: false, streak: 2 },
};
const mainline = (data: Partial<Mainline> | null, error: string | null = null): ScriptOutput<Mainline> => ({
  state: data ? "ready" : "failed",
  date: LAST,
  dates: [DAYS[N - 6]!, LAST],
  data: data ? { last: LAST, margin_last: PREV, ranking: ["晶圆代工", "光模块", "PCB", "半导体设备", "存储", "服务器、算力"], segments: { 晶圆代工: { flow: "流入", main5: 0.02, main20: 0.01, margin5: 0.03 } }, streak: { 晶圆代工: 2 }, ...data } : null,
  text: null,
  error,
});
const inputs = (over: Partial<Inputs> = {}): Inputs => ({ calendar: calendar(), view: makeView(), portfolio: PORTFOLIO, mainline: mainline({ triggers: TRIGGERS }), watch: null, ...over });
const PRIVATE = /quantity|shares|"cash"|"cost"|totalAssets|marketValue|peakAssets/;

async function main(): Promise<void> {
  process.stdout.write("\n【打分】\n");
  const at = N - 1;
  let s = scoreAt("300308", "光模块", STOCKS["300308"]!, at, market, []);
  ok(s.c === 4 && s.t === 2 && s.deduction === 0 && s.e === 6, "融资好于全市场且为正、主力 5 天都流入且合计为正、站上两条线 → C=4、T=2、E=6");
  ok(Math.abs(s.margin5! - (1 + at * 0.01) / (1 + (at - 5) * 0.01) + 1) < 1e-12 && Math.abs(s.market5! - (1 + at * 0.001) / (1 + (at - 5) * 0.001) + 1) < 1e-12, "5 日融资变化 = 最新余额 ÷ 5 个交易日前的余额 − 1，个股和全市场同一算法");
  ok(s.mainDays === 5 && Math.abs(s.main5! - 5e7 / 1e10) < 1e-12 && !s.provisional && s.gaps.length === 0, "主力净流入天数和合计只看近 5 天");
  s = scoreAt("002463", "PCB", STOCKS["002463"]!, at, market, []);
  ok(s.c === 0 && s.t === 0 && s.e === 0 && s.marginUp === false && s.marginBeatsMarket === false, "融资下降、主力流出、两条线下方 → 0 分");
  s = scoreAt("002371", "半导体设备", STOCKS["002371"]!, at, market, []);
  ok(s.deduction === 1 && s.e === 5 && s.deductionWhy!.includes("净利同比 -20%"), "最新报告期净利同比为负：扣 1 分");
  s = scoreAt("300308", "光模块", STOCKS["300308"]!, at, market, [{ code: "300308", name: "强甲", reason: "出口管制", source: "公告", since: "2026-11-01", until: null }]);
  ok(s.deduction === 1 && s.e === 5 && s.deductionWhy === "出口管制", "登记在册的供应、监管冲击：扣 1 分");
  s = scoreAt("002371", "半导体设备", STOCKS["002371"]!, at, market, [{ code: "002371", name: "", reason: "冲击", source: "x", since: "2026-11-01", until: null }]);
  ok(s.deduction === 1 && s.e === 5, "两个扣分理由同时有，也只扣 1 分");
  s = scoreAt("300308", "光模块", STOCKS["300308"]!, at, market, [{ code: "300308", name: "", reason: "已解除", source: "x", since: "2026-01-01", until: "2026-06-30" }]);
  ok(s.deduction === 0, "已解除的冲击不扣分");
  s = scoreAt("601138", "服务器、算力", STOCKS["601138"]!, at, market, []);
  ok(s.c === 2 && s.marginUp === null && s.marginBeatsMarket === null && s.gaps.some((g) => g.includes("不是两融标的")), "不是两融标的：融资两条记 0 分，并写明");
  s = scoreAt("300750", "链外持仓", STOCKS["300750"]!, at, market, []);
  ok(s.mainDays === 2 && s.mainDaysOk === false && s.mainSumOk === true && s.c === 3, "主力只有 2 天流入但合计为正：天数那条不得分，合计那条得分");
  const lag = { ...STOCKS["300308"]!, rows: STOCKS["300308"]!.rows.map((r, i) => (i === at ? { ...r, margin: null } : r)) };
  s = scoreAt("300308", "光模块", lag, at, market, []);
  ok(s.provisional && s.marginDate === PREV && s.c === 4, "收盘时点融资还是前一天的：照算，标为初算");
  const stale = { ...lag, rows: lag.rows.map((r, i) => (i >= at - 2 ? { ...r, margin: null } : r)) };
  s = scoreAt("300308", "光模块", stale, at, market, []);
  ok(s.c === 2 && s.margin5 === null && s.gaps.some((g) => g.startsWith("融资停在")), "融资落后超过一天：融资两条记 0 分，写进缺口");
  const noFlow = { ...STOCKS["300308"]!, rows: STOCKS["300308"]!.rows.map((r, i) => (i === at - 1 ? { ...r, main: null } : r)) };
  s = scoreAt("300308", "光模块", noFlow, at, market, []);
  ok(s.c === 2 && s.mainDays === null && s.gaps.includes("近 5 天主力净流入不全"), "主力缺一天：主力两条记 0 分，不拿 4 天凑");
  s = scoreAt("300308", "光模块", { ...STOCKS["300308"]!, rows: STOCKS["300308"]!.rows.slice(-30) }, 29, market, []);
  ok(s.t === 1 && s.above60 === null && s.gaps.includes("不足 60 根日线"), "日线不足 60 根：60 日线那条不得分");
  s = scoreAt("300308", "光模块", { ...STOCKS["300308"]!, earning: null }, at, market, []);
  ok(s.deduction === 0 && s.gaps.includes("没有业绩报表"), "没有业绩报表：不扣分，写进缺口");

  process.stdout.write("\n【规则核对】\n");
  const board = buildBoard(makeView())!;
  let check = sellCheck(board.now["002463"]!, board.prev["002463"]);
  ok(check.clearByC && !check.halve && check.note === "资金 0 分", "资金 0 分 → 清仓条件成立（不再重复报减半）");
  const one = { ...board.now["300750"]!, c: 1 };
  ok(sellCheck(one, { ...one, c: 1 }).halve && !sellCheck(one, { ...one, c: 2 }).halve && !sellCheck(one, undefined).halve, "资金分连续 2 天 ≤1 → 减半条件成立；只有一天不算");
  check = sellCheck(board.now["688981"]!, board.prev["688981"]);
  ok(check.clearByTrend && board.now["688981"]!.c === 2, "收盘从 60 日线上方跌到下方，且 5 日融资为负 → 清仓条件成立");
  const below = board.now["002463"]!;
  ok(!sellCheck({ ...below, c: 2 }, { ...below, c: 2 }).clearByTrend, "一直在 60 日线下方（不是当天跌破）：不算");
  ok(!sellCheck({ ...board.now["688981"]!, margin5: 0.01 }, board.prev["688981"]).clearByTrend && !sellCheck({ ...board.now["688981"]!, margin5: null }, board.prev["688981"]).clearByTrend, "跌破 60 日线但融资没降，或融资缺数据：不算");
  const e6 = board.now["300308"]!;
  ok(addRoom(e6, 0.14, 0.2, 103, 85).cap === 0.2 && Math.abs(addRoom(e6, 0.14, 0.2, 103, 85).room - 0.06) < 1e-12, "E=6：单票上限 20%，已有 14% 还能加 6%");
  ok(addRoom({ ...e6, e: 5 }, 0.14, 0.2, 103, 85).cap === 0.15 && addRoom({ ...e6, e: 4 }, 0.14, 0.2, 103, 85).room === 0 && addRoom({ ...e6, e: 3 }, 0.01, 0, 103, 85).blockedBy === "E=3，不加", "E=5 上限 15%，E=4 上限 10%，E≤3 不加");
  ok(addRoom(e6, 0.14, 0.31, 103, 85).room === 0 && addRoom(e6, 0.14, 0.31, 103, 85).blockedBy!.includes("30%"), "光模块加 PCB 合计到 30%：不加（不触发卖出）");
  ok(Math.abs(addRoom(e6, 0.14, 0.27, 103, 85).room - 0.03) < 1e-12, "相关环节还剩 3% 的空间：最多加 3%");
  ok(Math.abs(addRoom({ ...e6, segment: "晶圆代工" }, 0.14, 0.31, 103, 85).room - 0.06) < 1e-12, "不属于相关环节的不受 30% 限制");
  ok(addRoom(e6, 0.14, 0.2, 84.9, 85).blockedBy!.includes("停手线") && addRoom(e6, 0.14, 0.2, 99, 100).room === 0, "净值在停手线以下：停止一切买入");
  ok(entryCheck(board.now["688347"]!).ok, "E≥5、涨幅 ≤3%、成交 ≥10 亿、没有扣分 → 准入");
  ok(entryCheck(board.now["603986"]!).why.join() === "当天涨幅 5.0%" && entryCheck(board.now["688008"]!).why.join() === "成交 5.0 亿" && entryCheck(board.now["002371"]!).why.join() === "有基本面扣分", "涨幅超 3%、成交不足 10 亿、有扣分：各自不准入");
  ok(stopLine(null) === 85 && stopLine(120.9) === 85 && stopLine(121) === 100 && stopLine(147) === 125, "停手线只上移：到过 121 移到 100，到过 147 移到 125");
  ok(nextCheckpoint("2026-11-27")!.index === 110 && nextCheckpoint("2026-12-21")!.index === 121 && nextCheckpoint("2027-05-21") === null, "进度线：12/20 110、1/20 121……5/20 178");
  ok(board.noCandidateDays === 0, "当天有 E≥5 的股票：连续无候选天数为 0");
  const weakView = makeView({}, { "002463": STOCKS["002463"]! });
  ok(buildBoard({ ...weakView, segments: [{ layer: "中游", segment: "PCB", codes: ["002463"] }] })!.noCandidateDays === PLAN.backup.days, "全链连续 10 天没有 E≥5：数到 10");
  ok(buildBoard(makeView({ asOf: null })) === null, "没有日线时不打分");

  process.stdout.write("\n【缺数据时不凭空造出卖出条件】\n");
  // 当天的主力净流入全都没取到（2026-11-24 东方财富断连接时的真实情形）
  const flowGone = Object.fromEntries(Object.entries(STOCKS).map(([c, x]) => [c, { ...x, rows: x.rows.map((r, i) => (i === N - 1 ? { ...r, main: null } : r)) }]));
  const gone = buildBoard(makeView({}, flowGone))!;
  const strongNow = gone.now["300308"]!;
  ok(strongNow.c === 2 && strongNow.cUnknown === 2 && strongNow.cUnknownWhy.join() === "主力净流入" && board.now["300308"]!.cUnknown === 0, "主力净流入缺：那两条记 0 分，同时记下是取不到才没得分");
  ok(gone.now["601138"]!.c === 0 && gone.now["601138"]!.cUnknown === 2 && board.now["601138"]!.cUnknown === 0, "不是两融标的：融资两条是确定的 0 分，不算取不到");
  // 弱乙：融资两条是确定的 0，主力两条缺 → 已得 0 分，但补齐后最多可到 2 分
  check = sellCheck(gone.now["002463"]!, gone.prev["002463"]);
  ok(!check.clearByC && !check.halve && check.unsure !== null && check.unsure.includes("资金 0 分") && check.unsure.includes("缺主力净流入数据") && check.unsure.includes("核对不了"), "缺主力数据使资金分看上去是 0：不算清仓条件成立，写核对不了");
  const lowSure = { ...board.now["300750"]!, c: 1, cUnknown: 0, cUnknownWhy: [] };
  const lowGap = { ...lowSure, c: 0, cUnknown: 1, cUnknownWhy: ["主力净流入"] };
  check = sellCheck(lowGap, lowSure);
  ok(check.halve && !check.clearByC && check.unsure !== null && check.unsure.startsWith("资金 0 分"), "补齐后最多 1 分、前一天也 ≤1：减半条件照样成立；0 分那条核对不了");
  check = sellCheck({ ...lowSure, c: 1, cUnknown: 2, cUnknownWhy: ["主力净流入"] }, lowSure);
  ok(!check.halve && check.unsure !== null && check.unsure.startsWith("资金分连续 2 天 ≤1"), "补齐后可能超过 1 分：减半条件核对不了，不算成立");
  check = sellCheck({ ...board.now["688981"]!, margin5: null }, board.prev["688981"]);
  ok(!check.clearByTrend && check.unsure !== null && check.unsure.includes("5 日融资算不出"), "当天跌破 60 日线但融资算不出：核对不了");
  ok(sellCheck(board.now["300308"]!, board.prev["300308"]).unsure === null && sellCheck(board.now["002463"]!, board.prev["002463"]).unsure === null, "数据齐的时候没有“核对不了”");
  let dGone = compose("close", inputs({ view: makeView({}, flowGone) }));
  ok(!dGone.markdown.includes("资金 0 分。规则：清仓") && !dGone.markdown.includes("规则：减半") && dGone.markdown.includes("卖出条件核对不了。不算成立，也不算不成立") && dGone.markdown.includes("- 弱乙：资金 0 分"), "收盘汇总：主力全缺时不报“资金 0 分”和“连续 2 天 ≤1”，逐只写核对不了");
  ok(dGone.markdown.includes("- 破线丙：收盘跌破 60 日线，5 日融资 -2.7%。规则：清仓"), "不靠主力数据的那条（跌破 60 日线且融资在降）照常报");
  ok(dGone.markdown.includes("（缺主力净流入，2 条算不出）") && dGone.markdown.includes("（不全）"), "持仓表里资金分和证据分标出不全");
  ok(dGone.push!.includes("另有 2 只持仓缺数据，卖出条件核对不了：弱乙、破线丙。"), "推送里说明有几只核对不了");
  ok((dGone.data.noCandidateDays as number) === 0 && dGone.markdown.includes("因为资金分算不全说不准，没有计入连续天数"), "全链没有 E≥5 的那天如果是缺数据造成的：不计入连续天数，写进缺口");
  dGone = compose("weekly", inputs({ view: makeView({}, flowGone) }));
  ok(dGone.data.rotate === false && dGone.markdown.includes("持仓里 E≤2：弱乙") && dGone.markdown.includes("候选里 E=6：没有") && dGone.markdown.includes("补齐后可能到 6：") && dGone.markdown.includes("候选丁（已得 E=4，缺主力净流入）") && dGone.markdown.includes("条件核对不了（缺数据），不算成立"), "周度：补齐后仍 ≤2 的持仓照算；候选缺数据到不了 6 的写核对不了，换仓条件不算成立");

  process.stdout.write("\n【三条线】\n");
  let lines = linesSection(PORTFOLIO, makeView(), LAST);
  ok(lines.breached.length === 0 && lines.stop === 85 && lines.lines.join("\n").includes("12-20 要到 110"), "净值 103.4：三条线都没触及，写出下一个进度线");
  lines = linesSection({ ...PORTFOLIO, navIndex: 94.9 }, makeView(), LAST);
  ok(lines.breached.length === 1 && lines.breached[0]!.startsWith("观察线 95") && lines.breached[0]!.includes("不开新股票"), "跌到 95 以下：观察线触及，动作写规则原文");
  lines = linesSection({ ...PORTFOLIO, navIndex: 84 }, makeView(), LAST);
  ok(lines.breached.length === 3 && lines.breached[2]!.includes("停止一切买入"), "跌到 85 以下：三条线都触及");
  lines = linesSection({ ...PORTFOLIO, navIndex: 99, navHigh: 122 }, makeView(), LAST);
  ok(lines.stop === 100 && lines.breached.length === 1 && lines.breached[0]!.startsWith("停手线 100"), "到过 121 之后回落到 99：触及上移后的停手线");
  lines = linesSection({ ...PORTFOLIO, navIndex: null, gaps: ["净值基准还没填，指数算不出"] }, makeView(), LAST);
  ok(lines.breached.length === 0 && lines.lines.join("\n").includes("三条线今天核对不了"), "净值基准没填：照实说核对不了");
  ok(lines.lines.join("\n").includes("合计 26.0%"), "相关环节合计 = 光模块加 PCB 的持仓占比");

  process.stdout.write("\n【S1–S5】\n");
  let trig = triggersSection(mainline({ triggers: TRIGGERS }));
  ok(trig.hits.length === 1 && trig.hits[0]!.startsWith("S2 晶圆代工或设备退潮（晶圆代工）") && trig.hits[0]!.includes("各减半"), "脚本说 S2 成立：照报，附规则原文的动作");
  ok(trig.lines.join("\n").includes("晶圆代工 连续 3 日、站上 20 日线 33%") && trig.lines.join("\n").includes("连续 2 日"), "读数取自脚本的 streak 和 above20");
  trig = triggersSection(mainline({}));
  ok(trig.hits.length === 0 && trig.lines.join("\n").includes("脚本输出里没有 triggers") && trig.lines.join("\n").includes("不自行核对"), "脚本输出缺 triggers：说缺，不自己算");
  trig = triggersSection(mainline(null, "脚本退出码 1"));
  ok(trig.lines.join("\n").includes("脚本退出码 1"), "脚本没跑成：带上原因");

  process.stdout.write("\n【脚本记下的缺项】\n");
  const view0 = makeView();
  const someCode = Object.keys(view0.stocks)[0]!;
  const MISSING: NonNullable<Mainline["missing"]> = { kline: [someCode, "999999"], kline_backup: ["甲", "乙"], flow: Array.from({ length: 14 }, (_, i) => `股${i}`), margin: ["丙"], earnings: true, ranking_from: PREV, flow_short: true };
  const shortData: Partial<Mainline> = { triggers: TRIGGERS, missing: MISSING, segments: { 晶圆代工: { flow: "缺", main5: null, main20: null, margin5: 0.03, main_cov: "0/3" } } };
  let gaps = mainlineGaps(mainline(shortData).data, view0);
  ok(gaps[0] === `主力数据过半缺失：环节名次沿用 ${PREV} 的排序，不是 ${LAST} 当天算出来的`, "主力过半缺失：写明名次沿用哪一天的");
  ok(gaps.some((g) => g.includes("S5 当天不计入")), "所有环节都没有主力数据：写明 S5 当天不计入");
  ok(gaps.some((g) => g.startsWith("日线两家都取不到") && g.includes(`2 只：${view0.stocks[someCode]!.name}、999999`)), "日线取不到的股票：代码换成名称，查不到名称就写代码");
  ok(gaps.some((g) => g.startsWith("主力净流入缺，14 只：股0、") && g.endsWith("股11 等")), "缺的股票多时列前 12 只并写总数");
  ok(gaps.some((g) => g.startsWith("融资缺") && g.includes("丙")) && gaps.includes("业绩取不到，净利同比为空") && gaps.some((g) => g.startsWith("日线改用腾讯") && g.includes("甲、乙")), "融资、业绩、改用腾讯的都照写");
  ok(gaps.some((g) => g.startsWith("没有读数的环节") && g.includes("光模块")), "脚本没给读数的环节单列出来");
  ok(mainlineGaps(mainline({ triggers: TRIGGERS }).data, view0).length === 0, "旧存档没有 missing 字段：不编缺项");
  gaps = mainlineGaps(mainline({ missing: { ...MISSING, kline: [], kline_backup: [], flow: [], margin: [], earnings: false, ranking_from: null } }).data, view0);
  ok(gaps[0]!.includes("此前没有存档可沿用") && gaps[0]!.includes("用不全的数据排的"), "主力过半缺失又没有旧存档：照实说名次不可靠");
  trig = triggersSection(mainline(shortData));
  ok(trig.lines.join("\n").includes(`环节名次沿用 ${PREV} 的排序`) && trig.lines.join("\n").includes("S5 当天不计入") && trig.hits[0]!.endsWith(`（主力数据过半缺失，环节名次沿用 ${PREV}）`), "S1–S5 一节和推送都带上沿用日期");
  let dShort = compose("close", inputs({ mainline: mainline(shortData) }));
  ok(dShort.markdown.includes(`脚本 ${LAST} 这份读数的缺项：`) && dShort.markdown.includes("| 主力覆盖 |") && dShort.markdown.includes("| 0/3 |") && dShort.markdown.includes("无读数"), "收盘汇总：缺项清单、主力覆盖一列、没有读数的环节");
  ok((dShort.data.scriptMissing as { ranking_from?: string } | null)?.ranking_from === PREV && dShort.push!.includes(`环节名次沿用 ${PREV}`), "缺项原样存进汇总的数据里，推送里也有");
  const allSegs = Object.fromEntries(view0.segments.map((g) => [g.segment, { flow: "分歧", main5: 0.01, main20: 0.01, margin5: 0.01, main_cov: "3/3" }]));
  dShort = compose("close", inputs({ mainline: mainline({ triggers: TRIGGERS, segments: allSegs, missing: { kline: [], kline_backup: [], flow: [], margin: [], earnings: false, ranking_from: null, flow_short: false } }) }));
  ok(dShort.markdown.includes(`脚本 ${LAST} 这份读数没有缺项。`), "脚本说没有缺项：照写");

  process.stdout.write("\n【五份汇总】\n");
  const lagView = makeView({ marginAsOf: PREV }, Object.fromEntries(Object.entries(STOCKS).map(([c, x]) => [c, { ...x, rows: x.rows.map((r, i) => (i === at ? { ...r, margin: null } : r)) }])));
  let d = compose("close", inputs({ view: lagView }));
  ok(d.slot === "close" && d.date === LAST && d.asOf === LAST && d.title === `${LAST} 收盘汇总`, "收盘汇总：日期、时点、数据截止日");
  ok(d.markdown.includes("（初算）") && d.markdown.includes("明早 08:40 定稿"), "收盘时资金分标为初算");
  ok(d.markdown.includes("弱乙：资金 0 分。规则：清仓（初算") && d.markdown.includes("破线丙：收盘跌破 60 日线"), "卖出条件成立的逐条列出");
  ok(d.push !== null && d.push.includes("S2 晶圆代工或设备退潮") && d.push.includes("弱乙") && d.push.includes("满足新开仓准入：候选丁"), "手机短讯只写成立的条件和准入名单");
  ok(d.markdown.includes("| 候选丁 | 晶圆代工 |") && d.markdown.includes("不满足：当天涨幅 5.0%") && !d.markdown.includes("| 强甲 | 光模块 | 4"), "候选表只列未持有的，写明哪条不满足");
  ok(!d.markdown.includes("*") && d.markdown.split("\n").every((l) => !/^#{4,}/.test(l)), "版式只用页面认得的标题、列表、表格");
  ok(!PRIVATE.test(JSON.stringify(d)), "汇总里没有股数和金额");
  ok(d.markdown.endsWith("下单由委员会本人操作。") && !/买入\s*\d+\s*股|卖出\s*\d+\s*股/.test(d.markdown), "汇总不是指令，不出股数");
  d = compose("close", inputs({ calendar: calendar({ today: "2026-11-30", now: "2026-11-30 16:20:05" }), view: lagView }));
  ok(d.markdown.includes(`今天（2026-11-30）的日线还没有拉到，下面是 ${LAST} 的读数`) && d.data.stale === true, "今天的日线没到：写明用的是哪天的读数");

  d = compose("pre", inputs({ calendar: calendar({ trading: false, today: "2026-11-30", now: "2026-11-30 08:40:03", weekday: 1, marginAsOf: LAST }) }));
  ok(d.markdown.includes("资金分定稿") && d.data.marginFinal === true && d.markdown.includes("按工作日出"), "盘前：融资已公布，资金分定稿");
  const jump = { ...STOCKS, "300308": { ...STOCKS["300308"]!, rows: STOCKS["300308"]!.rows.map((r, i) => (i === at ? { ...r, margin: r.margin! * 0.9 } : r)) } };
  d = compose("pre", inputs({ view: makeView({}, jump) }));
  ok(d.markdown.includes("| 强甲 | 14.0% | 4 → 2 |"), "融资公布后资金分变了：写出初算 → 定稿");
  d = compose("pre", inputs({ view: lagView }));
  ok(d.markdown.includes("融资还没公布，资金分仍是初算") && d.data.marginFinal === false, "盘前融资还没公布：照实说");

  const quotes = Object.fromEntries(Object.keys(STOCKS).map((c) => [c, { price: 10, pct: c === "688347" ? 0.045 : 0.012, amount: 4e8, main: c === "300308" ? -2e7 : 1e7 }]));
  d = compose("midday", inputs({ intraday: { date: LAST, count: 1, latest: { at: `${LAST} 11:35:02`, sourceAt: `${LAST} 11:30:00`, quotes, failed: [] } } }));
  ok(d.markdown.includes("| 强甲 | 14.0% | +1.2% | -0.2 亿，-5.0% |") && d.markdown.includes("盘中快照"), "午间：持仓上午的涨跌和主力净流入");
  ok(d.markdown.includes("候选丁") && d.markdown.includes("不满足：当天涨幅 4.5%") && !d.markdown.includes("不满足：成交"), "午间准入按盘中涨幅核对，不拿半天的成交额卡");
  d = compose("midday", inputs({ intraday: { date: LAST, count: 0, latest: null } }));
  ok(typeof d.data.skipped === "string" && d.push === null, "上午的快照没取到：午间汇总只说出不了，不拿旧数顶");

  d = compose("scan", inputs({ scan: { state: "ready", date: LAST, dates: [LAST], data: { breadth: { last: { "站上 20 日线": 0.2 } } }, text: "## 一、宽度\n\n| 项 | 值 |\n|---|---|\n| 站上 20 日线 | 20% |\n", error: null } }));
  ok(d.markdown.includes("## 全市场扫描（脚本输出原文）\n\n## 一、宽度") && d.markdown.indexOf("切换触发 S1–S5") < d.markdown.indexOf("脚本输出原文"), "全市场扫描：脚本输出原文照附，前面是 S1–S5 和环节排序");
  d = compose("scan", inputs({ scan: { state: "running", date: LAST, dates: [], data: null, text: null, error: null } }));
  ok(d.data.skipped !== undefined && d.markdown.includes("脚本还在跑"), "脚本到点没跑完：照实说，不出半份");

  d = compose("weekly", inputs({ mainlinePrevWeek: { last: DAYS[N - 6]!, ranking: ["光模块", "晶圆代工"] } }));
  ok(d.data.rotate === true && d.markdown.includes("持仓里 E≤2：弱乙（E=0，C=0，T=0）") && d.markdown.includes("条件成立：按规则下周一换仓"), "周度：持仓 E≤2 且有候选 E=6 → 换仓条件成立");
  ok(d.markdown.includes("这是初算") && d.markdown.includes("周一 08:40 盘前汇总复核") && d.markdown.includes("| 1 | 2 | 晶圆代工 |"), "周度结论是初算，周一复核；环节排序带上周五名次");
  const noStrong = Object.fromEntries(Object.entries(STOCKS).filter(([c]) => !["688347", "603986", "688008"].includes(c)));
  d = compose("weekly", inputs({ view: makeView({}, noStrong) }));
  ok(d.data.rotate === false && d.markdown.includes("候选里 E=6：没有") && d.markdown.includes("条件不成立：按规则不换仓"), "没有 E=6 的候选：不换仓");
  ok(d.markdown.includes(`本周 ${DAYS[N - 5]} 至 ${LAST}`), "周度的区间是本周一到周五");

  process.stdout.write("\n【到点运行】\n");
  const posted: Digest[] = [];
  const jobs: string[] = [];
  const client = (cal: Calendar, ml: ScriptOutput<Mainline>, view = lagView): Client => ({
    calendar: async () => cal,
    series: async () => view,
    portfolio: async () => PORTFOLIO,
    intraday: async () => ({ date: cal.today, count: 0, latest: null }),
    watch: async () => ({ at: cal.now, live: false, statuses: [], note: null }),
    mainline: async (date) => (date ? ml : { ...ml, state: ml.data ? "ready" : "missing" }),
    scan: async () => ({ state: "running", date: LAST, dates: [], data: null, text: null, error: null }),
    job: async (name) => {
      jobs.push(name);
      return {};
    },
    post: async (digest) => {
      posted.push(digest);
      return { ok: true, revision: posted.length };
    },
  });
  const fast = { sleep: async () => undefined, waitMs: 5, pollMs: 1 };
  let r = await runSlot(client(calendar(), mainline({ triggers: TRIGGERS })), "close", { ...fast, dryRun: true });
  ok(!r.posted && r.revision === null && posted.length === 0 && r.markdown.includes("收盘汇总"), "只算不推：不写小程序");
  r = await runSlot(client(calendar(), mainline({ triggers: TRIGGERS })), "close", fast);
  ok(r.posted && r.revision === 1 && posted[0]!.slot === "close" && posted[0]!.source === "honghu-digest", "到点：算完推到小程序");
  r = await runSlot(client(calendar({ trading: false }), mainline({ triggers: TRIGGERS })), "close", fast);
  ok(r.skipped === "今天休市，不出汇总。" && posted[1]!.push === null, "休市：只留一条“休市”，不发短讯");
  r = await runSlot(client(calendar({ trading: false, weekday: 1 }), mainline({ triggers: TRIGGERS })), "pre", { ...fast, dryRun: true });
  ok(r.skipped === null && r.markdown.includes("盘前汇总"), "盘前判断不出是否开市：工作日照出");
  r = await runSlot(client(calendar({ trading: false, weekday: 6 }), mainline({ triggers: TRIGGERS })), "pre", { ...fast, dryRun: true });
  ok(r.skipped !== null, "周末不出盘前汇总");
  jobs.length = 0;
  r = await runSlot(client(calendar({ lastClosed: PREV }), mainline({ triggers: TRIGGERS })), "close", { ...fast, dryRun: true });
  ok(jobs.join() === "daily", "收盘时今天的日线还没到：催后端补拉一次");
  r = await runSlot(client(calendar(), mainline(null, "脚本退出码 1")), "close", { ...fast, dryRun: true });
  ok(r.markdown.includes("脚本输出里没有 triggers（脚本退出码 1）"), "脚本没跑成：S1–S5 写没有读数和原因");
  r = await runSlot(client(calendar(), mainline({ triggers: TRIGGERS })), "scan", { ...fast, dryRun: true });
  ok(r.skipped !== null && r.skipped.includes("脚本还在跑"), "全市场扫描等不到脚本：照实说");
  let threw = "";
  try {
    const { makeClient } = await import("./client.js");
    makeClient({});
  } catch (e) {
    threw = e instanceof Error ? e.message : "";
  }
  ok(threw.includes("HONGHU_AGENT_TOKEN"), "没配口令：直接报缺哪个环境密钥");
  const { makeClient } = await import("./client.js");
  const seen: { url: string; auth: string }[] = [];
  const secret = "selftest-token-not-a-real-one";
  const failing = (async (url: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(url), auth: String((init?.headers as Record<string, string>).Authorization) });
    return new Response(JSON.stringify({ error: "口令不对" }), { status: 401 });
  }) as typeof fetch;
  let message = "";
  try {
    await makeClient({ HONGHU_AGENT_TOKEN: secret, HONGHU_SERVER_URL: "http://127.0.0.1:9/" }, failing).calendar();
  } catch (e) {
    message = e instanceof Error ? e.message : "";
  }
  ok(seen.length === 1 && seen[0]!.url === "http://127.0.0.1:9/api/chain/calendar" && seen[0]!.auth === `Bearer ${secret}`, "口令只放在请求头里；口令不对不重试");
  ok(message.includes("401") && message.includes("口令不对") && !message.includes(secret), "报错里没有口令");

  process.stdout.write("\n【定时】\n");
  const want: Record<string, { cron: string; bj: string }> = {
    pre: { cron: "40 0 * * 1-5", bj: "08:40" },
    midday: { cron: "40 3 * * 1-5", bj: "11:40" },
    close: { cron: "20 8 * * 1-5", bj: "16:20" },
    scan: { cron: "40 8 * * 1-5", bj: "16:40" },
    weekly: { cron: "50 8 * * 5", bj: "16:50" },
  };
  for (const [name, w] of Object.entries(want)) {
    const mod = (await import(`../schedules/${name}.js`)) as { default: { cron: string; run?: (a: unknown) => Promise<void> } };
    const [m, h] = mod.default.cron.split(" ");
    const bj = `${String(Number(h) + 8).padStart(2, "0")}:${String(Number(m)).padStart(2, "0")}`;
    const called: unknown[] = [];
    await mod.default.run!({ callTool: async (tool: string, input: unknown) => (called.push([tool, input]), { isError: false }) });
    ok(mod.default.cron === w.cron && bj === w.bj && JSON.stringify(called) === JSON.stringify([["run_digest", { slot: name }]]), `${name}：北京时间 ${w.bj}，直接调用 run_digest，不经过模型`);
  }
  const close = (await import("../schedules/close.js")) as { default: { run?: (a: unknown) => Promise<void> } };
  let failedRun = false;
  await close.default.run!({ callTool: async () => ({ isError: true }) }).catch(() => (failedRun = true));
  ok(failedRun, "工具出错时定时任务记为失败");
}

main()
  .catch((e) => {
    failed++;
    process.stderr.write(`自检出错：${e instanceof Error ? e.stack : String(e)}\n`);
  })
  .finally(() => {
    process.stdout.write(`\n汇总 bot 自检：通过 ${passed}，失败 ${failed}\n`);
    process.exit(failed ? 1 : 0);
  });
