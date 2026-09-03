/**
 * Shared contract between the Electron main process and the Vue renderer.
 * The renderer never sees yt-dlp or ffmpeg directly; it only sees these types.
 */

export type OutputKind = 'video' | 'video-only' | 'mp3' | 'm4a' | 'wav' | 'm4r'

export interface FormatOption {
  /** Stable id used to select this option, e.g. "v:1080", "a:mp3" */
  id: string
  kind: OutputKind
  label: string
  /** Video height when kind is video/video-only */
  height?: number
  fps?: number
  /** Audio bitrate in kbps when known */
  abr?: number
  /** Approximate size in bytes when yt-dlp reports it */
  filesize?: number
  /** The yt-dlp format selector this option maps to */
  selector: string
  /** yt-dlp -S sort string; codec preference is appended at download time */
  sort?: string
}

export interface SubtitleTrack {
  lang: string
  name?: string
  auto: boolean
}

export interface Chapter {
  title: string
  start: number
  end: number
}

export interface PlaylistEntry {
  id: string
  url: string
  title: string
  duration?: number
  thumbnail?: string
  uploader?: string
}

export interface MediaItem {
  id: string
  url: string
  webpageUrl: string
  title: string
  uploader?: string
  duration?: number
  thumbnail?: string
  extractor: string
  isPlaylist: boolean
  /** When the URL is a single video that belongs to a playlist */
  playlistUrl?: string
  playlistTitle?: string
  entries?: PlaylistEntry[]
  formats: FormatOption[]
  subtitles: SubtitleTrack[]
  chapters: Chapter[]
  /** Best-guess default option id */
  defaultFormatId: string
  /** Extractor said the content needs login/cookies */
  requiresLogin?: boolean
  /** Extra yt-dlp args the download must repeat (e.g. a referer for an embed fallback) */
  extraArgs?: string[]
  /** Raw yt-dlp info JSON saved at fetch time; lets a download start without extracting again */
  infoJsonPath?: string
  fetchedAt?: number
}

export type RowStatus =
  | 'fetching'
  | 'ready'
  | 'queued'
  | 'downloading'
  | 'converting'
  | 'done'
  | 'failed'
  | 'cancelled'
  | 'paused'
  | 'skipped'

export interface QueueRow {
  id: string
  url: string
  addedAt: number
  status: RowStatus
  media?: MediaItem
  formatId?: string
  destination: string
  progress?: DownloadProgress
  outputPath?: string
  error?: string
  /** Every format this row has produced → the name tag it was saved under ('' = plain name). A repeat refreshes its own file. */
  downloadedVariants?: Record<string, string>
}

export interface DownloadProgress {
  percent: number
  downloadedBytes?: number
  totalBytes?: number
  /** bytes per second */
  speed?: number
  /** seconds */
  eta?: number
  /** download, then the post-processing passes in the order yt-dlp runs them */
  stage: 'download' | 'merge' | 'convert' | 'subs' | 'tag' | 'cover' | 'move'
  /** Which downloader yt-dlp is actually using, once the log reveals it */
  downloader?: 'native' | 'aria2c'
  /** Multi-file downloads (video + audio): which file is in flight */
  part?: { index: number; count: number }
}

export interface HistoryEntry {
  id: string
  url: string
  title: string
  formatId: string
  outputPath: string
  thumbnail?: string
  completedAt: number
}

export interface LaterEntry {
  id: string
  url: string
  title?: string
  thumbnail?: string
  duration?: number
  addedAt: number
}

export interface ToolStatus {
  name: 'yt-dlp' | 'ffmpeg' | 'aria2c' | 'deno' | 'pot-helper'
  path: string
  version?: string
  ok: boolean
  error?: string
}

export interface Settings {
  destination: string
  destinations: string[]
  defaultFormatId: string
  applyDefaultToNew: boolean
  convertNonMp4: boolean
  mp3Bitrate: 128 | 192 | 256 | 320
  saveThumbnail: boolean
  thumbnailFormat: 'jpg' | 'png'
  embedSubtitles: boolean
  writeSubtitleFiles: boolean
  subtitleLangs: string[]
  skipIfExists: boolean
  /** Re-downloading in a different format: keep both files (quality added to the name) or replace the file */
  onConflict: 'keep-both' | 'replace'
  proxy: string
  proxyEnabled: boolean
  cookiesFromBrowser: '' | 'chrome' | 'edge' | 'firefox' | 'brave'
  /** Path to an imported Netscape cookies.txt (copied into app data); empty = none */
  cookiesFile: string
  /** Talk to sites over IPv4 only. YouTube bot-checks many residential IPv6 ranges; the reference macOS downloader forces IPv4 too. */
  forceIpv4: boolean
  /** Run the bundled bgutil PO-token helper for YouTube (avoids "Sign in to confirm you're not a bot") */
  potHelper: boolean
  useAria2: boolean
  concurrentDownloads: 1 | 2 | 3 | 4 | 5 | 6 | 8
  notifyOnComplete: boolean
  autoUpdateEngine: boolean
  /** Bumped when a default changes in a way existing installs should adopt. */
  settingsVersion: number
}

