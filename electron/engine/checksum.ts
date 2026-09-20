import { createHash } from 'node:crypto'

/** Every engine download must come from the yt-dlp project's own release storage. */
export const ENGINE_RELEASE_PREFIX = 'https://github.com/yt-dlp/yt-dlp/releases/download/'

export function sha256Hex(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}

/** The hash a `SHA2-256SUMS` file (`<64 hex>  <file name>` per line) lists for one file, or null. */
export function expectedSha256(sums: string, fileName: string): string | null {
  for (const line of sums.split(/\r?\n/)) {
    const m = line.match(/^([0-9a-fA-F]{64})\s+\*?(.+?)\s*$/)
    if (m && m[2] === fileName) return m[1].toLowerCase()
  }
  return null
}

/**
 * Refuse a downloaded engine archive unless its SHA-256 matches what the release says it should be.
 *
 * Two independent statements of the expected hash are used: the project's own `SHA2-256SUMS` file, written by
 * its release workflow, and the digest GitHub computed when the asset was uploaded (release API). The sums file
 * is required; the API digest must agree whenever GitHub supplies one. This catches a corrupted or truncated
 * download and an asset swapped after publication. It does not defend against a release that was malicious when
 * it was published; that would need the project's GPG signature over the sums file checked against a pinned key.
 */
export function verifyEngineDownload(data: Uint8Array, fileName: string, sums: string, apiDigest?: string | null): string {
  const actual = sha256Hex(data)
  const listed = expectedSha256(sums, fileName)
  if (!listed) throw new Error(`the release's SHA2-256SUMS has no entry for ${fileName}; update not installed`)
  if (listed !== actual) throw new Error(`${fileName} failed its checksum (SHA2-256SUMS says ${listed.slice(0, 12)}…, download is ${actual.slice(0, 12)}…); update not installed`)
  const api = apiDigest?.startsWith('sha256:') ? apiDigest.slice(7).toLowerCase() : null
  if (api && api !== actual) throw new Error(`${fileName} does not match the digest GitHub recorded for it (${api.slice(0, 12)}… vs ${actual.slice(0, 12)}…); update not installed`)
  return actual
}
