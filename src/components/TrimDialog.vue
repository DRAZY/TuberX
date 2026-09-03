<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { formatDuration } from '@shared/normalize'
import Icon from '@/components/Icon.vue'
import { guard, listen } from '@/lib/ipc'
import { useQueueStore } from '@/stores/queue'
import { useUiStore } from '@/stores/ui'

const props = defineProps<{ rowId: string }>()
const queue = useQueueStore()
const ui = useUiStore()

const row = computed(() => queue.rows.find((r) => r.id === props.rowId))
const src = computed(() => row.value?.outputPath ?? '')
const chapters = computed(() => row.value?.media?.chapters ?? [])

const video = ref<HTMLVideoElement | null>(null)
const url = ref('')
const duration = ref(0)
const current = ref(0)
const inPoint = ref(0)
const outPoint = ref(0)
const precise = ref(false)
const busy = ref<'mp4' | 'm4a' | 'm4r' | null>(null)
const percent = ref(0)
const result = ref('')
const error = ref('')
const unbinds: Array<() => void> = []

const length = computed(() => Math.max(0, outPoint.value - inPoint.value))
const valid = computed(() => duration.value > 0 && length.value >= 0.5)

/** "1:05.2" for an in/out point; seconds keep one decimal so the field is readable and precise enough. */
function fmt(sec: number): string {
  const whole = Math.floor(sec)
  const tenth = Math.floor((sec - whole) * 10)
  return `${formatDuration(whole)}.${tenth}`
}
/** Accept "1:05.2", "65.2", "1:02:03" */
function parse(text: string): number | null {
  const parts = text.trim().split(':').map(Number)
  if (parts.some((n) => Number.isNaN(n))) return null
  return parts.reduce((acc, n) => acc * 60 + n, 0)
}

function onLoaded(): void {
  duration.value = video.value?.duration ?? 0
  if (!outPoint.value) outPoint.value = duration.value
}
function onTime(): void {
  current.value = video.value?.currentTime ?? 0
  // Preview loops the selection: stop at the out point so what plays is what exports.
  if (video.value && !video.value.paused && current.value >= outPoint.value) video.value.pause()
}
function seek(sec: number): void {
  if (!video.value) return
  video.value.currentTime = Math.max(0, Math.min(duration.value, sec))
}
function setIn(): void {
  inPoint.value = Math.min(current.value, outPoint.value - 0.5)
}
function setOut(): void {
  outPoint.value = Math.max(current.value, inPoint.value + 0.5)
}
function editIn(e: Event): void {
  const v = parse((e.target as HTMLInputElement).value)
  if (v !== null) inPoint.value = Math.max(0, Math.min(v, outPoint.value - 0.5))
}
function editOut(e: Event): void {
  const v = parse((e.target as HTMLInputElement).value)
  if (v !== null) outPoint.value = Math.min(duration.value, Math.max(v, inPoint.value + 0.5))
}
function playSelection(): void {
  seek(inPoint.value)
  void video.value?.play()
}
function useChapter(start: number, end: number): void {
  inPoint.value = start
  outPoint.value = Math.min(end, duration.value || end)
  seek(start)
}

async function exportAs(kind: 'mp4' | 'm4a' | 'm4r'): Promise<void> {
  if (!valid.value || busy.value) return
  busy.value = kind
  percent.value = 0
  result.value = ''
  error.value = ''
  video.value?.pause()
  try {
    const out = await window.tuberx.trim.export({ src: src.value, start: inPoint.value, end: outPoint.value, kind, precise: precise.value })
    result.value = out
    ui.toast('success', `Saved ${out.split(/[\\/]/).pop()}`)
  } catch (e) {
    const msg = (e as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, '')
    if (!/cancelled/.test(msg)) error.value = msg
  } finally {
    busy.value = null
  }
}
function cancelExport(): void {
  void window.tuberx.trim.cancel()
}
function close(): void {
  if (busy.value) cancelExport()
  ui.closeTrim()
}

onMounted(async () => {
  const u = await guard(() => window.tuberx.media.url(src.value))
  if (u) url.value = u
  unbinds.push(listen('trim:progress', ({ percent: p }) => (percent.value = p)))
})
onBeforeUnmount(() => unbinds.forEach((u) => u()))
watch(inPoint, (v) => v > current.value && seek(v))
</script>

