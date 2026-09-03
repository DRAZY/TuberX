import type { TuberXApi } from '@shared/types'

declare global {
  interface Window {
    /** Injected by electron/preload.ts. Absent when the renderer runs in a plain browser. */
    tuberx: TuberXApi
  }
}

export {}
