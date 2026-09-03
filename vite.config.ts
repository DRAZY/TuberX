import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import electron from 'vite-plugin-electron'
import renderer from 'vite-plugin-electron-renderer'
import { resolve } from 'node:path'

export default defineConfig({
  plugins: [
    vue(),
    electron([
      {
        entry: 'electron/main.ts',
        // TUBERX_CDP=1 bun run dev → Electron exposes a DevTools port for scripted smoke tests (scripts/cdp-eval.ts)
        onstart({ startup }) {
          const args = ['.']
          if (process.env.TUBERX_CDP) args.push('--remote-debugging-port=9333')
          void startup(args)
        },
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: { external: ['electron', 'node:sqlite'] },
          },
        },
      },
      {
        entry: 'electron/preload.ts',
        onstart(options) {
          options.reload()
        },
        vite: { build: { outDir: 'dist-electron' } },
      },
    ]),
    renderer(),
  ],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@shared': resolve(__dirname, 'shared'),
    },
  },
  build: {
    rollupOptions: { input: { main: resolve(__dirname, 'index.html') } },
  },
})
