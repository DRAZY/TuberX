import { describe, expect, test } from 'bun:test'
import { run } from '../electron/engine/run'

// The child is this same runtime running a short script, never a shell: run() exists to start tools without one,
// and a test that handed it `sh -c` made static analysis (CodeQL alert 2) treat every argument list in the app as
// shell input.
const runtime = process.execPath

describe('run() idle watchdog', () => {
  test('kills a silent process tree and reports stalled', async () => {
    const started = Date.now()
    // A parent that starts a silent child of its own, prints once and then waits: both must be gone afterwards.
    const script = `const c = Bun.spawn(['/bin/sleep', '300'], { stdio: ['ignore', 'ignore', 'ignore'] }); console.log('started'); await c.exited`
    const { child, done } = run(runtime, ['-e', script], { idleTimeoutMs: 1500 })
    const res = await done
    expect(res.stalled).toBe(true)
    expect(res.stdout).toContain('started')
    expect(Date.now() - started).toBeLessThan(30000)
    expect(child.exitCode !== null || child.signalCode !== null).toBe(true)
  }, 40000)

  test('a chatty process is never considered stalled', async () => {
    const script = `for (let i = 0; i < 3; i++) { console.log('tick'); await Bun.sleep(500) }`
    const { done } = run(runtime, ['-e', script], { idleTimeoutMs: 5000 })
    const res = await done
    expect(res.stalled).toBe(false)
    expect(res.code).toBe(0)
  }, 20000)
})
