import type { ToolStatus } from '../../shared/types'
import { potDir, resolveTool, TOOL_NAMES, type ToolName } from './paths'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { run } from './run'

const VERSION_ARGS: Record<Exclude<ToolName, 'pot-helper'>, string[]> = {
  'yt-dlp': ['--version'],
  ffmpeg: ['-version'],
  aria2c: ['--version'],
  deno: ['--version'],
}

function parseVersion(name: Exclude<ToolName, 'pot-helper'>, out: string): string | undefined {
  const first = out.split(/\r?\n/)[0] ?? ''
  switch (name) {
    case 'yt-dlp':
      return first.trim() || undefined
    case 'ffmpeg':
      return first.match(/version\s+(\S+)/)?.[1]
    case 'aria2c':
      return first.match(/version\s+(\S+)/)?.[1]
    case 'deno':
      return first.match(/deno\s+(\S+)/)?.[1]
  }
}

export async function checkTool(name: Exclude<ToolName, 'pot-helper'>): Promise<ToolStatus> {
  const path = resolveTool(name)
  if (!path) return { name, path: '', ok: false, error: 'not found' }
  try {
    const { done } = run(path, VERSION_ARGS[name], { timeoutMs: name === 'yt-dlp' ? 90000 : 15000 })
    const res = await done
    const version = parseVersion(name, res.stdout || res.stderr)
    return { name, path, version, ok: res.code === 0 && !!version, error: res.code === 0 ? undefined : `exit ${res.code}` }
  } catch (e) {
    return { name, path, ok: false, error: (e as Error).message }
  }
}

export async function checkAllTools(): Promise<ToolStatus[]> {
  const tools = await Promise.all(TOOL_NAMES.map(checkTool))
  const pot = potDir()
  const ok = !!pot && existsSync(join(pot, 'plugins', 'bgutil-ytdlp-pot-provider.zip')) && existsSync(join(pot, 'server', 'node_modules', 'canvas'))
  tools.push({ name: 'pot-helper', path: pot ?? '', version: ok ? 'bgutil 1.3.2' : undefined, ok, error: ok ? undefined : 'not bundled' })
  return tools
}
