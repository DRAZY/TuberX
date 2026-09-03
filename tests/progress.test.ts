import { describe, expect, test } from 'bun:test'
import { parseAria2Line, parseEta, parseFinalPath, parseProgressLine, parseSize } from '../shared/progress'

describe('parseProgressLine', () => {
  test('template line → percent, speed, eta', () => {
    const p = parseProgressLine('TXP|52428800|104857600|NA|1048576|50')!
    expect(p.stage).toBe('download')
    expect(p.percent).toBe(50)
    expect(p.speed).toBe(1048576)
    expect(p.eta).toBe(50)
    expect(p.totalBytes).toBe(104857600)
  })
  test('falls back to estimate when total is NA', () => {
    const p = parseProgressLine('TXP|25|NA|100|NA|NA')!
    expect(p.percent).toBe(25)
    expect(p.totalBytes).toBe(100)
  })
  test('post-processing stages', () => {
    expect(parseProgressLine('[Merger] Merging formats into "x.mp4"')?.stage).toBe('merge')
    expect(parseProgressLine('[ExtractAudio] Destination: x.mp3')?.stage).toBe('convert')
    expect(parseProgressLine('[Metadata] Adding metadata to "x.mp4"')?.stage).toBe('tag')
    expect(parseProgressLine('[youtube] abc: Downloading webpage')).toBeNull()
  })
  test('final path marker', () => {
    expect(parseFinalPath('TXOUT|C:\\Users\\a\\Videos\\TuberX\\clip.mp4')).toBe('C:\\Users\\a\\Videos\\TuberX\\clip.mp4')
    expect(parseFinalPath('[download] 100%')).toBeNull()
  })
})

describe('aria2c status lines', () => {
  test('mid-download line → percent, bytes, speed, eta, downloader', () => {
    const p = parseProgressLine('[#975bcf 24MiB/245MiB(9%) CN:16 DL:8.6MiB ETA:25s]')!
    expect(p.downloader).toBe('aria2c')
    expect(p.percent).toBe(9)
    expect(p.downloadedBytes).toBe(24 * 1024 ** 2)
    expect(p.totalBytes).toBe(245 * 1024 ** 2)
    expect(p.speed).toBe(Math.round(8.6 * 1024 ** 2))
    expect(p.eta).toBe(25)
  })
  test('initial line with no totals', () => {
    const p = parseAria2Line('[#975bcf 0B/0B CN:1 DL:0B]')!
    expect(p.percent).toBe(0)
    expect(p.totalBytes).toBeUndefined()
  })
  test('size and eta helpers', () => {
    expect(parseSize('1.5GiB')).toBe(Math.round(1.5 * 1024 ** 3))
    expect(parseSize('12KiB')).toBe(12288)
    expect(parseEta('1m20s')).toBe(80)
    expect(parseEta('1h2m')).toBe(3720)
    expect(parseEta('')).toBeUndefined()
  })
})
