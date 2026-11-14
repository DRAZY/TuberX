<script setup lang="ts">
/**
 * Pick several languages by name: the chosen ones as removable chips, then a searchable list with
 * checkboxes. Codes stay out of the way (shown small, and searchable). A code saved before this picker
 * existed and not in the list (say "en-GB") is still shown, named, and kept until it is unchecked.
 */
import { computed, ref } from 'vue'
import { LANGUAGE_CODE, LANGUAGE_CODES } from '@shared/languages'
import Icon from '@/components/Icon.vue'
import { languageName } from '@/lib/languages'
import { locale, t } from '@/lib/i18n'

const props = defineProps<{ modelValue: string[] }>()
const emit = defineEmits<{ 'update:modelValue': [string[]] }>()

const query = ref('')
const chosen = computed(() => props.modelValue.filter((c) => LANGUAGE_CODE.test(c)))

const all = computed(() => {
  const codes = [...new Set<string>([...LANGUAGE_CODES, ...chosen.value])]
  return codes
    .map((code) => ({ code, name: languageName(code, locale.value), english: languageName(code, 'en') }))
    .sort((a, b) => a.name.localeCompare(b.name, locale.value))
})

const visible = computed(() => {
  const q = query.value.trim().toLocaleLowerCase()
  const list = q
    ? all.value.filter((l) => l.name.toLocaleLowerCase().includes(q) || l.english.toLowerCase().includes(q) || l.code.toLowerCase().startsWith(q))
    : all.value
  // Chosen first, so the list opens on what is already picked.
  return [...list.filter((l) => chosen.value.includes(l.code)), ...list.filter((l) => !chosen.value.includes(l.code))]
})

function toggle(code: string): void {
  emit('update:modelValue', chosen.value.includes(code) ? chosen.value.filter((c) => c !== code) : [...chosen.value, code])
}
</script>

<template>
  <div>
    <div class="mt-1 flex min-h-[26px] flex-wrap items-center gap-1">
      <span
        v-for="code in chosen"
        :key="code"
        class="flex items-center gap-1 rounded-full border border-tx-border bg-tx-row px-2 py-0.5 text-[11px] text-tx-text"
      >
        {{ languageName(code, locale) }}
        <button
          type="button"
          class="text-tx-muted hover:text-tx-text"
          :title="t('settings.subtitles.remove', { language: languageName(code, locale) })"
          :aria-label="t('settings.subtitles.remove', { language: languageName(code, locale) })"
          @click="toggle(code)"
        >
          <Icon name="close" :size="10" />
        </button>
      </span>
      <span v-if="!chosen.length" class="text-[10px] text-tx-muted">{{ t('settings.subtitles.noneHint') }}</span>
    </div>

    <input
      v-model="query"
      type="search"
      class="tx-field mt-1.5"
      data-testid="subtitle-language-search"
      :placeholder="t('settings.subtitles.search')"
      :aria-label="t('settings.subtitles.search')"
    />
    <ul class="mt-1 max-h-44 overflow-y-auto rounded border border-tx-border" role="listbox" aria-multiselectable="true">
      <li v-for="l in visible" :key="l.code">
        <label class="flex cursor-default items-center gap-2 px-2 py-1 text-[12px] text-tx-text hover:bg-tx-row">
          <input
            type="checkbox"
            class="h-3.5 w-3.5 shrink-0 accent-tx-accent"
            :checked="chosen.includes(l.code)"
            @change="toggle(l.code)"
          />
          <span class="min-w-0 flex-1 truncate">{{ l.name }}</span>
          <span class="shrink-0 text-[10px] text-tx-muted">{{ l.code }}</span>
        </label>
      </li>
      <li v-if="!visible.length" class="px-2 py-1.5 text-[11px] text-tx-muted">{{ t('settings.subtitles.noMatch') }}</li>
    </ul>
  </div>
</template>
