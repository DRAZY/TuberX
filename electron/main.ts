import { app, BrowserWindow, Menu, Notification, shell } from 'electron'
import { join } from 'node:path'
import { existsSync, mkdirSync } from 'node:fs'
import { parseDeepLink } from '../shared/urls'
import { TuberDb } from './db/database'
import { checkAllTools } from './engine/tools'
import { removeLegacySingleFileEngine, updateEngine } from './engine/updater'
import { registerIpc, send } from './ipc/handlers'
import { setPotReachable } from './engine/ytdlp'
import { lookup } from 'node:dns/promises'
import { QueueManager } from './queue/manager'
import { getSettings } from './settings'

const isDev = !!process.env.VITE_DEV_SERVER_URL
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
    if (win) {
      if (win.isMinimized()) win.restore()
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

function createWindow() {
  win = new BrowserWindow({
    width: 560,
    height: 640,
    minWidth: 480,
    minHeight: 420,
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
  if (isDev) {
    void win.loadURL(process.env.VITE_DEV_SERVER_URL!)
  } else {
    void win.loadFile(join(__dirname, '../dist/index.html'))
  }
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
  removeLegacySingleFileEngine()
  db = new TuberDb()
  queue = new QueueManager(db, getSettings)
  queue.on('completed', (row) => {
    if (getSettings().notifyOnComplete && Notification.isSupported()) {
      const n = new Notification({ title: 'Download complete', body: row.media?.title ?? row.url })
      n.on('click', () => row.outputPath && shell.showItemInFolder(row.outputPath))
      n.show()
    }
  })
  registerIpc(queue, db)
  createWindow()
  handleArgv(process.argv)

  // The PO-token helper needs jnn-pa.googleapis.com; DNS filters often sinkhole it. Detect once, skip it,
  // and say so, instead of paying a failed token generation on every fetch.
  void lookup('jnn-pa.googleapis.com')
    .then(({ address }) => {
      const blocked = address === '0.0.0.0' || address === '::' || address === '127.0.0.1'
      setPotReachable(!blocked)
      if (blocked && getSettings().potHelper)
        send('toast', { kind: 'warn', message: 'PO-token helper skipped: your network blocks jnn-pa.googleapis.com' })
    })
    .catch(() => setPotReachable(false))

  // Tool health + engine self-update, off the critical path
  void checkAllTools().then((status) => {
    send('tools:status', status)
    const missing = status.filter((s) => !s.ok && (s.name === 'yt-dlp' || s.name === 'ffmpeg'))
    if (missing.length)
      send('toast', { kind: 'error', message: `Missing tools: ${missing.map((m) => m.name).join(', ')} — see Settings → Engine` })
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
