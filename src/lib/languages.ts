import { LANGUAGE_CODES } from '@shared/languages'

const cache = new Map<string, Intl.DisplayNames | null>()

/** A language's name in the given UI locale ("hi" → "Hindi" in English, "hindi" in French); the code when Intl has no name. */
export function languageName(code: string, uiLocale: string): string {
  let names = cache.get(uiLocale)
  if (names === undefined) {
    try {
      names = new Intl.DisplayNames([uiLocale], { type: 'language' })
    } catch {
      names = null
    }
    cache.set(uiLocale, names)
  }
  try {
    const name = names?.of(code)
    return name && name !== code ? name : code
  } catch {
    return code
  }
}

/** The preferred-audio choices: every listed language by name in the UI language, sorted. */
export function languageOptions(uiLocale: string): { code: string; name: string }[] {
  return LANGUAGE_CODES.map((code) => ({ code, name: languageName(code, uiLocale) })).sort((a, b) => a.name.localeCompare(b.name, uiLocale))
}
