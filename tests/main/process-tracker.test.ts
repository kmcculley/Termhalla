import { describe, it, expect, vi } from 'vitest'
import { ProcessTracker } from '../../src/main/proc/process-tracker'
import type { CimRow } from '../../src/main/proc/proc-tree'

// shell pid 100 -> child 200 (node)
const rows: CimRow[] = [
  { ProcessId: 200, ParentProcessId: 100, Name: 'node.exe', CommandLine: 'node app.js', CreationDate: '/Date(1)/' }
]
const pidOf = () => 100
const runQuery = () => Promise.resolve(rows)

describe('ProcessTracker.pollOnce', () => {
  it('emits ProcInfo for a busy session', async () => {
    const emit = vi.fn()
    const t = new ProcessTracker(pidOf, emit, runQuery)
    t.register('a'); t.setBusy('a', true)
    emit.mockClear()                 // ignore the register/setBusy housekeeping emits
    await t.pollOnce()
    expect(emit).toHaveBeenCalledTimes(1)
    expect(emit).toHaveBeenCalledWith('a', expect.objectContaining({ foreground: 'node' }))
    t.dispose()
  })

  it('does not query when nothing is busy', async () => {
    const q = vi.fn(runQuery)
    const t = new ProcessTracker(pidOf, vi.fn(), q)
    t.register('a')                  // registered but idle
    await t.pollOnce()
    expect(q).not.toHaveBeenCalled()
    t.dispose()
  })

  it('dedups repeated identical snapshots', async () => {
    const emit = vi.fn()
    const t = new ProcessTracker(pidOf, emit, runQuery)
    t.register('a'); t.setBusy('a', true); emit.mockClear()
    await t.pollOnce()
    await t.pollOnce()
    expect(emit).toHaveBeenCalledTimes(1)
    t.dispose()
  })

  it('emits a single null (cleared) when a session goes idle', async () => {
    const emit = vi.fn()
    const t = new ProcessTracker(pidOf, emit, runQuery)
    t.register('a'); t.setBusy('a', true); await t.pollOnce(); emit.mockClear()
    t.setBusy('a', false)
    t.setBusy('a', false)            // second call must not re-emit
    expect(emit).toHaveBeenCalledTimes(1)
    expect(emit).toHaveBeenCalledWith('a', null)
    t.dispose()
  })

  it('clears a busy session whose pid has vanished', async () => {
    const emit = vi.fn()
    const t = new ProcessTracker(() => undefined, emit, runQuery)
    t.register('a'); t.setBusy('a', true); emit.mockClear()
    await t.pollOnce()
    expect(emit).toHaveBeenCalledWith('a', null)
    t.dispose()
  })
})
