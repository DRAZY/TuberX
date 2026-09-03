import { app } from 'electron'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { delimiter } from 'node:path'
import type { ToolStatus } from '../../shared/types'

export type ToolName = ToolStatus['name']
const TOOLS: Exclude<ToolName, 'pot-helper'>[] = ['yt-dlp', 'ffmpeg', 'aria2c', 'deno']

/** resources/pot in a packaged app, resources/pot in dev (with the platform's node_modules already in place). */
export function potDir(): string | null {
  const candidates = app.isPackaged
    ? [join(process.resourcesPath, 'pot')]
    : [app.getAppPath(), dirname(app.getAppPath()), process.cwd(), join(__dirname, '..')].map((r) => join(r, 'resources', 'pot'))
  for (const d of candidates) if (existsSync(join(d, 'server', 'src', 'generate_once.ts'))) return d
  return null
}

const EXE = process.platform === 'win32' ? '.exe' : ''

/** Where an updated yt-dlp lands (Program Files is read-only, userData is not). */
export function userBinDir(): string {
  return join(app.getPath('userData'), 'bin')
}

/** Bundled tools: `resources/bin` in a packaged app, `resources/bin/<platform>` in dev. */
export function bundledBinDir(): string {
  if (app.isPackaged) return join(process.resourcesPath, 'bin')
  // Dev: `electron .` gives the project root; `electron dist-electron/main.js` gives dist-electron.
  const roots = [app.getAppPath(), dirname(app.getAppPath()), process.cwd(), join(__dirname, '..')]
  for (const r of roots) {
    const dir = join(r, 'resources', 'bin', process.platform)
    if (existsSync(dir)) return dir
  }
  return join(app.getAppPath(), 'resources', 'bin', process.platform)
}

function findOnPath(name: string): string | null {
  const path = process.env.PATH ?? ''
  for (const dir of path.split(delimiter)) {
    if (!dir) continue
    const candidate = join(dir, name + EXE)
    if (existsSync(candidate)) return candidate
  }
  // Common Homebrew locations that are not always on a GUI app's PATH (dev on macOS)
  for (const dir of ['/opt/homebrew/bin', '/usr/local/bin']) {
    const candidate = join(dir, name + EXE)
    if (existsSync(candidate)) return candidate
  }
  return null
}

/**
 * Resolution order: user-updated copy → bundled copy → PATH.
 * Returns null when the tool is missing entirely.
 */
export function resolveTool(name: Exclude<ToolName, 'pot-helper'>): string | null {
  const file = name + EXE
  const candidates: string[] = []
  for (const dir of [userBinDir(), bundledBinDir()]) {
    if (name === 'yt-dlp') candidates.push(join(dir, 'yt-dlp', file)) // onedir layout: yt-dlp/yt-dlp(.exe) + _internal
    candidates.push(join(dir, file))
  }
  for (const c of candidates) if (existsSync(c)) return c
  return findOnPath(name)
}

export function resolveAllTools(): Record<Exclude<ToolName, 'pot-helper'>, string | null> {
  const out = {} as Record<Exclude<ToolName, 'pot-helper'>, string | null>
  for (const t of TOOLS) out[t] = resolveTool(t)
  return out
}

/** yt-dlp wants the *directory* (or file) containing ffmpeg. ffprobe is optional and not shipped. */
export function ffmpegLocation(): string | null {
  const ff = resolveTool('ffmpeg')
  return ff ? dirname(ff) : null
}

/** Every directory a bundled or user-updated tool can live in, for PATH prepending. */
export function toolDirs(): string[] {
  return [userBinDir(), bundledBinDir()].filter((d) => existsSync(d))
}

export const TOOL_NAMES = TOOLS as Exclude<ToolName, 'pot-helper'>[]
