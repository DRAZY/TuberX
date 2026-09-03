import type { Chapter, FormatOption, MediaItem, PlaylistEntry, SubtitleTrack } from './types'
import { playlistUrlFromVideoUrl } from './urls'

/** Loose shape of `yt-dlp --dump-single-json` — we only type what we read. */
export interface YtDlpJson {
  _type?: string
  id?: string
  title?: string
  webpage_url?: string
  original_url?: string
  uploader?: string
  channel?: string
  artist?: string
  duration?: number
  thumbnail?: string
  thumbnails?: { url: string; width?: number; height?: number; preference?: number }[]
  extractor?: string
  extractor_key?: string
  formats?: YtDlpFormat[]
  subtitles?: Record<string, { ext: string; name?: string }[]>
  automatic_captions?: Record<string, { ext: string; name?: string }[]>
  chapters?: { title?: string; start_time: number; end_time: number }[]
  entries?: YtDlpJson[]
  playlist?: string
  playlist_id?: string
  playlist_title?: string
  url?: string
  ie_key?: string
  availability?: string
}

export interface YtDlpFormat {
  format_id: string
  ext?: string
  vcodec?: string
  acodec?: string
  height?: number
  width?: number
  fps?: number
  abr?: number
  tbr?: number
  filesize?: number
  filesize_approx?: number
  protocol?: string
  format_note?: string
}

const STANDARD_HEIGHTS = [4320, 2160, 1440, 1080, 720, 480, 360, 240, 144]

export function heightLabel(h: number): string {
  if (h >= 4320) return '8K'
  if (h >= 2160) return '4K'
  if (h >= 1440) return '1440p'
  return `${h}p`
}

/** Snap odd heights (e.g. 1076) to the nearest standard rung so the dropdown stays tidy. */
export function snapHeight(h: number): number {
  let best = STANDARD_HEIGHTS[STANDARD_HEIGHTS.length - 1]
  let bestDiff = Infinity
  for (const s of STANDARD_HEIGHTS) {
    const d = Math.abs(s - h)
    if (d < bestDiff) {
      best = s
      bestDiff = d
    }
  }
  return best
}

export function buildFormatOptions(formats: YtDlpFormat[] | undefined, hasVideo: boolean): FormatOption[] {
  const out: FormatOption[] = []
  const byHeight = new Map<number, { fps: number; size?: number }>()
  for (const f of formats ?? []) {
    if (!f.height || !f.vcodec || f.vcodec === 'none') continue
    if (f.protocol && /m3u8|dash/.test(f.protocol) && f.filesize === undefined && f.filesize_approx === undefined) {
      // still counts for resolution discovery
    }
    const h = snapHeight(f.height)
    const prev = byHeight.get(h)
    const fps = f.fps ?? 30
    const size = f.filesize ?? f.filesize_approx
    if (!prev || fps > prev.fps) byHeight.set(h, { fps, size })
  }

  if (hasVideo) {
    const heights = [...byHeight.keys()].sort((a, b) => b - a)
    const top = heights[0]
    out.push({
      id: 'v:best',
      kind: 'video',
      label: top ? `Best · ${heightLabel(top)}${(byHeight.get(top)?.fps ?? 30) > 30 ? ` ${Math.round(byHeight.get(top)!.fps)}fps` : ''} MP4` : 'Best video (MP4)',
      height: top,
      fps: top ? byHeight.get(top)?.fps : undefined,
      filesize: top ? byHeight.get(top)?.size : undefined,
      selector: 'bv*+ba/b',
      sort: 'res',
    })
    for (const h of heights) {
      const meta = byHeight.get(h)!
      out.push({
        id: `v:${h}`,
        kind: 'video',
        label: `${heightLabel(h)}${meta.fps > 30 ? ` ${Math.round(meta.fps)}fps` : ''} MP4`,
        height: h,
        fps: meta.fps,
        filesize: meta.size,
        selector: 'bv*+ba/b',
        sort: `res:${h}`,
      })
    }
    out.push({ id: 'vo:best', kind: 'video-only', label: 'Video only (no audio)', selector: 'bv*', sort: 'res' })
  }

  const audioFormats = (formats ?? []).filter((f) => f.acodec && f.acodec !== 'none')
  const bestAbr = audioFormats.reduce((m, f) => Math.max(m, f.abr ?? f.tbr ?? 0), 0)
  out.push({ id: 'a:mp3', kind: 'mp3', label: 'MP3 audio', abr: bestAbr || undefined, selector: 'ba/b' })
  out.push({ id: 'a:m4a', kind: 'm4a', label: 'M4A audio (original)', abr: bestAbr || undefined, selector: 'ba[ext=m4a]/ba/b' })
  return out
}

