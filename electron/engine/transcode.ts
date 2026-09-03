import { existsSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, extname, join, basename } from 'node:path'
import { run, type RunResult } from './run'
import { resolveTool } from './paths'
import { bestEncoder, encoderArgs, type Codec } from './encoders'

export interface StreamInfo {
  vcodec?: string
  acodec?: string
  /** seconds */
  duration?: number
  /** overall kbps */
  kbps?: number
  /** An embedded cover image travels as a second video stream (attached_pic). */
  hasCover?: boolean
}

/** What is inside a media file, read from ffmpeg's own banner (no ffprobe shipped). */
export async function inspect(path: string): Promise<StreamInfo> {
  const ffmpeg = resolveTool('ffmpeg')
  if (!ffmpeg) return {}
  const res: RunResult = await run(ffmpeg, ['-hide_banner', '-i', path], { timeoutMs: 30000 }).done
  const text = res.stderr
  const dur = text.match(/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/)
  const kb = text.match(/bitrate: (\d+) kb\/s/)
  return {
    vcodec: text.match(/Stream #\d+:\d+[^\n]*: Video: (\w+)/)?.[1]?.toLowerCase(),
    acodec: text.match(/Stream #\d+:\d+[^\n]*: Audio: (\w+)/)?.[1]?.toLowerCase(),
    duration: dur ? Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]) : undefined,
    kbps: kb ? Number(kb[1]) : undefined,
    hasCover: /attached pic/.test(text),
  }
}

const CODEC_NAMES: Record<Codec, string[]> = { h264: ['h264', 'avc1'], h265: ['hevc', 'h265', 'hvc1'] }

export interface TranscodeOptions {
  signal?: AbortSignal
  onProgress: (percent: number) => void
  onLog?: (line: string) => void
}

/**
 * Re-encode the video track of `path` to `codec` in place, keeping audio, subtitles, chapters and tags.
 * Returns the label of the encoder used, or null when the file already carries the codec (nothing done).
 */
export async function convertVideo(path: string, codec: Codec, opts: TranscodeOptions): Promise<string | null> {
  const ffmpeg = resolveTool('ffmpeg')
  if (!ffmpeg) throw new Error('ffmpeg is not installed. Open Settings → Engine.')
  const info = await inspect(path)
  if (info.vcodec && CODEC_NAMES[codec].includes(info.vcodec)) return null
  const choice = await bestEncoder(codec)
  if (!choice) throw new Error(`No ${codec === 'h264' ? 'H.264' : 'H.265'} encoder is available in the bundled ffmpeg.`)
  const tmp = join(dirname(path), `${basename(path, extname(path))}.converting${extname(path) || '.mp4'}`)
  // Only the first video stream is encoded; audio, subtitles and the cover image are copied through,
  // so the encoder never sees the attached picture (which made it fail with "Invalid argument").
  const perStream = encoderArgs(choice, info.kbps).map((a) => (/^-(c|b|tag|q):v$/.test(a) ? `${a}:0` : a))
  const args = [
    '-hide_banner', '-y', '-loglevel', 'error', '-nostats', '-progress', 'pipe:1',
    '-i', path,
    '-map', '0:v:0', '-map', '0:a?', '-map', '0:s?',
    ...(info.hasCover ? ['-map', '0:v:1', '-c:v:1', 'copy', '-disposition:v:1', 'attached_pic'] : []),
    '-map_metadata', '0', '-map_chapters', '0',
    '-c', 'copy',
    ...perStream,
    '-pix_fmt:v:0', 'yuv420p',
    '-movflags', '+faststart',
    tmp,
  ]
  opts.onLog?.(`convert: ${choice.encoder} (${choice.label}) ${info.vcodec ?? '?'} → ${codec}, ${info.kbps ?? '?'} kb/s source`)
  const total = (info.duration ?? 0) * 1_000_000
  const res = await run(ffmpeg, args, {
    signal: opts.signal,
    idleTimeoutMs: 10 * 60 * 1000,
    onLine: (line) => {
      const m = line.match(/^out_time_us=(\d+)/) ?? line.match(/^out_time_ms=(\d+)/)
      if (m && total > 0) opts.onProgress(Math.min(99, (Number(m[1]) / total) * 100))
      else if (!/^(frame|fps|bitrate|total_size|out_time|dup_frames|drop_frames|speed|progress)=/.test(line)) opts.onLog?.(line)
    },
  }).done
  if (opts.signal?.aborted || res.code !== 0) {
    rmSync(tmp, { force: true })
    if (opts.signal?.aborted) throw new Error('cancelled')
    throw new Error(`Conversion failed (${choice.label}): ${res.stderr.trim().split('\n').pop() ?? `exit ${res.code}`}`)
  }
  rmSync(path, { force: true })
  renameSync(tmp, path)
  opts.onProgress(100)
  return choice.label
}

