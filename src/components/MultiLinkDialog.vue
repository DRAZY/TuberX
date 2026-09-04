<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import { extractUrls } from '@shared/urls'
import { useQueueStore } from '@/stores/queue'
import { useUiStore } from '@/stores/ui'
import { t } from '@/lib/i18n'

const queue = useQueueStore()
const ui = useUiStore()

const text = ref('')
const box = ref<HTMLTextAreaElement | null>(null)

const urls = computed(() => extractUrls(text.value))

onMounted(() => void nextTick(() => box.value?.focus()))

function appendUrls(found: string[]): void {
  if (!found.length) return
  text.value = text.value ? `${text.value.replace(/\s*$/, '')}\n${found.join('\n')}` : found.join('\n')
}

function onDrop(e: DragEvent): void {
  const file = e.dataTransfer?.files?.[0]
  if (file && /\.txt$/i.test(file.name)) {
    const reader = new FileReader()
    reader.onload = () => appendUrls(extractUrls(String(reader.result ?? '')))
    reader.onerror = () => ui.toast('error', t('app.couldNotRead', { name: file.name }))
    reader.readAsText(file)
    return
  }
  const dropped = e.dataTransfer?.getData('text') ?? ''
  appendUrls(extractUrls(dropped))
}

async function submit(): Promise<void> {
  if (!urls.value.length) return
  const batch = urls.value
  ui.close()
  await queue.addUrls(batch)
}
</script>

<template>
  <div
    class="absolute inset-0 z-30 flex items-center justify-center bg-black/50 p-8"
    @click.self="ui.close()"
  >
    <div class="w-full max-w-lg rounded-lg border border-tx-border bg-tx-panel p-4 shadow-2xl">
      <h2 class="text-sm font-semibold">{{ t('multilink.title') }}</h2>
      <p class="mt-0.5 text-[11px] text-tx-muted">{{ t('multilink.hint') }}</p>

      <textarea
        ref="box"
        v-model="text"
        rows="8"
        spellcheck="false"
        placeholder="https://www.youtube.com/watch?v=…"
        class="tx-field mt-3 resize-none font-mono text-[11px] leading-relaxed"
        @drop.prevent.stop="onDrop"
        @dragover.prevent.stop
      />

      <div class="mt-3 flex items-center justify-between">
        <span class="text-[11px] text-tx-muted">
          {{ urls.length === 1 ? t('multilink.detectedOne') : t('multilink.detectedMany', { n: urls.length }) }}
        </span>
        <div class="flex items-center gap-2">
          <button type="button" class="tx-btn-ghost" @click="ui.close()">{{ t('common.cancel') }}</button>
          <button type="button" class="tx-btn-accent" :disabled="!urls.length" @click="submit">
            {{ urls.length === 1 ? t('multilink.addOne') : t('multilink.addMany', { n: urls.length }) }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
