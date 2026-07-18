// The DEFAULT ancestor-walk bound (0004 FINDING-DA-006, fixed 2026-07-09). The default cap was 8,
// so a pane whose cwd sits >8 directories below the project root — an unremarkable depth in a
// monorepo — silently showed NO Orky chrome at all: status disappeared purely as a function of
// cwd depth. The walk is still deterministic and capped (never unbounded, and it stops at the
// filesystem root regardless); the default is now just deep enough that no real tree hits it.
// The FROZEN 0004 suite (find-orky-root.test.ts) passes explicit maxDepth everywhere it cares
// about depth, so it pins nothing about this default.
import { describe, it, expect } from 'vitest'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { findOrkyRoot, DEFAULT_ORKY_ROOT_MAX_DEPTH } from '../../src/main/orky/find-orky-root'
import { OrkyTracker } from '../../src/main/orky/orky-tracker'

describe('findOrkyRoot default depth', () => {
  it('resolves a cwd 12 levels below the root (deeper than the old cap of 8)', () => {
    const proj = mkdtempSync(join(tmpdir(), 'orky-depth-'))
    mkdirSync(join(proj, '.orky'))
    const deep = join(proj, ...Array.from({ length: 12 }, (_, i) => `d${i}`))
    mkdirSync(deep, { recursive: true })
    expect(findOrkyRoot(deep)).toBe(resolve(proj))
  })

  // The DA-006 fix must hold through the ONLY production call site: OrkyTracker.watch. A
  // `{ maxDepth: 8 }` override there silently reinstates the old cliff no matter what the
  // default is, so this resolves the SAME >8-deep cwd through the tracker itself (built the
  // way tests/main/orky-tracker-watch-root.test.ts builds one).
  it('OrkyTracker.watch resolves a pane cwd 12 levels below the root — the tracker must not override the default bound', async () => {
    const proj = mkdtempSync(join(tmpdir(), 'orky-depth-trk-'))
    mkdirSync(join(proj, '.orky'))
    const deep = join(proj, ...Array.from({ length: 12 }, (_, i) => `d${i}`))
    mkdirSync(deep, { recursive: true })
    const tracker = new OrkyTracker(() => {}, { debounceMs: 20 })
    try {
      await expect(tracker.watch('p1', deep)).resolves.toBe(resolve(proj))
    } finally {
      tracker.dispose()
    }
  })

  it('the default bound is generous but still finite', () => {
    expect(DEFAULT_ORKY_ROOT_MAX_DEPTH).toBeGreaterThanOrEqual(32)
    expect(Number.isFinite(DEFAULT_ORKY_ROOT_MAX_DEPTH)).toBe(true)
  })

  it('a rootless deep path still returns null (the walk stops at the fs root)', () => {
    const bare = mkdtempSync(join(tmpdir(), 'orky-none-'))
    const deep = join(bare, 'a', 'b', 'c')
    mkdirSync(deep, { recursive: true })
    expect(findOrkyRoot(deep)).toBeNull()
  })
})
