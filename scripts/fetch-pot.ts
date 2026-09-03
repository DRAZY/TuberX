/**
 * Assembles the bgutil PO-token helper (https://github.com/Brainicism/bgutil-ytdlp-pot-provider)
 * into resources/pot/:
 *   plugins/bgutil-ytdlp-pot-provider.zip   yt-dlp plugin (platform independent)
 *   server/{src,types,package.json,deno.json,node_modules}  script-mode server, run by the bundled Deno
 *   node_modules-win32/                     same tree with the win32-x64 canvas prebuilt swapped in
 * node_modules is produced by npm (flat, no symlinks) so one tree serves both platforms; only the
 * native `canvas` addon differs, and node-canvas publishes N-API prebuilds for both.
 *   bun scripts/fetch-pot.ts [--force]
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { $ } from 'bun'

const VERSION = process.env.BGUTIL_VERSION ?? '1.3.2'
const CANVAS_VERSION = process.env.CANVAS_VERSION ?? '3.2.3'
const ROOT = resolve(import.meta.dir, '..')
const POT = join(ROOT, 'resources', 'pot')
const force = process.argv.includes('--force')
const UA = { 'User-Agent': 'TuberX-fetch-pot' }

async function dl(url: string, dest: string) {
  console.log(`  ↓ ${url}`)
  const r = await fetch(url, { headers: UA, redirect: 'follow' })
  if (!r.ok) throw new Error(`${r.status} ${url}`)
  mkdirSync(join(dest, '..'), { recursive: true })
  await Bun.write(dest, await r.arrayBuffer())
}

if (force) rmSync(POT, { recursive: true, force: true })
mkdirSync(join(POT, 'plugins'), { recursive: true })

// 1. plugin zip
const zip = join(POT, 'plugins', 'bgutil-ytdlp-pot-provider.zip')
if (!existsSync(zip)) await dl(`https://github.com/Brainicism/bgutil-ytdlp-pot-provider/releases/download/${VERSION}/bgutil-ytdlp-pot-provider.zip`, zip)
else console.log('  ✓ plugin zip (exists)')

// 2. server source
const server = join(POT, 'server')
if (!existsSync(join(server, 'src', 'generate_once.ts'))) {
  const tgz = join(POT, '.src.tgz')
  await dl(`https://github.com/Brainicism/bgutil-ytdlp-pot-provider/archive/refs/tags/${VERSION}.tar.gz`, tgz)
  const tmp = join(POT, '.src')
  rmSync(tmp, { recursive: true, force: true })
  mkdirSync(tmp, { recursive: true })
  await $`tar -xzf ${tgz} -C ${tmp} --strip-components=1`.quiet()
  mkdirSync(server, { recursive: true })
  for (const d of ['src', 'types']) cpSync(join(tmp, 'server', d), join(server, d), { recursive: true })
  cpSync(join(tmp, 'server', 'tsconfig.json'), join(server, 'tsconfig.json'))
  const upstream = JSON.parse(readFileSync(join(tmp, 'server', 'package.json'), 'utf8'))
  // runtime deps only: no eslint/typescript/swc, which carry their own native addons
  writeFileSync(
    join(server, 'package.json'),
    JSON.stringify({ name: 'tuberx-pot-server', private: true, type: 'module', version: upstream.version, dependencies: upstream.dependencies }, null, 2),
  )
  // Deno: use the npm-made node_modules as-is, never touch the network or a lockfile at runtime
  writeFileSync(join(server, 'deno.json'), JSON.stringify({ nodeModulesDir: 'manual', lock: false }, null, 2))
  rmSync(tmp, { recursive: true, force: true })
  rmSync(tgz, { force: true })
  console.log(`  ✓ server source ${upstream.version}`)
} else console.log('  ✓ server source (exists)')

// 3. node_modules via npm (flat tree; canvas prebuilt for this host)
if (!existsSync(join(server, 'node_modules', 'canvas'))) {
  console.log('  npm install (runtime deps)…')
  await $`npm install --omit=dev --no-audit --no-fund --loglevel=error`.cwd(server)
  console.log('  ✓ node_modules')
} else console.log('  ✓ node_modules (exists)')

// 4. Windows variant: same tree, win32-x64 canvas addon
const win = join(POT, 'node_modules-win32')
if (!existsSync(join(win, 'canvas', 'build', 'Release', 'canvas.node'))) {
  rmSync(win, { recursive: true, force: true })
  cpSync(join(server, 'node_modules'), win, { recursive: true })
  const rel = join(win, 'canvas', 'build', 'Release')
  rmSync(join(win, 'canvas', 'build'), { recursive: true, force: true })
  mkdirSync(rel, { recursive: true })
  const tgz = join(POT, '.canvas-win.tgz')
  await dl(`https://github.com/Automattic/node-canvas/releases/download/v${CANVAS_VERSION}/canvas-v${CANVAS_VERSION}-napi-v7-win32-x64.tar.gz`, tgz)
  await $`tar -xzf ${tgz} -C ${join(win, 'canvas')}`.quiet()
  rmSync(tgz, { force: true })
  console.log(`  ✓ node_modules-win32 (canvas ${CANVAS_VERSION} win32-x64: ${existsSync(join(rel, 'canvas.node'))})`)
} else console.log('  ✓ node_modules-win32 (exists)')

// 5. Slim: bundle the helper into one file and keep only the native canvas addon in node_modules.
//    Thousands of node_modules files are what makes the self-extracting portable slow to launch.
const bundleMarker = join(server, 'src', '.bundled')
if (!existsSync(bundleMarker) || force) {
  console.log('  esbuild bundle…')
  const banner = [
    "import { createRequire as __cr } from 'node:module';",
    "import { fileURLToPath as __f2p } from 'node:url';",
    "import { dirname as __dn } from 'node:path';",
    'const require = __cr(import.meta.url);',
    'const __filename = __f2p(import.meta.url);',
    'const __dirname = __dn(__filename);',
  ].join(' ')
  await $`bunx esbuild src/generate_once.ts --bundle --platform=node --format=esm --target=node20 --external:canvas --external:css-tree --banner:js=${banner} --outfile=src/generate_once.bundle.mjs --log-level=warning`.cwd(server)
  // the yt-dlp plugin hard-codes <server_home>/src/generate_once.ts; plain JS is valid TS, so the bundle takes that name
  // jsdom reads its default stylesheet from disk relative to its own __dirname, which no longer exists
  // once bundled; inline the CSS so the bundle has no runtime file dependency.
  let bundledText = readFileSync(join(server, 'src', 'generate_once.bundle.mjs'), 'utf8')
  const css = readFileSync(join(server, 'node_modules', 'jsdom', 'lib', 'jsdom', 'browser', 'default-stylesheet.css'), 'utf8')
  const before = bundledText.length
  bundledText = bundledText.replace(
    /\w+\.readFileSync\(\s*\w+\.resolve\(\s*__dirname,\s*"[^"]*default-stylesheet\.css"\s*\),\s*(?:"utf-?8"|\{\s*encoding:\s*"utf-?8"\s*\})\s*\)/g,
    () => JSON.stringify(css),
  )
  if (bundledText.length === before) throw new Error('jsdom stylesheet read not found in bundle; esbuild output shape changed')
  // css-tree loads JSON data through createRequire at runtime, so it stays external (with its two deps)
  // instead of being bundled; anything else still requiring files at runtime is a build error.
  // jsdom resolves its sync-XHR worker file at load time; that touches the filesystem outside what the
  // plugin's Deno permissions allow, and BotGuard never uses sync XHR. Make it a plain string.
  bundledText = bundledText.replace(/__require\.resolve\("\.\/xhr-sync-worker\.js"\)/g, '"xhr-sync-worker.js"')
  const resolves = [...bundledText.matchAll(/__require\.resolve\(([^)]*)\)/g)].map((m) => m[1])
  if (resolves.length) throw new Error(`runtime require.resolve left in bundle: ${resolves.join(', ')}`)
  const leftovers = [...bundledText.matchAll(/\brequire\d*\("(\.[^"]+)"\)/g)].map((m) => m[1])
  if (leftovers.length) throw new Error(`runtime relative requires left in bundle: ${leftovers.join(', ')}`)
  const bundled = Buffer.from(bundledText)
  for (const f of readdirSync(join(server, 'src'))) rmSync(join(server, 'src', f), { recursive: true, force: true })
  writeFileSync(join(server, 'src', 'generate_once.ts'), bundled)
  writeFileSync(bundleMarker, new Date().toISOString())
  rmSync(join(server, 'types'), { recursive: true, force: true })
  rmSync(join(server, 'tsconfig.json'), { force: true })
  rmSync(join(server, 'package-lock.json'), { force: true })
  // node_modules: the native canvas addon plus css-tree (runtime JSON loads) and its deps; nothing else
  const keep = new Set(['canvas', 'css-tree', 'mdn-data', 'source-map-js'])
  for (const dir of [join(server, 'node_modules'), win]) {
    for (const entry of readdirSync(dir)) if (!keep.has(entry)) rmSync(join(dir, entry), { recursive: true, force: true })
    for (const junk of ['src', 'binding.gyp', 'Readme.md', 'index.d.ts', 'util']) rmSync(join(dir, 'canvas', junk), { recursive: true, force: true })
  }
  console.log('  ✓ bundled: src/generate_once.ts + node_modules/{canvas,css-tree,mdn-data,source-map-js}')
} else console.log('  ✓ bundle (exists)')

const count = (d: string): number => readdirSync(d, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? count(join(d, e.name)) : 1), 0)
const size = await $`du -sh ${server} ${win}`.text()
console.log(size.trim())
console.log(`files: server=${count(server)} win32 node_modules=${count(win)}`)
