import { defineSchedule } from "@grok/agent-sdk/schedules";
import { fire } from "../lib/fire.js";

/** 北京时间周一到周五 16:40：全市场扫描。cron 按 UTC 写：北京时间减 8 小时 */
export default defineSchedule({
  cron: "40 8 * * 1-5",
  run: (schedule) => fire(schedule, "scan"),
});
