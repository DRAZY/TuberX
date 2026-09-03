<script setup lang="ts">
import { onMounted } from 'vue'
import Icon from '@/components/Icon.vue'
import IconButton from '@/components/IconButton.vue'
import Spinner from '@/components/Spinner.vue'
import { formatDate } from '@/lib/paths'
import { useLaterStore } from '@/stores/later'
import { useQueueStore } from '@/stores/queue'
import { useUiStore } from '@/stores/ui'

const later = useLaterStore()
const queue = useQueueStore()
const ui = useUiStore()

onMounted(() => void later.ensureLoaded())

async function sendOne(id: string): Promise<void> {
  await later.sendToQueue([id])
  await queue.refresh()
}

async function sendAll(): Promise<void> {
  await later.sendAllToQueue()
  await queue.refresh()
}
function exportLinks(): void {
  void window.tuberx.exportLinks('later')
}
</script>

<template>
  <div class="flex h-full flex-col">
    <header class="flex shrink-0 items-center justify-between border-b border-tx-border px-4 py-3">
      <h2 class="text-sm font-semibold">Download Later</h2>
      <IconButton icon="close" label="Close" @click="ui.close()" />
    </header>

    <div class="flex shrink-0 items-center justify-between gap-2 border-b border-tx-border px-4 py-2">
      <span class="text-[11px] text-tx-muted">{{ later.count }} saved</span>
      <span class="flex items-center gap-2">
        <button type="button" class="tx-btn-ghost" :disabled="!later.count" title="Save the links as a text file" @click="exportLinks">Export…</button>
        <button type="button" class="tx-btn-ghost" :disabled="!later.count" @click="sendAll">
          Send all to queue
        </button>
      </span>
    </div>

    <div v-if="later.loading" class="flex items-center justify-center py-8">
      <Spinner :size="18" />
    </div>

    <p v-else-if="!later.count" class="px-4 py-8 text-center text-[11px] text-tx-muted">
      Nothing saved yet. Links sent with the browser extension land here.
    </p>

    <ul v-else class="min-h-0 flex-1 list-none overflow-y-auto">
      <li
        v-for="entry in later.entries"
        :key="entry.id"
        class="group flex items-start gap-2.5 border-b border-tx-border px-4 py-2.5"
      >
        <div class="flex h-9 w-16 shrink-0 items-center justify-center overflow-hidden rounded bg-tx-row">
          <img v-if="entry.thumbnail" :src="entry.thumbnail" alt="" class="h-full w-full object-cover" />
          <Icon v-else name="play" :size="14" class="text-tx-muted/60" />
        </div>

        <div class="min-w-0 flex-1">
          <p class="tx-clamp-2 text-[12px] leading-snug" :title="entry.title ?? entry.url">
            {{ entry.title || entry.url }}
          </p>
          <p class="mt-0.5 text-[10px] text-tx-muted">{{ formatDate(entry.addedAt) }}</p>
          <div class="mt-1 flex items-center gap-2">
            <button type="button" class="tx-btn-ghost !py-1" @click="sendOne(entry.id)">
              Send to queue
            </button>
          </div>
        </div>

        <button
          type="button"
          class="shrink-0 text-tx-muted opacity-0 hover:text-tx-text group-hover:opacity-100"
          title="Remove"
          aria-label="Remove"
          @click="later.remove([entry.id])"
        >
          <Icon name="close" :size="13" />
        </button>
      </li>
    </ul>
  </div>
</template>
