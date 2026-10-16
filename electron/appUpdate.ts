import { app, autoUpdater as nativeUpdater, powerMonitor, shell } from 'electron'
import { autoUpdater } from 'electron-updater'
import { createHash } from 'node:crypto'
import { createWriteStream, existsSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { UPDATE_CHECK_MS, type UpdateStatus } from '../shared/types'
import { getSettings } from './settings'
import { send } from './ipc/handlers'
import { engineLog } from './queue/manager'
import { tm } from './i18n'
import { run } from './engine/run'
import { sysTool } from './engine/systools'
import { installMode, isDeveloperIdSigned, parkedExePath, portableAssets, verifyReleaseFile, type InstallMode, type ReleaseAsset } from './updatePlan'

/**
 * App updates. The source of truth is GitHub Releases (DRAZY/TuberX): a check 15 s after every launch, then
 * on the schedule the user picked (hourly by default; every six hours, daily, launch only, or never), again
 * when the machine wakes from sleep past the interval, and a manual one from Settings → About. Every result
 * is pushed to the renderer as `update:status` (About badge, Settings dot) and a new version raises a toast
 * with an action, once per version per session. Every check and install step is written to engine.log.
 *
 * Installing (see updatePlan.installMode): "Install" downloads with progress, then restarts into the new
 * version by itself; if downloads are running it waits and offers "Restart to install" instead.
 * - Windows installer build: electron-updater fetches the NSIS installer and runs it silently, then relaunches.
 * - macOS, Developer ID build: electron-updater fetches the zip (latest-mac.yml), Squirrel.Mac verifies it
 *   against this app's code signature, swaps the bundle and relaunches.
 * - Windows portable exe: TuberX fetches the new exe, checks its SHA-256 against GitHub's asset digest and the
 *   release's .sha256, renames the running exe aside (Windows allows that), moves the new one into its place
 *   and relaunches it; the parked old exe is deleted on the next start.
 * - Otherwise "Get the update" opens the release page: ad-hoc-signed Mac builds (Squirrel.Mac cannot accept a
 *   differently signed update, so the move to the Developer ID build is a one-time manual download), a portable
 *   exe in a folder TuberX cannot write to, and any in-place install that failed.
 */

const REPO = 'DRAZY/TuberX'
const RELEASE_URL = `https://github.com/${REPO}/releases/latest`
let status: UpdateStatus = { state: 'idle', current: app.getVersion() }
let announced = ''
let timer: NodeJS.Timeout | undefined
let listenersReady = false
let lastCheckAt = 0
let resumeHooked = false
/** Assets of the newest release seen by the last check (the portable self-update downloads from these). */
let latestAssets: ReleaseAsset[] = []
/** Set by Install: restart on our own once the download is ready (unless downloads are running). */
let restartWhenReady = false
/** An in-place install failed this session: fall back to the release page until the next launch. */
let inPlaceFailed = false
let isBusy: () => boolean = () => false
let modePromise: Promise<InstallMode> | undefined

const portableExe = process.platform === 'win32' ? process.env.PORTABLE_EXECUTABLE_FILE : undefined

/** main.ts tells us whether downloads are running, so a finished update never cuts one off. */
export function setUpdateBusyCheck(fn: () => boolean): void {
  isBusy = fn
}

function dirWritable(dir: string): boolean {
  const probe = join(dir, `.tuberx-write-test-${process.pid}`)
  try {
    writeFileSync(probe, '')
    unlinkSync(probe)
    return true
  } catch {
    return false
  }
}

async function macDeveloperIdSigned(): Promise<boolean> {
  // process.execPath = <bundle>.app/Contents/MacOS/TuberX
  const bundle = resolve(process.execPath, '..', '..', '..')
  try {
    const r = await run(sysTool('codesign'), ['-dv', '--verbose=2', bundle], { timeoutMs: 15000 }).done
    return isDeveloperIdSigned(`${r.stdout}\n${r.stderr}`)
  } catch (e) {
    engineLog('update', `codesign check failed: ${(e as Error).message}`)
    return false
  }
}

/** How this build installs updates; computed once (the codesign check takes a moment). */
export function updateInstallMode(): Promise<InstallMode> {
  return (modePromise ??= (async () => {
    const mode = installMode({
      platform: process.platform,
      packaged: app.isPackaged,
      portableExe,
      developerIdSigned: process.platform === 'darwin' && app.isPackaged ? await macDeveloperIdSigned() : undefined,
      portableDirWritable: portableExe ? dirWritable(dirname(portableExe)) : undefined,
    })
    engineLog('update', `install mode: ${mode.kind}${mode.kind === 'manual' ? ` (${mode.reason})` : ''}`)
    return mode
  })())
}

/** True when "Install" updates in place (as opposed to opening the release page). */
export async function canInstallInPlace(): Promise<boolean> {
  return !inPlaceFailed && (await updateInstallMode()).kind !== 'manual'
}

function set(next: Partial<UpdateStatus>): void {
  status = { ...status, ...next, current: app.getVersion() }
  send('update:status', status)
}
export function updateStatus(): UpdateStatus {
  return status
}

/** "0.3.2" > "0.3.1" by numeric parts; pre-release suffixes are ignored. */
export function newer(a: string, b: string): boolean {
  const pa = a.replace(/^v/, '').split(/[.-]/).map((n) => Number(n) || 0)
  const pb = b.replace(/^v/, '').split(/[.-]/).map((n) => Number(n) || 0)
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0)
  return false
}

