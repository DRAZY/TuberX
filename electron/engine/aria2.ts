/**
 * aria2c failures, and the way back to yt-dlp's own downloader.
 *
 * aria2c opens up to sixteen connections per file. Some servers refuse that, usually YouTube for one stream
 * at one moment, and aria2c then exits with an error code of its own (22: "HTTP response header was bad or
 * unexpected", typically a 403). yt-dlp reports it as "aria2c exited with code N". The same file almost always
 * downloads fine over a single connection, so the job retries that transfer once without aria2c instead of
 * failing (issue #10).
 */

export const ARIA2_FAILED = /aria2c exited with code (\d+)/i

/** The aria2c exit code yt-dlp reported, or null when the failure was something else. */
export function aria2ExitCode(stderr: string): number | null {
  const m = stderr.match(ARIA2_FAILED)
  return m ? Number(m[1]) : null
}

/**
 * The same yt-dlp argument list with the aria2c hand-off removed, so the transfer runs on the native
 * downloader. Removes exactly the flag/value pairs aria2Flags() adds and leaves every other argument,
 * including a `--` separator and the URL, untouched.
 */
export function withoutAria2(args: string[]): string[] {
  const out: string[] = []
  for (let i = 0; i < args.length; i++) {
    const flag = args[i]
    const value = args[i + 1] ?? ''
    if (flag === '--') {
      out.push(...args.slice(i))
      break
    }
    const isAria2Downloader = flag === '--downloader' && (/aria2c(\.exe)?$/i.test(value) || value === 'dash,m3u8:native')
    const isAria2Args = flag === '--downloader-args' && /^aria2c:/i.test(value)
    if (isAria2Downloader || isAria2Args) {
      i++
      continue
    }
    out.push(flag)
  }
  return out
}
