<script setup lang="ts">
import { onMounted, ref } from 'vue'
import Icon from '@/components/Icon.vue'
import IconButton from '@/components/IconButton.vue'
import Spinner from '@/components/Spinner.vue'
import { formatDate } from '@/lib/paths'
import { presetLabel } from '@/lib/formats'
import { useHistoryStore } from '@/stores/history'
import { useQueueStore } from '@/stores/queue'
import { useUiStore } from '@/stores/ui'

const history = useHistoryStore()
const queue = useQueueStore()
const ui = useUiStore()

const confirmingClear = ref(false)

onMounted(() => void history.ensureLoaded())

async function clearAll(): Promise<void> {
  confirmingClear.value = false
  await history.clear()
}
</script>

<template>
  <div class="flex h-full flex-col">
    <header class="flex shrink-0 items-center justify-between border-b border-tx-border px-4 py-3">
      <h2 class="text-sm font-semibold">History</h2>
      <IconButton icon="close" label="Close" @click="ui.close()" />
    </header>

    <div class="flex shrink-0 items-center justify-between gap-2 border-b border-tx-border px-4 py-2">
      <span class="text-[11px] text-tx-muted">{{ history.count }} completed</span>
      <template v-if="confirmingClear">
        <div class="flex items-center gap-2">
          <span class="text-[11px] text-tx-muted">Clear all?</span>
          <button type="button" class="tx-btn-ghost" @click="confirmingClear = false">No</button>
          <button type="button" class="tx-btn-accent" @click="clearAll">Yes, clear</button>
        </div>
      </template>
      <button
        v-else
        type="button"
        class="tx-btn-ghost"
        :disabled="!history.count"
        @click="confirmingClear = true"
      >
        Clear history
      </button>
    </div>

    <div v-if="history.loading" class="flex items-center justify-center py-8">
      <Spinner :size="18" />
    </div>

    <p v-else-if="!history.count" class="px-4 py-8 text-center text-[11px] text-tx-muted">
      Finished downloads show up here.
    </p>

    <ul v-else class="min-h-0 flex-1 list-none overflow-y-auto">
      <li
        v-for="entry in history.entries"
        :key="entry.id"
        class="group flex items-start gap-2.5 border-b border-tx-border px-4 py-2.5"
      >
        <div class="flex h-9 w-16 shrink-0 items-center justify-center overflow-hidden rounded bg-tx-row">
          <img v-if="entry.thumbnail" :src="entry.thumbnail" alt="" class="h-full w-full object-cover" />
          <Icon v-else name="play" :size="14" class="text-tx-muted/60" />
        </div>

        <div class="min-w-0 flex-1">
          <p class="tx-clamp-2 text-[12px] leading-snug" :title="entry.title">{{ entry.title }}</p>
          <p class="mt-0.5 text-[10px] text-tx-muted">
            {{ presetLabel(entry.formatId) }} · {{ formatDate(entry.completedAt) }}
          </p>
          <div class="mt-1 flex items-center gap-2">
            <button type="button" class="tx-btn-ghost !py-1" @click="history.reveal(entry.outputPath)">
              Reveal
            </button>
            <button type="button" class="tx-btn-ghost !py-1" @click="queue.addUrls([entry.url])">
              Add again
            </button>
          </div>
        </div>

        <button
          type="button"
          class="shrink-0 text-tx-muted opacity-0 hover:text-tx-text group-hover:opacity-100"
          title="Remove from history"
          aria-label="Remove from history"
          @click="history.remove([entry.id])"
        >
          <Icon name="close" :size="13" />
        </button>
      </li>
    </ul>
  </div>
</template>
