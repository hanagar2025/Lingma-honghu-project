import { defineEval } from "@grok/agent-sdk/evals";

/** 需要 Cursor 凭证和一个能连上的小程序后端；本机没有凭证时不跑 */
export default defineEval({
  tags: ["smoke"],
  description: "有人要一份收盘汇总预览时，调用 run_digest 且只算不推。",
  async test(t) {
    await t.send("先别推送，给我看一下今天的收盘汇总。");
    t.succeeded();
    t.calledTool("run_digest");
  },
});
