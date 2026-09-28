import { describe, expect, test } from 'bun:test'
import { BOT_CHECK, BOT_RETRY_DELAYS_MS, BotCheckError, TOKEN_CLIENTS, helperFailure, isBotCheckError, isYouTubeUrl } from '../electron/engine/botcheck'

describe('sign-in check handling', () => {
  test('recognises the check in either apostrophe form and nothing else', () => {
    expect(BOT_CHECK.test("ERROR: [youtube] x: Sign in to confirm you're not a bot.")).toBe(true)
    expect(BOT_CHECK.test('Sign in to confirm you’re not a bot')).toBe(true)
    expect(BOT_CHECK.test('Sign in to confirm your age')).toBe(false)
  })

  test('the retry asks only for clients the bundled helper can token', () => {
    for (const c of TOKEN_CLIENTS.split(',')) expect(['mweb', 'web_embedded', 'tv_simply', 'web', 'web_safari', 'tv', 'tv_downgraded']).toContain(c)
    expect(TOKEN_CLIENTS).not.toContain('visionos') // yt-dlp's default, which the helper rejects
    expect(TOKEN_CLIENTS).not.toContain('android')
  })

  test('only YouTube links get the client change', () => {
    expect(isYouTubeUrl('https://youtu.be/82cX7JkBP9M?si=abc')).toBe(true)
    expect(isYouTubeUrl('https://www.youtube.com/watch?v=x')).toBe(true)
    expect(isYouTubeUrl('https://music.youtube.com/watch?v=x')).toBe(true)
    expect(isYouTubeUrl('https://vimeo.com/1')).toBe(false)
    expect(isYouTubeUrl('https://notyoutube.com/x')).toBe(false)
    expect(isYouTubeUrl('not a url')).toBe(false)
  })

  test('helper failures are read from the warning line; a successful token leaves none', () => {
    expect(helperFailure('[youtube] [pot:bgutil:script-deno] WARNING: Failed to generate PO token: deno exited 1\nERROR: x')).toBe('WARNING: Failed to generate PO token: deno exited 1')
    expect(helperFailure('[youtube] x: Downloading mweb player API JSON\n')).toBeNull()
    expect(helperFailure('')).toBeNull()
  })

  test('the schedule is a minute then three, and the error is typed', () => {
    expect(BOT_RETRY_DELAYS_MS).toEqual([60_000, 180_000])
    expect(isBotCheckError(new BotCheckError('x'))).toBe(true)
    expect(isBotCheckError(new Error('x'))).toBe(false)
    expect(isBotCheckError(null)).toBe(false)
  })
})