/** Ask GitHub for the latest release; resolves to the new version or null when current. */
export async function checkForUpdate(manual = false): Promise<UpdateStatus> {
  if (status.state === 'checking' || status.state === 'downloading' || status.state === 'ready') return status
  lastCheckAt = Date.now()
  set({ state: 'checking', error: undefined })
  try {
    const mode = await updateInstallMode()
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': `TuberX/${app.getVersion()}` },
      signal: AbortSignal.timeout(20000),
    })
    if (!res.ok) throw new Error(`GitHub ${res.status}`)
    const rel = (await res.json()) as { tag_name: string; html_url: string; published_at: string; body?: string; assets?: ReleaseAsset[] }
    const latest = rel.tag_name.replace(/^v/, '')
    const current = process.env.TUBERX_FAKE_VERSION || app.getVersion()
    latestAssets = rel.assets ?? []
    if (newer(latest, current)) {
      set({
        state: 'available',
        latest,
        url: rel.html_url || RELEASE_URL,
        publishedAt: rel.published_at,
        notes: rel.body?.slice(0, 2000),
        manualReason: inPlaceFailed ? 'failed' : mode.kind === 'manual' ? mode.reason : undefined,
      })
      engineLog('update', `check (${manual ? 'manual' : 'scheduled'}): ${latest} available, running ${current}`)
      if (announced !== latest) {
        announced = latest
        send('toast', { kind: 'info', message: tm('update.toast', { version: latest }), action: 'update' })
      }
    } else {
      set({ state: 'none', latest, checkedAt: Date.now() })
      engineLog('update', `check (${manual ? 'manual' : 'scheduled'}): up to date, ${current} is the latest release`)
    }
  } catch (e) {
    set({ state: 'error', error: (e as Error).message })
    engineLog('update', `check (${manual ? 'manual' : 'scheduled'}) failed: ${(e as Error).message}`)
    if (manual) send('toast', { kind: 'warn', message: `Update check failed: ${(e as Error).message}` })
  }
  return status
}

