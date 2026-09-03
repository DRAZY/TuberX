# TuberX

**Paste a link, get the media.** TuberX is a standalone video and audio downloader for Windows and Apple-silicon Macs. One dark window, one row per link, a quality dropdown, and a Download button that produces a finished MP4, MP3 or M4A with tags, chapters, cover art and subtitles already in place.

Downloads: [latest release](https://github.com/DRAZY/TuberX/releases/latest) · Windows installer, Windows portable exe, macOS dmg (Apple silicon).

## Features

- **Paste and go.** Ctrl+V anywhere in the window, right-click › Paste link, drag a link in, or drop a text file full of links. A playlist link opens a picker so you choose which videos to take.
- **Quality you can see.** Every row shows a badge for what it will download (4K, 1080p, MP3 …) and a dropdown with the full ladder for that video, from best down to 360p, plus MP3, M4A and WAV audio. An "Apply to all" control sets one choice for the whole list.
- **Finished files.** MP4 with H.264/AAC preferred so it plays on stock Windows, subtitles embedded (auto-captions as fallback), chapters from the video's timestamps, cover art, and title/artist tags. MP3 at your chosen bitrate (320 kbps by default). M4A as the original stream, no re-encode. WAV as lossless 16-bit PCM for editing.
- **Fast.** Sixteen connections per file through aria2c, parallel fragment downloads for HLS/DASH sites, up to eight downloads at once, and a merge step that uses every CPU core. Links resolve in a couple of seconds and downloads begin immediately from the metadata already fetched.
- **Reliable.** A stalled download is detected and stopped after ten minutes of silence with the stage named. Failed rows stay in the list with the reason and a Retry. Every engine line is logged for support.
- **Download Later and History.** Park links for later, send them to the queue in one click, and keep a searchable record of what you downloaded and where it went, with duplicate detection across all three lists.
- **Self-updating engine.** The yt-dlp engine checks for a new build daily and installs it independently of app releases, so a site that changes does not wait for a TuberX update.
- **Browser extension.** Send the current page or any link from Chrome, Edge or Firefox with a click or Ctrl+Shift+P (Ctrl+Shift+L for Download Later).
- **No account needed.** Cookies and logins are optional and only matter for private, age-restricted or members-only media.

## Supported sites

YouTube (videos, Shorts, playlists, channels), Vimeo, Facebook, Instagram, Dailymotion, SoundCloud, Mixcloud, Bandcamp, Youku, and every other site the [yt-dlp](https://github.com/yt-dlp/yt-dlp) engine supports, which is most of the web.

## Install

- **Windows 10/11 (x64):** run `TuberX-Setup-<version>-x64.exe`, or use `TuberX-Portable-<version>-x64.exe` with no install. The portable build is self-extracting, so allow it a moment on launch while it expands. Both keep settings, history and logs in `%APPDATA%\TuberX`.
- **macOS (Apple silicon):** open the `.dmg` and drag TuberX to Applications. Builds are unsigned, so the first launch needs a right-click › Open.

Installed copies are offered new versions on launch.

## Window

TuberX opens as a compact applet (600×680) centred on your main display, painted before it is shown so there is no white flash. Resize or move it and it reopens exactly there next time; if that spot is no longer on a connected display it falls back to the centred default. Minimum size is 480×420.

## Settings

- **Destination:** default is `Videos\TuberX`; the last fifteen folders you picked are remembered.
- **Output:** default quality, convert non-MP4 sources, MP3 bitrate.
- **Subtitles:** embed, also save `.srt` files, languages.
- **Downloads:** skip files already downloaded, concurrent downloads (1–8), aria2c on/off, notifications.
- **Network:** proxy, Prefer IPv4 (on by default), cookies from a browser, a cookies.txt file, and the PO-token helper.
- **Engine:** status of every bundled tool and a manual "Update yt-dlp now".

The Settings, Later and History drawers close when you click outside them, press Escape, or add a link, and Settings has a Done button; changes apply the moment you make them.

## Troubleshooting

**"Sign in to confirm you're not a bot" from YouTube.** Almost always an IPv6 connection; TuberX connects over IPv4 by default, which resolves it. If it persists, the bundled PO-token helper handles most remaining cases without a login (it needs `jnn-pa.googleapis.com` reachable; some DNS filters block that host, and TuberX tells you if yours does). As a last resort, Settings › Network can use your browser's cookies (Firefox works best on Windows) or an imported cookies.txt.

**A download is slow or fails.** Every yt-dlp line for every download is written to `engine.log` in the app-data folder (`%APPDATA%\TuberX\logs` on Windows, `~/Library/Application Support/TuberX/logs` on macOS), rotated at 5 MB. It records the exact command, which downloader ran, speeds and the error text. Attach it to a bug report.

**"This video is DRM-protected."** The site serves that video only through DRM, and no downloader can take it.

## Building from source

```bash
bun install
bun scripts/fetch-tools.ts          # engine binaries for this machine (dev)
bun scripts/fetch-tools.ts win32    # engine binaries the Windows build bundles
bun scripts/fetch-pot.ts            # PO-token helper for both platforms
bun run dev                          # Vite + Electron
bun test                             # unit tests
bun scripts/site-check.ts           # resolve one public URL per supported site
bun run build:win                    # Windows installer + portable exe
bun run build:mac                    # macOS arm64 dmg + zip
```

macOS builds also need `bash scripts/build-aria2-mac.sh` once, because no static arm64 aria2c is published upstream.

Architecture in short: Electron + Vue 3 + Pinia + Tailwind, bundled by Vite and electron-builder. The engine is a set of external processes under `resources/bin/<platform>/` (`yt-dlp` onedir, `ffmpeg`, `aria2c`, `deno`), and the renderer never touches them directly; everything crosses a typed IPC bridge defined in `shared/types.ts`. Queue, history and Download Later live in SQLite (Node's built-in `node:sqlite`, no native module).

## Third-party software

TuberX bundles yt-dlp (Unlicense), FFmpeg (GPL build), aria2 (GPL), Deno (MIT) and the bgutil PO-token provider (GPL-3.0). See `THIRD_PARTY_LICENSES.md`. Media you download is subject to the terms of the site it came from.

## License

MIT. See `LICENSE`.
