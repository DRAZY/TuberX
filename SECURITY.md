# Security policy

## Reporting a vulnerability

Please report security issues privately through GitHub's private vulnerability reporting for this repository (Security → Report a vulnerability), not in a public issue. Include the TuberX version (Settings → About), your platform, and steps to reproduce. You will get an acknowledgement within a few days and a fix or a decision as soon as the issue is understood.

## What TuberX does with your data

- No account, no telemetry, no analytics. TuberX talks to the sites you download from, to GitHub Releases for app and engine updates, and to nothing else.
- Site passwords are stored with the operating system's encryption (Electron `safeStorage`: Keychain on macOS, DPAPI on Windows), never in plain text. Cookies you import stay on your machine.
- Downloads run in separate processes (yt-dlp, ffmpeg, aria2c) bundled with the app; the renderer has no filesystem or process access and reaches the main process only through a typed, context-isolated bridge.

## Supported versions

Only the latest release receives fixes. The app checks GitHub Releases for new versions on the schedule you choose and tells you in the app when one is available.
