<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import Icon from '@/components/Icon.vue'
import { extractUrls } from '@shared/urls'
import { useQueueStore } from '@/stores/queue'
import { useUiStore } from '@/stores/ui'

const props = withDefaults(defineProps<{ compact?: boolean }>(), { compact: false })

const queue = useQueueStore()
const ui = useUiStore()

/** A URL sitting on the clipboard right now, offered as a one-click add (both the empty state and the compact strip). */
const suggestion = ref('')
/** Links the user waved away or already added: never offered twice. */
const seen = new Set<string>()

async function readClipboard(): Promise<void> {
  try {
    const text = await navigator.clipboard.readText()
    const url = extractUrls(text ?? '').find((u) => !seen.has(u) && !queue.rows.some((r) => r.url === u))
    suggestion.value = url ?? ''
  } catch {
    // Clipboard permission denied or unavailable — the suggestion row just stays hidden.
    suggestion.value = ''
  }
}

function acceptSuggestion(download = false): void {
  const url = suggestion.value
  if (!url) return
  seen.add(url)
  suggestion.value = ''
  void queue.addUrls([url], download)
}

function dismissSuggestion(): void {
  if (suggestion.value) seen.add(suggestion.value)
  suggestion.value = ''
}

onMounted(() => {
  void readClipboard()
  window.addEventListener('focus', readClipboard)
})

onBeforeUnmount(() => window.removeEventListener('focus', readClipboard))
</script>

<template>
  <button
    v-if="compact"
    type="button"
    class="flex w-full shrink-0 items-center gap-2 border-b border-tx-border px-4 py-2 text-xs text-tx-muted transition-colors hover:bg-tx-row hover:text-tx-text"
    :class="ui.dragging ? 'bg-tx-row text-tx-text' : ''"
    @click="ui.open('multilink')"
  >
    <Icon name="plus" :size="14" />
    Paste or drop more links
  </button>
  <div
    v-if="compact && suggestion"
    class="flex w-full shrink-0 items-center gap-2 border-b border-tx-border bg-tx-panel px-4 py-1.5 text-xs"
  >
    <Icon name="search" :size="13" class="shrink-0 text-tx-muted" />
    <span class="min-w-0 flex-1 truncate text-tx-muted" :title="suggestion">On the clipboard: {{ suggestion }}</span>
    <button type="button" class="tx-btn-ghost !py-0.5" @click="acceptSuggestion(false)">Add</button>
    <button type="button" class="tx-btn-accent !py-0.5 text-xs" @click="acceptSuggestion(true)">Add and download</button>
    <button type="button" class="shrink-0 text-tx-muted hover:text-tx-text" aria-label="Dismiss" title="Not this one" @click="dismissSuggestion">
      <Icon name="close" :size="12" />
    </button>
  </div>

  <div
    v-else
    class="flex h-full flex-col items-center justify-center px-8 text-center"
    :class="ui.dragging ? 'bg-tx-row/40' : ''"
  >
    <div class="flex w-full max-w-lg items-center gap-4">
      <button
        type="button"
        class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-tx-border text-tx-muted transition-colors hover:border-tx-accent hover:text-tx-accent"
        title="Add links (Ctrl+O)"
        aria-label="Add links"
        @click="ui.open('multilink')"
      >
        <Icon name="plus" :size="18" />
      </button>
      <h1 class="text-left text-2xl font-light text-tx-muted">Paste or Drop Video URLs Here</h1>
    </div>

    <p class="mt-4 max-w-md text-xs leading-relaxed text-tx-muted">
      Supports YouTube, Vimeo, Facebook, Instagram, Dailymotion, SoundCloud, Mixcloud, Bandcamp,
      Youku and more
    </p>

    <button
      v-if="suggestion"
      type="button"
      class="mt-8 flex w-full max-w-md items-center gap-2 rounded-full border border-tx-border bg-tx-panel px-3 py-2 text-left text-xs text-tx-muted transition-colors hover:border-tx-accent hover:text-tx-text"
      :title="suggestion"
      @click="acceptSuggestion(false)"
    >
      <Icon name="search" :size="13" />
      <span class="truncate">{{ suggestion }}</span>
    </button>
  </div>
</template>
