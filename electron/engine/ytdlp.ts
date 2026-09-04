import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import type { DownloadProgress, FormatOption, MediaItem, Settings } from '../../shared/types'
import { normalizeMedia, type YtDlpJson } from '../../shared/normalize'
import { FINAL_PATH_PREFIX, PROGRESS_TEMPLATE, parseFinalPath, parseProgressLine } from '../../shared/progress'
import { playlistUrlFromVideoUrl, vimeoPlayerUrl } from '../../shared/urls'
import { ffmpegLocation, potDir, resolveTool, toolDirs, userBinDir } from './paths'
import { existsSync as fileExists, mkdirSync as mkdirp, readdirSync, renameSync, rmdirSync, statSync, writeFileSync as writeFile } from 'node:fs'
import { createHash } from 'node:crypto'
import { basename } from 'node:path'
import { run } from './run'
import { app } from 'electron'
import { getSecret } from '../secrets'
import { tm } from '../i18n'
import { cpus } from 'node:os'
import { spawn } from 'node:child_process'

/** Set at startup from a DNS probe of jnn-pa.googleapis.com; false disables the PO-token helper args. */
let potReachable = true
export function setPotReachable(v: boolean): void {
  potReachable = v
}

function must(name: 'yt-dlp'): string {
  const p = resolveTool(name)
  if (!p) throw new Error(tm('error.notInstalled', { name }))
  return p
}

/** Flags that apply to every yt-dlp invocation. */
const USER_AGENTS: Record<Exclude<Settings['userAgent'], 'default'>, string> = {
  desktop: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
  ios: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1',
  android: 'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36',
}
/** yt-dlp rejects password logins for YouTube outright ("not supported"), so the stored login never reaches it. */
const acceptsPasswordLogin = (url: string) => !/(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)/i.test(safeHost(url))
function safeHost(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}
const SECRET_FLAGS = new Set(['--password', '--video-password'])
/** argv for the log with secrets masked. */
export function redactArgs(args: string[]): string {
  return args.map((a, i) => (SECRET_FLAGS.has(args[i - 1]) ? '••••' : /\s/.test(a) ? JSON.stringify(a) : a)).join(' ')
}

function commonArgs(settings: Settings, url = ''): string[] {
  // yt-dlp encodes what it prints with the locale's preferred encoding (cp1252 on Windows) and drops
  // characters it cannot represent, so a printed path stops matching the real file. Force UTF-8 on the
  // pipe; PYTHONUTF8=1 in engineEnv() covers the Python side.
  const args = ['--no-warnings', '--no-colors', '--ignore-config', '--no-playlist-reverse', '--encoding', 'utf-8']
  args.push('--cache-dir', join(app.getPath('userData'), 'yt-dlp-cache'))
  const ff = ffmpegLocation()
  if (ff) args.push('--ffmpeg-location', ff)
  const deno = resolveTool('deno')
  if (deno) args.push('--js-runtimes', `deno:${deno}`)
  // IPv6 egress is the most common trigger of YouTube's "Sign in to confirm you're not a bot";
  // The reference macOS downloader passes this unconditionally. Off only if the user turns it off.
  if (settings.forceIpv4) args.push('--force-ipv4')
  if (settings.proxyEnabled && settings.proxy.trim()) args.push('--proxy', settings.proxy.trim())
  if (settings.cookiesFromBrowser) args.push('--cookies-from-browser', settings.cookiesFromBrowser)
  if (settings.cookiesFile && fileExists(settings.cookiesFile)) args.push('--cookies', settings.cookiesFile)
  if (settings.userAgent !== 'default') args.push('--user-agent', USER_AGENTS[settings.userAgent])
  if (settings.loginUsername && acceptsPasswordLogin(url)) {
    const password = getSecret('loginPassword')
    if (password) args.push('--username', settings.loginUsername, '--password', password)
  }
  if (settings.videoPassword) args.push('--video-password', settings.videoPassword)
  // bgutil PO-token helper: yt-dlp loads the plugin from the zip and runs the script through the bundled Deno.
  // Skipped when the network sinkholes its endpoint (see setPotReachable), so a doomed generation never
  // adds its timeout to every fetch.
  const pot = settings.potHelper && potReachable ? potDir() : null
  if (pot && deno) {
    args.push('--plugin-dirs', join(pot, 'plugins'))
    args.push('--extractor-args', `youtubepot-bgutilscript:server_home=${join(pot, 'server')}`)
  }
  return args
}

