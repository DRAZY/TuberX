<script setup lang="ts">
import { ref } from 'vue'
import MediaRow from '@/components/MediaRow.vue'
import { ROW_DRAG_TYPE } from '@/lib/drag'
import { useQueueStore } from '@/stores/queue'

const queue = useQueueStore()

function onBackgroundClick(e: MouseEvent): void {
  if (e.target === e.currentTarget) queue.clearSelection()
}

// Drag a row to set its place; the list order is the download order.
const dragging = ref<string | null>(null)
const over = ref<{ id: string; after: boolean } | null>(null)

function rowIdAt(e: DragEvent): string | null {
  return ((e.target as HTMLElement | null)?.closest('[data-row-id]') as HTMLElement | null)?.dataset.rowId ?? null
}
function onDragStart(e: DragEvent): void {
  const id = rowIdAt(e)
  if (!id || !e.dataTransfer) return
  dragging.value = id
  e.dataTransfer.setData(ROW_DRAG_TYPE, id)
  e.dataTransfer.effectAllowed = 'move'
}
function onDragOver(e: DragEvent): void {
  if (!dragging.value) return
  e.preventDefault()
  e.stopPropagation()
  const el = (e.target as HTMLElement | null)?.closest('[data-row-id]') as HTMLElement | null
  if (!el) return
  const box = el.getBoundingClientRect()
  over.value = { id: el.dataset.rowId!, after: e.clientY > box.top + box.height / 2 }
}
function onDrop(e: DragEvent): void {
  if (!dragging.value) return
  e.preventDefault()
  e.stopPropagation()
  const from = dragging.value
  const target = over.value
  dragging.value = null
  over.value = null
  if (!target || target.id === from) return
  const ids = queue.rows.map((r) => r.id).filter((id) => id !== from)
  const at = ids.indexOf(target.id) + (target.after ? 1 : 0)
  ids.splice(at, 0, from)
  void queue.reorder(ids)
}
function onDragEnd(): void {
  dragging.value = null
  over.value = null
}
function edgeClass(id: string): string {
  if (!over.value || over.value.id !== id || dragging.value === id) return ''
  return over.value.after ? 'shadow-[inset_0_-2px_0_0_#e0393e]' : 'shadow-[inset_0_2px_0_0_#e0393e]'
}
</script>

<template>
  <ul class="min-h-full list-none" @click="onBackgroundClick" @dragstart="onDragStart" @dragover="onDragOver" @drop="onDrop" @dragend="onDragEnd">
    <MediaRow
      v-for="row in queue.rows"
      :key="row.id"
      :row="row"
      draggable="true"
      :class="[edgeClass(row.id), dragging === row.id ? 'opacity-40' : '']"
    />
  </ul>
</template>
