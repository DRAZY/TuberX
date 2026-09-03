<script setup lang="ts">
import type { ToastKind } from '@shared/types'
import Icon from '@/components/Icon.vue'
import { useUiStore } from '@/stores/ui'

const ui = useUiStore()

const TONE: Record<ToastKind, string> = {
  info: 'border-tx-border text-tx-text',
  success: 'border-emerald-500/50 text-emerald-300',
  warn: 'border-amber-500/50 text-amber-300',
  error: 'border-red-500/50 text-red-300',
}
</script>

<template>
  <div class="pointer-events-none absolute bottom-4 left-1/2 z-40 flex -translate-x-1/2 flex-col items-center gap-1.5">
    <TransitionGroup
      enter-active-class="transition duration-150 ease-out"
      enter-from-class="translate-y-1 opacity-0"
      leave-active-class="transition duration-150 ease-in"
      leave-to-class="opacity-0"
    >
      <div
        v-for="t in ui.toasts"
        :key="t.id"
        class="pointer-events-auto flex max-w-md items-start gap-2 rounded-2xl border bg-tx-panel/95 px-3 py-2 text-[11px] leading-snug shadow-lg backdrop-blur"
        :class="TONE[t.kind]"
      >
        <span class="min-w-0 break-words">{{ t.message }}</span>
        <button
          type="button"
          class="shrink-0 opacity-60 hover:opacity-100"
          title="Dismiss"
          aria-label="Dismiss"
          @click="ui.dismiss(t.id)"
        >
          <Icon name="close" :size="11" />
        </button>
      </div>
    </TransitionGroup>
  </div>
</template>
