<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import type { QueueRow } from '@shared/types'
import { formatBytes, formatDuration, heightLabel } from '@shared/normalize'
import { formatEta } from '@/lib/paths'
import { bestVideoHeight, bestVideoOption, qualityBadge } from '@/lib/formats'
import Icon from '@/components/Icon.vue'
import Spinner from '@/components/Spinner.vue'
import FormatSelect from '@/components/FormatSelect.vue'
import { useQueueStore } from '@/stores/queue'
import { useUiStore } from '@/stores/ui'
import { useSettingsStore } from '@/stores/settings'
import { t } from '@/lib/i18n'
import type { MessageKey } from '@shared/i18n'

const props = defineProps<{ row: QueueRow }>()

const queue = useQueueStore()
const ui = useUiStore()

const thumbBroken = ref(false)

const media = computed(() => props.row.media)
const selected = computed(() => queue.isSelected(props.row.id))
const settingsStore = useSettingsStore()
const isAudioOutput = computed(() => /\.(mp3|m4a|wav|m4r|srt|vtt)$/i.test(props.row.outputPath ?? ''))
const status = computed(() => props.row.status)

const formats = computed(() => media.value?.formats ?? [])

/**
 * A stored formatId can go stale when the extractor returns a different rung set
 * on a refetch. Fall back to the media's own default so the select never renders
 * blank; reconcileFormat() writes the fallback back once the user touches the row.
 */
const effectiveFormatId = computed(() => {
  const stored = props.row.formatId
  if (stored && formats.value.some((f) => f.id === stored)) return stored
  const fallback = media.value?.defaultFormatId
  if (fallback && formats.value.some((f) => f.id === fallback)) return fallback
  return formats.value[0]?.id ?? ''
})

const selectedFormat = computed(() => formats.value.find((f) => f.id === effectiveFormatId.value))
const sizeHint = computed(() => formatBytes(selectedFormat.value?.filesize))

/** The top rung the extractor offered; "best" carries no height of its own. */
const bestHeight = computed(() => bestVideoHeight(formats.value))
const badge = computed(() => qualityBadge(selectedFormat.value, bestHeight.value))

/** Only shown when the pick is a specific rung below the best available one. */
const upgradeHint = computed(() => {
  const opt = selectedFormat.value
  if (!opt || opt.kind !== 'video' || !opt.height) return ''
  const best = bestHeight.value
  if (!best || opt.height >= best) return ''
  return t('row.upTo', { height: heightLabel(best) })
})

const busy = computed(
  () => status.value === 'downloading' || status.value === 'converting' || status.value === 'queued',
)
const formatLocked = computed(() => busy.value || status.value === 'fetching')

const title = computed(() => media.value?.title ?? props.row.url)

const meta = computed(() => {
  const m = media.value
  if (!m) return props.row.url
  return [m.uploader, formatDuration(m.duration), m.extractor].filter(Boolean).join(' · ')
})

const progress = computed(() => props.row.progress)
const percent = computed(() => Math.max(0, Math.min(100, progress.value?.percent ?? 0)))

/** Post-processing passes, each a full rewrite of the file, named so a long one is not a mystery. */
const STAGE_KEY: Record<string, MessageKey> = {
  merge: 'stage.merge',
  convert: 'stage.convert',
  subs: 'stage.subs',
  tag: 'stage.tag',
  cover: 'stage.cover',
  move: 'stage.move',
}
const postProcessing = computed(() => !!progress.value && progress.value.stage !== 'download')

// Elapsed time in the current pass, and how long since the engine last reported anything: a transfer
// that has gone quiet says so instead of showing its last speed forever.
const stageSince = ref(0)
const lastReport = ref(0)
const now = ref(Date.now())
let ticker: ReturnType<typeof setInterval> | undefined
watch(
  () => progress.value,
  (p, prev) => {
    now.value = Date.now()
    lastReport.value = now.value
    if (p?.stage !== prev?.stage) stageSince.value = now.value
    if (ticker) clearInterval(ticker)
    ticker = undefined
    if (p) ticker = setInterval(() => (now.value = Date.now()), 1000)
  },
  { immediate: true },
)
onUnmounted(() => ticker && clearInterval(ticker))
const quietFor = computed(() => Math.round((now.value - lastReport.value) / 1000))