/** Environment for every yt-dlp spawn: keep Deno's and the helper's caches inside app data. */
export function engineEnv(): NodeJS.ProcessEnv {
  const data = app.getPath('userData')
  return {
    PYTHONUTF8: '1',
    DENO_DIR: join(data, 'deno-cache'),
    DENO_NO_UPDATE_CHECK: '1',
    DENO_NO_PROMPT: '1',
    XDG_CACHE_HOME: join(data, 'cache'),
  }
}

export interface FetchOptions {
  /** true → treat a watch?v=…&list=… URL as the single video */
  noPlaylist?: boolean
  signal?: AbortSignal
}

export async function fetchMetadata(url: string, settings: Settings, opts: FetchOptions = {}): Promise<MediaItem> {
  const bin = must('yt-dlp')
  const args = [...commonArgs(settings, url), '--dump-single-json', '--flat-playlist', '--skip-download']
  // A single video inside a playlist: fetch the video, remember the playlist for the prompt.
  if (opts.noPlaylist !== false && playlistUrlFromVideoUrl(url)) args.push('--no-playlist')
  let res = await run(bin, [...args, '--', url], { timeoutMs: 180000, signal: opts.signal, pathPrepend: toolDirs(), env: engineEnv() }).done
  if (res.code !== 0 && /confirm you.re not a bot/i.test(res.stderr) && !opts.signal?.aborted) {
    // Bot checks are often transient per request; one quiet retry before telling the user anything.
    await new Promise((r) => setTimeout(r, 4000))
    res = await run(bin, [...args, '--', url], { timeoutMs: 180000, signal: opts.signal, pathPrepend: toolDirs(), env: engineEnv() }).done
  }
  if (res.code !== 0 || !res.stdout.trim()) {
    // Vimeo: anonymous web client is refused, the embed player is not. Retry there once.
    const player = /logged-in/i.test(res.stderr) ? vimeoPlayerUrl(url) : null
    if (player && !opts.signal?.aborted) {
      const retry = await run(bin, [...args, '--referer', 'https://vimeo.com/', '--', player], { timeoutMs: 180000, signal: opts.signal, pathPrepend: toolDirs(), env: engineEnv() }).done
      if (retry.code === 0 && retry.stdout.trim()) {
        const media = parseJson(retry.stdout, player)
        return { ...media, url: player, webpageUrl: url, extraArgs: ['--referer', 'https://vimeo.com/'] }
      }
    }
    throw new Error(friendlyError(res.stderr))
  }
  return parseJson(res.stdout, url)
}

function parseJson(stdout: string, url: string): MediaItem {
  let json: YtDlpJson
  try {
    json = JSON.parse(stdout) as YtDlpJson
  } catch {
    throw new Error(tm('error.unreadableMetadata'))
  }
  const media = normalizeMedia(json, url)
  // Keep the raw info so the download can start from it (--load-info-json) instead of extracting again.
  if (!media.isPlaylist) {
    try {
      const dir = join(app.getPath('userData'), 'info')
      mkdirp(dir, { recursive: true })
      const file = join(dir, `${createHash('sha1').update(url).digest('hex')}.json`)
      writeFile(file, stdout)
      media.infoJsonPath = file
      media.fetchedAt = Date.now()
    } catch {
      /* fall back to a fresh extraction at download time */
    }
  }
  return media
}

