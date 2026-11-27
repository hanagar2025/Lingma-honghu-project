import type { ScheduleHandlerArgs } from "@grok/agent-sdk/schedules";
import type { SlotId } from "./types.js";

/**
 * 定时任务到点后做的事：直接调用 run_digest，不经过模型。
 * 失败就抛错，让这次定时任务记为失败；小程序后端在时点过后 15 分钟没收到汇总，会推一条“汇总未到”。
 */
export async function fire(schedule: Pick<ScheduleHandlerArgs, "callTool">, slot: SlotId): Promise<void> {
  const outcome = await schedule.callTool("run_digest", { slot });
  if (outcome.isError) throw new Error(`${slot} 汇总没有出成`);
}
