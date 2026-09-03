import { contextBridge, ipcRenderer } from 'electron'
import type { MainEvents, TuberXApi } from '../shared/types'

const invoke = <T>(channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args) as Promise<T>

const api: TuberXApi = {
  addUrls: (urls) => invoke('queue:add', urls),
  removeRows: (ids) => invoke('queue:remove', ids),
  setFormat: (id, formatId) => invoke('queue:setFormat', id, formatId),
  setFormatAll: (formatId) => invoke('queue:setFormatAll', formatId),
  startDownload: (ids) => invoke('queue:start', ids),
  cancelDownload: (id) => invoke('queue:cancel', id),
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
  },
  tools: {
    status: () => invoke('tools:status'),
    updateEngine: () => invoke('tools:updateEngine'),
  },
  shell: {
    reveal: (path) => invoke('shell:reveal', path),
    openExternal: (url) => invoke('shell:openExternal', url),
  },
  on<K extends keyof MainEvents>(event: K, handler: (payload: MainEvents[K]) => void) {
    const listener = (_e: Electron.IpcRendererEvent, payload: MainEvents[K]) => handler(payload)
    ipcRenderer.on(event, listener)
    return () => ipcRenderer.removeListener(event, listener)
  },
}

contextBridge.exposeInMainWorld('tuberx', api)
