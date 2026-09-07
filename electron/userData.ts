import { app } from 'electron'
import { join } from 'node:path'

/**
 * Where this instance keeps its data. Evaluated before any other module of the main process, because
 * electron-store binds its folder when a store is constructed, and stores are constructed at import time:
 * loaded any later, a dev instance would read and write the installed app's settings.json (which is exactly
 * what happened before 0.3.7: test runs changed the user's download destination).
 *
 * - TUBERX_USER_DATA: explicit folder, for smoke-testing a packaged build beside an installed one.
 * - unpackaged (dev server): <appData>/TuberX-dev, never the installed app's folder.
 * - packaged: Electron's default (<appData>/TuberX).
 */
if (process.env.TUBERX_USER_DATA) app.setPath('userData', process.env.TUBERX_USER_DATA)
else if (!app.isPackaged) app.setPath('userData', join(app.getPath('appData'), 'TuberX-dev'))

export const USER_DATA = app.getPath('userData')