export function friendlyError(stderr: string): string {
  const lines = stderr.split(/\r?\n/).filter((l) => l.trim())
  const err = [...lines].reverse().find((l) => /ERROR/.test(l)) ?? lines[lines.length - 1] ?? tm('error.unknown')
  let msg = err.replace(/^ERROR:\s*/, '').replace(/^\[[^\]]+\]\s*[\w-]+:\s*/, '')
  if (/confirm you.re not a bot/i.test(msg))
    return tm('error.botCheck')
  if (/private video|members-only|sign in to confirm your age|age-restricted|requires login|login required/i.test(msg))
    msg = tm('error.needsLogin', { msg })
  else if (/sign in|login|cookies/i.test(msg)) msg = tm('error.loginHint', { msg })
  if (/not available in your country|geo/i.test(msg)) msg = tm('error.geo', { msg })
  if (/unsupported url/i.test(msg)) msg = tm('error.unsupported')
  if (/DRM protected/i.test(msg)) msg = tm('error.drm')
  return msg.length > 220 ? msg.slice(0, 217) + '…' : msg
}

export interface DownloadJob {
  url: string
  media: MediaItem
  format: FormatOption
  destination: string
  settings: Settings
  signal?: AbortSignal
  /** Replace the file at the target name. Only the queue grants this, and only when it has established that this very format produced that file. */
  overwrite?: boolean
  /** Keep-both mode: add the quality to the file name so the earlier download survives. */
  nameTag?: string
  onProgress: (p: DownloadProgress) => void
  onLog?: (line: string) => void
}

export interface DownloadResult {
  outputPath: string
  skipped: boolean
}

function buildFormatArgs(format: FormatOption, settings: Settings): string[] {
  const args: string[] = ['-f', format.selector]
  // Resolution first, then prefer H.264 + AAC so the MP4 plays anywhere on Windows
  // without codec packs. With "keep original" the codec preference is dropped.
  const wanted = settings.videoCodec === 'h265' ? 'hevc' : 'h264'
  const codecPref = settings.convertNonMp4 || settings.videoCodec !== 'auto' ? `,vcodec:${wanted},acodec:aac` : ''
  if (format.sort) args.push('-S', `${format.sort}${format.kind === 'video' || format.kind === 'video-only' ? codecPref : ''}`)
  switch (format.kind) {
    case 'video':
      args.push('--merge-output-format', 'mp4')
      if (settings.convertNonMp4) args.push('--remux-video', 'mp4')
      break
    case 'video-only':
      args.push('--remux-video', 'mp4')
      break
    case 'mp3':
      args.push('-x', '--audio-format', 'mp3', '--audio-quality', `${settings.mp3Bitrate}K`)
      break
    case 'm4a':
      args.push('-x', '--audio-format', 'm4a')
      break
    case 'wav':
      // Uncompressed 16-bit PCM at the source sample rate; ffmpeg decodes the best audio stream once.
      args.push('-x', '--audio-format', 'wav')
      break
    case 'm4r':
      // iPhone ringtone: AAC in an M4A container, first 40 s, renamed to .m4r once written.
      args.push('-x', '--audio-format', 'm4a', '--audio-quality', '128K', '--postprocessor-args', 'ExtractAudio:-t 40')
      break
    case 'subs':
      // Only the subtitle files; the media is never fetched.
      args.length = 0
      args.push('--skip-download')
      break
  }
  return args
}

/**
 * Where partial and intermediate files go. Normally the app-data tmp folder, out of the user's sight.
 * When the destination sits on another volume (external drive, NAS, second disk) the final step would
 * be a full copy of the finished file instead of a rename, so the temp folder moves next to the
 * destination for that job. It is removed again once empty.
 */
export function tempDirFor(destination: string): string {
  const appTmp = join(app.getPath('userData'), 'tmp')
  try {
    mkdirp(appTmp, { recursive: true })
    if (statSync(destination).dev === statSync(appTmp).dev) return appTmp
  } catch {
    return appTmp
  }
  const local = join(destination, '.tuberx-tmp')
  mkdirp(local, { recursive: true })
  if (process.platform === 'win32') void spawn('attrib', ['+h', local], { windowsHide: true }).on('error', () => {})
  return local
}

