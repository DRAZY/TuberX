import type { DownloadProgress } from './types'

/**
 * yt-dlp is launched with:
 *   --newline --progress-template "download:TXP|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s"
 * and, for post-processing:
 *   --progress-template "postprocess:TXPP|%(progress.status)s|%(info.filepath)s"
 * This module turns those lines (and a few classic yt-dlp status lines) into DownloadProgress.
 */
export const PROGRESS_TEMPLATE =
  'download:TXP|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s'

function num(v: string): number | undefined {
  if (!v || v === 'NA' || v === 'None') return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

const UNIT: Record<string, number> = { B: 1, KiB: 1024, MiB: 1024 ** 2, GiB: 1024 ** 3, TiB: 1024 ** 4 }

/** "245.7MiB" → bytes; "0B" → 0. */
export function parseSize(s: string): number | undefined {
  const m = s.trim().match(/^([\d.]+)\s*(B|KiB|MiB|GiB|TiB)$/)
  if (!m) return undefined
  return Math.round(parseFloat(m[1]) * UNIT[m[2]])
}

/** "1m20s" / "27s" / "1h2m" → seconds. */
export function parseEta(s: string): number | undefined {
  const m = s.trim().match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/)
  if (!m || !s.trim()) return undefined
  return (Number(m[1] ?? 0) * 3600) + (Number(m[2] ?? 0) * 60) + Number(m[3] ?? 0)
}

/**
 * aria2c (as yt-dlp's external downloader) reports through its own console lines instead of
 * yt-dlp's progress template:  [#975bcf 24MiB/245MiB(9%) CN:16 DL:8.6MiB ETA:25s]
 */
export function parseAria2Line(line: string): DownloadProgress | null {
  const m = line.trim().match(/^\[#[0-9a-f]{6}\s+(\S+?)\/(\S+?)(?:\((\d+)%\))?\s+CN:(\d+)(?:\s+DL:(\S+?))?(?:\s+ETA:(\S+?))?\]$/)
  if (!m) return null
  const downloaded = parseSize(m[1])
  const total = parseSize(m[2])
  const percent = m[3] !== undefined ? Number(m[3]) : downloaded !== undefined && total ? (downloaded / total) * 100 : 0
  return {
    stage: 'download',
    percent: Math.round(percent * 10) / 10,
    downloadedBytes: downloaded,
    totalBytes: total || undefined,
    speed: m[5] ? parseSize(m[5]) : undefined,
    eta: m[6] ? parseEta(m[6]) : undefined,
    downloader: 'aria2c',
  }
}

export function parseProgressLine(line: string): DownloadProgress | null {
  const l = line.trim()
  if (l.startsWith('[#')) return parseAria2Line(l)
  if (l.startsWith('TXP|')) {
    const [, dl, total, est, speed, eta] = l.split('|')
    const downloaded = num(dl)
    const totalBytes = num(total) ?? num(est)
    const percent =
      downloaded !== undefined && totalBytes ? Math.min(100, (downloaded / totalBytes) * 100) : 0
    return {
      stage: 'download',
      percent: round1(percent),
      downloadedBytes: downloaded,
      totalBytes,
      speed: num(speed),
      eta: num(eta),
    }
  }
  // Post-processing: each pass rewrites the whole file, so the UI names the pass and shows elapsed time.
  if (/^\[Merger\]/.test(l)) return { stage: 'merge', percent: 100 }
  if (/^\[(ExtractAudio|VideoRemuxer|VideoConvertor|FixupM4a|FixupM3u8)\]/.test(l))
    return { stage: 'convert', percent: 100 }
  if (/^\[EmbedSubtitle\]/.test(l)) return { stage: 'subs', percent: 100 }
  if (/^\[(Metadata|ThumbnailsConvertor)\]/.test(l)) return { stage: 'tag', percent: 100 }
  if (/^\[EmbedThumbnail\]/.test(l)) return { stage: 'cover', percent: 100 }
  if (/^\[MoveFiles\]/.test(l)) return { stage: 'move', percent: 100 }
  return null
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

/** Lines printed by `--print after_move:filepath` carry the final output path. */
export const FINAL_PATH_PREFIX = 'TXOUT|'

export function parseFinalPath(line: string): string | null {
  const l = line.trim()
  return l.startsWith(FINAL_PATH_PREFIX) ? l.slice(FINAL_PATH_PREFIX.length) : null
}
