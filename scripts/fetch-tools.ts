/**
 * Downloads the external tools TuberX spawns into resources/bin/<platform>/.
 *   bun scripts/fetch-tools.ts            → current platform (dev)
 *   bun scripts/fetch-tools.ts win32      → Windows x64 (what the installer bundles)
 *   bun scripts/fetch-tools.ts all
 *   bun scripts/fetch-tools.ts darwin --force --only=ffmpeg --only=ffprobe
 * Idempotent: skips files that already exist unless --force.
 */
import { chmodSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { $ } from 'bun'

type Platform = 'win32' | 'darwin'
const force = process.argv.includes('--force')
const targets: Platform[] = (() => {
  const a = process.argv.find((x) => ['win32', 'darwin', 'all'].includes(x))
  if (a === 'all') return ['win32', 'darwin']
  if (a === 'win32' || a === 'darwin') return [a]
  return [process.platform as Platform]
})()

const ROOT = resolve(import.meta.dir, '..')
const UA = { 'User-Agent': 'TuberX-fetch-tools' }

async function ghLatestAsset(repo: string, match: (name: string) => boolean): Promise<string> {
  const res = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, { headers: { ...UA, Accept: 'application/vnd.github+json' } })
  if (!res.ok) throw new Error(`${repo}: GitHub API ${res.status}`)
  const json = (await res.json()) as { assets: { name: string; browser_download_url: string }[] }
  const asset = json.assets.find((a) => match(a.name))
  if (!asset) throw new Error(`${repo}: no matching asset among ${json.assets.map((a) => a.name).join(', ')}`)
  return asset.browser_download_url
}

async function downloadTo(url: string, dest: string) {
  console.log(`  ↓ ${url}`)
  const res = await fetch(url, { headers: UA, redirect: 'follow' })
  if (!res.ok) throw new Error(`download ${res.status} for ${url}`)
  await Bun.write(dest, await res.arrayBuffer())
}

/** Unpack a onedir yt-dlp zip into <dest>/ (a directory), normalising the executable name. */
async function onedir(url: string, dest: string, exeInZip: string, exeName = exeInZip) {
  const zip = dest + '.zip'
  await downloadTo(url, zip)
  rmSync(dest, { recursive: true, force: true })
  mkdirSync(dest, { recursive: true })
  await $`tar -xf ${zip} -C ${dest}`.quiet()
  if (exeInZip !== exeName) renameSync(join(dest, exeInZip), join(dest, exeName))
  rmSync(zip, { force: true })
}

/** Extract one file (by basename) out of a zip/tar into dest. Uses system unzip/tar (macOS + Linux hosts). */
async function extractOne(archive: string, wantedBase: string, dest: string) {
  const tmp = join(ROOT, 'resources', '.extract')
  rmSync(tmp, { recursive: true, force: true })
  mkdirSync(tmp, { recursive: true })
  if (archive.endsWith('.zip')) await $`unzip -q -o ${archive} -d ${tmp}`.quiet()
  else await $`tar -xf ${archive} -C ${tmp}`.quiet()
  const found = findFile(tmp, wantedBase)
  if (!found) throw new Error(`${wantedBase} not found inside ${archive}`)
  renameSync(found, dest)
  rmSync(tmp, { recursive: true, force: true })
}

function findFile(dir: string, base: string): string | null {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e)
    if (statSync(p).isDirectory()) {
      const r = findFile(p, base)
      if (r) return r
    } else if (e === base) return p
  }
  return null
}

interface ToolSpec {
  file: string
  fetch: (dest: string) => Promise<void>
}

