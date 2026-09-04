import { en } from './en'
import { es } from './es'
import { de } from './de'
import { fr } from './fr'
import { pt } from './pt'
import { it } from './it'
import { ja } from './ja'
import { zh } from './zh'

export type Locale = 'en' | 'es' | 'de' | 'fr' | 'pt' | 'it' | 'ja' | 'zh'

/** Selectable languages, named the way their own speakers write them. */
export const LOCALES: { code: Locale; name: string }[] = [
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Español' },
  { code: 'de', name: 'Deutsch' },
  { code: 'fr', name: 'Français' },
  { code: 'pt', name: 'Português' },
  { code: 'it', name: 'Italiano' },
  { code: 'ja', name: '日本語' },
  { code: 'zh', name: '简体中文' },
]

export type MessageKey = keyof typeof en
export type MessageVars = Record<string, string | number>
export type MessageTable = Partial<Record<MessageKey, string>>

const TABLES: Record<Locale, MessageTable> = { en, es, de, fr, pt, it, ja, zh }

/** The string for `key` in `locale`, English when the locale lacks it, with `{name}` slots filled from `vars`. */
export function translate(locale: Locale, key: MessageKey, vars?: MessageVars): string {
  const raw = TABLES[locale]?.[key] ?? en[key] ?? key
  if (!vars) return raw
  return raw.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m))
}

/** Turn the setting plus a BCP 47 tag ("pt-BR", "zh-Hans-CN", "de_DE") into a shipped locale; unknown → English. */
export function resolveLocale(setting: 'auto' | Locale, systemLocale: string): Locale {
  if (setting !== 'auto') return LOCALES.some((l) => l.code === setting) ? setting : 'en'
  const lang = (systemLocale || '').toLowerCase().split(/[-_]/)[0]
  return LOCALES.some((l) => l.code === lang) ? (lang as Locale) : 'en'
}
