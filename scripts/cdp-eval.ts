/** Dev helper: evaluate JS inside the running TuberX renderer via CDP. bun scripts/cdp-eval.ts "<expr>" [port] */
const expr = process.argv[2] ?? 'document.title'
const port = process.argv[3] ?? '9333'
const targets = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()) as { type: string; webSocketDebuggerUrl: string }[]
const page = targets.find((t) => t.type === 'page')
if (!page) throw new Error('no page target')
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))
ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: expr, awaitPromise: true, returnByValue: true } }))
const msg = await new Promise<string>((r) => (ws.onmessage = (e) => r(String(e.data))))
const res = JSON.parse(msg)
console.log(JSON.stringify(res.result?.result?.value ?? res.result?.result ?? res, null, 2))
ws.close()

export {}