const progressLine = computed(() => {
  const p = progress.value
  if (!p) return ''
  if (p.stage !== 'download') {
    const secs = Math.max(0, Math.round((now.value - stageSince.value) / 1000))
    const label = t(STAGE_KEY[p.stage] ?? 'stage.processing')
    return secs >= 3 ? `${label} · ${secs} s` : label
  }
  const size = p.totalBytes ? `${formatBytes(p.downloadedBytes ?? 0)} / ${formatBytes(p.totalBytes)}` : ''
  const via = p.downloader === 'aria2c' ? 'aria2' : ''
  const part = p.part && p.part.count > 1 ? t('row.file', { index: p.part.index, count: p.part.count }) : ''
  if (quietFor.value >= 8) return [t('row.noData', { n: quietFor.value }), size, part, via].filter(Boolean).join(' · ')
  const speed = p.speed ? `${formatBytes(p.speed)}/s` : ''
  const eta = formatEta(p.eta)
  return [speed, eta && t('row.left', { eta }), size, part, via].filter(Boolean).join(' · ')
})

const playlistCount = computed(() => media.value?.entries?.length ?? 0)

/** A playlist row has no format of its own; it is expanded into real rows. */
const isPlaylistRow = computed(() => !!media.value?.isPlaylist && playlistCount.value > 0)

function onRowClick(e: MouseEvent): void {
  const target = e.target as HTMLElement | null
  if (target?.closest('button, select, a, input, textarea, optgroup, option')) return
  if (e.ctrlKey || e.metaKey || e.shiftKey) queue.toggle(props.row.id)
  else queue.select(props.row.id)
}

/** Persist the fallback so main and the renderer agree once the user engages. */
function reconcileFormat(): void {
  const effective = effectiveFormatId.value
  if (!effective || props.row.formatId === effective) return
  void queue.setFormat(props.row.id, effective)
}

function chooseBest(): void {
  const best = bestVideoOption(formats.value)
  if (best) void queue.setFormat(props.row.id, best.id)
}

function openPlaylist(): void {
  if (media.value) ui.openPlaylist(props.row.id, media.value)
}
</script>

