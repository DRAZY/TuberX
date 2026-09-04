import type { MainEvents } from '@shared/types'
import { useUiStore } from '@/stores/ui'
import { t } from '@/lib/i18n'

/** Best-effort human message out of anything a rejected IPC promise can carry. */
export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message
  if (typeof e === 'string') return e
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message)
  return t('error.generic')
}

/**
 * Every window.tuberx call goes through here: a rejection becomes a toast and
 * `undefined`, never an unhandled rejection. Also covers the bridge being absent
 * when the renderer is opened in a plain browser.
 */
export async function guard<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn()
  } catch (e) {
    useUiStore().toast('error', errorMessage(e))
    return undefined
  }
}

/** True when the preload bridge is present. */
export function hasBridge(): boolean {
  return typeof window !== 'undefined' && typeof window.tuberx === 'object' && window.tuberx !== null
}

/** Subscribe without exploding when the bridge is missing. Returns a no-op unsubscriber. */
export function listen<K extends keyof MainEvents>(
  event: K,
  handler: (payload: MainEvents[K]) => void,
): () => void {
  if (!hasBridge()) return () => {}
  try {
    return window.tuberx.on(event, handler)
  } catch {
    return () => {}
  }
}
