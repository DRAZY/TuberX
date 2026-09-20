import { describe, expect, test } from 'bun:test'
import { expectedSha256, sha256Hex, verifyEngineDownload } from '../electron/engine/checksum'

const data = new TextEncoder().encode('pretend this is yt-dlp_macos.zip')
const good = sha256Hex(data)
const other = 'a'.repeat(64)
const sums = `${other}  yt-dlp_linux.zip\n${good}  yt-dlp_macos.zip\n${other} *yt-dlp_win.zip\r\n`

describe('engine download verification', () => {
  test('reads the entry for exactly the named file, text or binary (*) mode, CRLF tolerated', () => {
    expect(expectedSha256(sums, 'yt-dlp_macos.zip')).toBe(good)
    expect(expectedSha256(sums, 'yt-dlp_win.zip')).toBe(other)
    expect(expectedSha256(sums, 'yt-dlp_macos')).toBeNull() // no prefix matching
    expect(expectedSha256('not a sums file', 'yt-dlp_macos.zip')).toBeNull()
  })

  test('accepts a download that matches SHA2-256SUMS and the GitHub digest', () => {
    expect(verifyEngineDownload(data, 'yt-dlp_macos.zip', sums, `sha256:${good}`)).toBe(good)
    expect(verifyEngineDownload(data, 'yt-dlp_macos.zip', sums, null)).toBe(good)
    expect(verifyEngineDownload(data, 'yt-dlp_macos.zip', sums, `sha256:${good.toUpperCase()}`)).toBe(good)
  })

  test('rejects a single changed byte', () => {
    const bad = data.slice()
    bad[0] ^= 1
    expect(() => verifyEngineDownload(bad, 'yt-dlp_macos.zip', sums, null)).toThrow(/failed its checksum/)
  })

  test('rejects when the file is not listed, never falling back to "unverified is fine"', () => {
    expect(() => verifyEngineDownload(data, 'yt-dlp_win_arm64.zip', sums, null)).toThrow(/no entry/)
    expect(() => verifyEngineDownload(data, 'yt-dlp_macos.zip', '', null)).toThrow(/no entry/)
  })

  test('rejects when the sums file and GitHub disagree, even if the sums file matches the download', () => {
    expect(() => verifyEngineDownload(data, 'yt-dlp_macos.zip', sums, `sha256:${other}`)).toThrow(/digest GitHub recorded/)
  })
})
