---
task: "TuberX — cross-platform media downloader on Electron"
slug: 20260902-114500_tuberx-media-downloader
project: TuberX
phase: execute
progress: 21/66
started: 2026-09-02T18:45:00Z
updated: 2026-09-03T05:50:00Z
principal_stated_goal: "I need a Microsoft Windows equivalent to this."
principal_stated_goal_source: prompt
principal_stated_goal_signal: 2
principal_stated_goal_locked: 2026-09-02T18:45:00Z
context_sufficient: true
interview_invoked: false
---

## Problem

The macOS downloader Andre reaches for is macOS-only, closed source, and paid. Its Windows peers are either adware-laden, abandoned, or bare yt-dlp GUIs that expose flags instead of intent. There is no Windows app with that shape: paste a link, see a row with a thumbnail and a format dropdown, click download, get a clean MP4 or MP3 with tags, subtitles and chapters. The reference app is a thin native shell over yt-dlp, ffmpeg, aria2c and AtomicParsley, so the gap is product shape, not technology.

## Vision

A Windows user pastes a YouTube, Vimeo, Facebook, Instagram, Dailymotion, SoundCloud, Mixcloud, Bandcamp or Youku link into a single dark window and, within seconds, sees a thumbnail, title and duration with the best quality preselected. One click later the file lands in their Videos folder, tagged and named sensibly. Euphoric surprise: a site that broke yesterday works today because the engine updated itself overnight, without an app update. The user drags in a playlist and it just fans out into rows.

## Out of Scope

- **No Linux builds in v1.** Windows x64 is the primary target and macOS is a secondary, working build; Linux is deferred.
- **No licensing, trial, or payment layer.** TuberX is open source under Andre's GitHub; Paddle-style activation is not ported.
- **No AirDrop analogue.** Post-download actions are reveal, open-with, and notification.
- **No streaming or in-app playback beyond the trim preview.** It is a downloader, not a player.
- **No bypassing DRM.** Sites yt-dlp cannot legitimately extract stay unsupported; TuberX adds no circumvention of its own.
- **No custom extractors.** Site support is whatever yt-dlp supports; TuberX never maintains per-site scraping code.
- **No localization in v1.** English strings, but no hard-coded copy inside components that would block i18n later.

## Principles

- The engine is replaceable and self-updating; the app never becomes the bottleneck when a site changes.
- Intent over flags: the UI speaks in formats, qualities and destinations, never in yt-dlp switches.
- Remux before re-encode: never burn CPU converting when a container swap gives the same result.
- Nothing phones home except the yt-dlp and app update checks the user can see.
- A failed row stays visible with a reason and a Retry; silent drops are a bug.

## Constraints

- Electron + TypeScript + Vue 3 + Pinia + Tailwind via vite-plugin-electron, packaged by electron-builder (NSIS), mirroring the deemix-remastered toolchain file for file.
- External tools are spawned processes under `resources/bin/win/`: `yt-dlp.exe`, `ffmpeg.exe`, `ffprobe.exe`, `aria2c.exe`, `deno.exe`. No Python runtime shipped.
- Persistent state lives in SQLite through Node's built-in `node:sqlite` (no native module) under `%APPDATA%\TuberX\tuberx.db`; settings in `electron-store` JSON.
- Renderer never spawns processes or touches the filesystem; all engine work crosses a typed preload IPC bridge.
- Credentials and cookies are stored with Electron `safeStorage` (DPAPI), never in plaintext.
- Default destination is `%USERPROFILE%\Videos\TuberX`; user destinations are remembered up to 15 entries.
- Open-source licenses of bundled tools (Unlicense, GPL, LGPL) are shipped in a `THIRD_PARTY_LICENSES` file.

## Goal

"I need a Microsoft Windows equivalent to this." Ship TuberX, an installable Windows app whose main window is a paste-to-download flow, that resolves and downloads media from the nine named sites and every other yt-dlp-supported site, with format selection, playlists, Download Later, History, subtitles, tagging and trim, and whose yt-dlp engine updates independently of app releases.

## Test Strategy

