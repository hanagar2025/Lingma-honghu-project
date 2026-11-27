/**
 * 把读数排成五份汇总。纯函数：同样的输入出同样的文字，不取数、不联网。
 *
 * 汇总只写三样东西：读数、排序、规则里的条件成立没有。成立时附规则原文写的动作，
 * 不替策略方下结论，不产生买卖指令。版式只用标题、列表、表格、段落（小程序页面只认这几种）。
 */
import { nextCheckpoint, PLAN, stopLine } from "./plan.js";
import { addRoom, buildBoard, entryCheck, sellCheck, type Board, type Score } from "./score.js";
import type { Calendar, Digest, Intraday, Mainline, Portfolio, ScriptOutput, SeriesView, SlotId, Watch } from "./types.js";

export const SOURCE = "honghu-digest";

export type Inputs = {
  calendar: Calendar;
  view: SeriesView;
  portfolio: Portfolio;
  mainline: ScriptOutput<Mainline> | null;
  watch: Watch | null;
  intraday?: Intraday | null;
  scan?: ScriptOutput<Record<string, unknown>> | null;
  /** 上一个周五（或更早最近一天）的脚本读数，周度排序比名次用 */
  mainlinePrevWeek?: Mainline | null;
};

const SLOT_LABEL: Record<SlotId, string> = { pre: "盘前", midday: "午间", close: "收盘", scan: "全市场扫描", weekly: "周度" };

// ── 小工具 ──