/** Install button: download and restart into the new version, or open the release page for a manual install. */
export async function installUpdate(): Promise<void> {
  if (status.state === 'ready') return restartNow()
  if (status.state !== 'available') return
  if (!(await canInstallInPlace())) {
    await shell.openExternal(status.url ?? RELEASE_URL)
    return
  }
  const mode = await updateInstallMode()
  restartWhenReady = true
  set({ state: 'downloading', progress: 0, error: undefined })
  try {
    if (mode.kind === 'portable') await downloadPortable()
    else await downloadWithUpdater()
  } catch (e) {
    failInPlace(e as Error)
  }
}

/** An in-place install went wrong: say so, keep the app running, and offer the release page instead. */
function failInPlace(err: Error): void {
  inPlaceFailed = true
  restartWhenReady = false
  engineLog('update', `in-place install failed: ${err.message}`)
  set({ state: 'available', progress: undefined, error: err.message, manualReason: 'failed' })
  send('toast', { kind: 'warn', message: tm('update.installFailed', { error: err.message }), action: 'update' })
}

/** The download is complete and verified. */
function downloaded(version: string): void {
  set({ state: 'ready', latest: version, progress: 100 })
  engineLog('update', `${version} downloaded and verified`)
  if (restartWhenReady && !isBusy()) {
    send('toast', { kind: 'info', message: tm('update.restarting', { version }) })
    setTimeout(() => restartNow(), 1500)
  } else {
    send('toast', { kind: 'success', message: tm('update.readyToast', { version }), action: 'update' })
  }
}

let pendingRestart: (() => void) | undefined
function restartNow(): void {
  if (status.state !== 'ready') return
  engineLog('update', `restarting into ${status.latest}`)
  if (pendingRestart) return pendingRestart()
  // Windows installer: silent install, then start the new version. macOS: Squirrel.Mac swaps and relaunches.
  setImmediate(() => autoUpdater.quitAndInstall(true, true))
}

// ---- electron-updater (Windows installer, macOS Developer ID) ----

function wireUpdater(): void {
  if (listenersReady) return
  listenersReady = true
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.logger = { info: (m: unknown) => engineLog('update', `updater: ${m}`), warn: (m: unknown) => engineLog('update', `updater warn: ${m}`), error: (m: unknown) => engineLog('update', `updater error: ${m}`), debug: () => {} }
  autoUpdater.on('download-progress', (p) => set({ state: 'downloading', progress: Math.min(99, Math.round(p.percent)) }))
  if (process.platform === 'darwin') {
    // electron-updater reports the zip as downloaded before Squirrel.Mac has taken it and checked its code
    // signature against this app; ready means Squirrel accepted it, so a mismatch surfaces before any restart.
    let version = ''
    autoUpdater.on('update-downloaded', (info) => {
      version = info.version
      engineLog('update', `${info.version} zip downloaded; handing it to Squirrel.Mac`)
    })
    nativeUpdater.on('update-downloaded', () => downloaded(version || status.latest || ''))
  } else {
    autoUpdater.on('update-downloaded', (info) => downloaded(info.version))
  }
  autoUpdater.on('error', (err) => {
    if (status.state === 'downloading' || status.state === 'ready') failInPlace(err)
    else engineLog('update', `updater error: ${err.message}`)
  })
}

async function downloadWithUpdater(): Promise<void> {
  wireUpdater()
  const r = await autoUpdater.checkForUpdates()
  if (!r?.updateInfo || !newer(r.updateInfo.version, app.getVersion())) throw new Error(tm('update.noFeed'))
  await autoUpdater.downloadUpdate()
  // 'update-downloaded' follows; Squirrel.Mac has verified the signature by the time quitAndInstall runs.
}

// ---- Windows portable self-update ----

