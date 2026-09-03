import { chmodSync, existsSync, mkdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { resolveTool, userBinDir } from './paths'
import { run } from './run'

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
    const p = spawn('tar', ['-xf', zip, '-C', dest], { windowsHide: true, stdio: 'ignore' })
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

export async function latestEngineVersion(): Promise<{ version: string; url: string }> {
  const res = await fetch(RELEASE_API, { headers: { 'User-Agent': 'TuberX', Accept: 'application/vnd.github+json' } })
  if (!res.ok) throw new Error(`GitHub API ${res.status}`)
  const json = (await res.json()) as { tag_name: string; assets: { name: string; browser_download_url: string }[] }
  const asset = json.assets.find((a) => a.name === assetName())
  if (!asset) throw new Error(`no asset ${assetName()} in release ${json.tag_name}`)
  return { version: json.tag_name, url: asset.browser_download_url }
}

export async function updateEngine(log: (m: string) => void = () => {}): Promise<{ updated: boolean; version: string }> {
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
  const res = await fetch(latest.url, { headers: { 'User-Agent': 'TuberX' } })
  if (!res.ok) throw new Error(`download ${res.status}`)
  writeFileSync(zip, Buffer.from(await res.arrayBuffer()))
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