const pct = (v: number | null | undefined, d = 1): string => (v === null || v === undefined ? "—" : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(d)}%`);
const share = (v: number | null | undefined, d = 1): string => (v === null || v === undefined ? "—" : `${(v * 100).toFixed(d)}%`);
const yi = (v: number | null | undefined): string => (v === null || v === undefined ? "—" : `${v >= 0 ? "+" : ""}${(v / 1e8).toFixed(1)} 亿`);
const idx = (v: number | null | undefined): string => (v === null || v === undefined ? "—" : v.toFixed(1));
const table = (head: string[], rows: string[][]): string[] => [`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`, ...rows.map((r) => `| ${r.join(" | ")} |`)];
const cap = (items: string[], n: number): string[] => (items.length > n ? [...items.slice(0, n), `……另有 ${items.length - n} 项`] : items);
const mean = (xs: number[]): number | null => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

function sortScores(scores: Score[]): Score[] {
  return [...scores].sort((a, b) => b.e - a.e || b.c - a.c || (b.main5 ?? -9) - (a.main5 ?? -9) || a.code.localeCompare(b.code));
}

function relatedWeight(portfolio: Portfolio, view: SeriesView): number {
  const codes = new Set(view.segments.filter((s) => (PLAN.related.segments as readonly string[]).includes(s.segment)).flatMap((s) => s.codes));
  return portfolio.positions.filter((p) => codes.has(p.code)).reduce((s, p) => s + p.weight, 0);
}

// ── 各段 ──

type LineState = { stop: number; breached: string[]; lines: string[] };

/** 净值指数与三条线 */
export function linesSection(portfolio: Portfolio, view: SeriesView, today: string): LineState {
  const nav = portfolio.navIndex;
  const stop = stopLine(portfolio.navHigh);
  const out: string[] = ["## 净值与三条线", ""];
  const breached: string[] = [];
  if (nav === null) {
    out.push(`净值指数算不出：${portfolio.gaps.join("；") || "原因不明"}。三条线今天核对不了。`);
  } else {
    out.push(`净值指数 ${idx(nav)}（基准 ${PLAN.baseAt} = 100），最高到过 ${idx(portfolio.navHigh)}。`, "");
    const rows: string[][] = [];
    const line = (name: string, level: number, hit: boolean, action: string): void => {
      rows.push([name, String(level), pct(nav / level - 1), hit ? "已触及" : "未触及", action]);
      if (hit) breached.push(`${name} ${level}：${action}`);
    };
    line("目标", PLAN.lines.target, nav >= PLAN.lines.target, "股票降到 30%，结算");
    line("观察线", PLAN.lines.watch, nav <= PLAN.lines.watch, "不开新股票，已有持仓照规则");
    line("预警线", PLAN.lines.warn, nav <= PLAN.lines.warn, "股票降到 50% 以内；切换备用目标");
    line("停手线", stop, nav <= stop, "停止一切买入；两个交易日内股票降到 30% 以内；临时复核，复核前不恢复买入");
    out.push(...table(["线", "指数", "净值相对该线", "状态", "规则写的动作"], rows), "");
    const next = nextCheckpoint(today);
    if (next) out.push(`下一个进度线：${next.date} 要到 ${next.index}，现在差 ${pct(next.index / nav - 1)}。`);
  }
  out.push(
    `股票仓位 ${share(portfolio.stockWeight)}，现金 ${share(portfolio.cashWeight)}；相关环节（光模块加 PCB）合计 ${share(relatedWeight(portfolio, view))}，上限 30%（只限加仓）。账本日期 ${portfolio.ledgerAsOf ?? "—"}。`,
    "",
  );
  return { stop, breached, lines: out };
}

/** 资金分算不全时，在分数后面标出缺什么 */
const lack = (s: Score): string => (s.cUnknown ? `（缺${s.cUnknownWhy.join("、")}，${s.cUnknown} 条算不出）` : "");

type HoldingRead = { rows: Record<string, unknown>[]; sells: string[]; unsure: string[]; lines: string[] };

/** 持仓的分、卖出条件、加仓空间 */
export function holdingsSection(board: Board, portfolio: Portfolio, view: SeriesView, stop: number, earlier?: Board | null): HoldingRead {
  const out: string[] = ["## 持仓", ""];
  const related = relatedWeight(portfolio, view);
  const rows: string[][] = [];
  const data: Record<string, unknown>[] = [];
  const sells: string[] = [];
  const unsure: string[] = [];
  for (const p of portfolio.positions) {
    const s = board.now[p.code];
    if (!s) {
      rows.push([p.name, share(p.weight), "—", "—", "—", "—", "—", "—", "—", "—", "—", "没有数据"]);
      continue;
    }
    const room = addRoom(s, p.weight, related, portfolio.navIndex, stop);
    const before = earlier ? earlier.now[p.code] : undefined;
    rows.push([
      s.name,
      share(p.weight),
      `${before && before.c !== s.c ? `${before.c} → ${s.c}` : `${s.c}${s.provisional ? "（初算）" : ""}`}${lack(s)}`,
      String(s.t),
      s.deduction ? "−1" : "0",
      `${s.e}${s.cUnknown ? "（不全）" : ""}`,
      `${pct(s.margin5)} / ${pct(s.market5)}`,
      s.mainDays === null ? "—" : `${s.mainDays}/5，${pct(s.main5)}`,
      pct(s.d20),
      pct(s.d60),
      room.cap ? share(room.cap, 0) : "不加",
      room.blockedBy ?? (room.room > 0 ? `可加 ${share(room.room)}` : "已到上限"),
    ]);
    const check = sellCheck(s, board.prev[p.code]);
    const tag = check.provisional ? "（初算：融资到次日 08:40 定稿）" : "";
    if (check.clearByC) sells.push(`${s.name}：${check.note}。规则：清仓${tag}`);
    else if (check.clearByTrend) sells.push(`${s.name}：${check.note}。规则：清仓${tag}`);
    else if (check.halve) sells.push(`${s.name}：${check.note}。规则：减半${tag}`);
    if (check.unsure) unsure.push(`${s.name}：${check.unsure}`);
    data.push({ code: s.code, name: s.name, weight: p.weight, c: s.c, t: s.t, deduction: s.deduction, e: s.e, margin5: s.margin5, market5: s.market5, mainDays: s.mainDays, main5: s.main5, d20: s.d20, d60: s.d60, provisional: s.provisional, addCap: room.cap, addRoom: room.room, blockedBy: room.blockedBy, sell: check });
  }
  if (!rows.length) out.push("账本里没有持仓。", "");
  else {
    out.push(
      ...table(["持仓", "占比", "资金分 C", "趋势分 T", "扣分", "证据分 E", "5 日融资：个股 / 全市场", "主力净流入天数，5 日合计占成交", "相对 20 日线", "相对 60 日线", "单票上限", "加仓"], rows),
      "",
    );
    const why = Object.values(board.now).filter((s) => s.deductionWhy && portfolio.positions.some((p) => p.code === s.code));
    for (const s of why) out.push(`- ${s.name} 扣 1 分：${s.deductionWhy}`);
    if (why.length) out.push("");
  }
  out.push("### 卖出条件核对", "");
  if (sells.length) out.push(...sells.map((s) => `- ${s}`));
  else out.push(`${unsure.length ? "算得全的持仓里，没有触发卖出条件的" : "没有持仓触发卖出条件"}（资金分连续 2 天 ≤1；资金 0 分；收盘跌破 60 日线且 5 日融资为负）。`);
  out.push("");
  if (unsure.length) out.push("下面几只缺数据，卖出条件核对不了。不算成立，也不算不成立，数据补上后重算：", "", ...unsure.map((s) => `- ${s}`), "");
  return { rows: data, sells, unsure, lines: out };
}

type CandidateRead = { rows: Record<string, unknown>[]; eligible: string[]; lines: string[] };

/** 非持仓的链内核心股。live：盘中涨幅和成交额（午间用） */
export function candidatesSection(board: Board, portfolio: Portfolio, live?: Record<string, { pct: number; amount: number }>): CandidateRead {
  const held = new Set(portfolio.positions.map((p) => p.code));
  const all = sortScores(Object.values(board.now).filter((s) => !held.has(s.code)));
  const shown = all.filter((s) => s.e >= 4);
  const out: string[] = ["## 候选（链内核心股，未持有）", ""];
  const eligible: string[] = [];
  const rows = shown.map((s) => {
    const q = live?.[s.code];
    const check = entryCheck(s, q?.pct ?? s.pct, q ? Math.max(q.amount, 0) : s.amount);
    // 盘中成交额还没走完，不拿它卡准入
    const why = live ? check.why.filter((w) => !w.startsWith("成交")) : check.why;
    if (!why.length) eligible.push(s.name);
    return [s.name, s.segment, `${s.c}${s.provisional ? "（初算）" : ""}${s.cUnknown ? "（不全）" : ""}`, String(s.t), s.deduction ? "−1" : "0", String(s.e), pct(q?.pct ?? s.pct), `${((q?.amount ?? s.amount) / 1e8).toFixed(1)} 亿`, why.length ? `不满足：${why.join("、")}` : "满足"];
  });
  if (rows.length) out.push(...table(["股票", "环节", "C", "T", "扣分", "E", live ? "盘中涨幅" : "当天涨幅", live ? "盘中成交" : "日成交", "新开仓准入"], rows), "");
  else out.push("没有 E≥4 的候选。", "");
  const e5 = all.filter((s) => s.e >= PLAN.entry.minE).length;
  const partial = all.filter((s) => s.cUnknown > 0);
  const maybe = partial.filter((s) => s.e < PLAN.entry.minE && s.e + s.cUnknown >= PLAN.entry.minE);
  out.push(
    `未持有的 ${all.length} 只里，E≥5 有 ${e5} 只；准入条件全部满足（E≥5、当天涨幅 ≤3%、日成交 ≥10 亿、没有扣分）：${eligible.length ? eligible.join("、") : "没有"}。`,
    ...(partial.length ? [`其中 ${partial.length} 只的资金分算不全（缺项按 0 分算，分只会偏低）；补齐后可能到 E≥5 的有 ${maybe.length} 只${maybe.length ? `：${cap(maybe.map((s) => s.name), 12).join("、")}` : ""}。缺数据时不算准入。`] : []),
    `全链（含持仓）连续 ${board.noCandidateDays} 个交易日没有一只 E≥5；满 ${PLAN.backup.days} 天即触发备用目标条件 4。${board.noCandidateUnsureDays ? `另有 ${board.noCandidateUnsureDays} 天因为资金分算不全，说不准有没有 E≥5，没有计入。` : ""}`,
    "",
  );
  return { rows: shown.map((s) => ({ code: s.code, name: s.name, segment: s.segment, c: s.c, t: s.t, deduction: s.deduction, e: s.e, pct: s.pct, provisional: s.provisional })), eligible, lines: out };
}

/**
 * 脚本自己记下的缺项（存档里的 missing 字段），原样转述：缺什么、缺哪几只、排序沿用了哪一天的。
 * 汇总不替脚本补数，也不重排。
 */
const OUTSIDE = "链外持仓";

export function mainlineGaps(m: Mainline | null, view: SeriesView): string[] {
  const x = m?.missing;
  if (!m || !x) return [];
  const list = (items: string[]): string => `${items.length} 只：${items.length > 12 ? `${items.slice(0, 12).join("、")} 等` : items.join("、")}`;
  const out: string[] = [];
  if (x.flow_short) {
    out.push(
      x.ranking_from
        ? `主力数据过半缺失：环节名次沿用 ${x.ranking_from} 的排序，不是 ${m.last} 当天算出来的`
        : `主力数据过半缺失，此前没有存档可沿用：${m.last} 的环节名次是用不全的数据排的`,
    );
  }
  const segs = Object.values(m.segments ?? {});
  if (segs.length && segs.every((v) => v.main20 === null || v.main20 === undefined)) out.push(`${m.last} 所有环节都没有主力数据：S5 当天不计入连续天数`);
  // 「链外持仓」是后端为名单外的持仓加的，脚本本来就不算它
  const absent = m.segments ? view.segments.filter((s) => s.segment !== OUTSIDE).map((s) => s.segment).filter((s) => !(s in m.segments!)) : [];
  if (absent.length) out.push(`没有读数的环节（核心股的日线都取不到）：${absent.join("、")}`);
  if (x.kline?.length) out.push(`日线两家都取不到，没有计入环节读数，${list(x.kline.map((c) => view.stocks[c]?.name || c))}`);
  if (x.flow?.length) out.push(`主力净流入缺，${list(x.flow)}`);
  if (x.margin?.length) out.push(`融资缺（含不是两融标的的），${list(x.margin)}`);
  if (x.earnings) out.push("业绩取不到，净利同比为空");
  if (x.kline_backup?.length) out.push(`日线改用腾讯（东方财富取不到），${list(x.kline_backup)}`);
  return out;
}

/** 环节排序（脚本给的名次与资金状态）加各环节的分 */
export function segmentsSection(board: Board, view: SeriesView, mainline: ScriptOutput<Mainline> | null, prevWeek?: Mainline | null): { rows: Record<string, unknown>[]; lines: string[] } {
  const m = mainline?.data ?? null;
  const out: string[] = ["## 环节排序", ""];
  if (!m?.ranking || !m.segments) out.push(`脚本 ai-mainline-map.py 还没有读数${mainline?.error ? `（${mainline.error}）` : ""}。下表按 E≥5 的只数排，不是脚本的资金排序。`, "");
  else if (m.last !== board.asOf) out.push(`脚本读数是 ${m.last} 的，日线已到 ${board.asOf}。`, "");
  const gaps = mainlineGaps(m, view);
  if (gaps.length) out.push(`脚本 ${m!.last} 这份读数的缺项：`, "", ...gaps.map((g) => `- ${g}`), "");
  else if (m?.missing) out.push(`脚本 ${m.last} 这份读数没有缺项。`, "");
  const stat = view.segments.map((seg) => {
    const scores = seg.codes.map((c) => board.now[c]).filter((s): s is Score => !!s);
    const info = m?.segments?.[seg.segment];
    const prevRank = prevWeek?.ranking ? prevWeek.ranking.indexOf(seg.segment) + 1 : 0;
    return {
      segment: seg.segment,
      layer: seg.layer,
      rank: m?.ranking ? m.ranking.indexOf(seg.segment) + 1 || null : null,
      prevRank: prevRank || null,
      flow: typeof info?.flow === "string" ? info.flow : m?.segments && !info ? "无读数" : null,
      mainCov: typeof info?.main_cov === "string" ? info.main_cov : null,
      main5: typeof info?.main5 === "number" ? info.main5 : null,
      main20: typeof info?.main20 === "number" ? info.main20 : null,
      margin5: typeof info?.margin5 === "number" ? info.margin5 : null,
      above20: scores.length ? scores.filter((s) => s.above20).length / scores.length : null,
      n: scores.length,
      e5: scores.filter((s) => s.e >= 5).length,
      avgC: mean(scores.map((s) => s.c)),
      streak: m?.streak?.[seg.segment] ?? null,
    };
  });
  stat.sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99) || b.e5 - a.e5 || (b.avgC ?? 0) - (a.avgC ?? 0));
  const head = ["名次", ...(prevWeek ? ["上周五名次"] : []), "环节", "资金", "主力 5 日", "主力 20 日", "融资 5 日", "主力覆盖", "站上 20 日线", "E≥5 只数", "平均 C", "接力条件连续天数"];
  out.push(
    ...table(
      head,
      stat.map((s) => [
        s.rank === null ? "—" : String(s.rank),
        ...(prevWeek ? [s.prevRank === null ? "—" : String(s.prevRank)] : []),
        s.segment,
        s.flow ?? "—",
        pct(s.main5),
        pct(s.main20),
        pct(s.margin5),
        s.mainCov ?? "—",
        share(s.above20, 0),
        `${s.e5}/${s.n}`,
        s.avgC === null ? "—" : s.avgC.toFixed(1),
        s.streak === null ? "—" : String(s.streak),
      ]),
    ),
    "",
  );
  return { rows: stat, lines: out };
}

const TRIGGERS: { id: string; label: string; action: string }[] = [
  { id: "S1", label: "光模块或 PCB 接力", action: "加：中际旭创、沪电股份、深南电路，按证据分加到上限。减：当时资金分最低的那只上游持仓，减半" },
  { id: "S2", label: "晶圆代工或设备退潮", action: "中芯国际、北方华创、中微公司各减半；暂停华虹公司建仓；现金等待 S1、S3、S4" },
  { id: "S3", label: "存储接力", action: "新开：兆易创新、澜起科技，各 5%" },
  { id: "S4", label: "下游接力", action: "新开：该环节资金分最高的两只，各 5%" },
  { id: "S5", label: "全链退潮", action: "股票降到 50% 以内，只留资金分最高的 3 只" },
];

/** S1–S5：直接读脚本存下的 triggers，这里不自己核对 */
export function triggersSection(mainline: ScriptOutput<Mainline> | null): { hits: string[]; lines: string[] } {
  const out: string[] = ["## 切换触发 S1–S5", ""];
  const t = mainline?.data?.triggers;
  if (!t) {
    out.push(`脚本输出里没有 triggers${mainline?.error ? `（${mainline.error}）` : ""}。汇总不自行核对，S1–S5 今天没有读数。`, "");
    return { hits: [], lines: out };
  }
  const hits: string[] = [];
  const rows = TRIGGERS.map((def) => {
    const r = t[def.id];
    if (!r) return [`${def.id} ${def.label}`, "脚本没给", "—", def.action];
    const streak = typeof r.streak === "number" ? `连续 ${r.streak} 日` : Object.entries(r.streak ?? {}).map(([s, n]) => `${s} 连续 ${n} 日${r.above20?.[s] !== undefined ? `、站上 20 日线 ${share(r.above20[s], 0)}` : ""}`).join("；");
    if (r.hit) hits.push(`${def.id} ${def.label}${r.segments?.length ? `（${r.segments.join("、")}）` : ""}：${def.action}`);
    return [`${def.id} ${def.label}`, r.hit ? `是${r.segments?.length ? `：${r.segments.join("、")}` : ""}` : "否", streak || "—", def.action];
  });
  const m = mainline!.data!;
  const notes: string[] = [];
  if (m.missing?.flow_short) notes.push(m.missing.ranking_from ? `主力数据过半缺失，环节名次沿用 ${m.missing.ranking_from} 的排序；接力条件里的“资金排序前列”用的是这份旧名次` : "主力数据过半缺失，此前没有存档可沿用，环节名次是用不全的数据排的");
  const segs = Object.values(m.segments ?? {});
  if (segs.length && segs.every((v) => v.main20 === null || v.main20 === undefined)) notes.push("所有环节都没有主力数据，S5 当天不计入连续天数");
  // 成立的那几条是在旧名次上判出来的，推送里也要带上这句
  if (m.missing?.flow_short) for (let i = 0; i < hits.length; i++) hits[i] = `${hits[i]}（主力数据过半缺失${m.missing.ranking_from ? `，环节名次沿用 ${m.missing.ranking_from}` : ""}）`;
  out.push(`脚本读数截至 ${m.last}，融资截至 ${m.margin_last ?? "—"}。${notes.length ? `${notes.join("；")}。` : ""}`, "", ...table(["触发", "是否成立", "读数", "规则写的动作"], rows), "");
  return { hits, lines: out };
}

/** 盯线 */
export function watchSection(watch: Watch | null): { beyond: string[]; lines: string[] } {
  const out: string[] = ["## 盯线", ""];
  if (!watch || !watch.statuses.length) {
    out.push("策略方还没有登记要盯的线。", "");
    return { beyond: [], lines: out };
  }
  const levelName = (l: Watch["statuses"][number]["level"]): string => (typeof l === "number" ? String(l) : l === "ma20" ? "20 日线" : l === "ma60" ? "60 日线" : "60 日最低收盘");
  const beyond: string[] = [];
  const rows = watch.statuses.map((s) => {
    const cross = s.level === "low60" && s.op === "below" ? "创 60 日新低" : `${s.op === "below" ? "跌破" : "升破"} ${levelName(s.level)}`;
    const cond = `${s.basis === "close" ? "收盘" : "盘中"}${cross}${s.and === "main_out" ? " 且当天主力净流出" : s.and === "margin_down" ? " 且 5 日融资为负" : ""}`;
    const state = s.beyond === null ? "算不出" : !s.beyond ? "未越线" : s.and === null ? "已越线" : s.andMet === null ? "已越线，附加条件缺数据" : s.andMet ? "已越线，附加条件成立" : "已越线，附加条件不成立";
    if (s.hit) beyond.push(`${s.name || s.code} ${cond}：${s.action}`);
    return [s.name || s.code, cond, s.levelValue === null ? "—" : s.levelValue.toFixed(2), pct(s.distance), state, s.action];
  });
  out.push(`${watch.live ? "按盘中现价" : "按最近收盘价"}${watch.note ? `（${watch.note}）` : ""}。`, "", ...table(["股票", "条件", "线的价位", "现价相对该线", "状态", "规则写的动作"], rows), "");
  return { beyond, lines: out };
}

function gapsSection(view: SeriesView, board: Board | null, extra: string[] = []): string[] {
  // 后端的缺口是一只一行（“代码 缺 某天的某项”）。同一项缺的股票多时并成一行，免得把别的缺口挤出去
  const same = new Map<string, string[]>();
  const rest: string[] = [];
  for (const g of view.gaps) {
    const hit = /^(\d{6}) (缺 .+)$/.exec(g);
    if (hit) same.set(hit[2]!, [...(same.get(hit[2]!) ?? []), view.stocks[hit[1]!]?.name || hit[1]!]);
    else rest.push(g);
  }
  const merged = [...same].flatMap(([what, names]) => (names.length >= 4 ? [`${names.length} 只${what}：${names.slice(0, 8).join("、")}${names.length > 8 ? " 等" : ""}`] : names.map((n) => `${n} ${what}`)));
  const all = [...extra, ...(board?.gaps ?? []), ...merged, ...rest];
  const noMargin = board ? Object.values(board.now).filter((s) => s.gaps.some((g) => g.startsWith("没有融资数据"))).map((s) => s.name) : [];
  if (noMargin.length) all.push(`不是两融标的，融资两项记 0 分：${noMargin.join("、")}`);
  const uniq = [...new Set(all)];
  return ["## 数据缺口", "", ...(uniq.length ? cap(uniq, 15).map((g) => `- ${g}`) : ["没有缺口。"]), ""];
}

const FOOT = ["汇总只有读数和规则核对，不是指令。决定由策略方写，委员会可否决；下单由委员会本人操作。"];

function head(slot: SlotId, inputs: Inputs, asOf: string | null, extra: string[] = []): string[] {
  const { calendar, view } = inputs;
  return [
    `# ${calendar.today} ${SLOT_LABEL[slot]}汇总`,
    "",
    `生成 ${calendar.now}（北京时间）；日线截至 ${asOf ?? "—"}，融资截至 ${view.marginAsOf ?? "—"}。${extra.join("")}`,
    "",
  ];
}

