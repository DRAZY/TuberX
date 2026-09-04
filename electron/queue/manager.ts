import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import { basename, extname, join } from 'node:path'
import { appendFileSync, existsSync, mkdirSync, statSync, renameSync, readdirSync, rmSync } from 'node:fs'
import { app } from 'electron'
import type { DownloadProgress, FormatOption, MediaItem, QueueRow, RowStatus, Settings } from '../../shared/types'
import { urlKey } from '../../shared/urls'
import { TuberDb } from '../db/database'
import { download, dropLocalTemp, fetchMetadata } from '../engine/ytdlp'
import { convertVideo } from '../engine/transcode'
import { updateEngine } from '../engine/updater'
import { tm } from '../i18n'

export interface QueueEvents {
  changed: (rows: QueueRow[]) => void
  progress: (id: string, progress: DownloadProgress) => void
  completed: (row: QueueRow) => void
  toast: (kind: 'info' | 'success' | 'warn' | 'error', message: string) => void
}

/**
 * Owns the in-memory queue, persists it, fetches metadata, and runs downloads
 * with bounded concurrency. Everything the renderer sees flows through `changed`.
 */
export class QueueManager extends EventEmitter {
  private rows: QueueRow[] = []
  private aborters = new Map<string, AbortController>()
  /** Rows whose abort means "pause" (keep partials) rather than "stop" (discard them). */
  private pausing = new Set<string>()
  /** Rows the user explicitly asked to download again: skip the "already in history" shortcut once. */
  private redo = new Set<string>()
  private lastHeal = 0
  /**
   * An extractor failure usually means the site changed and yt-dlp already ships the fix. Update the
   * engine right away (at most once an hour) and tell the caller to retry once. Errors that an update
   * cannot fix (private, removed, geo-blocked, login) never trigger it.
   */
  private async selfHeal(message: string, rowId: string): Promise<boolean> {
    if (!this.getSettings().autoUpdateEngine) return false
    if (/404|410|Not Found|Gone|private|removed|unavailable/i.test(message)) return false // nothing an update fixes
    if (!/Unable to extract|Unsupported URL|nsig|signature|failed to parse|Precondition check failed|Requested format is not available|JSON metadata|Unable to download (webpage|API page)|HTTP Error 4(00|10)|Incomplete data received/i.test(message)) return false
    if (Date.now() - this.lastHeal < 60 * 60 * 1000) return false
    this.lastHeal = Date.now()
    engineLog(rowId, 'self-heal: extractor error, checking for a newer yt-dlp before giving up')
    try {
      const r = await updateEngine((m) => engineLog(rowId, `self-heal: ${m}`))
      if (r.updated) {
        this.emit('engineUpdated', r.version)
        return true
      }
      engineLog(rowId, `self-heal: yt-dlp ${r.version} is already current`)
    } catch (e) {
      engineLog(rowId, `self-heal: update failed: ${(e as Error).message}`)
    }
    return false
  }

  /** Rows to start the moment their metadata resolves (paste-and-download, clipboard strip). */
  private autoStart = new Set<string>()
  private active = 0
  private getSettings: () => Settings

  constructor(private db: TuberDb, getSettings: () => Settings) {
    super()
    this.getSettings = getSettings
    this.rows = db.loadQueue()
    // Rows that never finished fetching get fetched again.
    for (const r of this.rows) if (r.status === 'fetching' || (r.status === 'ready' && !r.media)) void this.fetch(r.id)
  }

  list(): QueueRow[] {
    return this.rows.map((r) => ({ ...r }))
  }

  private persist(row: QueueRow) {
    this.db.saveRow(row, this.rows.indexOf(row))
  }

  private emitChanged() {
    this.emit('changed', this.list())
  }

  private update(id: string, patch: Partial<QueueRow>): QueueRow | undefined {
    const row = this.rows.find((r) => r.id === id)
    if (!row) return
    Object.assign(row, patch)
    this.persist(row)
    this.emitChanged()
    return row
  }

  private keys(): Set<string> {
    return new Set(this.rows.map((r) => urlKey(r.url)))
  }

