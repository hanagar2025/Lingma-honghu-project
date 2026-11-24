/**
 * 小程序后端的读写。
 *
 *   HONGHU_AGENT_TOKEN  口令。只从环境密钥读，不落盘、不进日志、不进报错文字。
 *                       托管的机器人用服务器上的 BOT_TOKEN：只能读链上数据、占比和净值指数，写汇总；读不到账本、成交和截图。
 *   HONGHU_SERVER_URL   小程序地址，缺省 https://muscap.me。
 */
import type { Calendar, Digest, Intraday, Mainline, Portfolio, ScriptOutput, SeriesView, Watch } from "./types.js";

export const DEFAULT_BASE_URL = "https://muscap.me";

export type Client = {
  calendar(): Promise<Calendar>;
  series(days: number): Promise<SeriesView>;
  portfolio(): Promise<Portfolio>;
  intraday(): Promise<Intraday>;
  watch(live: boolean): Promise<Watch>;
  mainline(date?: string, ensure?: boolean): Promise<ScriptOutput<Mainline>>;
  scan(date: string, ensure: boolean): Promise<ScriptOutput<Record<string, unknown>>>;
  job(name: "daily" | "margin" | "intraday", body?: Record<string, unknown>): Promise<unknown>;
  post(digest: Digest): Promise<{ ok: boolean; revision: number }>;
};

export function makeClient(env: Record<string, string | undefined> = process.env, doFetch: typeof fetch = fetch): Client {
  const base = (env.HONGHU_SERVER_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const token = env.HONGHU_AGENT_TOKEN?.trim() ?? "";
  if (!token) throw new Error("没有配置环境密钥 HONGHU_AGENT_TOKEN，读不了小程序的数据");

  async function call<T>(method: string, path: string, body?: unknown, timeoutMs = 60_000): Promise<T> {
    let last = "";
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const res = await doFetch(`${base}${path}`, {
          method,
          headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        });
        const text = await res.text();
        if (res.ok) return JSON.parse(text) as T;
        let detail = "";
        try {
          detail = String((JSON.parse(text) as { error?: unknown }).error ?? "");
        } catch {
          detail = "";
        }
        last = `${method} ${path} 返回 ${res.status}${detail ? `：${detail}` : ""}`;
        // 口令不对、权限不够、内容被拒：重试没有用
        if (res.status < 500 && res.status !== 429) break;
      } catch (e) {
        last = `${method} ${path} 连不上（${e instanceof Error ? e.name : "错误"}）`;
      }
      if (attempt < 2) await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
    throw new Error(last);
  }

  return {
    calendar: () => call("GET", "/api/chain/calendar"),
    series: (days) => call("GET", `/api/chain/series?days=${days}`),
    portfolio: () => call("GET", "/api/chain/portfolio"),
    intraday: () => call("GET", "/api/chain/intraday"),
    watch: (live) => call("GET", `/api/chain/watch${live ? "?live=1" : ""}`),
    mainline: (date, ensure) => call("GET", `/api/chain/mainline?text=0${date ? `&date=${date}` : ""}${ensure ? "&ensure=1" : ""}`),
    scan: (date, ensure) => call("GET", `/api/chain/scan?date=${date}${ensure ? "&ensure=1" : ""}`),
    job: (name, body) => call("POST", `/api/chain/jobs/${name}`, body ?? {}, 240_000),
    post: (digest) => call("POST", "/api/digest", digest),
  };
}
