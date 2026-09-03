/** URL helpers shared by main and renderer. Pure functions, no Node APIs. */

const URL_RE = /https?:\/\/[^\s<>"'`)\]}]+/gi

/** Pull every http(s) URL out of free text (paste, dropped .txt, drag payloads). */
export function extractUrls(text: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const m of text.matchAll(URL_RE)) {
    const u = cleanUrl(m[0])
    if (u && !seen.has(u)) {
      seen.add(u)
      out.push(u)
    }
  }
  return out
}

/** Strip trailing punctuation that commonly rides along when pasting from prose. */
export function cleanUrl(raw: string): string {
  let u = raw.trim().replace(/[.,;:!?]+$/, '')
  try {
    const parsed = new URL(u)
    if (!/^https?:$/.test(parsed.protocol)) return ''
    return parsed.toString()
  } catch {
    return ''
  }
}

/** Canonical key used for duplicate detection across queue / later / history. */
export function urlKey(url: string): string {
  try {
    const u = new URL(url)
    u.hash = ''
    const host = u.hostname.replace(/^(www|m)\./, '')
    if (/(^|\.)youtube\.com$/.test(host) || host === 'youtu.be') {
      const id = youtubeVideoId(url)
      if (id) return `yt:${id}`
    }
    // Drop common tracking params
    for (const p of [...u.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|si$|feature$|ref$|ref_src$)/.test(p)) u.searchParams.delete(p)
    }
    return `${host}${u.pathname.replace(/\/+$/, '')}${u.search}`
  } catch {
    return url
  }
}

export function youtubeVideoId(url: string): string | null {
  try {
    const u = new URL(url)
    const host = u.hostname.replace(/^(www|m|music)\./, '')
    if (host === 'youtu.be') return u.pathname.slice(1).split('/')[0] || null
    if (host === 'youtube.com') {
      if (u.pathname === '/watch') return u.searchParams.get('v')
      const m = u.pathname.match(/^\/(shorts|embed|live|v)\/([\w-]{6,})/)
      if (m) return m[2]
    }
    return null
  } catch {
    return null
  }
}

/** A single-video URL that also carries a playlist reference (YouTube watch?v=…&list=…). */
export function playlistUrlFromVideoUrl(url: string): string | null {
  try {
    const u = new URL(url)
    const host = u.hostname.replace(/^(www|m|music)\./, '')
    if (host !== 'youtube.com') return null
    const list = u.searchParams.get('list')
    if (!list || !youtubeVideoId(url)) return null
    if (/^(RD|UL|LL|WL)/.test(list)) return null // mixes / auto lists are not real playlists
    return `https://www.youtube.com/playlist?list=${list}`
  } catch {
    return null
  }
}

/** Parse a tuberx:// or tuberxlater:// deep link (as produced by the browser extension). */
export function parseDeepLink(arg: string): { url: string; later: boolean } | null {
  const m = arg.match(/^(tuberx|tuberxlater):\/\/(.+)$/i)
  if (!m) return null
  let target = decodeURIComponent(m[2])
  if (!/^https?:\/\//i.test(target)) target = `https://${target}`
  const url = cleanUrl(target)
  if (!url) return null
  return { url, later: m[1].toLowerCase() === 'tuberxlater' }
}

/**
 * Vimeo's web client refuses anonymous requests since 2025, but the embed player
 * does not. Map vimeo.com/<id>[/<unlisted-hash>] to player.vimeo.com/video/<id>[?h=hash].
 * Returns null for URLs that carry no numeric id (channels, user pages, showcases).
 */
export function vimeoPlayerUrl(url: string): string | null {
  try {
    const u = new URL(url)
    const host = u.hostname.replace(/^www\./, '')
    if (host === 'player.vimeo.com') return null
    if (host !== 'vimeo.com') return null
    const m = u.pathname.match(/^\/(?:(?:channels|groups)\/[\w-]+\/)?(\d+)(?:\/([0-9a-f]{8,}))?\/?$/)
    if (!m) return null
    const player = new URL(`https://player.vimeo.com/video/${m[1]}`)
    if (m[2]) player.searchParams.set('h', m[2])
    return player.toString()
  } catch {
    return null
  }
}
