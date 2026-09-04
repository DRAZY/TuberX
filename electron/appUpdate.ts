import { app, shell } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { UpdateStatus } from '../shared/types'
import { getSettings } from './settings'
import { send } from './ipc/handlers'

/**
 * App updates. The source of truth is GitHub Releases (DRAZY/TuberX): a launch-time check, a check every
 * six hours, and a manual one from Settings → About. Every result is pushed to the renderer as
 * `update:status`, so the About section and the title bar can show "0.3.2 available".
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
      if (announced !== latest) {
        announced = latest
        send('toast', { kind: 'info', message: `TuberX ${latest} is available` })
      }
    } else set({ state: 'none', latest, checkedAt: Date.now() })
  } catch (e) {
    set({ state: 'error', error: (e as Error).message })
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

/** Launch-time check after the window is up, then every six hours, while the setting is on. */
export function scheduleUpdateChecks(): void {
  if (timer) clearInterval(timer)
  const tick = () => {
    if (getSettings().autoCheckUpdates) void checkForUpdate(false)
  }
  setTimeout(tick, 15_000)
  timer = setInterval(tick, 6 * 60 * 60 * 1000)
}
