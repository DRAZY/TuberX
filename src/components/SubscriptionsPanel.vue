<script setup lang="ts">
import { onMounted } from 'vue'
import Icon from '@/components/Icon.vue'
import IconButton from '@/components/IconButton.vue'
import Spinner from '@/components/Spinner.vue'
import { useSubsStore } from '@/stores/subs'
import { useUiStore } from '@/stores/ui'

const subs = useSubsStore()
const ui = useUiStore()

onMounted(() => void subs.ensureLoaded())

function when(ts?: number): string {
  if (!ts) return 'never checked'
  const mins = Math.round((Date.now() - ts) / 60000)
  if (mins < 2) return 'checked just now'
  if (mins < 60) return `checked ${mins} min ago`
  const h = Math.round(mins / 60)
  if (h < 48) return `checked ${h} h ago`
  return `checked ${Math.round(h / 24)} d ago`
}
</script>

<template>
  <div class="flex h-full flex-col">
    <header class="flex shrink-0 items-center justify-between border-b border-tx-border px-4 py-3">
      <h2 class="text-sm font-semibold">Subscriptions</h2>
      <IconButton icon="close" label="Close" @click="ui.close()" />
    </header>

    <div class="flex shrink-0 items-center justify-between gap-2 border-b border-tx-border px-4 py-2">
      <span class="text-[11px] text-tx-muted">{{ subs.count }} followed · {{ subs.newCount }} new</span>
      <button type="button" class="tx-btn-ghost" :disabled="!subs.count || subs.checking.size > 0" @click="subs.check()">Check all now</button>
    </div>

    <p v-if="!subs.count" class="px-4 py-8 text-center text-[11px] leading-relaxed text-tx-muted">
      Nothing followed yet. Paste a playlist or channel link, then choose <b>Subscribe</b> in the picker. New videos are
      spotted every time TuberX opens and can be queued with one click.
    </p>

    <ul v-else class="min-h-0 flex-1 list-none overflow-y-auto">
      <li v-for="s in subs.entries" :key="s.id" class="border-b border-tx-border px-4 py-3">
        <div class="flex items-start gap-3">
          <div class="relative h-12 w-20 shrink-0 overflow-hidden rounded bg-tx-row">
            <img v-if="s.thumbnail" :src="s.thumbnail" alt="" class="h-full w-full object-cover" />
            <Icon v-else name="playlist" :size="18" class="absolute inset-0 m-auto text-tx-muted/60" />
          </div>
          <div class="min-w-0 flex-1">
            <p class="truncate text-[13px] text-tx-text" :title="s.url">{{ s.title || s.url }}</p>
            <p class="mt-0.5 text-[11px] text-tx-muted">
              {{ s.total }} videos · {{ when(s.lastChecked) }}
              <span v-if="s.newUrls.length" class="ml-1 rounded bg-tx-accent px-1.5 py-px text-[10px] font-semibold text-white">{{ s.newUrls.length }} new</span>
            </p>
            <div class="mt-2 flex flex-wrap items-center gap-2">
              <button type="button" class="tx-btn-accent !py-0.5 text-xs" :disabled="!s.newUrls.length" @click="subs.downloadNew(s.id)">Download new</button>
              <button type="button" class="tx-btn-ghost !py-0.5" :disabled="!s.newUrls.length" @click="subs.markSeen(s.id)">Mark as seen</button>
              <button type="button" class="tx-btn-ghost !py-0.5 flex items-center gap-1" :disabled="subs.checking.has(s.id)" @click="subs.check([s.id])">
                <Spinner v-if="subs.checking.has(s.id)" :size="10" /><span>Check</span>
              </button>
              <button type="button" class="ml-auto text-tx-muted hover:text-red-400" title="Unsubscribe" aria-label="Unsubscribe" @click="subs.remove([s.id])"><Icon name="trash" :size="13" /></button>
            </div>
          </div>
        </div>
      </li>
    </ul>
  </div>
</template>
