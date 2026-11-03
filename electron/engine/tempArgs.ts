import { join } from 'node:path'

/**
 * Gives every yt-dlp run a writable temp folder, including runs that download nothing (issue #14).
 *
 * yt-dlp test-downloads formats it does not trust yet, such as HLS on a YouTube video under two days old,
 * and writes that test to its "temp" path. With no path set, Windows resolves it to ".", the working
 * folder, which for an installed app is C:\Program Files\TuberX. Windows refuses the write and the whole
 * fetch fails with "[Errno 13] Permission denied". A download's own -P temp comes later on the command
 * line and overrides this one.
 */
export function tempPathArgs(userData: string): string[] {
  return ['-P', `temp:${join(userData, 'tmp')}`]
}