function pickThumbnail(j: YtDlpJson): string | undefined {
  if (j.thumbnail) return j.thumbnail
  const t = j.thumbnails ?? []
  if (!t.length) return undefined
  // prefer a mid-size image (rows are small); yt-dlp orders by preference ascending
  const sorted = [...t].sort((a, b) => (b.width ?? 0) - (a.width ?? 0))
  return (sorted.find((x) => (x.width ?? 0) <= 640) ?? sorted[sorted.length - 1]).url
}

function subtitleTracks(j: YtDlpJson): SubtitleTrack[] {
  const out: SubtitleTrack[] = []
  for (const [lang, tracks] of Object.entries(j.subtitles ?? {})) {
    if (lang === 'live_chat') continue
    out.push({ lang, name: tracks?.[0]?.name, auto: false })
  }
  for (const [lang, tracks] of Object.entries(j.automatic_captions ?? {})) {
    if (out.some((s) => s.lang === lang)) continue
    out.push({ lang, name: tracks?.[0]?.name, auto: true })
  }
  return out
}

function chapters(j: YtDlpJson): Chapter[] {
  return (j.chapters ?? []).map((c, i) => ({
    title: c.title ?? `Chapter ${i + 1}`,
    start: c.start_time,
    end: c.end_time,
  }))
}

function entryUrl(e: YtDlpJson): string {
  if (e.webpage_url) return e.webpage_url
  if (e.url && /^https?:/.test(e.url)) return e.url
  if ((e.ie_key === 'Youtube' || e.extractor === 'youtube') && e.id) return `https://www.youtube.com/watch?v=${e.id}`
  return e.url ?? ''
}

export function normalizeMedia(json: YtDlpJson, requestedUrl: string): MediaItem {
  const isPlaylist = json._type === 'playlist' || (Array.isArray(json.entries) && json.entries.length > 0)
  const formats = isPlaylist ? [] : json.formats ?? []
  const hasVideo = formats.some((f) => f.vcodec && f.vcodec !== 'none' && f.height)
  const options = isPlaylist ? [] : buildFormatOptions(formats, hasVideo)
  const entries: PlaylistEntry[] | undefined = isPlaylist
    ? (json.entries ?? [])
        .filter((e): e is YtDlpJson => !!e)
        .map((e) => ({
          id: e.id ?? entryUrl(e),
          url: entryUrl(e),
          title: e.title ?? '(untitled)',
          duration: e.duration,
          thumbnail: pickThumbnail(e),
          uploader: e.uploader ?? e.channel,
        }))
        .filter((e) => !!e.url)
    : undefined

  const defaultFormatId = hasVideo ? 'v:best' : options.find((o) => o.kind === 'm4a')?.id ?? 'a:mp3'
  return {
    id: json.id ?? requestedUrl,
    url: requestedUrl,
    webpageUrl: json.webpage_url ?? json.original_url ?? requestedUrl,
    title: json.title ?? (isPlaylist ? json.playlist_title ?? 'Playlist' : '(untitled)'),
    uploader: json.uploader ?? json.channel ?? json.artist,
    duration: json.duration,
    thumbnail: pickThumbnail(json),
    extractor: json.extractor_key ?? json.extractor ?? 'generic',
    isPlaylist,
    playlistUrl: isPlaylist ? undefined : playlistUrlFromVideoUrl(requestedUrl) ?? undefined,
    playlistTitle: json.playlist_title ?? json.playlist,
    entries,
    formats: options,
    subtitles: isPlaylist ? [] : subtitleTracks(json),
    chapters: isPlaylist ? [] : chapters(json),
    defaultFormatId,
    requiresLogin: json.availability === 'needs_auth' || json.availability === 'subscriber_only',
  }
}

export function formatDuration(sec?: number): string {
  if (sec === undefined || !Number.isFinite(sec)) return ''
  const s = Math.round(sec)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`
}

export function formatBytes(b?: number): string {
  if (!b) return ''
  const units = ['B', 'KB', 'MB', 'GB']
  let i = 0
  let v = b
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(i >= 2 ? 1 : 0)} ${units[i]}`
}
