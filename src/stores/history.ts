import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import type { HistoryEntry } from '@shared/types'
import { guard, listen } from '@/lib/ipc'
import { useSelection } from '@/lib/selection'

export const useHistoryStore = defineStore('history', () => {
  const entries = ref<HistoryEntry[]>([])
  const loading = ref(false)
  const loaded = ref(false)

  const count = computed(() => entries.value.length)
  const selection = useSelection()
  watch(entries, (list) => selection.prune(list.map((e) => e.id)))

  async function refresh(): Promise<void> {
    loading.value = true
    const next = await guard(() => window.tuberx.history.list())
    loading.value = false
    if (next) entries.value = next
    loaded.value = true
  }

  /** First open pulls a snapshot; after that `history:changed` keeps the list current. */
  async function ensureLoaded(): Promise<void> {
    if (loaded.value) return
    await refresh()
  }

  // Mutations do not refetch: main emits `history:changed` after each one,
  // and after every completed download.
  async function remove(ids: string[]): Promise<void> {
    if (!ids.length) return
    await guard(() => window.tuberx.history.remove(ids))
  }

  async function clear(): Promise<void> {
    await guard(() => window.tuberx.history.clear())
  }
  async function removeSelected(): Promise<void> {
    const ids = [...selection.selected.value]
    selection.clear()
    await remove(ids)
  }
  function selectAll(): void {
    selection.selectAll(entries.value.map((e) => e.id))
  }

  async function reveal(path: string): Promise<void> {
    if (!path) return
    await guard(() => window.tuberx.shell.reveal(path))
  }

  function bind(): () => void {
    return listen('history:changed', (next) => {
      entries.value = next
      loaded.value = true
    })
  }

  return { entries, loading, loaded, count, refresh, ensureLoaded, remove, clear, reveal, bind,
    selected: selection.selected, isSelected: selection.isSelected, clickSelect: selection.click, selectAll, clearSelection: selection.clear, removeSelected }
})
