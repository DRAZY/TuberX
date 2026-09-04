<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import Icon from '@/components/Icon.vue'
import { extractUrls } from '@shared/urls'
import { useQueueStore } from '@/stores/queue'
import { useUiStore } from '@/stores/ui'
import { t } from '@/lib/i18n'

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
  <!-- Compact: the add strip plus, when a link is on the clipboard, the suggestion strip. Otherwise the empty state. -->
  <template v-if="compact">
  <button
    type="button"
    class="flex w-full shrink-0 items-center gap-2 border-b border-tx-border px-4 py-2 text-xs text-tx-muted transition-colors hover:bg-tx-row hover:text-tx-text"
    :class="ui.dragging ? 'bg-tx-row text-tx-text' : ''"
    @click="ui.open('multilink')"
  >
    <Icon name="plus" :size="14" />
    {{ t('drop.pasteMore') }}
  </button>
  <div
    v-if="suggestion"
    class="flex w-full shrink-0 items-center gap-2 border-b border-tx-border bg-tx-panel px-4 py-1.5 text-xs"
  >
    <Icon name="search" :size="13" class="shrink-0 text-tx-muted" />
    <span class="min-w-0 flex-1 truncate text-tx-muted" :title="suggestion">{{ t('drop.onClipboard', { url: suggestion }) }}</span>
    <button type="button" class="tx-btn-ghost !py-0.5" @click="acceptSuggestion(false)">{{ t('drop.add') }}</button>
    <button type="button" class="tx-btn-accent !py-0.5 text-xs" @click="acceptSuggestion(true)">{{ t('drop.addAndDownload') }}</button>
    <button type="button" class="shrink-0 text-tx-muted hover:text-tx-text" :aria-label="t('common.dismiss')" :title="t('drop.notThisOne')" @click="dismissSuggestion">
      <Icon name="close" :size="12" />
    </button>
  </div>
  </template>

  <div
    v-else
    class="flex h-full flex-col items-center justify-center px-8 text-center"
    :class="ui.dragging ? 'bg-tx-row/40' : ''"
  >
    <div class="flex w-full max-w-lg items-center gap-4">
      <button
        type="button"
        class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-tx-border text-tx-muted transition-colors hover:border-tx-accent hover:text-tx-accent"
        :title="t('drop.addLinksShortcut')"
        :aria-label="t('drop.addLinks')"
        @click="ui.open('multilink')"
      >
        <Icon name="plus" :size="18" />
      </button>
      <h1 class="text-left text-2xl font-light text-tx-muted">{{ t('drop.heading') }}</h1>
    </div>

    <p class="mt-4 max-w-md text-xs leading-relaxed text-tx-muted">
      {{ t('drop.supports') }}
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
