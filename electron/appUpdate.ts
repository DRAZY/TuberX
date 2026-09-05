import { app, powerMonitor, shell } from 'electron'
import { autoUpdater } from 'electron-updater'
import { UPDATE_CHECK_MS, type UpdateStatus } from '../shared/types'
import { getSettings } from './settings'
import { send } from './ipc/handlers'
import { engineLog } from './queue/manager'
import { tm } from './i18n'

/**
 * App updates. The source of truth is GitHub Releases (DRAZY/TuberX): a check 15 s after every launch, then
 * on the schedule the user picked (hourly by default; every six hours, daily, launch only, or never), again
 * when the machine wakes from sleep past the interval, and a manual one from Settings → About. Every result
 * is pushed to the renderer as `update:status` (About badge, Settings dot) and a new version raises a toast
 * with a "Get the update" action, once per version per session. Every check is written to engine.log.
 *
 * Installing: the Windows installer build downloads and applies the update in place (electron-updater).
 * The portable exe and the ad-hoc-signed Mac build cannot be swapped underneath themselves, so for those
 * "Install" opens the release page with the new build.
 */

const REPO = 'DRAZY/TuberX'
const RELEASE_URL = `https://github.com/${REPO}/releases/latest`
let status: UpdateStatus = { state: 'idle', current: app.getVersion() }
let announced = ''
let timer: NodeJS.Timeout | undefined
let listenersReady = false
let lastCheckAt = 0
let resumeHooked = false

const isPortable = process.platform === 'win32' && !!process.env.PORTABLE_EXECUTABLE_DIR
/** In-place install is available only for the packaged Windows installer build. */
export const canInstallInPlace = process.platform === 'win32' && app.isPackaged && !isPortable

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
  if (status.state === 'checking' || status.state === 'downloading') return status
  lastCheckAt = Date.now()
  set({ state: 'checking', error: undefined })
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': `TuberX/${app.getVersion()}` },
      signal: AbortSignal.timeout(20000),
    })
    if (!res.ok) throw new Error(`GitHub ${res.status}`)
    const rel = (await res.json()) as { tag_name: string; html_url: string; published_at: string; body?: string }
    const latest = rel.tag_name.replace(/^v/, '')
    const current = process.env.TUBERX_FAKE_VERSION || app.getVersion()
    if (newer(latest, current)) {
      set({ state: 'available', latest, url: rel.html_url || RELEASE_URL, publishedAt: rel.published_at, notes: rel.body?.slice(0, 2000) })
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

/** Download and apply (Windows installer), or open the release page for the new build. */
export async function installUpdate(): Promise<void> {
  if (status.state !== 'available' && status.state !== 'ready') return
  if (!canInstallInPlace) {
    await shell.openExternal(status.url ?? RELEASE_URL)
    return
  }
  if (status.state === 'ready') {
    setImmediate(() => autoUpdater.quitAndInstall())
    return
  }
  wireUpdater()
  set({ state: 'downloading', progress: 0 })
  try {
    const r = await autoUpdater.checkForUpdates()
    if (!r?.updateInfo || !newer(r.updateInfo.version, app.getVersion())) throw new Error('installer feed has no newer build yet')
    await autoUpdater.downloadUpdate()
  } catch (e) {
    set({ state: 'available', error: (e as Error).message, progress: undefined })
    send('toast', { kind: 'warn', message: `Could not download the update: ${(e as Error).message}` })
  }
}

function wireUpdater(): void {
  if (listenersReady) return
  listenersReady = true
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('download-progress', (p) => set({ state: 'downloading', progress: Math.round(p.percent) }))
  autoUpdater.on('update-downloaded', (info) => {
    set({ state: 'ready', latest: info.version, progress: 100 })
    send('toast', { kind: 'success', message: `TuberX ${info.version} downloaded. Restart to install.` })
  })
  autoUpdater.on('error', (err) => set({ state: status.latest ? 'available' : 'error', error: err.message, progress: undefined }))
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
