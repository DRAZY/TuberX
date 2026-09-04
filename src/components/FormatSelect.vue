<script setup lang="ts">
import { computed } from 'vue'
import type { FormatOption } from '@shared/types'
import { formatBytes } from '@shared/normalize'
import { formatLabel, isAudio } from '@/lib/formats'
import { t } from '@/lib/i18n'

const props = withDefaults(
  defineProps<{
    formats: FormatOption[]
    modelValue?: string
    disabled?: boolean
    /** Media length in seconds: lets the picker estimate MP3 and WAV sizes yt-dlp cannot know. */
    duration?: number
    mp3Bitrate?: number
  }>(),
  { modelValue: '', disabled: false, duration: 0, mp3Bitrate: 320 },
)

const emit = defineEmits<{ 'update:modelValue': [string] }>()

const video = computed(() => props.formats.filter((f) => !isAudio(f.kind) && f.kind !== 'subs'))
const audio = computed(() => props.formats.filter((f) => isAudio(f.kind)))
const other = computed(() => props.formats.filter((f) => f.kind === 'subs'))

/** Sizes are estimates: stream sizes from the site for video and M4A, arithmetic for the converted kinds. */
function estimate(f: FormatOption): number | undefined {
  if (f.filesize) return f.filesize
  if (!props.duration) return undefined
  if (f.kind === 'mp3') return (props.duration * props.mp3Bitrate * 1000) / 8
  if (f.kind === 'wav') return props.duration * 44100 * 2 * 2
  if (f.kind === 'm4r') return (Math.min(40, props.duration) * 128000) / 8
  return undefined
}
function optionLabel(f: FormatOption): string {
  const size = formatBytes(estimate(f))
  const label = formatLabel(f)
  return size ? `${label} · ≈${size}` : label
}

function onChange(e: Event): void {
  emit('update:modelValue', (e.target as HTMLSelectElement).value)
}
</script>

<template>
  <select
    class="h-7 max-w-[190px] rounded border border-tx-border bg-tx-bg px-2 text-xs text-tx-text outline-none transition-colors hover:border-tx-muted focus:border-tx-accent disabled:cursor-not-allowed disabled:opacity-40"
    :value="modelValue"
    :disabled="disabled || !formats.length"
    :title="disabled ? t('format.locked') : t('format.choose')"
    @change="onChange"
  >
    <option v-if="!formats.length" value="">—</option>
    <optgroup v-if="video.length" :label="t('format.video')">
      <option v-for="f in video" :key="f.id" :value="f.id">{{ optionLabel(f) }}</option>
    </optgroup>
    <optgroup v-if="audio.length" :label="t('format.audio')">
      <option v-for="f in audio" :key="f.id" :value="f.id">{{ optionLabel(f) }}</option>
    </optgroup>
    <optgroup v-if="other.length" :label="t('format.other')">
      <option v-for="f in other" :key="f.id" :value="f.id">{{ formatLabel(f) }}</option>
    </optgroup>
  </select>
</template>
