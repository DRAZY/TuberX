<script setup lang="ts">
defineProps<{ modelValue: boolean; label: string; hint?: string }>()
defineEmits<{ 'update:modelValue': [boolean] }>()
</script>

<template>
  <label class="flex cursor-default items-start justify-between gap-3 py-1.5">
    <span class="min-w-0">
      <span class="block text-[12px] text-tx-text">{{ label }}</span>
      <span v-if="hint" class="mt-0.5 block text-[10px] leading-snug text-tx-muted">{{ hint }}</span>
    </span>
    <input
      type="checkbox"
      class="mt-0.5 h-3.5 w-3.5 shrink-0 accent-tx-accent"
      :checked="modelValue"
      @change="$emit('update:modelValue', ($event.target as HTMLInputElement).checked)"
    />
  </label>
</template>
