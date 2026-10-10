/**
 * 推送通道。配置了哪个就推哪个，可同时配置多个；一个都没配置时只落盘不推送。
 *
 *   PUSHPLUS_TOKEN      PushPlus（微信公众号消息，手机与电脑微信同时可见）
 *   WECOM_WEBHOOK       企业微信群机器人 webhook 地址
 *   SERVERCHAN_SENDKEY  Server 酱（微信服务号）
 *   BARK_URL            Bark（iPhone），形如 https://api.day.app/<key>
 */

export interface PushResult { channel: string; ok: boolean; detail: string }

type Env = Record<string, string | undefined>

async function post(url: string, body: unknown, form = false): Promise<{ status: number; text: string }> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 20_000)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': form ? 'application/x-www-form-urlencoded' : 'application/json' },
      body: form ? new URLSearchParams(body as Record<string, string>).toString() : JSON.stringify(body),
      signal: ctrl.signal,
    })
    return { status: res.status, text: (await res.text()).slice(0, 300) }
  } finally {
    clearTimeout(timer)
  }
}

/** 企业微信 markdown 正文上限 4096 字节 */
function clipBytes(s: string, max: number): string {
  const enc = new TextEncoder()
  if (enc.encode(s).length <= max) return s
  let out = s
  while (enc.encode(`${out}\n…（全文见链接）`).length > max) out = out.slice(0, -50)
  return `${out}\n…（全文见链接）`
}

export function configuredChannels(env: Env = process.env): string[] {
  return ['PUSHPLUS_TOKEN', 'WECOM_WEBHOOK', 'SERVERCHAN_SENDKEY', 'BARK_URL'].filter(k => env[k])
}

export async function pushAll(title: string, markdown: string, env: Env = process.env): Promise<PushResult[]> {
  const jobs: { channel: string; run: () => Promise<{ status: number; text: string }>; okWhen: (r: { status: number; text: string }) => boolean }[] = []
  if (env.PUSHPLUS_TOKEN) {
    jobs.push({
      channel: 'PushPlus',
      run: () => post('https://www.pushplus.plus/send', { token: env.PUSHPLUS_TOKEN, title, content: markdown, template: 'markdown' }),
      okWhen: r => r.status === 200 && /"code"\s*:\s*200/.test(r.text),
    })
  }
  if (env.WECOM_WEBHOOK) {
    jobs.push({
      channel: '企业微信',
      run: () => post(env.WECOM_WEBHOOK!, { msgtype: 'markdown', markdown: { content: clipBytes(markdown, 4000) } }),
      okWhen: r => r.status === 200 && /"errcode"\s*:\s*0/.test(r.text),
    })
  }
  if (env.SERVERCHAN_SENDKEY) {
    jobs.push({
      channel: 'Server酱',
      run: () => post(`https://sctapi.ftqq.com/${env.SERVERCHAN_SENDKEY}.send`, { title: title.slice(0, 32), desp: markdown }, true),
      okWhen: r => r.status === 200 && /"code"\s*:\s*0/.test(r.text),
    })
  }
  if (env.BARK_URL) {
    jobs.push({
      channel: 'Bark',
      run: () => post(env.BARK_URL!.replace(/\/+$/, ''), { title, body: markdown.replace(/^#+\s*/gm, ''), group: '鸿鹄执行单' }),
      okWhen: r => r.status === 200,
    })
  }
  const out: PushResult[] = []
  for (const j of jobs) {
    try {
      const r = await j.run()
      out.push({ channel: j.channel, ok: j.okWhen(r), detail: `HTTP ${r.status} ${r.text}` })
    } catch (e) {
      out.push({ channel: j.channel, ok: false, detail: e instanceof Error ? e.message : String(e) })
    }
  }
  return out
}
