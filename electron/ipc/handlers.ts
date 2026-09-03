import { BrowserWindow, clipboard, dialog, ipcMain, Menu, shell } from 'electron'
import { extractUrls } from '../../shared/urls'
import { randomUUID } from 'node:crypto'
import { copyFileSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { LaterEntry, MainEvents, Settings } from '../../shared/types'
import { urlKey } from '../../shared/urls'
import type { TuberDb } from '../db/database'
import { checkAllTools } from '../engine/tools'
import { updateEngine } from '../engine/updater'
import { fetchMetadata } from '../engine/ytdlp'
import type { QueueManager } from '../queue/manager'
import { getSettings, patchSettings } from '../settings'

export function send<K extends keyof MainEvents>(event: K, payload: MainEvents[K]) {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send(event, payload)
}

export function registerIpc(queue: QueueManager, db: TuberDb) {
  queue.on('changed', (rows) => send('queue:changed', rows))
  queue.on('progress', (id, progress) => send('row:progress', { id, progress }))
  queue.on('toast', (kind, message) => send('toast', { kind, message }))
  queue.on('completed', () => send('history:changed', db.listHistory()))
  const laterChanged = () => send('later:changed', db.listLater())

  // ---- queue ----
  ipcMain.handle('queue:add', (_e, urls: string[]) => {
    const settings = getSettings()
    const inLater = urls.filter((u) => db.laterHas(urlKey(u)))
    const result = queue.add(urls)
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
    const before = new Set(queue.list().map((r) => r.id))
    const result = queue.add(urls)
    if (result.duplicates.length === urls.length) send('toast', { kind: 'info', message: 'Already in the list' })
    if (download) {
      // download once metadata resolves: poll the new rows briefly
      const fresh = queue.list().filter((r) => !before.has(r.id)).map((r) => r.id)
      const tick = () => {
        const rows = queue.list().filter((r) => fresh.includes(r.id))
        const ready = rows.filter((r) => r.status === 'ready' && r.media && !r.media.isPlaylist).map((r) => r.id)
        if (ready.length) queue.start(ready)
        if (rows.some((r) => r.status === 'fetching')) setTimeout(tick, 1000)
      }
      setTimeout(tick, 1000)
    }
    return { found: urls.length, added: result.added }
  }
  ipcMain.handle('queue:pasteClipboard', (_e, download: boolean) => pasteClipboard(download))

  ipcMain.handle('menu:show', (e, kind: 'app' | 'row', rowId?: string) => {
    const win = BrowserWindow.fromWebContents(e.sender) ?? undefined
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
    )
    Menu.buildFromTemplate(items).popup({ window: win })
  })

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
  ipcMain.handle('settings:get', () => ({ ...getSettings(), destinations: db.listDestinations() }))
  ipcMain.handle('settings:set', (_e, patch: Partial<Settings>) => {
    const next = patchSettings(patch)
    if (patch.destination) db.touchDestination(patch.destination)
    return { ...next, destinations: db.listDestinations() }
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

  // ---- tools ----
  ipcMain.handle('tools:status', () => checkAllTools())
  ipcMain.handle('tools:updateEngine', async () => {
    const r = await updateEngine()
    if (r.updated) send('engine:updated', { to: r.version })
    return r
  })

  // ---- shell ----
  ipcMain.handle('shell:reveal', (_e, path: string) => shell.showItemInFolder(path))
  ipcMain.handle('shell:openExternal', (_e, url: string) => {
    if (/^https?:\/\//i.test(url)) return shell.openExternal(url)
  })
}
