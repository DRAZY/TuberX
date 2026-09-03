import { BrowserWindow, clipboard, dialog, ipcMain, Menu, shell } from 'electron'
import { extractUrls } from '../../shared/urls'
import { randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { app } from 'electron'
import type { AppInfo, LaterEntry, MainEvents, Settings } from '../../shared/types'
import { urlKey } from '../../shared/urls'
import type { TuberDb } from '../db/database'
import { checkAllTools } from '../engine/tools'
import { updateEngine } from '../engine/updater'
import { hasSecret, setSecret } from '../secrets'
import { bestEncoder } from '../engine/encoders'
import { fetchMetadata } from '../engine/ytdlp'
import type { QueueManager } from '../queue/manager'
import { getSettings, patchSettings } from '../settings'

export function send<K extends keyof MainEvents>(event: K, payload: MainEvents[K]) {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send(event, payload)
}

/** Open a finished file in its default application. */
export async function openFile(path: string): Promise<void> {
  if (!existsSync(path)) return send('toast', { kind: 'warn', message: 'That file is no longer there' })
  const err = await shell.openPath(path)
  if (err) send('toast', { kind: 'error', message: err })
}

/** Windows shows its own "Open with" chooser; macOS has no such dialog, so an application picker stands in. */
export async function openWith(path: string, win?: BrowserWindow): Promise<void> {
  if (!existsSync(path)) return send('toast', { kind: 'warn', message: 'That file is no longer there' })
  if (process.platform === 'win32') {
    spawn('rundll32.exe', ['shell32.dll,OpenAs_RunDLL', path], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
    return
  }
  const res = await dialog.showOpenDialog(win!, {
    title: 'Open with',
    defaultPath: '/Applications',
    properties: ['openFile'],
    filters: [{ name: 'Applications', extensions: ['app'] }],
  })
  const appPath = res.filePaths[0]
  if (!appPath) return
  spawn('open', ['-a', appPath, path], { detached: true, stdio: 'ignore' }).unref()
}

// ---- power actions after the queue drains ----
let powerTimer: NodeJS.Timeout | undefined
let powerTick: NodeJS.Timeout | undefined
export function cancelPowerAction(): void {
  if (powerTimer) clearTimeout(powerTimer)
  if (powerTick) clearInterval(powerTick)
  powerTimer = powerTick = undefined
  send('power:countdown', { action: 'sleep', seconds: 0 })
}
/** Sleep or shut down after a 30 s countdown the renderer shows with a Cancel. */
export function schedulePowerAction(action: 'sleep' | 'shutdown'): void {
  cancelPowerAction()
  let left = 30
  send('power:countdown', { action, seconds: left })
  powerTick = setInterval(() => send('power:countdown', { action, seconds: --left }), 1000)
  powerTimer = setTimeout(() => {
    if (powerTick) clearInterval(powerTick)
    powerTimer = powerTick = undefined
    if (process.platform === 'win32') {
      const args = action === 'sleep' ? ['powrprof.dll,SetSuspendState', '0,1,0'] : ['/s', '/t', '5']
      spawn(action === 'sleep' ? 'rundll32.exe' : 'shutdown', args, { detached: true, stdio: 'ignore', windowsHide: true }).unref()
    } else {
      const script = action === 'sleep' ? 'tell application "System Events" to sleep' : 'tell application "System Events" to shut down'
      spawn('osascript', ['-e', script], { detached: true, stdio: 'ignore' }).unref()
    }
  }, 30_000)
}

export function registerIpc(queue: QueueManager, db: TuberDb) {
  queue.on('changed', (rows) => send('queue:changed', rows))
  queue.on('progress', (id, progress) => send('row:progress', { id, progress }))
  queue.on('toast', (kind, message) => send('toast', { kind, message }))
  queue.on('completed', () => send('history:changed', db.listHistory()))
  const laterChanged = () => send('later:changed', db.listLater())

  // ---- queue ----
  ipcMain.handle('queue:add', (_e, urls: string[], download = false) => {
    const settings = getSettings()
    const inLater = urls.filter((u) => db.laterHas(urlKey(u)))
    const result = queue.add(urls, download)
    if (result.duplicates.length)
      send('toast', {
        kind: 'info',
        message:
          result.duplicates.length === urls.length
            ? 'All of these links are already in the list'
            : `${result.duplicates.length} link(s) were already in the list`,
      })
    if (inLater.length && settings.skipIfExists) {
      // Adding to the queue from anywhere removes it from Later
      const ids = db.listLater().filter((l) => inLater.some((u) => urlKey(u) === urlKey(l.url))).map((l) => l.id)
      if (ids.length) {
        db.removeLater(ids)
        laterChanged()
      }
    }
    return result
  })
  ipcMain.handle('queue:remove', (_e, ids: string[]) => queue.remove(ids))
  ipcMain.handle('queue:setFormat', (_e, id: string, formatId: string) => queue.setFormat(id, formatId))
  ipcMain.handle('queue:reorder', (_e, ids: string[]) => queue.reorder(ids))
  ipcMain.handle('queue:setFormatAll', (_e, formatId: string) => queue.setFormatAll(formatId))
  ipcMain.handle('queue:start', (_e, ids: string[]) => queue.start(ids))
  ipcMain.handle('queue:cancel', (_e, id: string) => queue.cancel(id))
  ipcMain.handle('queue:pause', (_e, id: string) => queue.pause(id))
  ipcMain.handle('queue:resume', (_e, id: string) => queue.resume(id))
  ipcMain.handle('queue:retry', (_e, id: string) => queue.retry(id))
  ipcMain.handle('queue:list', () => queue.list())
  ipcMain.handle('queue:expandPlaylist', (_e, rowId: string, urls: string[]) => queue.expandPlaylist(rowId, urls))

  // Right-click paste: the main process reads the clipboard so no renderer permission prompt is involved.
  const pasteClipboard = (download: boolean) => {
    const urls = extractUrls(clipboard.readText())
    if (!urls.length) {
      send('toast', { kind: 'info', message: 'No link on the clipboard' })
      return { found: 0, added: 0 }
    }
    const result = queue.add(urls, download)
    if (result.duplicates.length === urls.length) send('toast', { kind: 'info', message: 'Already in the list' })
    return { found: urls.length, added: result.added }
  }
  ipcMain.handle('queue:pasteClipboard', (_e, download: boolean) => pasteClipboard(download))

  ipcMain.handle('menu:show', (e, kind: 'app' | 'row' | 'edit', rowId?: string) => {
    const win = BrowserWindow.fromWebContents(e.sender) ?? undefined
    if (kind === 'edit') {
      // Standard edit menu for text fields; the Add-links box is the main customer.
      Menu.buildFromTemplate([
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { type: 'separator' },
        { role: 'selectAll' },
      ]).popup({ window: win })
      return
    }
    const hasLink = extractUrls(clipboard.readText()).length > 0
    const row = rowId ? queue.list().find((r) => r.id === rowId) : undefined
    const items: Electron.MenuItemConstructorOptions[] = []
    if (kind === 'row' && row) {
      const canStart = !!row.media && !row.media.isPlaylist && ['ready', 'failed', 'cancelled', 'skipped', 'done'].includes(row.status)
      const active = row.status === 'downloading' || row.status === 'converting' || row.status === 'queued'
      items.push(
        { label: row.status === 'done' ? 'Download again' : row.status === 'paused' ? 'Resume' : 'Download', enabled: canStart, click: () => queue.start([row.id]) },
        { label: 'Pause', enabled: active && row.status !== 'converting', click: () => queue.pause(row.id) },
        { label: 'Stop', enabled: active || row.status === 'paused', click: () => queue.cancel(row.id) },
        { label: 'Copy link', click: () => clipboard.writeText(row.media?.webpageUrl ?? row.url) },
        { label: 'Open page in browser', click: () => void shell.openExternal(row.media?.webpageUrl ?? row.url) },
        { type: 'separator' },
        { label: 'Open file', enabled: !!row.outputPath && row.status === 'done', click: () => void openFile(row.outputPath!) },
        { label: 'Open with…', enabled: !!row.outputPath && row.status === 'done', click: () => void openWith(row.outputPath!, win) },
        { label: 'Reveal in folder', enabled: !!row.outputPath, click: () => shell.showItemInFolder(row.outputPath!) },
        { label: 'Copy file path', enabled: !!row.outputPath, click: () => clipboard.writeText(row.outputPath!) },
        { label: 'Reveal file', enabled: !!row.outputPath, click: () => row.outputPath && shell.showItemInFolder(row.outputPath) },
        { type: 'separator' },
        { label: 'Remove from list', click: () => queue.remove([row.id]) },
        { type: 'separator' },
      )
    }
    items.push(
      { label: 'Paste link', enabled: hasLink, click: () => void pasteClipboard(false) },
      { label: 'Paste link and download', enabled: hasLink, click: () => void pasteClipboard(true) },
      { type: 'separator' },
      { label: 'Select all', accelerator: 'CmdOrCtrl+A', click: () => e.sender.send('ui:selectAll', null) },
      { label: 'Export queue as text…', enabled: queue.list().length > 0, click: () => e.sender.send('ui:export', 'queue') },
      { type: 'separator' },
      { label: 'About TuberX', click: () => e.sender.send('ui:about', null) },
    )
    Menu.buildFromTemplate(items).popup({ window: win })
  })

  // ---- about ----
  ipcMain.handle('app:info', (): AppInfo => ({
    name: app.getName(),
    version: app.getVersion(),
    platform: process.platform === 'darwin' ? 'macOS' : process.platform === 'win32' ? 'Windows' : process.platform,
    arch: process.arch,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    homepage: 'https://github.com/DRAZY/TuberX',
    releases: 'https://github.com/DRAZY/TuberX/releases',
    issues: 'https://github.com/DRAZY/TuberX/issues',
    licenses: 'https://github.com/DRAZY/TuberX/blob/main/THIRD_PARTY_LICENSES.md',
  }))

  // ---- later ----
  ipcMain.handle('later:list', () => db.listLater())
  ipcMain.handle('later:add', async (_e, urls: string[]) => {
    let added = 0
    const fresh: LaterEntry[] = []
    for (const url of urls) {
      const entry: LaterEntry = { id: randomUUID(), url, addedAt: Date.now() }
      if (db.addLater(entry, urlKey(url))) {
        added++
        fresh.push(entry)
      }
    }
    if (!added) send('toast', { kind: 'info', message: 'Already in your Download Later list' })
    else laterChanged()
    // Fill in titles in the background so the list is readable
    void (async () => {
      for (const e of fresh) {
        try {
          const m = await fetchMetadata(e.url, getSettings())
          db.updateLater(e.id, { title: m.title, thumbnail: m.thumbnail, duration: m.duration })
          laterChanged()
        } catch {
          /* keep the bare url */
        }
      }
    })()
    return added
  })
  ipcMain.handle('later:remove', (_e, ids: string[]) => {
    db.removeLater(ids)
    laterChanged()
  })
  ipcMain.handle('later:sendToQueue', (_e, ids: string[]) => {
    const entries = db.getLater(ids)
    queue.add(entries.map((e) => e.url))
    db.removeLater(ids)
    laterChanged()
  })

  // ---- history ----
  ipcMain.handle('history:list', () => db.listHistory())
  ipcMain.handle('history:remove', (_e, ids: string[]) => {
    db.removeHistory(ids)
    send('history:changed', db.listHistory())
  })
  ipcMain.handle('history:clear', () => {
    db.clearHistory()
    send('history:changed', [])
  })

  // ---- settings ----
  const withDerived = (s: Settings): Settings => ({ ...s, hasLoginPassword: hasSecret('loginPassword'), destinations: db.listDestinations() })
  ipcMain.handle('settings:get', () => withDerived(getSettings()))
  ipcMain.handle('settings:setLoginPassword', (_e, password: string) => {
    setSecret('loginPassword', password ?? '')
    return withDerived(getSettings())
  })
  ipcMain.handle('settings:set', (_e, patch: Partial<Settings>) => {
    delete (patch as Partial<Settings>).hasLoginPassword // derived, never stored
    const next = patchSettings(patch)
    if (patch.destination) db.touchDestination(patch.destination)
    return withDerived(next)
  })
  ipcMain.handle('settings:pickDestination', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender) ?? undefined
    const res = await dialog.showOpenDialog(win!, {
      title: 'Choose download folder',
      defaultPath: getSettings().destination,
      properties: ['openDirectory', 'createDirectory'],
    })
    if (res.canceled || !res.filePaths[0]) return null
    const dest = res.filePaths[0]
    patchSettings({ destination: dest })
    db.touchDestination(dest)
    return dest
  })

  ipcMain.handle('settings:pickCookiesFile', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender) ?? undefined
    const res = await dialog.showOpenDialog(win!, {
      title: 'Choose a cookies.txt (Netscape format)',
      filters: [{ name: 'Cookies', extensions: ['txt'] }],
      properties: ['openFile'],
    })
    if (res.canceled || !res.filePaths[0]) return null
    // Keep our own copy: yt-dlp rewrites the file as cookies refresh, and the export can be deleted.
    const dir = join(app.getPath('userData'), 'cookies')
    mkdirSync(dir, { recursive: true })
    const dest = join(dir, 'cookies.txt')
    copyFileSync(res.filePaths[0], dest)
    patchSettings({ cookiesFile: dest })
    return dest
  })
  ipcMain.handle('settings:clearCookiesFile', () => {
    const cur = getSettings().cookiesFile
    if (cur) rmSync(cur, { force: true })
    patchSettings({ cookiesFile: '' })
  })

  // ---- logs ----
  ipcMain.handle('shell:openLogs', async () => {
    const dir = join(app.getPath('userData'), 'logs')
    mkdirSync(dir, { recursive: true })
    await shell.openPath(dir)
  })

  // ---- tools ----
  ipcMain.handle('tools:status', () => checkAllTools())
  ipcMain.handle('tools:encoders', async () => ({ h264: (await bestEncoder('h264'))?.label ?? null, h265: (await bestEncoder('h265'))?.label ?? null }))
  ipcMain.handle('tools:updateEngine', async () => {
    const r = await updateEngine()
    if (r.updated) send('engine:updated', { to: r.version })
    return r
  })

  // ---- shell ----
  ipcMain.handle('shell:reveal', (_e, path: string) => shell.showItemInFolder(path))
  ipcMain.handle('shell:open', (_e, path: string) => void openFile(path))
  ipcMain.handle('shell:openWith', async (e, path: string) => openWith(path, BrowserWindow.fromWebContents(e.sender) ?? undefined))
  ipcMain.handle('power:cancel', () => cancelPowerAction())
  ipcMain.handle('export:links', async (e, kind: 'queue' | 'later' | 'history') => {
    const win = BrowserWindow.fromWebContents(e.sender) ?? undefined
    const lines =
      kind === 'queue' ? queue.list().map((r) => r.media?.webpageUrl ?? r.url)
      : kind === 'later' ? db.listLater().map((l) => l.url)
      : db.listHistory().map((h) => `${h.url}\t${h.outputPath}`)
    if (!lines.length) {
      send('toast', { kind: 'info', message: 'Nothing to export' })
      return null
    }
    const stamp = new Date().toISOString().slice(0, 10)
    const res = await dialog.showSaveDialog(win!, {
      title: `Export ${kind}`,
      defaultPath: join(app.getPath('documents'), `TuberX ${kind} ${stamp}.txt`),
      filters: [{ name: 'Text', extensions: ['txt'] }],
    })
    if (res.canceled || !res.filePath) return null
    writeFileSync(res.filePath, lines.join('\n') + '\n', 'utf8')
    send('toast', { kind: 'success', message: `Saved ${lines.length} link${lines.length === 1 ? '' : 's'}` })
    return res.filePath
  })
  ipcMain.handle('shell:openExternal', (_e, url: string) => {
    if (/^https?:\/\//i.test(url)) return shell.openExternal(url)
  })
}
