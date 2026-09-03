<script setup lang="ts">
import { guard } from '@/lib/ipc'
import { onMounted, ref, watch } from 'vue'
import type { Settings } from '@shared/types'
import Icon from '@/components/Icon.vue'
import IconButton from '@/components/IconButton.vue'
import Spinner from '@/components/Spinner.vue'
import Toggle from '@/components/Toggle.vue'
import { PRESET_FORMATS } from '@/lib/formats'
import { folderName } from '@/lib/paths'
import { useSettingsStore } from '@/stores/settings'
import { useUiStore } from '@/stores/ui'

const store = useSettingsStore()
const ui = useUiStore()

const MP3_BITRATES: Settings['mp3Bitrate'][] = [128, 192, 256, 320]
const CONCURRENCY: Settings['concurrentDownloads'][] = [1, 2, 3, 4, 5, 6, 8]
const BROWSERS: { value: Settings['cookiesFromBrowser']; label: string }[] = [
  { value: '', label: 'None' },
  { value: 'chrome', label: 'Chrome' },
  { value: 'edge', label: 'Edge' },
  { value: 'firefox', label: 'Firefox' },
  { value: 'brave', label: 'Brave' },
]

/** Free-text fields are edited locally and written on change, not on every keystroke. */
const langs = ref(store.settings.subtitleLangs.join(', '))
const proxy = ref(store.settings.proxy)

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
      <h2 class="text-sm font-semibold">Settings</h2>
      <IconButton icon="close" label="Close" @click="ui.close()" />
    </header>

    <div class="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
      <!-- Destination -->
      <section class="border-b border-tx-border py-4">
        <h3 class="mb-2 text-[10px] font-semibold uppercase tracking-wider text-tx-muted">Destination</h3>
        <button
          type="button"
          class="tx-btn-ghost flex w-full items-center gap-2 !justify-start"
          :title="store.settings.destination || 'No folder chosen yet'"
          @click="store.pickDestination()"
        >
          <Icon name="folder" :size="14" />
          <span class="truncate">{{ folderName(store.settings.destination) }}</span>
        </button>
        <p v-if="store.settings.destination" class="mt-1 truncate text-[10px] text-tx-muted">
          {{ store.settings.destination }}
        </p>

        <div v-if="store.settings.destinations.length > 1" class="mt-2">
          <p class="mb-1 text-[10px] text-tx-muted">Recent folders</p>
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
        <h3 class="mb-2 text-[10px] font-semibold uppercase tracking-wider text-tx-muted">Output</h3>
        <label class="block text-[12px]">
          Default format
          <select
            class="tx-field mt-1"
            :value="store.settings.defaultFormatId"
            @change="set('defaultFormatId', ($event.target as HTMLSelectElement).value)"
          >
            <option v-for="f in PRESET_FORMATS" :key="f.id" :value="f.id">{{ f.label }}</option>
          </select>
        </label>

        <Toggle
          class="mt-2"
          :model-value="store.settings.applyDefaultToNew"
          label="Apply to new links"
          hint="New rows adopt the default instead of the site's best guess."
          @update:model-value="set('applyDefaultToNew', $event)"
        />
        <Toggle
          :model-value="store.settings.convertNonMp4"
          label="Convert non-MP4 video to MP4"
          hint="VP9, AV1 and WebM sources get remuxed or re-encoded."
          @update:model-value="set('convertNonMp4', $event)"
        />

        <label class="mt-2 block text-[12px]">
          MP3 bitrate
          <select
            class="tx-field mt-1"
            :value="store.settings.mp3Bitrate"
            @change="
              set('mp3Bitrate', Number(($event.target as HTMLSelectElement).value) as Settings['mp3Bitrate'])
            "
          >
            <option v-for="b in MP3_BITRATES" :key="b" :value="b">{{ b }} kbps</option>
          </select>
        </label>
      </section>

      <!-- Subtitles -->
      <section class="border-b border-tx-border py-4">
        <h3 class="mb-2 text-[10px] font-semibold uppercase tracking-wider text-tx-muted">Subtitles</h3>
        <Toggle
          :model-value="store.settings.embedSubtitles"
          label="Embed subtitles in the file"
          @update:model-value="set('embedSubtitles', $event)"
        />
        <Toggle
          :model-value="store.settings.writeSubtitleFiles"
          label="Also save subtitle files"
          hint="Writes .srt alongside the media."
          @update:model-value="set('writeSubtitleFiles', $event)"
        />
        <label class="mt-2 block text-[12px]">
          Languages
          <input
            v-model="langs"
            class="tx-field mt-1"
            placeholder="en, es, fr"
            @change="commitLangs"
            @blur="commitLangs"
          />
        </label>
      </section>

      <!-- Thumbnails -->
      <section class="border-b border-tx-border py-4">
        <h3 class="mb-2 text-[10px] font-semibold uppercase tracking-wider text-tx-muted">Thumbnails</h3>
        <Toggle
          :model-value="store.settings.saveThumbnail"
          label="Save the thumbnail next to the media"
          @update:model-value="set('saveThumbnail', $event)"
        />
        <label class="mt-2 block text-[12px]">
          Image format
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
        <h3 class="mb-2 text-[10px] font-semibold uppercase tracking-wider text-tx-muted">Downloads</h3>
        <label class="mt-2 block text-[12px]">
          Re-downloading in a different format
          <select
            class="tx-field mt-1"
            :value="store.settings.onConflict"
            @change="set('onConflict', ($event.target as HTMLSelectElement).value as Settings['onConflict'])"
          >
            <option value="keep-both">Keep both files (adds the quality to the name)</option>
            <option value="replace">Replace the existing file</option>
          </select>
        </label>
        <p class="mt-1 text-[10px] leading-snug text-tx-muted">
          Changing the format and choosing Download again never touches the file you already have. The same format again refreshes that one file.
        </p>
        <Toggle
          class="mt-2"
          :model-value="store.settings.skipIfExists"
          label="Skip if the file already exists"
          @update:model-value="set('skipIfExists', $event)"
        />
        <label class="mt-2 block text-[12px]">
          Concurrent downloads
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
          label="Use aria2 for faster downloads"
          hint="Multi-connection HTTP. Turn off if a site throttles you."
          @update:model-value="set('useAria2', $event)"
        />
        <Toggle
          :model-value="store.settings.notifyOnComplete"
          label="Notify when a download finishes"
          @update:model-value="set('notifyOnComplete', $event)"
        />
      </section>

      <!-- Network -->
      <section class="border-b border-tx-border py-4">
        <h3 class="mb-2 text-[10px] font-semibold uppercase tracking-wider text-tx-muted">Network</h3>
        <label class="block text-[12px]">
          Proxy
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
          label="Route requests through the proxy"
          @update:model-value="set('proxyEnabled', $event)"
        />
        <p class="mt-3 text-[11px] leading-snug text-tx-muted">
          Cookies are optional. TuberX does not need a login for normal videos. Use these only for private,
          age-restricted or members-only media.
        </p>
        <label class="mt-2 block text-[12px]">
          Cookies from browser
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
            <option v-for="b in BROWSERS" :key="b.value" :value="b.value">{{ b.label }}</option>
          </select>
        </label>
        <p class="mt-1 text-[10px] leading-snug text-tx-muted">
          Reads the login from a browser where you are signed in. On Windows, Firefox works best; Chrome and Edge
          often refuse to hand over their cookies.
        </p>
        <div class="mt-3 text-[12px]">
          <div class="flex items-center justify-between gap-2">
            <span>Cookies file (cookies.txt)</span>
            <span class="flex gap-1">
              <button type="button" class="tx-btn-ghost text-[11px]" @click="pickCookiesFile">
                {{ store.settings.cookiesFile ? 'Replace' : 'Choose…' }}
              </button>
              <button
                v-if="store.settings.cookiesFile"
                type="button"
                class="tx-btn-ghost text-[11px]"
                @click="clearCookiesFile"
              >
                Remove
              </button>
            </span>
          </div>
          <p
            v-if="store.settings.cookiesFile"
            class="mt-1 truncate text-[10px] text-tx-muted"
            :title="store.settings.cookiesFile"
          >
            Imported · {{ store.settings.cookiesFile }}
          </p>
          <p v-else class="mt-1 text-[10px] leading-snug text-tx-muted">
            Export a cookies.txt from your browser with a “Get cookies.txt LOCALLY” extension, then import it here.
          </p>
        </div>
        <Toggle
          class="mt-3"
          :model-value="store.settings.forceIpv4"
          label="Prefer IPv4"
          hint="Connects over IPv4 only. Fixes most “Sign in to confirm you're not a bot” prompts, which YouTube shows to many IPv6 connections."
          @update:model-value="set('forceIpv4', $event)"
        />
        <Toggle
          class="mt-3"
          :model-value="store.settings.potHelper"
          label="YouTube PO-token helper (bgutil)"
          hint="Mints the proof-of-origin tokens YouTube expects, so downloads work without a login. Needs jnn-pa.googleapis.com reachable on your network."
          @update:model-value="set('potHelper', $event)"
        />
      </section>

      <!-- Engine -->
      <section class="py-4">
        <h3 class="mb-2 text-[10px] font-semibold uppercase tracking-wider text-tx-muted">Engine</h3>
        <ul class="list-none space-y-1">
          <li
            v-for="tool in store.tools"
            :key="tool.name"
            class="flex items-center justify-between gap-2 text-[11px]"
          >
            <span class="font-mono text-tx-text">{{ tool.name }}</span>
            <span v-if="tool.ok" class="truncate text-tx-muted" :title="tool.path">
              {{ tool.version || 'ready' }}
            </span>
            <span v-else class="flex items-center gap-1 truncate text-red-400" :title="tool.error">
              <Icon name="alert" :size="11" />
              {{ tool.error || 'missing' }}
            </span>
          </li>
          <li v-if="!store.tools.length" class="text-[11px] text-tx-muted">Checking tools…</li>
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
            Update yt-dlp now
          </button>
          <span v-if="store.engineResult" class="truncate text-[10px] text-tx-muted">
            {{ store.engineResult }}
          </span>
        </div>

        <Toggle
          class="mt-2"
          :model-value="store.settings.autoUpdateEngine"
          label="Keep yt-dlp up to date automatically"
          hint="Sites change constantly; this is what keeps downloads working."
          @update:model-value="set('autoUpdateEngine', $event)"
        />
      </section>
    </div>
    <footer class="flex shrink-0 items-center justify-between border-t border-tx-border px-4 py-2 text-[10px] text-tx-muted">
      <span>Changes apply immediately.</span>
      <button type="button" class="tx-btn-accent text-[12px]" @click="ui.close()">Done</button>
    </footer>
  </div>
</template>
