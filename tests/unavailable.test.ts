import { describe, expect, test } from 'bun:test'
import { isUnavailableEntry, isUnavailableError } from '../shared/unavailable'
import { normalizeMedia } from '../shared/normalize'

describe('videos that are gone for good (#17)', () => {
  test.each([
    'Video unavailable. This video is private',
    "Private video. Sign in if you've been granted access to this video. This video needs a login: Settings › Network › Cookies from browser",
    'Video unavailable. This video has been removed by the uploader',
    'Video unavailable. This video is no longer available because the YouTube account associated with this video has been terminated.',
    'Video unavailable. This video is no longer available due to a copyright claim by Some Label',
    "This video has been removed for violating YouTube's Terms of Service",
    'Video unavailable',
    'Unable to download webpage: HTTP Error 404: Not Found',
    'HTTP Error 410: Gone',
  ])('gone: %s', (msg) => expect(isUnavailableError(msg)).toBe(true))

  test.each([
    'Video unavailable. The uploader has not made this video available in your country',
    'Video unavailable. This content isn’t available, try again later.',
    "Sign in to confirm you're not a bot",
    'Join this channel to get access to members-only content like this video',
    'Sign in to confirm your age. This video may be inappropriate for some users.',
    'Unable to extract uploader id; please report this issue',
    'Requested format is not available',
    'Unable to download webpage: <urlopen error timed out>',
    'Download stalled: no progress for 2 minutes',
  ])('fixable, kept: %s', (msg) => expect(isUnavailableError(msg)).toBe(false))

  test('playlist placeholders', () => {
    expect(isUnavailableEntry('[Private video]')).toBe(true)
    expect(isUnavailableEntry('[Deleted video]')).toBe(true)
    expect(isUnavailableEntry('Anything', 'private')).toBe(true)
    expect(isUnavailableEntry('My [Private video] reaction')).toBe(false)
    expect(isUnavailableEntry(undefined)).toBe(false)
  })

  test('normalizeMedia flags placeholder entries and leaves the rest alone', () => {
    const m = normalizeMedia(
      {
        _type: 'playlist',
        title: 'Mix',
        entries: [
          { id: 'a', url: 'https://www.youtube.com/watch?v=a', title: 'Real one', duration: 60 },
          { id: 'b', url: 'https://www.youtube.com/watch?v=b', title: '[Private video]' },
          { id: 'c', url: 'https://www.youtube.com/watch?v=c', title: '[Deleted video]' },
        ],
      },
      'https://www.youtube.com/playlist?list=x',
    )
    expect(m.entries?.map((e) => e.unavailable ?? false)).toEqual([false, true, true])
  })
})
