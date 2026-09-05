import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { basename, extname, join } from 'node:path'
import type { DownloadProgress, FormatOption, MediaItem, OutputKind, Settings } from '../../shared/types'
import { PROGRESS_TEMPLATE, parseAria2Line, parseProgressLine } from '../../shared/progress'
import { run } from './run'
import { resolveTool, toolDirs } from './paths'
import { bestEncoder, encoderArgs } from './encoders'
import { inspect } from './transcode'

/**
 * The parallel engine for video and audio outputs.
 *
 * yt-dlp on its own downloads the video track, then the audio track, then fetches subtitles and the
 * thumbnail, then rewrites the finished file three times (merge, subtitles, tags) and patches the cover
 * in. Measured on a 245 MB 1080p60 video: 31 s of video, 11 s of audio afterwards, 6 s of sidecars
 * before anything moved, three full writes at the end.
 *
 * Here the video, the audio, the subtitles and the cover are fetched at the same time (each stream is
 * its own yt-dlp process with aria2c underneath), and one ffmpeg pass merges, tags, adds chapters,
 * subtitles and cover art in a single write. A forced codec is applied in that same pass, so nothing is
 * ever written twice. Every step resumes: stream files keep stable names, aria2c continues partials,
 * finished streams are recognised and skipped.
 *
 * Audio outputs (MP3, M4A, WAV, M4R) take the same route: the best audio stream and the cover are
 * fetched together and one ffmpeg pass extracts, encodes when the codec asks for it, tags and embeds
 * the cover. yt-dlp's own post-processors are not involved, so nothing here needs ffprobe, mutagen or
 * AtomicParsley, none of which the bundled engine has.
 *
 * The finished video is always MP4 (when "convert to MP4" is on): sources whose codecs MP4 cannot carry
 * (VP8, VP9, Vorbis, Opus …) are encoded to H.264 / AAC in the finishing pass instead of failing a remux.
 */

export interface FastContext {
  bin: string
  /** commonArgs(settings, url) */
  common: string[]
  /** aria2 downloader flags (null when aria2 is off) */
  aria2: string[] | null
  env: NodeJS.ProcessEnv
  tempDir: string
}

export interface FastJob {
  media: MediaItem
  format: FormatOption
  /** -f / -S / merge flags for this format */
  formatArgs: string[]
  destination: string
  outputTemplate: string
  settings: Settings
  overwrite: boolean
  signal?: AbortSignal
  onProgress: (p: DownloadProgress) => void
  onLog?: (line: string) => void
}

export interface FastResult {
  outputPath: string
  skipped: boolean
  /** The codec setting was applied inside the finishing pass. */
  codecApplied: true
  timings: Record<string, number>
}

/** Thrown when the fast path cannot handle this job; the caller falls back to the classic engine. */
export class FastPathUnavailable extends Error {}

const TRANSFER_IDLE_MS = 90 * 1000
const AUDIO_KINDS = new Set<OutputKind>(['mp3', 'm4a', 'wav', 'm4r'])
/** Codecs an MP4 file can carry and every mainstream player opens; anything else is encoded. */
const MP4_VIDEO = /^(h264|avc1?|hevc|h265|hvc1|av1|mpeg4)$/
const MP4_AUDIO = /^(aac|mp3|mp4a|ac3|eac3|alac)$/
const clean = (t: string) => t.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 60) || 'media'

