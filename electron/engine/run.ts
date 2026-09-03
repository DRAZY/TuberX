import { spawn, type ChildProcess } from 'node:child_process'
import { delimiter } from 'node:path'

export interface RunResult {
  code: number | null
  stdout: string
  stderr: string
  /** Set when the idle watchdog killed the process for printing nothing for idleTimeoutMs. */
  stalled?: boolean
}

export interface RunOptions {
  cwd?: string
  timeoutMs?: number
  onLine?: (line: string, stream: 'stdout' | 'stderr') => void
  signal?: AbortSignal
  env?: NodeJS.ProcessEnv
  /** Directories to put in front of PATH for the child (bundled tool dirs). */
  pathPrepend?: string[]
  /** Kill the whole process tree if no output arrives for this long (post-processing stalls). */
  idleTimeoutMs?: number
}

/** Kill a child and everything it spawned (yt-dlp → ffmpeg/aria2c). */
export function killTree(child: ChildProcess): void {
  if (!child.pid) return
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).on('error', () => child.kill())
    return
  }
  // POSIX: children first (pkill -P), then the parent.
  spawn('pkill', ['-P', String(child.pid)], { stdio: 'ignore' }).on('close', () => {
    try {
      child.kill('SIGKILL')
    } catch {
      /* already gone */
    }
  }).on('error', () => child.kill('SIGKILL'))
}

/**
 * Spawn a tool, stream lines, collect output. Windows-safe: no shell, so
 * titles with quotes or ampersands never reach cmd.exe.
 */
export function run(cmd: string, args: string[], opts: RunOptions = {}): { child: ChildProcess; done: Promise<RunResult> } {
  // Tools that yt-dlp looks up by name (aria2c, deno, ffmpeg) must be on PATH; prepend our bin dirs.
  const extraPath = (opts.pathPrepend ?? []).filter(Boolean).join(delimiter)
  const PATH = extraPath ? `${extraPath}${delimiter}${process.env.PATH ?? ''}` : process.env.PATH
  const child = spawn(cmd, args, {
    cwd: opts.cwd,
    windowsHide: true,
    env: { ...process.env, PATH, Path: PATH, PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1', ...opts.env },
  })
  let stdout = ''
  let stderr = ''
  let lastActivity = Date.now()
  let stalled = false
  const feed = (stream: 'stdout' | 'stderr') => {
    let buf = ''
    return (chunk: Buffer) => {
      lastActivity = Date.now()
      const text = chunk.toString('utf8')
      if (stream === 'stdout') stdout += text
      else stderr += text
      if (!opts.onLine) return
      buf += text
      // yt-dlp progress uses \r without --newline; we pass --newline but split on both anyway
      const parts = buf.split(/\r\n|\n|\r/)
      buf = parts.pop() ?? ''
      for (const p of parts) if (p.length) opts.onLine(p, stream)
    }
  }
  child.stdout?.on('data', feed('stdout'))
  child.stderr?.on('data', feed('stderr'))

  const done = new Promise<RunResult>((resolve, reject) => {
    let timer: NodeJS.Timeout | undefined
    let idle: NodeJS.Timeout | undefined
    if (opts.timeoutMs) timer = setTimeout(() => killTree(child), opts.timeoutMs)
    if (opts.idleTimeoutMs) {
      idle = setInterval(() => {
        if (Date.now() - lastActivity > opts.idleTimeoutMs!) {
          stalled = true
          killTree(child)
        }
      }, Math.min(15000, Math.max(250, Math.floor(opts.idleTimeoutMs / 2))))
    }
    const onAbort = () => killTree(child)
    opts.signal?.addEventListener('abort', onAbort, { once: true })
    child.on('error', (err) => {
      if (timer) clearTimeout(timer)
      if (idle) clearInterval(idle)
      reject(err)
    })
    child.on('close', (code) => {
      if (timer) clearTimeout(timer)
      if (idle) clearInterval(idle)
      opts.signal?.removeEventListener('abort', onAbort)
      resolve({ code, stdout, stderr, stalled })
    })
  })
  return { child, done }
}
