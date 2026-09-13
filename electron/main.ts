import './userData' // must stay the first import: fixes the data folder before any store is constructed
import { app, BrowserWindow, dialog, Menu, Notification, screen, shell } from 'electron'
import Store from 'electron-store'
import { join } from 'node:path'
import { existsSync, mkdirSync } from 'node:fs'
import { parseDeepLink } from '../shared/urls'
import { TuberDb } from './db/database'
import { checkAllTools } from './engine/tools'
import { removeLegacySingleFileEngine, updateEngine } from './engine/updater'
import { registerIpc, send, schedulePowerAction } from './ipc/handlers'
import { setPotReachable } from './engine/ytdlp'
import { lookup } from 'node:dns/promises'
import { QueueManager } from './queue/manager'
import { registerMediaScheme, serveMedia } from './media'
import { scheduleUpdateChecks } from './appUpdate'
import { getSettings } from './settings'
import { tm } from './i18n'
import { engineLog, engineLogPath } from './engine/log'

const isDev = !!process.env.VITE_DEV_SERVER_URL
// The data folder (dev vs installed vs TUBERX_USER_DATA) is chosen in ./userData, imported first above.
registerMediaScheme()

let win: BrowserWindow | null = null
let db: TuberDb | null = null
let queue: QueueManager | null = null
const pendingLinks: { url: string; later: boolean }[] = []

// ---- single instance + deep links (tuberx:// and tuberxlater://) ----
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', (_e, argv) => {
    handleArgv(argv)
    engineLog('app', 'second instance: bringing the window back')
    if (!win) createWindow()
    else {
      if (win.isMinimized()) win.restore()
      if (!win.isVisible()) win.show()
      win.focus()
    }
  })
}
if (process.defaultApp && process.argv.length >= 2) {
  app.setAsDefaultProtocolClient('tuberx', process.execPath, [process.argv[1]])
  app.setAsDefaultProtocolClient('tuberxlater', process.execPath, [process.argv[1]])
} else {
  app.setAsDefaultProtocolClient('tuberx')
  app.setAsDefaultProtocolClient('tuberxlater')
}
app.on('open-url', (e, url) => {
  e.preventDefault()
  deliverLink(url)
})

function handleArgv(argv: string[]) {
  for (const a of argv) if (/^tuberx(later)?:\/\//i.test(a)) deliverLink(a)
}

function deliverLink(raw: string) {
  const link = parseDeepLink(raw)
  if (!link) return
  if (win && win.webContents.isLoading() === false) send('url:incoming', link)
  else pendingLinks.push(link)
}

/** Default window: a compact applet, centred; size and position remembered between launches. */
const DEFAULT_BOUNDS = { width: 600, height: 680 }
const MIN_BOUNDS = { width: 480, height: 420 }
const windowStore = new Store<{ bounds?: { x: number; y: number; width: number; height: number }; softwareRendering?: boolean }>({
  name: 'window',
  clearInvalidConfig: true, // only window geometry lives here: a damaged file must never stop the app from starting
})

// ---- startup resilience (issue #5: "click, no reaction" on Windows) ----
engineLog('app', `launch ${app.getVersion()} electron ${process.versions.electron} ${process.platform}-${process.arch} packaged=${app.isPackaged}`)
// A GPU process that died on a previous launch flips this flag; from then on the app renders in software.
if (windowStore.get('softwareRendering')) {
  app.disableHardwareAcceleration()
  engineLog('app', 'hardware acceleration off (GPU process failed on an earlier launch)')
}
app.on('child-process-gone', (_e, d) => {
  if (d.type !== 'GPU' || d.reason === 'clean-exit' || d.reason === 'killed') return
  engineLog('app', `GPU process gone: ${d.reason} (exit ${d.exitCode})`)
  if (windowStore.get('softwareRendering')) return // already in software mode: nothing more to fall back to
  windowStore.set('softwareRendering', true)
  engineLog('app', 'relaunching with hardware acceleration off')
  // The Windows portable build runs from a temp extraction that its launcher deletes on exit, so it
  // must relaunch the exe the user actually double-clicked.
  app.relaunch(process.env.PORTABLE_EXECUTABLE_FILE ? { execPath: process.env.PORTABLE_EXECUTABLE_FILE } : undefined)
  app.exit(0)
})
process.on('uncaughtException', (err) => {
  // Logged for the bug report, then the same error box Electron would have shown (it stays silent once
  // another listener exists), then exit: a half-initialised main process must not linger invisibly.
  engineLog('app', `uncaught: ${err?.stack ?? err}`)
  dialog.showErrorBox('TuberX could not start', `${err?.stack ?? err}\n\nLog: ${engineLogPath()}`)
  app.exit(1)
})

/** Saved bounds only if they still land on a connected display; otherwise the centred default. */
function restoredBounds(): { x?: number; y?: number; width: number; height: number } {
  const saved = windowStore.get('bounds')
  if (!saved) return DEFAULT_BOUNDS
  const visible = screen.getAllDisplays().some((d) => {
    const a = d.workArea
    return saved.x + 40 < a.x + a.width && saved.x + saved.width - 40 > a.x && saved.y + 20 < a.y + a.height && saved.y >= a.y - 8
  })
  if (!visible) return DEFAULT_BOUNDS
  return { ...saved, width: Math.max(MIN_BOUNDS.width, saved.width), height: Math.max(MIN_BOUNDS.height, saved.height) }
}

function createWindow() {
  const bounds = restoredBounds()
  win = new BrowserWindow({
    ...bounds,
    center: bounds.x === undefined,
    minWidth: MIN_BOUNDS.width,
    minHeight: MIN_BOUNDS.height,
    show: false, // paint first, then show: no white flash, no half-drawn frame
    backgroundColor: '#1c1c1e',
    title: 'TuberX',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#1c1c1e', symbolColor: '#e5e5e7', height: 40 },
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  })
  Menu.setApplicationMenu(null)
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('did-finish-load', () => {
    for (const l of pendingLinks.splice(0)) send('url:incoming', l)
  })
  // Never leave the user with a running process and no window. Show it on any failure, and after a
  // deadline even if the renderer never signalled ready-to-show.
  const w = win
  const showAnyway = (why: string) => {
    if (!w || w.isDestroyed() || w.isVisible()) return
    engineLog('app', `window shown: ${why}`)
    w.show()
  }
  const deadline = setTimeout(() => showAnyway('ready-to-show never fired (10 s)'), 10_000)
  w.once('ready-to-show', () => clearTimeout(deadline))
  w.on('closed', () => clearTimeout(deadline))
  w.webContents.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
    if (!isMainFrame || code === -3) return // -3: aborted by a newer navigation
    engineLog('app', `page failed to load: ${code} ${desc} ${url}`)
    void w.loadURL(
      'data:text/html;charset=utf-8,' +
        encodeURIComponent(
          `<body style="font:14px system-ui;background:#1c1c1e;color:#e5e5e7;padding:40px"><h2>TuberX could not load its interface</h2><p>The installation looks damaged. Reinstall TuberX from <a style="color:#4da3ff" href="https://github.com/DRAZY/TuberX/releases/latest">github.com/DRAZY/TuberX/releases</a>.</p><p>Details: ${desc} (${code})<br>Log: ${engineLogPath()}</p></body>`,
        ),
    )
    showAnyway('load failure')
  })
  let rendererRestarts = 0
  w.webContents.on('render-process-gone', (_e, d) => {
    engineLog('app', `renderer gone: ${d.reason} (exit ${d.exitCode})`)
    if (d.reason === 'clean-exit' || d.reason === 'killed') return
    if (rendererRestarts++ < 2) w.webContents.reload()
    else showAnyway('renderer keeps crashing')
  })
  w.on('unresponsive', () => engineLog('app', 'window unresponsive'))
  if (isDev) {
    void win.loadURL(process.env.VITE_DEV_SERVER_URL!)
  } else {
    void win.loadFile(join(__dirname, '../dist/index.html'))
  }
  win.once('ready-to-show', () => showAnyway('ready'))
  const saveBounds = () => {
    if (!win || win.isMinimized() || win.isFullScreen()) return
    windowStore.set('bounds', win.getNormalBounds())
  }
  win.on('resize', saveBounds)
  win.on('move', saveBounds)
  win.on('close', saveBounds)
  win.on('closed', () => (win = null))
}

