/**
 * Every locale must carry exactly the English key set, with the same `{placeholders}` per key.
 * bun scripts/i18n-check.ts → exit 1 on any missing key, extra key, or placeholder mismatch.
 */
import { en } from '../shared/i18n/en'
import { LOCALES } from '../shared/i18n/index'
import { es } from '../shared/i18n/es'
import { de } from '../shared/i18n/de'
import { fr } from '../shared/i18n/fr'
import { pt } from '../shared/i18n/pt'
import { it } from '../shared/i18n/it'
import { ja } from '../shared/i18n/ja'
import { zh } from '../shared/i18n/zh'

const tables: Record<string, Record<string, string>> = { es, de, fr, pt, it, ja, zh }
const enKeys = Object.keys(en)
const slots = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',')

let failures = 0
for (const { code } of LOCALES) {
  if (code === 'en') continue
  const table = tables[code]
  const keys = Object.keys(table)
  const missing = enKeys.filter((k) => !(k in table))
  const extra = keys.filter((k) => !(k in en))
  const empty = keys.filter((k) => !table[k] || !String(table[k]).trim())
  const badSlots = keys.filter((k) => k in en && slots(en[k as keyof typeof en]) !== slots(table[k]))
  const problems = missing.length + extra.length + empty.length + badSlots.length
  failures += problems
  console.log(`${code}: ${keys.length}/${enKeys.length} keys${problems ? '' : ' — ok'}`)
  for (const k of missing) console.log(`  missing: ${k}`)
  for (const k of extra) console.log(`  extra: ${k}`)
  for (const k of empty) console.log(`  empty: ${k}`)
  for (const k of badSlots) console.log(`  placeholder mismatch: ${k} (en: ${slots(en[k as keyof typeof en]) || '-'}, ${code}: ${slots(table[k]) || '-'})`)
}
console.log(`en: ${enKeys.length} keys`)
if (failures) {
  console.error(`i18n-check: ${failures} problem(s)`)
  process.exit(1)
}
console.log('i18n-check: all locales match the English key set')