function digest(slot: SlotId, inputs: Inputs, asOf: string | null, body: string[], push: string[], data: Record<string, unknown>): Digest {
  return {
    date: inputs.calendar.today,
    slot,
    title: `${inputs.calendar.today} ${SLOT_LABEL[slot]}汇总`,
    generatedAt: inputs.calendar.now,
    asOf,
    markdown: [...body, ...FOOT].join("\n"),
    push: push.length ? push.join("\n") : null,
    data,
    source: SOURCE,
  };
}

/** 休市，或数据一点都没有 */
export function emptyDigest(slot: SlotId, calendar: Calendar, reason: string): Digest {
  return {
    date: calendar.today,
    slot,
    title: `${calendar.today} ${SLOT_LABEL[slot]}汇总`,
    generatedAt: calendar.now,
    asOf: calendar.lastClosed,
    markdown: [`# ${calendar.today} ${SLOT_LABEL[slot]}汇总`, "", reason, ""].join("\n"),
    push: null,
    data: { skipped: reason },
    source: SOURCE,
  };
}

/** 把 asOf 当天的融资抹掉，重算一遍：得到“融资公布前”的初算分，用来标出定稿后的变化 */
function withoutLastMargin(view: SeriesView, asOf: string): SeriesView {
  const stocks: SeriesView["stocks"] = {};
  for (const [code, s] of Object.entries(view.stocks)) stocks[code] = { ...s, rows: s.rows.map((r) => (r.date === asOf ? { ...r, margin: null } : r)) };
  return { ...view, stocks };
}