app.whenReady().then(async () => {
  const settings = getSettings()
  if (!existsSync(settings.destination)) {
    try {
      mkdirSync(settings.destination, { recursive: true })
    } catch {
      /* picked later */
    }
  }
  serveMedia()
  removeLegacySingleFileEngine()
  db = new TuberDb()
  queue = new QueueManager(db, getSettings)
  queue.on('completed', (row) => {
    if (getSettings().notifyOnComplete && Notification.isSupported()) {
      const n = new Notification({ title: tm('notify.downloadComplete'), body: row.media?.title ?? row.url })
      n.on('click', () => row.outputPath && shell.showItemInFolder(row.outputPath))
      // Recorded so a user (or the release smoke) can see in engine.log whether the OS accepted the notification.
      n.on('show', () => engineLog('notify', `shown: ${row.media?.title ?? row.url}`))
      n.on('failed', (_e, err) => engineLog('notify', `failed: ${err}`))
      n.show()
    }
  })
  queue.on('engineUpdated', (version: string) => send('engine:updated', { to: version }))
  queue.on('idle', (row) => {
    const action = getSettings().onQueueDone
    if (action === 'open-folder') void shell.openPath(row.destination || getSettings().destination)
    else if (action === 'sleep' || action === 'shutdown') schedulePowerAction(action)
  })
  registerIpc(queue, db)
  createWindow()
  scheduleUpdateChecks()
  handleArgv(process.argv)

  // The PO-token helper needs jnn-pa.googleapis.com; DNS filters often sinkhole it. Detect once, skip it,
  // and say so, instead of paying a failed token generation on every fetch.
  void lookup('jnn-pa.googleapis.com')
    .then(({ address }) => {
      const blocked = address === '0.0.0.0' || address === '::' || address === '127.0.0.1'
      setPotReachable(!blocked)
      if (blocked && getSettings().potHelper === 'always')
        send('toast', { kind: 'warn', message: tm('toast.potBlocked') })
    })
    .catch(() => setPotReachable(false))

  // Tool health + engine self-update, off the critical path
  void checkAllTools().then((status) => {
    send('tools:status', status)
    const missing = status.filter((s) => !s.ok && (s.name === 'yt-dlp' || s.name === 'ffmpeg'))
    if (missing.length)
      send('toast', { kind: 'error', message: tm('toast.missingTools', { names: missing.map((m) => m.name).join(', ') }) })
  })
  if (getSettings().autoUpdateEngine) {
    setTimeout(() => {
      updateEngine()
        .then((r) => r.updated && send('engine:updated', { to: r.version }))
        .catch(() => {})
    }, 5000)
  }
})

app.on('window-all-closed', () => {
  queue?.cancelAll()
  db?.close()
  app.quit()
})
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
