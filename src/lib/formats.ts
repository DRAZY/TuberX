import type { FormatOption } from '@shared/types'
import { heightLabel } from '@shared/normalize'
import { t } from '@/lib/i18n'
import type { MessageKey } from '@shared/i18n'

/**
 * The fixed menu used where no probed media exists yet: the settings default and
 * the footer's apply-to-all control. Ids match what normalize.ts emits; main
 * snaps rows that lack a rung to the nearest lower one.
 */
export interface PresetFormat {
  id: string
  /** Message key of the label, or a literal when the label is a format name ("1080p", "MP3"). */
  label: MessageKey | string
  group: 'Video' | 'Audio' | 'Other'
}

export const PRESET_FORMATS: PresetFormat[] = [
  { id: 'v:best', label: 'format.bestVideo', group: 'Video' },
  { id: 'v:2160', label: '2160p (4K)', group: 'Video' },
  { id: 'v:1440', label: '1440p', group: 'Video' },
  { id: 'v:1080', label: '1080p', group: 'Video' },
  { id: 'v:720', label: '720p', group: 'Video' },
  { id: 'v:480', label: '480p', group: 'Video' },
  { id: 'v:360', label: '360p', group: 'Video' },
  { id: 'a:mp3', label: 'MP3', group: 'Audio' },
  { id: 'a:m4a', label: 'M4A', group: 'Audio' },
  { id: 'a:wav', label: 'format.wavLossless', group: 'Audio' },
  { id: 'a:m4r', label: 'format.m4rRingtone', group: 'Audio' },
  { id: 's:srt', label: 'format.subsOnly', group: 'Other' },
]

const isKey = (label: string): label is MessageKey => label.startsWith('format.')

export function presetLabel(id: string): string {
  const label = PRESET_FORMATS.find((f) => f.id === id)?.label
  if (!label) return id
  return isKey(label) ? t(label) : label
}

/** Labels the extractor produced for the fixed option ids, localized at render time; rung labels ("1080p MP4") pass through. */
const PROBED_LABEL: Record<string, MessageKey> = {
  'vo:best': 'format.videoOnly',
  'a:mp3': 'format.mp3Audio',
  'a:m4a': 'format.m4aAudio',
  'a:wav': 'format.wavAudio',
  'a:m4r': 'format.m4rFirst40',
  's:srt': 'format.subsSrt',
}
export function formatLabel(f: FormatOption): string {
  const key = PROBED_LABEL[f.id]
  if (key) return t(key)
  if (f.id === 'v:best') {
    if (f.label === 'Best video (MP4)') return t('format.bestVideoMp4')
    if (f.label.startsWith('Best · ')) return `${t('format.best')} · ${f.label.slice('Best · '.length)}`
  }
  return f.label
}

export function isAudio(kind: FormatOption['kind']): boolean {
  return kind === 'mp3' || kind === 'm4a' || kind === 'wav' || kind === 'm4r'
}

/** Highest video rung the extractor offered, used for "best" labels and the upgrade hint. */
export function bestVideoHeight(formats: FormatOption[]): number | undefined {
  let best: number | undefined
  for (const f of formats) {
    if (f.kind !== 'video' || !f.height) continue
    if (best === undefined || f.height > best) best = f.height
  }
  return best
}

/** The option to jump to when the user takes the "up to X available" hint. */
export function bestVideoOption(formats: FormatOption[]): FormatOption | undefined {
  const explicit = formats.find((f) => f.id === 'v:best')
  if (explicit) return explicit
  let top: FormatOption | undefined
  for (const f of formats) {
    if (f.kind !== 'video' || !f.height) continue
    if (!top || f.height > (top.height ?? 0)) top = f
  }
  return top
}

/**
 * Short corner badge for the thumbnail, corner-badge style: "4K", "1080p", "MP3",
 * "M4A", "Video". `bestHeight` resolves the "best available" option, which
 * carries no height of its own.
 */
export function qualityBadge(option: FormatOption | undefined, bestHeight?: number): string {
  if (!option) return ''
  switch (option.kind) {
    case 'mp3':
      return 'MP3'
    case 'm4a':
      return 'M4A'
    case 'wav':
      return 'WAV'
    case 'm4r':
      return 'M4R'
    case 'subs':
      return 'SRT'
    case 'video-only':
      return t('badge.video')
    case 'video': {
      const h = option.height ?? bestHeight
      return h ? heightLabel(h) : t('badge.best')
    }
  }
  return ''
}
