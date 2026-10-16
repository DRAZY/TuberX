import { describe, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { installMode, isDeveloperIdSigned, parkedExePath, portableAssets, verifyReleaseFile, RELEASE_DOWNLOAD_PREFIX } from '../electron/updatePlan'
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { toolEntitlements } = require('../scripts/mac-sign.cjs') as { toolEntitlements: (app: string, file: string) => string | null }

const DEVID = `Executable=/Applications/TuberX.app/Contents/MacOS/TuberX
Identifier=dev.drazy.tuberx
Format=app bundle with Mach-O thin (arm64)
CodeDirectory v=20500 size=1234 flags=0x10000(runtime) hashes=28+7 location=embedded
Signature size=9000
Authority=Developer ID Application: Andre Hall (W966GFT83K)
Authority=Developer ID Certification Authority
Authority=Apple Root CA
Timestamp=15 Oct 2026 at 22:00:00
TeamIdentifier=W966GFT83K`
const ADHOC = `Executable=/Applications/TuberX.app/Contents/MacOS/TuberX
Identifier=dev.drazy.tuberx
CodeDirectory v=20400 size=1234 flags=0x20002(adhoc,linker-signed) hashes=28+7 location=embedded
Signature=adhoc
TeamIdentifier=not set`

describe('install mode', () => {
  test('Mac: in place only for a Developer-ID build; an ad-hoc build gets the one-time manual download', () => {
    expect(installMode({ platform: 'darwin', packaged: true, developerIdSigned: true })).toEqual({ kind: 'mac' })
    expect(installMode({ platform: 'darwin', packaged: true, developerIdSigned: false })).toEqual({ kind: 'manual', reason: 'unsigned' })
  })
  test('Windows: installer in place; portable in place only when its folder is writable', () => {
    expect(installMode({ platform: 'win32', packaged: true })).toEqual({ kind: 'installer' })
    expect(installMode({ platform: 'win32', packaged: true, portableExe: 'D:\\TuberX.exe', portableDirWritable: true })).toEqual({ kind: 'portable' })
    expect(installMode({ platform: 'win32', packaged: true, portableExe: 'D:\\TuberX.exe', portableDirWritable: false })).toEqual({ kind: 'manual', reason: 'readonly' })
  })
  test('dev runs and other platforms never install in place', () => {
    expect(installMode({ platform: 'darwin', packaged: false, developerIdSigned: true })).toEqual({ kind: 'manual', reason: 'dev' })
    expect(installMode({ platform: 'linux', packaged: true })).toEqual({ kind: 'manual', reason: 'unsupported' })
  })
})

describe('Developer ID detection (codesign -dv output)', () => {
  test('accepts our Developer ID Application signature', () => expect(isDeveloperIdSigned(DEVID)).toBe(true))
  test('rejects ad-hoc', () => expect(isDeveloperIdSigned(ADHOC)).toBe(false))
  test("rejects another team's Developer ID", () => {
    expect(isDeveloperIdSigned(DEVID.replaceAll('W966GFT83K', 'ABCDE12345'))).toBe(false)
  })
  test('rejects a development certificate from our team', () => {
    expect(isDeveloperIdSigned(DEVID.replace('Developer ID Application:', 'Apple Development:'))).toBe(false)
  })
  test('rejects empty output (codesign missing or failed)', () => expect(isDeveloperIdSigned('')).toBe(false))
})

const sha = (s: string) => createHash('sha256').update(s).digest('hex')
const asset = (name: string, digest?: string) => ({ name, browser_download_url: `${RELEASE_DOWNLOAD_PREFIX}v0.4.0/${name}`, digest })

describe('portable self-update', () => {
  const assets = [
    asset('TuberX-Setup-0.4.0-x64.exe'),
    asset('TuberX-Portable-0.4.0-x64.exe', `sha256:${sha('exe')}`),
    asset('TuberX-Portable-0.4.0-x64.exe.sha256'),
    asset('TuberX-0.4.0-arm64.dmg'),
  ]
  test('picks the portable exe and its .sha256, not the installer', () => {
    const r = portableAssets(assets)
    expect(r?.exe.name).toBe('TuberX-Portable-0.4.0-x64.exe')
    expect(r?.sums?.name).toBe('TuberX-Portable-0.4.0-x64.exe.sha256')
  })
  test('refuses an asset hosted anywhere but this repo’s releases', () => {
    expect(portableAssets([{ name: 'TuberX-Portable-0.4.0-x64.exe', browser_download_url: 'https://evil.example/TuberX-Portable-0.4.0-x64.exe' }])).toBeNull()
    expect(portableAssets([asset('TuberX-Setup-0.4.0-x64.exe')])).toBeNull()
  })

  const name = 'TuberX-Portable-0.4.0-x64.exe'
  const good = sha('exe')
  const sums = `${good}  ${name}\n`
  test('accepts when GitHub digest and .sha256 agree with the download', () => {
    expect(verifyReleaseFile(good, name, sums, `sha256:${good}`)).toBe(good)
  })
  test('accepts either statement alone', () => {
    expect(verifyReleaseFile(good, name, null, `sha256:${good}`)).toBe(good)
    expect(verifyReleaseFile(good, name, sums, null)).toBe(good)
  })
  test('refuses when nothing states the expected hash', () => {
    expect(() => verifyReleaseFile(good, name, null, null)).toThrow(/no checksum/)
  })
  test('refuses a mismatch against either statement', () => {
    expect(() => verifyReleaseFile(sha('tampered'), name, sums, `sha256:${good}`)).toThrow(/failed its checksum/)
    expect(() => verifyReleaseFile(sha('tampered'), name, null, `sha256:${good}`)).toThrow(/digest GitHub recorded/)
    expect(() => verifyReleaseFile(good, name, sums, `sha256:${sha('other')}`)).toThrow(/digest GitHub recorded/)
  })
  test('refuses a .sha256 that lists a different file', () => {
    expect(() => verifyReleaseFile(good, name, `${good}  TuberX-Portable-0.3.0-x64.exe\n`, `sha256:${good}`)).toThrow(/does not list/)
  })
  test('parks the old exe beside the new one', () => expect(parkedExePath('D:\\Apps\\TuberX.exe')).toBe('D:\\Apps\\TuberX.exe.old'))
})

describe('mac-sign hook: per-tool entitlements', () => {
  const appPath = '/tmp/release/mac-arm64/TuberX.app'
  const res = (...p: string[]) => join(appPath, 'Contents', 'Resources', ...p)
  test('deno gets the JIT profile, every other bundled tool the empty one', () => {
    expect(toolEntitlements(appPath, res('bin', 'deno'))).toMatch(/entitlements\.mac\.deno\.plist$/)
    for (const f of [res('bin', 'ffmpeg'), res('bin', 'aria2c'), res('bin', 'yt-dlp', 'yt-dlp'), res('bin', 'yt-dlp', '_internal', 'Python.framework'), res('pot', 'server', 'node_modules', 'canvas', 'build', 'Release', 'canvas.node')])
      expect(toolEntitlements(appPath, f)).toMatch(/entitlements\.mac\.tool\.plist$/)
  })
  test('Electron itself keeps electron-builder’s entitlements', () => {
    expect(toolEntitlements(appPath, appPath)).toBeNull()
    expect(toolEntitlements(appPath, join(appPath, 'Contents', 'Frameworks', 'TuberX Helper (Renderer).app'))).toBeNull()
    expect(toolEntitlements(appPath, res('app.asar'))).toBeNull()
  })
})