export type SegmentKind = 'mp4' | 'm4a' | 'm4r'
export interface SegmentJob {
  src: string
  /** seconds */
  start: number
  end: number
  kind: SegmentKind
  /** Re-encode the video for a frame-accurate cut; otherwise stream copy from the nearest keyframe (instant). */
  precise: boolean
  signal?: AbortSignal
  onProgress: (percent: number) => void
  onLog?: (line: string) => void
}

const pad = (n: number) => String(Math.floor(n)).padStart(2, '0')
/** "1m05s" style stamp for a file name. */
export function stamp(sec: number): string {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  return `${h ? `${h}h` : ''}${pad(m)}m${pad(s)}s`
}

/** A never-colliding sibling path: "<stem> [trim 00m12s-01m05s].mp4", with a counter if that exists. */
export function segmentPath(src: string, start: number, end: number, ext: string): string {
  const dir = dirname(src)
  const stem = basename(src, extname(src)).replace(/ \[trim [^\]]+\]$/, '')
  const base = `${stem} [trim ${stamp(start)}-${stamp(end)}]`
  let out = join(dir, `${base}.${ext}`)
  for (let n = 2; existsSync(out); n++) out = join(dir, `${base} (${n}).${ext}`)
  return out
}

/** Cut [start, end) of `src` into a new file beside it. Returns the output path. */
export async function exportSegment(job: SegmentJob): Promise<string> {
  const ffmpeg = resolveTool('ffmpeg')
  if (!ffmpeg) throw new Error('ffmpeg is not installed. Open Settings → Engine.')
  const info = await inspect(job.src)
  const start = Math.max(0, job.start)
  const end = job.kind === 'm4r' ? Math.min(job.end, start + 40) : job.end
  if (end <= start) throw new Error('The out point must come after the in point.')
  const out = segmentPath(job.src, start, end, job.kind)
  const tmp = out + '.part'
  const length = end - start
  const args = ['-hide_banner', '-y', '-loglevel', 'error', '-nostats', '-progress', 'pipe:1']
  if (job.kind === 'mp4' && !job.precise) {
    // Fast path: seek before the input and copy streams; the cut lands on the previous keyframe.
    args.push('-ss', String(start), '-i', job.src, '-t', String(length), '-map', '0:v:0', '-map', '0:a?', '-c', 'copy', '-map_metadata', '0', '-movflags', '+faststart', '-f', 'mp4')
  } else if (job.kind === 'mp4') {
    const choice = (await bestEncoder('h264'))!
    args.push('-ss', String(start), '-i', job.src, '-t', String(length), '-map', '0:v:0', '-map', '0:a?', ...encoderArgs(choice, info.kbps), '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-map_metadata', '0', '-movflags', '+faststart', '-f', 'mp4')
    job.onLog?.(`precise cut with ${choice.encoder}`)
  } else {
    // Audio: keep AAC as is, transcode anything else; ringtones are 128 kbps AAC by convention.
    const copy = info.acodec === 'aac' && job.kind === 'm4a'
    args.push('-ss', String(start), '-i', job.src, '-t', String(length), '-vn', '-map', '0:a:0', ...(copy ? ['-c:a', 'copy'] : ['-c:a', 'aac', '-b:a', job.kind === 'm4r' ? '128k' : '192k']), '-map_metadata', '0', '-movflags', '+faststart', '-f', 'ipod')
  }
  args.push(tmp)
  const total = length * 1_000_000
  const res = await run(ffmpeg, args, {
    signal: job.signal,
    idleTimeoutMs: 10 * 60 * 1000,
    onLine: (line) => {
      const m = line.match(/^out_time_us=(\d+)/)
      if (m) job.onProgress(Math.min(99, (Number(m[1]) / total) * 100))
      else if (!/^(frame|fps|bitrate|total_size|out_time|dup_frames|drop_frames|speed|progress|stream_)/.test(line)) job.onLog?.(line)
    },
  }).done
  if (job.signal?.aborted || res.code !== 0) {
    rmSync(tmp, { force: true })
    if (job.signal?.aborted) throw new Error('cancelled')
    throw new Error(`Export failed: ${res.stderr.trim().split('\n').pop() ?? `exit ${res.code}`}`)
  }
  renameSync(tmp, out)
  job.onProgress(100)
  return out
}

export interface Mark {
  /** seconds */
  start: number
  title: string
}

const safeName = (t: string) => t.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80)

