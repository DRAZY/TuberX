import { describe, expect, test } from 'bun:test'
import { extractUrls, parseDeepLink, playlistUrlFromVideoUrl, urlKey, youtubeVideoId } from '../shared/urls'

describe('extractUrls', () => {
  test('pulls several URLs from mixed text and dedupes', () => {
    const text = `first https://youtu.be/abc123XYZ_ then https://vimeo.com/12345.
    https://youtu.be/abc123XYZ_ again and https://soundcloud.com/a/b`
    expect(extractUrls(text)).toEqual([
      'https://youtu.be/abc123XYZ_',
      'https://vimeo.com/12345',
      'https://soundcloud.com/a/b',
    ])
  })
  test('ignores non-http schemes', () => {
    expect(extractUrls('ftp://x.com/a mailto:a@b.c')).toEqual([])
  })
})

describe('youtube helpers', () => {
  test('video id from watch, shorts, youtu.be', () => {
    expect(youtubeVideoId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1')).toBe('dQw4w9WgXcQ')
    expect(youtubeVideoId('https://youtube.com/shorts/abcdefghijk')).toBe('abcdefghijk')
    expect(youtubeVideoId('https://youtu.be/dQw4w9WgXcQ?si=zz')).toBe('dQw4w9WgXcQ')
  })
  test('playlist detection on watch URLs, ignoring mixes', () => {
    expect(playlistUrlFromVideoUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL123')).toBe(
      'https://www.youtube.com/playlist?list=PL123',
    )
    expect(playlistUrlFromVideoUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=RDabc')).toBeNull()
    expect(playlistUrlFromVideoUrl('https://vimeo.com/1?list=x')).toBeNull()
  })
})

describe('urlKey', () => {
  test('same youtube video, different forms → same key', () => {
    expect(urlKey('https://youtu.be/dQw4w9WgXcQ?si=1')).toBe(urlKey('https://www.youtube.com/watch?v=dQw4w9WgXcQ&feature=share'))
  })
  test('strips tracking params and www', () => {
    expect(urlKey('https://www.vimeo.com/123?utm_source=x#frag')).toBe('vimeo.com/123')
  })
})

describe('parseDeepLink', () => {
  test('tuberx:// and tuberxlater://', () => {
    expect(parseDeepLink('tuberx://https://vimeo.com/1')).toEqual({ url: 'https://vimeo.com/1', later: false })
    expect(parseDeepLink('tuberxlater://www.youtube.com/watch?v=dQw4w9WgXcQ')).toEqual({
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      later: true,
    })
    expect(parseDeepLink('https://vimeo.com/1')).toBeNull()
  })
})

describe('vimeoPlayerUrl', () => {
  test('numeric ids and unlisted hashes map to the player', async () => {
    const { vimeoPlayerUrl } = await import('../shared/urls')
    expect(vimeoPlayerUrl('https://vimeo.com/76979871')).toBe('https://player.vimeo.com/video/76979871')
    expect(vimeoPlayerUrl('https://vimeo.com/76979871/abcdef1234')).toBe('https://player.vimeo.com/video/76979871?h=abcdef1234')
    expect(vimeoPlayerUrl('https://vimeo.com/channels/staffpicks/76979871')).toBe('https://player.vimeo.com/video/76979871')
    expect(vimeoPlayerUrl('https://vimeo.com/staff')).toBeNull()
    expect(vimeoPlayerUrl('https://player.vimeo.com/video/1')).toBeNull()
  })
})