export const DEFAULT_SETTINGS: Settings = {
  destination: '',
  destinations: [],
  defaultFormatId: 'v:best',
  applyDefaultToNew: false,
  convertNonMp4: true,
  mp3Bitrate: 320,
  saveThumbnail: false,
  thumbnailFormat: 'jpg',
  embedSubtitles: true,
  writeSubtitleFiles: false,
  subtitleLangs: ['en'],
  skipIfExists: true,
  onConflict: 'keep-both',
  proxy: '',
  proxyEnabled: false,
  cookiesFromBrowser: '',
  cookiesFile: '',
  forceIpv4: true,
  potHelper: true,
  useAria2: true,
  concurrentDownloads: 3,
  notifyOnComplete: true,
  autoUpdateEngine: true,
  settingsVersion: 6,
}

/** Events the main process pushes to the renderer. */
export type ToastKind = 'info' | 'success' | 'warn' | 'error'

export interface MainEvents {
  'queue:changed': QueueRow[]
  'later:changed': LaterEntry[]
  'history:changed': HistoryEntry[]
  'row:progress': { id: string; progress: DownloadProgress }
  'tools:status': ToolStatus[]
  'engine:updated': { from?: string; to: string }
  'url:incoming': { url: string; later: boolean }
  'ui:selectAll': null
  'ui:about': null
  'toast': { kind: ToastKind; message: string }
}

/** What the About section shows: the build the user is running and where it comes from. */
export interface AppInfo {
  name: string
  version: string
  platform: string
  arch: string
  electron: string
  chrome: string
  homepage: string
  releases: string
  issues: string
  licenses: string
}

/** The bridge the preload exposes as window.tuberx. */
export interface TuberXApi {
  addUrls(urls: string[]): Promise<{ added: number; duplicates: string[] }>
  removeRows(ids: string[]): Promise<void>
  setFormat(id: string, formatId: string): Promise<void>
  setFormatAll(formatId: string): Promise<void>
  startDownload(ids: string[]): Promise<void>
  /** Stop: kill the transfer, discard partial files, return the row to Ready with the format picker live. */
  cancelDownload(id: string): Promise<void>
  /** Pause: kill the transfer but keep partial files and progress; Resume continues them. */
  pauseDownload(id: string): Promise<void>
  resumeDownload(id: string): Promise<void>
  retry(id: string): Promise<void>
  getQueue(): Promise<QueueRow[]>
  expandPlaylist(rowId: string, entryUrls: string[]): Promise<void>
  /** Read the OS clipboard in the main process and add every URL found. */
  pasteClipboard(download?: boolean): Promise<{ found: number; added: number }>
  /** Show the native right-click menu for the empty area or a row. */
  contextMenu(kind: 'app' | 'row' | 'edit', rowId?: string): Promise<void>

  later: {
    list(): Promise<LaterEntry[]>
    add(urls: string[]): Promise<number>
    remove(ids: string[]): Promise<void>
    sendToQueue(ids: string[]): Promise<void>
  }
  history: {
    list(): Promise<HistoryEntry[]>
    remove(ids: string[]): Promise<void>
    clear(): Promise<void>
  }
  settings: {
    get(): Promise<Settings>
    set(patch: Partial<Settings>): Promise<Settings>
    pickDestination(): Promise<string | null>
    pickCookiesFile(): Promise<string | null>
    clearCookiesFile(): Promise<void>
  }
  tools: {
    status(): Promise<ToolStatus[]>
    updateEngine(): Promise<{ updated: boolean; version: string }>
  }
  app: {
    info(): Promise<AppInfo>
  }
  shell: {
    reveal(path: string): Promise<void>
    openExternal(url: string): Promise<void>
    /** Reveal the folder holding engine.log, the first thing to send with a problem report. */
    openLogs(): Promise<void>
  }
  on<K extends keyof MainEvents>(event: K, handler: (payload: MainEvents[K]) => void): () => void
}
