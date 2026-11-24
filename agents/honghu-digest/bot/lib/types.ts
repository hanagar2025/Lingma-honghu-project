/**
 * 小程序后端（muscap.me）给出的数据形状。与 backend/src/services/chain/ 对应。
 * 这里只有公开行情、占比和净值指数：没有股数，没有账户金额。
 */

export type Row = {
  date: string;
  close: number;
  amount: number;
  /** 当日涨跌幅，小数 */
  pct: number;
  /** 当日主力净流入（元）；缺为 null */
  main: number | null;
  /** 当日融资余额（元）；未公布或不是两融标的为 null */
  margin: number | null;
};

export type Earning = { report: string; notice: string; revYoy: number | null; npYoy: number | null };
export type Flag = { code: string; name: string; reason: string; source: string; since: string; until: string | null };
export type Segment = { layer: string; segment: string; codes: string[] };
export type StockData = { name: string; rows: Row[]; earning: Earning | null };

export type SeriesView = {
  generatedAt: string;
  asOf: string | null;
  marginAsOf: string | null;
  segments: Segment[];
  stocks: Record<string, StockData>;
  marketMargin: { date: string; balance: number }[];
  flags: Flag[];
  gaps: string[];
};

export type Calendar = {
  now: string;
  today: string;
  weekday: number;
  /** null = 判断不出 */
  trading: boolean | null;
  lastClosed: string | null;
  marginAsOf: string | null;
};

export type Portfolio = {
  generatedAt: string;
  ledgerAsOf: string | null;
  positions: { code: string; name: string; weight: number }[];
  stockWeight: number;
  cashWeight: number;
  navIndex: number | null;
  navHigh: number | null;
  baseAt: string | null;
  gaps: string[];
};

export type Quote = { price: number; pct: number; amount: number; main: number | null };
export type Intraday = {
  date: string;
  count: number;
  latest: { at: string; sourceAt: string | null; quotes: Record<string, Quote>; failed: string[] } | null;
};

export type LineStatus = {
  id: string;
  code: string;
  name: string;
  basis: "close" | "price";
  op: "below" | "above";
  level: number | "ma20" | "ma60" | "low60";
  levelValue: number | null;
  price: number | null;
  distance: number | null;
  beyond: boolean | null;
  and: "main_out" | "margin_down" | null;
  andMet: boolean | null;
  hit: boolean | null;
  action: string;
  source: string;
};
export type Watch = { at: string; live: boolean; statuses: LineStatus[]; note: string | null };

/** scripts/ai-mainline-map.py 存下的读数，原样 */
export type Mainline = {
  last: string;
  margin_last?: string;
  ranking?: string[];
  segments?: Record<string, Record<string, number | string | null>>;
  streak?: Record<string, number>;
  triggers?: Record<string, { hit: boolean; segments?: string[]; streak?: Record<string, number> | number; above20?: Record<string, number> }>;
};

export type ScriptOutput<T> = {
  state: "ready" | "running" | "failed" | "missing";
  date: string | null;
  dates: string[];
  data: T | null;
  text: string | null;
  error: string | null;
};

export type SlotId = "pre" | "midday" | "close" | "scan" | "weekly";

/** 推给小程序的一份汇总 */
export type Digest = {
  date: string;
  slot: SlotId;
  title: string;
  generatedAt: string;
  asOf: string | null;
  markdown: string;
  /** 手机短讯；不需要打扰时为 null */
  push: string | null;
  data: Record<string, unknown>;
  source: string;
};