  add(urls: string[], download = false): { added: number; duplicates: string[] } {
    const settings = this.getSettings()
    const existing = this.keys()
    const duplicates: string[] = []
    let added = 0
    for (const url of urls) {
      const key = urlKey(url)
      if (existing.has(key)) {
        duplicates.push(url)
        continue
      }
      existing.add(key)
      const row: QueueRow = {
        id: randomUUID(),
        url,
        addedAt: Date.now(),
        status: 'fetching',
        destination: settings.destination,
        formatId: settings.applyDefaultToNew ? settings.defaultFormatId : undefined,
      }
      this.rows.push(row)
      this.persist(row)
      added++
      if (download) this.autoStart.add(row.id)
      void this.fetch(row.id)
    }
    this.emitChanged()
    return { added, duplicates }
  }

  /** Replace a playlist row with rows for the chosen entries. */
  expandPlaylist(rowId: string, entryUrls: string[]) {
    const idx = this.rows.findIndex((r) => r.id === rowId)
    if (idx === -1) return
    const settings = this.getSettings()
    const existing = this.keys()
    const fresh: QueueRow[] = []
    for (const url of entryUrls) {
      const key = urlKey(url)
      if (existing.has(key)) continue
      existing.add(key)
      fresh.push({
        id: randomUUID(),
        url,
        addedAt: Date.now(),
        status: 'fetching',
        destination: settings.destination,
        formatId: settings.applyDefaultToNew ? settings.defaultFormatId : undefined,
      })
    }
    this.db.deleteRows([rowId])
    this.rows.splice(idx, 1, ...fresh)
    this.rows.forEach((r, i) => this.db.saveRow(r, i))
    this.emitChanged()
    for (const r of fresh) void this.fetch(r.id)
  }

  private async fetch(id: string) {
    const row = this.rows.find((r) => r.id === id)
    if (!row) return
    const ac = new AbortController()
    this.aborters.set(id, ac)
    this.update(id, { status: 'fetching', error: undefined })
    let retry = false
    try {
      const media: MediaItem = await fetchMetadata(row.url, this.getSettings(), { signal: ac.signal })
      const formatId = pickFormat(media, row.formatId)
      this.update(id, { media, formatId, status: 'ready' })
      if (this.autoStart.delete(id) && !media.isPlaylist) this.start([id])
    } catch (e) {
      if (ac.signal.aborted) return
      const msg = (e as Error).message
      if (await this.selfHeal(msg, id)) retry = true
      else this.update(id, { status: 'failed', error: msg })
    } finally {
      this.aborters.delete(id)
    }
    if (retry) await this.fetch(id)
  }

  remove(ids: string[]) {
    for (const id of ids) this.aborters.get(id)?.abort()
    this.rows = this.rows.filter((r) => !ids.includes(r.id))
    this.db.deleteRows(ids)
    this.emitChanged()
  }

  /** Put the rows in the given order (ids not listed keep their relative order at the end); order is download order. */
  reorder(ids: string[]) {
    const wanted = new Map(ids.map((id, i) => [id, i]))
    const listed = this.rows.filter((r) => wanted.has(r.id)).sort((a, b) => wanted.get(a.id)! - wanted.get(b.id)!)
    const rest = this.rows.filter((r) => !wanted.has(r.id))
    this.rows = [...listed, ...rest]
    for (const r of this.rows) this.persist(r)
    this.emitChanged()
  }

  /** A finished file was renamed outside the engine (Rename dialog). */
  setOutputPath(id: string, outputPath: string) {
    this.update(id, { outputPath })
  }

  setFormat(id: string, formatId: string) {
    this.update(id, { formatId })
  }

  setFormatAll(formatId: string) {
    for (const r of this.rows) {
      if (!r.media || r.status === 'downloading' || r.status === 'converting') continue
      r.formatId = pickFormat(r.media, formatId)
      this.persist(r)
    }
    this.emitChanged()
  }

  start(ids: string[]) {
    for (const id of ids) {
      const row = this.rows.find((r) => r.id === id)
      if (!row || !row.media || row.media.isPlaylist) continue
      if (!['ready', 'failed', 'cancelled', 'paused', 'skipped', 'done'].includes(row.status)) continue
      if (row.status === 'done' || row.status === 'skipped' || row.status === 'paused') this.redo.add(id)
      this.update(id, { status: 'queued', error: undefined, progress: row.status === 'paused' ? row.progress : undefined })
    }
    this.pump()
  }

  retry(id: string) {
    const row = this.rows.find((r) => r.id === id)
    if (!row) return
    if (!row.media) return void this.fetch(id)
    this.start([id])
  }

