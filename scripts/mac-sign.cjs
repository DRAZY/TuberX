/**
 * electron-builder `mac.sign` hook: signs TuberX.app with Developer ID exactly as electron-builder would
 * (same @electron/osx-sign call, same options), with one change: the bundled tools get their own entitlements.
 *
 * electron-builder gives every nested executable the same inherit entitlements (allow-jit,
 * allow-unsigned-executable-memory, disable-library-validation), which Electron's helpers need but the tools
 * do not. Each tool gets only what it needs to run under hardened runtime:
 *   Resources/bin/deno       allow-jit (V8)                      build/entitlements.mac.deno.plist
 *   Resources/bin/**, pot/** none                                build/entitlements.mac.tool.plist
 * Entitlements only take effect on a process's main executable; dylibs and .node addons are listed under the
 * tool profile simply so they are signed (hardened runtime + timestamp) and pass library validation.
 */
const path = require('node:path')
const { signAsync } = require('@electron/osx-sign')

const ENT_TOOL = path.join(__dirname, '..', 'build', 'entitlements.mac.tool.plist')
const ENT_DENO = path.join(__dirname, '..', 'build', 'entitlements.mac.deno.plist')

/** Which entitlements file a path inside Contents/Resources gets, or null to keep electron-builder's choice. */
function toolEntitlements(appPath, filePath) {
  const rel = path.relative(path.join(appPath, 'Contents', 'Resources'), filePath).split(path.sep)
  if (rel[0] === '..' || path.isAbsolute(rel.join('/'))) return null
  if (rel.length === 2 && rel[0] === 'bin' && rel[1] === 'deno') return ENT_DENO
  if (rel[0] === 'bin' || rel[0] === 'pot') return ENT_TOOL
  return null
}

module.exports = async function sign(opts) {
  const base = opts.optionsForFile
  const optionsForFile = (filePath) => {
    const o = base ? base(filePath) : {}
    const ent = toolEntitlements(opts.app, filePath)
    return ent ? { ...o, entitlements: ent } : o
  }
  // Same retry electron-builder uses: the timestamp server occasionally drops a request.
  for (let attempt = 1; ; attempt++) {
    try {
      return await signAsync({ ...opts, optionsForFile })
    } catch (e) {
      if (attempt >= 3) throw e
      console.warn(`  • codesign attempt ${attempt} failed (${e.message.split('\n')[0]}); retrying`)
      await new Promise((r) => setTimeout(r, 5000 * attempt))
    }
  }
}
module.exports.toolEntitlements = toolEntitlements
