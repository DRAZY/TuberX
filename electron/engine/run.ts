import { spawn, type ChildProcess } from 'node:child_process'
import { delimiter } from 'node:path'

export interface RunResult {
  code: number | null
  stdout: string
  stderr: string
  /** Set when the idle watchdog killed the process for printing nothing for idleTimeoutMs. */
  stalled?: boolean
  /** Set when the process did not exit after a kill and the run was given up on. */
  orphaned?: boolean
}

export interface RunOptions {
  cwd?: string
  timeoutMs?: number
  onLine?: (line: string, stream: 'stdout' | 'stderr') => void
  signal?: AbortSignal
  env?: NodeJS.ProcessEnv
  /** Directories to put in front of PATH for the child (bundled tool dirs). */
  pathPrepend?: string[]
  /** Kill the whole process tree if no output arrives for this long; a function is re-read on every check. */
  idleTimeoutMs?: number | (() => number)
}

/** Kill a child and everything it spawned (yt-dlp → ffmpeg/aria2c). */
export function killTree(child: ChildProcess): void {
  if (!child.pid) return
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).on('error', () => child.kill())
    return
  }
  // POSIX: list the children first (once the parent is gone they reparent and can no longer be found),
  // TERM them so aria2c can save its control file, kill the parent, then KILL any child still alive 3 s later.
  const pg = spawn('pgrep', ['-P', String(child.pid)])
  let out = ''
  pg.stdout.on('data', (d: Buffer) => (out += d.toString()))
  const finish = () => {
    const kids = out.split(/\s+/).map(Number).filter((n) => n > 0)
    for (const k of kids) sig(k, 'SIGTERM')
    try {
      child.kill('SIGKILL')
    } catch {
      /* already gone */
    }
    setTimeout(() => kids.forEach((k) => sig(k, 'SIGKILL')), 3000)
  }
  pg.on('close', finish).on('error', finish)
}

function sig(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(pid, signal)
  } catch {
    /* already gone */
  }
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
    let giveUp: NodeJS.Timeout | undefined
    let settled = false
    let killing = false
    const finish = (r: RunResult) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      if (idle) clearInterval(idle)
      if (giveUp) clearTimeout(giveUp)
      opts.signal?.removeEventListener('abort', onAbort)
      resolve(r)
    }
    // A kill must always end the run. Tree kill first; if the process is still there after 5 s, a hard
    // kill of the parent and the run is declared over (an orphaned aria2c or ffmpeg cannot hold the UI).
    const kill = () => {
      killing = true
      killTree(child)
      if (!giveUp)
        giveUp = setTimeout(() => {
          try {
            child.kill('SIGKILL')
          } catch {
            /* gone */
          }
          finish({ code: null, stdout, stderr, stalled, orphaned: true })
        }, 5000)
    }
    const idleLimit = () => (typeof opts.idleTimeoutMs === 'function' ? opts.idleTimeoutMs() : opts.idleTimeoutMs ?? 0)
    if (opts.timeoutMs) timer = setTimeout(kill, opts.timeoutMs)
    if (opts.idleTimeoutMs) {
      idle = setInterval(() => {
        const limit = idleLimit()
        if (limit && Date.now() - lastActivity > limit && !killing) {
          stalled = true
          kill()
        }
      }, 1000)
    }
    const onAbort = () => kill()
    opts.signal?.addEventListener('abort', onAbort, { once: true })
    child.on('error', (err) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      if (idle) clearInterval(idle)
      if (giveUp) clearTimeout(giveUp)
      reject(err)
    })
    // After a kill, the parent's exit is enough: a surviving grandchild still holding the pipes must
    // not keep the promise open. A normal run waits for 'close' so the last output lines are read.
    child.on('exit', (code) => {
      if (killing) setTimeout(() => finish({ code, stdout, stderr, stalled }), 250)
    })
    child.on('close', (code) => finish({ code, stdout, stderr, stalled }))
  })
  return { child, done }
}
