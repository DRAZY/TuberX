import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { DEFAULT_SETTINGS, type AppInfo, type Settings, type ToolStatus, type UpdateStatus } from '@shared/types'
import { guard, listen } from '@/lib/ipc'
import { useUiStore } from '@/stores/ui'
import { setLocale, t } from '@/lib/i18n'

export const useSettingsStore = defineStore('settings', () => {
  const ui = useUiStore()
  const settings = ref<Settings>({ ...DEFAULT_SETTINGS })
  const tools = ref<ToolStatus[]>([])
  const appInfo = ref<AppInfo | null>(null)
  const appUpdate = ref<UpdateStatus>({ state: 'idle', current: '' })
  const canInstall = ref(false)
  const loaded = ref(false)
  const engineUpdating = ref(false)
  const engineResult = ref('')

  const proxyActive = computed(() => settings.value.proxyEnabled && !!settings.value.proxy)

  // The UI language follows the setting the moment it changes: no restart, no reload.
  watch(
    () => settings.value.language,
    (language) => setLocale(language ?? 'auto'),
    { immediate: true },
  )

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

  async function loadUpdate(): Promise<void> {
    const [s, c] = await Promise.all([guard(() => window.tuberx.update.status()), guard(() => window.tuberx.update.canInstall())])
    if (s) appUpdate.value = s
    if (c !== undefined) canInstall.value = c
  }
  async function checkUpdate(): Promise<void> {
    const s = await guard(() => window.tuberx.update.check())
    if (s) appUpdate.value = s
  }
  async function installUpdate(): Promise<void> {
    await guard(() => window.tuberx.update.install())
  }
  listen('update:status', (s) => (appUpdate.value = s))

  async function setLoginPassword(password: string): Promise<void> {
    const next = await guard(() => window.tuberx.settings.setLoginPassword(password))
    if (next) settings.value = next
  }

  async function updateEngine(): Promise<void> {
    if (engineUpdating.value) return
    engineUpdating.value = true
    engineResult.value = ''
    const res = await guard(() => window.tuberx.tools.updateEngine())
    engineUpdating.value = false
    if (!res) {
      engineResult.value = t('engine.updateFailed')
      return
    }
    engineResult.value = res.updated ? t('engine.updatedTo', { version: res.version }) : t('engine.alreadyOn', { version: res.version })
    ui.toast(res.updated ? 'success' : 'info', engineResult.value)
    await refreshTools()
  }

  function bind(): () => void {
    const offs = [
      listen('tools:status', (next) => {
        tools.value = next
      }),
      // Any change made through the bridge (this window, another window, a script) lands in the store.
      listen('settings:changed', (next) => {
        settings.value = next
      }),
      listen('engine:updated', ({ from, to }) => {
        engineResult.value = from ? t('engine.updatedFromTo', { from, to }) : t('engine.updatedTo', { version: to })
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
    appUpdate,
    canInstall,
    loadUpdate,
    checkUpdate,
    installUpdate,
    setLoginPassword,
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
