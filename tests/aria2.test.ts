import { describe, expect, test } from 'bun:test'
import { aria2ExitCode, withoutAria2 } from '../electron/engine/aria2'

const aria2Block = ['--downloader', 'C:\\TuberX\\resources\\bin\\aria2c.exe', '--downloader', 'dash,m3u8:native', '--downloader-args', 'aria2c:-c -x 16 -s 16']

describe('aria2c fallback', () => {
  test('reads the exit code yt-dlp reports for aria2c, and nothing else', () => {
    expect(aria2ExitCode('ERROR: aria2c exited with code 22')).toBe(22)
    expect(aria2ExitCode('ERROR: unable to download video data: HTTP Error 403: Forbidden')).toBeNull()
    expect(aria2ExitCode('')).toBeNull()
  })

  test('removes exactly the aria2c hand-off and keeps every other argument in order', () => {
    const before = ['--no-colors', '-f', '251', ...aria2Block, '--limit-rate', '500K', '--', 'https://youtu.be/x']
    expect(withoutAria2(before)).toEqual(['--no-colors', '-f', '251', '--limit-rate', '500K', '--', 'https://youtu.be/x'])
  })

  test('works with a POSIX aria2c path and when the block is last', () => {
    const before = ['-f', '140', '--downloader', '/Applications/TuberX.app/Contents/Resources/bin/aria2c', '--downloader', 'dash,m3u8:native', '--downloader-args', 'aria2c:-x 16']
    expect(withoutAria2(before)).toEqual(['-f', '140'])
  })

  test('leaves arguments after -- alone even if they look like the hand-off', () => {
    expect(withoutAria2(['-f', '18', '--', '--downloader', 'aria2c'])).toEqual(['-f', '18', '--', '--downloader', 'aria2c'])
  })

  test('is a no-op when aria2c was never in the list', () => {
    const plain = ['--no-warnings', '-f', 'bv*+ba', '--', 'https://youtu.be/x']
    expect(withoutAria2(plain)).toEqual(plain)
  })
})
