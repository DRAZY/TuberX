/**
 * electron-builder `afterAllArtifactBuild` hook. Returns extra files to publish with the release.
 *
 * - macOS .dmg: electron-builder notarizes and staples the .app, but not the disk image around it. Submit the
 *   (Developer-ID-signed) dmg to Apple's notary service and staple the ticket, so Gatekeeper accepts it offline
 *   on first open. Uses the notarytool keychain profile in APPLE_KEYCHAIN_PROFILE (no password in any file).
 *   The dmg is left out of latest-mac.yml (dmg.writeUpdateInfo: false): in-app updates use the zip, and the
 *   staple changes the dmg's bytes after electron-builder would have hashed it.
 * - Windows portable .exe: write <exe>.sha256 (`<hex>  <name>`), which the portable build's self-update checks
 *   alongside GitHub's own asset digest before it swaps the new exe in.
 */
const { createHash } = require('node:crypto')
const { createReadStream, writeFileSync } = require('node:fs')
const { basename } = require('node:path')
const { execFileSync } = require('node:child_process')

function sha256File(file) {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256')
    createReadStream(file).on('data', (d) => h.update(d)).on('error', reject).on('end', () => resolve(h.digest('hex')))
  })
}

module.exports = async function afterAllArtifactBuild(result) {
  const extra = []
  for (const file of result.artifactPaths) {
    if (file.endsWith('.dmg')) {
      const profile = process.env.APPLE_KEYCHAIN_PROFILE
      if (!profile) {
        console.warn(`  • skipped dmg notarization: APPLE_KEYCHAIN_PROFILE is not set (${basename(file)})`)
        continue
      }
      console.log(`  • notarizing ${basename(file)} (keychain profile ${profile})`)
      execFileSync('xcrun', ['notarytool', 'submit', file, '--keychain-profile', profile, '--wait'], { stdio: 'inherit' })
      // notarytool exits 0 even when Apple answers "Invalid"; stapling fails in that case, which fails the build.
      execFileSync('xcrun', ['stapler', 'staple', file], { stdio: 'inherit' })
      execFileSync('xcrun', ['stapler', 'validate', file], { stdio: 'inherit' })
    } else if (/-Portable-.*\.exe$/.test(basename(file))) {
      const out = `${file}.sha256`
      writeFileSync(out, `${await sha256File(file)}  ${basename(file)}\n`)
      console.log(`  • wrote ${basename(out)}`)
      extra.push(out)
    }
  }
  return extra
}