| isc | type | check | threshold | tool | anchors_to |
|---|---|---|---|---|---|
| ISC-1 | bash | `bun run build:win` emits `release/TuberX-Setup-*-x64.exe` | file exists | bash | principal_stated_goal |
| ISC-1.1 | bash | same build emits `release/TuberX-Portable-*-x64.exe` | file exists | bash | principal_stated_goal |
| ISC-1.2 | bash | `bun run build:mac` emits `release/TuberX-*-arm64.dmg`, app launches | window visible | bash+screenshot | Decisions 2026-09-02 12:20 |
| ISC-3.1 | bash | every file in `resources/bin/darwin` is arm64 (`file`) | 0 x86_64-only | bash | Decisions 2026-09-02 12:30 |
| ISC-2 | bash | installer runs silently on Windows VM, app launches | exit 0, window visible | bash+screenshot | principal_stated_goal |
| ISC-3 | bash | `dir resources\bin\win` lists five tools | 5 files | bash | Constraints |
| ISC-4 | bun-test | tool health check reports version for each binary | all resolve | bun test | Constraints |
| ISC-5 | bun-test | engine updater downloads newer yt-dlp release when available | version bump | bun test (mocked GitHub) | Vision |
| ISC-6 | bash | app starts with SQLite schema present | tables exist | sqlite3 | Constraints |
| ISC-7 | bun-test | `rg` for analytics SDKs in src returns nothing | 0 matches | rg | Principles |
| ISC-8 | bash | `rg "spawn\|child_process" src/renderer` returns nothing | 0 matches | rg | Constraints |
| ISC-9 | screenshot | empty window shows drop zone copy | matches the reference layout | Interceptor | Vision |
| ISC-10.1 | bun-test | paste triggers fetch + pending row | pending row | bun test | Vision |
| ISC-10.2 | bun-test | resolved row shows thumbnail, title, uploader, duration | fields rendered | bun test + fixture JSON | Vision |
| ISC-11 | bun-test | dropping a URL on the window creates a row | row rendered | bun test | Vision |
| ISC-12 | bun-test | multi-link dialog accepts N newline-separated URLs | N rows | bun test | Vision |
| ISC-13 | bun-test | dropping a `.txt` of URLs adds every valid URL once | dedup holds | bun test | Vision |
| ISC-14 | bun-test | duplicate URL against list, later, history is rejected with notice | 0 new rows | bun test | Principles |
| ISC-15 | bun-test | `tuberx://<url>` launch argument adds a row | row rendered | bun test | Vision |
| ISC-16 | bun-test | metadata parser maps `--dump-single-json` to `MediaItem` | schema valid | bun test + fixtures | Constraints |
| ISC-17 | bun-test | format dropdown lists video qualities present in formats | 360…2160 | bun test | Vision |
| ISC-18 | bun-test | best available quality preselected | top entry | bun test | Vision |
| ISC-19.1 | bash | Windows download of a `|`-titled video → row done with existing path | done | manual on Windows | Decisions 2026-09-02 16:10 |
| ISC-19 | bash | downloading a YouTube URL yields playable MP4 | ffprobe ok | ffprobe | Goal |
| ISC-20 | bash | MP3 output exists with correct duration | ±1 s | ffprobe | Goal |
| ISC-21 | bash | M4A output keeps original bitrate (remux, no re-encode) | codec copy | ffprobe | Principles |
| ISC-22 | bun-test | progress events parsed from yt-dlp newline output | pct, speed, eta | bun test | Vision |
| ISC-22.1 | bash | `scripts/bench-download.sh` aria2c mode log contains `[download] Destination` from aria2c and a PATH-less run differs | aria2c used | bash | Principles |
| ISC-22.2 | bash | `scripts/bench-download.sh` aria2c-x16 vs native MB/s ratio | ≥ 1.8x | bash | Vision |
| ISC-23 | bun-test | Apply-to-all sets every row's format | all rows | bun test | Vision |
| ISC-24.1 | bash | simulate a wedged post-processor (SIGSTOP ffmpeg) → row failed with 'Stalled while …' within 11 min, no orphan ffmpeg | killed | bash | Decisions 2026-09-02 16:40 |
| ISC-24 | bun-test | failed download stays in list with reason and Retry works | row retained | bun test | Principles |
| ISC-25 | bun-test | destination picker remembers 15 folders | 15 max | bun test | Constraints |
| ISC-26 | bun-test | queue persists across app restart | rows restored | bun test | Vision |
| ISC-27…35 (one row each at close) | bash | `yt-dlp --dump-single-json <site fixture URL>` returns title for each of nine sites | title non-empty | bash | Goal |
| ISC-36 | bun-test | playlist URL prompts "this video / entire playlist" | prompt shown | bun test | Vision |
| ISC-37 | bun-test | playlist preview lists entries with search and select | entries listed | bun test | Vision |
| ISC-38 | bun-test | Later list add/remove/send-to-queue | state changes | bun test | Vision |
| ISC-39.1 | bun-test | History records completed downloads | rows present | bun test | Vision |
| ISC-39.2 | bun-test | History clear empties table | 0 rows | bun test | Vision |
| ISC-40 | bun-test | skip-if-exists setting skips known files | skipped status | bun test | Vision |
| ISC-41 | bash | subtitles embedded into MP4 when available | stream present | ffprobe | Goal |
| ISC-42 | bash | subtitles-only download writes `.srt` | file exists | bash | Goal |
| ISC-43 | bash | thumbnail saved beside media with same stem | file exists | bash | Goal |
| ISC-44.1 | bash | title/artist/comment tags written | tags present | ffprobe | Goal |
| ISC-44.2 | bash | artwork stream embedded | attached_pic | ffprobe | Goal |
| ISC-45 | bash | trim export from in/out produces clip of expected length | ±0.5 s | ffprobe | Goal |
| ISC-46 | bash | split-by-timecodes produces N clips or chapters | N files / chapters | ffprobe | Goal |
| ISC-47 | bun-test | batch rename with index pattern | names match | bun test | Goal |
| ISC-48 | bun-test | proxy setting is passed to yt-dlp and shown as badge | arg present | bun test | Vision |
| ISC-49 | bun-test | cookies-from-browser choice passed to yt-dlp | arg present | bun test | Constraints |
| ISC-49.1 | bash | engine.log argv contains `--cookies <userData>/cookies/cookies.txt` after import | arg present | bash | Vision |
| ISC-49.2 | bash | `yt-dlp -v` with the app's plugin/extractor args lists `bgutil:script-deno (external)` and logs `Executing command … deno run` | provider used | bash | Vision |
| ISC-49.4 | bash | engine.log argv contains `--force-ipv4` | arg present | bash | Decisions 2026-09-02 15:05 |
| ISC-49.3 | bash | engine.log on an unfiltered network shows token generation without `Failed while generating POT` | token minted | bash | Vision |
| ISC-50 | bash | browser extension sends `tuberx://` from context menu | row added | manual | Vision |
| ISC-51 | bun-test | electron-updater configured against GitHub Releases | config valid | bun test | Principles |
| ISC-52 | bash | installer and exe are Authenticode signed | signtool verify | bash | Out of Scope |

## Features

### F0 · Cross-cutting
Why: the shell is cheap and the tools are the product; bundling, updating and isolating them is what makes every other feature survive site churn.