function specs(platform: Platform): ToolSpec[] {
  const exe = platform === 'win32' ? '.exe' : ''
  const tmpZip = (n: string) => join(ROOT, 'resources', `.${n}.download`)
  if (platform === 'win32') {
    return [
      // onedir build: yt-dlp/yt-dlp.exe + yt-dlp/_internal. The single-file exe unpacks a Python runtime
      // into TEMP on every run (~8 s, more under Defender); the onedir form starts in well under a second.
      { file: 'yt-dlp', fetch: async (d) => onedir(await ghLatestAsset('yt-dlp/yt-dlp', (n) => n === 'yt-dlp_win.zip'), d, 'yt-dlp.exe') },
      {
        file: `ffmpeg${exe}`,
        fetch: async (d) => {
          const z = tmpZip('ffmpeg-win')
          await downloadTo('https://github.com/BtbN/FFmpeg-Builds/releases/latest/download/ffmpeg-master-latest-win64-gpl.zip', z)
          await extractOne(z, 'ffmpeg.exe', d)
          rmSync(z, { force: true })
        },
      },
      {
        file: `aria2c${exe}`,
        fetch: async (d) => {
          const z = tmpZip('aria2-win')
          await downloadTo(await ghLatestAsset('aria2/aria2', (n) => /win-64bit.*\.zip$/.test(n)), z)
          await extractOne(z, 'aria2c.exe', d)
          rmSync(z, { force: true })
        },
      },
      {
        file: `deno${exe}`,
        fetch: async (d) => {
          const z = tmpZip('deno-win')
          await downloadTo(await ghLatestAsset('denoland/deno', (n) => n === 'deno-x86_64-pc-windows-msvc.zip'), z)
          await extractOne(z, 'deno.exe', d)
          rmSync(z, { force: true })
        },
      },
    ]
  }
  // darwin: Apple silicon only (Andre, 2026-09-02). ffmpeg/ffprobe come from Martin Riedl's static arm64
  // builds (evermeet.cx ships Intel-only); aria2c is built by scripts/build-aria2-mac.sh.
  return [
    { file: 'yt-dlp', fetch: async (d) => onedir(await ghLatestAsset('yt-dlp/yt-dlp', (n) => n === 'yt-dlp_macos.zip'), d, 'yt-dlp_macos', 'yt-dlp') },
    { file: 'ffmpeg', fetch: (d) => riedlPkg('ffmpeg', d) },
    {
      file: 'deno',
      fetch: async (d) => {
        const z = tmpZip('deno-mac')
        await downloadTo(await ghLatestAsset('denoland/deno', (n) => n === 'deno-aarch64-apple-darwin.zip'), z)
        await extractOne(z, 'deno', d)
        rmSync(z, { force: true })
      },
    },
    {
      file: 'aria2c',
      fetch: async () => {
        throw new Error('run `bash scripts/build-aria2-mac.sh` (no static arm64 macOS build is published upstream)')
      },
    },
  ]
}

/** Martin Riedl publishes static macOS arm64 ffmpeg/ffprobe as .pkg; pull the latest link off the index page. */
async function riedlPkg(tool: 'ffmpeg', dest: string) {
  const html = await (await fetch('https://ffmpeg.martin-riedl.de/', { headers: UA })).text()
  const m = html.match(new RegExp(`href="(/download/macos/arm64/[^"]+/${tool}\\.pkg)"`))
  if (!m) throw new Error(`no macOS arm64 ${tool}.pkg link on ffmpeg.martin-riedl.de`)
  const pkg = join(ROOT, 'resources', `.${tool}-mac.pkg`)
  await downloadTo(`https://ffmpeg.martin-riedl.de${m[1]}`, pkg)
  const tmp = join(ROOT, 'resources', '.extract-pkg')
  rmSync(tmp, { recursive: true, force: true })
  await $`pkgutil --expand-full ${pkg} ${tmp}`.quiet()
  const found = findFile(tmp, tool)
  if (!found) throw new Error(`${tool} not found inside ${pkg}`)
  renameSync(found, dest)
  rmSync(tmp, { recursive: true, force: true })
  rmSync(pkg, { force: true })
}

for (const platform of targets) {
  const dir = join(ROOT, 'resources', 'bin', platform)
  mkdirSync(dir, { recursive: true })
  console.log(`\n[${platform}] → ${dir}`)
  for (const spec of specs(platform)) {
    const dest = join(dir, spec.file)
    const only = process.argv.filter((a) => a.startsWith('--only=')).map((a) => a.slice(7))
    if (only.length && !only.includes(spec.file.replace(/\.exe$/, ''))) continue
    if (existsSync(dest) && !force) {
      console.log(`  ✓ ${spec.file} (exists)`)
      continue
    }
    try {
      await spec.fetch(dest)
      if (existsSync(dest)) {
        if (platform !== 'win32' && statSync(dest).isFile()) chmodSync(dest, 0o755)
        console.log(`  ✓ ${spec.file}`)
      }
    } catch (e) {
      console.error(`  ✗ ${spec.file}: ${(e as Error).message}`)
      process.exitCode = 1
    }
  }
}
