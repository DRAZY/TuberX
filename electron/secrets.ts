import { app, safeStorage } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Small secret store: values are encrypted with the OS keychain (Keychain on macOS, DPAPI on Windows)
 * through Electron's safeStorage and kept as base64 in app data. Nothing here ever goes to the renderer.
 */
const file = () => join(app.getPath('userData'), 'secrets.json')

function load(): Record<string, string> {
  try {
    return existsSync(file()) ? (JSON.parse(readFileSync(file(), 'utf8')) as Record<string, string>) : {}
  } catch {
    return {}
  }
}

export function setSecret(key: string, value: string): void {
  const all = load()
  if (!value) delete all[key]
  else if (safeStorage.isEncryptionAvailable()) all[key] = safeStorage.encryptString(value).toString('base64')
  else all[key] = 'plain:' + Buffer.from(value, 'utf8').toString('base64') // no keychain (rare: some Linux); still not in the settings file
  mkdirSync(app.getPath('userData'), { recursive: true })
  writeFileSync(file(), JSON.stringify(all), { mode: 0o600 })
}

export function getSecret(key: string): string {
  const raw = load()[key]
  if (!raw) return ''
  try {
    if (raw.startsWith('plain:')) return Buffer.from(raw.slice(6), 'base64').toString('utf8')
    return safeStorage.decryptString(Buffer.from(raw, 'base64'))
  } catch {
    return ''
  }
}

export function hasSecret(key: string): boolean {
  return !!load()[key]
}
