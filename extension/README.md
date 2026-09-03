# TuberX browser extension

Load unpacked in Chrome or Edge (`chrome://extensions` → Developer mode → Load unpacked → this folder) or as a temporary add-on in Firefox (`about:debugging#/runtime/this-firefox`).

- Toolbar button: send the current page to TuberX.
- Right-click a link, video or page: send it now, or add it to Download Later.
- `Ctrl+Shift+P` sends the page, `Ctrl+Shift+L` adds it to Later.

The extension opens a `tuberx://` (or `tuberxlater://`) URL in a background tab. Windows hands that to TuberX, which registers both protocols on install. The first time, the browser asks whether to allow the site to open TuberX; tick "Always allow".
