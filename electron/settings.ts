import Store from 'electron-store'
import { app } from 'electron'
import { join } from 'node:path'
import { DEFAULT_SETTINGS, type Settings } from '../shared/types'

const store = new Store<{ settings: Settings }>({ name: 'settings' })

export function defaultDestination(): string {
  return join(app.getPath('videos'), 'TuberX')
}

export function getSettings(): Settings {
  const saved = store.get('settings') ?? ({} as Partial<Settings>)
  const merged: Settings = { ...DEFAULT_SETTINGS, ...saved }
  if (!merged.destination) merged.destination = defaultDestination()
  return migrate(merged, saved.settingsVersion ?? 1)
}

/**
 * One-shot default migrations. v0.1.0 shipped with aria2 off and two concurrent
 * downloads; measurements (ISA Decisions 2026-09-02) made aria2 on / three the better default.
 */
function migrate(s: Settings, from: number): Settings {
  if (from >= DEFAULT_SETTINGS.settingsVersion) return s
  const next = { ...s }
  if (from < 2) {
    next.useAria2 = true
    if (next.concurrentDownloads === 2) next.concurrentDownloads = 3
  }
  if (from < 3) {
    next.potHelper = 'auto'
    next.cookiesFile = next.cookiesFile ?? ''
  }
  if (from < 4) next.forceIpv4 = true
  if (from < 5 && next.mp3Bitrate === 192) next.mp3Bitrate = 320 // old default → new default; explicit other choices stay
  if (from < 7) next.onQueueDone = next.onQueueDone ?? 'none'
  if (from < 9) next.videoCodec = next.videoCodec ?? 'auto'
  if (from < 10) next.rateLimitKbps = next.rateLimitKbps ?? 0
  if (from < 11) next.language = next.language ?? 'auto'
  if (from < 8) {
    next.loginUsername = next.loginUsername ?? ''
    next.videoPassword = next.videoPassword ?? ''
    next.userAgent = next.userAgent ?? 'default'
  }
  if (from < 12) {
    // The helper used to be a boolean; true becomes on-demand, which is what removed the 10-60 s per-run cost.
    const legacy = next.potHelper as unknown
    next.potHelper = legacy === true ? 'auto' : legacy === false ? 'off' : (legacy as Settings['potHelper']) ?? 'auto'
    next.engineMode = next.engineMode ?? 'fast'
  }
  if (from < 13) next.autoCheckUpdates = next.autoCheckUpdates ?? true
  next.settingsVersion = DEFAULT_SETTINGS.settingsVersion
  store.set('settings', next)
  return next
}

export function patchSettings(patch: Partial<Settings>): Settings {
  const next = { ...getSettings(), ...patch }
  store.set('settings', next)
  return next
}
