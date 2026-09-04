<script setup lang="ts">
import { guard } from '@/lib/ipc'
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import type { Settings } from '@shared/types'
import Icon from '@/components/Icon.vue'
import IconButton from '@/components/IconButton.vue'
import Spinner from '@/components/Spinner.vue'
import Toggle from '@/components/Toggle.vue'
import { PRESET_FORMATS, presetLabel } from '@/lib/formats'
import { t, tSplit } from '@/lib/i18n'
import { LOCALES } from '@shared/i18n'
import { folderName } from '@/lib/paths'
import { useSettingsStore } from '@/stores/settings'
import { useUiStore } from '@/stores/ui'

const store = useSettingsStore()
const ui = useUiStore()

const body = ref<HTMLElement | null>(null)
/** Opened from "About TuberX": scroll the About section into view once the panel has rendered. */
async function scrollToAnchor(): Promise<void> {
  const to = ui.anchor
  if (!to) return
  ui.anchor = null
  await nextTick()
  body.value?.querySelector(`#${to}`)?.scrollIntoView({ block: 'start' })
}
onMounted(() => {
  void store.loadAppInfo()
  void scrollToAnchor()
})
watch(() => ui.anchor, () => void scrollToAnchor())

function openLink(url: string): void {
  void guard(() => window.tuberx.shell.openExternal(url))
}
function openLogs(): void {
  void guard(() => window.tuberx.shell.openLogs())
}

const MP3_BITRATES: Settings['mp3Bitrate'][] = [128, 192, 256, 320]
const CONCURRENCY: Settings['concurrentDownloads'][] = [1, 2, 3, 4, 5, 6, 8]
const BROWSERS: { value: Settings['cookiesFromBrowser']; label: string }[] = [
  { value: '', label: '' }, // rendered as the localized "None"
  { value: 'chrome', label: 'Chrome' },
  { value: 'edge', label: 'Edge' },
  { value: 'firefox', label: 'Firefox' },
  { value: 'brave', label: 'Brave' },
]

/** Free-text fields are edited locally and written on change, not on every keystroke. */
const langs = ref(store.settings.subtitleLangs.join(', '))
const proxy = ref(store.settings.proxy)
const loginUsername = ref(store.settings.loginUsername)
const rateLimit = ref(store.settings.rateLimitKbps)
const encoders = ref<{ h264: string | null; h265: string | null }>({ h264: null, h265: null })
/** The codec hint split around the bolded encoder name. */
const codecHintParts = computed(() => tSplit('settings.output.codecHint', 'encoder'))
onMounted(() => {
  void guard(() => window.tuberx.tools.encoders()).then((e) => e && (encoders.value = e))
})
const loginPassword = ref('')
const videoPassword = ref(store.settings.videoPassword)
async function savePassword(): Promise<void> {
  await store.setLoginPassword(loginPassword.value)
  loginPassword.value = ''
}
async function clearPassword(): Promise<void> {
  await store.setLoginPassword('')
  loginPassword.value = ''
}

watch(
  () => store.settings.subtitleLangs,
  (v) => {
    langs.value = v.join(', ')
  },
)
watch(
  () => store.settings.proxy,
  (v) => {
    proxy.value = v
  },
)

onMounted(() => void store.refreshTools())

async function pickCookiesFile() {
  const picked = await guard(() => window.tuberx.settings.pickCookiesFile())
  if (picked) await store.update({ cookiesFile: picked })
}
async function clearCookiesFile() {
  await guard(() => window.tuberx.settings.clearCookiesFile())
  await store.update({ cookiesFile: '' })
}

function set<K extends keyof Settings>(key: K, value: Settings[K]): void {
  void store.update({ [key]: value } as Partial<Settings>)
}

function commitLangs(): void {
  const list = langs.value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  set('subtitleLangs', list.length ? list : ['en'])
}

function commitProxy(): void {
  set('proxy', proxy.value.trim())
}
</script>

