import { describe, expect, test } from 'bun:test'
import { LANGUAGE_CODES, baseLanguage, subtitleMatches, subtitlePatterns } from '../shared/languages'
import { preferredDub } from '../shared/normalize'

/** yt-dlp matches each --sub-langs entry as a regex against the whole code (re.fullmatch). */
const ytdlpPicks = (patterns: string[], available: string[]) =>
  available.filter((code) => patterns.some((p) => new RegExp(`^(?:${p})$`).test(code)))

describe('subtitle languages', () => {
  test('a base code fetches its regional and script variants (the old "en-*" pattern only matched "en")', () => {
    const available = ['en', 'en-GB', 'en-orig', 'pt-BR', 'zh-Hans', 'zh-Hant', 'es-419', 'fr', 'english']
    expect(ytdlpPicks(subtitlePatterns(['en']), available)).toEqual(['en', 'en-GB', 'en-orig'])
    expect(ytdlpPicks(subtitlePatterns(['zh']), available)).toEqual(['zh-Hans', 'zh-Hant'])
    expect(ytdlpPicks(subtitlePatterns(['pt', 'es']), available)).toEqual(['pt-BR', 'es-419'])
    expect(ytdlpPicks(['en-*'], available)).toEqual(['en']) // the bug this replaces
  })
  test("old spellings: Hebrew is 'iw' on YouTube", () => {
    expect(ytdlpPicks(subtitlePatterns(['he']), ['iw', 'he', 'iw-IL', 'hi'])).toEqual(['iw', 'he', 'iw-IL'])
    expect(subtitleMatches('iw', ['he'])).toBe(true)
    expect(baseLanguage('iw')).toBe('he')
  })
  test('a code that is not a language never reaches yt-dlp', () => {
    expect(subtitlePatterns(['en', '.*', 'all', '-en', 'en,fr', ''])).toEqual(['en', 'en-.*'])
  })
  test('subtitleMatches follows variants, not prefixes of other languages', () => {
    expect(subtitleMatches('pt-BR', ['pt'])).toBe(true)
    expect(subtitleMatches('en', ['en'])).toBe(true)
    expect(subtitleMatches('es', ['en'])).toBe(false)
    expect(subtitleMatches('tr', ['ta'])).toBe(false)
  })
  test('every listed code is a valid code and has a name in English', () => {
    const names = new Intl.DisplayNames(['en'], { type: 'language' })
    for (const code of LANGUAGE_CODES) {
      expect(names.of(code)).not.toBe(code)
      expect(new Set(LANGUAGE_CODES).size).toBe(LANGUAGE_CODES.length)
    }
  })
})

describe('preferred audio language', () => {
  const hindiOriginal = [{ code: 'hi', name: 'Hindi', original: true }, { code: 'en-US', name: 'English (US)' }]
  const many = [
    { code: 'en-US', name: 'English (US)', original: true },
    { code: 'es-419', name: 'Spanish (Latin America)' },
    { code: 'es-ES', name: 'Spanish (Spain)' },
    { code: 'pt-BR', name: 'Portuguese (Brazil)' },
    { code: 'zh-Hans', name: 'Chinese (Simplified)' },
    { code: 'hi', name: 'Hindi' },
  ]
  test('a base code picks a dub in that language, whatever its region or script', () => {
    expect(preferredDub(hindiOriginal, 'en')).toBe('en-US')
    expect(preferredDub(many, 'pt')).toBe('pt-BR')
    expect(preferredDub(many, 'zh')).toBe('zh-Hans')
    expect(preferredDub(many, 'hi')).toBe('hi')
    expect(['es-419', 'es-ES']).toContain(preferredDub(many, 'es'))
  })
  test('an exact code wins over another variant', () => {
    expect(preferredDub(many, 'es-ES')).toBe('es-ES')
  })
  test('nothing when the original is already that language, there is no such dub, or no preference', () => {
    expect(preferredDub(hindiOriginal, 'hi')).toBeUndefined()
    expect(preferredDub(many, 'en')).toBeUndefined()
    expect(preferredDub(many, 'ja')).toBeUndefined()
    expect(preferredDub(many, '')).toBeUndefined()
    expect(preferredDub(undefined, 'hi')).toBeUndefined()
  })
})