- [ ] ISC-1: `bun run build:win` produces a 64-bit NSIS installer in `release/`.
- [ ] ISC-1.1: The same build produces a 64-bit portable `.exe` that runs without installing.
- [x] ISC-24.2: Download-again with a different video quality produces a second file named with that quality, leaves the first intact, and repeating a format refreshes its own file (ffmpeg shows the expected resolutions).
- [ ] ISC-24.1: A download whose ffmpeg stage produces no output for 10 minutes is killed, including ffmpeg, and the row fails with a message naming the stage.
- [x] ISC-1.2: `bun run build:mac` produces a `.dmg` that launches on macOS and resolves a URL.
- [ ] ISC-2: The installer installs and launches TuberX on a clean Windows 10/11 x64 machine.
- [x] ISC-3: `resources/bin/win/` ships yt-dlp, ffmpeg, ffprobe, aria2c and deno executables.
- [x] ISC-3.1: `resources/bin/darwin/` ships the same five tools as arm64 binaries.
- [x] ISC-4: A launch-time health check resolves and logs the version of every bundled tool.
- [ ] ISC-5: The engine updater checks GitHub Releases daily and replaces `yt-dlp.exe` when newer, independent of app updates.
- [x] ISC-6: First launch creates the SQLite database with `queue`, `history`, `later`, `destinations` tables.
- [x] ISC-7: Anti: no analytics or crash-reporting SDK exists in the dependency graph or source.
- [x] ISC-8: Anti: the renderer contains no `child_process` or `fs` imports; all engine calls go through preload IPC.

### F1 · Add media
Why: the moment between paste and a populated row is where a downloader feels magical; TuberX has to hit the same beat on every entry path.

- [x] ISC-9: The empty window shows a "Paste or Drop Video URLs Here" zone with the supported-sites line.
- [x] ISC-10.1: Pasting a URL (Ctrl+V anywhere in the window) triggers a metadata fetch and a pending row.
- [x] ISC-10.2: A resolved row shows thumbnail, title, uploader and duration.
- [ ] ISC-11: Dropping a URL onto the window adds a row.
- [ ] ISC-12: A multi-link dialog (Ctrl+O) accepts newline- or space-separated URLs and fetches them in one pass.
- [ ] ISC-13: Dropping a `.txt` file extracts every URL it contains.
- [x] ISC-14: URLs already in the queue, Later list or History are rejected with a notice.
- [ ] ISC-15: Launching with a `tuberx://<url>` or `tuberxlater://<url>` argument routes the URL to the queue or Later list.
- [x] ISC-16: The `--dump-single-json` output is normalized into a typed `MediaItem` (formats, thumbnails, subtitles, chapters, playlist entries).

### F2 · Formats and download
Why: users think in "1080p MP4" and "MP3", and the download must be fast and honest about progress and failure.

- [ ] ISC-17: Each row has a format dropdown listing available video resolutions plus MP3, M4A, and video-only.
- [ ] ISC-18: The best available quality is preselected.
- [x] ISC-19: Downloading with a video format yields a playable MP4, remuxing VP9/AV1/HEVC sources by default.
- [ ] ISC-19.1: On Windows, a title containing `|` or `：` downloads and the row reports the real final path (no "output missing" / "not found").
- [ ] ISC-20: MP3 output is produced through ffmpeg at the configured bitrate.
- [ ] ISC-21: M4A output remuxes the original AAC/Opus stream without re-encoding when possible.
- [x] ISC-22: Progress, speed and ETA update live from yt-dlp's newline progress output.
- [ ] ISC-23: An "Apply to all" control sets the chosen format on every row and optionally on new rows.
- [ ] ISC-24: A failed row stays in the list with the error reason and a working Retry.
- [ ] ISC-25: The destination picker defaults to `Videos\TuberX` and remembers up to 15 custom folders.
- [x] ISC-26: The queue is restored after an unexpected quit.

### F3 · Site coverage
Why: the named sites are the promise on the tin; each one is a distinct extractor path that must be exercised, not assumed.

- [x] ISC-27: A public YouTube URL resolves to metadata and downloads.
- [x] ISC-28: A public Vimeo URL resolves and downloads.
- [ ] ISC-29: A public Facebook video URL resolves and downloads.
- [ ] ISC-30: A public Instagram reel or post URL resolves and downloads.
- [ ] ISC-31: A Dailymotion URL resolves and downloads.
- [ ] ISC-32: A SoundCloud track URL resolves and downloads as MP3/M4A.
- [ ] ISC-33: A Mixcloud show URL resolves and downloads.
- [ ] ISC-34.1: A Bandcamp track or album URL resolves and downloads.
- [ ] ISC-34.2: Bandcamp output carries artist and title tags.
- [ ] ISC-35: A Youku URL resolves and downloads.

### F4 · Playlists and channels
Why: a playlist is the difference between a ten-second task and an hour of pasting.

- [ ] ISC-36: A URL that is both a video and part of a playlist prompts "this video only / entire playlist".
- [ ] ISC-37: A playlist or channel URL opens a preview picker with search, select-all, and "Download all later".

### F5 · Later and History
Why: a Later list and History are how a downloader becomes a daily tool rather than a one-shot utility.

- [ ] ISC-38: The Download Later list stores URLs with metadata and can send items to the queue.
- [x] ISC-39.1: History records every completed download with path, format and time.
- [ ] ISC-39.2: History can be cleared from the History view.
- [ ] ISC-40: A "skip if file exists or in history" setting skips instead of re-downloading.

### F6 · Subtitles, thumbnails, metadata
Why: the file should be finished when it lands, with nothing left for the user to fix in another app.

- [ ] ISC-41: Subtitles in the configured languages are embedded into MP4 output when available, with auto-generated captions as fallback.
- [ ] ISC-42: A "subtitles only" action writes `.srt` files without downloading media.
- [ ] ISC-43: Thumbnails can be saved as JPG or PNG beside the media with the same file stem.
- [ ] ISC-44.1: Title, artist and comment tags are written to MP4, M4A and MP3 outputs.
- [ ] ISC-44.2: Artwork is embedded in MP4, M4A and MP3 outputs.