/** Drop the per-destination temp folder when a job leaves nothing in it. */
export function dropLocalTemp(destination: string): void {
  const local = join(destination, '.tuberx-tmp')
  try {
    if (fileExists(local) && readdirSync(local).length === 0) rmdirSync(local)
  } catch {
    /* busy or already gone */
  }
}

const TRANSFER_IDLE_MS = 90 * 1000
const STAGE_NAME: Record<string, string> = {
  download: 'downloading',
  merge: 'merging video and audio',
  convert: 'converting',
  subs: 'embedding subtitles',
  tag: 'writing tags',
  cover: 'embedding cover art',
  move: 'moving the file',
}

export async function download(job: DownloadJob): Promise<DownloadResult> {
  const bin = must('yt-dlp')
  const { settings, format } = job
  mkdirSync(job.destination, { recursive: true })

  const args = [
    ...commonArgs(settings, job.media.url || job.url),
    ...buildFormatArgs(format, settings),
    // --print implies --quiet, which silences the progress lines; --no-quiet restores them.
    '--no-quiet',
    '--newline',
    '--progress',
    '--progress-template',
    PROGRESS_TEMPLATE,
    '--print',
    `after_move:${FINAL_PATH_PREFIX}%(filepath)s`,
    '--no-simulate',
    '--windows-filenames',
    '--no-mtime',
    '-P',
    job.destination,
    '-P',
    `temp:${tempDirFor(job.destination)}`,
    '-o',
    job.nameTag ? `%(title).120B [${job.nameTag}].%(ext)s` : '%(title).120B.%(ext)s',
    '--embed-metadata',
    '--embed-chapters',
    '--no-playlist',
  ]
  // yt-dlp decides "already downloaded" by file name alone. The default keeps an existing video file
  // (the queue then retries with a quality tag); overwriting is granted only for a refresh of a file
  // this same format produced. Related files (thumbnail, subtitles) may always be rewritten.
  args.push(job.overwrite ? '--force-overwrites' : '--no-force-overwrites')

  const subsOnly = format.kind === 'subs'
  if (subsOnly) {
    // No media, so nothing to tag or embed; a "[ringtone]"-style suffix is not needed either.
    for (const flag of ['--embed-metadata', '--embed-chapters']) args.splice(args.indexOf(flag), 1)
  }
  if (format.kind === 'm4r') args[args.indexOf('-o') + 1] = args[args.indexOf('-o') + 1].replace(/\.%\(ext\)s$/, ' [ringtone].%(ext)s')
  // Tags + artwork on everything that can carry them
  if (format.kind !== 'video-only' && format.kind !== 'wav' && !subsOnly) args.push('--embed-thumbnail') // WAV cannot carry cover art
  if (settings.saveThumbnail && !subsOnly) {
    args.push('--write-thumbnail', '--convert-thumbnails', settings.thumbnailFormat)
    if (format.kind === 'video-only') args.push('--no-embed-thumbnail')
  }

  // Subtitles (video outputs only): user subs first, auto captions as fallback.
  // --embed-subs removes the side files after embedding unless we also asked to keep them.
  if ((subsOnly || (format.kind === 'video' && (settings.embedSubtitles || settings.writeSubtitleFiles))) && job.media.subtitles.length) {
    const langs = settings.subtitleLangs.length ? settings.subtitleLangs : ['en']
    const wanted = langs.flatMap((l) => [l, `${l}-*`])
    const hasUserSub = job.media.subtitles.some((s) => !s.auto && langs.some((l) => s.lang === l || s.lang.startsWith(l + '-')))
    // yt-dlp keeps the sidecar file only when --write-subs is given explicitly;
    // --embed-subs (and --write-auto-subs) alone fetch, embed and clean up.
    args.push('--sub-langs', wanted.join(','))
    if (settings.writeSubtitleFiles || subsOnly) args.push('--write-subs', '--convert-subs', 'srt')
    if (!hasUserSub) args.push('--write-auto-subs')
    if (settings.embedSubtitles && !subsOnly) args.push('--embed-subs')
  }

  // Fragmented streams (HLS/DASH on Vimeo, Dailymotion, Twitter …) download fragments in parallel;
  // scale with the machine (Ryzen 9 / Core i9 class boxes get 8). ffmpeg already uses every core (-threads 0).
  args.push('--concurrent-fragments', String(Math.min(8, Math.max(2, Math.floor(cpus().length / 2)))))

  // aria2c: many connections per file. yt-dlp resolves the name on PATH, so the bin dir is
  // prepended to PATH in run(); the explicit path below is belt and braces on Windows.
  const aria2 = settings.useAria2 ? resolveTool('aria2c') : null
  if (aria2) {
    // --summary-interval=1: aria2c prints its "[#gid done/total(pct%) CN DL ETA]" line once a second; the
    // default is every 60 s, which left the bar at 0 % for the whole of a fast transfer. Notice-level
    // console output must stay on for those lines to appear.
    const aria2Args = ['-c', '-x', '16', '-s', '16', '-k', '1M', '--min-split-size=1M', '--file-allocation=none', '--max-tries=5', '--retry-wait=2', '--auto-save-interval=10', '--summary-interval=1']
    if (process.env.TUBERX_ARIA2_LIMIT) aria2Args.push(`--max-overall-download-limit=${process.env.TUBERX_ARIA2_LIMIT}`) // dev/test throttle
    if (settings.rateLimitKbps > 0) aria2Args.push(`--max-overall-download-limit=${settings.rateLimitKbps}K`)
    args.push(
      '--downloader', aria2,
      // HLS/DASH fragment streams (Vimeo, Dailymotion …) stay on yt-dlp's native downloader:
      // aria2c cannot handle their encrypted fragments and yt-dlp reports them as DRM.
      '--downloader', 'dash,m3u8:native',
      '--downloader-args', `aria2c:${aria2Args.join(' ')}`,
    )
  }

  if (settings.rateLimitKbps > 0) args.push('--limit-rate', `${settings.rateLimitKbps}K`) // native downloader and fragment streams
  if (job.media.extraArgs?.length) args.push(...job.media.extraArgs)
  // Media URLs from the fetch stay valid for hours; reuse them so the download starts immediately.
  const infoFresh =
    !!job.media.infoJsonPath && fileExists(job.media.infoJsonPath) && Date.now() - (job.media.fetchedAt ?? 0) < 3 * 60 * 60 * 1000
  const urlArgs = ['--', job.media.url || job.url]
  const infoArgs = infoFresh ? ['--load-info-json', job.media.infoJsonPath!] : urlArgs
  args.push(...infoArgs)

  job.onLog?.(`argv: ${redactArgs(args)}`)
  let outputPath = ''
  let alreadyExists = false
  let existingPath = ''
  // yt-dlp keeps an existing file but still runs its post-processors over it. When this job may not
  // overwrite, the process is stopped the moment it reports the file, so the user's file is not touched.
  const inner = new AbortController()
  job.signal?.addEventListener('abort', () => inner.abort(), { once: true })
  let moveBlocked = false
  // aria2c announces itself with its own status lines ("[#a1b2c3 12MiB/245MiB CN:16 DL:8.7MiB]");
  // the native downloader never prints those. Surfaced so the UI can prove which path ran.
  let downloader: 'native' | 'aria2c' | undefined = aria2 ? undefined : 'native'
  const stderrTail: string[] = []
  let lastStage: DownloadProgress['stage'] = 'download'
  // One bar for the whole job: yt-dlp fetches video and audio as separate files (plus subtitles and
  // thumbnails), each with its own 0–100 %, which made the meter run backwards between parts.
  const parts: { downloaded: number; total?: number }[] = []
  let expectedParts = 1
  let emittedMax = 0
  const aggregate = (p: DownloadProgress): DownloadProgress | null => {
    if (p.stage !== 'download') return p
    if (!parts.length) return null // subtitle/thumbnail transfers before the first media file: not the bar's business
    const cur = parts[parts.length - 1]
    cur.downloaded = p.downloadedBytes ?? cur.downloaded
    if (p.totalBytes) cur.total = p.totalBytes
    const known = parts.reduce((n, x) => n + (x.total ?? x.downloaded), 0)
    const done = parts.reduce((n, x) => n + x.downloaded, 0)
    let pct = known ? (done / known) * 100 : p.percent
    if (parts.length < expectedParts) pct = Math.min(pct, 95) // more files to come: never show 100 early
    pct = Math.max(emittedMax, Math.min(100, pct))
    emittedMax = pct
    return { ...p, percent: Math.round(pct * 10) / 10, downloadedBytes: done, totalBytes: known || undefined, part: { index: parts.length, count: Math.max(expectedParts, parts.length) } }
  }
  const launch = () => run(bin, args, {
    signal: inner.signal,
    pathPrepend: toolDirs(),
    env: engineEnv(),
    // A transfer that prints nothing for 90 s is wedged (a stuck connection in aria2c is the usual
    // shape); it is killed and restarted, and both aria2c and yt-dlp resume from what is on disk.
    // Post-processing gets 10 minutes: a merge of a large file on a slow disk is silent but alive.
    idleTimeoutMs: () => (lastStage === 'download' ? TRANSFER_IDLE_MS : 10 * 60 * 1000),
    onLine: (line, stream) => {
      job.onLog?.(line)
      const final = parseFinalPath(line)
      if (final) {
        outputPath = final
        return
      }
      // Subtitles-only jobs never move a media file; the subtitle writer's own line names the output.
      // Subtitles-only jobs never move a media file; the subtitle lands through MoveFiles (or is
      // written in place). The last subtitle path reported wins.
      if (format.kind === 'subs') {
        const moved = line.match(/^\[MoveFiles\] Moving file "(.+?)" to "(.+?)"$/)
        const written = line.match(/^\[info\] Writing video subtitles to: (.+)$/) ?? line.match(/^\[info\] Video subtitle (.+?) is already present$/)
        const p = moved?.[2] ?? written?.[1]
        if (p && /\.(srt|vtt|ass|lrc)$/i.test(p)) outputPath = p
      }
      const ex = line.match(/^\[download\] (.+?) has already been downloaded/)
      if (ex) {
        alreadyExists = true
        existingPath = ex[1]
        if (!job.overwrite) inner.abort()
      }
      // "[info] id: Downloading 1 format(s): 298+140" — a merged selection counts as one format but
      // arrives as one file per "+"-joined id, so count the ids, not the number yt-dlp prints.
      const fm = line.match(/Downloading \d+ format\(s\): (\S+)/)
      if (fm) expectedParts = fm[1].split(',').reduce((n, sel) => n + sel.split('+').length, 0)
      if (/^\[download\] Destination: /.test(line)) parts.push({ downloaded: 0 })
      if (/destination already exists|Not overwriting/i.test(line)) moveBlocked = true
      const p = parseProgressLine(line)
      if (p?.downloader === 'aria2c') downloader = 'aria2c'
      if (p) {
        lastStage = p.stage
        if (process.env.TUBERX_DEBUG) job.onLog?.(`parsed ${JSON.stringify(p)}`)
        const agg = aggregate(p)
        if (agg) job.onProgress(downloader ? { ...agg, downloader } : agg)
      }
      if (stream === 'stderr') {
        stderrTail.push(line)
        if (stderrTail.length > 30) stderrTail.shift()
      }
    },
  }).done
  let res = await launch()
  for (let restart = 1; res.stalled && lastStage === 'download' && !job.signal?.aborted && restart <= 2; restart++) {
    job.onLog?.(`watchdog: no data for ${TRANSFER_IDLE_MS / 1000} s; restarting the transfer (${restart}/2), resuming from what is on disk`)
    parts.length = 0
    res = await launch()
  }
  if (job.signal?.aborted) throw new Error('cancelled')
  if (alreadyExists && !job.overwrite) {
    job.onLog?.(`kept existing file untouched: ${existingPath}`)
    return { outputPath: existingPath, skipped: true }
  }
  if (res.code !== 0 && infoFresh && !res.stalled && /403|expired|Requested format is not available|HTTP Error 4/i.test(res.stderr)) {
    // Saved URLs went stale: extract again once, the slow-but-sure way.
    job.onLog?.('saved info JSON rejected by the server; refetching')
    const fresh = [...args.slice(0, args.length - infoArgs.length), ...urlArgs]
    res = await run(bin, fresh, { signal: inner.signal, pathPrepend: toolDirs(), env: engineEnv(), idleTimeoutMs: 10 * 60 * 1000, onLine: (l) => job.onLog?.(l) }).done
  }
  if (res.stalled) {
    const stage = STAGE_NAME[lastStage] ?? lastStage
    job.onLog?.(`watchdog: no output while ${stage}; process tree killed${res.orphaned ? ' (parent had to be force-killed)' : ''}`)
    if (lastStage === 'download') throw new Error(tm('error.stalledDownload'))
    throw new Error(tm('error.stalledStage', { stage: tm(`stageName.${lastStage}`) }))
  }
  if (res.code !== 0) throw new Error(friendlyError(res.stderr || stderrTail.join('\n')))
  if (!outputPath) {
    // --no-overwrites on an existing file prints "has already been downloaded" and no after_move
    if (alreadyExists) {
      const m = res.stdout.match(/\[download\] (.+?) has already been downloaded/)
      return { outputPath: m?.[1] ?? '', skipped: true }
    }
    throw new Error(tm('error.noOutputReported'))
  }
  if (format.kind === 'm4r' && /\.m4a$/i.test(outputPath) && existsSync(outputPath)) {
    // yt-dlp only writes .m4a; the ringtone is the same container under the extension iOS expects.
    const plain = outputPath.replace(/ \[ringtone\]\.m4a$/i, '.m4r')
    const target = existsSync(plain) ? outputPath.replace(/\.m4a$/i, '.m4r') : plain
    renameSync(outputPath, target)
    outputPath = target
  }
  if (!existsSync(outputPath)) {
    // yt-dlp printed a path we cannot see. Recover from the destination folder before failing.
    job.onLog?.(`printed output path not found: ${outputPath}`)
    const recovered = recoverOutput(outputPath, job.destination, job.media.title, job.onLog)
    if (recovered) return { outputPath: recovered, skipped: moveBlocked }
    throw new Error(tm('error.outputMissing', { path: outputPath, folder: job.destination }))
  }
  return { outputPath, skipped: false }
}

