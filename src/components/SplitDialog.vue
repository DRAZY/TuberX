<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { formatDuration } from '@shared/normalize'
import Icon from '@/components/Icon.vue'
import { listen } from '@/lib/ipc'
import { useQueueStore } from '@/stores/queue'
import { useUiStore } from '@/stores/ui'

const props = defineProps<{ rowId: string }>()
const queue = useQueueStore()
const ui = useUiStore()

const row = computed(() => queue.rows.find((r) => r.id === props.rowId))
const src = computed(() => row.value?.outputPath ?? '')

/** Pre-filled from the video's own chapters when it has them; otherwise paste a list from the description. */
const text = ref((row.value?.media?.chapters ?? []).map((c) => `${formatDuration(c.start)} ${c.title}`).join('\n'))
const busy = ref<'clips' | 'chapters' | null>(null)
const percent = ref(0)
const outputs = ref<string[]>([])
const error = ref('')
const unbinds: Array<() => void> = []

/** One mark per line. Accepts "1:23 Title", "01:02:03 - Title", "Title 1:23", "[1:23] Title". */
const marks = computed(() => {
  const out: { start: number; title: string }[] = []
  for (const raw of text.value.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    const m = line.match(/(\d{1,2}:)?\d{1,2}:\d{2}(\.\d+)?/)
    if (!m) continue
    const start = m[0].split(':').map(Number).reduce((acc, n) => acc * 60 + n, 0)
    const title = line.replace(m[0], '').replace(/^[\s\-–—:\[\]()·.]+|[\s\-–—:\[\]()·]+$/g, '').trim()
    out.push({ start, title })
  }
  return out.sort((a, b) => a.start - b.start)
})

async function run(mode: 'clips' | 'chapters'): Promise<void> {
  if (!marks.value.length || busy.value) return
  busy.value = mode
  percent.value = 0
  outputs.value = []
  error.value = ''
  try {
    outputs.value = await window.tuberx.trim.split({ src: src.value, marks: marks.value, mode })
    ui.toast('success', mode === 'clips' ? `Saved ${outputs.value.length} clips` : 'Chapters written')
  } catch (e) {
    const msg = (e as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, '')
    if (!/cancelled/.test(msg)) error.value = msg
  } finally {
    busy.value = null
  }
}
function cancel(): void {
  void window.tuberx.trim.cancel()
}
function close(): void {
  if (busy.value) cancel()
  ui.close()
}
onMounted(() => unbinds.push(listen('trim:progress', ({ percent: p }) => (percent.value = p))))
onBeforeUnmount(() => unbinds.forEach((u) => u()))
</script>

<template>
  <div class="absolute inset-0 z-30 flex items-center justify-center bg-black/60 p-6" @click.self="close">
    <div class="flex w-full max-w-xl flex-col gap-3 rounded-lg border border-tx-border bg-tx-panel p-4 shadow-2xl">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <h2 class="truncate text-sm font-semibold">Split by timecodes · {{ row?.media?.title ?? 'file' }}</h2>
          <p class="mt-0.5 text-[11px] text-tx-muted">
            One line per part: a time and a title. Paste a tracklist from the description, or keep the chapters found in the video.
          </p>
        </div>
        <button type="button" class="shrink-0 text-tx-muted hover:text-tx-text" aria-label="Close" @click="close"><Icon name="close" :size="16" /></button>
      </div>

      <textarea v-model="text" rows="9" spellcheck="false" placeholder="0:00 Intro&#10;1:23 First song&#10;4:56 Second song" class="tx-field resize-none font-mono text-[11px] leading-relaxed" />

      <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-tx-muted">
        <span>{{ marks.length }} part{{ marks.length === 1 ? '' : 's' }} detected</span>
        <span v-for="m in marks.slice(0, 6)" :key="m.start" class="rounded border border-tx-border px-1.5 py-0.5">{{ formatDuration(m.start) }} {{ m.title || '(untitled)' }}</span>
        <span v-if="marks.length > 6">…</span>
      </div>

      <div v-if="busy" class="flex items-center gap-3 text-[12px]">
        <div class="h-1.5 flex-1 overflow-hidden rounded-full bg-tx-border"><div class="h-full bg-tx-accent transition-[width]" :style="{ width: `${percent}%` }" /></div>
        <span class="w-10 text-right font-mono text-tx-muted">{{ Math.round(percent) }}%</span>
        <button type="button" class="tx-btn-ghost" @click="cancel">Cancel</button>
      </div>
      <p v-else-if="error" class="text-[12px] text-red-400">{{ error }}</p>
      <div v-else-if="outputs.length" class="max-h-28 overflow-y-auto text-[11px] text-tx-muted">
        <p v-for="o in outputs" :key="o" class="flex items-center gap-1.5 truncate"><Icon name="check" :size="12" class="shrink-0 text-emerald-400" />{{ o.split(/[\\/]/).pop() }}</p>
      </div>

      <div class="flex flex-wrap items-center justify-end gap-2">
        <button type="button" class="tx-btn-ghost" :disabled="!marks.length || !!busy" title="Adds the parts as chapters inside this file; nothing is re-encoded" @click="run('chapters')">Write as chapters</button>
        <button type="button" class="tx-btn-accent" :disabled="!marks.length || !!busy" title="One file per part, beside the original" @click="run('clips')">Split into {{ marks.length || '' }} clips</button>
      </div>
    </div>
  </div>
</template>
