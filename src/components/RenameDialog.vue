<script setup lang="ts">
import { computed, ref } from 'vue'
import Icon from '@/components/Icon.vue'
import { useQueueStore } from '@/stores/queue'
import { useUiStore } from '@/stores/ui'
import { t } from '@/lib/i18n'

const props = defineProps<{ rowIds: string[] }>()
const queue = useQueueStore()
const ui = useUiStore()

const rows = computed(() => props.rowIds.map((id) => queue.rows.find((r) => r.id === id)).filter((r) => !!r && !!r.outputPath))

const prefix = ref('')
const suffix = ref('')
const numbered = ref(rows.value.length > 1)
const startAt = ref(1)
const keepTitle = ref(true)
const custom = ref('')
const busy = ref(false)
const error = ref('')

const splitPath = (p: string) => {
  const i = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'))
  const dir = p.slice(0, i + 1)
  const file = p.slice(i + 1)
  const dot = file.lastIndexOf('.')
  return { dir, stem: dot > 0 ? file.slice(0, dot) : file, ext: dot > 0 ? file.slice(dot) : '' }
}
const clean = (t: string) => t.replace(/[\\/:*?"<>|]+/g, '-').trim()

/** The new names, computed live so the list below is the preview. */
const plan = computed(() => {
  const width = String(startAt.value + rows.value.length - 1).length
  return rows.value.map((r, i) => {
    const { dir, stem, ext } = splitPath(r!.outputPath!)
    const parts = [
      clean(prefix.value),
      numbered.value ? String(startAt.value + i).padStart(width, '0') : '',
      keepTitle.value ? stem : clean(custom.value),
      clean(suffix.value),
    ].filter(Boolean)
    const name = (parts.join(' ') || stem) + ext
    return { rowId: r!.id, from: r!.outputPath!, to: dir + name, name, old: stem + ext }
  })
})
const changes = computed(() => plan.value.filter((p) => p.from !== p.to))

async function apply(): Promise<void> {
  if (!changes.value.length || busy.value) return
  busy.value = true
  error.value = ''
  try {
    const done = await window.tuberx.files.rename(changes.value.map(({ rowId, from, to }) => ({ rowId, from, to })))
    ui.toast('success', done.length === 1 ? t('rename.renamedOne') : t('rename.renamedMany', { n: done.length }))
    ui.close()
  } catch (e) {
    error.value = (e as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, '')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="absolute inset-0 z-30 flex items-center justify-center bg-black/60 p-6" @click.self="ui.close()">
    <div class="flex w-full max-w-xl flex-col gap-3 rounded-lg border border-tx-border bg-tx-panel p-4 shadow-2xl">
      <div class="flex items-start justify-between gap-3">
        <div>
          <h2 class="text-sm font-semibold">{{ rows.length === 1 ? t('rename.titleOne') : t('rename.titleMany', { n: rows.length }) }}</h2>
          <p class="mt-0.5 text-[11px] text-tx-muted">{{ t('rename.hint') }}</p>
        </div>
        <button type="button" class="shrink-0 text-tx-muted hover:text-tx-text" :aria-label="t('common.close')" @click="ui.close()"><Icon name="close" :size="16" /></button>
      </div>

      <div class="grid grid-cols-2 gap-x-3 gap-y-2 text-[12px]">
        <label class="block">{{ t('rename.prefix') }}<input v-model="prefix" class="tx-field mt-1" :placeholder="t('rename.prefixPlaceholder')" /></label>
        <label class="block">{{ t('rename.suffix') }}<input v-model="suffix" class="tx-field mt-1" :placeholder="t('rename.suffixPlaceholder')" /></label>
        <label class="flex items-center gap-2"><input v-model="numbered" type="checkbox" class="accent-tx-accent" /> {{ t('rename.number') }}</label>
        <label class="flex items-center gap-2">{{ t('rename.startAt') }}<input v-model.number="startAt" type="number" min="0" class="tx-field w-20" :disabled="!numbered" /></label>
        <label class="flex items-center gap-2"><input v-model="keepTitle" type="checkbox" class="accent-tx-accent" /> {{ t('rename.keepName') }}</label>
        <label class="block"><input v-model="custom" class="tx-field" :placeholder="t('rename.customPlaceholder')" :disabled="keepTitle" /></label>
      </div>

      <div class="max-h-40 overflow-y-auto rounded border border-tx-border">
        <div v-for="p in plan" :key="p.rowId" class="grid grid-cols-[1fr_auto_1fr] items-center gap-2 border-b border-tx-border px-2 py-1 text-[11px] last:border-b-0">
          <span class="truncate text-tx-muted" :title="p.old">{{ p.old }}</span>
          <span class="text-tx-muted">→</span>
          <span class="truncate" :class="p.from === p.to ? 'text-tx-muted' : 'text-tx-text'" :title="p.name">{{ p.name }}</span>
        </div>
      </div>

      <p v-if="error" class="text-[12px] text-red-400">{{ error }}</p>
      <div class="flex items-center justify-end gap-2">
        <button type="button" class="tx-btn-ghost" @click="ui.close()">{{ t('common.cancel') }}</button>
        <button type="button" class="tx-btn-accent" :disabled="!changes.length || busy" @click="apply">{{ changes.length ? t('rename.applyN', { n: changes.length }) : t('rename.apply') }}</button>
      </div>
    </div>
  </div>
</template>
