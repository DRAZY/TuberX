import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { DownloadProgress, QueueRow, RowStatus } from '@shared/types'
import { guard, listen } from '@/lib/ipc'
import { useUiStore } from '@/stores/ui'

/** Statuses that a "Download All" pass should pick up. */
const STARTABLE: RowStatus[] = ['ready', 'failed']

export const useQueueStore = defineStore('queue', () => {
  const ui = useUiStore()
  const rows = ref<QueueRow[]>([])
  const selected = ref<Set<string>>(new Set<string>())

  const count = computed(() => rows.value.length)
  const activeCount = computed(
    () => rows.value.filter((r) => r.status === 'downloading' || r.status === 'converting').length,
  )
  const startableRows = computed(() => rows.value.filter((r) => STARTABLE.includes(r.status)))
  const hasStartable = computed(() => startableRows.value.length > 0)

  const statusText = computed(() => {
    if (!count.value) return ''
    const items = `${count.value} item${count.value === 1 ? '' : 's'}`
    return activeCount.value ? `${items} · ${activeCount.value} downloading` : items
  })

  function byId(id: string): QueueRow | undefined {
    return rows.value.find((r) => r.id === id)
  }

  // --- mutations from main -------------------------------------------------

  function setRows(next: QueueRow[]): void {
    rows.value = next
    const live = new Set(next.map((r) => r.id))
    for (const id of [...selected.value]) {
      if (!live.has(id)) selected.value.delete(id)
    }
  }

  function applyProgress(id: string, progress: DownloadProgress): void {
    const row = byId(id)
    if (row) row.progress = progress
  }

  // --- selection -----------------------------------------------------------

  function isSelected(id: string): boolean {
    return selected.value.has(id)
  }

  function select(id: string): void {
    selected.value.clear()
    selected.value.add(id)
  }

  function toggle(id: string): void {
    if (selected.value.has(id)) selected.value.delete(id)
    else selected.value.add(id)
  }

  function selectAll(): void {
    selected.value = new Set(rows.value.map((r) => r.id))
  }

  function clearSelection(): void {
    selected.value = new Set<string>()
  }

  // --- actions -------------------------------------------------------------

  async function addUrls(urls: string[], download = false): Promise<void> {
    const clean = urls.filter(Boolean)
    if (!clean.length) return
    const res = await guard(() => window.tuberx.addUrls(clean, download))
    if (!res) return
    if (res.added) ui.toast('success', `Added ${res.added} link${res.added === 1 ? '' : 's'}`)
    if (res.duplicates.length) {
      const n = res.duplicates.length
      ui.toast('info', `Skipped ${n} duplicate${n === 1 ? '' : 's'}`)
    }
    if (!res.added && !res.duplicates.length) ui.toast('warn', 'Nothing to add')
    await refresh()
  }

  async function reorder(ids: string[]): Promise<void> {
    // Optimistic: the list re-sorts at once, the main process confirms with queue:changed.
    const byId = new Map(rows.value.map((r) => [r.id, r]))
    const listed = ids.map((id) => byId.get(id)).filter((r): r is QueueRow => !!r)
    rows.value = [...listed, ...rows.value.filter((r) => !ids.includes(r.id))]
    await guard(() => window.tuberx.reorderRows(ids))
  }

  async function remove(ids: string[]): Promise<void> {
    if (!ids.length) return
    await guard(() => window.tuberx.removeRows(ids))
    for (const id of ids) selected.value.delete(id)
    await refresh()
  }

  async function setFormat(id: string, formatId: string): Promise<void> {
    const row = byId(id)
    if (row) row.formatId = formatId
    await guard(() => window.tuberx.setFormat(id, formatId))
  }

  async function setFormatAll(formatId: string): Promise<void> {
    await guard(() => window.tuberx.setFormatAll(formatId))
    await refresh()
  }

  async function start(ids: string[]): Promise<void> {
    if (!ids.length) return
    await guard(() => window.tuberx.startDownload(ids))
  }

  async function startAll(): Promise<void> {
    const ids = startableRows.value.map((r) => r.id)
    if (!ids.length) {
      ui.toast('info', 'Nothing ready to download')
      return
    }
    await start(ids)
  }

  async function cancel(id: string): Promise<void> {
    await guard(() => window.tuberx.cancelDownload(id))
  }

  async function pause(id: string): Promise<void> {
    await guard(() => window.tuberx.pauseDownload(id))
  }
  async function resume(id: string): Promise<void> {
    await guard(() => window.tuberx.resumeDownload(id))
  }
  async function retry(id: string): Promise<void> {
    await guard(() => window.tuberx.retry(id))
  }

  async function expandPlaylist(rowId: string, entryUrls: string[]): Promise<void> {
    if (!entryUrls.length) return
    await guard(() => window.tuberx.expandPlaylist(rowId, entryUrls))
    await refresh()
  }

  async function open(path: string): Promise<void> {
    if (!path) return
    await guard(() => window.tuberx.shell.open(path))
  }

  async function reveal(path: string): Promise<void> {
    if (!path) return
    await guard(() => window.tuberx.shell.reveal(path))
  }

  async function refresh(): Promise<void> {
    const next = await guard(() => window.tuberx.getQueue())
    if (next) setRows(next)
  }

  /** Subscribe to push events. Returns an unsubscriber for onUnmounted. */
  function bind(): () => void {
    const offs = [
      listen('queue:changed', (next) => setRows(next)),
      listen('row:progress', ({ id, progress }) => applyProgress(id, progress)),
    ]
    return () => {
      for (const off of offs) off()
    }
  }

  return {
    rows,
    selected,
    count,
    activeCount,
    startableRows,
    hasStartable,
    statusText,
    byId,
    isSelected,
    select,
    toggle,
    selectAll,
    clearSelection,
    addUrls,
    remove,
    reorder,
    setFormat,
    setFormatAll,
    start,
    startAll,
    cancel,
    retry,
    pause,
    resume,
    expandPlaylist,
    reveal,
    open,
    refresh,
    bind,
  }
})