// ── 五个时点 ──

/** 08:40 盘前：上一交易日的融资公布了，资金分定稿 */
export function composePre(inputs: Inputs): Digest {
  const { view, portfolio, calendar } = inputs;
  const board = buildBoard(view);
  if (!board) return emptyDigest("pre", calendar, "还没有日线数据，出不了汇总。");
  const marginFinal = view.marginAsOf !== null && view.marginAsOf >= board.asOf;
  const before = marginFinal ? buildBoard(withoutLastMargin(view, board.asOf)) : null;
  const lines = linesSection(portfolio, view, calendar.today);
  const hold = holdingsSection(board, portfolio, view, lines.stop, before);
  const cand = candidatesSection(board, portfolio);
  const seg = segmentsSection(board, view, inputs.mainline);
  const trig = triggersSection(inputs.mainline);
  const watch = watchSection(inputs.watch);
  const note = marginFinal
    ? `${board.asOf} 的融资已公布，资金分定稿；“a → b”表示昨天收盘初算是 a、定稿是 b。`
    : `${board.asOf} 的融资还没公布，资金分仍是初算。`;
  const body = [
    ...head("pre", inputs, board.asOf, [calendar.trading !== true ? "开盘前判断不出今天是否开市，按工作日出。" : ""]),
    note,
    "",
    ...lines.lines,
    ...hold.lines,
    ...cand.lines,
    ...trig.lines,
    ...seg.lines,
    ...watch.lines,
    ...gapsSection(view, board, portfolio.gaps),
  ];
  const push = [...lines.breached, ...hold.sells, ...trig.hits, ...watch.beyond];
  const doubt = hold.unsure.length ? [`另有 ${hold.unsure.length} 只持仓缺数据，卖出条件核对不了：${hold.unsure.map((u) => u.split("：")[0]).join("、")}。`] : [];
  return digest("pre", inputs, board.asOf, body, [...(push.length ? ["盘前核对，以下条件成立：", ...push.map((p) => `- ${p}`)] : []), ...doubt], {
    marginFinal,
    navIndex: portfolio.navIndex,
    stop: lines.stop,
    holdings: hold.rows,
    candidates: cand.rows,
    eligible: cand.eligible,
    segments: seg.rows,
    triggers: inputs.mainline?.data?.triggers ?? null, scriptMissing: inputs.mainline?.data?.missing ?? null,
    noCandidateDays: board.noCandidateDays,
  });
}