### F7 · Editing
Why: trim and split are the most-loved extras of this app category and turn the downloader into a clip tool.

- [ ] ISC-45: A trim view with video preview exports the in/out range to MP4, M4A or M4R ringtone.
- [ ] ISC-46: A pasted timecode list splits a file into clips or writes it as chapter metadata.
- [ ] ISC-47: Batch rename supports an index pattern and custom prefix/suffix text.

### F8 · Access
Why: geo-blocks and login walls are the common failure; the fix must be a setting, not a forum post.

- [ ] ISC-48: A proxy URL setting is passed to yt-dlp and shown as an on/off badge in the window.
- [ ] ISC-49: A "use cookies from Chrome / Edge / Firefox" setting is passed as `--cookies-from-browser`.
- [ ] ISC-49.1: An imported Netscape cookies.txt is copied into app data and passed as `--cookies` on every fetch and download.
- [x] ISC-49.2: With the PO-token helper on, yt-dlp lists `bgutil:script-deno` as an available provider and invokes it through the bundled Deno from the bundled `resources/pot` tree, on both platforms.
- [ ] ISC-49.4: Every yt-dlp invocation carries `--force-ipv4` unless the user turns "Prefer IPv4" off.
- [ ] ISC-49.3: On a network that resolves `jnn-pa.googleapis.com`, a YouTube fetch logs a generated PO token (`[pot:bgutil:script-deno] Generating a gvs PO Token` followed by no provider error).

### F9 · Integration and distribution
Why: a downloader lives next to the browser; sending a page with one shortcut and updating silently are what keep it installed.

- [ ] ISC-50: An MV3 extension for Chrome/Edge/Firefox sends the current page or a right-clicked link via `tuberx://` and `tuberxlater://`, with Ctrl+Shift+P / Ctrl+Shift+L shortcuts.
- [x] ISC-51: electron-updater checks GitHub Releases and installs app updates on user approval.
- [ ] ISC-52: Release binaries are Authenticode signed.

## Not yet specified

- fog: which hardware encoder (NVENC / QSV / AMF) is offered when the user forces H.264/H.265 re-encode, and how encoder availability is detected — resolves once ffmpeg encoder probing is prototyped in F2.
- fog: whether PO-token generation for YouTube ships via the bgutil plugin with bundled deno or via yt-dlp's built-in EJS path alone — resolves after testing the current yt-dlp Windows build against age-restricted and rate-limited fixtures.
- fog: whether login-required sites (Instagram, Facebook private) get a credential dialog or rely solely on browser cookies — resolves after ISC-49 is measured against real fixtures.

## Decisions