  /** Stop: abort, drop partial files, back to Ready so a different format can be chosen. */
  cancel(id: string) {
    const row = this.rows.find((r) => r.id === id)
    if (!row) return
    this.pausing.delete(id)
    const active = this.aborters.get(id)
    if (active) active.abort() // runDownload's catch finishes the reset
    else if (row.status === 'queued' || row.status === 'paused' || row.status === 'cancelled') {
      if (row.media) cleanupPartials(row.media.title, row.destination || this.getSettings().destination)
      this.update(id, { status: 'ready', progress: undefined, error: undefined })
    }
  }

  /** Pause: abort but keep partial files; yt-dlp/aria2c continue them on resume. */
  pause(id: string) {
    const row = this.rows.find((r) => r.id === id)
    if (!row) return
    if (row.status === 'queued') return void this.update(id, { status: 'paused' })
    // Only a transfer can be paused; ffmpeg stages are short and cannot be resumed mid-way.
    if (row.status !== 'downloading' || row.progress?.stage !== 'download') return
    this.pausing.add(id)
    this.aborters.get(id)?.abort()
  }

  resume(id: string) {
    this.start([id])
  }

  cancelAll() {
    for (const r of this.rows) this.cancel(r.id)
  }

  private pump() {
    const limit = this.getSettings().concurrentDownloads
    while (this.active < limit) {
      const next = this.rows.find((r) => r.status === 'queued')
      if (!next) break
      void this.runDownload(next)
    }
  }

  /**
   * How a download is named and whether it may replace anything. The rule: a file the user already has
   * is never replaced by a different format. Overwriting is granted only for "Download again" of a
   * format that provably produced the file at that name; everything else lands beside what exists.
   * A new video quality on a row with a video file on disk gets the quality in its name (keep-both,
   * the default) or overwrites on Download again (replace). Audio formats never collide with video:
   * their extensions differ, and an existing file with the same audio extension is that same format.
   * Files from older versions, before the per-row ledger existed, are found through history and the
   * row's last output. When nothing is on record and a same-named video file still turns up, yt-dlp
   * leaves it alone and runDownload retries with the quality tag.
   */
  private namePlan(row: QueueRow, format: FormatOption, variants: Record<string, string>, collides: boolean, force: boolean, settings: Settings): NamePlan {
    if (format.id in variants) return { nameTag: variants[format.id] || undefined, overwrite: force } // its own file: refresh on Download again
    if (!collides) return { overwrite: force }
    if (settings.onConflict !== 'keep-both') return { overwrite: force }
    const onDisk = this.existingVideoFiles(row)
    const own = onDisk.find((f) => f.formatId === format.id)
    if (own) return { nameTag: recognizedTag(own.path), overwrite: force }
    if (onDisk.length || Object.keys(variants).some(isVideoFormatId)) return { nameTag: qualityTag(format), overwrite: false }
    return { overwrite: false }
  }

