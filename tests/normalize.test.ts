import { describe, expect, test } from 'bun:test'
import { rungOf, buildFormatOptions, formatDuration, normalizeMedia, snapHeight } from '../shared/normalize'
import video from './fixtures/youtube-video.json'
import playlist from './fixtures/youtube-playlist.json'
import track from './fixtures/soundcloud-track.json'

describe('normalizeMedia — single video', () => {
  const m = normalizeMedia(video as any, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL123')
  test('core fields', () => {
    expect(m.title).toBe('Rick Astley - Never Gonna Give You Up (Official Video) (4K Remaster)')
    expect(m.uploader).toBe('Rick Astley')
    expect(m.duration).toBe(213)
    expect(m.thumbnail).toMatch(/^https:/)
    expect(m.isPlaylist).toBe(false)
    expect(m.extractor).toBe('Youtube')
  })
  test('detects the surrounding playlist from the URL', () => {
    expect(m.playlistUrl).toBe('https://www.youtube.com/playlist?list=PL123')
  })
  test('format options: best first, standard rungs, audio at the end', () => {
    const ids = m.formats.map((f) => f.id)
    expect(ids[0]).toBe('v:best')
    expect(m.formats[0].label).toBe('Best · 4K MP4')
    expect(m.formats[0].height).toBe(2160)
    expect(ids).toContain('v:2160')
    expect(ids).toContain('v:1080')
    expect(ids).toContain('v:360')
    expect(ids.slice(-5)).toEqual(['a:mp3', 'a:m4a', 'a:wav', 'a:m4r', 's:srt'])
    expect(m.defaultFormatId).toBe('v:best')
    expect(m.formats.find((f) => f.id === 'v:1080')?.sort).toBe('res:1080')
  })
  test('subtitles and chapters', () => {
    expect(m.subtitles.find((s) => s.lang === 'en')?.auto).toBe(false)
    expect(m.subtitles.find((s) => s.lang === 'de')?.auto).toBe(true)
    expect(m.chapters.length).toBe(2)
  })
})

describe('normalizeMedia — playlist', () => {
  const m = normalizeMedia(playlist as any, 'https://www.youtube.com/playlist?list=PL123')
  test('entries with urls', () => {
    expect(m.isPlaylist).toBe(true)
    expect(m.entries?.length).toBe(3)
    expect(m.entries?.[0].url).toBe('https://www.youtube.com/watch?v=aaaaaaaaaaa')
    expect(m.formats).toEqual([])
  })
})

describe('normalizeMedia — audio only', () => {
  const m = normalizeMedia(track as any, 'https://soundcloud.com/artist/track')
  test('no video rungs, default is m4a', () => {
    expect(m.formats.some((f) => f.kind === 'video')).toBe(false)
    expect(m.defaultFormatId).toBe('a:m4a')
  })
})

describe('helpers', () => {
  test('snapHeight', () => {
    expect(snapHeight(1076)).toBe(1080)
    expect(snapHeight(2158)).toBe(2160)
    expect(snapHeight(200)).toBe(240)
  })
  test('formatDuration', () => {
    expect(formatDuration(213)).toBe('3:33')
    expect(formatDuration(3661)).toBe('1:01:01')
  })
  test('buildFormatOptions dedupes heights keeping highest fps', () => {
    const opts = buildFormatOptions(
      [
        { format_id: '1', vcodec: 'avc1', acodec: 'none', height: 1080, fps: 30 },
        { format_id: '2', vcodec: 'vp9', acodec: 'none', height: 1080, fps: 60 },
        { format_id: '3', vcodec: 'none', acodec: 'opus', abr: 160 },
      ],
      true,
    )
    const v1080 = opts.find((o) => o.id === 'v:1080')!
    expect(v1080.fps).toBe(60)
    expect(v1080.label).toContain('60fps')
  })
})

describe('rungs for non-16:9 videos', () => {
  test('ultra-wide 3840×1608 is the 4K rung and each rung sorts by its own real height', () => {
    const opts = buildFormatOptions(
      [
        { format_id: '401', vcodec: 'av01', acodec: 'none', height: 1608, width: 3840, fps: 24, format_note: '2160p' },
        { format_id: '271', vcodec: 'vp9', acodec: 'none', height: 1072, width: 2560, fps: 24, format_note: '1440p' },
        { format_id: '137', vcodec: 'avc1', acodec: 'none', height: 804, width: 1920, fps: 24, format_note: '1080p' },
        { format_id: '140', vcodec: 'none', acodec: 'mp4a.40.2', abr: 128 },
      ],
      true,
    )
    const ids = opts.map((o) => o.id)
    expect(ids.slice(0, 4)).toEqual(['v:best', 'v:2160', 'v:1440', 'v:1080'])
    expect(opts[0].label.startsWith('Best · 4K')).toBe(true)
    expect(opts.find((o) => o.id === 'v:2160')?.sort).toBe('res:1608')
    expect(opts.find((o) => o.id === 'v:1440')?.sort).toBe('res:1072')
    expect(opts.find((o) => o.id === 'v:1080')?.sort).toBe('res:804')
  })
  test('without a note the rung follows the long side: wide 3840×1608 → 2160, portrait 1080×1920 → 1080', () => {
    expect(rungOf({ format_id: 'a', height: 1608, width: 3840 })).toBe(2160)
    expect(rungOf({ format_id: 'b', height: 1920, width: 1080 })).toBe(1080)
    expect(rungOf({ format_id: 'c', height: 1080, width: 1920 })).toBe(1080)
    expect(rungOf({ format_id: 'd', height: 1076 })).toBe(1080)
  })
})
