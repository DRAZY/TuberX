import { appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'

/** engine.log under the app's data folder: one line per event, prefixed with the row (or subsystem) id. Rotates at 5 MB. */
export function engineLogPath(): string {
  return join(app.getPath('userData'), 'logs', 'engine.log')
}
export function engineLog(rowId: string, line: string) {
  try {
    const file = engineLogPath()
    mkdirSync(join(file, '..'), { recursive: true })
    try {
      if (statSync(file).size > 5 * 1024 * 1024) renameSync(file, file + '.1')
    } catch {
      /* no file yet */
    }
    appendFileSync(file, `${new Date().toISOString()} [${rowId.slice(0, 8)}] ${line}\n`)
  } catch {
    /* logging never breaks a download */
  }
}
