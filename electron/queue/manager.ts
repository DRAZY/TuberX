import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import { basename, join } from 'node:path'
import { appendFileSync, mkdirSync, statSync, renameSync, readdirSync, rmSync } from 'node:fs'
import { app } from 'electron'
import type { DownloadProgress, MediaItem, QueueRow, RowStatus, Settings } from '../../shared/types'
import { urlKey } from '../../shared/urls'
import { TuberDb } from '../db/database'
import { download, fetchMetadata } from '../engine/ytdlp'

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

  add(urls: string[]): { added: number; duplicates: string[] } {
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
    try {
      const media: MediaItem = await fetchMetadata(row.url, this.getSettings(), { signal: ac.signal })
      const formatId = pickFormat(media, row.formatId)
      this.update(id, { media, formatId, status: 'ready' })
    } catch (e) {
      if (ac.signal.aborted) return
      this.update(id, { status: 'failed', error: (e as Error).message })
    } finally {
      this.aborters.delete(id)
    }
  }

  remove(ids: string[]) {
    for (const id of ids) this.aborters.get(id)?.abort()
    this.rows = this.rows.filter((r) => !ids.includes(r.id))
    this.db.deleteRows(ids)
    this.emitChanged()
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
      if (row.media) cleanupPartials(row.media.title)
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

  private async runDownload(row: QueueRow) {
    const settings = this.getSettings()
    const media = row.media!
    const format = media.formats.find((f) => f.id === row.formatId) ?? media.formats.find((f) => f.id === media.defaultFormatId)
    if (!format) return void this.update(row.id, { status: 'failed', error: 'no format available' })

    const force = this.redo.delete(row.id)
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
    engineLog(row.id, `--- start ${row.url} format=${format.id} force=${force} aria2=${settings.useAria2} dest=${row.destination || settings.destination}`)
    try {
      const result = await download({
        url: row.url,
        media,
        format,
        destination: row.destination || settings.destination,
        settings,
        signal: ac.signal,
        force,
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
      if (result.skipped) {
        this.update(row.id, { status: 'skipped', outputPath: result.outputPath || undefined, progress: undefined })
      } else {
        this.update(row.id, { status: 'done', outputPath: result.outputPath, progress: undefined })
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
          cleanupPartials(media.title)
          this.update(row.id, { status: 'ready', progress: undefined, error: undefined })
        }
      } else this.update(row.id, { status: 'failed', error: msg, progress: undefined })
    } finally {
      this.aborters.delete(row.id)
      this.active--
      this.pump()
    }
  }
}

/** Engine log: every yt-dlp line for every download, rotated at 5 MB. The support artifact for "it's slow". */
export function engineLogPath(): string {
  return join(app.getPath('userData'), 'logs', 'engine.log')
}
function engineLog(rowId: string, line: string) {
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
export function cleanupPartials(title: string): void {
  const tmp = join(app.getPath('userData'), 'tmp')
  const key = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 24)
  const stem = key(title)
  if (!stem) return
  try {
    for (const f of readdirSync(tmp)) {
      if (!key(f).startsWith(stem)) continue
      if (/\.(part|ytdl|aria2|temp)$/i.test(f) || /\.f\d+\.[a-z0-9]+(\.part)?$/i.test(f) || /\.(webp|jpg|png|vtt|srt)$/i.test(f)) rmSync(join(tmp, f), { force: true })
    }
  } catch {
    /* nothing to clean */
  }
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