/** 11:40 午间：盘中快照。资金分沿用最近一次定稿，只看今天上午的价格和主力 */
export function composeMidday(inputs: Inputs): Digest {
  const { view, portfolio, calendar } = inputs;
  const board = buildBoard(view);
  const snap = inputs.intraday?.latest ?? null;
  if (!board) return emptyDigest("midday", calendar, "还没有日线数据，出不了汇总。");
  if (!snap || !snap.at.startsWith(calendar.today)) return emptyDigest("midday", calendar, "今天上午的盘中快照没有取到，午间汇总出不了。持仓和三条线见盘前汇总。");
  const q = snap.quotes;
  const lines = linesSection(portfolio, view, calendar.today);
  const body = [...head("midday", inputs, board.asOf, [`盘中快照 ${snap.at}，行情时刻 ${snap.sourceAt ?? "未知"}。`]), ...lines.lines, "## 持仓上午读数", ""];
  const holdRows = portfolio.positions.map((p) => {
    const s = board.now[p.code];
    const x = q[p.code];
    return [p.name, share(p.weight), pct(x?.pct), x?.main == null || !x.amount ? "—" : `${yi(x.main)}，${pct(x.main / x.amount)}`, s ? `${s.c} / ${s.t} / ${s.e}` : "—"];
  });
  body.push(...(holdRows.length ? table(["持仓", "占比", "上午涨跌", "上午主力净流入，占成交", `C / T / E（${board.asOf}）`], holdRows) : ["账本里没有持仓。"]), "");

  const segRows = view.segments
    .map((seg) => {
      const qs = seg.codes.map((c) => q[c]).filter((x): x is NonNullable<typeof x> => !!x);
      const amount = qs.reduce((s, x) => s + x.amount, 0);
      const main = qs.every((x) => x.main !== null) && qs.length ? qs.reduce((s, x) => s + (x.main as number), 0) : null;
      return { segment: seg.segment, n: qs.length, avgPct: mean(qs.map((x) => x.pct)), up: qs.filter((x) => x.pct > 0).length, main, mainShare: main === null || amount <= 0 ? null : main / amount };
    })
    .sort((a, b) => (b.mainShare ?? -9) - (a.mainShare ?? -9));
  body.push("## 环节上午读数（按主力净流入占成交排序）", "", ...table(["环节", "平均涨跌", "上涨只数", "主力净流入", "占成交"], segRows.map((s) => [s.segment, pct(s.avgPct), `${s.up}/${s.n}`, yi(s.main), pct(s.mainShare)])), "");

  const live: Record<string, { pct: number; amount: number }> = {};
  for (const [code, x] of Object.entries(q)) live[code] = { pct: x.pct, amount: x.amount };
  const cand = candidatesSection(board, portfolio, live);
  const watch = watchSection(inputs.watch);
  body.push(...cand.lines, ...watch.lines, ...gapsSection(view, board, [...portfolio.gaps, ...snap.failed]));
  const push = [...lines.breached, ...watch.beyond];
  return digest("midday", inputs, board.asOf, body, push.length ? ["午间核对，以下条件成立：", ...push.map((p) => `- ${p}`)] : [], {
    snapshotAt: snap.at,
    navIndex: portfolio.navIndex,
    stop: lines.stop,
    segments: segRows,
    eligible: cand.eligible,
  });
}

