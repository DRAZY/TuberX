/**
 * Release gate: end-to-end downloads through the running dev app, with assertions on the files it writes.
 * No release is published unless this passes. Start the app first: `TUBERX_CDP=1 bun run dev`, then
 * `bun scripts/release-gate.ts <destination folder>` (the folder is emptied first).
 *
 * The cases are the paths users actually hit, chosen so a change to the engine cannot ship untested:
 * YouTube above 1080p (VP9, must be copied, never encoded), 1080p H.264 copy, every audio kind, a
 * WebM-only site (VP8 must be encoded), an HLS site, a silent video, cover art in every container.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

interface Case {
  name: string
  url: string
  format: string
  ext: string
  /** ffmpeg codec name the output's first video stream must have (undefined: no video stream) */
  vcodec?: RegExp
  acodec?: RegExp
  cover?: boolean
  /** whether the finishing pass is allowed to encode video ('never' fails the gate if it did) */
  encode: 'never' | 'required' | 'either'
  maxDuration?: number
  subtitles?: boolean
  /** frame width the output must have (rung correctness on non-16:9 sources) */
  width?: number
}
const CASES: Case[] = [
  { name: 'YouTube 1440p (VP9 copy)', url: 'https://www.youtube.com/watch?v=LXb3EKWsInQ', format: 'v:1440', ext: 'mp4', vcodec: /^vp9$/, acodec: /^aac$/, cover: true, encode: 'never' },
  { name: 'YouTube ultra-wide 4K rung', url: 'https://youtu.be/icyft1dDr6g', format: 'v:2160', ext: 'mp4', vcodec: /^(vp9|av1)$/, acodec: /^aac$/, cover: true, encode: 'never', width: 3840 },
  { name: 'YouTube ultra-wide 1080p rung', url: 'https://youtu.be/icyft1dDr6g', format: 'v:1080', ext: 'mp4', vcodec: /^h264$/, acodec: /^aac$/, cover: true, encode: 'never', width: 1920 },
  { name: 'YouTube 1080p60 (H.264 copy)', url: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ', format: 'v:1080', ext: 'mp4', vcodec: /^h264$/, acodec: /^aac$/, cover: true, encode: 'never' },
  { name: 'YouTube subtitles', url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw', format: 'v:best', ext: 'mp4', vcodec: /^h264$/, cover: true, encode: 'never', subtitles: true },
  { name: 'YouTube → MP3', url: 'https://www.youtube.com/watch?v=jNQXAC9IVRw', format: 'a:mp3', ext: 'mp3', acodec: /^mp3$/, cover: true, encode: 'either' },
  { name: 'YouTube → M4A', url: 'https://www.youtube.com/watch?v=w5KnFmKjFTA', format: 'a:m4a', ext: 'm4a', acodec: /^aac$/, cover: true, encode: 'either' },
  { name: 'YouTube → WAV', url: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ', format: 'a:wav', ext: 'wav', acodec: /^pcm_s16le$/, cover: false, encode: 'either' },
  { name: 'YouTube → M4R', url: 'https://www.youtube.com/watch?v=LXb3EKWsInQ', format: 'a:m4r', ext: 'm4r', acodec: /^aac$/, cover: true, encode: 'either', maxDuration: 40.2 },
  { name: 'SoundCloud → M4A', url: 'https://soundcloud.com/forss/flickermood', format: 'a:m4a', ext: 'm4a', acodec: /^aac$/, cover: true, encode: 'either' },
  { name: 'Dailymotion HLS video', url: 'http://www.dailymotion.com/video/x5kesuj_office-christmas-party-review-jason-bateman-olivia-munn-t-j-miller_news', format: 'v:best', ext: 'mp4', vcodec: /^h264$/, acodec: /^aac$/, cover: true, encode: 'never' },
  { name: 'Dailymotion video → M4A', url: 'http://www.dailymotion.com/video/x5kesuj_office-christmas-party-review-jason-bateman-olivia-munn-t-j-miller_news', format: 'a:m4a', ext: 'm4a', acodec: /^aac$/, cover: true, encode: 'either' },
  { name: '9gag WebM-only → MP4', url: 'https://9gag.com/gag/ae5Ag7B', format: 'v:best', ext: 'mp4', vcodec: /^(h264|vp9)$/, acodec: /^aac$/, cover: true, encode: 'either' },
  { name: 'archive.org silent film', url: 'https://archive.org/details/Cops1922', format: 'v:360', ext: 'mp4', vcodec: /^(h264|theora|mpeg4)$/, acodec: undefined, cover: true, encode: 'either' },
]

const dest = process.argv[2]
if (!dest) throw new Error('usage: bun scripts/release-gate.ts <destination folder>')
rmSync(dest, { recursive: true, force: true })
mkdirSync(dest, { recursive: true })
const ffmpeg = join(import.meta.dir, '..', 'resources', 'bin', process.platform, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
const logPath = join(homedir(), 'Library', 'Application Support', 'TuberX-dev', 'logs', 'engine.log')

const targets = (await (await fetch('http://127.0.0.1:9333/json')).json()) as { type: string; webSocketDebuggerUrl: string }[]
const page = targets.find((t) => t.type === 'page')
if (!page) throw new Error('dev app not running with TUBERX_CDP=1')
const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))
let id = 0
const js = (expression: string) =>
  new Promise<any>((res) => {
    const my = ++id
    const h = (e: MessageEvent) => { const m = JSON.parse(String(e.data)); if (m.id === my) { ws.removeEventListener('message', h); res(m.result?.result?.value) } }
    ws.addEventListener('message', h)
    ws.send(JSON.stringify({ id: my, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }))
  })
const rows = async () => (await js('window.tuberx.getQueue()')) as any[]

const old = await rows()
if (old.length) await js(`window.tuberx.removeRows(${JSON.stringify(old.map((r) => r.id))})`)
await js(`window.tuberx.settings.set(${JSON.stringify({ destination: dest, skipExisting: false, videoCodec: 'auto', convertNonMp4: true, saveThumbnail: false, embedSubtitles: true, subtitleLangs: ['en'] })})`)

// One row per URL (the queue dedupes URLs); cases sharing a URL run one after another.
const results: { c: Case; ok: boolean; detail: string; seconds?: number }[] = []
const byUrl = new Map<string, Case[]>()
for (const c of CASES) byUrl.set(c.url, [...(byUrl.get(c.url) ?? []), c])
await js(`window.tuberx.addUrls(${JSON.stringify([...byUrl.keys()])}, false)`)
const t0 = Date.now()
for (;;) { const r = await rows(); if (r.length === byUrl.size && r.every((x) => x.status !== 'fetching')) break; if (Date.now() - t0 > 240_000) break; await Bun.sleep(1000) }
// YouTube's sign-in check is a property of the network, not of the build: retry those fetches, up to six times, ninety seconds apart.
for (let attempt = 0; attempt < 6; attempt++) {
  const r = await rows()
  const blocked = r.filter((x) => x.status === 'failed' && /sign-in check/i.test(x.error ?? ''))
  if (!blocked.length) break
  console.log(`${blocked.length} fetch(es) hit the sign-in check; retrying in 90 s (${attempt + 1}/6)`)
  await Bun.sleep(90_000)
  for (const x of blocked) await js(`window.tuberx.retry(${JSON.stringify(x.id)})`)
  const t = Date.now()
  for (;;) { const q = await rows(); if (q.every((x) => x.status !== 'fetching')) break; if (Date.now() - t > 240_000) break; await Bun.sleep(1000) }
}
const find = (r: any[], url: string) => r.find((x) => x.url === url) ?? r.find((x) => x.url.split('?')[0] === url.split('?')[0])

for (let round = 0; ; round++) {
  const batch = [...byUrl.values()].map((cs) => cs[round]).filter(Boolean)
  if (!batch.length) break
  let r = await rows()
  const ids: string[] = []
  for (const c of batch) {
    const x = find(r, c.url)
    if (!x || x.status === 'failed') { results.push({ c, ok: false, detail: `fetch failed: ${x?.error ?? 'row missing'}` }); continue }
    await js(`window.tuberx.setFormat(${JSON.stringify(x.id)}, ${JSON.stringify(c.format)})`)
    ids.push(x.id)
  }
  const before = readdirSync(dest)
  const t1 = Date.now()
  // Only log lines written during this batch count: a row that runs two cases has two "fast: done" lines.
  const batchLogStart = existsSync(logPath) ? readFileSync(logPath, 'utf8').length : 0
  await js(`window.tuberx.startDownload(${JSON.stringify(ids)})`)
  for (;;) { r = await rows(); if (!r.some((x) => ids.includes(x.id) && ['queued', 'downloading', 'converting'].includes(x.status))) break; if (Date.now() - t1 > 1200_000) break; await Bun.sleep(2000) }
  const log = existsSync(logPath) ? readFileSync(logPath, 'utf8').slice(batchLogStart) : ''
  for (const c of batch) {
    const x = find(r, c.url)
    if (!x || !ids.includes(x.id)) continue
    const out: string | undefined = x.outputPath
    if (x.status !== 'done' || !out || !existsSync(out)) { results.push({ c, ok: false, detail: `${x.status}: ${x.error ?? 'no output'}` }); continue }
    if (!out.toLowerCase().endsWith(`.${c.ext}`)) { results.push({ c, ok: false, detail: `wrong extension: ${out}` }); continue }
    const probe = spawnSync(ffmpeg, ['-hide_banner', '-i', out], { encoding: 'utf8' }).stderr
    const streams = [...probe.matchAll(/Stream #\d+:\d+[^\n]*?: (Video|Audio|Subtitle): (\w+)([^\n]*)/g)].map((m) => ({ kind: m[1], codec: m[2].toLowerCase(), rest: m[3] }))
    const video = streams.find((s) => s.kind === 'Video' && !/attached pic/.test(s.rest))
    const audio = streams.find((s) => s.kind === 'Audio')
    const cover = streams.some((s) => s.kind === 'Video' && /attached pic/.test(s.rest))
    const subs = streams.some((s) => s.kind === 'Subtitle')
    const dur = probe.match(/Duration: (\d+):(\d+):([\d.]+)/)
    const frame = video?.rest.match(/, (\d{3,5})x(\d{3,5})/)
    const width = frame ? Number(frame[1]) : undefined
    const seconds = dur ? Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]) : undefined
    // the job's own fast-path summary line, matched by the row id prefix used in engine.log
    const jobLines = log.split('\n').filter((l) => l.includes(`[${x.id.slice(0, 8)}]`) && l.includes('fast: '))
    const doneLine = jobLines.find((l) => /fast: done in/.test(l)) ?? ''
    const encoded = /\(encoded\)/.test(doneLine) || jobLines.some((l) => /fast: codec .* → /.test(l))
    const finish = Number(doneLine.match(/finish ([\d.]+)s/)?.[1] ?? NaN)
    const problems: string[] = []
    if (c.vcodec && !(video && c.vcodec.test(video.codec))) problems.push(`video ${video?.codec ?? 'none'} ≠ ${c.vcodec}`)
    if (!c.vcodec && video) problems.push(`unexpected video stream ${video.codec}`)
    if (c.acodec && !(audio && c.acodec.test(audio.codec))) problems.push(`audio ${audio?.codec ?? 'none'} ≠ ${c.acodec}`)
    if (c.acodec === undefined && 'acodec' in c && audio) problems.push(`unexpected audio stream ${audio.codec}`)
    if (c.cover !== undefined && cover !== c.cover) problems.push(cover ? 'unexpected cover' : 'cover missing')
    if (c.subtitles && !subs) problems.push('subtitles missing')
    if (c.encode === 'never' && encoded) problems.push('VIDEO WAS ENCODED (must be copied)')
    if (c.encode === 'required' && !encoded) problems.push('video was not encoded')
    if (c.maxDuration && seconds && seconds > c.maxDuration) problems.push(`duration ${seconds}s > ${c.maxDuration}s`)
    if (c.width && width !== c.width) problems.push(`width ${width ?? '?'} ≠ ${c.width}`)
    if (!doneLine) problems.push('fast path did not run (classic fallback)')
    if (c.encode === 'never' && Number.isFinite(finish) && finish > 5) problems.push(`finish ${finish}s for a copy`)
    results.push({ c, ok: !problems.length, detail: problems.join('; ') || `${video?.codec ?? '-'}${width ? ` ${frame![1]}x${frame![2]}` : ''}/${audio?.codec ?? '-'}${cover ? ' +cover' : ''}${subs ? ' +subs' : ''}${encoded ? ' encoded' : ' copy'} finish ${finish}s`, seconds: Math.round((Date.now() - t1) / 1000) })
  }
  void before
}
ws.close()
let failed = 0
for (const r of results) { if (!r.ok) failed++; console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.c.name.padEnd(30)} ${r.detail}`) }
console.log(`\n${results.length - failed}/${results.length} passed`)
process.exit(failed ? 1 : 0)
