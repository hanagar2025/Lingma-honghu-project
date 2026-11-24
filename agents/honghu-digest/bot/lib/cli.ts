/**
 * 本机手动跑一个时点：
 *
 *   HONGHU_SERVER_URL=http://127.0.0.1:5000 HONGHU_AGENT_TOKEN=… npm run digest -- close --dry
 *
 * --dry 只算不推，汇总原文打到屏幕上。口令只从环境变量读。
 */
import { makeClient } from "./client.js";
import { runSlot, SLOTS } from "./run.js";
import type { SlotId } from "./types.js";

const slot = process.argv[2] as SlotId;
if (!SLOTS.includes(slot)) {
  process.stderr.write(`用法：npm run digest -- <${SLOTS.join("|")}> [--dry]\n`);
  process.exit(2);
}
try {
  const result = await runSlot(makeClient(), slot, { dryRun: process.argv.includes("--dry") });
  process.stdout.write(`${result.markdown}\n`);
  process.stderr.write(`\n${result.title}：${result.posted ? `已推送（第 ${result.revision} 版）` : "只算未推"}${result.skipped ? `；${result.skipped}` : ""}\n`);
  if (result.push) process.stderr.write(`手机短讯：\n${result.push}\n`);
} catch (e) {
  process.stderr.write(`没有出成：${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
}