/** Cut `src` at the marks into numbered clips beside it ("<stem> - 01 Title.mp4"). Stream copy: instant, keyframe-aligned. */
export async function splitByMarks(src: string, marks: Mark[], opts: TranscodeOptions): Promise<string[]> {
  const ffmpeg = resolveTool('ffmpeg')
  if (!ffmpeg) throw new Error('ffmpeg is not installed. Open Settings → Engine.')
  const info = await inspect(src)
  const total = info.duration ?? 0
  const sorted = [...marks].filter((m) => m.start >= 0 && (!total || m.start < total)).sort((a, b) => a.start - b.start)
  if (!sorted.length) throw new Error('No timecodes found.')
  if (sorted[0].start > 0.5) sorted.unshift({ start: 0, title: 'Start' })
  const ext = extname(src).replace('.', '') || 'mp4'
  const audioOnly = !info.vcodec || /mjpeg|png/.test(info.vcodec)
  const dir = dirname(src)
  const stem = basename(src, extname(src))
  const width = String(sorted.length).length
  const outputs: string[] = []
  for (let i = 0; i < sorted.length; i++) {
    if (opts.signal?.aborted) throw new Error('cancelled')
    const start = sorted[i].start
    const end = i + 1 < sorted.length ? sorted[i + 1].start : total || undefined
    let out = join(dir, `${stem} - ${String(i + 1).padStart(width, '0')} ${safeName(sorted[i].title) || 'Part'}.${ext}`)
    for (let n = 2; existsSync(out); n++) out = out.replace(/(\.[^.]+)$/, ` (${n})$1`)
    const args = ['-hide_banner', '-y', '-loglevel', 'error', '-nostats', '-ss', String(start), '-i', src]
    if (end !== undefined) args.push('-t', String(Math.max(0.1, end - start)))
    args.push('-map', audioOnly ? '0:a:0' : '0:v:0', ...(audioOnly ? [] : ['-map', '0:a?']), '-c', 'copy', '-map_metadata', '0', '-metadata', `title=${sorted[i].title}`, '-metadata', `track=${i + 1}/${sorted.length}`)
    if (/^(mp4|m4a|m4v|mov)$/i.test(ext)) args.push('-movflags', '+faststart')
    args.push(out)
    opts.onLog?.(`split ${i + 1}/${sorted.length}: ${basename(out)}`)
    const res = await run(ffmpeg, args, { signal: opts.signal, idleTimeoutMs: 10 * 60 * 1000 }).done
    if (opts.signal?.aborted) throw new Error('cancelled')
    if (res.code !== 0) throw new Error(`Split failed on part ${i + 1}: ${res.stderr.trim().split('\n').pop() ?? `exit ${res.code}`}`)
    outputs.push(out)
    opts.onProgress(((i + 1) / sorted.length) * 100)
  }
  return outputs
}

/** Write the marks into `src` as chapter metadata, in place (a remux, no re-encode). */
export async function writeChapters(src: string, marks: Mark[], opts: TranscodeOptions): Promise<void> {
  const ffmpeg = resolveTool('ffmpeg')
  if (!ffmpeg) throw new Error('ffmpeg is not installed. Open Settings → Engine.')
  const info = await inspect(src)
  const total = info.duration ?? 0
  const sorted = [...marks].filter((m) => m.start >= 0 && (!total || m.start < total)).sort((a, b) => a.start - b.start)
  if (!sorted.length) throw new Error('No timecodes found.')
  const esc = (t: string) => t.replace(/([=;#\\\n])/g, '\\$1')
  const lines = [';FFMETADATA1']
  for (let i = 0; i < sorted.length; i++) {
    const end = i + 1 < sorted.length ? sorted[i + 1].start : total || sorted[i].start + 1
    lines.push('[CHAPTER]', 'TIMEBASE=1/1000', `START=${Math.round(sorted[i].start * 1000)}`, `END=${Math.round(end * 1000)}`, `title=${esc(sorted[i].title || `Chapter ${i + 1}`)}`)
  }
  const meta = src + '.chapters.txt'
  const tmp = src + '.chapters' + (extname(src) || '.mp4')
  writeFileSync(meta, lines.join('\n') + '\n', 'utf8')
  try {
    const args = ['-hide_banner', '-y', '-loglevel', 'error', '-nostats', '-i', src, '-i', meta, '-map', '0', '-map_metadata', '0', '-map_chapters', '1', '-c', 'copy']
    if (/\.(mp4|m4a|m4v|mov)$/i.test(src)) args.push('-movflags', '+faststart')
    args.push(tmp)
    const res = await run(ffmpeg, args, { signal: opts.signal, idleTimeoutMs: 10 * 60 * 1000 }).done
    if (opts.signal?.aborted || res.code !== 0) {
      rmSync(tmp, { force: true })
      if (opts.signal?.aborted) throw new Error('cancelled')
      throw new Error(`Writing chapters failed: ${res.stderr.trim().split('\n').pop() ?? `exit ${res.code}`}`)
    }
    rmSync(src, { force: true })
    renameSync(tmp, src)
    opts.onProgress(100)
  } finally {
    rmSync(meta, { force: true })
  }
}
