import { app } from 'electron'
import { resolveLocale, translate, type Locale, type MessageKey, type MessageVars } from '../shared/i18n'
import { getSettings } from './settings'

/** The language the main process should speak right now: the setting, resolved against the OS locale. */
export function currentLocale(): Locale {
  const system = app.isReady() ? app.getLocale() : 'en'
  return resolveLocale(getSettings().language ?? 'auto', system)
}

/** Main-process translate: menus, toasts, dialogs and engine errors read the live setting on every call. */
export function tm(key: MessageKey, vars?: MessageVars): string {
  return translate(currentLocale(), key, vars)
}