<template>
  <div class="absolute inset-0 z-30 flex items-center justify-center bg-black/60 p-6" @click.self="close">
    <div class="flex w-full max-w-2xl flex-col gap-3 rounded-lg border border-tx-border bg-tx-panel p-4 shadow-2xl">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <h2 class="truncate text-sm font-semibold">Trim · {{ row?.media?.title ?? 'file' }}</h2>
          <p class="mt-0.5 text-[11px] text-tx-muted">Set an in and out point, then export the clip beside the original. The original is never changed.</p>
        </div>
        <button type="button" class="shrink-0 text-tx-muted hover:text-tx-text" aria-label="Close" @click="close"><Icon name="close" :size="16" /></button>
      </div>

      <video
        ref="video"
        :src="url"
        class="max-h-[40vh] w-full rounded bg-black"
        controls
        preload="metadata"
        @loadedmetadata="onLoaded"
        @timeupdate="onTime"
      />

      <!-- Selection bar: the highlighted span is what exports -->
      <div class="relative h-2 w-full rounded-full bg-tx-border" @click="(e) => seek(((e.offsetX) / (e.currentTarget as HTMLElement).clientWidth) * duration)">
        <div
          class="absolute inset-y-0 rounded-full bg-tx-accent/70"
          :style="{ left: `${duration ? (inPoint / duration) * 100 : 0}%`, width: `${duration ? (length / duration) * 100 : 0}%` }"
        />
        <div class="absolute -top-1 h-4 w-0.5 bg-tx-text" :style="{ left: `${duration ? (current / duration) * 100 : 0}%` }" />
      </div>

      <div class="flex flex-wrap items-center gap-2 text-[12px]">
        <button type="button" class="tx-btn-ghost" :disabled="!duration" @click="setIn">Set in</button>
        <input class="tx-field w-24 text-center font-mono" :value="fmt(inPoint)" @change="editIn" />
        <span class="text-tx-muted">to</span>
        <input class="tx-field w-24 text-center font-mono" :value="fmt(outPoint)" @change="editOut" />
        <button type="button" class="tx-btn-ghost" :disabled="!duration" @click="setOut">Set out</button>
        <span class="text-tx-muted">· {{ fmt(length) }} long</span>
        <button type="button" class="tx-btn-ghost ml-auto flex items-center gap-1" :disabled="!valid" @click="playSelection"><Icon name="play" :size="12" /> Play selection</button>
      </div>

      <div v-if="chapters.length" class="flex flex-wrap gap-1.5">
        <button
          v-for="c in chapters"
          :key="c.start"
          type="button"
          class="rounded border border-tx-border px-2 py-0.5 text-[11px] text-tx-muted hover:border-tx-accent hover:text-tx-text"
          :title="`${formatDuration(c.start)} – ${formatDuration(c.end)}`"
          @click="useChapter(c.start, c.end)"
        >
          {{ c.title }}
        </button>
      </div>

      <label class="flex items-center gap-2 text-[11px] text-tx-muted">
        <input v-model="precise" type="checkbox" class="accent-tx-accent" />
        Frame-accurate cut (re-encodes the video; instant cuts land on the nearest keyframe, up to a few seconds early)
      </label>

      <div v-if="busy" class="flex items-center gap-3 text-[12px]">
        <div class="h-1.5 flex-1 overflow-hidden rounded-full bg-tx-border"><div class="h-full bg-tx-accent transition-[width]" :style="{ width: `${percent}%` }" /></div>
        <span class="w-10 text-right font-mono text-tx-muted">{{ Math.round(percent) }}%</span>
        <button type="button" class="tx-btn-ghost" @click="cancelExport">Cancel</button>
      </div>
      <p v-else-if="error" class="text-[12px] text-red-400">{{ error }}</p>
      <p v-else-if="result" class="flex items-center gap-2 text-[12px] text-tx-muted">
        <Icon name="check" :size="13" class="text-emerald-400" /><span class="truncate">{{ result }}</span>
        <button type="button" class="tx-btn-ghost" @click="queue.reveal(result)">Reveal</button>
      </p>

      <div class="flex flex-wrap items-center justify-end gap-2">
        <button type="button" class="tx-btn-ghost" :disabled="!valid || !!busy" @click="exportAs('m4r')">Ringtone (M4R, first 40 s)</button>
        <button type="button" class="tx-btn-ghost" :disabled="!valid || !!busy" @click="exportAs('m4a')">Audio (M4A)</button>
        <button type="button" class="tx-btn-accent" :disabled="!valid || !!busy" @click="exportAs('mp4')">Export clip (MP4)</button>
      </div>
    </div>
  </div>
</template>
