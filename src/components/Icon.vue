<script setup lang="ts">
import { computed } from 'vue'
import { ICONS, type IconDef, type IconName } from '@/lib/icons'

const props = withDefaults(defineProps<{ name: IconName; size?: number }>(), { size: 16 })

const def = computed<IconDef>(() => ICONS[props.name])
</script>

<template>
  <svg
    :width="props.size"
    :height="props.size"
    viewBox="0 0 24 24"
    :fill="def.filled ? 'currentColor' : 'none'"
    :stroke="def.filled ? 'none' : 'currentColor'"
    stroke-width="1.7"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    class="shrink-0"
  >
    <path v-for="(d, i) in def.d" :key="i" :d="d" />
  </svg>
</template>