<template>
  <!--
    flex-wrap plus a fixed-width control column: below roughly 520px of row width
    the controls drop onto their own line instead of squeezing the title away.
  -->
  <li
    :data-row-id="row.id"
    class="group relative flex flex-wrap items-start gap-x-3 gap-y-2 border-b border-tx-border px-4 py-2.5 transition-colors hover:bg-tx-row/60"
    :class="selected ? 'bg-tx-row ring-1 ring-inset ring-tx-accent/60' : ''"
    @click="onRowClick"
    @dblclick="status === 'done' && row.outputPath ? queue.open(row.outputPath) : undefined"
  >
    <!-- Thumbnail with its quality badge -->
    <div
      class="relative flex h-[54px] w-24 shrink-0 items-center justify-center overflow-hidden rounded bg-tx-row"
    >
      <img
        v-if="media?.thumbnail && !thumbBroken"
        :src="media.thumbnail"
        alt=""
        class="h-full w-full object-cover"
        @error="thumbBroken = true"
      />
      <Icon v-else name="play" :size="20" class="text-tx-muted/60" />

      <span
        v-if="badge && !isPlaylistRow"
        class="absolute bottom-0.5 right-0.5 rounded bg-black/75 px-1 py-px text-[9px] font-semibold leading-tight text-white"
      >
        {{ badge }}
      </span>
    </div>

    <!-- Title, meta, error and pills take whatever width is left -->
    <div class="min-w-0 flex-1 basis-[150px]">
      <p class="tx-clamp-2 text-[13px] leading-snug text-tx-text" :title="title">{{ title }}</p>
      <p class="mt-0.5 truncate text-[11px] text-tx-muted">{{ meta }}</p>

      <p
        v-if="status === 'failed'"
        class="mt-0.5 line-clamp-3 break-words text-[11px] leading-snug text-red-400"
        :title="row.error ?? t('row.downloadFailed')"
      >
        {{ row.error ?? t('row.downloadFailed') }}
      </p>

      <div v-if="media" class="mt-1 flex flex-wrap items-center gap-1.5">
        <button
          v-if="media.playlistUrl || (media.isPlaylist && playlistCount)"
          type="button"
          class="flex items-center gap-1 rounded-full border border-tx-border px-1.5 py-px text-[10px] text-tx-muted hover:border-tx-accent hover:text-tx-text"
          :title="media.isPlaylist ? t('row.pickVideosTitle') : t('row.partOfPlaylist')"
          @click="openPlaylist"
        >
          <Icon name="playlist" :size="10" />
          {{ media.isPlaylist ? t('row.playlistCount', { n: playlistCount }) : t('row.partOfPlaylist') }}
        </button>

        <span
          v-if="media.requiresLogin"
          class="flex items-center gap-1 rounded-full border border-amber-500/40 px-1.5 py-px text-[10px] text-amber-400"
          :title="t('row.loginRequiredTitle')"
        >
          <Icon name="lock" :size="10" />
          {{ t('row.loginRequired') }}
        </span>
      </div>
    </div>

    <!-- Fixed control column: format on top, action underneath -->
    <div class="ml-auto flex w-[230px] shrink-0 flex-col items-end gap-1">
      <div class="flex w-full items-center justify-end gap-1.5">
        <button v-if="isPlaylistRow" type="button" class="tx-btn-accent" @click="openPlaylist">
          {{ t('row.pickVideos') }}
        </button>
        <FormatSelect
          v-else
          :formats="formats"
          :model-value="effectiveFormatId"
          :disabled="formatLocked"
          :duration="media?.duration"
          :mp3-bitrate="settingsStore.settings.mp3Bitrate"
          @focus="reconcileFormat"
          @update:model-value="queue.setFormat(row.id, $event)"
        />
        <button
          type="button"
          class="shrink-0 text-tx-muted opacity-0 transition-opacity hover:text-tx-text group-hover:opacity-100"
          :title="t('row.removeFromList')"
          :aria-label="t('row.removeFromList')"
          @click="queue.remove([row.id])"
        >
          <Icon name="close" :size="14" />
        </button>
      </div>

      <div
        v-if="!isPlaylistRow && (upgradeHint || sizeHint)"
        class="flex w-full items-center justify-end gap-2 pr-5 text-[10px] text-tx-muted"
      >
        <button
          v-if="upgradeHint"
          type="button"
          class="truncate hover:text-tx-text"
          :title="t('row.switchBest')"
          @click="chooseBest"
        >
          ↑ {{ upgradeHint }}
        </button>
        <span v-if="sizeHint">~{{ sizeHint }}</span>
      </div>

      <!-- State control -->
      <div
        v-if="!isPlaylistRow"
        class="flex min-h-[28px] w-full items-center justify-end gap-2 pr-5"
      >
        <template v-if="status === 'fetching'">
          <Spinner />
          <span class="text-[11px] text-tx-muted">{{ t('status.fetching') }}</span>
        </template>

        <template v-else-if="status === 'ready'">
          <button type="button" class="tx-btn-accent" @click="queue.start([row.id])">{{ t('row.download') }}</button>
        </template>

        <template v-else-if="status === 'queued'">
          <span class="text-[11px] text-tx-muted">{{ t('status.queued') }}</span>
          <button
            type="button"
            class="text-tx-muted hover:text-tx-text"
            :title="t('common.cancel')"
            :aria-label="t('common.cancel')"
            @click="queue.cancel(row.id)"
          >
            <Icon name="close" :size="14" />
          </button>
        </template>

        <template v-else-if="status === 'downloading' || status === 'converting'">
          <div class="min-w-0 flex-1">
            <div class="h-1.5 w-full overflow-hidden rounded-full bg-tx-border">
              <div
                class="h-full rounded-full bg-tx-accent transition-[width] duration-200"
                :class="{ 'animate-pulse': postProcessing }"
                :style="{ width: `${percent}%` }"
              />
            </div>
            <div class="mt-1 flex items-start justify-between gap-2 text-[10px] leading-tight text-tx-muted">
              <span v-if="!postProcessing" class="shrink-0">{{ percent.toFixed(0) }}%</span>
              <span class="min-w-0 whitespace-normal break-words text-right" :title="progressLine">{{ progressLine }}</span>
            </div>
          </div>
          <button
            v-if="progress?.stage === 'download'"
            type="button"
            class="shrink-0 text-tx-muted hover:text-tx-text"
            :title="t('row.pauseTitle')"
            :aria-label="t('row.pause')"
            @click="queue.pause(row.id)"
          >
            <Icon name="pause" :size="14" />
          </button>
          <button
            type="button"
            class="shrink-0 text-tx-muted hover:text-red-400"
            :title="t('row.stopTitle')"
            :aria-label="t('row.stop')"
            @click="queue.cancel(row.id)"
          >
            <Icon name="stop" :size="14" />
          </button>
        </template>

        <template v-else-if="status === 'paused'">
          <div class="min-w-0 flex-1">
            <div class="h-1.5 w-full overflow-hidden rounded-full bg-tx-border">
              <div class="h-full rounded-full bg-tx-accent/50" :style="{ width: `${percent}%` }" />
            </div>
            <div class="mt-1 text-[10px] text-tx-muted">{{ t('row.pausedAt', { percent: percent.toFixed(0) }) }}</div>
          </div>
          <button type="button" class="tx-btn-accent flex items-center gap-1" @click="queue.resume(row.id)">
            <Icon name="play" :size="12" /> {{ t('row.resume') }}
          </button>
          <button
            type="button"
            class="shrink-0 text-tx-muted hover:text-red-400"
            :title="t('row.stopDiscard')"
            :aria-label="t('row.stop')"
            @click="queue.cancel(row.id)"
          >
            <Icon name="stop" :size="14" />
          </button>
        </template>

        <template v-else-if="status === 'done'">
          <Icon name="check" :size="15" class="text-emerald-400" />
          <button
            type="button"
            class="tx-btn-ghost"
            :disabled="!row.outputPath"
            @click="queue.reveal(row.outputPath ?? '')"
          >
            {{ t('common.reveal') }}
          </button>
          <button
            v-if="row.outputPath && !isAudioOutput"
            type="button"
            class="shrink-0 text-tx-muted hover:text-tx-text"
            :title="t('row.trimTitle')"
            :aria-label="t('row.trim')"
            @click="ui.openTrim(row.id)"
          >
            <Icon name="scissors" :size="14" />
          </button>
          <button
            type="button"
            class="shrink-0 text-tx-muted hover:text-tx-text"
            :title="t('row.downloadAgainTitle')"
            :aria-label="t('row.downloadAgain')"
            @click="queue.start([row.id])"
          >
            <Icon name="redo" :size="14" />
          </button>
        </template>

        <template v-else-if="status === 'failed'">
          <button type="button" class="tx-btn-ghost" @click="queue.retry(row.id)">{{ t('common.retry') }}</button>
        </template>

        <template v-else-if="status === 'cancelled'">
          <span class="text-[11px] text-tx-muted">{{ t('status.cancelled') }}</span>
          <button type="button" class="tx-btn-ghost" @click="queue.retry(row.id)">{{ t('common.retry') }}</button>
        </template>

        <template v-else-if="status === 'skipped'">
          <span class="text-[11px] text-tx-muted" :title="t('row.alreadyDownloadedTitle')">
            {{ t('row.alreadyDownloaded') }}
          </span>
        </template>
      </div>
    </div>
  </li>
</template>