  /** Video files this link has produced that are still on disk, with the format that made each when known. */
  private existingVideoFiles(row: QueueRow): { formatId?: string; path: string }[] {
    const out: { formatId?: string; path: string }[] = []
    const consider = (path: string | undefined, formatId?: string) => {
      if (!path || out.some((f) => f.path === path) || !isVideoFile(path) || !existsSync(path)) return
      out.push({ path, formatId })
    }
    for (const h of this.db.historyFor(urlKey(row.url))) consider(h.outputPath, h.formatId)
    consider(row.outputPath) // the row's format may have been changed since, so its maker is unknown
    // Nothing on record (history cleared, files from another machine): a video file in the destination
    // whose name is this title, with or without a quality tag, still counts. A look-alike only costs a tag.
    const dest = row.destination || this.getSettings().destination
    const want = looseName(row.media?.title ?? '')
    if (want) {
      for (const f of safeReaddir(dest)) {
        const stem = basename(f, extname(f)).replace(/ \[[^\]]+\]$/, '')
        if (looseName(stem) === want) consider(join(dest, f))
      }
    }
    return out
  }

  private async runDownload(row: QueueRow) {
    const settings = this.getSettings()
    const media = row.media!
    const format = media.formats.find((f) => f.id === row.formatId) ?? media.formats.find((f) => f.id === media.defaultFormatId)
    if (!format) return void this.update(row.id, { status: 'failed', error: tm('error.noFormat') })

    const force = this.redo.delete(row.id)
    const variants = { ...(row.downloadedVariants ?? {}) }
    const collides = format.kind === 'video' || format.kind === 'video-only'
    let plan = this.namePlan(row, format, variants, collides, force, settings)
    if (settings.skipIfExists && !force && this.db.historyHas(urlKey(row.url))) {
      this.update(row.id, { status: 'skipped', error: undefined })
      return this.pump()
    }

    this.active++
    const ac = new AbortController()
    this.aborters.set(row.id, ac)
    // A resumed row keeps its bar where it paused until the engine reports fresh numbers.
    const seed = row.progress?.stage === 'download' && row.progress.percent > 0 ? { ...row.progress, speed: undefined, eta: undefined } : { stage: 'download' as const, percent: 0 }
    this.update(row.id, { status: 'downloading', progress: seed })
    engineLog(row.id, `--- start ${row.url} format=${format.id} force=${force} nameTag=${plan.nameTag ?? '-'} overwrite=${plan.overwrite} aria2=${settings.useAria2} dest=${row.destination || settings.destination}`)
    try {
      const run = (p: NamePlan) => download({
        url: row.url,
        media,
        format,
        destination: row.destination || settings.destination,
        settings,
        signal: ac.signal,
        overwrite: p.overwrite,
        nameTag: p.nameTag,
        onLog: (line) => engineLog(row.id, line),
        onProgress: (p) => {
          const r = this.rows.find((x) => x.id === row.id)
          if (process.env.TUBERX_DEBUG) engineLog(row.id, `onProgress row=${r ? 'found' : 'MISSING'} pct=${p.percent}`)
          if (!r) return
          r.progress = p
          const status: RowStatus = p.stage === 'download' ? 'downloading' : 'converting'
          if (r.status !== status) {
            r.status = status
            this.emitChanged()
          }
          this.emit('progress', row.id, p)
        },
      })
      let result = await run(plan)
      if (result.skipped && collides && !plan.overwrite && !plan.nameTag && settings.onConflict === 'keep-both') {
        // A same-named video file exists that nothing on record produced. It stays; this quality goes beside it.
        plan = { nameTag: qualityTag(format), overwrite: false }
        engineLog(row.id, `--- retry nameTag=${plan.nameTag}: kept existing ${result.outputPath || 'same-named file'}`)
        result = await run(plan)
      }
      if (!result.skipped && settings.videoCodec !== 'auto' && (format.kind === 'video' || format.kind === 'video-only')) {
        // Forced codec: sources that arrived in anything else are re-encoded in place, with progress.
        const used = await convertVideo(result.outputPath, settings.videoCodec, {
          signal: ac.signal,
          onLog: (line) => engineLog(row.id, line),
          onProgress: (percent) => {
            const r = this.rows.find((x) => x.id === row.id)
            if (!r) return
            r.progress = { stage: 'convert', percent }
            if (r.status !== 'converting') {
              r.status = 'converting'
              this.emitChanged()
            }
            this.emit('progress', row.id, r.progress)
          },
        })
        engineLog(row.id, used ? `converted to ${settings.videoCodec} with ${used}` : `already ${settings.videoCodec}; no conversion needed`)
      }
      if (result.skipped) {
        this.update(row.id, { status: 'skipped', outputPath: result.outputPath || undefined, progress: undefined })
      } else {
        // the plain name now holds this format; any other format that used the plain name was overwritten
        if (!plan.nameTag) for (const id of Object.keys(variants)) if (variants[id] === '' && id !== format.id && (collides === (id.startsWith('v')))) delete variants[id]
        variants[format.id] = plan.nameTag ?? ''
        dropLocalTemp(row.destination || settings.destination)
        this.update(row.id, { status: 'done', outputPath: result.outputPath, progress: undefined, downloadedVariants: variants })
        this.db.addHistory(
          {
            id: randomUUID(),
            url: row.url,
            title: media.title || basename(result.outputPath),
            formatId: format.id,
            outputPath: result.outputPath,
            thumbnail: media.thumbnail,
            completedAt: Date.now(),
          },
          urlKey(row.url),
        )
        this.db.touchDestination(row.destination || settings.destination)
        this.emit('completed', { ...row })
      }
    } catch (e) {
      const msg = (e as Error).message
      if (ac.signal.aborted || msg === 'cancelled') {
        if (this.pausing.delete(row.id)) {
          this.update(row.id, { status: 'paused', error: undefined }) // progress kept for the bar
        } else {
          cleanupPartials(media.title, row.destination || settings.destination)
          this.update(row.id, { status: 'ready', progress: undefined, error: undefined })
        }
      } else if (await this.selfHeal(msg, row.id)) {
        this.update(row.id, { status: 'queued', error: undefined, progress: undefined }) // the engine changed underneath; one more go
      } else this.update(row.id, { status: 'failed', error: msg, progress: undefined })
    } finally {
      this.aborters.delete(row.id)
      this.active--
      this.pump()
      // Nothing running and nothing waiting: the queue has drained. Carries the row that finished it.
      if (this.active === 0 && !this.rows.some((r) => r.status === 'queued')) this.emit('idle', { ...row })
    }
  }
}

