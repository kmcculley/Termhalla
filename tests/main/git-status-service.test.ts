import { describe, it, expect, vi } from 'vitest'
import { GitStatusService } from '../../src/main/git/git-status-service'

const CLEAN = [
  '# branch.oid abc',
  '# branch.head main',
  '# branch.upstream origin/main',
  '# branch.ab +0 -0',
  ''
].join('\n')

const DIRTY = CLEAN + '? new.txt\n'

function makeService(roots: Record<string, string | null>, statusByRoot: Record<string, string>) {
  const pushed: Array<[string, unknown]> = []
  const watchers: Array<{ root: string; trigger: () => void; closed: boolean; close: () => void }> = []
  const resolveRoot = vi.fn(async (cwd: string) => (cwd in roots ? roots[cwd] : null))
  const runStatus = vi.fn(async (root: string) => statusByRoot[root] ?? null)
  const makeWatcher = (root: string, onChange: () => void) => {
    const w = { root, trigger: onChange, closed: false, close() { this.closed = true } }
    watchers.push(w)
    return w
  }
  const svc = new GitStatusService(
    (id, st) => pushed.push([id, st]),
    resolveRoot, runStatus, makeWatcher, 0
  )
  return { svc, pushed, watchers, resolveRoot, runStatus }
}

/** Let queued microtasks + a 0ms debounce timer flush. */
const flush = () => new Promise(r => setTimeout(r, 5))

describe('GitStatusService', () => {
  it('pushes git status for a repo cwd', async () => {
    const { svc, pushed } = makeService({ '/r': '/r' }, { '/r': CLEAN })
    await svc.setCwd('p1', '/r')
    expect(pushed).toContainEqual(['p1', expect.objectContaining({ branch: 'main', root: '/r', dirty: false })])
  })

  it('pushes null for a non-repo cwd', async () => {
    const { svc, pushed } = makeService({}, {})
    await svc.setCwd('p1', '/x')
    expect(pushed).toContainEqual(['p1', null])
  })

  it('dedups an identical status on watch re-trigger', async () => {
    const { svc, pushed, watchers } = makeService({ '/r': '/r' }, { '/r': CLEAN })
    await svc.setCwd('p1', '/r')
    const before = pushed.length
    watchers[0].trigger()
    await flush()
    expect(pushed.length).toBe(before)
  })

  it('re-pushes when the status changes (clean -> dirty)', async () => {
    const status: Record<string, string> = { '/r': CLEAN }
    const { svc, pushed, watchers } = makeService({ '/r': '/r' }, status)
    await svc.setCwd('p1', '/r')
    status['/r'] = DIRTY
    watchers[0].trigger()
    await flush()
    expect(pushed.at(-1)).toEqual(['p1', expect.objectContaining({ dirty: true })])
  })

  it('re-probes on command-done', async () => {
    const status: Record<string, string> = { '/r': CLEAN }
    const { svc, pushed, runStatus } = makeService({ '/r': '/r' }, status)
    await svc.setCwd('p1', '/r')
    const calls = runStatus.mock.calls.length
    status['/r'] = DIRTY
    svc.onCommandDone('p1')
    await flush()
    expect(runStatus.mock.calls.length).toBeGreaterThan(calls)
    expect(pushed.at(-1)).toEqual(['p1', expect.objectContaining({ dirty: true })])
  })

  it('shares one watcher across panes in the same root, closing it when the last leaves', async () => {
    const { svc, watchers } = makeService({ '/a': '/r', '/b': '/r' }, { '/r': CLEAN })
    await svc.setCwd('p1', '/a')
    await svc.setCwd('p2', '/b')
    expect(watchers.length).toBe(1)
    svc.removePane('p1')
    expect(watchers[0].closed).toBe(false)
    svc.removePane('p2')
    expect(watchers[0].closed).toBe(true)
  })

  it('closes all watchers on stop()', async () => {
    const { svc, watchers } = makeService({ '/a': '/r' }, { '/r': CLEAN })
    await svc.setCwd('p1', '/a')
    svc.stop()
    expect(watchers[0].closed).toBe(true)
  })
})
