/**
 * 执行单网页：手机打开第一屏就是执行单，完整驾驶舱在下一页。
 *
 * 执行单 Markdown 只用到标题、列表、表格、分隔线与段落，这里只认这几种，
 * 不引入 Markdown 库 —— 页面必须自包含、无外部请求，弱网与微信内置浏览器都能开。
 */

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function inline(s: string): string {
  return esc(s).replace(/(https?:\/\/[^\s<）]+)/g, '<a href="$1">$1</a>')
}

export function markdownToHtml(md: string): string {
  const out: string[] = []
  let list: 'ul' | 'ol' | null = null
  let table: string[][] | null = null
  const closeList = (): void => { if (list) { out.push(`</${list}>`); list = null } }
  const closeTable = (): void => {
    if (!table) return
    const [h, ...rows] = table
    out.push('<div class="tw"><table><thead><tr>', ...h!.map(c => `<th>${inline(c)}</th>`), '</tr></thead><tbody>')
    for (const r of rows) out.push('<tr>', ...r.map(c => `<td>${inline(c)}</td>`), '</tr>')
    out.push('</tbody></table></div>')
    table = null
  }

  for (const raw of md.split('\n')) {
    const line = raw.trimEnd()
    if (line.startsWith('|')) {
      closeList()
      const cells = line.slice(1, line.endsWith('|') ? -1 : undefined).split('|').map(c => c.trim())
      if (cells.every(c => /^:?-{3,}:?$/.test(c))) continue
      ;(table ??= []).push(cells)
      continue
    }
    closeTable()
    let m: RegExpExecArray | null
    if ((m = /^(#{1,3})\s+(.*)$/.exec(line))) {
      closeList()
      const lv = m[1]!.length
      out.push(`<h${lv}>${inline(m[2]!)}</h${lv}>`)
    } else if ((m = /^-\s+(.*)$/.exec(line))) {
      if (list !== 'ul') { closeList(); out.push('<ul>'); list = 'ul' }
      out.push(`<li>${inline(m[1]!)}</li>`)
    } else if ((m = /^\d+\.\s+(.*)$/.exec(line))) {
      if (list !== 'ol') { closeList(); out.push('<ol>'); list = 'ol' }
      out.push(`<li>${inline(m[1]!)}</li>`)
    } else if (/^-{3,}$/.test(line)) {
      closeList()
      out.push('<hr>')
    } else if (line === '') {
      closeList()
    } else {
      closeList()
      out.push(`<p>${inline(line)}</p>`)
    }
  }
  closeList()
  closeTable()
  return out.join('\n')
}

/**
 * 微信内置浏览器常拦截 navigator.clipboard，所以依次试：clipboard → execCommand('copy') →
 * 展开全文让人长按全选。三步都要有，任何一步失败都不能让按钮「看起来成功」。
 */
const COPY_SCRIPT = `<script>
function copyAgent(){
  var t=document.getElementById('agent'),s=document.getElementById('cs');
  var done=function(){s.textContent='已复制 '+t.value.length+' 字，直接粘贴给 Agent 即可'};
  var manual=function(){
    t.className='show';t.focus();t.setSelectionRange(0,t.value.length);
    var ok=false;try{ok=document.execCommand('copy')}catch(e){}
    if(ok){done()}else{s.textContent='浏览器拦截了自动复制：全文已在下方展开，长按 → 全选 → 拷贝'}
  };
  if(navigator.clipboard&&window.isSecureContext){navigator.clipboard.writeText(t.value).then(done,manual)}else{manual()}
}
</script>`

export function renderCardPage(
  markdown: string,
  opts: { ok: boolean; title: string; generatedAt: string; cockpitHref?: string; agentText?: string; agentHref?: string },
): string {
  const nav = opts.cockpitHref
    ? `<a class="btn" href="${esc(opts.cockpitHref)}">打开完整驾驶舱 →</a>`
    : ''
  const copy = opts.agentText
    ? `<button class="btn copy" type="button" onclick="copyAgent()">一键复制给 Agent（执行单 + 核对明细 + 驾驶舱摘要）</button>
<p id="cs" class="meta">${opts.agentHref ? `Agent 能联网时，也可以直接给它这个地址：<a href="${esc(opts.agentHref)}">${esc(opts.agentHref)}</a>` : ''}</p>
<textarea id="agent" readonly>${esc(opts.agentText)}</textarea>
${COPY_SCRIPT}`
    : ''
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>${esc(opts.title)}</title>
<style>
body{margin:0;font:16px/1.65 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif;color:#1f2328;background:#f6f7f9}
main{max-width:720px;margin:0 auto;padding:16px 16px 40px}
.card{background:#fff;border-radius:12px;padding:4px 18px 16px;box-shadow:0 1px 3px rgba(0,0,0,.08);border-top:6px solid ${opts.ok ? '#1a7f37' : '#cf222e'}}
h1{font-size:20px;line-height:1.4;margin:16px 0 8px}
h2{font-size:17px;margin:22px 0 6px;padding-left:8px;border-left:4px solid #0969da}
ol,ul{padding-left:22px;margin:6px 0}
li{margin:8px 0}
ol>li{font-weight:600}
p{margin:6px 0}
hr{border:0;border-top:1px solid #d0d7de;margin:22px 0}
.tw{overflow-x:auto}
table{border-collapse:collapse;font-size:14px;width:100%}
th,td{border:1px solid #d0d7de;padding:6px 8px;text-align:left;white-space:nowrap}
th{background:#f6f8fa}
a{color:#0969da;word-break:break-all}
.btn{display:block;margin:18px 0 6px;padding:14px;text-align:center;background:#0969da;color:#fff;border-radius:10px;text-decoration:none;font-weight:600}
.meta{color:#656d76;font-size:13px;text-align:center;margin-top:10px}
.copy{width:100%;border:0;font:inherit;font-weight:600;background:#1a7f37;margin:0 0 4px;cursor:pointer}
#agent{position:absolute;left:-9999px;width:1px;height:1px}
#agent.show{position:static;display:block;width:100%;height:260px;box-sizing:border-box;font:13px/1.5 monospace;margin:8px 0 16px}
</style></head><body><main>
${copy}
<div class="card">
${markdownToHtml(markdown)}
</div>
${nav}
<p class="meta">生成于 ${esc(opts.generatedAt)}（北京时间）</p>
</main></body></html>
`
}