/** 16:20 收盘：日线和主力定稿，融资是前一交易日的，资金分为初算 */
export function composeClose(inputs: Inputs): Digest {
  const { view, portfolio, calendar } = inputs;
  const board = buildBoard(view);
  if (!board) return emptyDigest("close", calendar, "还没有日线数据，出不了汇总。");
  const stale = board.asOf !== calendar.today;
  const lines = linesSection(portfolio, view, calendar.today);
  const hold = holdingsSection(board, portfolio, view, lines.stop);
  const cand = candidatesSection(board, portfolio);
  const seg = segmentsSection(board, view, inputs.mainline);
  const trig = triggersSection(inputs.mainline);
  const watch = watchSection(inputs.watch);
  const body = [
    ...head("close", inputs, board.asOf),
    stale ? `今天（${calendar.today}）的日线还没有拉到，下面是 ${board.asOf} 的读数。` : "今天的融资明早公布：资金分是初算，卖出条件里涉及融资的明早 08:40 定稿。",
    "",
    ...lines.lines,
    ...hold.lines,
    ...cand.lines,
    ...trig.lines,
    ...seg.lines,
    ...watch.lines,
    ...gapsSection(view, board, portfolio.gaps),
  ];
  const push = [...lines.breached, ...hold.sells, ...trig.hits, ...watch.beyond];
  const doubt = hold.unsure.length ? [`另有 ${hold.unsure.length} 只持仓缺数据，卖出条件核对不了：${hold.unsure.map((u) => u.split("：")[0]).join("、")}。`] : [];
  const summary = [
    `净值指数 ${idx(portfolio.navIndex)}，股票 ${share(portfolio.stockWeight)}。`,
    push.length ? "以下条件成立：" : `${doubt.length ? "核对得了的里面，" : ""}卖出条件、三条线、S1–S5、盯线都没有触发。`,
    ...push.map((p) => `- ${p}`),
    ...doubt,
    `满足新开仓准入：${cand.eligible.length ? cand.eligible.join("、") : "没有"}。`,
  ];
  return digest("close", inputs, board.asOf, body, summary, {
    stale,
    navIndex: portfolio.navIndex,
    stop: lines.stop,
    holdings: hold.rows,
    candidates: cand.rows,
    eligible: cand.eligible,
    segments: seg.rows,
    triggers: inputs.mainline?.data?.triggers ?? null, scriptMissing: inputs.mainline?.data?.missing ?? null,
    noCandidateDays: board.noCandidateDays,
  });
}