/** Find the finished file when the printed path does not exist: same name in the destination, else the newest recent file whose name starts like the title. */
function recoverOutput(printed: string, destination: string, title: string, log?: (l: string) => void): string | null {
  const byName = join(destination, basename(printed))
  if (existsSync(byName)) {
    log?.(`output recovered by name: ${byName}`)
    return byName
  }
  try {
    const stem = title.replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 30).toLowerCase()
    const cutoff = Date.now() - 15 * 60 * 1000
    const candidates = readdirSync(destination)
      .filter((f) => !/\.(part|ytdl|temp|webp|jpg|png|vtt|srt)$/i.test(f))
      .map((f) => ({ f, path: join(destination, f), st: statSync(join(destination, f)) }))
      .filter((c) => c.st.isFile() && c.st.mtimeMs >= cutoff)
      .filter((c) => !stem || c.f.toLowerCase().startsWith(stem.slice(0, 12)))
      .sort((a, b) => b.st.mtimeMs - a.st.mtimeMs)
    log?.(`output lookup in ${destination}: ${candidates.length} recent candidate(s)${candidates[0] ? `, using ${candidates[0].f}` : ''}`)
    return candidates[0]?.path ?? null
  } catch (e) {
    log?.(`output lookup failed: ${(e as Error).message}`)
    return null
  }
}

export { userBinDir }
