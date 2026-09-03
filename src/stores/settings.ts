import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { DEFAULT_SETTINGS, type AppInfo, type Settings, type ToolStatus } from '@shared/types'
import { guard, listen } from '@/lib/ipc'
import { useUiStore } from '@/stores/ui'

export const useSettingsStore = defineStore('settings', () => {
  const ui = useUiStore()
  const settings = ref<Settings>({ ...DEFAULT_SETTINGS })
  const tools = ref<ToolStatus[]>([])
  const appInfo = ref<AppInfo | null>(null)
  const loaded = ref(false)
  const engineUpdating = ref(false)
  const engineResult = ref('')

  const proxyActive = computed(() => settings.value.proxyEnabled && !!settings.value.proxy)

  async function load(): Promise<void> {
    const next = await guard(() => window.tuberx.settings.get())
    if (next) settings.value = next
    loaded.value = true
  }

  async function update(patch: Partial<Settings>): Promise<void> {
    // Optimistic so controls never lag the click; main's reply is authoritative.
    settings.value = { ...settings.value, ...patch }
    const next = await guard(() => window.tuberx.settings.set(patch))
    if (next) settings.value = next
  }

  async function pickDestination(): Promise<void> {
    const path = await guard(() => window.tuberx.settings.pickDestination())
    if (!path) return
    await update({ destination: path })
  }

  async function refreshTools(): Promise<void> {
    const next = await guard(() => window.tuberx.tools.status())
    if (next) tools.value = next
  }

  async function updateEngine(): Promise<void> {
    if (engineUpdating.value) return
    engineUpdating.value = true
    engineResult.value = ''
    const res = await guard(() => window.tuberx.tools.updateEngine())
    engineUpdating.value = false
    if (!res) {
      engineResult.value = 'Update failed'
      return
    }
    engineResult.value = res.updated ? `Updated to ${res.version}` : `Already on ${res.version}`
    ui.toast(res.updated ? 'success' : 'info', engineResult.value)
    await refreshTools()
  }

  function bind(): () => void {
    const offs = [
      listen('tools:status', (next) => {
        tools.value = next
      }),
      listen('engine:updated', ({ from, to }) => {
        engineResult.value = from ? `Updated ${from} → ${to}` : `Updated to ${to}`
        void refreshTools()
      }),
    ]
    return () => {
      for (const off of offs) off()
    }
  }

  async function loadAppInfo(): Promise<void> {
    if (appInfo.value) return
    const info = await guard(() => window.tuberx.app.info())
    if (info) appInfo.value = info
  }

  return {
    appInfo,
    loadAppInfo,
    settings,
    tools,
    loaded,
    engineUpdating,
    engineResult,
    proxyActive,
    load,
    update,
    pickDestination,
    refreshTools,
    updateEngine,
    bind,
  }
})
