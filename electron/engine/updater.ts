import { chmodSync, existsSync, mkdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { resolveTool, userBinDir } from './paths'
import { run } from './run'
import { sysTool } from './systools'
import { ENGINE_RELEASE_PREFIX, verifyEngineDownload } from './checksum'
import { engineLog } from './log'

/**
 * Engine self-update: fetch the latest yt-dlp release from GitHub into userData/bin,
 * independent of app releases. Program Files is read-only so the bundled copy is never touched.
 */
const RELEASE_API = 'https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest'

/** onedir zips: they start in well under a second; the single-file builds unpack a Python runtime per run. */
function assetName(): string {
  if (process.platform === 'win32') return process.arch === 'arm64' ? 'yt-dlp_win_arm64.zip' : 'yt-dlp_win.zip'
  if (process.platform === 'darwin') return 'yt-dlp_macos.zip'
  return 'yt-dlp_linux.zip'
}

function unzip(zip: string, dest: string): Promise<void> {
  // bsdtar ships with Windows 10+ and macOS and reads zip files.
  return new Promise((resolve, reject) => {
    const p = spawn(sysTool('tar'), ['-xf', zip, '-C', dest], { windowsHide: true, stdio: 'ignore' })
    p.on('error', reject)
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`tar exited ${code}`))))
  })
}

export async function currentEngineVersion(): Promise<string | null> {
  const p = resolveTool('yt-dlp')
  if (!p) return null
  const res = await run(p, ['--version'], { timeoutMs: 90000 }).done
  return res.stdout.trim() || null
}

export interface EngineRelease {
  version: string
  url: string
  /** The release's SHA2-256SUMS file. */
  sumsUrl: string
  /** GitHub's own digest for the asset ("sha256:…"), when the API supplies one. */
  apiDigest: string | null
}

export async function latestEngineVersion(): Promise<EngineRelease> {
  const res = await fetch(RELEASE_API, { headers: { 'User-Agent': 'TuberX', Accept: 'application/vnd.github+json' } })
  if (!res.ok) throw new Error(`GitHub API ${res.status}`)
  const json = (await res.json()) as { tag_name: string; assets: { name: string; browser_download_url: string; digest?: string | null }[] }
  const asset = json.assets.find((a) => a.name === assetName())
  if (!asset) throw new Error(`no asset ${assetName()} in release ${json.tag_name}`)
  const sums = json.assets.find((a) => a.name === 'SHA2-256SUMS')
  if (!sums) throw new Error(`release ${json.tag_name} has no SHA2-256SUMS, so the download could not be verified; update not installed`)
  for (const u of [asset.browser_download_url, sums.browser_download_url])
    if (!u.startsWith(ENGINE_RELEASE_PREFIX)) throw new Error(`unexpected download location ${u}; update not installed`)
  return { version: json.tag_name, url: asset.browser_download_url, sumsUrl: sums.browser_download_url, apiDigest: asset.digest ?? null }
}

let inFlight: Promise<{ updated: boolean; version: string }> | null = null

/**
 * One update at a time. The startup check, a self-heal after an extractor error and the Settings button can all
 * ask within the same second; they share one download, one staging folder and one result. Two running together
 * used to unpack into the same folder and fail with "downloaded yt-dlp failed to run".
 */
export function updateEngine(log: (m: string) => void = () => {}): Promise<{ updated: boolean; version: string }> {
  return (inFlight ??= runEngineUpdate(log).finally(() => (inFlight = null)))
}

async function runEngineUpdate(log: (m: string) => void): Promise<{ updated: boolean; version: string }> {
  const current = await currentEngineVersion()
  const latest = await latestEngineVersion()
  if (current === latest.version) return { updated: false, version: latest.version }
  log(`yt-dlp ${current ?? 'missing'} → ${latest.version}`)

  const dir = userBinDir()
  mkdirSync(dir, { recursive: true })
  const exe = process.platform === 'win32' ? '.exe' : ''
  const target = join(dir, 'yt-dlp')
  const staging = join(dir, 'yt-dlp.new')
  const zip = join(dir, 'yt-dlp.download.zip')
  const [res, sumsRes] = await Promise.all([
    fetch(latest.url, { headers: { 'User-Agent': 'TuberX' } }),
    fetch(latest.sumsUrl, { headers: { 'User-Agent': 'TuberX' } }),
  ])
  if (!res.ok) throw new Error(`download ${res.status}`)
  if (!sumsRes.ok) throw new Error(`SHA2-256SUMS download ${sumsRes.status}; update not installed`)
  const data = Buffer.from(await res.arrayBuffer())
  // Verified in memory: an archive that fails never reaches the disk, is never unpacked and is never run.
  try {
    const hash = verifyEngineDownload(data, assetName(), await sumsRes.text(), latest.apiDigest)
    engineLog('engine', `yt-dlp ${latest.version}: ${assetName()} verified, sha256 ${hash}${latest.apiDigest ? ' (SHA2-256SUMS and GitHub digest agree)' : ' (SHA2-256SUMS)'}`)
  } catch (e) {
    engineLog('engine', `yt-dlp ${latest.version}: REJECTED: ${(e as Error).message}`)
    throw e
  }
  writeFileSync(zip, data)
  rmSync(staging, { recursive: true, force: true })
  mkdirSync(staging, { recursive: true })
  await unzip(zip, staging)
  rmSync(zip, { force: true })
  // the macOS zip names its executable yt-dlp_macos; normalise so resolveTool() finds it
  if (process.platform === 'darwin' && existsSync(join(staging, 'yt-dlp_macos'))) renameSync(join(staging, 'yt-dlp_macos'), join(staging, 'yt-dlp'))
  const newExe = join(staging, `yt-dlp${exe}`)
  if (process.platform !== 'win32') chmodSync(newExe, 0o755)

  // Verify the new build actually runs before swapping it in.
  const probe = await run(newExe, ['--version'], { timeoutMs: 90000 }).done
  if (probe.code !== 0 || !probe.stdout.trim()) {
    rmSync(staging, { recursive: true, force: true })
    throw new Error('downloaded yt-dlp failed to run')
  }
  rmSync(target, { recursive: true, force: true })
  rmSync(join(dir, `yt-dlp${exe}`), { force: true }) // pre-0.2.7 single-file copy
  renameSync(staging, target)
  return { updated: true, version: probe.stdout.trim() }
}

/**
 * Pre-0.2.7 engine updates left a single-file yt-dlp in userData/bin, which resolveTool() would still
 * prefer over the bundled onedir build and which costs ~8 s per run. Remove it once; the updater
 * re-downloads the onedir form if a newer version exists.
 */
export function removeLegacySingleFileEngine(): boolean {
  const exe = process.platform === 'win32' ? '.exe' : ''
  const legacy = join(userBinDir(), `yt-dlp${exe}`)
  try {
    if (existsSync(legacy) && statSync(legacy).isFile()) {
      rmSync(legacy, { force: true })
      return true
    }
  } catch {
    /* ignore */
  }
  return false
}
