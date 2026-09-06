import { protocol } from 'electron'
import { createReadStream, statSync } from 'node:fs'
import { Readable } from 'node:stream'
import { extname } from 'node:path'

/**
 * tuberx-media://file/<encoded absolute path>: lets the renderer play a downloaded file in a <video>
 * element with seeking. Only absolute paths are served, and only with their real byte ranges.
 */
export const MEDIA_SCHEME = 'tuberx-media'

const MIME: Record<string, string> = {
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.mkv': 'video/x-matroska',
  '.m4a': 'audio/mp4', '.m4r': 'audio/mp4', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.opus': 'audio/ogg', '.flac': 'audio/flac',
}

export function mediaUrl(path: string): string {
  return `${MEDIA_SCHEME}://file/${encodeURIComponent(path)}`
}

export function registerMediaScheme(): void {
  // standard + corsEnabled: Chromium 152 (Electron 44) only lets <video> load from a standard scheme, and only
  // lets a fetch-capable custom scheme answer cross-origin loads (the renderer is file:// or the dev server) with CORS.
  protocol.registerSchemesAsPrivileged([{ scheme: MEDIA_SCHEME, privileges: { standard: true, stream: true, supportFetchAPI: true, corsEnabled: true, bypassCSP: true, secure: true } }])
}

export function serveMedia(): void {
  protocol.handle(MEDIA_SCHEME, (req) => {
    const path = decodeURIComponent(new URL(req.url).pathname.replace(/^\//, ''))
    let size: number
    try {
      size = statSync(path).size
    } catch {
      return new Response('not found', { status: 404 })
    }
    const type = MIME[extname(path).toLowerCase()] ?? 'application/octet-stream'
    const range = req.headers.get('range')?.match(/bytes=(\d*)-(\d*)/)
    let start = 0
    let end = size - 1
    if (range) {
      if (range[1]) start = Number(range[1])
      if (range[2]) end = Number(range[2])
      if (!range[1] && range[2]) {
        start = Math.max(0, size - Number(range[2]))
        end = size - 1
      }
      end = Math.min(end, size - 1)
      if (start > end || start >= size) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}`, 'Access-Control-Allow-Origin': '*' } })
    }
    const body = Readable.toWeb(createReadStream(path, { start, end })) as unknown as ReadableStream
    return new Response(body, {
      status: range ? 206 : 200,
      headers: {
        'Content-Type': type,
        'Accept-Ranges': 'bytes',
        // The only client is this app's own renderer; the scheme serves nothing but local files it was handed.
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges',
        'Content-Length': String(end - start + 1),
        ...(range ? { 'Content-Range': `bytes ${start}-${end}/${size}` } : {}),
      },
    })
  })
}
