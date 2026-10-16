import { expectedSha256 } from './engine/checksum'

/**
 * Pure decisions behind app updates (no Electron imports, so they are unit-tested in tests/updatePlan.test.ts).
 */

/** Apple Team ID the Developer ID builds are signed with. */
export const TEAM_ID = 'W966GFT83K'

/**
 * How an update gets onto this machine.
 * - installer: Windows NSIS build; electron-updater downloads and runs the installer silently, then relaunches.
 * - mac: Developer-ID-signed Mac build; electron-updater + Squirrel.Mac swap the bundle and relaunch.
 * - portable: Windows portable exe in a writable folder; TuberX downloads, verifies and swaps the exe itself.
 * - manual: open the release page; `reason` says why, so the UI can explain it.
 */
export type InstallMode =
  | { kind: 'installer' | 'mac' | 'portable' }
  | { kind: 'manual'; reason: ManualReason }
export type ManualReason = 'unsigned' | 'readonly' | 'dev' | 'unsupported'

export interface InstallEnv {
  platform: NodeJS.Platform
  packaged: boolean
  /** Windows portable: the exe the user started (PORTABLE_EXECUTABLE_FILE), else undefined. */
  portableExe?: string
  /** macOS: is the running bundle signed with our Developer ID? */
  developerIdSigned?: boolean
  /** Windows portable: can TuberX write next to its exe? */
  portableDirWritable?: boolean
}

export function installMode(env: InstallEnv): InstallMode {
  if (!env.packaged) return { kind: 'manual', reason: 'dev' }
  if (env.platform === 'win32') {
    if (!env.portableExe) return { kind: 'installer' }
    return env.portableDirWritable ? { kind: 'portable' } : { kind: 'manual', reason: 'readonly' }
  }
  if (env.platform === 'darwin') {
    // Squirrel.Mac installs an update only when it satisfies the running app's designated requirement. An ad-hoc
    // build's requirement is its own cdhash, which no other build can match, so ad-hoc builds update by hand once.
    return env.developerIdSigned ? { kind: 'mac' } : { kind: 'manual', reason: 'unsigned' }
  }
  return { kind: 'manual', reason: 'unsupported' }
}

/**
 * Read `codesign -dv --verbose=2 <app>` output (codesign prints it on stderr): true only for a real Developer ID
 * Application signature from our team, never for ad-hoc or another team's certificate.
 */
export function isDeveloperIdSigned(codesignDisplay: string, teamId = TEAM_ID): boolean {
  if (/^Signature=adhoc$/m.test(codesignDisplay)) return false
  const team = codesignDisplay.match(/^TeamIdentifier=(\S+)$/m)?.[1]
  const leaf = codesignDisplay.match(/^Authority=(.+)$/m)?.[1] ?? ''
  return team === teamId && leaf.startsWith('Developer ID Application:') && leaf.endsWith(`(${teamId})`)
}

export interface ReleaseAsset {
  name: string
  browser_download_url: string
  /** "sha256:<hex>", recorded by GitHub when the asset was uploaded. */
  digest?: string | null
  size?: number
}

/** Releases are published from github.com/DRAZY/TuberX only; anything else is refused before download. */
export const RELEASE_DOWNLOAD_PREFIX = 'https://github.com/DRAZY/TuberX/releases/download/'

/** The portable exe in a release (TuberX-Portable-<version>-x64.exe) and its optional .sha256 companion. */
export function portableAssets(assets: ReleaseAsset[], arch = 'x64'): { exe: ReleaseAsset; sums: ReleaseAsset | null } | null {
  const exe = assets.find((a) => new RegExp(`^TuberX-Portable-[\\w.-]+-${arch}\\.exe$`).test(a.name))
  if (!exe || !exe.browser_download_url.startsWith(RELEASE_DOWNLOAD_PREFIX)) return null
  const sums = assets.find((a) => a.name === `${exe.name}.sha256` && a.browser_download_url.startsWith(RELEASE_DOWNLOAD_PREFIX)) ?? null
  return { exe, sums }
}

/**
 * Accept a downloaded release file only when its SHA-256 matches every published statement of it: GitHub's asset
 * digest and the release's `<name>.sha256` file. At least one must exist; with neither, nothing is installed.
 */
export function verifyReleaseFile(actualSha256: string, fileName: string, sumsText: string | null, apiDigest: string | null | undefined): string {
  const actual = actualSha256.toLowerCase()
  const api = apiDigest?.startsWith('sha256:') ? apiDigest.slice(7).toLowerCase() : null
  const listed = sumsText != null ? expectedSha256(sumsText, fileName) : null
  if (sumsText != null && !listed) throw new Error(`${fileName}.sha256 does not list ${fileName}; update not installed`)
  if (!api && !listed) throw new Error(`the release publishes no checksum for ${fileName}; update not installed`)
  if (listed && listed !== actual) throw new Error(`${fileName} failed its checksum (.sha256 says ${listed.slice(0, 12)}…, download is ${actual.slice(0, 12)}…); update not installed`)
  if (api && api !== actual) throw new Error(`${fileName} does not match the digest GitHub recorded (${api.slice(0, 12)}… vs ${actual.slice(0, 12)}…); update not installed`)
  return actual
}

/** Where the portable exe being replaced is parked until the next start deletes it. */
export function parkedExePath(exe: string): string {
  return `${exe}.old`
}
