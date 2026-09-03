import { describe, expect, test } from 'bun:test'
import { run } from '../electron/engine/run'

describe('run() idle watchdog', () => {
  test('kills a silent process tree and reports stalled', async () => {
    const started = Date.now()
    // A parent shell that spawns a silent child: both must be gone afterwards.
    const { child, done } = run('sh', ['-c', 'sleep 300 & echo started; wait'], { idleTimeoutMs: 1500 })
    const res = await done
    expect(res.stalled).toBe(true)
    expect(res.stdout).toContain('started')
    expect(Date.now() - started).toBeLessThan(30000)
    expect(child.exitCode !== null || child.signalCode !== null).toBe(true)
  }, 40000)

  test('a chatty process is never considered stalled', async () => {
    const { done } = run('sh', ['-c', 'for i in 1 2 3; do echo tick; sleep 0.5; done'], { idleTimeoutMs: 5000 })
    const res = await done
    expect(res.stalled).toBe(false)
    expect(res.code).toBe(0)
  }, 20000)
})
