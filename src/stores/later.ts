import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { LaterEntry } from '@shared/types'
import { guard, listen } from '@/lib/ipc'
import { useUiStore } from '@/stores/ui'
import { t } from '@/lib/i18n'

export const useLaterStore = defineStore('later', () => {
  const ui = useUiStore()
  const entries = ref<LaterEntry[]>([])
  const loading = ref(false)
  const loaded = ref(false)

  const count = computed(() => entries.value.length)

  async function refresh(): Promise<void> {
    loading.value = true
    const next = await guard(() => window.tuberx.later.list())
    loading.value = false
    if (next) entries.value = next
    loaded.value = true
  }

  /** First open pulls a snapshot; after that `later:changed` keeps the list current. */
  async function ensureLoaded(): Promise<void> {
    if (loaded.value) return
    await refresh()
  }

  // Mutations do not refetch: main emits `later:changed` after each one.
  async function add(urls: string[]): Promise<void> {
    const clean = urls.filter(Boolean)
    if (!clean.length) return
    const n = await guard(() => window.tuberx.later.add(clean))
    if (n === undefined) return
    ui.toast(n ? 'success' : 'info', n ? t('later.savedForLater', { n }) : t('later.alreadySaved'))
  }

  async function remove(ids: string[]): Promise<void> {
    if (!ids.length) return
    await guard(() => window.tuberx.later.remove(ids))
  }

  async function sendToQueue(ids: string[]): Promise<void> {
    if (!ids.length) return
    await guard(() => window.tuberx.later.sendToQueue(ids))
  }

  async function sendAllToQueue(): Promise<void> {
    await sendToQueue(entries.value.map((e) => e.id))
  }

  function bind(): () => void {
    return listen('later:changed', (next) => {
      entries.value = next
      loaded.value = true
    })
  }

  return {
    entries,
    loading,
    loaded,
    count,
    refresh,
    ensureLoaded,
    add,
    remove,
    sendToQueue,
    sendAllToQueue,
    bind,
  }
})
