import { defineAgent } from "@grok/agent-sdk";

/**
 * 鸿鹄定时汇总。五个时点都由 bot/schedules/ 直接调用 run_digest 这个工具，不经过模型：
 * 算分、排序、核对条件是确定的算术，不让模型参与。
 *
 * 托管环境只允许访问小程序 muscap.me，只读一个密钥 HONGHU_AGENT_TOKEN（值是服务器上的 BOT_TOKEN）。
 * 换了域名时改这里的 egressDomains，并设环境变量 HONGHU_SERVER_URL。
 */
export default defineAgent({
  name: "honghu-digest",
  description: "鸿鹄定时汇总：固定时点算分、排序、核对触发条件，把结果推到小程序。不下单。",
  hosting: {
    egressDomains: ["muscap.me"],
    secretNames: ["HONGHU_AGENT_TOKEN"],
  },
  // 有人直接和它对话时，只允许调用自己的工具，不给命令行和文件读写
  tools: [],
});
