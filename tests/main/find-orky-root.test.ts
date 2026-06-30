// FROZEN unit suite — feature 0004-orky-status-awareness (phase 4 / REQ-012 + REQ-024 discovery rule).
// `.orky/` discovery is a deterministic, BOUNDED upward walk from the pane's tracked cwd — it checks
// cwd then walks UP a fixed number of ancestors, never to the filesystem root unbounded. It MUST also
// degrade to `null` (not throw) on a non-string input so a malformed IPC arg can never surface as an
// unhandled rejection that kills the main process (REQ-024 / FINDING-SEC-001).
//
// Chosen contract (see 04-tests.md):
//   findOrkyRoot(cwd: string, opts?: { maxDepth?: number }): string | null
//   → the first directory (cwd or an ancestor) that contains a `.orky/` dir, or null.
//
// Runs RED against the prior pass: the shipped `findOrkyRoot` calls `dirname(dir)` OUTSIDE its
// try/catch, so a non-string `cwd` throws a TypeError instead of returning null (FINDING-SEC-001).
import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { findOrkyRoot } from '../../src/main/orky/find-orky-root'

const cleanups: Array<() => void> = []
afterEach(() => { while (cleanups.length) cleanups.pop()!() })

function projectWithOrky(): string {
  const proj = mkdtempSync(join(tmpdir(), 'orky-root-'))
  mkdirSync(join(proj, '.orky'), { recursive: true })
  cleanups.push(() => rmSync(proj, { recursive: true, force: true }))
  return proj
}

describe('findOrkyRoot — bounded ancestor walk (REQ-012)', () => {
  it('TEST-025 REQ-012 finds .orky in the cwd itself', () => {
    const proj = projectWithOrky()
    expect(findOrkyRoot(proj, { maxDepth: 8 })).toBe(proj)
  })

  it('TEST-025 REQ-012 finds .orky in an ancestor of a nested cwd', () => {
    const proj = projectWithOrky()
    const nested = join(proj, 'a', 'b', 'c')
    mkdirSync(nested, { recursive: true })
    expect(findOrkyRoot(nested, { maxDepth: 8 })).toBe(proj)
  })

  it('TEST-025 REQ-012 returns null when no ancestor has .orky, and respects the bounded depth cap', () => {
    const bare = mkdtempSync(join(tmpdir(), 'orky-none-'))
    cleanups.push(() => rmSync(bare, { recursive: true, force: true }))
    expect(findOrkyRoot(bare, { maxDepth: 8 })).toBeNull()

    const proj = projectWithOrky()
    const deep = join(proj, 'a', 'b', 'c')
    mkdirSync(deep, { recursive: true })
    expect(findOrkyRoot(deep, { maxDepth: 1 })).toBeNull()
  })

  it('TEST-044 REQ-024 a non-string cwd degrades to null, never throws (no unhandled rejection)', () => {
    // Runtime IPC args arrive as `unknown` (TS annotations are compile-time only). A non-string cwd must
    // NOT throw a TypeError out of the discovery walk (which `void orky.watch(...)` would surface as an
    // unhandled rejection — Node 22 `--unhandled-rejections=throw` would then kill the main process).
    expect(() => findOrkyRoot(123 as never)).not.toThrow()
    expect(findOrkyRoot(123 as never)).toBeNull()
    expect(() => findOrkyRoot(undefined as never)).not.toThrow()
    expect(findOrkyRoot(undefined as never)).toBeNull()
    expect(() => findOrkyRoot(null as never)).not.toThrow()
    expect(findOrkyRoot(null as never)).toBeNull()
    expect(() => findOrkyRoot({} as never)).not.toThrow()
    expect(findOrkyRoot({} as never)).toBeNull()
  })
})