/** 16:40 全市场扫描：scripts/market-scan.py 的输出原样附上，前面放环节排序和 S1–S5 */
export function composeScan(inputs: Inputs): Digest {
  const { view, calendar, scan } = inputs;
  const board = buildBoard(view);
  if (!scan || scan.state !== "ready" || !scan.text) {
    const why = scan?.state === "running" ? "脚本还在跑，到点没有跑完" : scan?.error ? `脚本没有跑成：${scan.error}` : "脚本还没有输出";
    return emptyDigest("scan", calendar, `全市场扫描（scripts/market-scan.py）今天没有结果：${why}。`);
  }
  const trig = triggersSection(inputs.mainline);
  const seg = board ? segmentsSection(board, view, inputs.mainline) : null;
  const body = [...head("scan", inputs, scan.date, ["下面先是环节排序和 S1–S5，再是 market-scan.py 的输出原文。"]), ...trig.lines, ...(seg?.lines ?? []), "## 全市场扫描（脚本输出原文）", "", scan.text.trim(), ""];
  const d = scan.data ?? {};
  return digest("scan", inputs, scan.date, body, [], { breadth: d.breadth ?? null, margin_total: d.margin_total ?? null, index: d.index ?? null, triggers: inputs.mainline?.data?.triggers ?? null, scriptMissing: inputs.mainline?.data?.missing ?? null });
}

