/** Inline SVG icon table. Stroke-based 24x24 paths, no icon library. */
export type IconName =
  | 'plus'
  | 'search'
  | 'later'
  | 'history'
  | 'settings'
  | 'close'
  | 'check'
  | 'folder'
  | 'trash'
  | 'refresh'
  | 'play'
  | 'download'
  | 'chevron'
  | 'playlist'
  | 'lock'
  | 'globe'
  | 'external'
  | 'alert'

export interface IconDef {
  d: string[]
  filled?: boolean
}

export const ICONS: Record<IconName, IconDef> = {
  plus: { d: ['M12 5v14', 'M5 12h14'] },
  search: { d: ['M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14', 'M16.5 16.5 21 21'] },
  later: { d: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18', 'M12 7.5v7', 'm9 11.5 3 3 3-3'] },
  history: { d: ['M3.5 12a8.5 8.5 0 1 0 2.9-6.4', 'M3 4.5V9h4.5', 'M12 8v4.5l3 1.8'] },
  settings: {
    d: [
      'M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z',
      'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6',
    ],
  },
  close: { d: ['M18 6 6 18', 'M6 6l12 12'] },
  check: { d: ['m5 13 4 4L19 7'] },
  folder: { d: ['M4 7a2 2 0 0 1 2-2h3l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z'] },
  trash: {
    d: [
      'M4 7h16',
      'M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2',
      'M18 7v12a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V7',
    ],
  },
  refresh: { d: ['M20.5 11A8.5 8.5 0 1 0 19 15.8', 'M20.5 5.5V11H15'] },
  play: { d: ['M8.5 5.5v13l11-6.5z'], filled: true },
  download: { d: ['M12 3v12', 'm8 11 4 4 4-4', 'M4 19h16'] },
  chevron: { d: ['m6 9 6 6 6-6'] },
  playlist: { d: ['M4 6h16', 'M4 11h16', 'M4 16h8', 'M15 14l6 3.5-6 3.5z'] },
  lock: { d: ['M7 11V8a5 5 0 0 1 10 0v3', 'M5 11h14v9H5z'] },
  globe: {
    d: [
      'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18',
      'M3 12h18',
      'M12 3c2.6 2.8 2.6 15.2 0 18',
      'M12 3c-2.6 2.8-2.6 15.2 0 18',
    ],
  },
  external: {
    d: ['M14 4h6v6', 'M20 4l-9 9', 'M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5'],
  },
  alert: { d: ['M12 3 2 20h20z', 'M12 9v5', 'M12 17.5h.01'] },
}
