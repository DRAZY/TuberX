import { contextBridge, ipcRenderer } from 'electron'
import type { MainEvents, TuberXApi } from '../shared/types'

const invoke = <T>(channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args) as Promise<T>

const api: TuberXApi = {
  addUrls: (urls, download) => invoke('queue:add', urls, download ?? false),
  removeRows: (ids) => invoke('queue:remove', ids),
  setFormat: (id, formatId) => invoke('queue:setFormat', id, formatId),
  reorderRows: (ids) => invoke('queue:reorder', ids),
  setFormatAll: (formatId) => invoke('queue:setFormatAll', formatId),
  startDownload: (ids) => invoke('queue:start', ids),
  cancelDownload: (id) => invoke('queue:cancel', id),
  pauseDownload: (id) => invoke('queue:pause', id),
  resumeDownload: (id) => invoke('queue:resume', id),
  retry: (id) => invoke('queue:retry', id),
  getQueue: () => invoke('queue:list'),
  expandPlaylist: (rowId, urls) => invoke('queue:expandPlaylist', rowId, urls),
  pasteClipboard: (download) => invoke('queue:pasteClipboard', download ?? false),
  contextMenu: (kind, rowId) => invoke('menu:show', kind, rowId),
  later: {
    list: () => invoke('later:list'),
    add: (urls) => invoke('later:add', urls),
    remove: (ids) => invoke('later:remove', ids),
    sendToQueue: (ids) => invoke('later:sendToQueue', ids),
  },
  history: {
    list: () => invoke('history:list'),
    remove: (ids) => invoke('history:remove', ids),
    clear: () => invoke('history:clear'),
  },
  settings: {
    get: () => invoke('settings:get'),
    set: (patch) => invoke('settings:set', patch),
    pickDestination: () => invoke('settings:pickDestination'),
    pickCookiesFile: () => invoke('settings:pickCookiesFile'),
    clearCookiesFile: () => invoke('settings:clearCookiesFile'),
    setLoginPassword: (password) => invoke('settings:setLoginPassword', password),
  },
  tools: {
    status: () => invoke('tools:status'),
    updateEngine: () => invoke('tools:updateEngine'),
    encoders: () => invoke('tools:encoders'),
  },
  app: {
    info: () => invoke('app:info'),
  },
  power: {
    cancel: () => invoke('power:cancel'),
  },
  exportLinks: (kind) => invoke('export:links', kind),
  shell: {
    reveal: (path) => invoke('shell:reveal', path),
    open: (path) => invoke('shell:open', path),
    openWith: (path) => invoke('shell:openWith', path),
    openExternal: (url) => invoke('shell:openExternal', url),
    openLogs: () => invoke('shell:openLogs'),
  },
  on<K extends keyof MainEvents>(event: K, handler: (payload: MainEvents[K]) => void) {
    const listener = (_e: Electron.IpcRendererEvent, payload: MainEvents[K]) => handler(payload)
    ipcRenderer.on(event, listener)
    return () => ipcRenderer.removeListener(event, listener)
  },
}

contextBridge.exposeInMainWorld('tuberx', api)
