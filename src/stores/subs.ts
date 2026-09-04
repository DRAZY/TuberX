import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { Subscription } from '@shared/types'
import { guard, listen } from '@/lib/ipc'
import { useUiStore } from '@/stores/ui'
import { t } from '@/lib/i18n'

/** Playlists and channels the user follows: new videos are spotted on each check and fetched in one click. */
export const useSubsStore = defineStore('subs', () => {
  const ui = useUiStore()
  const entries = ref<Subscription[]>([])
  const loaded = ref(false)
  const checking = ref<Set<string>>(new Set())

  const count = computed(() => entries.value.length)
  const newCount = computed(() => entries.value.reduce((n, s) => n + s.newUrls.length, 0))

  async function ensureLoaded(): Promise<void> {
    if (loaded.value) return
    const next = await guard(() => window.tuberx.subs.list())
    if (next) entries.value = next
    loaded.value = true
  }

  async function add(url: string): Promise<void> {
    const res = await guard(() => window.tuberx.subs.add(url))
    if (!res) return
    ui.toast(res.added ? 'success' : 'info', res.added ? t('subs.subscribedTo', { title: res.title }) : t('subs.alreadySubscribed'))
  }

  async function remove(ids: string[]): Promise<void> {
    if (ids.length) await guard(() => window.tuberx.subs.remove(ids))
  }

  async function check(ids?: string[]): Promise<void> {
    const targets = ids ?? entries.value.map((s) => s.id)
    targets.forEach((id) => checking.value.add(id))
    const res = await guard(() => window.tuberx.subs.check(targets))
    targets.forEach((id) => checking.value.delete(id))
    if (res !== undefined) ui.toast(res ? 'success' : 'info', res ? (res === 1 ? t('subs.newOne') : t('subs.newMany', { n: res })) : t('subs.nothingNew'))
  }

  async function downloadNew(id: string): Promise<void> {
    const n = await guard(() => window.tuberx.subs.downloadNew(id))
    if (n === undefined) return
    ui.toast(n ? 'success' : 'info', n ? t('subs.addedToQueue', { n }) : t('subs.alreadyListed'))
  }

  async function markSeen(id: string): Promise<void> {
    await guard(() => window.tuberx.subs.markSeen(id))
  }

  listen('subs:changed', (next) => {
    entries.value = next
    loaded.value = true
  })

  return { entries, count, newCount, checking, ensureLoaded, add, remove, check, downloadNew, markSeen }
})
