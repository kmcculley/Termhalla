// NEW unit suite — feature 0005-cross-project-orky-registry (phase 4 / TASK-006, REQ-002).
// ADDITIVE coverage for `OrkyTracker.watch()`'s widened return type: it now RESOLVES to the resolved
// PROJECT root (the dir containing `.orky/`) or `null` — previously effectively `Promise<void>`. This is
// what lets `register-orky.ts` forward pane-root membership to the registry "with no second
// findOrkyRoot walk" (TASK-009). The FROZEN 0004 suite (tests/main/orky-tracker.test.ts) never inspects
// the return value of `watch()`, so this is a non-breaking, purely additive change — deliberately NOT
// added to that frozen file (ADR-009: frozen tests are not edited by a later feature; new coverage for
// new behavior gets a new file).
//
// Runs RED today: the shipped `OrkyTracker.watch()` resolves to `undefined` (Promise<void>), not the
// project root.
import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { OrkyTracker } from '../../src/main/orky/orky-tracker'

const cleanups: Array<() => void> = []
afterEach(() => { while (cleanups.length) cleanups.pop()!() })

describe('OrkyTracker.watch() — resolves to the PROJECT root (REQ-002, additive)', () => {
  it('TEST-144 REQ-002 watch() resolves to the resolved PROJECT root (the dir CONTAINING .orky/), not the .orky/ subdir itself', async () => {
    const root = mkdtempSync(join(tmpdir(), 'orky-trk-root-'))
    cleanups.push(() => rmSync(root, { recursive: true, force: true }))
    mkdirSync(join(root, '.orky', 'features'), { recursive: true })

    const tracker = new OrkyTracker(() => {}, { debounceMs: 20 })
    cleanups.push(() => tracker.dispose())
    const resolved = await tracker.watch('p1', root)
    expect(resolved).toBe(root)
    expect(resolved).not.toContain('.orky')
  })

  it('TEST-145 REQ-002 watch() resolves to null when the cwd has no .orky ancestor', async () => {
    const bare = mkdtempSync(join(tmpdir(), 'orky-trk-bare-'))
    cleanups.push(() => rmSync(bare, { recursive: true, force: true }))

    const tracker = new OrkyTracker(() => {}, { debounceMs: 20 })
    cleanups.push(() => tracker.dispose())
    const resolved = await tracker.watch('p1', bare)
    expect(resolved).toBeNull()
  })
})
