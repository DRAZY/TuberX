/**
 * ISC-27…35 probe: resolve one public URL per named site with the bundled yt-dlp.
 *   bun scripts/site-check.ts [--download]   (--download also pulls the smallest audio to a temp dir)
 * Prints a table; exit 1 if any site fails.
 */
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { $ } from 'bun'
import { vimeoPlayerUrl } from '../shared/urls'

const ROOT = resolve(import.meta.dir, '..')
const exe = process.platform === 'win32' ? '.exe' : ''
const ytdlp = join(ROOT, 'resources', 'bin', process.platform, `yt-dlp${exe}`)
if (!existsSync(ytdlp)) {
  console.error(`yt-dlp not found at ${ytdlp} — run: bun scripts/fetch-tools.ts`)
  process.exit(2)
}
const ffdir = join(ROOT, 'resources', 'bin', process.platform)

const SITES: { site: string; url: string; note?: string }[] = [
  { site: 'YouTube', url: 'https://www.youtube.com/watch?v=aqz-KE-bpKQ' },
  { site: 'Vimeo', url: 'https://vimeo.com/1084537' },
  { site: 'Facebook', url: 'https://www.facebook.com/facebook/videos/10153231379946729/', note: 'public page video' },
  { site: 'Instagram', url: 'https://www.instagram.com/reel/C6JQ2VZvXtQ/', note: 'often needs cookies' },
  { site: 'Dailymotion', url: 'https://www.dailymotion.com/video/x7tgad0' },
  { site: 'SoundCloud', url: 'https://soundcloud.com/forss/flickermood' },
  { site: 'Mixcloud', url: 'https://www.mixcloud.com/dholbach/cryptkeeper/' },
  { site: 'Bandcamp', url: 'https://youtube-dl.bandcamp.com/track/youtube-dl-test-song' },
  { site: 'Youku', url: 'https://v.youku.com/v_show/id_XMTc1ODE5Njcy.html', note: 'geo/CDN dependent' },
]

let failures = 0
const rows: string[] = []
for (const s of SITES) {
  const started = Date.now()
  let r = await $`${ytdlp} --no-warnings --ignore-config --flat-playlist --skip-download --dump-single-json --ffmpeg-location ${ffdir} -- ${s.url}`.nothrow().quiet()
  let via = ''
  if (r.exitCode !== 0 && /logged-in/i.test(r.stderr.toString()) && vimeoPlayerUrl(s.url)) {
    r = await $`${ytdlp} --no-warnings --ignore-config --skip-download --dump-single-json --referer https://vimeo.com/ -- ${vimeoPlayerUrl(s.url)}`.nothrow().quiet()
    via = ' (via player fallback)'
  }
  const ms = Date.now() - started
  let title = ''
  let ok = false
  if (r.exitCode === 0) {
    try {
      const j = JSON.parse(r.stdout.toString())
      title = j.title ?? j.playlist_title ?? ''
      ok = !!title
    } catch {
      /* fallthrough */
    }
  }
  const err = ok ? '' : (r.stderr.toString().split('\n').reverse().find((l) => /ERROR/.test(l)) ?? `exit ${r.exitCode}`).slice(0, 110)
  if (!ok) failures++
  rows.push(`${ok ? '✓' : '✗'} ${s.site.padEnd(12)} ${String(ms).padStart(6)}ms  ${ok ? title.slice(0, 70) + via : err}${s.note && !ok ? `  (${s.note})` : ''}`)
}
console.log(rows.join('\n'))
console.log(`\n${SITES.length - failures}/${SITES.length} sites resolved`)
process.exit(failures ? 1 : 0)
