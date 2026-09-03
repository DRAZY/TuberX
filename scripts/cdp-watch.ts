/** Dev helper: run a scripted pause/resume/stop scenario against the running app with in-process 200 ms sampling. */
const port = process.env.CDP_PORT ?? '9333'
const targets = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()) as { type: string; webSocketDebuggerUrl: string }[]
const ws = new WebSocket(targets.find((t) => t.type === 'page')!.webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))
let seq = 0
const pending = new Map<number, (v: unknown) => void>()
ws.onmessage = (e) => { const m = JSON.parse(String(e.data)); if (pending.has(m.id)) { pending.get(m.id)!(m.result?.result?.value); pending.delete(m.id) } }
const ev = (expression: string) => new Promise<any>((r) => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } })) })
const row = async () => ev(`window.tuberx.getQueue().then(q=>({s:q[0].status,pct:q[0].progress?.percent??null,part:q[0].progress?.part?.index??null,fmt:q[0].formatId}))`)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const id = await ev(`window.tuberx.getQueue().then(q=>q[0].id)`)
const target = process.argv[2] ?? 'v:2160'
await ev(`window.tuberx.history.clear().then(()=>window.tuberx.setFormat('${id}','${target}')).then(()=>window.tuberx.startDownload(['${id}']))`)
let r: any
let last = ''
const trace: string[] = []
for (let i = 0; i < 400; i++) {
  r = await row()
  const k = `${r.s}@${Math.round(r.pct ?? -1)}`
  if (k !== last) { trace.push(`${(i * 0.2).toFixed(1)}s ${k}`); last = k }
  if (r.s === 'downloading' && (r.pct ?? 0) >= 15 && (r.pct ?? 0) <= 70) break
  if (r.s === 'done' || r.s === 'failed') break
  await sleep(200)
}
console.log('trace:', trace.join(' | '))
console.log('pause at', JSON.stringify(r))
await ev(`window.tuberx.pauseDownload('${id}')`)
await sleep(2500)
console.log('paused  ', JSON.stringify(await row()))
await ev(`window.tuberx.resumeDownload('${id}')`)
for (let i = 0; i < 40; i++) { await sleep(500); r = await row(); if (i % 4 === 0) console.log('resume+' + ((i + 1) * 0.5) + 's', JSON.stringify(r)); if (r.s === 'done' || r.s === 'failed') break }
console.log('final   ', JSON.stringify(await row()))
ws.close()
process.exit(0)

export {}
