/**
 * Shared contract between the Electron main process and the Vue renderer.
 * The renderer never sees yt-dlp or ffmpeg directly; it only sees these types.
 */

export type OutputKind = 'video' | 'video-only' | 'mp3' | 'm4a' | 'wav' | 'm4r' | 'subs'

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
  /** auto: prefer H.264 sources and remux; h264 / h265: re-encode anything else with the best encoder on the machine. */
  videoCodec: 'auto' | 'h264' | 'h265'
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
  /** What happens once the last download in the queue finishes. */
  onQueueDone: 'none' | 'open-folder' | 'sleep' | 'shutdown'
  /** Site login (Vimeo, Dailymotion, Bandcamp, …; YouTube refuses password logins and is skipped). The password lives in the OS keychain. */
  loginUsername: string
  /** Read-only mirror for the UI: whether a password is stored. Set through settings.setLoginPassword. */
  hasLoginPassword: boolean
  /** Password for a single protected video (Vimeo "password" videos). */
  videoPassword: string
  /** Browser identity yt-dlp presents; phones sometimes get formats or pages desktops do not. */
  userAgent: 'default' | 'desktop' | 'ios' | 'android'
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
  videoCodec: 'auto',
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
  onQueueDone: 'none',
  loginUsername: '',
  hasLoginPassword: false,
  videoPassword: '',
  userAgent: 'default',
  autoUpdateEngine: true,
  settingsVersion: 9,
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
  'ui:export': 'queue' | 'later' | 'history'
  /** Progress of a trim export, 0–100. */
  'trim:progress': { percent: number }
  /** Open the trim view for a row (from the context menu). */
  'ui:trim': { rowId: string }
  'ui:split': { rowId: string }
  'ui:rename': { rowId: string }
  /** A sleep or shutdown is about to happen; the renderer shows the countdown with a Cancel. `seconds` 0 = cancelled. */
  'power:countdown': { action: 'sleep' | 'shutdown'; seconds: number }
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
  addUrls(urls: string[], download?: boolean): Promise<{ added: number; duplicates: string[] }>
  removeRows(ids: string[]): Promise<void>
  /** New order for the whole list; rows download in list order. */
  reorderRows(ids: string[]): Promise<void>
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
    /** Store (or clear, with '') the site-login password in the OS keychain. */
    setLoginPassword(password: string): Promise<Settings>
  }
  tools: {
    status(): Promise<ToolStatus[]>
    updateEngine(): Promise<{ updated: boolean; version: string }>
    /** Which encoder a conversion would use on this machine, per codec (null: none available). Probed once. */
    encoders(): Promise<{ h264: string | null; h265: string | null }>
  }
  app: {
    info(): Promise<AppInfo>
  }
  power: {
    /** Stop a pending sleep or shutdown. */
    cancel(): Promise<void>
  }
  /** Save a list as a text file of links (history adds the file path after a tab); resolves to the path or null when cancelled. */
  exportLinks(kind: 'queue' | 'later' | 'history'): Promise<string | null>
  media: {
    /** A URL the renderer can play for a local file (custom protocol; range requests supported). */
    url(path: string): Promise<string>
  }
  trim: {
    /** Cut a segment into a new file beside the source; resolves to its path. */
    export(job: { src: string; start: number; end: number; kind: 'mp4' | 'm4a' | 'm4r'; precise: boolean }): Promise<string>
    /** Split at the marks into numbered clips beside the source (resolves to their paths), or write the marks into the file as chapters. */
    split(job: { src: string; marks: { start: number; title: string }[]; mode: 'clips' | 'chapters' }): Promise<string[]>
    cancel(): Promise<void>
  }
  files: {
    /** Rename finished files; each entry moves `from` to `to` (same folder). Rows and history follow. Resolves to the paths that changed. */
    rename(pairs: { rowId: string; from: string; to: string }[]): Promise<string[]>
  }
  shell: {
    reveal(path: string): Promise<void>
    /** Open the file in its default app. */
    open(path: string): Promise<void>
    /** The OS "open with" chooser (Windows) or an application picker (macOS). */
    openWith(path: string): Promise<void>
    openExternal(url: string): Promise<void>
    /** Reveal the folder holding engine.log, the first thing to send with a problem report. */
    openLogs(): Promise<void>
  }
  on<K extends keyof MainEvents>(event: K, handler: (payload: MainEvents[K]) => void): () => void
}
