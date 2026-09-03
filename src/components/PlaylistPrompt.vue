<script setup lang="ts">
import { computed, ref } from 'vue'
import type { MediaItem, PlaylistEntry } from '@shared/types'
import { formatDuration } from '@shared/normalize'
import Icon from '@/components/Icon.vue'
import { useQueueStore } from '@/stores/queue'
import { useLaterStore } from '@/stores/later'
import { useUiStore } from '@/stores/ui'

const props = defineProps<{ rowId: string; media: MediaItem }>()

const queue = useQueueStore()
const later = useLaterStore()
const ui = useUiStore()

/** Picker mode when the row itself is a playlist; otherwise the two-button prompt. */
const isPicker = computed(() => props.media.isPlaylist && (props.media.entries?.length ?? 0) > 0)
const entries = computed<PlaylistEntry[]>(() => props.media.entries ?? [])

const search = ref('')
const chosen = ref<Set<string>>(new Set(entries.value.map((e) => e.url)))

const visible = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return entries.value
  return entries.value.filter((e) => e.title.toLowerCase().includes(q))
})

const chosenUrls = computed(() => entries.value.filter((e) => chosen.value.has(e.url)).map((e) => e.url))

function toggle(url: string): void {
  if (chosen.value.has(url)) chosen.value.delete(url)
  else chosen.value.add(url)
}

function selectAll(): void {
  chosen.value = new Set(visible.value.map((e) => e.url))
}

function selectNone(): void {
  chosen.value = new Set<string>()
}

async function addSelected(): Promise<void> {
  const urls = chosenUrls.value
  ui.closePlaylist()
  await queue.expandPlaylist(props.rowId, urls)
}

async function addAllToLater(): Promise<void> {
  const urls = entries.value.map((e) => e.url)
  ui.closePlaylist()
  await later.add(urls)
}

async function entirePlaylist(): Promise<void> {
  const url = props.media.playlistUrl
  ui.closePlaylist()
  if (url) await queue.addUrls([url])
}
</script>

<template>
  <div
    class="absolute inset-0 z-30 flex items-center justify-center bg-black/50 p-8"
    @click.self="ui.closePlaylist()"
  >
    <!-- The row IS a playlist: pick which entries to add. -->
    <div
      v-if="isPicker"
      class="flex max-h-full w-full max-w-xl flex-col rounded-lg border border-tx-border bg-tx-panel shadow-2xl"
    >
      <div class="shrink-0 border-b border-tx-border p-4">
        <h2 class="truncate text-sm font-semibold" :title="media.title">{{ media.title }}</h2>
        <p class="mt-0.5 text-[11px] text-tx-muted">{{ entries.length }} videos in this playlist</p>

        <div class="mt-3 flex items-center gap-2">
          <div class="relative flex-1">
            <span class="absolute left-2 top-1/2 -translate-y-1/2 text-tx-muted">
              <Icon name="search" :size="12" />
            </span>
            <input v-model="search" class="tx-field pl-7" placeholder="Search this playlist" />
          </div>
          <button type="button" class="tx-btn-ghost" @click="selectAll">Select all</button>
          <button type="button" class="tx-btn-ghost" @click="selectNone">None</button>
        </div>
      </div>

      <ul class="min-h-0 flex-1 list-none overflow-y-auto">
        <li
          v-for="entry in visible"
          :key="entry.url"
          class="flex cursor-default items-center gap-3 border-b border-tx-border px-4 py-2 hover:bg-tx-row/60"
          @click="toggle(entry.url)"
        >
          <input
            type="checkbox"
            class="h-3.5 w-3.5 shrink-0 accent-tx-accent"
            :checked="chosen.has(entry.url)"
            @click.stop="toggle(entry.url)"
          />
          <div class="flex h-9 w-16 shrink-0 items-center justify-center overflow-hidden rounded bg-tx-row">
            <img
              v-if="entry.thumbnail"
              :src="entry.thumbnail"
              alt=""
              class="h-full w-full object-cover"
            />
            <Icon v-else name="play" :size="14" class="text-tx-muted/60" />
          </div>
          <span class="min-w-0 flex-1 truncate text-[12px]" :title="entry.title">{{ entry.title }}</span>
          <span class="shrink-0 text-[11px] text-tx-muted">{{ formatDuration(entry.duration) }}</span>
        </li>
        <li v-if="!visible.length" class="px-4 py-6 text-center text-[11px] text-tx-muted">
          Nothing matches that search.
        </li>
      </ul>

      <div class="flex shrink-0 items-center justify-between gap-2 border-t border-tx-border p-3">
        <button type="button" class="tx-btn-ghost" @click="addAllToLater">Add all to Later</button>
        <div class="flex items-center gap-2">
          <button type="button" class="tx-btn-ghost" @click="ui.closePlaylist()">Cancel</button>
          <button
            type="button"
            class="tx-btn-accent"
            :disabled="!chosenUrls.length"
            @click="addSelected"
          >
            Add {{ chosenUrls.length }} video{{ chosenUrls.length === 1 ? '' : 's' }}
          </button>
        </div>
      </div>
    </div>

    <!-- A single video that belongs to a playlist. -->
    <div v-else class="w-full max-w-md rounded-lg border border-tx-border bg-tx-panel p-4 shadow-2xl">
      <h2 class="text-sm font-semibold">This video is part of a playlist</h2>
      <p class="mt-1 text-[12px] leading-relaxed text-tx-muted">
        Download this video only, or the entire playlist?
      </p>
      <div class="mt-4 flex items-center justify-end gap-2">
        <button type="button" class="tx-btn-ghost" @click="ui.closePlaylist()">This video</button>
        <button
          type="button"
          class="tx-btn-accent"
          :disabled="!media.playlistUrl"
          @click="entirePlaylist"
        >
          Entire playlist
        </button>
      </div>
    </div>
  </div>
</template>
