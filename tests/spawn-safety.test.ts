import { describe, expect, test } from 'bun:test'
import { isAbsolute, win32 } from 'node:path'
import { run } from '../electron/engine/run'
import { sysTool } from '../electron/engine/systools'

describe('process launching', () => {
  test('run() refuses a bare command name, so the OS never searches cwd or PATH for it', () => {
    expect(() => run('ffmpeg', ['-version'])).toThrow(/not an absolute path/)
    expect(() => run('./yt-dlp', [])).toThrow(/not an absolute path/)
  })

  test('run() starts an absolute command without a shell: metacharacters arrive as literal argv', async () => {
    const res = await run(sysTool('tar'), ['--version', '; echo INJECTED', '&& echo INJECTED'], { timeoutMs: 10000 }).done
    expect(res.stdout + res.stderr).not.toContain('INJECTED\n')
  })

  test('system utilities resolve to an absolute path on this machine', () => {
    for (const t of ['tar', 'pgrep'] as const) expect(isAbsolute(sysTool(t))).toBe(true)
  })

  test('Windows utilities resolve under System32, never by bare name when the file exists', () => {
    const p = sysTool('taskkill', 'win32', () => true)
    expect(win32.isAbsolute(p) || p.includes('System32')).toBe(true)
    expect(p).toMatch(/System32[\\/]taskkill\.exe$/)
  })

  test('falls back to the bare name only when no expected file exists', () => {
    expect(sysTool('tar', 'win32', () => false)).toBe('tar.exe')
    expect(sysTool('pgrep', 'darwin', () => false)).toBe('pgrep')
  })
})
