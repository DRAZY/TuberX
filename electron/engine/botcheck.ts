/**
 * YouTube's "Sign in to confirm you're not a bot" check, and what TuberX does about it.
 *
 * What was learned on 2026-09-28 (ISA Decisions): yt-dlp's default clients are `visionos,web`. The bundled
 * PO-token helper (bgutil) can only make tokens for the web family of clients (mweb, web_embedded, tv_simply,
 * web, …), so a retry that merely switches the helper on changes nothing for visionos, and the plain web
 * client's formats are streamed in a form yt-dlp cannot download. The retry that can actually help asks for
 * clients the helper serves. Pure helpers here; the engine and the queue use them.
 */

export const BOT_CHECK = /confirm you.re not a bot/i

/** Clients the bundled helper can token, in the order worth trying; each gave 1080p formats in testing. */
export const TOKEN_CLIENTS = 'mweb,web_embedded,tv_simply'

/** Automatic retries after a sign-in check: a minute, then three more. */
export const BOT_RETRY_DELAYS_MS = [60_000, 180_000]

export class BotCheckError extends Error {
  readonly botCheck = true
}

export function isBotCheckError(e: unknown): e is BotCheckError {
  return typeof e === 'object' && e !== null && (e as { botCheck?: unknown }).botCheck === true
}

export function isYouTubeUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase()
    return /(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com|music\.youtube\.com)$/.test(host)
  } catch {
    return false
  }
}

/**
 * What the helper said, if anything. Its failures reach stderr as `[youtube] [pot:bgutil…]` lines
 * (the retry runs without `--no-warnings` for this reason); a successful token leaves no line.
 */
export function helperFailure(stderr: string): string | null {
  const line = stderr.split(/\r?\n/).find((l) => /\[pot:bgutil[^\]]*\]/i.test(l) && /(fail|error|unable|could not|timed? ?out|exception|rejected)/i.test(l))
  if (!line) return null
  const text = line.replace(/^.*\[pot:bgutil[^\]]*\]\s*(TRACE:\s*)?/i, '').trim()
  return text.length > 100 ? text.slice(0, 97) + '…' : text
}
