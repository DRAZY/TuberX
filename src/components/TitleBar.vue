<script setup lang="ts">
import IconButton from '@/components/IconButton.vue'
import Icon from '@/components/Icon.vue'
import { useSettingsStore } from '@/stores/settings'
import { useUiStore } from '@/stores/ui'

const ui = useUiStore()
const settings = useSettingsStore()

function disableProxy(): void {
  void settings.update({ proxyEnabled: false })
  ui.toast('info', 'Proxy off')
}
</script>

<template>
  <!--
    Three columns with equal 1fr edges keep the wordmark on the true centre while
    the controls stay hard right. .tx-titlebar reserves the per-OS safe zones.
  -->
  <header
    class="tx-drag tx-titlebar grid h-11 shrink-0 grid-cols-[1fr_auto_1fr] items-center border-b border-tx-border bg-tx-panel"
  >
    <div />

    <div class="flex items-baseline justify-center gap-1.5">
      <span class="text-[15px] font-semibold tracking-tight">TuberX</span>
      <span class="h-1.5 w-1.5 rounded-full bg-tx-accent" aria-hidden="true" />
    </div>

    <div class="flex items-center justify-end gap-1">
      <button
        v-if="settings.settings.proxyEnabled"
        type="button"
        class="tx-no-drag mr-1 flex items-center gap-1 rounded border border-tx-border bg-tx-row px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-tx-muted hover:border-tx-accent hover:text-tx-text"
        title="Proxy is on — click to turn it off"
        @click="disableProxy"
      >
        <Icon name="globe" :size="11" />
        Proxy
      </button>

      <IconButton icon="later" label="Download Later" :active="ui.panel === 'later'" @click="ui.toggle('later')" />
      <IconButton icon="history" label="History" :active="ui.panel === 'history'" @click="ui.toggle('history')" />
      <IconButton
        icon="settings"
        label="Settings"
        :active="ui.panel === 'settings'"
        @click="ui.toggle('settings')"
      />
    </div>
  </header>
</template>
