<script setup lang="ts">
import Icon from '@/components/Icon.vue'
import type { IconName } from '@/lib/icons'

withDefaults(
  defineProps<{
    icon: IconName
    label: string
    size?: number
    active?: boolean
    disabled?: boolean
  }>(),
  { size: 16, active: false, disabled: false },
)

defineEmits<{ click: [MouseEvent] }>()
</script>

<template>
  <button
    type="button"
    class="tx-no-drag flex h-7 w-7 items-center justify-center rounded transition-colors disabled:opacity-40"
    :class="active ? 'bg-tx-row text-tx-text' : 'text-tx-muted hover:bg-tx-row hover:text-tx-text'"
    :title="label"
    :aria-label="label"
    :disabled="disabled"
    @click="$emit('click', $event)"
  >
    <Icon :name="icon" :size="size" />
  </button>
</template>
