import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { MediaItem, ToastKind } from '@shared/types'

export type PanelName = 'none' | 'later' | 'history' | 'settings' | 'multilink' | 'playlist' | 'trim' | 'split' | 'rename'

export interface Toast {
  id: number
  kind: ToastKind
  message: string
}

export interface PlaylistPromptState {
  rowId: string
  media: MediaItem
}

const TOAST_MS = 4000

export const useUiStore = defineStore('ui', () => {
  const panel = ref<PanelName>('none')
  const toasts = ref<Toast[]>([])
  const playlistPrompt = ref<PlaylistPromptState | null>(null)
  const dragging = ref(false)

  let nextToastId = 1
  const timers = new Map<number, ReturnType<typeof setTimeout>>()

  /** Where the opened panel should scroll to, consumed once by the panel (the About link uses it). */
  const anchor = ref<string | null>(null)

  function open(name: PanelName, to?: string): void {
    panel.value = name
    anchor.value = to ?? null
  }

  function toggle(name: PanelName): void {
    panel.value = panel.value === name ? 'none' : name
  }

  function close(): void {
    if (panel.value === 'playlist') playlistPrompt.value = null
    panel.value = 'none'
  }

  function dismiss(id: number): void {
    const timer = timers.get(id)
    if (timer) {
      clearTimeout(timer)
      timers.delete(id)
    }
    toasts.value = toasts.value.filter((t) => t.id !== id)
  }

  function toast(kind: ToastKind, message: string): void {
    if (!message) return
    const id = nextToastId++
    toasts.value.push({ id, kind, message })
    timers.set(
      id,
      setTimeout(() => dismiss(id), TOAST_MS),
    )
  }

  /** Row whose finished file the trim view is editing. */
  const trimRowId = ref<string | null>(null)
  function openTrim(rowId: string): void {
    trimRowId.value = rowId
    panel.value = 'trim'
  }
  const splitRowId = ref<string | null>(null)
  function openSplit(rowId: string): void {
    splitRowId.value = rowId
    panel.value = 'split'
  }
  /** Rows the rename dialog works on: the clicked row plus the current selection when it is part of it. */
  const renameRowIds = ref<string[]>([])
  function openRename(rowIds: string[]): void {
    renameRowIds.value = rowIds
    panel.value = 'rename'
  }
  function closeTrim(): void {
    trimRowId.value = null
    if (panel.value === 'trim') panel.value = 'none'
  }

  function openPlaylist(rowId: string, media: MediaItem): void {
    playlistPrompt.value = { rowId, media }
    panel.value = 'playlist'
  }

  function closePlaylist(): void {
    playlistPrompt.value = null
    if (panel.value === 'playlist') panel.value = 'none'
  }

  function setDragging(value: boolean): void {
    dragging.value = value
  }

  /**
   * Main-process toasts land in the same stack as local ones.
   * Subscribes directly rather than via lib/ipc, which imports this store.
   */
  function bind(): () => void {
    if (typeof window === 'undefined' || !window.tuberx) return () => {}
    try {
      return window.tuberx.on('toast', (p) => toast(p.kind, p.message))
    } catch {
      return () => {}
    }
  }

  return {
    anchor,
    trimRowId,
    openTrim,
    closeTrim,
    splitRowId,
    openSplit,
    renameRowIds,
    openRename,
    panel,
    toasts,
    playlistPrompt,
    dragging,
    open,
    toggle,
    close,
    toast,
    dismiss,
    openPlaylist,
    closePlaylist,
    setDragging,
    bind,
  }
})