<template>
  <div class="flex h-full flex-col">
    <header class="flex shrink-0 items-center justify-between border-b border-tx-border px-4 py-3">
      <h2 class="text-sm font-semibold">{{ t('settings.title') }}</h2>
      <IconButton icon="close" :label="t('common.close')" @click="ui.close()" />
    </header>

    <div ref="body" class="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
      <!-- Language -->
      <section class="border-b border-tx-border py-4">
        <h3 class="mb-2 text-[10px] font-semibold uppercase tracking-wider text-tx-muted">{{ t('settings.language.title') }}</h3>
        <select
          class="tx-field"
          :value="store.settings.language ?? 'auto'"
          @change="set('language', ($event.target as HTMLSelectElement).value as Settings['language'])"
        >
          <option value="auto">{{ t('settings.language.system') }}</option>
          <option v-for="l in LOCALES" :key="l.code" :value="l.code">{{ l.name }}</option>
        </select>
      </section>

      <!-- Destination -->
      <section class="border-b border-tx-border py-4">
        <h3 class="mb-2 text-[10px] font-semibold uppercase tracking-wider text-tx-muted">{{ t('settings.destination.title') }}</h3>
        <button
          type="button"
          class="tx-btn-ghost flex w-full items-center gap-2 !justify-start"
          :title="store.settings.destination || t('settings.destination.none')"
          @click="store.pickDestination()"
        >
          <Icon name="folder" :size="14" />
          <span class="truncate">{{ folderName(store.settings.destination) }}</span>
        </button>
        <p v-if="store.settings.destination" class="mt-1 truncate text-[10px] text-tx-muted">
          {{ store.settings.destination }}
        </p>

        <div v-if="store.settings.destinations.length > 1" class="mt-2">
          <p class="mb-1 text-[10px] text-tx-muted">{{ t('settings.destination.recent') }}</p>
          <ul class="list-none space-y-0.5">
            <li v-for="d in store.settings.destinations" :key="d">
              <button
                type="button"
                class="w-full truncate rounded px-1.5 py-1 text-left text-[11px] transition-colors"
                :class="
                  d === store.settings.destination
                    ? 'bg-tx-row text-tx-text'
                    : 'text-tx-muted hover:bg-tx-row hover:text-tx-text'
                "
                :title="d"
                @click="set('destination', d)"
              >
                {{ d }}
              </button>
            </li>
          </ul>
        </div>
      </section>

      <!-- Output -->
      <section class="border-b border-tx-border py-4">
        <h3 class="mb-2 text-[10px] font-semibold uppercase tracking-wider text-tx-muted">{{ t('settings.output.title') }}</h3>
        <label class="block text-[12px]">
          {{ t('settings.output.defaultFormat') }}
          <select
            class="tx-field mt-1"
            :value="store.settings.defaultFormatId"
            @change="set('defaultFormatId', ($event.target as HTMLSelectElement).value)"
          >
            <option v-for="f in PRESET_FORMATS" :key="f.id" :value="f.id">{{ presetLabel(f.id) }}</option>
          </select>
        </label>

        <Toggle
          class="mt-2"
          :model-value="store.settings.applyDefaultToNew"
          :label="t('settings.output.applyToNew')"
          :hint="t('settings.output.applyToNewHint')"
          @update:model-value="set('applyDefaultToNew', $event)"
        />
        <Toggle
          :model-value="store.settings.convertNonMp4"
          :label="t('settings.output.convertNonMp4')"
          :hint="t('settings.output.convertNonMp4Hint')"
          @update:model-value="set('convertNonMp4', $event)"
        />
        <label class="mt-2 block text-[12px]">
          {{ t('settings.output.videoCodec') }}
          <select class="tx-field mt-1" :value="store.settings.videoCodec" @change="set('videoCodec', ($event.target as HTMLSelectElement).value as Settings['videoCodec'])">
            <option value="auto">{{ t('settings.output.codecAuto') }}</option>
            <option value="h264">{{ t('settings.output.codecH264') }}</option>
            <option value="h265">{{ t('settings.output.codecH265') }}</option>
          </select>
        </label>
        <p class="mt-1 text-[10px] leading-snug text-tx-muted">
          <template v-if="store.settings.videoCodec === 'auto'">{{ t('settings.output.codecAutoHint') }}</template>
          <template v-else>
            {{ codecHintParts[0] }}<b>{{ (store.settings.videoCodec === 'h264' ? encoders.h264 : encoders.h265) ?? t('settings.output.noEncoder') }}</b>{{ codecHintParts[1] }}
          </template>
        </p>

        <label class="mt-2 block text-[12px]">
          {{ t('settings.output.mp3Bitrate') }}
          <select
            class="tx-field mt-1"
            :value="store.settings.mp3Bitrate"
            @change="
              set('mp3Bitrate', Number(($event.target as HTMLSelectElement).value) as Settings['mp3Bitrate'])
            "
          >
            <option v-for="b in MP3_BITRATES" :key="b" :value="b">{{ t('settings.output.kbps', { n: b }) }}</option>
          </select>
        </label>
      </section>

      <!-- Subtitles -->
      <section class="border-b border-tx-border py-4">
        <h3 class="mb-2 text-[10px] font-semibold uppercase tracking-wider text-tx-muted">{{ t('settings.subtitles.title') }}</h3>
        <Toggle
          :model-value="store.settings.embedSubtitles"
          :label="t('settings.subtitles.embed')"
          @update:model-value="set('embedSubtitles', $event)"
        />
        <Toggle
          :model-value="store.settings.writeSubtitleFiles"
          :label="t('settings.subtitles.writeFiles')"
          :hint="t('settings.subtitles.writeFilesHint')"
          @update:model-value="set('writeSubtitleFiles', $event)"
        />
        <label class="mt-2 block text-[12px]">
          {{ t('settings.subtitles.languages') }}
          <input
            v-model="langs"
            class="tx-field mt-1"
            :placeholder="t('settings.subtitles.langsPlaceholder')"
            @change="commitLangs"
            @blur="commitLangs"
          />
        </label>
      </section>

      <!-- Thumbnails -->
      <section class="border-b border-tx-border py-4">
        <h3 class="mb-2 text-[10px] font-semibold uppercase tracking-wider text-tx-muted">{{ t('settings.thumbnails.title') }}</h3>
        <Toggle
          :model-value="store.settings.saveThumbnail"
          :label="t('settings.thumbnails.save')"
          @update:model-value="set('saveThumbnail', $event)"
        />
        <label class="mt-2 block text-[12px]">
          {{ t('settings.thumbnails.imageFormat') }}
          <select
            class="tx-field mt-1"
            :value="store.settings.thumbnailFormat"
            :disabled="!store.settings.saveThumbnail"
            @change="
              set('thumbnailFormat', ($event.target as HTMLSelectElement).value as Settings['thumbnailFormat'])
            "
          >
            <option value="jpg">JPG</option>
            <option value="png">PNG</option>
          </select>
        </label>
      </section>

      <!-- Downloads -->
      <section class="border-b border-tx-border py-4">
        <h3 class="mb-2 text-[10px] font-semibold uppercase tracking-wider text-tx-muted">{{ t('settings.downloads.title') }}</h3>
        <label class="mt-2 block text-[12px]">
          {{ t('settings.downloads.redownload') }}
          <select
            class="tx-field mt-1"
            :value="store.settings.onConflict"
            @change="set('onConflict', ($event.target as HTMLSelectElement).value as Settings['onConflict'])"
          >
            <option value="keep-both">{{ t('settings.downloads.keepBoth') }}</option>
            <option value="replace">{{ t('settings.downloads.replace') }}</option>
          </select>
        </label>
        <p class="mt-1 text-[10px] leading-snug text-tx-muted">
          {{ t('settings.downloads.conflictHint') }}
        </p>
        <Toggle
          class="mt-2"
          :model-value="store.settings.skipIfExists"
          :label="t('settings.downloads.skipIfExists')"
          @update:model-value="set('skipIfExists', $event)"
        />
        <label class="mt-2 block text-[12px]">
          {{ t('settings.downloads.speedLimit') }}
          <input v-model.number="rateLimit" class="tx-field mt-1 w-32" type="number" min="0" step="100" @change="set('rateLimitKbps', Math.max(0, Math.round(rateLimit || 0)))" />
        </label>
        <label class="mt-2 block text-[12px]">
          {{ t('settings.downloads.whenDone') }}
          <select
            class="tx-field mt-1"
            :value="store.settings.onQueueDone"
            @change="set('onQueueDone', ($event.target as HTMLSelectElement).value as Settings['onQueueDone'])"
          >
            <option value="none">{{ t('settings.downloads.doNothing') }}</option>
            <option value="open-folder">{{ t('settings.downloads.openFolder') }}</option>
            <option value="sleep">{{ t('settings.downloads.sleep') }}</option>
            <option value="shutdown">{{ t('settings.downloads.shutdown') }}</option>
          </select>
        </label>
        <label class="mt-2 block text-[12px]">
          {{ t('settings.downloads.concurrent') }}
          <select
            class="tx-field mt-1"
            :value="store.settings.concurrentDownloads"
            @change="
              set(
                'concurrentDownloads',
                Number(($event.target as HTMLSelectElement).value) as Settings['concurrentDownloads'],
              )
            "
          >
            <option v-for="n in CONCURRENCY" :key="n" :value="n">{{ n }}</option>
          </select>
        </label>
        <Toggle
          class="mt-2"
          :model-value="store.settings.useAria2"
          :label="t('settings.downloads.useAria2')"
          :hint="t('settings.downloads.useAria2Hint')"
          @update:model-value="set('useAria2', $event)"
        />
        <Toggle
          class="mt-2"
          :model-value="store.settings.engineMode === 'fast'"
          :label="t('settings.downloads.fastEngine')"
          :hint="t('settings.downloads.fastEngineHint')"
          @update:model-value="set('engineMode', $event ? 'fast' : 'classic')"
        />
        <Toggle
          :model-value="store.settings.notifyOnComplete"
          :label="t('settings.downloads.notify')"
          @update:model-value="set('notifyOnComplete', $event)"
        />
      </section>

      <!-- Network -->
      <section class="border-b border-tx-border py-4">
        <h3 class="mb-2 text-[10px] font-semibold uppercase tracking-wider text-tx-muted">{{ t('settings.network.title') }}</h3>
        <label class="block text-[12px]">
          {{ t('settings.network.proxy') }}
          <input
            v-model="proxy"
            class="tx-field mt-1"
            placeholder="http://127.0.0.1:8080"
            spellcheck="false"
            @change="commitProxy"
            @blur="commitProxy"
          />
        </label>
        <Toggle
          class="mt-2"
          :model-value="store.settings.proxyEnabled"
          :label="t('settings.network.proxyEnabled')"
          @update:model-value="set('proxyEnabled', $event)"
        />
        <p class="mt-3 text-[11px] leading-snug text-tx-muted">
          {{ t('settings.network.cookiesIntro') }}
        </p>
        <label class="mt-2 block text-[12px]">
          {{ t('settings.network.cookiesFromBrowser') }}
          <select
            class="tx-field mt-1"
            :value="store.settings.cookiesFromBrowser"
            @change="
              set(
                'cookiesFromBrowser',
                ($event.target as HTMLSelectElement).value as Settings['cookiesFromBrowser'],
              )
            "
          >
            <option v-for="b in BROWSERS" :key="b.value" :value="b.value">{{ b.label || t('settings.network.browserNone') }}</option>
          </select>
        </label>
        <p class="mt-1 text-[10px] leading-snug text-tx-muted">
          {{ t('settings.network.cookiesBrowserHint') }}
        </p>
        <div class="mt-3 text-[12px]">
          <div class="flex items-center justify-between gap-2">
            <span>{{ t('settings.network.cookiesFile') }}</span>
            <span class="flex gap-1">
              <button type="button" class="tx-btn-ghost text-[11px]" @click="pickCookiesFile">
                {{ store.settings.cookiesFile ? t('settings.network.replace') : t('settings.network.choose') }}
              </button>
              <button
                v-if="store.settings.cookiesFile"
                type="button"
                class="tx-btn-ghost text-[11px]"
                @click="clearCookiesFile"
              >
                {{ t('common.remove') }}
              </button>
            </span>
          </div>
          <p
            v-if="store.settings.cookiesFile"
            class="mt-1 truncate text-[10px] text-tx-muted"
            :title="store.settings.cookiesFile"
          >
            {{ t('settings.network.imported', { path: store.settings.cookiesFile }) }}
          </p>
          <p v-else class="mt-1 text-[10px] leading-snug text-tx-muted">
            {{ t('settings.network.cookiesExportHint') }}
          </p>
        </div>
        <Toggle
          class="mt-3"
          :model-value="store.settings.forceIpv4"
          :label="t('settings.network.ipv4')"
          :hint="t('settings.network.ipv4Hint')"
          @update:model-value="set('forceIpv4', $event)"
        />
        <label class="mt-3 block text-[12px]">
          {{ t('settings.network.pot') }}
          <select class="tx-field mt-1" :value="store.settings.potHelper" @change="set('potHelper', ($event.target as HTMLSelectElement).value as Settings['potHelper'])">
            <option value="auto">{{ t('settings.network.potAuto') }}</option>
            <option value="always">{{ t('settings.network.potAlways') }}</option>
            <option value="off">{{ t('settings.network.potOff') }}</option>
          </select>
        </label>
        <p class="mt-1 text-[10px] leading-snug text-tx-muted">{{ t('settings.network.potHint') }}</p>
      </section>

      <!-- Site login -->
      <section class="border-b border-tx-border py-4">
        <h3 class="mb-2 text-[10px] font-semibold uppercase tracking-wider text-tx-muted">{{ t('settings.login.title') }}</h3>
        <p class="text-[10px] leading-snug text-tx-muted">
          {{ t('settings.login.intro') }}
        </p>
        <label class="mt-2 block text-[12px]">
          {{ t('settings.login.username') }}
          <input v-model.trim="loginUsername" class="tx-field mt-1" type="text" autocomplete="off" spellcheck="false" @change="set('loginUsername', loginUsername)" />
        </label>
        <label class="mt-2 block text-[12px]">
          {{ t('settings.login.password') }}
          <div class="mt-1 flex items-center gap-2">
            <input
              v-model="loginPassword"
              class="tx-field flex-1"
              type="password"
              autocomplete="new-password"
              :placeholder="store.settings.hasLoginPassword ? t('settings.login.storedPlaceholder') : ''"
            />
            <button type="button" class="tx-btn-ghost" :disabled="!loginPassword" @click="savePassword">{{ t('common.save') }}</button>
            <button v-if="store.settings.hasLoginPassword" type="button" class="tx-btn-ghost" @click="clearPassword">{{ t('common.clear') }}</button>
          </div>
        </label>
        <label class="mt-2 block text-[12px]">
          {{ t('settings.login.videoPassword') }}
          <input v-model.trim="videoPassword" class="tx-field mt-1" type="text" autocomplete="off" spellcheck="false" @change="set('videoPassword', videoPassword)" />
        </label>
        <label class="mt-2 block text-[12px]">
          {{ t('settings.login.identifyAs') }}
          <select class="tx-field mt-1" :value="store.settings.userAgent" @change="set('userAgent', ($event.target as HTMLSelectElement).value as Settings['userAgent'])">
            <option value="default">{{ t('settings.login.uaDefault') }}</option>
            <option value="desktop">{{ t('settings.login.uaDesktop') }}</option>
            <option value="ios">{{ t('settings.login.uaIos') }}</option>
            <option value="android">{{ t('settings.login.uaAndroid') }}</option>
          </select>
        </label>
        <p class="mt-1 text-[10px] leading-snug text-tx-muted">{{ t('settings.login.uaHint') }}</p>
      </section>

      <!-- Engine -->
      <section class="py-4">
        <h3 class="mb-2 text-[10px] font-semibold uppercase tracking-wider text-tx-muted">{{ t('settings.engine.title') }}</h3>
        <ul class="list-none space-y-1">
          <li
            v-for="tool in store.tools"
            :key="tool.name"
            class="flex items-center justify-between gap-2 text-[11px]"
          >
            <span class="font-mono text-tx-text">{{ tool.name }}</span>
            <span v-if="tool.ok" class="truncate text-tx-muted" :title="tool.path">
              {{ tool.version || t('settings.engine.ready') }}
            </span>
            <span v-else class="flex items-center gap-1 truncate text-red-400" :title="tool.error">
              <Icon name="alert" :size="11" />
              {{ tool.error || t('settings.engine.missing') }}
            </span>
          </li>
          <li v-if="!store.tools.length" class="text-[11px] text-tx-muted">{{ t('settings.engine.checking') }}</li>
        </ul>

        <div class="mt-3 flex items-center gap-2">
          <button
            type="button"
            class="tx-btn-ghost flex items-center gap-1.5"
            :disabled="store.engineUpdating"
            @click="store.updateEngine()"
          >
            <Spinner v-if="store.engineUpdating" :size="12" />
            <Icon v-else name="refresh" :size="12" />
            {{ t('settings.engine.updateNow') }}
          </button>
          <button type="button" class="tx-btn-ghost" :title="t('settings.engine.logTitle')" @click="openLogs()">{{ t('settings.engine.openLogs') }}</button>
          <span v-if="store.engineResult" class="truncate text-[10px] text-tx-muted">
            {{ store.engineResult }}
          </span>
        </div>

        <Toggle
          class="mt-2"
          :model-value="store.settings.autoUpdateEngine"
          :label="t('settings.engine.autoUpdate')"
          :hint="t('settings.engine.autoUpdateHint')"
          @update:model-value="set('autoUpdateEngine', $event)"
        />
      </section>

      <!-- About -->
      <section id="about" class="border-t border-tx-border py-4">
        <h3 class="mb-2 text-[10px] font-semibold uppercase tracking-wider text-tx-muted">{{ t('settings.about.title') }}</h3>
        <div class="flex items-start gap-3">
          <img src="/icon.png" alt="" class="h-10 w-10 shrink-0 rounded-lg" />
          <div class="min-w-0">
            <div class="flex items-baseline gap-2">
              <span class="text-[14px] font-semibold text-tx-text">TuberX</span>
              <span class="font-mono text-[11px] text-tx-muted">{{ store.appInfo ? `v${store.appInfo.version}` : '…' }}</span>
            </div>
            <p class="mt-1 text-[11px] leading-snug text-tx-muted">
              {{ t('settings.about.blurb') }}
            </p>
            <p v-if="store.appInfo" class="mt-1 font-mono text-[10px] text-tx-muted">
              {{ store.appInfo.platform }} {{ store.appInfo.arch }} · Electron {{ store.appInfo.electron }} · Chromium {{ store.appInfo.chrome.split('.')[0] }}
            </p>
          </div>
        </div>
        <div v-if="store.appInfo" class="mt-3 flex flex-wrap gap-2">
          <button type="button" class="tx-btn-ghost" @click="openLink(store.appInfo.homepage)">{{ t('settings.about.projectPage') }}</button>
          <button type="button" class="tx-btn-ghost" @click="openLink(store.appInfo.releases)">{{ t('settings.about.releases') }}</button>
          <button type="button" class="tx-btn-ghost" @click="openLink(store.appInfo.issues)">{{ t('settings.about.report') }}</button>
          <button type="button" class="tx-btn-ghost" @click="openLogs()">{{ t('settings.engine.openLogs') }}</button>
          <button type="button" class="tx-btn-ghost" @click="openLink(store.appInfo.licenses)">{{ t('settings.about.licenses') }}</button>
        </div>
        <p class="mt-3 text-[10px] leading-snug text-tx-muted">
          {{ t('settings.about.footer') }}
        </p>
      </section>
    </div>
    <footer class="flex shrink-0 items-center justify-between border-t border-tx-border px-4 py-2 text-[10px] text-tx-muted">
      <span>{{ t('settings.applyNote') }}</span>
      <button type="button" class="tx-btn-accent text-[12px]" @click="ui.close()">{{ t('common.done') }}</button>
    </footer>
  </div>
</template>
