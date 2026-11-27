import { defineSchedule } from "@grok/agent-sdk/schedules";
import { fire } from "../lib/fire.js";

/** 北京时间周五 16:50：周度环节排序与换仓条件。cron 按 UTC 写：北京时间减 8 小时 */
export default defineSchedule({
  cron: "50 8 * * 5",
  run: (schedule) => fire(schedule, "weekly"),
});
