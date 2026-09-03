<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { extractUrls } from '@shared/urls'
import TitleBar from '@/components/TitleBar.vue'
import DropZone from '@/components/DropZone.vue'
import QueueList from '@/components/QueueList.vue'
import LaterPanel from '@/components/LaterPanel.vue'
import HistoryPanel from '@/components/HistoryPanel.vue'
import SettingsPanel from '@/components/SettingsPanel.vue'
import MultiLinkDialog from '@/components/MultiLinkDialog.vue'
import PlaylistPrompt from '@/components/PlaylistPrompt.vue'
import Toasts from '@/components/Toasts.vue'
import Icon from '@/components/Icon.vue'
import { PRESET_FORMATS } from '@/lib/formats'
import { folderName } from '@/lib/paths'
import { guard, listen } from '@/lib/ipc'
import { useQueueStore } from '@/stores/queue'
import { useSettingsStore } from '@/stores/settings'
import { useLaterStore } from '@/stores/later'
import { useHistoryStore } from '@/stores/history'
import { useUiStore } from '@/stores/ui'

const queue = useQueueStore()
const settings = useSettingsStore()
const laterStore = useLaterStore()
const historyStore = useHistoryStore()
const ui = useUiStore()

const applyFormat = ref('')
const unbinds: Array<() => void> = []

const drawerOpen = computed(
  () => ui.panel === 'later' || ui.panel === 'history' || ui.panel === 'settings',
)

// --- input helpers ---------------------------------------------------------

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el || !el.tagName) return false
  const tag = el.tagName.toUpperCase()
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}

function addFromText(text: string): boolean {
  const urls = extractUrls(text)
  if (!urls.length) return false
  void queue.addUrls(urls)
  return true
}

/** Read every dropped .txt in parallel, then add once so the toast is a single line. */
function addFromTextFiles(files: File[]): void {
  const found: string[] = []
  let pending = files.length

  const finish = (): void => {
    pending -= 1
    if (pending > 0) return
    const unique = [...new Set(found)]
    if (unique.length) void queue.addUrls(unique)
    else ui.toast('warn', 'No links in that file')
  }

  for (const file of files) {
    const reader = new FileReader()
    reader.onload = () => {
      found.push(...extractUrls(String(reader.result ?? '')))
      finish()
    }
    reader.onerror = () => {
      ui.toast('error', `Could not read ${file.name}`)
      finish()
    }
    reader.readAsText(file)
  }
}

// --- global handlers -------------------------------------------------------

function onPaste(e: ClipboardEvent): void {
  if (isTypingTarget(e.target)) return
  const text = e.clipboardData?.getData('text') ?? ''
  if (addFromText(text)) e.preventDefault()
}

function onDragOver(e: DragEvent): void {
  e.preventDefault()
  ui.setDragging(true)
}

function onDragLeave(e: DragEvent): void {
  if (!e.relatedTarget) ui.setDragging(false)
}

function onDrop(e: DragEvent): void {
  e.preventDefault()
  ui.setDragging(false)
  const dt = e.dataTransfer
  if (!dt) return

  const textFiles = [...dt.files].filter((f) => /\.txt$/i.test(f.name))
  if (textFiles.length) {
    addFromTextFiles(textFiles)
    return
  }

  const text = dt.getData('text/uri-list') || dt.getData('text/plain') || dt.getData('text')
  if (!addFromText(text)) ui.toast('warn', 'No links in that drop')
}

function onKeyDown(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    if (ui.playlistPrompt) ui.closePlaylist()
    else ui.close()
    return
  }

  const typing = isTypingTarget(e.target)
  const mod = e.ctrlKey || e.metaKey

  if (mod && e.key.toLowerCase() === 'o') {
    e.preventDefault()
    ui.open('multilink')
    return
  }

  if (typing) return

  if (mod && e.key.toLowerCase() === 'a') {
    e.preventDefault()
    queue.selectAll()
    return
  }

  if (e.key === 'Delete' && queue.selected.size) {
    e.preventDefault()
    void queue.remove([...queue.selected])
  }
}

// --- right-click -----------------------------------------------------------

function onContextMenu(e: MouseEvent): void {
  const target = e.target as HTMLElement | null
  // Leave the browser menu alone inside text fields so cut/copy/paste keep working there.
  if (target?.closest('input, textarea, [contenteditable="true"]')) return
  e.preventDefault()
  const rowEl = target?.closest<HTMLElement>('[data-row-id]')
  void guard(() => window.tuberx.contextMenu(rowEl ? 'row' : 'app', rowEl?.dataset.rowId))
}

// --- bottom bar ------------------------------------------------------------