export async function downloadFast(job: FastJob, ctx: FastContext): Promise<FastResult> {
  const t0 = Date.now()
  const timings: Record<string, number> = {}
  const mark = (k: string, from: number) => (timings[k] = Math.round((Date.now() - from) / 100) / 10)
  const log = (l: string) => job.onLog?.(`fast: ${l}`)
  const infoPath = job.media.infoJsonPath
  if (!infoPath || !existsSync(infoPath)) throw new FastPathUnavailable('no info json')
  const info = JSON.parse(readFileSync(infoPath, 'utf8')) as {
    formats?: { format_id: string; filesize?: number; filesize_approx?: number; ext?: string; acodec?: string; vcodec?: string; abr?: number; tbr?: number }[]
    title?: string; uploader?: string; channel?: string; upload_date?: string; description?: string; webpage_url?: string
    thumbnail?: string; chapters?: { title?: string; start_time: number; end_time: number }[]; duration?: number
  }
  const byId = new Map((info.formats ?? []).map((f) => [f.format_id, f]))
  const kind = job.format.kind
  const isAudio = AUDIO_KINDS.has(kind)
  if (!isAudio && kind !== 'video' && kind !== 'video-only') throw new FastPathUnavailable(`kind ${kind}`)

  // 1. What yt-dlp would pick, and what it would call the file: one quick offline run.
  //    Audio outputs ask only for the stream selection; the extraction flags are ours to apply.
  const selectArgs = isAudio ? ['-f', job.format.selector] : job.formatArgs
  const sel = await run(ctx.bin, [...ctx.common, '--load-info-json', infoPath, ...selectArgs, '--skip-download', '--windows-filenames',
    '-P', job.destination, '-o', job.outputTemplate,
    '--print', 'TXSEL|%(requested_formats.0.format_id)s|%(requested_formats.1.format_id)s|%(format_id)s',
    '--print', 'TXNAME|%(filename)s'], { env: ctx.env, pathPrepend: toolDirs(), timeoutMs: 60000, signal: job.signal }).done
  if (job.signal?.aborted) throw new Error('cancelled')
  const selLine = sel.stdout.split(/\r?\n/).find((l) => l.startsWith('TXSEL|'))
  const nameLine = sel.stdout.split(/\r?\n/).find((l) => l.startsWith('TXNAME|'))
  if (sel.code !== 0 || !selLine || !nameLine) throw new FastPathUnavailable(`selection failed: ${sel.stderr.trim().split('\n').pop() ?? sel.code}`)
  const [, rf0, rf1, single] = selLine.split('|')
  let ids = rf0 && rf0 !== 'NA' ? [rf0, ...(rf1 && rf1 !== 'NA' ? [rf1] : [])] : [single]
  if (!ids[0] || ids[0] === 'NA') throw new FastPathUnavailable('no format selected')
  let finalPath = nameLine.slice('TXNAME|'.length).trim()
  const namedExt = extname(finalPath)
  if (isAudio) {
    // "ba/b" may resolve to a video+audio pair; only the audio half is wanted. A muxed single file is
    // downloaded whole and the audio is taken out of it in the finishing pass.
    if (ids.length > 1) ids = [ids.find((id) => (byId.get(id)?.acodec ?? 'none') !== 'none') ?? ids[ids.length - 1]]
    finalPath = finalPath.slice(0, finalPath.length - namedExt.length) + `.${kind}`
  } else if (!/^\.(mp4|m4v|mov)$/i.test(namedExt)) {
    // A single WebM/MKV format: the finished file is MP4 when conversion is on, otherwise the classic
    // pipeline keeps the container as it is (cover art and mov_text subtitles do not exist in WebM).
    if (!job.settings.convertNonMp4) throw new FastPathUnavailable(`container ${namedExt} kept as is`)
    finalPath = finalPath.slice(0, finalPath.length - namedExt.length) + '.mp4'
  }
  mark('select', t0)
  if (existsSync(finalPath) && !job.overwrite) {
    log(`kept existing file untouched: ${finalPath}`)
    return { outputPath: finalPath, skipped: true, codecApplied: true, timings }
  }

  // 2. Everything in parallel: each stream in its own yt-dlp, subtitles in another, the cover by plain fetch.
  mkdirSync(ctx.tempDir, { recursive: true })
  const stem = `${clean(job.media.title)} [${(info as { id?: string }).id ?? 'x'}]`
  const totals = ids.map((id) => byId.get(id)?.filesize ?? byId.get(id)?.filesize_approx ?? 0)
  const done = ids.map(() => 0)
  const speeds = ids.map(() => 0)
  let downloader: 'native' | 'aria2c' | undefined = ctx.aria2 ? undefined : 'native'
  let emittedMax = 0
  const emit = () => {
    const known = totals.reduce((n, t, i) => n + (t || done[i]), 0)
    const got = done.reduce((n, d) => n + d, 0)
    const speed = speeds.reduce((n, s) => n + s, 0)
    let pct = known ? (got / known) * 100 : 0
    pct = Math.max(emittedMax, Math.min(99.5, pct))
    emittedMax = pct
    job.onProgress({ stage: 'download', percent: Math.round(pct * 10) / 10, downloadedBytes: got, totalBytes: known || undefined, speed: speed || undefined,
      eta: speed && known ? Math.max(0, Math.round((known - got) / speed)) : undefined, downloader, part: { index: 1, count: 1 } })
  }
  const tStreams = Date.now()
  const stream = async (id: string, i: number): Promise<string> => {
    const args = [...ctx.common, '--load-info-json', infoPath, '-f', id, '-o', join(ctx.tempDir, `${stem}.f${id}.%(ext)s`),
      '--no-quiet', '--newline', '--progress', '--progress-template', PROGRESS_TEMPLATE, '--no-mtime', '--no-playlist', ...(ctx.aria2 ?? [])]
    let attempt = 0
    for (;;) {
      const res = await run(ctx.bin, args, {
        env: ctx.env, pathPrepend: toolDirs(), signal: job.signal, idleTimeoutMs: TRANSFER_IDLE_MS,
        onLine: (line) => {
          job.onLog?.(line)
          const p = parseProgressLine(line) ?? parseAria2Line(line)
          if (!p || p.stage !== 'download') return
          if (p.downloader === 'aria2c') downloader = 'aria2c'
          if (p.downloadedBytes !== undefined) done[i] = Math.max(done[i], p.downloadedBytes)
          if (p.totalBytes && !totals[i]) totals[i] = p.totalBytes
          speeds[i] = p.speed ?? 0
          emit()
        },
      }).done
      if (job.signal?.aborted) throw new Error('cancelled')
      if (res.stalled && attempt++ < 2) {
        log(`stream ${id}: no data for 90 s, restarting (${attempt}/2), resuming from disk`)
        continue
      }
      if (res.code !== 0) throw new Error(res.stderr.trim().split('\n').pop() || `stream ${id} failed (${res.code})`)
      break
    }
    speeds[i] = 0
    const file = readdirSync(ctx.tempDir).find((f) => f.startsWith(`${stem}.f${id}.`) && !/\.(part|aria2|ytdl)$/i.test(f))
    if (!file) throw new Error(`stream ${id}: file not found after download`)
    done[i] = totals[i] || done[i]
    emit()
    return join(ctx.tempDir, file)
  }

  const wantSubs = kind === 'video' && (job.settings.embedSubtitles || job.settings.writeSubtitleFiles) && job.media.subtitles.length > 0
  const subs = async (): Promise<string[]> => {
    if (!wantSubs) return []
    const langs = job.settings.subtitleLangs.length ? job.settings.subtitleLangs : ['en']
    const wanted = langs.flatMap((l) => [l, `${l}-*`])
    const hasUserSub = job.media.subtitles.some((s) => !s.auto && langs.some((l) => s.lang === l || s.lang.startsWith(l + '-')))
    const args = [...ctx.common, '--load-info-json', infoPath, '--skip-download', '--write-subs', ...(hasUserSub ? [] : ['--write-auto-subs']),
      '--sub-langs', wanted.join(','), '--convert-subs', 'srt', '--no-playlist', '-o', join(ctx.tempDir, `${stem}.%(ext)s`)]
    const res = await run(ctx.bin, args, { env: ctx.env, pathPrepend: toolDirs(), signal: job.signal, timeoutMs: 180000, onLine: (l) => job.onLog?.(l) }).done
    if (res.code !== 0) log(`subtitles skipped: ${res.stderr.trim().split('\n').pop() ?? res.code}`)
    return readdirSync(ctx.tempDir).filter((f) => f.startsWith(`${stem}.`) && /\.srt$/i.test(f) && !/\.f\d+\./.test(f)).map((f) => join(ctx.tempDir, f))
  }
  // WAV cannot carry cover art; a video-only file has no reason to.
  const wantCover = (kind === 'video' || (isAudio && kind !== 'wav')) && !!(job.media.thumbnail || info.thumbnail)
  const cover = async (): Promise<string | null> => {
    if (!wantCover) return null
    const url = job.media.thumbnail || info.thumbnail!
    try {
      const res = await fetch(url, { signal: job.signal ? AbortSignal.any([job.signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000) })
      if (!res.ok) throw new Error(`${res.status}`)
      const type = res.headers.get('content-type') ?? ''
      const ext = /png/.test(type) ? 'png' : /webp/.test(type) ? 'webp' : 'jpg'
      const p = join(ctx.tempDir, `${stem}.cover.${ext}`)
      writeFileSync(p, Buffer.from(await res.arrayBuffer()))
      return p
    } catch (e) {
      log(`cover skipped: ${(e as Error).message}`)
      return null
    }
  }

  const [streamPaths, subPaths, coverPath] = await Promise.all([Promise.all(ids.map(stream)), subs(), cover()])
  mark('streams', tStreams)
  if (job.signal?.aborted) throw new Error('cancelled')

  // 3. One pass: merge + subtitles + tags + chapters + cover (+ codec), a single write of the finished file.
  const tFinish = Date.now()
  const ffmpeg = resolveTool('ffmpeg')
  if (!ffmpeg) throw new FastPathUnavailable('ffmpeg missing')
  const inputs: string[] = []
  const maps: string[] = []
  let codecArgs: string[] = []
  let audioArgs: string[] = []
  let subArgs: string[] = []
  let coverArgs: string[] = []
  let limitArgs: string[] = []
  let encoding = false
  let tmpExt = extname(finalPath)
  const chapters = kind === 'wav' ? [] : (info.chapters ?? []).filter((c) => c.end_time > c.start_time)
  let chapterFile: string | null = null
  const writeChapters = () => {
    if (!chapters.length) return
    const esc = (t: string) => t.replace(/([=;#\\\n])/g, '\\$1')
    chapterFile = join(ctx.tempDir, `${stem}.chapters.txt`)
    writeFileSync(chapterFile, [';FFMETADATA1', ...chapters.flatMap((c, i) => ['[CHAPTER]', 'TIMEBASE=1/1000', `START=${Math.round(c.start_time * 1000)}`, `END=${Math.round(c.end_time * 1000)}`, `title=${esc(c.title || `Chapter ${i + 1}`)}`])].join('\n') + '\n')
    inputs.push('-i', chapterFile)
  }
  let chapterIdx = 0
  let coverIdx = 0
  const jpeg = !!coverPath && /\.jpe?g$/i.test(coverPath)

  if (isAudio) {
    const src = streamPaths[0]
    const ainfo = await inspect(src)
    if (!ainfo.acodec) throw new Error('the source has no audio track')
    const abr = byId.get(ids[0])?.abr ?? byId.get(ids[0])?.tbr ?? ainfo.kbps
    inputs.push('-i', src)
    maps.push('-map', '0:a:0')
    chapterIdx = 1
    writeChapters()
    coverIdx = chapterIdx + (chapterFile ? 1 : 0)
    if (coverPath) {
      inputs.push('-i', coverPath)
      maps.push('-map', `${coverIdx}:v:0`)
    }
    switch (kind) {
      case 'm4a':
        audioArgs = /^(aac|mp4a|alac)$/.test(ainfo.acodec) ? ['-c:a', 'copy'] : ['-c:a', 'aac', '-b:a', `${Math.min(256, Math.max(128, Math.round(abr ?? 160)))}k`]
        break
      case 'mp3':
        audioArgs = ainfo.acodec === 'mp3' ? ['-c:a', 'copy'] : ['-c:a', 'libmp3lame', '-b:a', `${job.settings.mp3Bitrate}k`]
        break
      case 'wav':
        audioArgs = ['-c:a', 'pcm_s16le']
        break
      case 'm4r':
        // iPhone ringtone: AAC in an M4A container, first 40 s, under the extension iOS expects.
        audioArgs = ['-c:a', 'aac', '-b:a', '128k']
        limitArgs = ['-t', '40']
        tmpExt = '.m4a'
        break
    }
    encoding = audioArgs[1] !== 'copy'
    if (coverPath) {
      coverArgs = kind === 'mp3'
        ? ['-c:v', 'mjpeg', '-id3v2_version', '3', '-metadata:s:v', 'title=Album cover', '-metadata:s:v', 'comment=Cover (front)']
        : ['-c:v', jpeg ? 'copy' : 'mjpeg', '-disposition:v:0', 'attached_pic']
    }
    if (encoding) log(`audio ${ainfo.acodec} → ${kind}${abr ? ` (${Math.round(abr)} kbps source)` : ''}`)
  } else {
    const videoIn = streamPaths[0]
    const audioIn = streamPaths[1]
    const vinfo = await inspect(videoIn)
    const ainfo = audioIn ? await inspect(audioIn) : vinfo
    inputs.push('-i', videoIn)
    if (audioIn) inputs.push('-i', audioIn)
    for (const s of subPaths) inputs.push('-i', s)
    maps.push('-map', '0:v:0')
    if (audioIn) maps.push('-map', '1:a:0')
    else if (vinfo.acodec && kind === 'video') maps.push('-map', '0:a?') // muxed single format
    const subBase = audioIn ? 2 : 1
    subPaths.forEach((_, i) => maps.push('-map', `${subBase + i}:0`))
    chapterIdx = subBase + subPaths.length
    writeChapters()
    coverIdx = chapterIdx + (chapterFile ? 1 : 0)
    if (coverPath) {
      inputs.push('-i', coverPath)
      maps.push('-map', `${coverIdx}:v:0`)
    }

    // Codec: copy when MP4 can carry it and no codec is forced; otherwise encode in this same pass.
    // VP8/VP9 sources (WebM-only sites) would fail a remux into MP4, so they are encoded to H.264 here.
    codecArgs = ['-c:v:0', 'copy']
    const wanted = job.settings.videoCodec
    const fits = !!vinfo.vcodec && MP4_VIDEO.test(vinfo.vcodec)
    const forcedNames = wanted === 'h264' ? ['h264', 'avc1'] : ['hevc', 'h265', 'hvc1']
    const needs = wanted === 'auto' ? (fits ? null : 'h264') : vinfo.vcodec && forcedNames.includes(vinfo.vcodec) ? null : wanted
    if (needs) {
      const choice = await bestEncoder(needs)
      if (!choice) throw new FastPathUnavailable(`no ${needs} encoder for a ${vinfo.vcodec ?? 'unknown'} source`)
      codecArgs = [...encoderArgs(choice, vinfo.kbps).map((a) => (/^-(c|b|tag|q):v$/.test(a) ? `${a}:0` : a)), '-pix_fmt:v:0', 'yuv420p']
      encoding = true
      log(`codec ${vinfo.vcodec ?? '?'} → ${needs} with ${choice.encoder} in the finishing pass${fits ? '' : ' (MP4 cannot carry the source codec)'}`)
    }
    const acodec = ainfo.acodec ?? byId.get(ids[1] ?? ids[0])?.acodec?.replace(/\..*$/, '')
    const hasAudio = !!audioIn || !!vinfo.acodec
    audioArgs = hasAudio ? (acodec && MP4_AUDIO.test(acodec) ? ['-c:a', 'copy'] : ['-c:a', 'aac', '-b:a', '160k']) : []
    subArgs = subPaths.length ? ['-c:s', 'mov_text', ...subPaths.flatMap((p, i) => ['-metadata:s:s:' + i, `language=${lang(p)}`])] : []
    coverArgs = coverPath ? ['-c:v:1', jpeg ? 'copy' : 'mjpeg', '-disposition:v:1', 'attached_pic'] : []
    tmpExt = '.mp4'
  }

  // Global tags come from the stream file (nothing of note) and are overridden below; chapter titles travel
  // with the chapters input, and a global reset (-1) would wipe them, so the source is mapped instead.
  const meta = ['-map_metadata', '0', ...(chapterFile ? ['-map_chapters', String(chapterIdx)] : ['-map_chapters', '-1'])]
  const tag = (k: string, v?: string) => (v ? ['-metadata', `${k}=${v}`] : [])
  const date = info.upload_date && /^\d{8}$/.test(info.upload_date) ? `${info.upload_date.slice(0, 4)}-${info.upload_date.slice(4, 6)}-${info.upload_date.slice(6)}` : undefined
  const tags = [...tag('title', info.title ?? job.media.title), ...tag('artist', info.uploader ?? info.channel ?? job.media.uploader), ...tag('date', date),
    ...tag('description', info.description?.slice(0, 4000)), ...tag('comment', info.webpage_url ?? job.media.webpageUrl), ...tag('purl', info.webpage_url ?? job.media.webpageUrl)]
  const tmpOut = join(ctx.tempDir, `${stem}.finishing${tmpExt}`)
  const args = ['-hide_banner', '-y', '-loglevel', 'error', '-nostats', '-progress', 'pipe:1', ...inputs, ...maps, ...codecArgs, ...audioArgs, ...subArgs, ...coverArgs, ...limitArgs, ...meta, ...tags, '-strict', '-2', tmpOut]
  const total = (kind === 'm4r' ? Math.min(40, info.duration ?? 40) : info.duration ?? job.media.duration ?? 0) * 1_000_000
  const stage: DownloadProgress['stage'] = encoding ? 'convert' : isAudio ? 'tag' : 'merge'
  job.onProgress({ stage, percent: 0 })
  const fin = await run(ffmpeg, args, {
    signal: job.signal, idleTimeoutMs: 10 * 60 * 1000,
    onLine: (line) => {
      const m = line.match(/^out_time_us=(\d+)/)
      if (m && total > 0) job.onProgress({ stage, percent: Math.min(99, (Number(m[1]) / total) * 100) })
      else if (!/^(frame|fps|bitrate|total_size|out_time|dup_frames|drop_frames|speed|progress|stream_)/.test(line)) job.onLog?.(line)
    },
  }).done
  if (job.signal?.aborted) {
    rmSync(tmpOut, { force: true })
    throw new Error('cancelled')
  }
  if (fin.code !== 0) {
    rmSync(tmpOut, { force: true })
    throw new Error(`Finishing failed: ${fin.stderr.trim().split('\n').pop() ?? `exit ${fin.code}`}`)
  }
  mark('finish', tFinish)

  // 4. Into place, sidecars the user asked for, temp files gone.
  const tMove = Date.now()
  job.onProgress({ stage: 'move', percent: 100 })
  mkdirSync(job.destination, { recursive: true })
  moveFile(tmpOut, finalPath)
  const finalStem = finalPath.replace(/\.[^.]+$/, '')
  for (const s of subPaths) {
    if (job.settings.writeSubtitleFiles) moveFile(s, `${finalStem}.${langCode(s)}.srt`)
    else rmSync(s, { force: true })
  }
  if (coverPath && job.settings.saveThumbnail) {
    const out = `${finalStem}.${job.settings.thumbnailFormat}`
    const conv = await run(ffmpeg, ['-hide_banner', '-y', '-loglevel', 'error', '-i', coverPath, '-frames:v', '1', out], { timeoutMs: 60000 }).done
    if (conv.code !== 0) log('thumbnail file skipped')
  }
  for (const p of [...streamPaths, coverPath, chapterFile]) if (p) rmSync(p, { force: true })
  mark('move', tMove)
  mark('total', t0)
  log(`done in ${timings.total}s: select ${timings.select}s, streams ${timings.streams}s (${ids.join('+')}${(downloader as string) === 'aria2c' ? ', aria2' : ', native'}), finish ${timings.finish}s${encoding ? ' (encoded)' : ''}, move ${timings.move}s`)
  return { outputPath: finalPath, skipped: false, codecApplied: true, timings }
}

const ISO639_2: Record<string, string> = { en: 'eng', de: 'deu', fr: 'fra', es: 'spa', pt: 'por', it: 'ita', ja: 'jpn', zh: 'zho', ru: 'rus', ko: 'kor', ar: 'ara', hi: 'hin', nl: 'nld', sv: 'swe', pl: 'pol', tr: 'tur', id: 'ind', vi: 'vie', th: 'tha', uk: 'ukr', cs: 'ces', el: 'ell', he: 'heb', da: 'dan', fi: 'fin', no: 'nor', hu: 'hun', ro: 'ron' }
/** Subtitle language from "<stem>.en.srt" or "<stem>.en-US.srt": the two-letter code for file names, ISO 639-2 for the mp4 track. */
function langCode(p: string): string {
  const m = basename(p).match(/\.([a-zA-Z]{2,3})(?:-[A-Za-z0-9]+)?\.srt$/)
  return (m?.[1] ?? 'und').toLowerCase()
}
function lang(p: string): string {
  const c = langCode(p)
  return c.length === 3 ? c : ISO639_2[c] ?? 'und'
}

/** Rename, or copy and delete when the temp folder is on another volume. */
function moveFile(from: string, to: string): void {
  try {
    renameSync(from, to)
  } catch {
    copyFileSync(from, to)
    rmSync(from, { force: true })
  }
}