/** 周五 16:50：一周的环节排序与换仓条件 */
export function composeWeekly(inputs: Inputs): Digest {
  const { view, portfolio, calendar } = inputs;
  const board = buildBoard(view);
  if (!board) return emptyDigest("weekly", calendar, "还没有日线数据，出不了汇总。");
  // 本周的交易日：从 asOf 往回数到周一
  const monday = new Date(`${board.asOf}T00:00:00Z`);
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  const weekStart = monday.toISOString().slice(0, 10);
  const weekRows = view.segments
    .map((seg) => {
      const rets: number[] = [];
      let main = 0;
      let amount = 0;
      let complete = true;
      for (const code of seg.codes) {
        const rows = view.stocks[code]?.rows ?? [];
        const end = rows.findIndex((r) => r.date === board.asOf);
        const first = rows.findIndex((r) => r.date >= weekStart);
        if (end < 0 || first < 1 || first > end) continue;
        rets.push(rows[end]!.close / rows[first - 1]!.close - 1);
        for (const r of rows.slice(first, end + 1)) {
          if (r.main === null) complete = false;
          else main += r.main;
          amount += r.amount;
        }
      }
      return { segment: seg.segment, ret: mean(rets), mainShare: complete && amount > 0 ? main / amount : null, main: complete ? main : null };
    })
    .sort((a, b) => (b.mainShare ?? -9) - (a.mainShare ?? -9));
  const seg = segmentsSection(board, view, inputs.mainline, inputs.mainlinePrevWeek ?? null);

  const held = new Set(portfolio.positions.map((p) => p.code));
  // 缺数据时 e 是偏低的：补齐后最多到 e + cUnknown。补齐后仍 ≤2 的才算“E≤2”，其余单列为核对不了
  const low = portfolio.positions.map((p) => board.now[p.code]).filter((s): s is Score => !!s && s.e <= PLAN.rotation.holdMaxE);
  const weak = low.filter((s) => s.e + s.cUnknown <= PLAN.rotation.holdMaxE);
  const weakUnsure = low.filter((s) => s.e + s.cUnknown > PLAN.rotation.holdMaxE);
  const strong = sortScores(Object.values(board.now).filter((s) => !held.has(s.code) && s.e === PLAN.rotation.candidateE));
  const strongUnsure = sortScores(Object.values(board.now).filter((s) => !held.has(s.code) && s.e < PLAN.rotation.candidateE && s.e + s.cUnknown >= PLAN.rotation.candidateE));
  const rotate = weak.length > 0 && strong.length > 0;
  const rotateUnsure = !rotate && weak.length + weakUnsure.length > 0 && strong.length + strongUnsure.length > 0;
  const body = [
    ...head("weekly", inputs, board.asOf, [`本周 ${weekStart} 至 ${board.asOf}。`]),
    "## 换仓条件（每周五收盘重排）",
    "",
    "规则：持仓 E≤2，且有候选 E=6 → 下周一换仓。",
    "",
    `- 持仓里 E≤2：${weak.length ? weak.map((s) => `${s.name}（E=${s.e}，C=${s.c}，T=${s.t}）`).join("、") : "没有"}`,
    `- 候选里 E=6：${strong.length ? strong.map((s) => `${s.name}（${s.segment}）`).join("、") : "没有"}`,
    ...(weakUnsure.length ? [`- 持仓里按已有的数 E≤2、补齐后可能超过 2：${weakUnsure.map((s) => `${s.name}（已得 E=${s.e}，缺${s.cUnknownWhy.join("、")}）`).join("、")}。核对不了，不算 E≤2`] : []),
    ...(strongUnsure.length ? [`- 候选里按已有的数不到 6、补齐后可能到 6：${strongUnsure.map((s) => `${s.name}（已得 E=${s.e}，缺${s.cUnknownWhy.join("、")}）`).join("、")}。核对不了，不算 E=6`] : []),
    `- 条件${rotate ? "成立：按规则下周一换仓" : rotateUnsure ? "核对不了（缺数据），不算成立；数据补上后重算" : "不成立：按规则不换仓"}。这是初算：周五的融资下周一早间公布，周一 08:40 盘前汇总复核。`,
    "",
    "## 本周环节资金与涨跌（按主力净流入占成交排序）",
    "",
    ...table(["环节", "本周涨跌（等权）", "本周主力净流入", "占成交"], weekRows.map((s) => [s.segment, pct(s.ret), yi(s.main), pct(s.mainShare)])),
    "",
    ...seg.lines,
    ...triggersSection(inputs.mainline).lines,
    ...holdingsSection(board, portfolio, view, stopLine(portfolio.navHigh)).lines,
    ...candidatesSection(board, portfolio).lines,
    ...gapsSection(view, board, portfolio.gaps),
  ];
  const push = [
    `周度重排：换仓条件${rotate ? "成立" : "不成立"}（初算，周一 08:40 复核）。`,
    `持仓 E≤2：${weak.length ? weak.map((s) => s.name).join("、") : "没有"}；候选 E=6：${strong.length ? strong.map((s) => s.name).join("、") : "没有"}。`,
    `本周主力净流入占成交前三：${weekRows.slice(0, 3).map((s) => `${s.segment} ${pct(s.mainShare)}`).join("、")}。`,
  ];
  return digest("weekly", inputs, board.asOf, body, push, {
    weekStart,
    rotate,
    weakHoldings: weak.map((s) => ({ code: s.code, name: s.name, e: s.e, c: s.c, t: s.t })),
    strongCandidates: strong.map((s) => ({ code: s.code, name: s.name, segment: s.segment })),
    week: weekRows,
    segments: seg.rows,
  });
}

export function compose(slot: SlotId, inputs: Inputs): Digest {
  if (slot === "pre") return composePre(inputs);
  if (slot === "midday") return composeMidday(inputs);
  if (slot === "close") return composeClose(inputs);
  if (slot === "scan") return composeScan(inputs);
  return composeWeekly(inputs);
}
