<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import Icon from '@/components/Icon.vue'
import { extractUrls } from '@shared/urls'
import { useQueueStore } from '@/stores/queue'
import { useUiStore } from '@/stores/ui'

const props = withDefaults(defineProps<{ compact?: boolean }>(), { compact: false })

const queue = useQueueStore()
const ui = useUiStore()

/** A URL sitting on the clipboard right now, offered as a one-click add. */
const suggestion = ref('')

async function readClipboard(): Promise<void> {
  if (props.compact) return
  try {
    const text = await navigator.clipboard.readText()
    const urls = extractUrls(text ?? '')
    suggestion.value = urls[0] ?? ''
  } catch {
    // Clipboard permission denied or unavailable — the suggestion row just stays hidden.
    suggestion.value = ''
  }
}

function acceptSuggestion(): void {
  if (!suggestion.value) return
  void queue.addUrls([suggestion.value])
  suggestion.value = ''
}

onMounted(() => {
  if (props.compact) return
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
      @click="acceptSuggestion"
    >
      <Icon name="search" :size="13" />
      <span class="truncate">{{ suggestion }}</span>
    </button>
  </div>
</template>
