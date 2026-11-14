/**
 * Languages the Settings pickers offer: the preferred audio language and the subtitle languages.
 * Base codes only. A base code matches its regional and script variants ("es" covers "es-419" and
 * "es-ES", "zh" covers "zh-Hans" and "zh-Hant", "pt" covers "pt-BR"), which is how the engine already
 * asks yt-dlp for subtitles. Names come from Intl.DisplayNames in the app's own language, so this list
 * holds codes only. It covers the languages YouTube dubs and captions in; a code saved before the
 * picker existed and missing here is still shown and kept.
 */
export const LANGUAGE_CODES = [
  'af', 'am', 'ar', 'az', 'be', 'bg', 'bn', 'bs', 'ca', 'cs', 'cy', 'da', 'de', 'el', 'en', 'es', 'et', 'eu',
  'fa', 'fi', 'fil', 'fr', 'ga', 'gl', 'gu', 'ha', 'he', 'hi', 'hr', 'hu', 'hy', 'id', 'ig', 'is', 'it', 'ja',
  'jv', 'ka', 'kk', 'km', 'kn', 'ko', 'ky', 'lo', 'lt', 'lv', 'mk', 'ml', 'mn', 'mr', 'ms', 'my', 'ne', 'nl',
  'no', 'or', 'pa', 'pl', 'ps', 'pt', 'ro', 'ru', 'si', 'sk', 'sl', 'so', 'sq', 'sr', 'sv', 'sw', 'ta', 'te',
  'tg', 'th', 'tk', 'tr', 'uk', 'ur', 'uz', 'vi', 'xh', 'yo', 'zh', 'zu',
] as const

/**
 * Old codes some sites still use for a language. YouTube labels Hebrew captions "iw"; Norwegian appears
 * as "nb" as well as "no"; Filipino as "tl".
 */
const ALIASES: Record<string, string[]> = { he: ['iw'], id: ['in'], yi: ['ji'], no: ['nb'], fil: ['tl'] }

/** The base language of a code: "pt-BR" → "pt", "zh-Hans" → "zh", "iw" → "he". */
export function baseLanguage(code: string): string {
  const base = code.split('-')[0].toLowerCase()
  for (const [canonical, olds] of Object.entries(ALIASES)) if (olds.includes(base)) return canonical
  return base
}

/** What a stored language code may look like. Anything else (a stray comma, a regex character) is dropped. */
export const LANGUAGE_CODE = /^[A-Za-z0-9]{2,8}(?:-[A-Za-z0-9]{1,8})*$/

/**
 * The --sub-langs patterns for the chosen subtitle languages: each code, its variants, and its old spellings.
 * yt-dlp reads each one as a regular expression that must match the whole code, so a variant needs "-.*".
 * (Before 0.3.14 the pattern was "en-*", which as a regex only matches "en", so "pt-BR" and "zh-Hans"
 * captions were never fetched.)
 */
export function subtitlePatterns(langs: string[]): string[] {
  const out = new Set<string>()
  // "all" is a keyword to yt-dlp (every subtitle on the video), not a language.
  for (const l of langs.filter((x) => LANGUAGE_CODE.test(x) && x.toLowerCase() !== 'all')) for (const c of [l, ...(ALIASES[l] ?? [])]) {
    out.add(c)
    out.add(`${c}-.*`)
  }
  return [...out]
}

/** Whether a subtitle track's code is one of the chosen languages (variants and old spellings included). */
export function subtitleMatches(trackLang: string, langs: string[]): boolean {
  return langs.some((l) => [l, ...(ALIASES[l] ?? [])].some((c) => trackLang === c || trackLang.startsWith(c + '-')))
}