/** Engine log: every yt-dlp line for every download, rotated at 5 MB. The support artifact for "it's slow". */
export function engineLogPath(): string {
  return join(app.getPath('userData'), 'logs', 'engine.log')
}
export function engineLog(rowId: string, line: string) {
  try {
    const file = engineLogPath()
    mkdirSync(join(file, '..'), { recursive: true })
    try {
      if (statSync(file).size > 5 * 1024 * 1024) renameSync(file, file + '.1')
    } catch {
      /* no file yet */
    }
    appendFileSync(file, `${new Date().toISOString()} [${rowId.slice(0, 8)}] ${line}\n`)
  } catch {
    /* logging never breaks a download */
  }
}

/** Remove the temp-dir leftovers of a stopped download (.part/.ytdl/.aria2 and per-format intermediates). */
export function cleanupPartials(title: string, destination?: string): void {
  const key = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 24)
  const stem = key(title)
  if (!stem) return
  const dirs = [join(app.getPath('userData'), 'tmp')]
  if (destination) dirs.push(join(destination, '.tuberx-tmp'))
  for (const tmp of dirs) sweep(tmp)
  if (destination) dropLocalTemp(destination)
  function sweep(tmp: string) {
  try {
    for (const f of readdirSync(tmp)) {
      if (!key(f).startsWith(stem)) continue
      if (/\.(part|ytdl|aria2|temp)$/i.test(f) || /\.f\d+\.[a-z0-9]+(\.part)?$/i.test(f) || /\.(webp|jpg|png|vtt|srt)$/i.test(f)) rmSync(join(tmp, f), { force: true })
    }
  } catch {
    /* nothing to clean */
  }
  }
}

/** "1080p", "4K", "MP3", "WAV", "video only": the suffix added to a keep-both re-download. */
export function qualityTag(format: FormatOption): string {
  switch (format.kind) {
    case 'video':
      return format.height ? (format.height >= 2160 ? '4K' : `${format.height}p`) : 'best'
    case 'video-only':
      return format.height ? `${format.height}p video only` : 'video only'
    case 'subs':
      return 'SRT'
    default:
      return format.kind.toUpperCase()
  }
}

type NamePlan = { nameTag?: string; overwrite: boolean }
/** Letters and digits only, lower-cased: equal for a title and the file name yt-dlp sanitised from it. */
const looseName = (s: string) => s.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '').slice(0, 80)
const safeReaddir = (dir: string): string[] => {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}
const isVideoFormatId = (id: string) => id.startsWith('v')
const isVideoFile = (path: string) => /^\.(mp4|mkv|webm|mov|m4v|avi|flv|ts|3gp)$/i.test(extname(path))
/** The quality suffix a keep-both download gave a file, if its name carries one. */
function recognizedTag(path: string): string | undefined {
  const stem = basename(path, extname(path))
  return / \[(\d+p(?: video only)?|4K(?: video only)?|best|video only|MP3|M4A|WAV|M4R)\]$/.exec(stem)?.[1]
}

/** Keep the requested format when the media offers it, else fall back sensibly. */
export function pickFormat(media: MediaItem, wanted?: string): string {
  if (!media.formats.length) return media.defaultFormatId
  if (wanted && media.formats.some((f) => f.id === wanted)) return wanted
  if (wanted?.startsWith('v:')) {
    // requested rung not present: nearest lower rung, else best
    const h = Number(wanted.slice(2))
    const candidates = media.formats.filter((f) => f.kind === 'video' && f.height && f.height <= h)
    if (candidates.length) return candidates[0].id
    if (media.formats.some((f) => f.kind === 'video')) return 'v:best'
  }
  if (wanted?.startsWith('a:') && media.formats.some((f) => f.id === wanted)) return wanted
  return media.defaultFormatId
}
