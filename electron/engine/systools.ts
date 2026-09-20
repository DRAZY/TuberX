import { existsSync } from 'node:fs'
import { join } from 'node:path'

export type SysTool = 'taskkill' | 'attrib' | 'tar' | 'rundll32' | 'shutdown' | 'pgrep' | 'open' | 'osascript'

/**
 * Absolute path of an operating-system utility.
 *
 * A bare name leaves the choice of executable to a search: on Windows the working directory is searched
 * before PATH, so a file called tar.exe or taskkill.exe planted where the app happens to be started
 * (a downloads folder, the folder of a link that launched it) would run in place of the real one. The
 * system copies live in fixed places, so they are named outright. The bare name is the last resort only
 * when none of the expected files exists, which keeps an unusual system working as it did before.
 */
export function sysTool(name: SysTool, platform: NodeJS.Platform = process.platform, exists: (p: string) => boolean = existsSync): string {
  const candidates =
    platform === 'win32'
      ? [process.env.SystemRoot, process.env.windir, 'C:\\Windows'].filter((r): r is string => !!r).map((r) => join(r, 'System32', `${name}.exe`))
      : [`/usr/bin/${name}`, `/bin/${name}`]
  for (const c of candidates) if (exists(c)) return c
  return platform === 'win32' ? `${name}.exe` : name
}
