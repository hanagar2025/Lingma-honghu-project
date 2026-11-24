import { defineTool } from "@grok/agent-sdk/tools";
import * as z from "zod/v4";
import { makeClient } from "../lib/client.js";
import { runSlot } from "../lib/run.js";

export default defineTool({
  description:
    "出一份鸿鹄定时汇总并推到小程序。slot：pre 盘前（08:40）、midday 午间（11:40）、close 收盘（16:20）、scan 全市场扫描（16:40）、weekly 周度（周五 16:50）。" +
    "只算分、排序、核对规则条件，不下单。dryRun 为 true 时只算不推。返回汇总原文。",
  inputSchema: z.object({
    slot: z.enum(["pre", "midday", "close", "scan", "weekly"]),
    dryRun: z.boolean().optional(),
  }),
  // 同一天同一时点重推，小程序只留最新一份，手机短讯只发第一次
  effect: ({ dryRun }) => (dryRun ? "read" : "idempotent"),
  async execute({ slot, dryRun }) {
    const result = await runSlot(makeClient(), slot, { dryRun: dryRun ?? false });
    return {
      slot: result.slot,
      date: result.date,
      asOf: result.asOf,
      title: result.title,
      posted: result.posted,
      revision: result.revision,
      skipped: result.skipped,
      push: result.push,
      markdown: result.markdown,
    };
  },
});