async function downloadPortable(): Promise<void> {
  const exe = portableExe as string
  const found = portableAssets(latestAssets)
  if (!found) throw new Error(tm('update.noPortableAsset'))
  const { exe: asset, sums } = found
  const version = status.latest ?? ''
  const staging = join(dirname(exe), `.${asset.name}.download`)
  rmSync(staging, { force: true })
  engineLog('update', `portable: downloading ${asset.name}`)
  const sumsText = sums ? await (await fetchOk(sums.browser_download_url)).text() : null
  const res = await fetchOk(asset.browser_download_url)
  const total = Number(res.headers.get('content-length')) || asset.size || 0
  const hash = createHash('sha256')
  const out = createWriteStream(staging)
  let got = 0
  let lastPct = -1
  try {
    const reader = (res.body as ReadableStream<Uint8Array>).getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      hash.update(value)
      if (!out.write(value)) await new Promise<void>((r) => out.once('drain', () => r()))
      got += value.length
      const pct = total ? Math.min(99, Math.floor((got / total) * 100)) : 0
      if (pct !== lastPct) set({ state: 'downloading', progress: (lastPct = pct) })
    }
    await new Promise<void>((ok, fail) => out.end((err?: Error | null) => (err ? fail(err) : ok())))
    const sha = verifyReleaseFile(hash.digest('hex'), asset.name, sumsText, asset.digest)
    engineLog('update', `portable: ${asset.name} verified, sha256 ${sha}`)
  } catch (e) {
    out.destroy()
    rmSync(staging, { force: true })
    throw e
  }
  pendingRestart = () => swapPortableAndRelaunch(exe, staging)
  downloaded(version)
}

async function fetchOk(url: string): Promise<Response> {
  const res = await fetch(url, { headers: { 'User-Agent': `TuberX/${app.getVersion()}` }, redirect: 'follow' })
  if (!res.ok || !res.body) throw new Error(`download ${res.status} for ${url.split('/').pop()}`)
  return res
}

function swapPortableAndRelaunch(exe: string, staging: string): void {
  const parked = parkedExePath(exe)
  try {
    rmSync(parked, { force: true })
    renameSync(exe, parked) // Windows lets a running exe be renamed, not overwritten
    try {
      renameSync(staging, exe)
    } catch (e) {
      renameSync(parked, exe) // put the working exe back
      throw e
    }
  } catch (e) {
    pendingRestart = undefined
    rmSync(staging, { force: true })
    failInPlace(e as Error)
    return
  }
  engineLog('update', `portable: ${exe} replaced; relaunching`)
  app.relaunch({ execPath: exe })
  app.quit()
}

/** Portable build: delete the exe parked by the last self-update and any half-finished download. */
export function cleanupPortableUpdate(): void {
  if (!portableExe) return
  const parked = parkedExePath(portableExe)
  const attempt = (left: number) => {
    if (!existsSync(parked)) return
    try {
      rmSync(parked, { force: true })
      engineLog('update', `portable: removed ${parked}`)
    } catch {
      // the old launcher can hold its file for a few seconds after the relaunch
      if (left > 0) setTimeout(() => attempt(left - 1), 10_000)
    }
  }
  attempt(6)
}

/**
 * Launch-time check 15 s after the window is up (unless the setting is "never"), then on the chosen
 * interval. Called again whenever the setting changes, so a new schedule takes effect at once.
 */
export function scheduleUpdateChecks(launch = true): void {
  if (timer) clearInterval(timer)
  timer = undefined
  const every = getSettings().updateCheckEvery
  const interval = UPDATE_CHECK_MS[every] ?? 0
  if (launch && every !== 'never') setTimeout(() => void checkForUpdate(false), 15_000)
  if (interval > 0) timer = setInterval(() => void checkForUpdate(false), interval)
  engineLog('update', `schedule: ${every}${interval ? ` (every ${Math.round(interval / 60000)} min)` : ''}`)
  if (!resumeHooked) {
    resumeHooked = true
    // A laptop asleep for the night should not wait another full interval after it wakes.
    powerMonitor.on('resume', () => {
      const ms = UPDATE_CHECK_MS[getSettings().updateCheckEvery] ?? 0
      if (ms > 0 && Date.now() - lastCheckAt > ms) void checkForUpdate(false)
    })
  }
}
