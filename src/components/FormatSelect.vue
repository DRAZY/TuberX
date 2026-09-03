<script setup lang="ts">
import { computed } from 'vue'
import type { FormatOption } from '@shared/types'
import { formatBytes } from '@shared/normalize'
import { isAudio } from '@/lib/formats'

const props = withDefaults(
  defineProps<{
    formats: FormatOption[]
    modelValue?: string
    disabled?: boolean
  }>(),
  { modelValue: '', disabled: false },
)

const emit = defineEmits<{ 'update:modelValue': [string] }>()

const video = computed(() => props.formats.filter((f) => !isAudio(f.kind)))
const audio = computed(() => props.formats.filter((f) => isAudio(f.kind)))

function optionLabel(f: FormatOption): string {
  const size = formatBytes(f.filesize)
  return size ? `${f.label} · ${size}` : f.label
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
    :title="disabled ? 'Format is locked while this row is busy' : 'Choose a format'"
    @change="onChange"
  >
    <option v-if="!formats.length" value="">—</option>
    <optgroup v-if="video.length" label="Video">
      <option v-for="f in video" :key="f.id" :value="f.id">{{ optionLabel(f) }}</option>
    </optgroup>
    <optgroup v-if="audio.length" label="Audio">
      <option v-for="f in audio" :key="f.id" :value="f.id">{{ optionLabel(f) }}</option>
    </optgroup>
  </select>
</template>
