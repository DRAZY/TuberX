/** Last path segment of a Windows or POSIX path, for the destination chip. */
export function folderName(path: string): string {
  if (!path) return 'Choose folder'
  const parts = path.split(/[\\/]+/).filter(Boolean)
  return parts[parts.length - 1] ?? path
}

export function formatDate(ms: number): string {
  if (!Number.isFinite(ms)) return ''
  return new Date(ms).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

/** Seconds remaining as a terse "4m 12s" / "48s". */
export function formatEta(sec?: number): string {
  if (sec === undefined || !Number.isFinite(sec) || sec < 0) return ''
  const s = Math.round(sec)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}
