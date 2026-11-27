/**
 * 一个时点从头到尾：读数 → 排好 → 推回小程序。
 *
 * 数据由小程序后端到点自己拉。这里只在发现数据没到时催一次（后端的补拉口子），然后照实写缺口。
 * 同一天同一时点重跑是安全的：后端只留最新一份，手机短讯只发第一次。
 */
import type { Client } from "./client.js";
import { compose, emptyDigest, type Inputs } from "./compose.js";
import type { Digest, Mainline, ScriptOutput, SlotId } from "./types.js";

export const SLOTS: readonly SlotId[] = ["pre", "midday", "close", "scan", "weekly"];

export type RunOptions = {
  /** 只算不推 */
  dryRun?: boolean;
  /** 等脚本跑完最多等多久 */
  waitMs?: number;
  pollMs?: number;
  sleep?: (ms: number) => Promise<void>;
};

export type RunResult = {
  slot: SlotId;
  date: string;
  asOf: string | null;
  title: string;
  posted: boolean;
  revision: number | null;
  skipped: string | null;
  push: string | null;
  markdown: string;
};

const realSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function waitFor<T>(read: () => Promise<ScriptOutput<T>>, opts: RunOptions, fallbackMs: number): Promise<ScriptOutput<T>> {
  const sleep = opts.sleep ?? realSleep;
  const deadline = Date.now() + (opts.waitMs ?? fallbackMs);
  let out = await read();
  while (out.state === "running" && Date.now() < deadline) {
    await sleep(opts.pollMs ?? 20_000);
    out = await read();
  }
  return out;
}

export async function buildDigest(client: Client, slot: SlotId, opts: RunOptions = {}): Promise<Digest> {
  let calendar = await client.calendar();
  // 开盘前判断不出是否开市，盘前那一份按工作日出；其余时点休市就不出
  if (calendar.trading === false && slot !== "pre") return emptyDigest(slot, calendar, "今天休市，不出汇总。");
  if (calendar.trading === false && (calendar.weekday === 0 || calendar.weekday === 6)) return emptyDigest(slot, calendar, "今天休市，不出汇总。");

  const afterClose = slot === "close" || slot === "scan" || slot === "weekly";
  // 数据没到就催一次
  if (afterClose && calendar.trading === true && calendar.lastClosed !== calendar.today) {
    await client.job("daily").catch(() => undefined);
    calendar = await client.calendar();
  }
  if (slot === "pre" && calendar.lastClosed && (calendar.marginAsOf ?? "") < calendar.lastClosed) {
    await client.job("margin").catch(() => undefined);
    calendar = await client.calendar();
  }
  if (slot === "midday") await client.intraday().then((x) => (x.latest?.at.startsWith(calendar.today) ? undefined : client.job("intraday"))).catch(() => undefined);

  const [view, portfolio, watch] = await Promise.all([client.series(90), client.portfolio(), client.watch(slot === "midday").catch(() => null)]);
  const asOf = view.asOf;
  const mainline = asOf ? await waitFor(() => client.mainline(asOf, afterClose), opts, 6 * 60_000).catch(() => null) : null;
  // 当天的脚本读数还没有，就用最近一份，并在汇总里写明日期
  const usable = mainline?.data ? mainline : await client.mainline().then((latest) => (latest.data ? { ...latest, error: mainline?.error ?? null } : mainline)).catch(() => mainline);

  const inputs: Inputs = { calendar, view, portfolio, mainline: usable, watch };
  if (slot === "midday") inputs.intraday = await client.intraday().catch(() => null);
  if (slot === "scan" && asOf) inputs.scan = await waitFor(() => client.scan(asOf, true), opts, 20 * 60_000).catch(() => null);
  if (slot === "weekly" && asOf && usable) {
    const monday = new Date(`${asOf}T00:00:00Z`);
    monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
    const prev = usable.dates.filter((d) => d < monday.toISOString().slice(0, 10)).pop();
    inputs.mainlinePrevWeek = prev ? ((await client.mainline(prev).catch(() => null))?.data as Mainline | null) ?? null : null;
  }
  return compose(slot, inputs);
}

export async function runSlot(client: Client, slot: SlotId, opts: RunOptions = {}): Promise<RunResult> {
  const digest = await buildDigest(client, slot, opts);
  const skipped = typeof digest.data.skipped === "string" ? digest.data.skipped : null;
  let revision: number | null = null;
  if (!opts.dryRun) revision = (await client.post(digest)).revision;
  return { slot, date: digest.date, asOf: digest.asOf, title: digest.title, posted: !opts.dryRun, revision, skipped, push: digest.push, markdown: digest.markdown };
}