function onApplyToAll(e: Event): void {
  const value = (e.target as HTMLSelectElement).value
  applyFormat.value = value
  if (value) void queue.setFormatAll(value)
}

// --- lifecycle -------------------------------------------------------------

onMounted(() => {
  unbinds.push(ui.bind(), queue.bind(), settings.bind(), laterStore.bind(), historyStore.bind())
  unbinds.push(
    listen('url:incoming', ({ url, later }) => {
      if (later) void laterStore.add([url])
      else void queue.addUrls([url])
    }),
  )

  document.addEventListener('paste', onPaste)
  document.addEventListener('keydown', onKeyDown)
  document.addEventListener('contextmenu', onContextMenu)
  unbinds.push(listen('ui:selectAll', () => queue.selectAll()))
  window.addEventListener('dragover', onDragOver)
  window.addEventListener('dragleave', onDragLeave)
  window.addEventListener('drop', onDrop)

  void settings.load().then(() => {
    applyFormat.value = settings.settings.defaultFormatId
  })
  void settings.refreshTools()
  void queue.refresh()
})

onBeforeUnmount(() => {
  for (const off of unbinds) off()
  document.removeEventListener('paste', onPaste)
  document.removeEventListener('keydown', onKeyDown)
  document.removeEventListener('contextmenu', onContextMenu)
  window.removeEventListener('dragover', onDragOver)
  window.removeEventListener('dragleave', onDragLeave)
  window.removeEventListener('drop', onDrop)
})
</script>

<template>
  <div class="flex h-full flex-col overflow-hidden bg-tx-bg text-tx-text">
    <TitleBar />

    <main class="relative min-h-0 flex-1 overflow-hidden">
      <DropZone v-if="!queue.count" />

      <div v-else class="flex h-full flex-col">
        <DropZone compact />
        <div class="min-h-0 flex-1 overflow-y-auto">
          <QueueList />
        </div>
      </div>

      <div
        v-if="ui.dragging"
        class="pointer-events-none absolute inset-2 z-10 rounded-lg border-2 border-dashed border-tx-accent/70"
        aria-hidden="true"
      />

      <Transition
        enter-active-class="transition-transform duration-150 ease-out"
        enter-from-class="translate-x-full"
        leave-active-class="transition-transform duration-150 ease-in"
        leave-to-class="translate-x-full"
      >
        <aside
          v-if="drawerOpen"
          class="absolute right-0 top-0 z-20 h-full w-[380px] border-l border-tx-border bg-tx-panel shadow-2xl"
        >
          <LaterPanel v-if="ui.panel === 'later'" />
          <HistoryPanel v-else-if="ui.panel === 'history'" />
          <SettingsPanel v-else-if="ui.panel === 'settings'" />
        </aside>
      </Transition>

      <MultiLinkDialog v-if="ui.panel === 'multilink'" />

      <PlaylistPrompt
        v-if="ui.playlistPrompt"
        :row-id="ui.playlistPrompt.rowId"
        :media="ui.playlistPrompt.media"
      />

      <Toasts />
    </main>

    <footer
      class="flex h-12 shrink-0 items-center gap-3 border-t border-tx-border bg-tx-panel px-3"
    >
      <button
        type="button"
        class="flex min-w-0 max-w-[180px] items-center gap-1.5 rounded border border-tx-border bg-tx-row px-2 py-1 text-[11px] text-tx-muted transition-colors hover:border-tx-muted hover:text-tx-text"
        :title="settings.settings.destination || 'Choose where downloads go'"
        @click="settings.pickDestination()"
      >
        <Icon name="folder" :size="13" />
        <span class="truncate">{{ folderName(settings.settings.destination) }}</span>
      </button>

      <span class="min-w-0 flex-1 truncate text-center text-[11px] text-tx-muted">
        {{ queue.statusText }}
      </span>

      <select
        class="h-7 max-w-[150px] rounded border border-tx-border bg-tx-bg px-2 text-xs text-tx-text outline-none transition-colors hover:border-tx-muted focus:border-tx-accent disabled:opacity-40"
        :value="applyFormat"
        :disabled="!queue.count"
        title="Apply one format to every row"
        @change="onApplyToAll"
      >
        <option value="" disabled>Apply to all…</option>
        <option v-for="f in PRESET_FORMATS" :key="f.id" :value="f.id">{{ f.label }}</option>
      </select>

      <button
        type="button"
        class="tx-btn-accent px-4 py-2 text-[13px]"
        :disabled="!queue.hasStartable"
        @click="queue.startAll()"
      >
        Download All
      </button>
    </footer>
  </div>
</template>
