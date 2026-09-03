<script setup lang="ts">
import MediaRow from '@/components/MediaRow.vue'
import { useQueueStore } from '@/stores/queue'

const queue = useQueueStore()

function onBackgroundClick(e: MouseEvent): void {
  if (e.target === e.currentTarget) queue.clearSelection()
}
</script>

<template>
  <ul class="min-h-full list-none" @click="onBackgroundClick">
    <MediaRow v-for="row in queue.rows" :key="row.id" :row="row" />
  </ul>
</template>