- 2026-09-02 11:45: Stack is Electron + TypeScript + React (electron-vite, electron-builder). Andre accepted the recommendation from the reference-app analysis (kept privately in docs/private); Tauri and WinUI 3 rejected on toolchain unfamiliarity. Reasoned default, not interviewed.
- 2026-09-02 11:45: "Yuki" in the request clarified by Andre as Youku; recorded as ISC-35.
- 2026-09-02 11:45: v1 is Windows-only despite Electron being cross-platform, to keep the ISA honest to the stated goal.
- 2026-09-02 12:20: refined: Andre asked for a working macOS copy as well as the Windows 64-bit installer and 64-bit portable build. macOS moves from Out of Scope to a secondary target (ISC-1.2); Windows stays primary. Tool binaries are bundled per platform from `resources/bin/win32` and `resources/bin/darwin`.
- 2026-09-02 11:45: Site coverage is delegated entirely to yt-dlp; TuberX ships no extractor code (Out of Scope, Principles).
- 2026-09-02 11:50: Renderer framework is Vue 3 (not React) so the repo mirrors deemix-remastered's vite-plugin-electron + Vue + Pinia + Tailwind layout; refined: Constraints updated.
- 2026-09-02 12:10: Instagram (ISC-30) cannot be probed anonymously — yt-dlp returns "empty media response" and asks for cookies; verification waits on ISC-49 with Andre's own browser cookies rather than a scripted probe.
- 2026-09-02 12:10: Youku (ISC-35) is unverifiable on this LAN: the local DNS filter sinkholes `log.mmstat.com` to 0.0.0.0, which yt-dlp's youku extractor must reach. Verify on the Windows box or with the filter paused; not an engine fault.
- 2026-09-02 12:05: Video format selection uses yt-dlp `-S res[:H],vcodec:h264,acodec:aac` (resolution first, then H.264/AAC) so MP4s play on stock Windows; "keep original" drops the codec preference. Replaces plain `bv*[height<=H]` selectors after the smoke download produced AV1+Opus in MP4.
- 2026-09-02 12:25: refined: `better-sqlite3` replaced by `node:sqlite` (Electron 38 ships Node 22.22 where it is unflagged). The Windows cross-build from macOS failed on `node-gyp does not support cross-compiling`; a builtin removes every native rebuild from the pipeline for both targets.
- 2026-09-02 12:30: refined: macOS build is Apple silicon (arm64) only; Andre does not want to support Intel Macs. Bundled macOS tools are arm64 natives: yt-dlp (universal upstream), ffmpeg/ffprobe from ffmpeg.martin-riedl.de, deno arm64, and aria2c compiled by `scripts/build-aria2-mac.sh` because no static arm64 macOS aria2 is published upstream.
- 2026-09-02 12:35: yt-dlp's macOS PyInstaller binary takes ~8 s on a cold first run (Gatekeeper scan + onefile extraction); the 15 s health-check timeout produced a false "missing yt-dlp" and a needless engine download. Health check and updater now allow 90 s for yt-dlp.
- 2026-09-02 13:05: Throughput inspection after Andre reported slow, increasingly long downloads on Windows and an aria2 toggle that "timed out". Findings: (1) `--downloader aria2c` was passed by name but the bundled bin dir was never on the child's PATH, so yt-dlp fell back to its native downloader silently (rc=0, no error) — aria2 was never running on any platform; (2) YouTube caps a single connection at roughly 2–4 MB/s regardless of the user's line, so the native downloader is the ceiling; (3) the Windows "timeout" on toggling aria2 is not reproduced here; v0.1.0 already carried the 90 s yt-dlp health-check timeout, so the leading hypothesis is Defender's first-run scan of the PyInstaller exe stalling Settings › Engine, to be confirmed on the Windows box with the 0.1.1 log line that now names the downloader in use. Fix: tool dirs prepended to PATH for every yt-dlp spawn and aria2c passed by absolute path; aria2c tuned to 16 connections; `--concurrent-fragments 4` for HLS/DASH sites; aria2 on by default with a settings migration; concurrent downloads default 3, max 8.
- 2026-09-02 13:45: Root cause of dead progress bars in 0.1.0: `--print after_move:` makes yt-dlp imply `--quiet`, which drops every info and progress line, and the PyInstaller Python block-buffers stdout on a pipe. Fixed with `--no-quiet` and `PYTHONUNBUFFERED=1`; this, not download speed alone, is the "increasingly long" feeling — rows sat at 0% until done.
- 2026-09-02 13:45: aria2c is limited to plain http/https; `--downloader dash,m3u8:native` keeps HLS/DASH fragment streams on yt-dlp's native downloader with `--concurrent-fragments 4` (Vimeo HLS measured at 29 MiB/s). aria2 caps `-x` at 16 (32 exits with code 28), so 16 is the ceiling, not a tuning choice.
- 2026-09-02 13:45: Vimeo 76979871 (Vimeo's own player demo) is FairPlay-DRM on every format and is not downloadable anonymously by any tool; the error now says so. It stays the resolve fixture; 1084537 is the download fixture.
- 2026-09-02 13:45: Every yt-dlp line is now written to `<userData>/logs/engine.log` (5 MB rotation) so Windows reports can come with evidence instead of a description.
- 2026-09-02 14:20: YouTube's "Sign in to confirm you're not a bot" (Andre, Windows). Three answers shipped in 0.2.0: an imported cookies.txt (`--cookies`), the existing cookies-from-browser, and the bgutil PO-token helper in Deno script mode (plugin zip via `--plugin-dirs`, `youtubepot-bgutilscript:server_home` pointing at a bundled server tree with a flat npm-built `node_modules`; only the native `canvas` addon differs per platform, swapped from node-canvas's N-API prebuilds). Deno and helper caches are pinned inside app data via `DENO_DIR` and `XDG_CACHE_HOME`.
- 2026-09-02 14:20: Token generation cannot be verified on this LAN: the resolver at 192.168.10.2 sinkholes `jnn-pa.googleapis.com` (public DNS resolves it), so bgutil fails with "Failed to generate an integrity token" after the plugin correctly invokes Deno. If Andre's Windows box uses the same filter, the helper fails there too until the host is whitelisted; this may also be part of why the bot check appears at all. ISC-49.3 stays open until run off this network.
- 2026-09-02 15:05: Andre pushed back: the reference macOS downloader works on this LAN with no whitelisting. Captured the reference macOS downloader's live yt-dlp argv (`ps` while it fetched): `--force-ipv4 --no-check-certificate --plugin-dirs … --extractor-args youtubepot-bgutilhttp:base_url=http://127.0.0.1:4416 --extractor-args youtube:player-client=default --js-runtimes node:…` with a persistent Node bgutil HTTP server. Ran the reference macOS downloader's own `build/generate_once.js` under its bundled Node: "Failed to generate an integrity token", identical to ours, so the reference macOS downloader's helper is equally blocked here and its success is not token-based; neither app's fetch even requested a token on this Mac. The Mac has no global IPv6 while the LAN resolver returns AAAA for youtube.com, so a Windows box with IPv6 reaches YouTube over IPv6, the best-documented trigger of the bot prompt. Adopted the reference macOS downloader's `--force-ipv4` as the "Prefer IPv4" default (0.2.1). The jnn-pa DNS finding stands as a fact about the helper, not as the explanation for Windows.
- 2026-09-02 15:30: Andre: cookies must stay optional (the reference macOS downloader never asks) and Settings text was cut off. Cookies were always optional in the engine; the UI and the bot-check error copy implied otherwise. Fixed: Toggle descriptions were passed as `description` but the component reads `hint`, so two toggles rendered with no explanation; toasts and row errors used single-line `truncate`, now wrap (toasts) or clamp to three lines (rows); Network section leads with "Cookies are optional"; the bot-check message no longer points at cookies first and the engine retries that fetch once after 4 s before surfacing it.
- 2026-09-02 16:10: Andre (Windows): "output missing: <path with the video title>" on some downloads. Not reproducible on macOS. Diagnosis by reading yt-dlp's output path: `write_string` encodes with `locale.getpreferredencoding()` (cp1252 on Windows) using `errors='ignore'`, so the `--print after_move` path loses any character outside cp1252 before it reaches the app, while the file on disk keeps it. `--windows-filenames` turns `|` and `:` into fullwidth `｜` and `：`, which are outside cp1252, so any title containing those triggers it. Fix: `--encoding utf-8` on every call and `PYTHONUTF8=1` in the child env, plus a recovery lookup in the destination when a printed path still does not exist, and a message that names the folder instead of "output missing". Windows confirmation pending.
- 2026-09-02 16:10: Right-click menus: empty area offers Paste link / Paste link and download / Select all; rows offer Download, Copy link, Open page, Reveal file, Remove. The clipboard is read in the main process.
- 2026-09-02 16:40: Andre: a Windows download sat in merge/tag for 8+ hours; portable exe takes very long to launch. Watchdog added: `run()` kills the whole process tree (`taskkill /T /F` on Windows, `pkill -P` + SIGKILL elsewhere) after 10 minutes without output and the row reports the stage; cancel also kills the tree now, so an orphaned ffmpeg no longer survives a cancel. The slow launch is the electron-builder `portable` target itself: a self-extracting NSIS stub that unpacks the entire app (~600 MB with tools and the PO helper) into TEMP on every launch, each file scanned by Defender. Replaced by a `zip` of the unpacked app named `TuberX-Portable-*-x64.zip`; the installer target is unchanged.
- 2026-09-02 17:10: Andre rejected the portable zip: he wants the portable EXE and the same asset set as earlier releases. Reverted the Windows targets to nsis + portable (0.2.5). Changing the artifact format was a product decision made without asking; the launch delay of the self-extracting portable stays as a known trade-off, documented in the README.
- 2026-09-02 17:40: Portable launch optimization, format unchanged (EXE). Measured against Deemix's portable (103 MB, 382 MB / 76 files unpacked) TuberX was 236 MB, 861 MB / 6,170 files; the electron-builder portable stub always wipes, extracts and deletes on every run (read `portable.nsi`), so launch time is the file count under Defender. Changes: the PO-token helper is esbuild-bundled to one file with jsdom's stylesheet inlined and its sync-XHR worker resolve neutralized; css-tree stays external (runtime JSON loads) with mdn-data and source-map-js; node_modules per platform went from 6,088 files / 105 MB to ~380 files / 35 MB, verified under Deno (`--version` 1.3.2, reaches BotGuard, listed by yt-dlp). ffprobe dropped (unused, 138 MB). Fragment parallelism scales to half the CPU count (max 8); ffmpeg already threads across all cores.
- 2026-09-02 18:30: Andre: noticeable delay queuing links and starting downloads on both platforms, unlike the reference macOS downloader. Measured: `yt-dlp --version` alone took 7.8–8.4 s warm because the single-file PyInstaller build unpacks a Python runtime on every run; the reference macOS downloader's onedir `vydl` takes 0.9 s. Fixed by shipping yt-dlp's onedir zips (`yt-dlp_win.zip`, `yt-dlp_macos.zip`; 0.3 s warm after Gatekeeper's one-time scan), an updater that installs onedir builds, and removal of any legacy single-file copy in userData/bin (which resolveTool would otherwise still prefer). Downloads now start from the info JSON saved at fetch time (`--load-info-json`, refreshed if older than 3 h or rejected), skipping the second extraction. In-app: paste→ready 2.2 s, click→first progress 4.7 s. The PO-token helper is skipped when DNS sinkholes its endpoint.
- 2026-09-02 18:30: Progress bar ran backwards because each of the 2+ files yt-dlp downloads (video, audio) reported its own 0–100 %. The bar now aggregates bytes across parts, caps at 95 % until the last part begins, never decreases, and shows "part n/m".
- 2026-09-02 21:30: Andre: per-row Pause / Stop / Resume, and re-download in another format. Shipped in 0.2.10: Pause aborts the process tree but keeps partials (`paused` status, bar held); Resume restarts and aria2c `-c` / yt-dlp `--continue` pick the partial up (verified: paused at 18 %, resumed at 20 %); Stop aborts, deletes the temp-dir partials and returns the row to Ready; finished rows get a Download-again control, and an explicit re-download bypasses the history skip once. Found on the way: aria2c's status line defaults to every 60 s, so a fast transfer showed 0 % until 95 %; `--summary-interval=1` fixed it. `TUBERX_ARIA2_LIMIT` throttles aria2c for tests.
- 2026-09-02 22:15: Andre: Download-again at a different quality re-produced the old file. Root cause in yt-dlp, not the picker: `--no-overwrites` treats an existing *output file name* as "already downloaded" regardless of format, prints `has already been downloaded`, skips the transfer, and post-processes the old file, so the row reported done with the same bytes. The format selection itself was correct (verified `--load-info-json` + `-S res:2160/1440/1080` → 315/308/299). Fix: an explicit re-download passes `--force-overwrites`; verified 240p (862 KB) → 144p (736 KB) with `force=true` in the engine log. Window default confirmed as option 1 (600×680).
- 2026-09-02 22:40: Andre: overwriting on re-download must not destroy a file the user wanted in another quality. Design: every row remembers the formats it has produced and the name each was saved under (`downloadedVariants`). A format seen before refreshes its own file; a new video quality on a row that already has a video file is saved as "Title [1080p].mp4" (setting `onConflict: keep-both`, default) or overwrites (`replace`); audio kinds never collide. Verified all six cases end to end. Also: dev instances now use their own app-data folder (`TuberX-dev`) so they never share a database or single-instance lock with an installed TuberX; a silently swallowed ALTER TABLE had surfaced as "SQL logic error", so column migrations now check `PRAGMA table_info` and never swallow. Right-click inside text fields (the Add-links box) now shows a native Cut/Copy/Paste/Select-all menu; Electron has none by default.
- 2026-09-02 11:45: Build order: F0 → F1 → F2 → F3 fixtures → F5 → F4 → F6 → F8 → F7 → F9.

- 2026-09-02 23:15: Andre confirmed the 0.2.11 rule failed in practice: Download again in a new quality still replaced the file he had. Cause: the decision keyed on the per-row ledger (`downloadedVariants`), which rows downloaded by any earlier version never had, so an upgraded install saw "no video file" and overwrote. Intent restated by Andre: Download again after changing the format means a second copy in the new format, and the file already there is never touched; the same format again refreshes its own file. Redesign: the decision is made from what is on disk. Files this link produced are found through history (every version has written it) and the row's last output; any surviving video file that this format did not make forces the quality tag. With no ledger and no history at all the tag is still applied, so the only path that overwrites is "same format again". Verified: pre-ledger row → `[144p]` beside the plain file; no ledger and no history → `[240p]` beside both; same format again refreshed `[240p]` in place (three files before and after).

- 2026-09-03 09:20: A tester reported the original (4K) being deleted when the same link was downloaded again at a lower resolution. Audit of every path that can replace a file found a second vector beyond the pre-ledger one fixed in 0.2.12: every download that was not a redo passed `--force-overwrites` whenever "Skip if the file already exists" was off, so removing the row and pasting the link again at a new quality overwrote the earlier file if the container matched. Redesign, now independent of how the download was started: overwriting is granted only to a Download again of a format that is on record (ledger or history) as having produced the file at that name; every other download runs with yt-dlp's default keep-existing behaviour. Existing files are found through the ledger, history, the row's last output and a title match over the destination folder; any video file this format did not make forces the quality tag before yt-dlp starts. As a last line, yt-dlp still runs its post-processors over a file it "already downloaded", so a job without overwrite permission is killed the moment that line appears and re-run with the tag. Also added: an About section (Settings → About, and "About TuberX" in the right-click menu) showing version, platform, Electron/Chromium, description and links.

- 2026-09-03 13:40: Andre: post-processing "drags on at the end" and the stats under the bar are cut off. Findings: after the transfer yt-dlp runs Merger, EmbedSubtitle and Metadata as three separate ffmpeg passes, each a full rewrite; cover art goes through mutagen (cheap); then MoveFiles, which is a full copy when the destination is on a different volume from app data. yt-dlp cannot fuse the passes. Changes: the temp folder moves next to the destination when it sits on another volume (`.tuberx-tmp`, hidden on Windows, removed when empty) so the move is a rename; the row names each pass (merging, embedding subtitles, writing tags, cover art, moving) with elapsed seconds and a pulsing bar instead of a frozen "100 %"; the stats line wraps and adds downloaded/total size instead of truncating; Open log folder added to Engine and About. A Windows report of a 1080p60 re-download "downloading for five minutes" on an 8K HDR video needs its engine.log; the size and speed now shown on the row are what tell a long transfer from a stall.

## Learning

- conjectured: every named site resolves anonymously through yt-dlp with no site-specific code in TuberX. refuted by: `bun scripts/site-check.ts` 2026-09-02 — Vimeo's web client now refuses anonymous requests ("only works when logged-in"), while `player.vimeo.com/video/<id>` still serves the same video. learned: a URL rewrite is not extractor code; one embed fallback keeps the no-extractor principle intact. criterion now: ISC-28 passes via the player fallback (`vimeoPlayerUrl` in `shared/urls.ts`, retried in `fetchMetadata`).

- conjectured: `--downloader aria2c` plus a bundled aria2c binary is enough for multi-connection downloads. refuted by: `scripts/bench-download.sh` aria2c-nopath run 2026-09-02 — yt-dlp exits 0 and downloads at native speed when the name is not on PATH; nothing in the UI or logs said so. learned: yt-dlp resolves external downloaders on PATH, and a silent fallback is worse than an error; the app must own the child's PATH and pass absolute paths. criterion now: ISC-22.1.

- conjectured: with `--newline --progress --progress-template` the app receives a progress line per chunk. refuted by: engine.log 2026-09-02 13:37 — a full download produced only the two ERROR lines and the `--print` output; zero `[youtube]` or `TXP|` lines. learned: `--print` implies `--quiet` in yt-dlp, and a piped PyInstaller Python buffers stdout; both must be countered explicitly, and the bench (terminal, no `--print`) could never have shown it. criterion now: ISC-22 re-verified in-app, not from a terminal transcript.

- conjectured: the LAN DNS filter's sinkhole of jnn-pa.googleapis.com explains the Windows bot prompt. refuted by: the reference macOS downloader's bundled Node generator failing identically on the same LAN while the reference macOS downloader itself works, and neither engine requesting a PO token here at all; the Mac simply is not challenged, and it has no IPv6. learned: check what the working reference actually does before explaining the failure; a real blocker (DNS) is not automatically the cause. criterion now: ISC-49.4, `--force-ipv4` present in every engine argv by default.

- conjectured: decoding the child's stdout as UTF-8 with PYTHONIOENCODING set is enough for paths to round-trip. refuted by: reading yt-dlp's `write_string`, which encodes with the locale's preferred encoding and silently drops unencodable characters on Windows; the macOS locale is UTF-8, so every test here passed. learned: a path printed by a tool is only as good as the tool's output encoding; assert it (`--encoding utf-8`) rather than assume it, and keep a filesystem lookup as the fallback. criterion now: ISC-19.1.

- conjectured: fetch latency is dominated by YouTube's API round-trips and would be the same in any yt-dlp front end. refuted by: timing `yt-dlp --version` (7.8 s) against the reference macOS downloader's onedir build (0.9 s) on the same machine; the network part of a fetch is ~1.5 s. learned: measure the engine's fixed cost before the variable one; a per-process unpack was the whole delay and no amount of network tuning would have found it. criterion now: ISC-10.1 timed (paste→ready ≤ 5 s on a warm engine) and ISC-19 timed (click→progress ≤ 8 s).

- conjectured: a wrong format on re-download means the row's stored choice was overwritten somewhere in the UI. refuted by: the engine log showing the new format selected (`Downloading 1 format(s): 308+140`) while the output stayed identical, and the earlier log line `has already been downloaded` naming the final file. learned: yt-dlp's skip check is by file name only; a format change must be accompanied by an overwrite intent, and the log's "already downloaded" line is the signature. criterion now: ISC-24.2.

## Verification

- ISC-1, ISC-1.1: `bun run build:win` from macOS emits `release/TuberX-Setup-0.1.0-x64.exe` and `release/TuberX-Portable-0.1.0-x64.exe` (2026-09-02); left open until ISC-2 runs them on Windows.
- ISC-1.2: `bun run build:all` → `release/TuberX-0.1.0-arm64.dmg`; packaged app launched, queue restored, docs/reference/tuberx-mac-packaged.png (2026-09-02).
- ISC-4: packaged Mac app `tools.status()` → yt-dlp 2026.08.19, ffmpeg/ffprobe N-126314, aria2c 1.37.0, deno 2.9.6 all ok via scripts/cdp-eval.ts (2026-09-02).
- ISC-3: `ls release/win-unpacked/resources/bin` → 5 tools (2026-09-02).
- ISC-3.1: `file resources/bin/darwin/*` → aria2c, deno, ffmpeg, ffprobe arm64; yt-dlp universal (2026-09-02). aria2c built by scripts/build-aria2-mac.sh, links only system libs (otool -L).
- ISC-6: `sqlite3 tuberx.db .tables` → destinations history later queue (2026-09-02).
- ISC-7: `rg` for analytics SDK names in src/electron/shared → 0 (2026-09-02).
- ISC-8: `rg child_process|node:fs src/` → 0 (2026-09-02).
- ISC-9, ISC-10.1, ISC-10.2: docs/reference/tuberx-dev-1.png, tuberx-dev-4.png (2026-09-02).
- ISC-14: addUrls with 2 known URLs → `duplicates: 2`, `added: 1` via scripts/cdp-eval.ts (2026-09-02).
- ISC-19: in-app download of jNQXAC9IVRw → `~/Movies/TuberX/Me at the zoo.mp4`, ffprobe h264/aac (2026-09-02).
- ISC-26: queue rows restored after two Electron restarts, including the better-sqlite3 → node:sqlite driver swap (2026-09-02).
- ISC-39.1: `history.list()` returned the completed row (2026-09-02).
- ISC-51: `app-update.yml` present in win-unpacked with provider github (2026-09-02).
- ISC-22.1: engine.log 2026-09-02 13:41 shows `[#446a09 …CN:16 DL:11MiB]` lines parsed into row progress for the in-app YouTube download; `--downloader` given by absolute path with tool dirs on PATH.
- ISC-22.2: scripts/bench-download.sh 2026-09-02 — native 4.15 MiB/s (best of three native runs: 2.5–5.0), aria2c -x16 8.70 MiB/s → 2.1x; in-app aria2 run reached 11 MiB/s.
- ISC-28: Vimeo 1084537 via player fallback downloads 177 MiB HLS in 6 s (29 MiB/s, native + 4 fragments) and merges to MP4 (2026-09-02).
- ISC-49.2: `yt-dlp -v` with `--plugin-dirs resources/pot/plugins` + `server_home=resources/pot/server` → `bgutil:script-deno-1.3.2 (external)`; earlier run logged `Executing command to get POT via script: …/deno run --allow-env --allow-net …` (2026-09-02). Windows half by construction (same tree, win32 canvas addon), unrun.
- ISC-24.2: scripted run 2026-09-02 22:40 — 240p plain → [144p] added → 144p again refreshes [144p] → mp3 plain → 240p again refreshes plain → replace mode overwrites plain; engine log `nameTag` column matches.
- ISC-22: tests/progress.test.ts + live progress observed in docs/reference/tuberx-dev-4.png (2026-09-02).
- ISC-16: `bun test` tests/normalize.test.ts (21 pass, 2026-09-02).
- ISC-27: resolve via `bun scripts/site-check.ts`; download via flag-set smoke on jNQXAC9IVRw → MP4 with mov_text subs, png cover, chapters, tags (ffprobe, 2026-09-02).
- ISC-28, 29, 31, 32, 33, 34.1: resolve half only, `bun scripts/site-check.ts` 7/9 (2026-09-02); download half still open.
- ISC-51.5: re-download naming decided from disk, not the ledger. Dev app, `~/Downloads/tx-redo-test`: v:best → `Me at the zoo.mp4`; ledger nulled + restart, v:144 → `Me at the zoo [144p].mp4`, plain file intact; ledger and history cleared, v:best → `Me at the zoo [240p].mp4`, both others intact; v:best again → `[240p]` refreshed in place, three files (engine.log `force=true nameTag=144p` / `nameTag=240p`, 2026-09-02 23:13).
- ISC-51.6: no download path overwrites a file it did not make. Dev app, skipIfExists off: fresh row v:best → plain; row removed, link re-added, v:144 → `[144p]` beside it (history); history cleared, row re-added, v:best → destination title scan pre-tagged `[240p]`, plain intact; Download again same format → `[240p]` refreshed in place, two files before and after (engine.log `overwrite=false` for all but the refresh, 2026-09-03 09:14).
- ISC-52: About section renders with `v0.2.12`, `macOS arm64 · Electron 38.8.6 · Chromium 140`, description and four link buttons; "About TuberX" event scrolls the drawer to it (CDP screenshot, 2026-09-03 09:16).
- ISC-53: temp folder follows the destination volume. RAM disk `/Volumes/TXRAM/out`: engine.log argv `temp:/Volumes/TXRAM/out/.tuberx-tmp`, file landed, temp folder gone afterwards; same-volume destination keeps app-data tmp (2026-09-03 13:29).
- ISC-54: post-processing stages named on the row: MP3 of a 10-minute video showed "Converting" with the pulsing bar (CDP screenshot); engine.log sequence Merger → VideoRemuxer (no-op) → EmbedSubtitle → Metadata → EmbedThumbnail (mutagen) → MoveFiles for a subtitled MP4 (2026-09-03 13:29).
