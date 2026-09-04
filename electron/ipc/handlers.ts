import { BrowserWindow, clipboard, dialog, ipcMain, Menu, shell } from 'electron'
import { extractUrls } from '../../shared/urls'
import { randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { basename, join } from 'node:path'
import { app } from 'electron'
import type { AppInfo, LaterEntry, MainEvents, Settings, Subscription } from '../../shared/types'
import { urlKey } from '../../shared/urls'
import type { TuberDb } from '../db/database'
import { checkAllTools } from '../engine/tools'
import { updateEngine } from '../engine/updater'
import { hasSecret, setSecret } from '../secrets'
import { bestEncoder } from '../engine/encoders'
import { exportSegment, splitByMarks, writeChapters } from '../engine/transcode'
import { mediaUrl } from '../media'
import { engineLog } from '../queue/manager'
import { fetchMetadata } from '../engine/ytdlp'
import type { QueueManager } from '../queue/manager'
import { getSettings, patchSettings } from '../settings'
import { tm } from '../i18n'

export function send<K extends keyof MainEvents>(event: K, payload: MainEvents[K]) {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send(event, payload)
}

/** Open a finished file in its default application. */
export async function openFile(path: string): Promise<void> {
  if (!existsSync(path)) return send('toast', { kind: 'warn', message: tm('toast.fileGone') })
  const err = await shell.openPath(path)
  if (err) send('toast', { kind: 'error', message: err })
}

/** Windows shows its own "Open with" chooser; macOS has no such dialog, so an application picker stands in. */
export async function openWith(path: string, win?: BrowserWindow): Promise<void> {
  if (!existsSync(path)) return send('toast', { kind: 'warn', message: tm('toast.fileGone') })
  if (process.platform === 'win32') {
    spawn('rundll32.exe', ['shell32.dll,OpenAs_RunDLL', path], { detached: true, stdio: 'ignore', windowsHide: true }).unref()
    return
  }
  const res = await dialog.showOpenDialog(win!, {
    title: tm('dialog.openWith'),
    defaultPath: '/Applications',
    properties: ['openFile'],
    filters: [{ name: tm('dialog.applications'), extensions: ['app'] }],
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
            ? tm('toast.allAlreadyInList')
            : result.duplicates.length === 1
              ? tm('toast.dupOne')
              : tm('toast.dupMany', { n: result.duplicates.length }),
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
      send('toast', { kind: 'info', message: tm('toast.noLinkClipboard') })
      return { found: 0, added: 0 }
    }
    const result = queue.add(urls, download)
    if (result.duplicates.length === urls.length) send('toast', { kind: 'info', message: tm('toast.alreadyInList') })
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
        { label: row.status === 'done' ? tm('menu.downloadAgain') : row.status === 'paused' ? tm('menu.resume') : tm('menu.download'), enabled: canStart, click: () => queue.start([row.id]) },
        { label: tm('menu.pause'), enabled: active && row.status !== 'converting', click: () => queue.pause(row.id) },
        { label: tm('menu.stop'), enabled: active || row.status === 'paused', click: () => queue.cancel(row.id) },
        { label: tm('menu.copyLink'), click: () => clipboard.writeText(row.media?.webpageUrl ?? row.url) },
        { label: tm('menu.openPage'), click: () => void shell.openExternal(row.media?.webpageUrl ?? row.url) },
        { type: 'separator' },
        { label: tm('menu.openFile'), enabled: !!row.outputPath && row.status === 'done', click: () => void openFile(row.outputPath!) },
        { label: tm('menu.openWith'), enabled: !!row.outputPath && row.status === 'done', click: () => void openWith(row.outputPath!, win) },
        { label: tm('menu.trim'), enabled: !!row.outputPath && row.status === 'done', click: () => e.sender.send('ui:trim', { rowId: row.id }) },
        { label: tm('menu.split'), enabled: !!row.outputPath && row.status === 'done', click: () => e.sender.send('ui:split', { rowId: row.id }) },
        { label: tm('menu.rename'), enabled: !!row.outputPath && row.status === 'done', click: () => e.sender.send('ui:rename', { rowId: row.id }) },
        { label: tm('menu.revealInFolder'), enabled: !!row.outputPath, click: () => shell.showItemInFolder(row.outputPath!) },
        { label: tm('menu.copyPath'), enabled: !!row.outputPath, click: () => clipboard.writeText(row.outputPath!) },
        { label: tm('menu.revealFile'), enabled: !!row.outputPath, click: () => row.outputPath && shell.showItemInFolder(row.outputPath) },
        { type: 'separator' },
        { label: tm('menu.removeFromList'), click: () => queue.remove([row.id]) },
        { type: 'separator' },
      )
    }
    items.push(
      { label: tm('menu.pasteLink'), enabled: hasLink, click: () => void pasteClipboard(false) },
      { label: tm('menu.pasteLinkDownload'), enabled: hasLink, click: () => void pasteClipboard(true) },
      { type: 'separator' },
      { label: tm('menu.selectAll'), accelerator: 'CmdOrCtrl+A', click: () => e.sender.send('ui:selectAll', null) },
      { label: tm('menu.exportQueue'), enabled: queue.list().length > 0, click: () => e.sender.send('ui:export', 'queue') },
      { type: 'separator' },
      { label: tm('menu.about'), click: () => e.sender.send('ui:about', null) },
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

  // ---- subscriptions ----
  const subsChanged = () => send('subs:changed', db.listSubs())
  /** Fetch the playlist/channel flat and return its entries (url + title + thumbnail). */
  const fetchEntries = async (url: string) => {
    const media = await fetchMetadata(url, getSettings(), { noPlaylist: false })
    const entries = (media.entries ?? []).map((e) => e.url).filter(Boolean)
    return { media, entries }
  }
  ipcMain.handle('subs:list', () => db.listSubs())
  ipcMain.handle('subs:add', async (_e, url: string) => {
    const { media, entries } = await fetchEntries(url)
    if (!media.isPlaylist) throw new Error(tm('subs.notPlaylist'))
    const sub: Subscription = {
      id: randomUUID(), url, title: media.playlistTitle || media.title || url, thumbnail: media.thumbnail,
      addedAt: Date.now(), lastChecked: Date.now(), total: entries.length, newUrls: [],
    }
    const added = db.addSub(sub, urlKey(url), entries) // everything present now counts as seen
    subsChanged()
    return { added, title: sub.title }
  })
  ipcMain.handle('subs:remove', (_e, ids: string[]) => {
    db.removeSubs(ids)
    subsChanged()
  })
  const checkSubs = async (ids?: string[]): Promise<number> => {
    const subs = db.listSubs().filter((s) => !ids || ids.includes(s.id))
    let found = 0
    for (const s of subs) {
      try {
        const { media, entries } = await fetchEntries(s.url)
        const known = new Set(db.subKnown(s.id))
        const fresh = [...new Set([...s.newUrls, ...entries.filter((u) => !known.has(u))])]
        found += fresh.length - s.newUrls.length
        db.updateSub(s.id, { title: media.playlistTitle || media.title || undefined, thumbnail: media.thumbnail, lastChecked: Date.now(), total: entries.length, fresh })
      } catch (e) {
        engineLog('subs', `${s.url}: ${(e as Error).message}`)
      }
    }
    subsChanged()
    return found
  }
  ipcMain.handle('subs:check', (_e, ids?: string[]) => checkSubs(ids))
  ipcMain.handle('subs:downloadNew', (_e, id: string) => {
    const s = db.listSubs().find((x) => x.id === id)
    if (!s || !s.newUrls.length) return 0
    const result = queue.add(s.newUrls)
    db.updateSub(id, { known: [...new Set([...db.subKnown(id), ...s.newUrls])], fresh: [] })
    subsChanged()
    return result.added
  })
  ipcMain.handle('subs:markSeen', (_e, id: string) => {
    const s = db.listSubs().find((x) => x.id === id)
    if (!s) return
    db.updateSub(id, { known: [...new Set([...db.subKnown(id), ...s.newUrls])], fresh: [] })
    subsChanged()
  })
  // On launch (a moment after the window is up) and every six hours while running: quiet unless something is new.
  const launchCheck = async () => {
    if (!db.listSubs().length) return
    const n = await checkSubs()
    if (n) send('toast', { kind: 'info', message: n === 1 ? tm('toast.subsNewOne') : tm('toast.subsNewMany', { n }) })
  }
  setTimeout(() => void launchCheck(), 20_000)
  setInterval(() => void launchCheck(), 6 * 60 * 60 * 1000)

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
    if (!added) send('toast', { kind: 'info', message: tm('toast.alreadyInLater') })
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
    const out = withDerived(next)
    send('settings:changed', out)
    return out
  })
  ipcMain.handle('settings:pickDestination', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender) ?? undefined
    const res = await dialog.showOpenDialog(win!, {
      title: tm('dialog.chooseFolder'),
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
      title: tm('dialog.chooseCookies'),
      filters: [{ name: tm('dialog.cookiesFilter'), extensions: ['txt'] }],
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
  ipcMain.handle('media:url', (_e, path: string) => mediaUrl(path))
  let trimAbort: AbortController | null = null
  ipcMain.handle('trim:export', async (_e, job: { src: string; start: number; end: number; kind: 'mp4' | 'm4a' | 'm4r'; precise: boolean }) => {
    trimAbort?.abort()
    const ac = (trimAbort = new AbortController())
    try {
      return await exportSegment({ ...job, signal: ac.signal, onProgress: (percent) => send('trim:progress', { percent }), onLog: (l) => engineLog('trim', l) })
    } finally {
      if (trimAbort === ac) trimAbort = null
    }
  })
  ipcMain.handle('trim:cancel', () => trimAbort?.abort())
  ipcMain.handle('trim:split', async (_e, job: { src: string; marks: { start: number; title: string }[]; mode: 'clips' | 'chapters' }) => {
    trimAbort?.abort()
    const ac = (trimAbort = new AbortController())
    const opts = { signal: ac.signal, onProgress: (percent: number) => send('trim:progress', { percent }), onLog: (l: string) => engineLog('split', l) }
    try {
      if (job.mode === 'chapters') {
        await writeChapters(job.src, job.marks, opts)
        return [job.src]
      }
      return await splitByMarks(job.src, job.marks, opts)
    } finally {
      if (trimAbort === ac) trimAbort = null
    }
  })
  ipcMain.handle('files:rename', (_e, pairs: { rowId: string; from: string; to: string }[]) => {
    const changed: string[] = []
    for (const p of pairs) {
      if (!existsSync(p.from) || p.from === p.to) continue
      if (existsSync(p.to)) throw new Error(tm('files.exists', { name: basename(p.to) }))
      renameSync(p.from, p.to)
      queue.setOutputPath(p.rowId, p.to)
      db.replaceHistoryPath(p.from, p.to)
      changed.push(p.to)
    }
    return changed
  })
  ipcMain.handle('export:links', async (e, kind: 'queue' | 'later' | 'history') => {
    const win = BrowserWindow.fromWebContents(e.sender) ?? undefined
    const lines =
      kind === 'queue' ? queue.list().map((r) => r.media?.webpageUrl ?? r.url)
      : kind === 'later' ? db.listLater().map((l) => l.url)
      : db.listHistory().map((h) => `${h.url}\t${h.outputPath}`)
    if (!lines.length) {
      send('toast', { kind: 'info', message: tm('toast.nothingToExport') })
      return null
    }
    const stamp = new Date().toISOString().slice(0, 10)
    const kindName = tm(`export.${kind}`)
    const res = await dialog.showSaveDialog(win!, {
      title: tm('dialog.exportTitle', { kind: kindName }),
      defaultPath: join(app.getPath('documents'), `TuberX ${kindName} ${stamp}.txt`),
      filters: [{ name: tm('dialog.textFilter'), extensions: ['txt'] }],
    })
    if (res.canceled || !res.filePath) return null
    writeFileSync(res.filePath, lines.join('\n') + '\n', 'utf8')
    send('toast', { kind: 'success', message: lines.length === 1 ? tm('toast.savedLinksOne') : tm('toast.savedLinksMany', { n: lines.length }) })
    return res.filePath
  })
  ipcMain.handle('shell:openExternal', (_e, url: string) => {
    if (/^https?:\/\//i.test(url)) return shell.openExternal(url)
  })
}
