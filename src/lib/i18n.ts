import { ref } from 'vue'
import { resolveLocale, translate, type Locale, type MessageKey, type MessageVars } from '@shared/i18n'

/**
 * The renderer's active language. Pinia-free so lib code and stores can both read it;
 * every t() call reads `locale.value`, so templates and computeds re-render when it changes.
 */
const systemLanguage = () => (typeof navigator !== 'undefined' ? navigator.language : 'en')

export const locale = ref<Locale>(resolveLocale('auto', systemLanguage()))

let setting: 'auto' | Locale = 'auto'

/** Apply the settings value; 'auto' follows the OS language (and follows it live if the OS changes). */
export function setLocale(next: 'auto' | Locale): void {
  setting = next
  locale.value = resolveLocale(setting, systemLanguage())
  if (typeof document !== 'undefined') document.documentElement.lang = locale.value
}

if (typeof window !== 'undefined') window.addEventListener('languagechange', () => setLocale(setting))

export function t(key: MessageKey, vars?: MessageVars): string {
  return translate(locale.value, key, vars)
}

/**
 * A message split around one `{slot}` so a template can wrap the slot in markup
 * (a <b>, say) without the translation having to carry HTML. Returns [before, after].
 */
export function tSplit(key: MessageKey, slot: string, vars?: MessageVars): [string, string] {
  const marker = '\u0000'
  const [before = '', after = ''] = t(key, { ...vars, [slot]: marker }).split(marker)
  return [before, after]
}
